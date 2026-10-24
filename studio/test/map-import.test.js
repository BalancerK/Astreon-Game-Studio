import { test } from 'node:test';
import assert from 'node:assert/strict';
import { importMap, parseTiled, parseLdtk, lettersFor, kindName, levelModule, filesFor, IMPORT_LIMITS } from '../app/store/map-import.js';
import { findLevels, legendOf } from '../app/paint/level-model.js';
import { parseScene } from '../app/paint/scene-model.js';
import { loadMap, loadScene } from '../../packages/arcade/src/map.js';
import { newGame, all } from '../../packages/arcade/src/things.js';

const TILED = {
  type: 'map', orientation: 'orthogonal', width: 5, height: 3, tilewidth: 16, tileheight: 16,
  tilesets: [{ firstgid: 1, name: 'ground', tilecount: 4 }],
  layers: [
    { type: 'tilelayer', name: 'Ground', width: 5, height: 3, data: [1, 1, 1, 1, 1, 1, 0, 0, 2, 1, 1, 1, 1, 1, 1] },
    { type: 'tilelayer', name: 'Empty', width: 5, height: 3, data: new Array(15).fill(0) },
    { type: 'objectgroup', name: 'Things', objects: [
      { id: 1, name: 'Sam', type: 'Hero', x: 20, y: 16, width: 16, height: 16, properties: [{ name: 'hp', type: 'int', value: 3 }, { name: 'tag', type: 'string', value: 'x' }] },
      { id: 2, name: 'coin1', type: 'Coin', x: 48, y: 32, width: 0, height: 0, point: true },
      { id: 3, name: 'sign', x: 0, y: 48, gid: 5, width: 16, height: 16 },
    ] },
  ],
};

const LDTK = {
  __header__: { fileType: 'LDtk Project JSON' }, jsonVersion: '1.5.3',
  defs: { layers: [{ uid: 1, identifier: 'Collisions', intGridValues: [{ value: 1, identifier: 'Wall', color: '#ff0000' }, { value: 2, identifier: 'Water', color: '#0000ff' }] }] },
  levels: [{
    identifier: 'Level_0', pxWid: 64, pxHei: 32,
    layerInstances: [
      { __identifier: 'Things', __type: 'Entities', __gridSize: 16, entityInstances: [
        { __identifier: 'Player', px: [16, 16], width: 16, height: 16, __pivot: [0.5, 1], __smartColor: '#00ff00', fieldInstances: [{ __identifier: 'lives', __value: 3 }, { __identifier: 'list', __value: [1, 2] }] },
      ] },
      { __identifier: 'Collisions', __type: 'IntGrid', __gridSize: 16, __cWid: 4, __cHei: 2, layerDefUid: 1, intGridCsv: [1, 1, 1, 1, 1, 0, 2, 1] },
      { __identifier: 'Pretty', __type: 'Tiles', __gridSize: 16, gridTiles: [] },
    ],
  }],
};

test('values become letters: the commonest is #, others get letters, nothing is a dot, and names and colours are used', () => {
  const m = lettersFor([[1, 1, 2], [0, 1, 3]], { names: { 1: 'Wall', 2: 'water' }, colors: { 2: '#0000ff' } });
  assert.deepEqual(m.rows, ['##a', '.#b']);
  assert.equal(m.legend['#'].kind, 'Wall');
  assert.equal(m.legend.a.kind, 'water');
  assert.equal(m.legend.a.color, '#0000ff');
  assert.equal(m.legend.b.kind, 'tile3');
  assert.deepEqual(lettersFor([[0, 0]]).rows, ['..']);
  const many = lettersFor([Array.from({ length: 80 }, (_, i) => i + 1)]);
  assert.equal(many.cut, 80 - IMPORT_LIMITS.legend);
  assert.ok([...many.rows[0]].every((c) => c === '#' || Object.hasOwn(many.legend, c)));
  assert.ok(!Object.keys(many.legend).some((k) => ['o', '@', '.'].includes(k)));
});

test('kinds are made safe', () => {
  assert.equal(kindName('Hero'), 'Hero');
  assert.equal(kindName('my hero!'), 'my-hero');
  assert.equal(kindName('123'), 'thing');
  assert.equal(kindName('', 'x'), 'x');
  assert.equal(kindName('a'.repeat(50)).length, 24);
});

