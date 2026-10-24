import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { check, generate, sync, bump, nextVersion, rewriteImports, readDescriptions, packageNames } from '../release-lib.js';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));

test('the packages\' package.json files match what the code really imports (npm test keeps them in sync)', () => {
  assert.deepEqual(check(ROOT), []);
  const all = generate(ROOT);
  assert.equal(all.size, packageNames(ROOT).length);
  const render = all.get('render');
  assert.equal(render.name, '@engine/render'); assert.deepEqual(Object.keys(render.dependencies), ['@engine/math']);
  assert.deepEqual(Object.keys(all.get('math').dependencies ?? {}), []);
  assert.ok(Object.keys(all.get('editor').dependencies).includes('@engine/scene'), 'editor needs the scene package');
  for (const [name, p] of all) {
    assert.equal(p.version, all.get('core').version); assert.equal(p.license, 'Apache-2.0'); assert.equal(p.main, 'src/index.js');
    assert.ok(p.description.length > 15, `${name} has a description`);
    assert.ok(p.files.includes('src') && p.files.includes('LICENSE'));
    for (const [d, range] of Object.entries(p.dependencies ?? {})) assert.equal(range, `^${p.version}`, `${name} -> ${d}`);
  }
  assert.ok('create-game' in { 'create-game': all.get('create-game').bin }); assert.deepEqual(Object.keys(all.get('create-game').bin), ['create-game']); assert.ok(all.get('create-game').files.includes('templates'));
  assert.deepEqual(Object.keys(all.get('build').bin), ['engine-build']);
});

test('descriptions come from the README table', () => {
  const d = readDescriptions(ROOT);
  assert.match(d.core, /^Fixed-timestep loop, typed-array ECS/); assert.ok(!d.core.endsWith('.')); assert.ok(!/[`\[\]]/.test(d.mods));
  assert.ok(d['create-game'].startsWith('npx create-game my-game'));
});

test('imports of other packages are made by name for publishing, and imports inside a package are left alone', () => {
  const src = [
    "import { mat4 } from '../../../math/src/index.js';",
    "import { Camera3D } from '../../../render/src/index.js';",
    "export { x } from '../../../prefab/src/library.js';",
    "import { local } from './util.js';",
    "import { up } from '../shared/up.js';",
    "const m = await import('../../../assets/src/index.js');",
  ].join('\n');
  const out = rewriteImports(src, 'src/app/app.js', 'editor');
  assert.match(out, /import \{ mat4 \} from '@engine\/math';/);
  assert.match(out, /from '@engine\/render';/, 'three levels up from src/app/ is the folder of packages');
  assert.match(out, /export \{ x \} from '@engine\/prefab\/src\/library\.js';/, 'deep paths keep the rest');
  assert.match(out, /import \{ local \} from '\.\/util\.js';/); assert.match(out, /from '\.\.\/shared\/up\.js';/);
  assert.match(out, /import\('@engine\/assets'\)/);
  const flat = rewriteImports("import { a } from '../../math/src/index.js';", 'src/index.js', 'render');
  assert.equal(flat, "import { a } from '@engine/math';", 'from src/index.js, ../../ is the folder of packages');
  assert.equal(rewriteImports("import { a } from '../../math/src/index.js';", 'src/sub/x.js', 'render'), "import { a } from '../../math/src/index.js';", 'one level deeper it is inside the package');
  assert.equal(rewriteImports("import { a } from '../../../../x/y.js';", 'src/a/b.js', 'render'), "import { a } from '../../../../x/y.js';", 'outside the packages folder: not ours');
});

test('versions: the next one, exact ones, mistakes', () => {
  assert.equal(nextVersion('0.1.0', 'patch'), '0.1.1'); assert.equal(nextVersion('0.1.9', 'minor'), '0.2.0'); assert.equal(nextVersion('1.2.3', 'major'), '2.0.0'); assert.equal(nextVersion('0.1.0', '3.4.5'), '3.4.5'); assert.equal(nextVersion('0.1.0', '1.0.0-rc.1'), '1.0.0-rc.1');
  assert.throws(() => nextVersion('0.1.0', 'huge'), /say major, minor, patch/);
});

/** A copy of the repo's package metadata, enough to run sync and bump on. */
function miniRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'release-'));
  for (const f of ['README.md', 'LICENSE', 'package.json']) cpSync(join(ROOT, f), join(dir, f));
  mkdirSync(join(dir, 'packages'));
  for (const name of ['math', 'core', 'render']) {
    mkdirSync(join(dir, 'packages', name, 'src'), { recursive: true });
    cpSync(join(ROOT, 'packages', name, 'package.json'), join(dir, 'packages', name, 'package.json'));
    cpSync(join(ROOT, 'packages', name, 'README.md'), join(dir, 'packages', name, 'README.md'));
    writeFileSync(join(dir, 'packages', name, 'src', 'index.js'), name === 'render' ? "import './../../math/src/index.js';\nexport const r = 1;\n" : 'export const x = 1;\n');
  }
  return dir;
}

test('bump sets one version everywhere, updates the dependency ranges and the changelog, and refuses an empty changelog', () => {
  const dir = miniRepo();
  try {
    writeFileSync(join(dir, 'CHANGELOG.md'), '# Changelog\n\n## Unreleased\n\n## 0.1.0 — 2026-10-12\n\n- first\n');
    assert.throws(() => bump(dir, 'patch', { date: '2026-11-01' }), /"Unreleased" section of CHANGELOG.md is empty/);
    writeFileSync(join(dir, 'CHANGELOG.md'), '# Changelog\n\n## Unreleased\n\n- Fixed the thing.\n\n## 0.1.0 — 2026-10-12\n\n- first\n');
    const r = bump(dir, 'minor', { date: '2026-11-01' });
    assert.deepEqual([r.from, r.to, r.changelog], ['0.1.0', '0.2.0', true]);
    assert.equal(JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).version, '0.2.0');
    const render = JSON.parse(readFileSync(join(dir, 'packages/render/package.json'), 'utf8'));
    assert.equal(render.version, '0.2.0'); assert.equal(render.dependencies['@engine/math'], '^0.2.0');
    const log = readFileSync(join(dir, 'CHANGELOG.md'), 'utf8');
    assert.match(log, /## Unreleased\n\n## 0\.2\.0 — 2026-11-01\n\n- Fixed the thing\.\n\n## 0\.1\.0 — 2026-10-12/);
    assert.deepEqual(check(dir), []);
    assert.deepEqual(sync(dir), [], 'a second sync has nothing to do');
    writeFileSync(join(dir, 'CHANGELOG.md'), '# Changelog\n');
    assert.throws(() => bump(dir, 'patch'), /no "## Unreleased" section/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('check notices drift: a stale dependency, a missing README, a missing entry file', () => {
  const dir = miniRepo();
  try {
    sync(dir);
    const file = join(dir, 'packages/render/package.json'), pkg = JSON.parse(readFileSync(file, 'utf8'));
    delete pkg.dependencies; writeFileSync(file, JSON.stringify(pkg));
    rmSync(join(dir, 'packages/core/README.md')); rmSync(join(dir, 'packages/math/src/index.js'));
    const problems = check(dir).join('\n');
    assert.match(problems, /packages\/render\/package\.json is out of date \(dependencies\)/);
    assert.match(problems, /packages\/core has no README\.md/); assert.match(problems, /packages\/math: main file src\/index\.js does not exist/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
