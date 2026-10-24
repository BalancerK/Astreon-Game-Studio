import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync, rmSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createProject, listTemplates, checkName, titleOf } from '../src/index.js';

const ENGINE = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const temp = () => mkdtempSync(join(tmpdir(), 'create-game-'));
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

test('the templates are listed with a description and the packages they use', () => {
  const t = listTemplates();
  assert.deepEqual(t.map((x) => x.name), ['2d', '3d', 'multiplayer']);
  for (const x of t) { assert.ok(x.description.length > 20); assert.ok(x.engine.includes('build')); }
});

test('names are checked and made into titles', () => {
  assert.equal(checkName('my-game'), null); assert.equal(checkName('game2.0_x'), null);
  for (const bad of ['', undefined, 'My Game', '../x', '-x', 'UPPER', 'a'.repeat(80)]) assert.ok(checkName(bad), String(bad));
  assert.equal(titleOf('my-cool_game'), 'My Cool Game');
});

test('a project is made from a template: files, names filled in, a package.json with the right dependencies', () => {
  const root = temp();
  try {
    const dir = join(root, 'coin-run');
    const r = createProject({ dir, template: '2d' });
    assert.ok(r.files.includes('package.json') && r.files.includes('.gitignore') && r.files.includes('src/game.js') && r.files.includes('test/game.test.js'), r.files.join());
    assert.ok(!r.files.includes('_gitignore'));
    const pkg = readJson(join(dir, 'package.json'));
    assert.equal(pkg.name, 'coin-run'); assert.equal(pkg.type, 'module'); assert.equal(pkg.private, true);
    assert.deepEqual(Object.keys(pkg.dependencies), ['@engine/build', '@engine/core', '@engine/input', '@engine/render', '@engine/save']);
    assert.match(pkg.dependencies['@engine/core'], /^\^0\.\d+\.\d+$/, 'from the registry by default');
    assert.equal(pkg.scripts.dev, 'engine-build dev'); assert.equal(pkg.scripts.build, 'engine-build build'); assert.equal(pkg.scripts.test, 'node --test');
    const html = readFileSync(join(dir, 'index.html'), 'utf8');
    assert.ok(html.includes('<title>Coin Run</title>') && !html.includes('{{'));
    assert.ok(readFileSync(join(dir, 'src/main.js'), 'utf8').includes("game: 'coin-run'"));
    for (const f of r.files) if (/\.(js|json|md|html)$/.test(f)) assert.ok(!/\{\{(name|title)\}\}/.test(readFileSync(join(dir, f), 'utf8')), `${f} has an unfilled placeholder`);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('with an engine checkout, dependencies are file: links and include what the packages need in turn', () => {
  const root = temp();
  try {
    const dir = join(root, 'g3');
    const { dependencies } = createProject({ dir, template: '3d', enginePath: ENGINE });
    for (const n of ['core', 'math', 'render', 'prefab', 'scene', 'assets', 'editor', 'build']) assert.ok(`@engine/${n}` in dependencies, n);
    for (const [n, spec] of Object.entries(dependencies)) {
      assert.match(spec, /^file:.*packages\/[a-z-]+$/, `${n}: ${spec}`);
      assert.ok(existsSync(resolve(dir, spec.slice(5), 'package.json')), `${n} points at a real package`);
    }
    assert.ok(existsSync(join(dir, 'scenes/main.json')) && existsSync(join(dir, 'editor.html')));
    assert.deepEqual(readJson(join(dir, 'engine.config.json')).writable, [{ route: '/__scenes', dir: 'scenes', ext: '.json' }]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('it refuses what it should: bad names, unknown templates, folders that are not empty', () => {
  const root = temp();
  try {
    assert.throws(() => createProject({ dir: join(root, 'x'), name: 'Bad Name' }), /not a usable name/);
    assert.throws(() => createProject({ dir: join(root, 'x'), template: 'nope' }), /no template "nope" \(available: 2d, 3d, multiplayer\)/);
    mkdirSync(join(root, 'full')); writeFileSync(join(root, 'full', 'keep.txt'), 'mine');
    assert.throws(() => createProject({ dir: join(root, 'full') }), /already exists and is not empty/);
    assert.equal(readFileSync(join(root, 'full', 'keep.txt'), 'utf8'), 'mine');
    mkdirSync(join(root, 'empty')); createProject({ dir: join(root, 'empty'), name: 'ok' });
    assert.throws(() => createProject({ dir: join(root, 'y'), enginePath: join(root, 'no-engine') }), /has no package/);
    assert.ok(!existsSync(join(root, 'no-engine')));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('the command line makes a project and explains mistakes', () => {
  const root = temp();
  const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));
  const run = (args) => { try { return { out: execFileSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8', stdio: 'pipe' }), code: 0 }; } catch (e) { return { out: `${e.stdout}${e.stderr}`, code: e.status }; } };
  try {
    assert.match(run(['--list']).out, /2d {7}Top-down 2D[\s\S]*3d {7}3D scenes as data/);
    const ok = run(['my-game', '--template', '3d', '--no-install', '--engine-path', ENGINE]);
    assert.equal(ok.code, 0, ok.out); assert.match(ok.out, /npm install[\s\S]*npm run dev[\s\S]*editor\.html/);
    assert.ok(existsSync(join(root, 'my-game', 'scenes', 'main.json')));
    const nested = run(['sub/folder/other-game', '--no-install', '--engine-path', ENGINE]); assert.equal(nested.code, 0, nested.out);
    assert.equal(readJson(join(root, 'sub', 'folder', 'other-game', 'package.json')).name, 'other-game', 'a path makes the project there, named after its folder');
    const again = run(['my-game', '--no-install']); assert.equal(again.code, 1); assert.match(again.out, /not empty/);
    assert.match(run([]).out, /give the game a name/); assert.match(run(['x', '--template', 'zzz', '--no-install']).out, /no template "zzz"/);
    assert.deepEqual(readdirSync(root).sort(), ['my-game', 'sub']);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