test('a Tiled map: its tile layers become levels with a legend, empty ones are left out, objects become scene things with their properties (and a point gets a tile\'s size)', () => {
  const r = importMap(JSON.stringify(TILED), 'Cave Level.tmj');
  assert.equal(r.source, 'tiled');
  assert.equal(r.parts[0].name, 'cave-level');
  const [level] = r.parts[0].levels;
  assert.equal(r.parts[0].levels.length, 1);
  assert.equal(level.name, 'Ground');
  assert.deepEqual(level.rows, ['#####', '#..a#', '#####']);
  assert.equal(level.tile, 16);
  assert.equal(level.columns, 5);
  assert.ok(r.warnings.some((w) => /no tiles/.test(w)));
  const scene = r.parts[0].scene;
  assert.deepEqual([scene.w, scene.h], [80, 64], 'a scene is at least 64 pixels each way');
  assert.deepEqual(scene.things[0], { kind: 'Hero', x: 20, y: 16, w: 16, h: 16, extra: { hp: 3, tag: 'x', name: 'Sam' } });
  assert.deepEqual(scene.things[1], { kind: 'Coin', x: 48, y: 32, w: 16, h: 16, extra: { name: 'coin1' } });
  assert.equal(scene.things[2].y, 32, 'a picture object is placed by its bottom edge in Tiled');
  assert.equal(scene.things[2].kind, 'sign');
});

test('Tiled data in other forms: CSV text, plain base64, flip flags on tile numbers, infinite maps and groups; compressed data is explained', () => {
  const base = { orientation: 'orthogonal', tilewidth: 8, tileheight: 8, width: 2, height: 2 };
  const csv = parseTiled({ ...base, layers: [{ type: 'tilelayer', name: 'a', width: 2, height: 2, encoding: 'csv', data: '1,0,\n0,1' }] });
  assert.deepEqual(csv.levels[0].rows, ['#.', '.#']);
  const bytes = new Uint8Array(16);
  new DataView(bytes.buffer).setUint32(0, 7, true);
  new DataView(bytes.buffer).setUint32(12, 7, true);
  const b64 = parseTiled({ ...base, layers: [{ type: 'tilelayer', name: 'b', width: 2, height: 2, encoding: 'base64', data: Buffer.from(bytes).toString('base64') }] });
  assert.deepEqual(b64.levels[0].rows, ['#.', '.#']);
  const flipped = parseTiled({ ...base, layers: [{ type: 'tilelayer', name: 'f', width: 2, height: 2, data: [1, 0x80000001, 0, 0x40000001] }] });
  assert.deepEqual(flipped.levels[0].rows, ['##', '.#'], 'a flipped tile is the same tile');
  const zipped = parseTiled({ ...base, layers: [{ type: 'tilelayer', name: 'z', width: 2, height: 2, encoding: 'base64', compression: 'zlib', data: 'eJw=' }] });
  assert.equal(zipped.levels.length, 0);
  assert.match(zipped.warnings[0], /compressed/);
  const inf = parseTiled({ ...base, infinite: true, layers: [{ type: 'tilelayer', name: 'i', chunks: [{ x: -2, y: 0, width: 2, height: 2, data: [1, 1, 1, 1] }, { x: 0, y: 0, width: 2, height: 2, data: [0, 0, 0, 1] }] }] });
  assert.deepEqual(inf.levels[0].rows, ['##..', '##.#']);
  assert.ok(inf.warnings.some((w) => /infinite/.test(w)));
  const grouped = parseTiled({ ...base, layers: [{ type: 'group', name: 'World', layers: [{ type: 'tilelayer', name: 'g', width: 2, height: 2, data: [1, 1, 1, 1] }] }, { type: 'imagelayer', name: 'sky' }] });
  assert.equal(grouped.levels[0].name, 'World-g');
  assert.ok(grouped.warnings.some((w) => /picture layer/.test(w)));
  assert.match(parseTiled({ ...base, orientation: 'isometric', layers: [] }).warnings[0], /isometric/);
});

test('big maps are cut to the painter\'s size with a warning', () => {
  const w = 320;
  const r = parseTiled({ orientation: 'orthogonal', tilewidth: 8, tileheight: 8, width: w, height: 120, layers: [{ type: 'tilelayer', name: 'big', width: w, height: 120, data: new Array(w * 120).fill(1) }] });
  assert.equal(r.levels[0].columns, 300);
  assert.equal(r.levels[0].rows.length, 100);
  assert.ok(r.warnings.some((x) => /bigger than/.test(x)));
});

