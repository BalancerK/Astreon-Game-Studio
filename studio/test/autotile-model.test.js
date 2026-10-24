import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as A from '../app/paint/autotile-model.js';
import { legendOf, findLevels } from '../app/paint/level-model.js';
import { parseSprite, problemWith } from '../app/paint/sprite-model.js';
import { spriteProblem } from '../../packages/arcade/src/art.js';

/** The file as code that can be run (the import and the exports taken off), to see that a change left it valid JavaScript. */
const compile = (t) => new Function(`const loadMap = () => {};\n${t.replace(/^import .*\n/m, '').replace(/export /g, '')}`);
const FILE = `import { loadMap } from '@engine/arcade';
const LEVEL = [
  '#####',
  '#@..#',
  '#####',
];
export function start(game) {
  loadMap(game, LEVEL, {
    '#': { kind: 'wall', color: '#3b4a6b' },
    '@': { kind: 'hero', emoji: '🙂' },
    o: { kind: 'coin', color: '#ffd23c', },
  });
}
`;

test('the entry of a letter is found, and a letter that is not in the legend is not', () => {
  const at = A.locateEntry(FILE, '#');
  assert.equal(at.inner.trim(), "kind: 'wall', color: '#3b4a6b'");
  assert.equal(FILE.slice(at.from, at.to), at.inner);
  assert.ok(A.locateEntry(FILE, 'o'));
  assert.ok(A.locateEntry(FILE, '@'));
  assert.equal(A.locateEntry(FILE, 'x'), null);
  assert.equal(A.locateEntry('const a = 1;', '#'), null);
});

