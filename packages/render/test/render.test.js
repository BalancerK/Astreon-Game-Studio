import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SpriteBatch, packTint, INSTANCE_WORDS, Camera, ShelfPacker, Atlas } from '../src/index.js';

test('SpriteBatch layout, growth and tint packing', () => {
  const b = new SpriteBatch(2);
  const spr = { u0: 0.25, v0: 0.5, u1: 0.75, v1: 1 };
  for (let i = 0; i < 5; i++) b.push(i, i * 2, 10, 20, 0.5, spr, packTint(255, 128, 0, 64));
  assert.equal(b.count, 5);
  assert.ok(b.capacity >= 5);
  const o = 3 * INSTANCE_WORDS;
  assert.deepEqual([...b.f32.subarray(o, o + 9)], [3, 6, 10, 20, 0.5, 0.25, 0.5, 0.75, 1]);
  const bytes = new Uint8Array(b.f32.buffer, (o + 9) * 4, 4);
  assert.deepEqual([...bytes], [255, 128, 0, 64], 'R,G,B,A byte order in memory');
  assert.equal(b.used.length, 5 * INSTANCE_WORDS);
  b.clear();
  assert.equal(b.used.length, 0);
});

test('Camera maps world <-> screen and produces shader uniforms', () => {
  const c = new Camera({ x: 100, y: 50, zoom: 2, viewW: 800, viewH: 600 });
  const s = c.worldToScreen(100, 50);
  assert.deepEqual([s.x, s.y], [400, 300], 'camera centre is the screen centre');
  const s2 = c.worldToScreen(110, 40);
  assert.deepEqual([s2.x, s2.y], [420, 280]);
  const w = c.screenToWorld(420, 280);
  assert.deepEqual([w.x, w.y], [110, 40]);
  const u = c.uniforms();
  assert.deepEqual([...u], [100, 50, 2 * 2 / 800, -2 * 2 / 600].map(Math.fround));
  // the uniform math must agree with worldToScreen: clip -> pixels
  const clipX = (110 - u[0]) * u[2], clipY = (40 - u[1]) * u[3];
  assert.ok(Math.abs((clipX * 0.5 + 0.5) * 800 - s2.x) < 1e-3);
  assert.ok(Math.abs((1 - (clipY * 0.5 + 0.5)) * 600 - s2.y) < 1e-3, 'clip y is up, world y is down');
});

test('Camera follow converges independent of frame rate; shake decays to zero', () => {
  const run = (dt) => {
    const c = new Camera();
    for (let t = 0; t < 1 - 1e-9; t += dt) c.follow(100, 0, dt, 0.01);
    return c.x;
  };
  assert.ok(Math.abs(run(1 / 60) - run(1 / 144)) < 1e-6);
  assert.ok(Math.abs(run(1 / 60) - 99) < 0.01);
  const c = new Camera();
  c.shake(10, 0.5);
  c.update(0.25);
  assert.ok(Math.abs(c.offsetX) <= 5 && Math.abs(c.offsetY) <= 5);
  c.update(0.5);
  c.update(0.1);
  assert.deepEqual([c.offsetX, c.offsetY], [0, 0]);
});

test('ShelfPacker fills rows, opens shelves, never overlaps, and reports full', () => {
  const p = new ShelfPacker(64, 64, 1);
  const placed = [];
  let n = 0;
  for (;;) {
    const r = p.pack(14, 10 + (n % 3) * 4);
    if (!r) break;
    placed.push({ ...r, w: 14, h: 10 + (n % 3) * 4 });
    n++;
  }
  assert.ok(n >= 8, `packed ${n}`);
  for (const a of placed) {
    assert.ok(a.x >= 1 && a.y >= 1 && a.x + a.w <= 63 && a.y + a.h <= 63, 'inside with padding');
  }
  for (let i = 0; i < placed.length; i++) for (let j = i + 1; j < placed.length; j++) {
    const a = placed[i], b = placed[j];
    assert.ok(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y, `overlap ${i},${j}`);
  }
  assert.equal(new ShelfPacker(10, 10).pack(20, 5), null, 'too wide');
});

test('Atlas allocates, draws via callback, versions, and rejects duplicates / overflow', () => {
  const calls = [];
  const ctx = {
    save() {}, restore() {}, beginPath() {}, clip() {},
    rect: (...a) => calls.push(['rect', ...a]),
  };
  const atlas = new Atlas({ size: 32, createCanvas: () => ({ getContext: () => ctx }) });
  let drawn;
  const s = atlas.add('dot', 8, 8, (c, x, y, w, h) => { drawn = [x, y, w, h]; });
  assert.deepEqual(drawn, [1, 1, 8, 8]);
  assert.deepEqual([s.u0, s.v0, s.u1, s.v1], [1 / 32, 1 / 32, 9 / 32, 9 / 32]);
  assert.equal(atlas.version, 1);
  assert.equal(atlas.get('dot'), s);
  assert.throws(() => atlas.add('dot', 4, 4, () => {}), /already has/);
  assert.throws(() => atlas.get('nope'), /no sprite/);
  assert.throws(() => atlas.add('huge', 64, 64, () => {}), /atlas full/);
});
