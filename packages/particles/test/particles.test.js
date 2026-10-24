import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ParticleSystem, effects, seededRandom } from '../src/index.js';
import { ParticleBatch, PARTICLE_FLOATS } from '../../render/src/index.js';

const near = (a, b, eps = 1e-4) => assert.ok(Math.abs(a - b) <= eps, `${a} is not within ${eps} of ${b}`);
const collect = (sys) => { const rows = []; sys.writeTo({ push: (...a) => rows.push(a) }); return rows; };

test('a burst spawns the requested number, within the cone, at the requested speed', () => {
  const sys = new ParticleSystem({ random: seededRandom(5) });
  sys.burst({ count: 200, speed: 10, spread: 0.3, life: 1 }, 1, 2, 3, { dir: [0, 0, 1] });
  assert.equal(sys.count, 200);
  for (let i = 0; i < sys.count; i++) {
    const sp = Math.hypot(sys.vx[i], sys.vy[i], sys.vz[i]);
    near(sp, 10, 1e-3);
    const angle = Math.acos(sys.vz[i] / sp);
    assert.ok(angle <= 0.3 + 1e-4, `angle ${angle}`);
    assert.deepEqual([sys.x[i], sys.y[i], sys.z[i]], [1, 2, 3]);
  }
  const sphere = new ParticleSystem({ random: seededRandom(5) });
  sphere.burst({ count: 400, speed: 1, spread: Math.PI }, 0, 0, 0);
  const up = [...Array(400).keys()].filter((i) => sphere.vy[i] > 0).length;
  assert.ok(up > 150 && up < 250, `about half go up: ${up}`);
});

test('ranges, scale and amount: count, life, size and speed follow them', () => {
  const sys = new ParticleSystem({ random: seededRandom(2) });
  sys.burst({ count: [10, 20], life: [1, 2], size: [0.1, 0.2], speed: 4 }, 0, 0, 0, { scale: 2, amount: 0.5 });
  assert.ok(sys.count >= 5 && sys.count <= 10, `count ${sys.count}`);
  for (let i = 0; i < sys.count; i++) {
    assert.ok(sys.life[i] >= 1 && sys.life[i] <= 2);
    assert.ok(sys.s0[i] >= 0.2 - 1e-6 && sys.s0[i] <= 0.4 + 1e-6, 'size doubles with scale');
    near(Math.hypot(sys.vx[i], sys.vy[i], sys.vz[i]), 8, 1e-3);
  }
});

test('particles live for their life, then are removed without disturbing the others', () => {
  const sys = new ParticleSystem();
  sys.burst({ count: 1, life: 1, color: [1, 0, 0, 1], size: 0.5 }, 0, 0, 0);
  sys.burst({ count: 1, life: 3, color: [0, 1, 0, 1], size: 0.5 }, 5, 0, 0);
  sys.burst({ count: 1, life: 2, color: [0, 0, 1, 1], size: 0.5 }, 9, 0, 0);
  sys.update(1.5);
  assert.equal(sys.count, 2);
  assert.deepEqual(collect(sys).map((r) => r[0]).sort(), [5, 9], 'the survivors keep their own data');
  sys.update(1);
  assert.equal(sys.count, 1);
  sys.update(5);
  assert.equal(sys.count, 0);
});

test('gravity, drag and the floor', () => {
  const sys = new ParticleSystem({ gravity: [0, -10, 0], floorY: 0 });
  sys.burst({ count: 1, life: 10, gravity: 1, size: 0.1 }, 0, 10, 0);
  for (let i = 0; i < 60; i++) sys.update(1 / 60);
  near(sys.vy[0], -10, 0.2);
  near(sys.y[0], 10 - 5, 0.25);
  const drag = new ParticleSystem();
  drag.burst({ count: 1, life: 10, speed: 10, dir: [1, 0, 0], drag: Math.LN2 }, 0, 0, 0);
  for (let i = 0; i < 60; i++) drag.update(1 / 60);
  near(drag.vx[0], 5, 0.01);
  const bounce = new ParticleSystem({ gravity: [0, -10, 0], floorY: 0 });
  bounce.burst({ count: 1, life: 10, gravity: 1, bounce: 0.5, size: 0.1 }, 0, 1, 0);
  let peak = 0, floored = false;
  for (let i = 0; i < 300; i++) { bounce.update(1 / 60); if (bounce.y[0] === 0) floored = true; if (floored) peak = Math.max(peak, bounce.y[0]); assert.ok(bounce.y[0] >= 0); }
  assert.ok(floored && peak > 0.05 && peak < 1, `it bounced to ${peak}`);
  const nofloor = new ParticleSystem({ gravity: [0, -10, 0], floorY: 0 });
  nofloor.burst({ count: 1, life: 10, gravity: 0, size: 0.1 }, 0, -3, 0);
  nofloor.update(0.1);
  assert.equal(nofloor.y[0], -3, 'particles that ignore gravity ignore the floor too (they are not falling)');
});