test('settings are added, changed and taken out of one entry, and nothing else in the file changes', () => {
  let t = A.setLegendProps(FILE, '#', { autotile: 'blob47' });
  assert.match(t, /'#': \{ kind: 'wall', color: '#3b4a6b', autotile: 'blob47' \}/);
  assert.equal(t.replace("kind: 'wall', color: '#3b4a6b', autotile: 'blob47'", "kind: 'wall', color: '#3b4a6b'"), FILE, 'only that entry changed');
  t = A.setLegendProps(t, '#', { autotile: 'edges4', edgeWidth: 3, openEdge: true, edge: '#101820' });
  assert.match(t, /autotile: 'edges4'/);
  assert.match(t, /edgeWidth: 3/);
  assert.match(t, /openEdge: true/);
  assert.match(t, /edge: '#101820'/);
  const entry = legendOf(t).find((e) => e.ch === '#');
  assert.equal(entry.kind, 'wall');
  assert.equal(entry.color, '#3b4a6b');
  t = A.setLegendProps(t, '#', { edgeWidth: undefined, openEdge: undefined, edge: undefined, autotile: undefined });
  assert.equal(t, FILE.replace("kind: 'wall', color: '#3b4a6b'", "kind: 'wall', color: '#3b4a6b'"), 'taking every setting out gives back the original');
  const trailing = A.setLegendProps(FILE, 'o', { autotile: 'edges4' });
  assert.match(trailing, /o: \{ kind: 'coin', color: '#ffd23c', autotile: 'edges4' \}/);
  assert.throws(() => A.setLegendProps(FILE, 'x', { a: 1 }), /not in the legend/);
  assert.throws(() => A.setLegendProps(FILE, '#', { 'bad key': 1 }), /not a usable setting/);
  const quoted = A.setLegendProps(FILE, '#', { sprite: "it's" });
  assert.match(quoted, /sprite: 'it\\'s'/);
  assert.doesNotThrow(() => compile(quoted));
});

test('the file is still valid code after every kind of change', () => {
  const run = (text) => compile(text);
  for (const patch of [{ autotile: 'blob47' }, { terrain: 'stone', openEdge: true }, { edge: '#fff', edgeWidth: 2 }, { sprite: 'wallTiles' }]) {
    let t = A.setLegendProps(FILE, '#', patch);
    assert.doesNotThrow(() => run(t));
    t = A.setLegendProps(t, '#', Object.fromEntries(Object.keys(patch).map((k) => [k, undefined])));
    assert.doesNotThrow(() => run(t));
    assert.equal(legendOf(t).find((e) => e.ch === '#').kind, 'wall');
  }
});

test('the legend reader picks up every auto-tile setting, and the old entries read as before', () => {
  const t = A.setLegendProps(FILE, '#', { autotile: 'blob47', terrain: 'stone', edge: '#101820', edgeWidth: 3, openEdge: true });
  const e = legendOf(t).find((x) => x.ch === '#');
  assert.deepEqual([e.kind, e.color, e.autotile, e.terrain, e.edge, e.edgeWidth, e.openEdge], ['wall', '#3b4a6b', 'blob47', 'stone', '#101820', 3, true]);
  const plain = legendOf(FILE).find((x) => x.ch === '#');
  assert.deepEqual([plain.autotile, plain.terrain, plain.edgeWidth, plain.openEdge], ['', '', 0, false]);
  assert.equal(A.autotileOf(e).mode, 'blob47');
  assert.equal(A.autotileOf(plain), null);
});

test('what an entry says about auto-tiling is read, the neighbours of a level are found with that legend, and open edges are honoured', () => {
  const t = A.setLegendProps(A.setLegendProps(FILE, '#', { autotile: 'blob47' }), '@', { autotile: 'nonsense' });
  const legend = legendOf(t).map((e) => ({ ...e }));
  legend.find((e) => e.ch === '#').autotile = 'blob47';
  assert.equal(A.autotileOf(legend.find((e) => e.ch === '@')), null);
  assert.deepEqual(A.autotileOf({ ch: '#', autotile: 'edges4', edgeWidth: 3, openEdge: true, sprite: 'w' }), { mode: 'edges4', terrain: '#', edge: '', width: 3, open: true, sprite: 'w' });
  const rows = findLevels(t)[0].rows;
  const masks = A.levelMasks(rows, legend);
  assert.equal(masks[0][0], 255 - 32, 'solid: the map edge joins, the open floor inside does not');
  assert.equal(masks[1][1], null, 'the hero is not auto-tiled');
  legend.find((e) => e.ch === '#').openEdge = true;
  assert.equal(A.levelMasks(rows, legend)[0][0], 2 | 4, 'open: only east and south');
  assert.equal(A.terrainMap(legend)('#'), '#');
  assert.equal(A.terrainMap(legend)('x'), null);
});

test('the picture of a terrain is made from the tile\'s sprite or from its colour, is a valid sprite the studio can save and read, and has a frame for every shape', () => {
  for (const mode of ['edges4', 'blob47']) {
    const fromColor = A.tilesFor(null, '#3b4a6b', mode);
    const sprite = parseSprite(fromColor.file);
    assert.equal(problemWith(sprite), null, mode);
    assert.equal(spriteProblem(sprite), null);
    assert.equal(sprite.frames.length, A.AUTOTILE_MODES[mode]);
    assert.equal(sprite.palette.a, '#3b4a6b');
    assert.match(fromColor.file, /Auto-tile pictures/);
  }
  const base = { w: 8, h: 8, palette: { g: '#4ade80', d: '#25a35a' }, frames: [['gggggggg', 'gggggggg', 'gdgdgdgg', 'gggggggg', 'gggggggg', 'gdgdgdgg', 'gggggggg', 'gggggggg']] };
  const own = A.tilesFor(base, '', 'edges4', { edge: '#003300', width: 1 });
  assert.equal(own.sprite.w, 8);
  assert.equal(own.sprite.frames.length, 16);
  assert.ok(Object.values(own.sprite.palette).includes('#003300'));
  const bad = A.tilesFor(null, 'not a colour', 'edges4');
  assert.equal(parseSprite(bad.file).palette.a, '#556b8d', 'an unusable colour falls back to a usual one');
  assert.equal(A.tilesName('wall'), 'wallTiles');
  assert.equal(A.tilesName('stone-wall!'), 'stonewallTiles');
  assert.equal(A.tilesName(''), 'tileTiles');
  assert.throws(() => A.tilesFor(null, '#fff', 'blob99'), /two modes/);
});
