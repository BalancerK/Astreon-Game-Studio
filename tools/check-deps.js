// Enforces package boundaries with zero dependencies. Run: node tools/check-deps.js [--graph]
//
// Rules (default deny):
//  1. A package may only import packages listed for it in ALLOWED.
//  2. Imports of another package go through its public entry (`src/index.js`,
//     the Node-only `src/node.js`, or the `@engine/<name>` specifier), never deep paths or `internal/`.
//  3. No external (npm) dependencies in package source; Node built-ins are fine.
//  4. Every package must have an entry in ALLOWED (so new packages are a conscious decision).
// Only `src/` is scanned: tests and benchmarks may import any package.
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { join, resolve, relative, sep, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/** package -> packages it may depend on */
export const ALLOWED = {
  core: [],
  protocol: [],
  math: [],
  arcade: [],
  physics: ['core', 'math'],
  transport: ['core', 'protocol'],
  server: ['core', 'protocol', 'transport', 'physics', 'math'],
  client: ['core', 'protocol', 'transport', 'physics', 'math'],
  debug: ['core', 'protocol', 'transport'],
  mods: ['core'],
  render: ['core', 'math'],
  skeleton2d: ['render'],
  audio: [],
  ui: [],
  particles: [],
  ai: ['math', 'physics'],
  prefab: ['core', 'math'],
  fsm: [],
  tween: ['math'],
  i18n: [],
  replay: ['protocol'],
  save: [],
  assets: [],
  build: [],
  testkit: ['build'],
  match: ['math'],
  camera: [],
  hud: [],
  relay: ['client'],
  matchmaking: [],
  persist: [],
  turns: ['matchmaking', 'transport'],
  'create-game': [],
  editor: ['math', 'scene', 'prefab', 'assets', 'render'],
  scene: [],
  input: [],
  tools: ['core', 'protocol', 'transport', 'physics', 'server', 'client', 'render', 'math'],
};

const IMPORT_RE = /(?:^|[\s;}])(?:import|export)\s[^'"`;]*?from\s*['"]([^'"]+)['"]|(?:^|[\s;}(])import\s*['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (p.endsWith('.js')) yield p;
  }
}

/** Strip comments so commented-out imports don't count. */
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

/**
 * @param {string} root Repo root containing `packages/`.
 * @returns {{errors: string[], edges: Map<string, Set<string>>}}
 */
export function checkDeps(root) {
  const pkgRoot = join(root, 'packages');
  const errors = [];
  const edges = new Map();
  const packages = readdirSync(pkgRoot).filter((n) => statSync(join(pkgRoot, n)).isDirectory());
  const builtins = new Set(builtinModules);

  for (const pkg of packages) {
    edges.set(pkg, new Set());
    if (!(pkg in ALLOWED)) {
      errors.push(`packages/${pkg}: no entry in ALLOWED (tools/check-deps.js); add one to declare what it may depend on`);
      continue;
    }
    const src = join(pkgRoot, pkg, 'src');
    if (!existsSync(src)) continue;
    for (const file of walk(src)) {
      const where = relative(root, file).split(sep).join('/');
      const text = stripComments(readFileSync(file, 'utf8'));
      for (const m of text.matchAll(IMPORT_RE)) {
        const spec = m[1] ?? m[2] ?? m[3];
        let target = null;
        if (spec.startsWith('.')) {
          const abs = resolve(dirname(file), spec);
          const rel = relative(pkgRoot, abs).split(sep);
          if (rel[0] === '..') { errors.push(`${where}: "${spec}" escapes packages/`); continue; }
          if (rel[0] === pkg) continue; // inside own package
          target = rel[0];
          const isEntry = rel.length === 3 && rel[1] === 'src' && /^(index|node)(\.js)?$/.test(rel[2]); // the main entry, or the Node-only entry
          if (!isEntry) errors.push(`${where}: deep import "${spec}" into ${target}; import its public entry instead`);
        } else if (spec.startsWith('@engine/')) {
          const [name, ...deep] = spec.slice('@engine/'.length).split('/');
          target = name;
          if (name === pkg) continue;
          const entryDeep = deep.length === 2 && deep[0] === 'src' && /^(index|node)\.js$/.test(deep[1]);
          if (deep.length > 0 && !entryDeep) errors.push(`${where}: deep import "${spec}"; import "@engine/${name}" instead`);
        } else if (spec.startsWith('node:') || builtins.has(spec)) {
          continue;
        } else {
          errors.push(`${where}: external dependency "${spec}" is not allowed in engine packages`);
          continue;
        }
        if (!packages.includes(target)) { errors.push(`${where}: imports unknown package "${target}"`); continue; }
        edges.get(pkg).add(target);
        if (!ALLOWED[pkg].includes(target)) {
          errors.push(`${where}: package "${pkg}" may not depend on "${target}" (allowed: ${ALLOWED[pkg].join(', ') || 'nothing'})`);
        }
      }
    }
  }
  return { errors, edges };
}

/** Mermaid graph of actual dependencies. */
export function toMermaid(edges) {
  const lines = ['graph LR'];
  for (const [pkg, deps] of edges) {
    if (deps.size === 0) lines.push(`  ${pkg}`);
    for (const d of deps) lines.push(`  ${pkg} --> ${d}`);
  }
  return lines.join('\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const { errors, edges } = checkDeps(root);
  if (process.argv.includes('--graph')) console.log(toMermaid(edges));
  if (errors.length > 0) {
    console.error(`Dependency check failed (${errors.length}):\n` + errors.map((e) => `  - ${e}`).join('\n'));
    process.exit(1);
  }
  if (!process.argv.includes('--graph')) console.log(`Dependency check passed (${edges.size} packages).`);
}
