import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SpriteBatch, INSTANCE_WORDS, Camera, TileMap, TileSet, drawTileMap, tileMapFromTiled, tileOrientation, FLIP_H, FLIP_V, FLIP_D, CHUNK } from '../src/index.js';

// a sheet of 4 x 2 tiles of 8 pixels, as one atlas sprite 32 x 16 on page 2 of a 1024-pixel atlas
const sheet = { u0: 0.25, v0: 0.5, u1: 0.25 + 32 / 1024, v1: 0.5 + 16 / 1024, w: 32, h: 16, page: 2 };
const tiles = () => TileSet.fromSheet(sheet, { tileW: 8, tileH: 8, name: 'town' });
const cam = (x, y, w = 160, h = 120) => new Camera({ x, y, zoom: 1, viewW: w, viewH: h });
const draw = (map, camera, o) => { const b = new SpriteBatch(16); const n = drawTileMap(b, map, camera, o); return { b, n }; };
const sprites = (b) => Array.from({ length: b.count }, (_, i) => Array.from(b.f32.subarray(i * INSTANCE_WORDS, i * INSTANCE_WORDS + INSTANCE_WORDS)));
const px = 1 / 1024;

test('a tileset cuts a sheet into tiles with the right atlas rectangles', () => {
  const t = tiles();
  assert.equal(t.count, 8);
  const s = t.spriteOf(5);                                  // column 1, row 1
  assert.ok(Math.abs(s.u0 - (0.25 + 8 * px)) < 1e-9 && Math.abs(s.v0 - (0.5 + 8 * px)) < 1e-9);
  assert.ok(Math.abs(s.u1 - (0.25 + 16 * px)) < 1e-9 && s.page === 2);
});

test('a tile map draws only the chunks in view, as a copy of cached sprites', () => {
  const map = new TileMap({ tileW: 8 });
  map.addTileset(tiles());
  map.addLayer({ name: 'ground' }).fill(0, 0, 400, 400, 1);      // 160,000 tiles
  const { b, n } = draw(map, cam(80, 60));
  // the view is 160 x 120 = 20 x 15 tiles, which touches at most 3 x 2 chunks of 16 x 16 and cannot reach the rest
  assert.ok(n <= 6 * 256 && n >= 20 * 15, `drew ${n}`);
  assert.equal(b.count, n);
  const first = sprites(b)[0];
  assert.equal(first[2], 8); assert.equal(first[3], 8);
  assert.equal(draw(map, cam(80, 60)).n, n);
  assert.equal(draw(map, cam(100000, 60)).n, 0);
});

test('a changed tile rebuilds only its own chunk, and the picture follows', () => {
  const map = new TileMap({ tileW: 8 });
  map.addTileset(tiles());
  const layer = map.addLayer();
  layer.fill(0, 0, 32, 32, 1);
  const camera = cam(128, 128, 512, 512);
  draw(map, camera);
  const chunks = [...layer.chunks.values()];
  const blocks = chunks.map((c) => c.block);
  layer.set(3, 3, 6);                                       // tile 5 of the set
  draw(map, camera);
  assert.equal(chunks.filter((c, i) => c.block !== blocks[i]).length, 1, 'one chunk was rebuilt');
  const at = sprites(draw(map, camera).b).find((s) => s[0] === 28 && s[1] === 28);
  assert.ok(Math.abs(at[5] - (0.25 + 8 * px)) < 1e-9, 'it shows tile 5');
  layer.set(3, 3, 0);
  assert.equal(layer.get(3, 3), 0);
});

test('flip flags: every corner of every combination lands where Tiled says', () => {
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  for (let flags = 0; flags < 8; flags++) {
    const gid = (1 | ((flags & 4) ? FLIP_H : 0) | ((flags & 2) ? FLIP_V : 0) | ((flags & 1) ? FLIP_D : 0)) >>> 0;
    const o = tileOrientation(gid);
    for (const [x, y] of corners) {
      let want = [x, y];
      if (flags & 1) want = [want[1], want[0]];
      if (flags & 4) want = [-want[0], want[1]];
      if (flags & 2) want = [want[0], -want[1]];
      let p = [o.mirror ? -x : x, y];
      for (let t = 0; t < o.turns; t++) p = [-p[1], p[0]];
      assert.deepEqual(p, want, `flags ${flags}`);
    }
  }
});

