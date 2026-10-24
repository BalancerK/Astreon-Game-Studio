import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeResources, byKind, kindOf, referencesIn, sizeWords } from '../app/profile/resources.js';

const files = {
  'src/main.js': "import hero from './art/hero.js';\nimport sfx from './sounds.js';\nimport { helper } from './util/helper.js';\nconst bg = image('assets/sky.png');\nexport function create() { return {}; }\n",
  'src/art/hero.js': 'export default { w: 16 };',
  'src/art/unused.js': 'export default { w: 16 };',
  'src/sounds.js': 'export default {};',
  'src/music.js': 'export default {};',
  'src/util/helper.js': "import { more } from './more.js';\nexport const helper = 1;\nconst scene = loadScene('./level.json');\n",
  'src/util/more.js': 'export const more = 2;',
  'src/util/level.json': '{}',
  'tests/hero.test.js': "import { test } from '@engine/arcade';\nimport * as game from '../src/main.js';\n",
  'project.json': '{"title":"x"}',
  'notes.md': '# notes',
};
const assets = [{ path: 'assets/sky.png', bytes: 5000 }, { path: 'assets/old.png', bytes: 3000 }];

test('files are told apart by where they live and what they are called', () => {
  const expected = {
    'src/art/hero.js': 'sprite', 'src/sounds.js': 'sounds', 'src/music.js': 'music', 'src/text.js': 'words', 'src/ui.js': 'ui', 'src/states.js': 'states',
    'src/main.js': 'code', 'tests/a.test.js': 'test', 'src/a.test.js': 'test', 'x.plugin.js': 'plugin', 'a.png': 'image', 'b.WAV': 'sound file', 'n.md': 'data',
    'project.json': 'settings', 'weird.bin': 'other',
  };
  for (const [path, kind] of Object.entries(expected)) assert.equal(kindOf(path), kind, path);
});

test('imports and file names written as text are found without running the code', () => {
  const known = new Set(Object.keys(files).concat(assets.map((a) => a.path)));
  const r = referencesIn('src/main.js', files['src/main.js'], known);
  assert.deepEqual(r.imports.sort(), ['src/art/hero.js', 'src/sounds.js', 'src/util/helper.js']);
  assert.deepEqual(r.named, ['assets/sky.png']);
  const nested = referencesIn('src/util/helper.js', files['src/util/helper.js'], known);
  assert.deepEqual(nested.imports, ['src/util/more.js']);
  assert.deepEqual(nested.named, ['src/util/level.json'], 'a relative name in a string resolves from the file');
  assert.deepEqual(referencesIn('a.js', "import x from './nothing.js';", known), { imports: [], named: [] });
  assert.deepEqual(referencesIn('a.js', "const s = 'a'.repeat(300) + \"" + 'x'.repeat(200) + '";', known), { imports: [], named: [] });
});

test('what the game reaches from src/main.js is used, the rest is unused, and each file says who asks for it', () => {
  const r = analyzeResources(files, assets);
  const by = Object.fromEntries(r.entries.map((e) => [e.path, e]));
  for (const p of ['src/main.js', 'src/art/hero.js', 'src/sounds.js', 'src/util/helper.js', 'src/util/more.js', 'src/util/level.json', 'assets/sky.png', 'project.json']) {
    assert.ok(by[p].used, `${p} is used`);
  }
  for (const p of ['src/art/unused.js', 'src/music.js', 'assets/old.png', 'tests/hero.test.js', 'notes.md']) assert.ok(!by[p].used, `${p} is not used`);
  assert.deepEqual(by['src/art/hero.js'].usedBy, ['src/main.js']);
  assert.deepEqual(by['src/util/more.js'].usedBy, ['src/util/helper.js']);
  assert.deepEqual(by['assets/sky.png'].usedBy, ['src/main.js']);
  assert.equal(r.total, r.usedBytes + r.unusedBytes);
  assert.equal(by['assets/old.png'].bytes, 3000);
  assert.ok(r.unusedBytes >= 3000);
});

test('an import of a file that is not there is reported with where it was written', () => {
  const r = analyzeResources({ 'src/main.js': "import './gone.js';\nimport x from './here.js';", 'src/here.js': '' });
  assert.deepEqual(r.missing, [{ from: 'src/main.js', path: './gone.js' }]);
});

test('a project with no src/main.js has nothing used (except its settings) and does not crash', () => {
  const r = analyzeResources({ 'a.js': 'x', 'project.json': '{}' });
  assert.deepEqual(r.entries.filter((e) => e.used).map((e) => e.path), ['project.json']);
  assert.deepEqual(analyzeResources({}), { entries: [], total: 0, usedBytes: 0, unusedBytes: 0, missing: [] });
});

test('files are grouped by kind, the biggest group first, and sizes are in plain words', () => {
  const groups = byKind(analyzeResources(files, assets).entries);
  assert.equal(groups[0].kind, 'image', 'the pictures are the biggest');
  assert.equal(groups.find((g) => g.kind === 'sprite').entries.length, 2);
  assert.equal(groups.reduce((n, g) => n + g.bytes, 0), analyzeResources(files, assets).total);
  assert.deepEqual([sizeWords(0), sizeWords(999), sizeWords(1500), sizeWords(2_500_000)], ['0 B', '999 B', '1.5 KB', '2.5 MB']);
});
