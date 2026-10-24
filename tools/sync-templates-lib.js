// Some `create-game` templates are generated from a working example in this repository, so there is one copy of the code and it is tested here.
// The example imports engine files by relative path (`../../../packages/turns/src/index.js`); in a project they are packages (`@engine/turns`).
// This copies the example's files into the template and rewrites those imports. `npm test` fails if the template has drifted from the example.
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { join, dirname, resolve, relative, sep, posix } from 'node:path';

/** @type {Array<{name: string, example: string, copy: string[], description: string, scripts: Record<string, string>}>} */
export const TEMPLATES = [
  {
    name: 'multiplayer', example: 'examples/crazy-eights', copy: ['index.html', 'src', 'server', 'test'],
    description: 'A multiplayer card game, complete: rules as pure functions, a server with guest accounts, matchmaking, private tables with join codes, ratings and a leaderboard, bots that fill empty seats, and the browser client.',
    scripts: { dev: 'node server/main.js', start: 'node server/main.js --data data', build: 'engine-build build', 'start:built': 'node server/main.js --root dist --data data' },
  },
];

/** The engine package (and entry) a relative import resolves to, or null if it is not one. */
function enginePackageOf(abs, root) {
  const rel = relative(join(root, 'packages'), abs).split(sep).join('/');
  const m = /^([a-z0-9-]+)\/src\/(index|node)\.js$/.exec(rel);
  return m ? { name: m[1], entry: m[2] } : null;
}

/**
 * Rewrite one file's imports of engine files to package names.
 * @param {string} source @param {string} file Absolute path of the file in the example. @param {string} root The repository. @param {string} exampleRoot
 * @returns {{text: string, packages: Set<string>}}
 */
export function rewriteForTemplate(source, file, root, exampleRoot) {
  const packages = new Set();
  const re = /(\bfrom\s*|\bimport\s*\(?\s*)(['"])(\.{1,2}\/[^'"\n]+)\2/g;
  const text = source.replace(re, (m, head, q, spec) => {
    const abs = resolve(dirname(file), spec);
    const pkg = enginePackageOf(abs, root);
    if (pkg) { packages.add(pkg.name); return `${head}${q}@engine/${pkg.name}${pkg.entry === 'node' ? '/src/node.js' : ''}${q}`; }
    if (abs.startsWith(exampleRoot + sep)) return m;               // inside the example: the same relative path works in the project
    throw new Error(`${relative(root, file)}: "${spec}" points outside the example and is not an engine package entry, so it cannot be put in a template`);
  });
  return { text, packages };
}

function* walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p); else yield p;
  }
}

/** Everything a template should contain that comes from its example. @returns {{files: Map<string, string>, packages: string[]}} paths relative to `files/` */
export function generate(root, t) {
  const exRoot = resolve(root, t.example), files = new Map(), packages = new Set(['build']);
  for (const item of t.copy) {
    const abs = join(exRoot, item);
    if (!existsSync(abs)) throw new Error(`${t.example}/${item} does not exist`);
    const list = statSync(abs).isDirectory() ? [...walk(abs)] : [abs];
    for (const f of list) {
      const rel = relative(exRoot, f).split(sep).join('/');
      const raw = readFileSync(f, 'utf8');
      if (f.endsWith('.js')) { const r = rewriteForTemplate(raw, f, root, exRoot); files.set(rel, r.text); r.packages.forEach((p) => packages.add(p)); }
      else files.set(rel, raw);
    }
  }
  return { files, packages: [...packages].sort() };
}

const tjson = (t, packages) => `${JSON.stringify({ description: t.description, engine: packages, scripts: t.scripts }, null, 2)}\n`;

/** Write the generated files and `template.json`. @returns {string[]} the files written */
export function sync(root, templates = TEMPLATES) {
  const written = [];
  for (const t of templates) {
    const dir = join(root, 'packages', 'create-game', 'templates', t.name);
    const { files, packages } = generate(root, t);
    for (const [rel, text] of files) { const p = join(dir, 'files', rel); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, text); written.push(`${t.name}/files/${rel}`); }
    writeFileSync(join(dir, 'template.json'), tjson(t, packages)); written.push(`${t.name}/template.json`);
  }
  return written;
}

/** Compare the template with what the example would generate. @returns {string[]} what differs or is missing (and stale generated files) */
export function check(root, templates = TEMPLATES) {
  const problems = [];
  for (const t of templates) {
    const dir = join(root, 'packages', 'create-game', 'templates', t.name);
    const { files, packages } = generate(root, t);
    for (const [rel, text] of files) { const p = join(dir, 'files', rel); if (!existsSync(p) || readFileSync(p, 'utf8') !== text) problems.push(`${t.name}/files/${rel} differs from ${t.example}/${rel}`); }
    const tj = join(dir, 'template.json');
    if (!existsSync(tj) || readFileSync(tj, 'utf8') !== tjson(t, packages)) problems.push(`${t.name}/template.json is out of date`);
    // files in the generated folders that the example no longer has
    for (const item of t.copy) {
      const base = join(dir, 'files', item);
      if (existsSync(base) && statSync(base).isDirectory()) for (const f of walk(base)) { const rel = relative(join(dir, 'files'), f).split(sep).join('/'); if (!files.has(rel)) problems.push(`${t.name}/files/${rel} is not in ${t.example} any more`); }
    }
  }
  return problems;
}