test('a full system drops new particles and counts them', () => {
  const sys = new ParticleSystem({ capacity: 10 });
  sys.burst({ count: 15, life: 1 }, 0, 0, 0);
  assert.equal(sys.count, 10);
  assert.equal(sys.dropped, 5);
  sys.update(2);
  sys.burst({ count: 4, life: 1 }, 0, 0, 0);
  assert.equal(sys.count, 4);
});

test('writeTo: size and colour interpolate over life; hold keeps the colour; fadeIn ramps opacity', () => {
  const sys = new ParticleSystem();
  sys.burst({ count: 1, life: 1, size: 1, sizeEnd: 3, color: [1, 0, 0, 1], colorEnd: [0, 0, 1, 0] }, 0, 0, 0);
  sys.update(0.5);
  let [row] = collect(sys);
  near(row[3], 2); near(row[4], 0.5); near(row[6], 0.5); near(row[7], 0.5);
  const held = new ParticleSystem();
  held.burst({ count: 1, life: 1, color: [1, 1, 1, 1], colorEnd: [1, 1, 1, 0], hold: 0.8 }, 0, 0, 0);
  held.update(0.5);
  near(collect(held)[0][7], 1);
  held.update(0.4);
  near(collect(held)[0][7], 0.5);
  const fi = new ParticleSystem();
  fi.burst({ count: 1, life: 1, color: [1, 1, 1, 1], colorEnd: [1, 1, 1, 1], fadeIn: 0.5 }, 0, 0, 0);
  fi.update(0.25);
  near(collect(fi)[0][7], 0.5);
  fi.update(0.5);
  near(collect(fi)[0][7], 1);
});

test('a flat decal stays put and keeps its normal; streaks carry their velocity; orient codes match the renderer', () => {
  const sys = new ParticleSystem({ gravity: [0, -10, 0] });
  sys.burst(effects.bulletHole, 3, 1, 4, { dir: [0, 0, -2] });
  sys.burst({ count: 1, life: 1, speed: 6, dir: [1, 0, 0], orient: 'stretch', stretch: 0.1 }, 0, 0, 0);
  sys.update(0.5);
  const [decal, streak] = collect(sys);
  assert.deepEqual([decal[0], decal[1], decal[2]], [3, 1, 4], 'a decal does not move');
  near(decal[10], -1); assert.equal(decal[15], 2);
  near(streak[8], 6, 1e-3); near(streak[11], 0.1); assert.equal(streak[15], 1);
  assert.equal(new ParticleBatch().constructor.name, 'ParticleBatch');
});

test('tint multiplies colour and velocity is inherited', () => {
  const sys = new ParticleSystem();
  sys.burst({ count: 1, life: 1, color: [1, 1, 1, 1], speed: 0 }, 0, 0, 0, { tint: [1, 0.5, 0.25], velocity: [2, 0, -1] });
  const [r] = collect(sys);
  near(r[4], 1); near(r[5], 0.5); near(r[6], 0.25); near(r[8], 2); near(r[10], -1);
});

test('the same seed gives the same effect, and a different seed a different one', () => {
  const run = (seed) => { const s = new ParticleSystem({ random: seededRandom(seed) }); s.burst(effects.impact, 0, 0, 0, { dir: [0, 1, 0] }); s.update(0.1); return JSON.stringify(collect(s)); };
  assert.equal(run(9), run(9));
  assert.notEqual(run(9), run(10));
});

