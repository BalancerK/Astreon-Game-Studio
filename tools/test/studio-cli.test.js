import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main, loadProject, checkProject, newProject, serveProject, CliError } from '../studio-cli.js';
import { TEMPLATES } from '../../studio/app/store/templates.js';
import { readZip } from '../../studio/app/store/zip.js';

const tmp = () => mkdtempSync(join(tmpdir(), 'studio-cli-'));
const run = async (...args) => {
  const lines = [];
  const code = await main(args, (l) => lines.push(l));
  return { code, text: lines.join('\n') };
};
const put = (dir, files) => {
  for (const [p, c] of Object.entries(files)) {
    mkdirSync(join(dir, p, '..'), { recursive: true });
    writeFileSync(join(dir, p), c);
  }
};
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 1, 2, 3]);

test('new makes a project folder from any starting game, refuses a folder that is not empty, and lists the games', async () => {
  const root = tmp();
  try {
    for (const name of Object.keys(TEMPLATES)) {
      const r = await run('new', join(root, name), '--template', name);
      assert.equal(r.code, 0, r.text);
      assert.ok(existsSync(join(root, name, 'src/main.js')));
    }
    const again = await run('new', join(root, 'hero'));
    assert.equal(again.code, 2);
    assert.match(again.text, /not empty/);
    assert.equal((await run('new', join(root, 'x'), '--template', 'nope')).code, 2);
    const list = await run('new', '--list');
    assert.ok(Object.keys(TEMPLATES).every((k) => list.text.includes(k)));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('reading a folder takes the same files the studio does: text and assets, not hidden folders or node_modules, not a fake picture', async () => {
  const root = tmp();
  try {
    put(root, {
      'src/main.js': 'export {}', '.git/config': 'no', 'node_modules/a/index.js': 'no', 'notes.md': 'n', 'logo.png': 'not in assets',
      'assets/fake.png': 'text pretending to be a picture',
    });
    writeFileSync(join(root, 'assets/hero.png'), PNG);
    const p = await loadProject(root);
    assert.deepEqual(Object.keys(p.files).sort(), ['assets/hero.png', 'notes.md', 'src/main.js']);
    assert.ok(p.files['assets/hero.png'] instanceof Uint8Array);
    assert.ok(p.skipped.some((s) => s.includes('fake.png')));
    await assert.rejects(loadProject(join(root, 'missing')), CliError);
    await assert.rejects(loadProject(join(root, 'src')), /no src\/main\.js/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('check passes for every starting game and says exactly what is wrong with a broken one', async () => {
  const root = tmp();
  try {
    for (const name of Object.keys(TEMPLATES)) {
      await newProject(join(root, name), name);
      const r = await checkProject(await loadProject(join(root, name)), { seconds: 4 });
      assert.deepEqual([r.ok, r.problems], [true, []], name);
      assert.equal(r.ticks, 240);
    }
    let n = 0;
    const broken = async (files) => {
      const d = join(root, `broken${n++}`);
      put(d, files);
      return checkProject(await loadProject(d), { seconds: 3 });
    };
    const syntax = await broken({ 'src/main.js': 'export function create( {' });
    assert.equal(syntax.ok, false);
    assert.match(syntax.problems[0], /could not be loaded/);
    const missing = await broken({ 'src/main.js': 'export function create() { return {}; }' });
    assert.match(missing.problems.join(' '), /update/);
    const crash = await broken({
      'src/main.js': 'export function create() { return { n: 0 }; }\nexport function update(g) { g.n++; if (g.n > 100) throw new Error("boom at " + g.n); }\nexport function render() {}',
    });
    assert.equal(crash.ok, false);
    assert.match(crash.problems[0], /after 100 ticks.*boom at 101/);
    const loopy = await broken({
      'src/main.js': 'export function create() { const g = {}; g.self = g; return g; }\nexport function update() {}\nexport function render() {}',
    });
    assert.equal(loopy.ok, true);
    assert.match(loopy.warnings.join(' '), /plain data/);
    const r = await run('check', join(root, 'hero'), '--seconds', '2');
    assert.equal(r.code, 0);
    assert.match(r.text, /OK: hero ran 120 ticks/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('build writes the game as web files (with the pictures), as a zip, and refuses to build into the project itself', async () => {
  const root = tmp();
  try {
    const game = join(root, 'frog');
    await newProject(game, 'hero');
    mkdirSync(join(game, 'assets'), { recursive: true });
    writeFileSync(join(game, 'assets/hero.png'), PNG);
    writeFileSync(join(game, 'project.json'), JSON.stringify({ title: 'Frog Hop', width: 360, height: 640 }));
    const out = join(root, 'site');
    const r = await run('build', game, '--out', out);
    assert.equal(r.code, 0, r.text);
    assert.match(r.text, /"Frog Hop": \d+ files/);
    const page = readFileSync(join(out, 'index.html'), 'utf8');
    assert.ok(page.includes('<title>Frog Hop</title>') && page.includes('360'));
    assert.ok(existsSync(join(out, 'game/src/main.js')) && existsSync(join(out, 'runtime.js')) && existsSync(join(out, 'sw.js')));
    assert.deepEqual([...readFileSync(join(out, 'game/assets/hero.png'))], [...PNG]);
    assert.ok(readdirSync(join(out, 'engine')).length > 0);
    assert.ok(!readFileSync(join(out, 'game/src/main.js'), 'utf8').includes('@engine/'), 'engine imports are rewritten to files that exist');
    const plain = await run('build', game, '--out', join(root, 'plain'), '--no-offline');
    assert.equal(plain.code, 0);
    assert.ok(!existsSync(join(root, 'plain/sw.js')));
    const zipPath = join(root, 'out', 'frog.zip');
    assert.equal((await run('build', game, '--zip', zipPath)).code, 0);
    const zip = await readZip(new Uint8Array(readFileSync(zipPath)));
    assert.ok(zip.has('index.html') && zip.has('game/src/main.js'));
    const inside = await run('build', game, '--out', join(game, 'dist'));
    assert.equal(inside.code, 2);
    assert.match(inside.text, /outside the project/);
    const tooBig = await run('build', game, '--out', join(root, 'big'), '--max-kb', '1');
    assert.equal(tooBig.code, 1);
    assert.match(tooBig.text, /TOO BIG/);
    assert.equal((await run('build', join(root, 'nothing'))).code, 2);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('serve shows the built game, notices a change, shows an error page for a broken project, and recovers', async () => {
  const root = tmp();
  let server;
  try {
    const game = join(root, 'g');
    await newProject(game, 'bounce');
    const started = await serveProject(game, { port: 0 });
    server = started.server;
    const get = async (p) => {
      const r = await fetch(started.url + p);
      return { status: r.status, text: await r.text(), type: r.headers.get('content-type') };
    };
    const index = await get('');
    assert.equal(index.status, 200);
    assert.match(index.type, /text\/html/);
    assert.ok(index.text.includes('/__version'), 'the page reloads itself when a file changes');
    assert.equal((await get('game/src/main.js')).status, 200);
    assert.equal((await get('nothing.js')).status, 404);
    const v1 = (await get('__version')).text;
    assert.equal((await get('__version')).text, v1, 'nothing changed, same version');
    await new Promise((r) => setTimeout(r, 30));
    const mainPath = join(game, 'src/main.js');
    const original = readFileSync(mainPath, 'utf8');
    writeFileSync(mainPath, `${original}\n// edited\n`);
    const v2 = (await get('__version')).text;
    assert.notEqual(v2, v1);
    assert.ok((await get('game/src/main.js')).text.includes('// edited'));
    rmSync(mainPath);
    const gone = await get('');
    assert.equal(gone.status, 500);
    assert.match(gone.text, /no src\/main\.js/);
    writeFileSync(mainPath, original);
    assert.equal((await get('')).status, 200);
  } finally {
    server?.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('help is printed with no command, and an unknown command is refused', async () => {
  assert.equal((await run()).code, 0);
  assert.match((await run('help')).text, /serve <folder>/);
  const bad = await run('dance', 'x');
  assert.equal(bad.code, 2);
});