test('an LDtk project: IntGrid layers become levels using the names and colours defined in LDtk, entities become scene things placed by their pivot, other layers are said to be left out', () => {
  const r = importMap(JSON.stringify(LDTK), 'game.ldtk');
  assert.equal(r.source, 'ldtk');
  const part = r.parts[0];
  assert.equal(part.name, 'Level_0');
  assert.equal(part.levels.length, 1);
  const level = part.levels[0];
  assert.deepEqual(level.rows, ['####', '#.a#']);
  assert.equal(level.legend['#'].kind, 'wall');
  assert.equal(level.legend['#'].color, '#ff0000');
  assert.equal(level.legend.a.kind, 'water');
  assert.deepEqual(part.scene.things[0], { kind: 'Player', x: 8, y: 0, w: 16, h: 16, color: '#00ff00', extra: { lives: 3 } }, 'by its pivot (middle bottom); a list field is not kept');
  assert.deepEqual([part.scene.w, part.scene.h], [64, 64]);
  assert.ok(r.warnings.some((w) => /Tiles layer "Pretty"/.test(w)));
  const worlds = parseLdtk({ __header__: {}, defs: { layers: [] }, worlds: [{ levels: LDTK.levels }] });
  assert.equal(worlds.results.length, 1, 'newer projects keep their levels inside worlds');
  const external = parseLdtk({ levels: [{ identifier: 'L', layerInstances: null }] });
  assert.match(external.warnings[0], /separate file/);
});

test('a file that is not a map is explained, and a map with nothing usable is too', () => {
  assert.throws(() => importMap('not json'), /not JSON/);
  assert.throws(() => importMap('{"hello": 1}'), /does not look like/);
  assert.throws(() => importMap('{"layers": [], "tilewidth": 8}'), /no tile layers or objects/);
  assert.throws(() => importMap(JSON.stringify({ __header__: {}, levels: [{ identifier: 'a', layerInstances: null }] })), /no levels/);
  assert.throws(() => importMap('x'.repeat(9_000_000)), /too big/);
});

test('the level module is what the Level painter opens: rows and a legend, valid code, and it loads the same level in a game', () => {
  const level = importMap(JSON.stringify(TILED), 'cave.tmj').parts[0].levels[0];
  const text = levelModule(level, 'Tiled');
  assert.match(text, /imported from Tiled/);
  const found = findLevels(text);
  assert.equal(found.length, 1);
  assert.deepEqual(found[0].rows, level.rows);
  const legend = legendOf(text);
  assert.deepEqual(legend.map((e) => e.ch).sort(), Object.keys(level.legend).sort());
  assert.equal(legend.find((e) => e.ch === '#').kind, 'wall');
  const run = new Function('loadMap', `${text.replace(/^import .*\n/m, '').replace(/export /g, '')}\nreturn { loadLevel, LEVEL };`)(loadMap);
  const game = newGame();
  const size = run.loadLevel(game);
  assert.equal(size.columns, 5);
  assert.equal(all(game, 'wall').length, 12);
  assert.equal(all(game).length, 13, 'twelve walls and the one other tile');
});

test('the files to write are named safely and without clashing, and the scene file loads in a game', () => {
  const imported = importMap(JSON.stringify(TILED), 'Cave.tmj');
  const files = filesFor(imported, new Set(['src/levels/cave.js']));
  assert.deepEqual(Object.keys(files).sort(), ['scenes/cave.js', 'src/levels/cave-2.js']);
  const scene = parseScene(files['scenes/cave.js']);
  assert.equal(scene.things.length, 3);
  const game = newGame();
  loadScene(game, scene);
  assert.equal(all(game, 'Hero')[0].hp, 3, 'extra fields reach the thing');
  const ld = filesFor(importMap(JSON.stringify(LDTK), 'x.ldtk'));
  assert.ok(Object.keys(ld).some((p) => p.startsWith('src/levels/')) && Object.keys(ld).some((p) => p.startsWith('scenes/')));
  assert.equal(imported.parts[0].levels[0].path, 'src/levels/cave-2.js');
});