test('flipped tiles reach the batch as a mirror (negative width) and a turn', () => {
  const map = new TileMap({ tileW: 8 });
  map.addTileset(tiles());
  const l = map.addLayer();
  l.set(0, 0, (1 | FLIP_H) >>> 0);
  l.set(1, 0, (1 | FLIP_D) >>> 0);
  const [a, b] = sprites(draw(map, cam(8, 8)).b);
  assert.equal(a[2], -8); assert.equal(a[4], 0);
  assert.ok(Math.abs(b[4]) > 1 && Math.abs(Math.abs(b[2]) - 8) < 1e-9, 'the diagonal flip is a turn and maybe a mirror');
});

test('animated tiles pick their frame from the time, others are cached', () => {
  const map = new TileMap({ tileW: 8 });
  const t = tiles().animate(0, [{ id: 0, ms: 100 }, { id: 1, ms: 100 }, { id: 2, ms: 200 }]);
  map.addTileset(t);
  const l = map.addLayer();
  l.set(0, 0, 1); l.set(1, 0, 4);
  assert.equal(t.frameAt(0, 0.05), 0); assert.equal(t.frameAt(0, 0.15), 1); assert.equal(t.frameAt(0, 0.25), 2); assert.equal(t.frameAt(0, 0.35), 2); assert.equal(t.frameAt(0, 0.45), 0);
  assert.equal(t.frameAt(3, 9), 3, 'a tile that does not animate stays');
  const u0 = (time) => sprites(draw(map, cam(8, 8), { time }).b).find((s) => s[0] === 4)[5];
  assert.ok(u0(0.05) < u0(0.15) && u0(0.15) < u0(0.25), 'the animated tile moves along the sheet');
});

test('layers: offset, parallax, opacity, tint, visibility and sort keys', () => {
  const map = new TileMap({ tileW: 8 });
  map.addTileset(tiles());
  const back = map.addLayer({ name: 'far', parallaxX: 0.5, offsetY: 10, opacity: 0.5, tint: 0xff0000 });
  const front = map.addLayer({ name: 'near' });
  back.set(0, 0, 1); front.set(0, 0, 1);
  const camera = cam(40, 0);
  const { b } = draw(map, camera, { key: 10 });
  const [far, near] = sprites(b);
  assert.equal(near[0], 4);
  assert.equal(far[0], 4 + 40 * 0.5, 'a layer with half the parallax is carried half as far as the camera');
  assert.equal(far[1], 4 + 10);
  assert.equal(b.keys[0], 10); assert.equal(b.keys[1], 11);
  const tint = b.u32[9];
  assert.equal(tint >>> 24, 128); assert.equal(tint & 255, 255); assert.equal((tint >> 8) & 255, 0);
  front.visible = false;
  assert.equal(draw(map, camera).b.count, 1);
  back.opacity = 0.25; front.visible = true;
  assert.equal(draw(map, camera).b.u32[9] >>> 24, 64, 'a changed opacity rebuilds the chunk');
});

test('a tile taller than the grid stands on its cell; tiles reach negative coordinates', () => {
  const map = new TileMap({ tileW: 8 });
  map.addTileset(TileSet.fromSheet(sheet, { tileW: 8, tileH: 8, columns: 4, count: 4, drawH: 16, name: 'trees' }));
  const l = map.addLayer();
  l.set(-1, -1, 1);
  assert.equal(l.get(-1, -1), 1);
  const [s] = sprites(draw(map, cam(0, 0)).b);
  assert.equal(s[0], -4); assert.equal(s[1], -8, 'the bottom of the picture is the bottom of cell (-1,-1)'); assert.equal(s[3], 16);
  assert.deepEqual(l.bounds(), { x: -1, y: -1, w: 1, h: 1 });
});

test('tilesets that would overlap are renumbered to follow', () => {
  const map = new TileMap({ tileW: 8 });
  const a = map.addTileset(tiles()), b = map.addTileset(tiles());
  assert.equal(a.firstGid, 1); assert.equal(b.firstGid, 9);
  assert.equal(map.resolve(9).set, b); assert.equal(map.resolve((9 | FLIP_H) >>> 0).id, 0); assert.equal(map.resolve(17), null);
});

