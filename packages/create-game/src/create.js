// Making a new game project from a template.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname, relative, resolve, sep, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const TEMPLATES = join(HERE, '..', 'templates');
const OWN_VERSION = JSON.parse(readFileSync(join(HERE, '..', 'package.json'), 'utf8')).version;
const TEXT = new Set(['.js', '.json', '.md', '.html', '.css', '.txt', '']);

/**
 * The available templates: `{ name, description, engine }` each, where `engine` lists the engine packages it uses.
 *
 * @returns {Array<{name: string, description: string, engine: string[]}>}
 */
export function listTemplates() {
  return readdirSync(TEMPLATES).filter((n) => existsSync(join(TEMPLATES, n, 'template.json'))).sort().map((name) => {
    const t = JSON.parse(readFileSync(join(TEMPLATES, name, 'template.json'), 'utf8'));
    return { name, description: t.description, engine: t.engine };
  });
}

/** A name that works as an npm package name and a folder. */
export function checkName(name) {
  if (!name) return 'give the game a name: create-game my-game';
  if (!/^[a-z0-9][a-z0-9._-]{0,60}$/.test(name)) return `"${name}" is not a usable name: use lowercase letters, digits, - . _ (start with a letter or digit)`;
  return null;
}

/** "my-cool-game" -> "My Cool Game" */
export const titleOf = (name) => name.split(/[-_.]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');

/** The engine packages a template needs and everything those need in turn, from an engine checkout (`file:` installs do not follow dependencies by themselves). */
function closure(enginePath, names) {
  const seen = new Set(), todo = [...names];
  while (todo.length) {
    const n = todo.pop();
    if (seen.has(n)) continue;
    seen.add(n);
    const file = join(enginePath, 'packages', n, 'package.json');
    if (!existsSync(file)) throw new Error(`the engine checkout at ${enginePath} has no package "${n}"`);
    for (const d of Object.keys(JSON.parse(readFileSync(file, 'utf8')).dependencies ?? {})) todo.push(d.replace('@engine/', ''));
  }
  return [...seen].sort();
}

function* walk(dir, base = dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p, base); else yield relative(base, p).split(sep).join('/');
  }
}

/** Run npm without a shell (paths with spaces survive). */
export function runNpm(args, cwd, stdio = 'inherit') {
  const cli = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  if (existsSync(cli)) return execFileSync(process.execPath, [cli, ...args], { cwd, stdio });
  return execFileSync('npm', args, { cwd, stdio, shell: process.platform === 'win32' });
}

/**
 * Make a new game project from a template: copies the template files (filling in the name), writes a `package.json` with the
 * engine packages it needs, and optionally runs `npm install`.
 *
 * @param {object} o
 * @param {string} o.dir Where to make the project (made if needed; must be empty if it exists).
 * @param {string} [o.name] Package name (default: the folder name).
 * @param {string} [o.template] '2d' or '3d'.
 * @param {string} [o.enginePath] A checkout of the engine to link instead of installing from npm (`file:` dependencies).
 * @param {boolean} [o.install] Run `npm install` afterwards.
 * @param {(msg: string) => void} [o.log]
 * @returns {{dir: string, files: string[], dependencies: Record<string, string>}}
 */
export function createProject({ dir, name, template = '2d', enginePath, install = false, log = () => {} }) {
  const target = resolve(dir);
  name ??= target.split(sep).pop();
  const bad = checkName(name);
  if (bad) throw new Error(bad);
  const t = listTemplates().find((x) => x.name === template);
  if (!t) throw new Error(`there is no template "${template}" (available: ${listTemplates().map((x) => x.name).join(', ')})`);
  if (existsSync(target) && (!statSync(target).isDirectory() || readdirSync(target).length)) throw new Error(`${target} already exists and is not empty`);
  mkdirSync(target, { recursive: true });

  const spec = JSON.parse(readFileSync(join(TEMPLATES, template, 'template.json'), 'utf8'));
  const filesDir = join(TEMPLATES, template, 'files');
  const files = [];
  for (const rel of walk(filesDir)) {
    const out = rel.split('/').map((s) => (s === '_gitignore' ? '.gitignore' : s)).join('/');
    const dest = join(target, out);
    mkdirSync(dirname(dest), { recursive: true });
    const raw = readFileSync(join(filesDir, rel));
    writeFileSync(dest, TEXT.has(extname(rel)) || rel.endsWith('_gitignore') ? raw.toString('utf8').replaceAll('{{name}}', name).replaceAll('{{title}}', titleOf(name)) : raw);
    files.push(out);
  }

  const engine = enginePath ? closure(resolve(enginePath), spec.engine) : [...spec.engine].sort();
  const dependencies = Object.fromEntries(engine.map((n) => [`@engine/${n}`, enginePath ? `file:${relative(target, join(resolve(enginePath), 'packages', n)).split(sep).join('/')}` : `^${OWN_VERSION}`]));
  const pkg = {
    name, version: '0.1.0', private: true, type: 'module', description: `${titleOf(name)}, made with the engine`,
    scripts: { dev: 'engine-build dev', build: 'engine-build build', test: 'node --test', ...(spec.scripts ?? {}) },
    dependencies,
  };
  writeFileSync(join(target, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`);
  files.push('package.json');
  log(`created ${files.length} files in ${target}`);
  if (install) { log('installing…'); runNpm(['install', '--no-audit', '--no-fund'], target, 'inherit'); }
  return { dir: target, files: files.sort(), dependencies };
}
