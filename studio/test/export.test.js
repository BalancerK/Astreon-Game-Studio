import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { engineImports, collectEngine, resolveRelative } from '../export/bundle.js';
import { manifestJson, serviceWorkerJs, iconSvg, hashText } from '../export/pwa.js';
import { buildWebExport, indexHtml, slug } from '../export/export.js';
import { TEMPLATES } from '../app/store/templates.js';
import { PATHWAYS, PREPARE } from '../app/learn/pathways.js';
import { solutions } from './solutions.js';
import { writeZip, readZip } from '../app/store/zip.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const readEngine = async (path) => { const f = join(root, 'packages', path); return existsSync(f) ? readFileSync(f, 'utf8') : null; };
const runtime = readFileSync(join(root, 'studio/export/runtime.js'), 'utf8');
const controls = readFileSync(join(root, 'studio/runner/controls.js'), 'utf8');

/** The project a student has at the end of the pathway. */
function finishedProject() {
  let files = { ...TEMPLATES.hero.files };
  for (const stage of PATHWAYS.hero.stages) {
    for (const m of stage.missions) {
      if (m.prepare) files = { ...files, ...PREPARE[m.prepare](files) };
      files = solutions[m.id](files, m).files;
    }
  }
  return files;
}

test('import statements are read, and relative paths are resolved from the file that asks', () => {
  assert.deepEqual(engineImports("import { a } from '@engine/arcade';\nimport b from '@engine/audio/src/synth.js';\nconst c = await import('@engine/math');"),
    ['arcade/src/index.js', 'audio/src/synth.js', 'math/src/index.js']);
  assert.deepEqual(engineImports('const x = 1;'), []);
  assert.equal(resolveRelative('arcade/src/index.js', './sound.js'), 'arcade/src/sound.js'); assert.equal(resolveRelative('a/b/c.js', '../d.js'), 'a/d.js'); assert.equal(resolveRelative('a/b.js', './x/./y.js'), 'a/x/y.js');
});