test('an array of effects plays every part', () => {
  const sys = new ParticleSystem({ random: seededRandom(1) });
  sys.burst([{ count: 2 }, { count: 3 }, [{ count: 4 }]], 0, 0, 0);
  assert.equal(sys.count, 9);
});

test('line puts bursts along a segment', () => {
  const sys = new ParticleSystem();
  sys.line({ count: 1, life: 1 }, 0, 0, 0, 10, 0, 0, 2);
  assert.equal(sys.count, 6);
  const xs = collect(sys).map((r) => r[0]).sort((a, b) => a - b);
  assert.deepEqual(xs, [0, 2, 4, 6, 8, 10]);
});

test('an emitter makes bursts by rate, by distance moved, and ends after its life', () => {
  const sys = new ParticleSystem();
  const e = sys.emitter({ count: 1, life: 10 }, { rate: 30, x: 0, y: 0, z: 0 });
  for (let i = 0; i < 60; i++) sys.update(1 / 60);
  assert.ok(sys.count >= 29 && sys.count <= 31, `${sys.count} in one second at 30/s`);
  e.stop();
  const n = sys.count;
  sys.update(1 / 60);
  assert.equal(sys.count, n, 'a stopped emitter makes no more');

  const trail = new ParticleSystem();
  const t = trail.emitter({ count: 1, life: 10 }, { spacing: 0.5, x: 0, y: 0, z: 0 });
  t.move(3, 0, 0); trail.update(1 / 60);
  assert.equal(trail.count, 6, 'one burst per half metre along the path it took');
  const xs = collect(trail).map((r) => r[0]).sort((a, b) => a - b);
  near(xs[0], 0.5); near(xs[5], 3);
  trail.update(1 / 60);
  assert.equal(trail.count, 6, 'standing still makes none');

  const timed = new ParticleSystem();
  timed.emitter({ count: 1, life: 10 }, { rate: 10, life: 0.5 });
  for (let i = 0; i < 120; i++) timed.update(1 / 60);
  assert.equal(timed.emitters.size, 0);
  assert.ok(timed.spawned >= 4 && timed.spawned <= 6, `${timed.spawned}`);
});

test('every ready-made effect spawns something and stays finite for its whole life', () => {
  for (const [name, effect] of Object.entries(effects)) {
    if (name === 'lampHalo') continue;
    const sys = new ParticleSystem({ gravity: [0, -9.8, 0], floorY: 0 });
    sys.burst(effect, 0, 1, 0, { dir: [0, 1, 0] });
    assert.ok(sys.count > 0, name);
    for (let i = 0; i < 600 && sys.count > 0; i++) {
      sys.update(1 / 60);
      for (const r of collect(sys)) for (const v of r) assert.ok(Number.isFinite(v), `${name}: ${r}`);
    }
    if (name !== 'bulletHole') assert.equal(sys.count, 0, `${name} ends within ten seconds`);
  }
  const halo = new ParticleSystem();
  halo.burst(effects.lampHalo, 0, 0, 0);
  halo.update(100);
  assert.equal(halo.count, 1, 'a halo stays');
});

test('writing to a renderer batch fills the layout the shaders read', () => {
  const sys = new ParticleSystem();
  sys.burst({ count: 3, life: 1, size: 0.25, color: [0.1, 0.2, 0.3, 0.4], orient: 'stretch', stretch: 0.5, additive: 1, hardness: 0.7 }, 1, 2, 3);
  const batch = new ParticleBatch(1);
  sys.writeTo(batch);
  assert.equal(batch.count, 3);
  assert.ok(batch.capacity >= 3, 'the batch grew');
  const d = batch.data;
  assert.deepEqual([d[0], d[1], d[2], d[3]], [1, 2, 3, 0.25]);
  near(d[4], 0.1); near(d[5], 0.2); near(d[6], 0.3); near(d[7], 0.4);
  near(d[11], 0.5); near(d[13], 1); near(d[14], 0.7); assert.equal(d[15], 1);
  assert.equal(PARTICLE_FLOATS, 16);
});
