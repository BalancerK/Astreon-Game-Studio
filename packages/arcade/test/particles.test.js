import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newGame, all } from '../src/things.js';
import { effects, burst } from '../src/effects.js';
import { emit, stream, cleanRecipe, recipeProblems, PARTICLE_LIMITS } from '../src/particles.js';

const fire = { rate: 40, colors: ['#ffd23c', '#ff7a3c'], shape: 'circle', speed: [20, 60], angle: -90, spread: 40, life: [0.4, 0.9], size: [8, 1], gravity: -60 };

test('an effect recipe is made safe: defaults, limits, colors, pairs', () => {
  const d = cleanRecipe(undefined);
  assert.deepEqual([d.count, d.shape, d.fade, d.colors], [16, 'square', true, ['#ffd23c']]);
  const r = cleanRecipe({ count: 99999, rate: -5, colors: ['red', '#abc', 7, '#112233', '#1', '#aabbcc', '#000', '#fff', '#f0f'], speed: [1, 'x'], life: [0, 99], size: 5, drag: 50, shape: 'star', fade: false });
  assert.equal(r.count, PARTICLE_LIMITS.count);
  assert.equal(r.rate, 0);
  assert.deepEqual(r.colors, ['#abc', '#112233', '#aabbcc', '#000', '#fff', '#f0f'], 'only real colors, at most six');
  assert.deepEqual(r.speed, [1, 160], 'a bad number falls back to the default');
  assert.deepEqual(r.life, [0.05, PARTICLE_LIMITS.life]);
  assert.deepEqual(r.size, [4, 1], 'not a pair: the default');
  assert.equal(r.drag, 5);
  assert.equal(r.shape, 'square');
  assert.equal(r.fade, false);
  assert.equal(cleanRecipe({ colors: [] }).colors.length, 1);
});

test('emit makes the particles of one burst, as plain things in the game, the same every time', () => {
  const run = () => { const g = newGame(); emit(g, { ...fire, count: 20 }, 100, 100); return JSON.parse(JSON.stringify(g.things)); };
  const a = run();
  assert.equal(a.length, 20);
  assert.deepEqual(a, run(), 'the same particles from the same seed');
  assert.ok(a.every((p) => p.kind === 'spark' && p.shape === 'circle' && ['#ffd23c', '#ff7a3c'].includes(p.color) && p.life >= 0.4 && p.life <= 0.9));
  assert.ok(a.every((p) => p.vy < 0 && Math.abs(p.vx) <= Math.abs(p.vy) * Math.tan(((20 + 0.01) * Math.PI) / 180) + 1e-6), 'a spray of 40 degrees pointing up');
  assert.ok(new Set(a.map((p) => p.color)).size === 2, 'both colors are used');
});

test('the angle and spread aim the spray, and the radius spreads where it starts', () => {
  const g = newGame();
  emit(g, { count: 60, angle: 0, spread: 0, speed: [100, 100], radius: 0 }, 50, 50);
  assert.ok(all(g, 'spark').every((p) => Math.abs(p.vx - 100) < 1e-6 && Math.abs(p.vy) < 1e-6), 'straight right');
  const h = newGame();
  emit(h, { count: 100, radius: 30, size: [0, 0] }, 0, 0);
  const far = Math.max(...all(h, 'spark').map((p) => Math.hypot(p.x, p.y)));
  assert.ok(far > 10 && far <= 30.001, `starts within the radius (${far})`);
  const full = newGame();
  emit(full, { count: 200, spread: 360, angle: 0 }, 0, 0);
  const ups = all(full, 'spark').filter((p) => p.vy < 0).length;
  assert.ok(ups > 60 && ups < 140, 'a full circle goes every way');
});

test('stream makes particles at its rate whatever the frame rate, and keeps its own count for each key', () => {
  const total = (fps) => {
    const g = newGame();
    let n = 0;
    for (let i = 0; i < fps * 2; i++) n += stream(g, { rate: 40 }, 0, 0, 1 / fps);
    return n;
  };
  for (const fps of [20, 30, 60, 144]) assert.ok(Math.abs(total(fps) - 80) <= 1, `${fps} fps made ${total(fps)}`);
  const g = newGame();
  for (let i = 0; i < 60; i++) { stream(g, { rate: 10 }, 0, 0, 1 / 60, 'a'); stream(g, { rate: 20 }, 0, 0, 1 / 60, 'b'); }
  assert.equal(all(g, 'spark').length, 30, 'one second of 10 a second and 20 a second');
  assert.ok(g.streams.a < 1 && g.streams.b < 1);
});

test('particles are bounded: a stream and bursts together cannot make more than the cap', () => {
  const g = newGame();
  for (let i = 0; i < 30; i++) { emit(g, { count: 200 }, 0, 0); stream(g, { rate: 300 }, 0, 0, 1); }
  assert.ok(all(g, 'spark').length <= 400);
  burst(g, 0, 0, { count: 100 });
  assert.ok(all(g, 'spark').length <= 400, 'burst shares the same cap');
});

test('effects() ages the particles: they shrink or grow, slow down, float up with negative gravity, fade, and go', () => {
  const g = newGame();
  emit(g, { count: 1, speed: [0, 0], size: [10, 2], life: [1, 1], gravity: -100, radius: 0 }, 100, 100);
  const p = all(g, 'spark')[0];
  const cx = p.x + p.w / 2;
  for (let i = 0; i < 30; i++) effects(g, 1 / 60);
  assert.ok(p.w < 10 && p.w > 2 && p.w === p.h, `shrinking (${p.w})`);
  assert.ok(p.vy < 0 && p.y + p.h / 2 < 100, 'floating up');
  assert.ok(Math.abs(p.x + p.w / 2 - cx) < 1e-6, 'it shrinks around its middle');
  assert.ok(p.alpha < 1 && p.alpha > 0, 'fading');
  for (let i = 0; i < 40; i++) effects(g, 1 / 60);
  assert.equal(all(g, 'spark').length, 0, 'gone when its life is over');
  const d = newGame();
  emit(d, { count: 1, speed: [100, 100], angle: 0, spread: 0, drag: 3, life: [2, 2], fade: false }, 0, 0);
  for (let i = 0; i < 60; i++) effects(d, 1 / 60);
  const q = all(d, 'spark')[0];
  assert.ok(q.vx < 20 && q.vx > 0, `slowed by drag (${q.vx})`);
  assert.equal(q.alpha, 1, 'fade off keeps it solid');
});

test('plain bursts still work as before (no size or drag fields)', () => {
  const g = newGame();
  burst(g, 0, 0, { count: 5, size: 6, life: 0.4 });
  const p = all(g, 'spark')[0];
  assert.equal(p.size0, undefined);
  effects(g, 0.1);
  assert.equal(p.w, 6);
  assert.ok(p.alpha < 1);
});

test('the check says what was changed or is missing', () => {
  assert.deepEqual(recipeProblems(fire), []);
  assert.equal(recipeProblems(null).length, 1);
  const kinds = recipeProblems({ count: 9999, colors: [], speed: [0, 99999], life: [2, 1] }).map((p) => p.field).sort();
  assert.deepEqual(kinds, ['colors', 'count', 'life', 'speed']);
});
