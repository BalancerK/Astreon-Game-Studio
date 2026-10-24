// Package metadata and releases for the monorepo. One version for every package (they are released together), dependencies taken from what
// the code really imports (the same scan that enforces the package boundaries), descriptions from the table in the root README.
// `tools/release.js` is the command line for this; the pieces live here so tests can use them.
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, cpSync, rmSync } from 'node:fs';
import { join, relative, sep, posix, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { checkDeps } from './check-deps.js';

/**
 * In a published package, an import of another package must name it (`@engine/math`), not climb out of the folder (`../../math/src/index.js`):
 * installed packages are not guaranteed to sit side by side. Rewrites those imports in one source file.
 * @param {string} source
 * @param {string} file Path of the file relative to the package folder (`src/a/b.js`).
 * @param {string} pkg This package's folder name.
 */
export function rewriteImports(source, file, pkg) {
  const re = /(\bfrom\s*|\bimport\s*\(?\s*)(['"])(\.{1,2}\/[^'"\n]+)\2/g;
  return source.replace(re, (m, head, q, spec) => {
    // where the import points, as a path from the folder that holds all the packages: render/src/a/b.js + ../../../math/src/index.js -> math/src/index.js
    const target = posix.normalize(posix.join(pkg, posix.dirname(file), spec));
    const found = /^([a-z0-9-]+)\/(.+)$/.exec(target);
    if (!found || found[1] === pkg) return m;      // inside this package, or somewhere that is not a package: leave it
    const [, other, rest] = found;
    return `${head}${q}@engine/${other}${rest === 'src/index.js' ? '' : `/${rest}`}${q}`;
  });
}

/** Run npm without a shell (paths with spaces survive): through npm's own script next to this Node, else the `npm` on the PATH. */
export function npm(args, { cwd, stdio = 'pipe' } = {}) {
  const cli = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  if (existsSync(cli)) return execFileSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8', stdio });
  return execFileSync('npm', args, { cwd, encoding: 'utf8', stdio, shell: process.platform === 'win32' });
}

/** Files (besides `src`, README, licence) that a package ships. */
export const EXTRA_FILES = { 'create-game': ['templates'] };
const KEY_ORDER = ['name', 'version', 'description', 'license', 'type', 'main', 'exports', 'bin', 'files', 'sideEffects', 'engines', 'keywords', 'dependencies'];

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const writeJson = (p, v) => writeFileSync(p, `${JSON.stringify(v, null, 2)}\n`);

/** `{ name: description }` from the package table in README.md. */
export function readDescriptions(root) {
  const out = {};
  for (const line of readFileSync(join(root, 'README.md'), 'utf8').split('\n')) {
    const m = /^\|\s*\[`([a-z0-9-]+)`\]\(packages\/\1\)\s*\|\s*(.+?)\s*\|\s*$/.exec(line);
    if (!m) continue;
    let text = m[2].replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/`/g, '');
    const cut = text.search(/(?<=[a-z0-9)])\.\s/); // the first sentence
    if (cut > 0) text = text.slice(0, cut);
    out[m[1]] = text.replace(/\.$/, '');
  }
  return out;
}

export function packageNames(root) {
  return readdirSync(join(root, 'packages')).filter((n) => existsSync(join(root, 'packages', n, 'package.json'))).sort();
}

/** The version every package has (from the root package.json). */
export const rootVersion = (root) => readJson(join(root, 'package.json')).version;

/**
 * What each package.json should say. Keys that this tool does not manage (e.g. `bin`) are kept as they are.
 * @returns {Map<string, any>}
 */
export function generate(root) {
  const version = rootVersion(root);
  if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version ?? '')) throw new Error(`the root package.json needs a "version" like 0.1.0 (it has ${JSON.stringify(version)})`);
  const { edges, errors } = checkDeps(root);
  if (errors.length) throw new Error(`fix the package boundary errors first (node tools/check-deps.js):\n${errors.join('\n')}`);
  const descriptions = readDescriptions(root);
  const out = new Map();
  for (const name of packageNames(root)) {
    const file = join(root, 'packages', name, 'package.json');
    const old = readJson(file);
    const deps = [...(edges.get(name) ?? [])].filter((d) => d !== name).sort();
    const pkg = {
      name: `@engine/${name}`, version,
      description: descriptions[name] ?? old.description ?? `${name} for the engine`,
      license: 'Apache-2.0', type: 'module', main: 'src/index.js',
      exports: { '.': './src/index.js', './src/*': './src/*', './package.json': './package.json' },
      ...(old.bin ? { bin: old.bin } : {}),
      files: ['src', ...(EXTRA_FILES[name] ?? []), 'README.md', 'API.md', 'LICENSE', 'NOTICE'],
      sideEffects: false,
      engines: { node: '>=20' },
      keywords: ['game-engine', 'javascript', 'webgpu', 'multiplayer', name],
      ...(deps.length ? { dependencies: Object.fromEntries(deps.map((d) => [`@engine/${d}`, `^${version}`])) } : {}),
    };
    out.set(name, Object.fromEntries(KEY_ORDER.filter((k) => k in pkg).map((k) => [k, pkg[k]])));
  }
  return out;
}

/** Compare the files on disk with what `generate` says. @returns {string[]} one line per difference */
export function check(root) {
  const problems = [];
  for (const [name, want] of generate(root)) {
    const file = join(root, 'packages', name, 'package.json');
    const have = readJson(file);
    if (JSON.stringify(have) !== JSON.stringify(want)) {
      const keys = new Set([...Object.keys(have), ...Object.keys(want)]);
      const diff = [...keys].filter((k) => JSON.stringify(have[k]) !== JSON.stringify(want[k]));
      problems.push(`packages/${name}/package.json is out of date (${diff.join(', ')}): run node tools/release.js sync`);
    }
    if (!existsSync(join(root, 'packages', name, 'README.md'))) problems.push(`packages/${name} has no README.md`);
    if (!existsSync(join(root, 'packages', name, want.main))) problems.push(`packages/${name}: main file ${want.main} does not exist`);
  }
  if (!existsSync(join(root, 'LICENSE'))) problems.push('LICENSE is missing');
  return problems;
}

/** Write every package.json. @returns {string[]} the packages that changed */
export function sync(root) {
  const changed = [];
  for (const [name, want] of generate(root)) {
    const file = join(root, 'packages', name, 'package.json');
    if (JSON.stringify(readJson(file)) !== JSON.stringify(want)) { writeJson(file, want); changed.push(name); }
  }
  return changed;
}

export function nextVersion(current, how) {
  if (/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(how)) return how;
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(current);
  if (!m) throw new Error(`cannot read the version "${current}"`);
  let [, a, b, c] = m.map(Number);
  if (how === 'major') { a++; b = 0; c = 0; } else if (how === 'minor') { b++; c = 0; } else if (how === 'patch') c++;
  else throw new Error(`say major, minor, patch or an exact version like 1.2.3 (got "${how}")`);
  return `${a}.${b}.${c}`;
}

/**
 * Set a new version everywhere and turn the changelog's "Unreleased" part into that version's entry.
 * @param {{date?: string}} [o] The release date (default: today); given so tests are exact.
 * @returns {{from: string, to: string, changelog: boolean}}
 */
export function bump(root, how, { date = new Date().toISOString().slice(0, 10) } = {}) {
  const rootFile = join(root, 'package.json');
  const pkg = readJson(rootFile), from = pkg.version, to = nextVersion(from, how);
  const logFile = join(root, 'CHANGELOG.md');
  let changelog = false;
  if (existsSync(logFile)) {
    const text = readFileSync(logFile, 'utf8');
    const start = text.search(/^## Unreleased[ \t]*\r?$/m);
    if (start < 0) throw new Error('CHANGELOG.md has no "## Unreleased" section to release (add what changed there first)');
    const afterHeading = text.indexOf('\n', start) + 1;
    const next = text.slice(afterHeading).search(/^## /m);
    const body = next < 0 ? text.slice(afterHeading) : text.slice(afterHeading, afterHeading + next);
    if (!body.trim()) throw new Error('the "Unreleased" section of CHANGELOG.md is empty: write what changed before releasing');
    writeFileSync(logFile, `${text.slice(0, start)}## Unreleased\n\n## ${to} — ${date}\n${text.slice(afterHeading)}`);
    changelog = true;
  }
  pkg.version = to; writeJson(rootFile, pkg);
  sync(root);
  return { from, to, changelog };
}

function walkJs(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) { const p = join(dir, e.name); if (e.isDirectory()) out.push(...walkJs(p)); else if (e.name.endsWith('.js')) out.push(p); }
  return out;
}

/**
 * Pack every package as npm would publish it: only what `files` says, plus the licence, with imports of other packages made by name,
 * checked for stray files.
 * @param {string} root @param {string} outDir where the .tgz files go
 * @returns {Promise<Array<{name: string, file: string, bytes: number, unpacked: number, files: number, problems: string[]}>>}
 */
export async function pack(root, outDir) {
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  mkdirSync(outDir, { recursive: true });
  const results = [];
  const stage = mkdtempSync(join(tmpdir(), 'engine-pack-'));
  try {
    for (const [name, pkg] of generate(root)) {
      const src = join(root, 'packages', name), dir = join(stage, name);
      mkdirSync(dir, { recursive: true });
      for (const item of ['src', 'README.md', ...(EXTRA_FILES[name] ?? [])]) if (existsSync(join(src, item))) cpSync(join(src, item), join(dir, item), { recursive: true });
      for (const f of walkJs(join(dir, 'src'))) {
        const rel = relative(dir, f).split(sep).join('/'), text = readFileSync(f, 'utf8'), out = rewriteImports(text, rel, name);
        if (out !== text) writeFileSync(f, out);
      }
      const api = join(root, 'docs', 'api', `${name}.md`);  // the generated reference for this package, as API.md (its link to the README made local)
      if (existsSync(api)) writeFileSync(join(dir, 'API.md'), readFileSync(api, 'utf8').replace(`(../../packages/${name}/README.md)`, '(README.md)'));
      cpSync(join(root, 'LICENSE'), join(dir, 'LICENSE'));
      if (existsSync(join(root, 'NOTICE'))) cpSync(join(root, 'NOTICE'), join(dir, 'NOTICE'));
      writeJson(join(dir, 'package.json'), pkg);
      const json = JSON.parse(npm(['pack', '--json', '--pack-destination', outDir, '--ignore-scripts'], { cwd: dir }));
      const info = json[0], problems = [];
      const paths = info.files.map((f) => f.path);
      for (const p of paths) if (!p.startsWith('templates/') && (/(^|\/)(test|tests|browser-test|bench)\//.test(p) || /\.test\.js$/.test(p))) problems.push(`ships a test file: ${p}`);
      for (const need of ['package.json', 'README.md', 'LICENSE', pkg.main]) if (!paths.includes(need)) problems.push(`is missing ${need}`);
      for (const [bin, target] of Object.entries(pkg.bin ?? {})) if (!paths.includes(target)) problems.push(`bin "${bin}" points at ${target}, which is not in the package`);
      results.push({ name, file: info.filename, bytes: info.size, unpacked: info.unpackedSize, files: paths.length, problems });
    }
  } finally { rmSync(stage, { recursive: true, force: true }); }
  return results;
}