const tiledMap = (extra = {}) => ({
  orientation: 'orthogonal', tilewidth: 8, tileheight: 8, width: 4, height: 2, infinite: false,
  tilesets: [{ firstgid: 1, name: 'town', image: 'town.png', tilewidth: 8, tileheight: 8, columns: 4, tilecount: 8, tiles: [{ id: 0, animation: [{ tileid: 0, duration: 100 }, { tileid: 1, duration: 100 }] }] }],
  layers: [
    { type: 'tilelayer', name: 'ground', width: 4, height: 2, data: [1, 2, 0, 3, 5, 0, 0, 0x80000000 + 4], opacity: 0.5, offsetx: 3, tintcolor: '#ff8000' },
    { type: 'group', name: 'fx', layers: [{ type: 'tilelayer', name: 'mist', width: 4, height: 2, data: [0, 0, 0, 0, 0, 0, 0, 0], parallaxx: 0.5 }] },
    { type: 'objectgroup', name: 'spawns', objects: [] },
  ],
  ...extra,
});

test('a Tiled map loads: layers, groups, flags, animations, offsets; objects are named as skipped', () => {
  const { map, warnings, layers } = tileMapFromTiled(tiledMap(), { sheet: () => sheet });
  assert.deepEqual(map.layers.map((l) => l.name), ['ground', 'fx/mist']);
  assert.equal(layers.ground.get(3, 1), (0x80000000 + 4) >>> 0);
  assert.equal(layers.ground.get(2, 0), 0);
  assert.equal(layers.ground.offsetX, 3); assert.equal(layers.ground.opacity, 0.5); assert.equal(layers.ground.tint, 0xff8000);
  assert.equal(layers['fx/mist'].parallaxX, 0.5);
  assert.ok(map.tilesets[0].animations.has(0));
  assert.equal(warnings.length, 1); assert.match(warnings[0], /spawns.*objectgroup/);
  assert.ok(draw(map, cam(16, 8)).n > 0);
});

test('Tiled: base64 data, infinite maps with chunks, and clear refusals', () => {
  const words = new Uint32Array([0, 1, 2, 3]);
  const b64 = Buffer.from(words.buffer).toString('base64');
  const m1 = tiledMap({ layers: [{ type: 'tilelayer', name: 'a', width: 2, height: 2, data: b64, encoding: 'base64' }] });
  assert.equal(tileMapFromTiled(m1, { sheet: () => sheet }).layers.a.get(1, 1), 3);
  const m2 = tiledMap({ infinite: true, layers: [{ type: 'tilelayer', name: 'a', chunks: [{ x: -16, y: 0, width: 2, height: 1, data: [1, 2] }] }] });
  const inf = tileMapFromTiled(m2, { sheet: () => sheet }).layers.a;
  assert.equal(inf.get(-16, 0), 1); assert.equal(inf.get(-15, 0), 2);
  const zipped = tiledMap({ layers: [{ type: 'tilelayer', name: 'a', width: 2, height: 2, data: 'eJw=', encoding: 'base64', compression: 'zlib' }] });
  assert.throws(() => tileMapFromTiled(zipped, { sheet: () => sheet }), /compressed \(zlib\).*CSV or Base64/);
  assert.throws(() => tileMapFromTiled({ ...tiledMap(), orientation: 'isometric' }, { sheet: () => sheet }), /orthogonal/);
  assert.throws(() => tileMapFromTiled(tiledMap({ tilesets: [{ firstgid: 1, source: 'a.tsx' }] }), { sheet: () => sheet }), /embed/);
  assert.throws(() => tileMapFromTiled(tiledMap(), {}), /needs sheet/);
});

test('mistakes are named', () => {
  assert.throws(() => new TileMap({}), /tileW/);
  const map = new TileMap({ tileW: 8 });
  assert.throws(() => map.addLayer().set(1.5, 0, 1), /whole numbers/);
  assert.throws(() => new TileSet({ tileW: 8, tileH: 8, count: 0, sprite: () => ({}) }), /count/);
});