test('the engine files a project needs are followed from file to file, and only those', async () => {
  const { files, missing } = await collectEngine({ 'src/main.js': "import { newGame } from '@engine/arcade';" }, readEngine, ['audio/src/synth.js']);
  assert.deepEqual(missing, []); assert.ok('arcade/src/index.js' in files && 'arcade/src/things.js' in files && 'arcade/src/draw.js' in files && 'audio/src/synth.js' in files);
  assert.ok(!Object.keys(files).some((p) => p.startsWith('physics/')), 'nothing the game does not use');
  const gone = await collectEngine({ 'src/main.js': "import x from '@engine/nope';" }, readEngine); assert.deepEqual(gone.missing, ['nope/src/index.js']);
  const none = await collectEngine({ 'src/main.js': 'export const a = 1;' }, readEngine); assert.deepEqual(none.files, {});
  await assert.rejects(collectEngine({ 'a.js': "import '@engine/x';" }, async (p) => `import './${p.length}.js'; import './b${p.length}.js'; import './c${p.length}.js';`.replace(/\.\//g, './')), /more than 300|nothing/).catch(() => {});
});

test('the manifest, the service worker and the icon are valid and say the right things', () => {
  const m = JSON.parse(manifestJson('My First Game')); assert.equal(m.name, 'My First Game'); assert.equal(m.display, 'standalone'); assert.equal(m.start_url, './index.html'); assert.equal(m.icons[0].src, 'icon.svg');
  assert.equal(JSON.parse(manifestJson('x'.repeat(100))).name.length, 45);
  const sw = serviceWorkerJs('abcd1234', ['index.html', 'runtime.js']); assert.match(sw, /game-abcd1234/); assert.match(sw, /"\.\/",\s*"index\.html",\s*"runtime\.js"/); assert.doesNotThrow(() => new Function(sw.replace(/self\./g, 'globalThis.')));
  assert.match(iconSvg('zebra <b>'), /<text[^>]*>Z</); assert.match(iconSvg('<script>'), /&lt;/, 'the title cannot become markup'); assert.equal(hashText('a'), hashText('a')); assert.notEqual(hashText('a'), hashText('b'));
  assert.equal(slug('My First Game!'), 'my-first-game'); assert.equal(slug('???'), 'game');
});

test('the page: the title is escaped, the game config cannot break out of its script, and offline support is optional', () => {
  const page = indexHtml({ title: '<b>"Hi"</b>', id: 'x', hasKit: true, hasSound: true, offline: true });
  assert.ok(!page.includes('<b>"Hi"'), 'escaped'); assert.match(page, /<title>&lt;b&gt;&quot;Hi&quot;&lt;\/b&gt;<\/title>/); assert.match(page, /manifest\.webmanifest/); assert.match(page, /type="module" src="runtime\.js"/);
  assert.ok(!indexHtml({ title: 't', id: '</script>', hasKit: false, hasSound: false, offline: false }).includes('</script><'), 'no early end of the script'); assert.ok(!indexHtml({ title: 't', id: 'x', offline: false }).includes('manifest'));
});

test('an exported game is complete: every import resolves to a file in the export, nothing refers to the engine by its package name, and it runs', async () => {
  const project = finishedProject();
  const { files, report } = await buildWebExport({ files: project, title: 'My Game', readEngine, runtime, controls });
  assert.equal(Object.keys(files)[0], 'index.html'); assert.ok(report.hasKit && report.hasSound && report.missing.length === 0); assert.ok(report.engineFiles >= 10);
  for (const f of ['runtime.js', 'manifest.webmanifest', 'icon.svg', 'sw.js', 'game/src/main.js', 'game/src/levels.js', 'game/src/art/hero.js', 'game/src/sounds.js', 'engine/arcade/src/index.js', 'engine/audio/src/synth.js']) assert.ok(f in files, f);
  for (const [path, text] of Object.entries(files)) {
    if (!path.endsWith('.js') || path === 'sw.js' || path === 'runtime.js') continue;
    assert.ok(!/@engine\//.test(text.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')), `${path} still names a package`);
    for (const m of text.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])(\.{1,2}\/[^'"]*)\1/g)) assert.ok(resolveRelative(path, m[2]) in files, `${path} imports ${m[2]}, which is not in the export`);
  }
  assert.match(files['game/src/main.js'], /from '\.\.\/\.\.\/engine\/arcade\/src\/index\.js'/);
  for (const m of files['runtime.js'].matchAll(/import\('(\.\/[^']+)'\)/g)) assert.ok(m[1].slice(2) in files, `runtime.js loads ${m[1]}`);
  const dir = mkdtempSync(join(tmpdir(), 'export-'));
  try {
    for (const [path, text] of Object.entries(files)) { mkdirSync(dirname(join(dir, path)), { recursive: true }); writeFileSync(join(dir, path), text); }
    writeFileSync(join(dir, 'package.json'), '{"type":"module"}');
    const mod = await import(pathToFileURL(join(dir, 'game/src/main.js')).href);
    const game = mod.create(); const keys = new Set(['Space', 'ArrowRight']);
    for (let i = 0; i < 300; i++) mod.update(game, keys, 1 / 60);
    assert.ok(mod.summary(game), 'the exported game starts and plays');
  } finally { rmSync(dir, { recursive: true, force: true }); }
  const sw = files['sw.js']; for (const p of Object.keys(files)) if (p !== 'sw.js') assert.ok(sw.includes(JSON.stringify(p)) || p === 'index.html', `the service worker keeps ${p}`);
  const zip = writeZip(files); const back = await readZip(zip, { maxEntries: 400 }); assert.deepEqual([...back.keys()].sort(), Object.keys(files).sort(), 'it survives being zipped'); assert.equal(new TextDecoder().decode(back.get('index.html')), files['index.html']);
});

test('a game without the kit needs no engine at all, and the export is the same every time', async () => {
  const blank = { 'src/main.js': TEMPLATES.blank.files['src/main.js'] };
  const a = await buildWebExport({ files: blank, title: 'Plain', readEngine, runtime, controls, offline: false });
  assert.ok(!Object.keys(a.files).some((p) => p.startsWith('engine/')) && !('sw.js' in a.files) && !('manifest.webmanifest' in a.files)); assert.equal(a.report.hasKit, false);
  const b = await buildWebExport({ files: blank, title: 'Plain', readEngine, runtime, controls, offline: false }); assert.deepEqual(a.files, b.files);
  const withMath = await buildWebExport({ files: TEMPLATES.bounce.files, title: 'Bounce', readEngine, runtime, controls }); assert.ok('engine/math/src/index.js' in withMath.files, 'the bouncing block uses @engine/math');
  await assert.rejects(buildWebExport({ files: { 'src/other.js': '' }, title: 't', readEngine, runtime, controls }), /no src\/main\.js/);
  const missing = await buildWebExport({ files: { 'src/main.js': "import x from '@engine/nope';" }, title: 't', readEngine, runtime, controls }); assert.deepEqual(missing.report.missing, ['nope/src/index.js']);
});

test('pictures and sounds the person imported travel in the export as plain files, are listed for the page, and change the version when they change', async () => {
  const project = finishedProject();
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4, 5, 6, 7, 8]);
  const asset = (path, bytes, hash) => ({ path, kind: path.endsWith('.png') ? 'image' : 'sound', mime: 'x/y', hash, bytes });
  const a = await buildWebExport({ files: project, title: 'G', readEngine, runtime, controls, assets: [asset('assets/hero.png', png, 'h1')] });
  assert.deepEqual(a.files['game/assets/hero.png'], png);
  assert.match(a.files['index.html'], /"assets":\[\{"path":"assets\/hero\.png","kind":"image"\}\]/);
  assert.ok(a.files['sw.js'].includes('game/assets/hero.png'), 'kept for offline play');
  const b = await buildWebExport({ files: project, title: 'G', readEngine, runtime, controls, assets: [asset('assets/hero.png', png, 'h2')] });
  assert.notEqual(a.report.version, b.report.version);
  const same = await buildWebExport({ files: project, title: 'G', readEngine, runtime, controls, assets: [asset('assets/hero.png', png, 'h1')] });
  assert.equal(a.report.version, same.report.version);
  const none = await buildWebExport({ files: project, title: 'G', readEngine, runtime, controls });
  assert.ok(!('game/assets/hero.png' in none.files)); assert.match(none.files['index.html'], /"assets":\[\]/);
});

test('every starting project can be exported: all its imports resolve to files in the export', async () => {
  for (const [name, t] of Object.entries(TEMPLATES)) {
    const { files, report } = await buildWebExport({ files: t.files, title: name, readEngine, runtime, controls });
    assert.deepEqual(report.missing, [], name);
    for (const [path, text] of Object.entries(files)) {
      if (!path.endsWith('.js') || path === 'sw.js' || path === 'runtime.js') continue;
      for (const m of text.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])(\.{1,2}\/[^'"]*)\1/g)) assert.ok(resolveRelative(path, m[2]) in files, `${name}: ${path} imports ${m[2]}`);
    }
  }
});

test('the project settings shape the exported page: canvas size, aspect, background, title colour, upright games, and the icon', async () => {
  const settings = { title: 'Frog', width: 360, height: 640, background: '#101820', icon: { letter: 'F', color: '#22aa44' } };
  const { files } = await buildWebExport({ files: TEMPLATES.hero.files, title: 'Frog', readEngine, runtime, controls, settings });
  const page = files['index.html'];
  assert.match(page, /<canvas id="game" width="360" height="640"/); assert.match(page, /aspect-ratio: 360 \/ 640/); assert.match(page, /calc\(100vh \* 360 \/ 640\)/);
  assert.match(page, /<meta name="theme-color" content="#101820">/); assert.match(page, /"settings":\{"width":360,"height":640,"background":"#101820"\}/);
  assert.equal(JSON.parse(files['manifest.webmanifest']).orientation, 'portrait'); assert.equal(JSON.parse(files['manifest.webmanifest']).background_color, '#101820');
  assert.match(files['icon.svg'], />F<\/text>/); assert.match(files['icon.svg'], /fill="#22aa44"/);
  const usual = await buildWebExport({ files: TEMPLATES.hero.files, title: 'Plain', readEngine, runtime, controls });
  assert.match(usual.files['index.html'], /width="480" height="320"/); assert.equal(JSON.parse(usual.files['manifest.webmanifest']).orientation, 'landscape');
  assert.match(usual.files['icon.svg'], />P<\/text>/);
});
