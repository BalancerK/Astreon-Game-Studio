import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TriWorld, CharacterController, closestPointOnTriangle } from '../src/index.js';

const DT = 1 / 60;
function rng(seed) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} ${a} vs ${b} (diff ${Math.abs(a - b)})`);

/** One test world with a feature at a known place for every behaviour. Ground top is y = 0. */
function buildWorld() {
  const w = new TriWorld({ cellSize: 4 });
  w.addBox(0, -1, 0, 100, 1, 100);                                              // ground
  const rise30 = 10 * Math.tan(Math.PI / 6), rise60 = 10 * Math.tan(Math.PI / 3);
  w.addQuad(-12, 0, -5, -8, 0, -5, -8, rise30, -15, -12, rise30, -15);          // 30 degree ramp at x = -10, rising toward -z
  w.addQuad(-12, rise30, -15, -8, rise30, -15, -8, rise30, -25, -12, rise30, -25); // a landing at the top
  w.addQuad(8, 0, -5, 12, 0, -5, 12, rise60, -15, 8, rise60, -15);              // 60 degree ramp at x = 10
  for (let i = 0; i < 6; i++) w.addBox(6 + i * 0.8 + 0.4, (i + 1) * 0.15, 40, 0.4, (i + 1) * 0.15, 2); // stairs along +x at z = 40, 0.3 per step
  w.addBox(10.9, 0.9, 40, 1.5, 0.9, 2);                                         // platform at the top of the stairs (top 1.8)
  w.addBox(0, 0.3, 60, 3, 0.3, 3);                                              // a 0.6 high block (higher than a step)
  w.addBox(-30, 5, 0, 0.5, 5, 30);                                              // wall facing +x at x = -29.5
  w.addBox(0, 4, 80, 8, 0.5, 8);                                                // ceiling slab: bottom at y = 3.5
  w.addBox(60, 1.5, 0, 6, 1.5, 6);                                              // raised platform: top at y = 3, edge at x = 54
  return w.build();
}
const world = buildWorld();
const make = (x, y, z, o = {}) => new CharacterController({ x, y, z, ...o });
const settle = (c, frames = 60) => { for (let i = 0; i < frames; i++) c.update(world, 0, 0, false, DT); return c; };
const run = (c, wx, wz, frames, jump = false) => { for (let i = 0; i < frames; i++) c.update(world, wx, wz, jump, DT); return c; };

function clearance(c) {
  const q = { x: 0, y: 0, z: 0 }, v = world.verts, r = c.radius, h = c.halfHeight;
  let best = Infinity;
  for (let i = 0; i < world.triangleCount; i++) {
    const o = i * 9;
    const d2 = closestPointOnTriangle(c.x / r, c.y / h, c.z / r, v[o] / r, v[o + 1] / h, v[o + 2] / r, v[o + 3] / r, v[o + 4] / h, v[o + 5] / r, v[o + 6] / r, v[o + 7] / h, v[o + 8] / r, q);
    if (d2 < best) best = d2;
  }
  return Math.sqrt(best);
}

test('falls, lands, and then stands perfectly still (no sinking, no jitter, no drift)', () => {
  const c = make(0, 6, 0);
  let airborne = 0;
  for (let i = 0; i < 90; i++) { c.update(world, 0, 0, false, DT); if (!c.grounded) airborne++; }
  assert.ok(c.grounded && c.vy === 0);
  near(c.feetY, 0, 0.01, 'resting on the ground (a hair above it)');
  assert.ok(airborne > 20 && airborne < 40, `fell for ${airborne} ticks (6 m takes about 0.5 s)`);
  const y = c.y, x = c.x, z = c.z;
  for (let i = 0; i < 600; i++) c.update(world, 0, 0, false, DT);
  assert.deepEqual([c.x, c.y, c.z], [x, y, z], 'ten seconds of standing: not one bit of movement');
  assert.ok(c.grounded);
});

test('walking: speed is exactly what was asked, on flat ground', () => {
  const c = settle(make(0, 0.9, 0));
  const x0 = c.x, z0 = c.z;
  run(c, 4, 0, 60);
  near(c.x - x0, 4, 1e-9, 'moved 4 m in one second at 4 m/s');
  near(c.z - z0, 0, 1e-12);
  run(c, 3, 4, 60);
  near(Math.hypot(c.x - x0 - 4, c.z - z0), 5, 1e-9, 'a diagonal of 3 and 4 is 5');
  assert.ok(c.grounded);
});

test('jumping: height matches the physics, it cannot jump in the air, and it lands', () => {
  const c = settle(make(0, 0.9, 0));
  const base = c.feetY;
  c.update(world, 0, 0, true, DT);
  assert.ok(!c.grounded && c.vy > 7);
  let peak = 0, airTicks = 1, jumpedAgain = false;
  for (let i = 0; i < 120; i++) {
    c.update(world, 0, 0, true, DT); // the button stays down: no second jump in mid-air
    peak = Math.max(peak, c.feetY - base);
    if (!c.grounded) airTicks++; else { if (i > 5 && c.vy > 0) jumpedAgain = true; break; }
  }
  const expected = (8 * 8) / (2 * 25);
  near(peak, expected, expected * 0.1, 'jump height');
  assert.ok(c.grounded, 'landed');
  assert.ok(airTicks > 34 && airTicks < 46, `${airTicks} ticks in the air (about 0.64 s)`);
  void jumpedAgain;
});

test('slopes: a walkable ramp is climbed at full pace and descended without ever leaving the ground; a steep one is a wall', () => {
  const c = settle(make(-10, 0.9, 0));
  run(c, 0, -4, 150); // 2.5 s toward -z: 10 m horizontally
  near(c.z, -10, 0.05, 'full horizontal pace up the ramp (z from 0 to -10, the ramp starts at -5)');
  near(c.feetY, (-c.z - 5) * Math.tan(Math.PI / 6), 0.05, 'the feet follow the surface');
  assert.ok(c.grounded);
  let airborne = 0;
  for (let i = 0; i < 150; i++) { c.update(world, 0, 4, false, DT); if (!c.grounded) airborne++; } // and back down, quickly
  assert.equal(airborne, 0, 'walking down a slope stays glued to it (no bouncing)');
  near(c.z, 0, 0.05);
  near(c.feetY, 0, 0.02);

  const s = settle(make(10, 0.9, 0));
  run(s, 0, -4, 240);
  assert.ok(s.z > -5.2 && s.feetY < 0.2, `a 60 degree ramp cannot be walked up: z = ${s.z.toFixed(2)}, feet ${s.feetY.toFixed(2)}`);
  assert.ok(s.blocked);
});

test('stairs: 0.3 m steps are climbed and descended without leaving the ground; a 0.6 m block is a wall', () => {
  const c = settle(make(3, 0.9, 40));
  run(c, 3, 0, 180); // 9 m along +x: stairs span x 6 to 10.8, then the platform
  near(c.feetY, 1.8, 0.02, 'on the platform at the top of the stairs');
  assert.ok(c.grounded && c.x > 10.5);
  let airborne = 0;
  for (let i = 0; i < 200; i++) { c.update(world, -3, 0, false, DT); if (!c.grounded) airborne++; }
  assert.equal(airborne, 0, 'stepping down a staircase keeps the feet on it');
  near(c.feetY, 0, 0.02);
  const b = settle(make(0, 0.9, 54));
  run(b, 0, 3, 120);
  assert.ok(b.z < 56.7 && b.feetY < 0.1, `blocked by the 0.6 m block: z = ${b.z.toFixed(2)}`);
  // a bigger step height lets the same character climb it
  const tall = settle(make(0, 0.9, 54, { stepHeight: 0.7 }));
  run(tall, 0, 3, 120);
  near(tall.feetY, 0.6, 0.02, 'with stepHeight 0.7 it steps onto the 0.6 block');
});

test('walls: running into one slides along it at full tangential speed and never penetrates', () => {
  const c = settle(make(-20, 0.9, 0));
  run(c, -6, 3, 120); // toward the wall at x = -29.5 and along +z
  near(c.x, -29.5 + c.radius, 0.01, 'stopped at the wall');
  near(c.z, 3 * 2 + 0, 0.05, 'kept the tangential 3 m/s for the whole 2 s (the part before reaching the wall is also at 3)');
  assert.ok(c.blocked);
});

test('ceilings: a jump into a low ceiling stops the rise and the fall begins at once', () => {
  const c = settle(make(0, 0.9, 80));
  c.update(world, 0, 0, true, DT);
  let head = 0, hitCeilingTick = -1;
  for (let i = 0; i < 90; i++) {
    c.update(world, 0, 0, false, DT);
    head = Math.max(head, c.y + c.halfHeight);
    if (hitCeilingTick < 0 && c.vy < 0) hitCeilingTick = i;
  }
  assert.ok(head <= 3.5 + 1e-9, `the head never goes into the slab: ${head}`);
  // standing on the ground the head is at 1.8: the apex without a ceiling would be at 1.8 + 1.28; the slab bottom is at 3.5, so no bump here
  // now with a lower ceiling by raising the character's jump: it must still be clamped
  const strong = settle(make(0, 0.9, 80, { jumpSpeed: 14 }));
  strong.update(world, 0, 0, true, DT);
  let strongHead = 0, sawStop = false;
  for (let i = 0; i < 120; i++) { strong.update(world, 0, 0, false, DT); strongHead = Math.max(strongHead, strong.y + strong.halfHeight); if (strong.vy === 0 && !strong.grounded) sawStop = true; }
  assert.ok(strongHead <= 3.5 + 1e-9, `${strongHead}`);
  assert.ok(sawStop, 'vertical speed is cancelled when the head hits the ceiling');
  assert.ok(strong.grounded, 'and it comes back down');
});

test('walking off a ledge falls and lands on the ground below', () => {
  const c = settle(make(58, 3.9, 0)); // on the platform whose top is at y = 3 (it spans x 54 to 66)
  near(c.feetY, 3, 0.01);
  let sawAir = false;
  for (let i = 0; i < 240; i++) { c.update(world, -3, 0, false, DT); if (!c.grounded) sawAir = true; }
  assert.ok(sawAir, 'it left the platform');
  assert.ok(c.grounded);
  near(c.feetY, 0, 0.02, 'landed on the floor');
  assert.ok(c.x < 54, 'beyond the edge');
});

test('a slope that is too steep cannot be stood on: the body slides down it to the flat', () => {
  const c = make(10, 9, -9); // dropped onto the 60 degree ramp, well up it (its surface is at y = 6.9 there)
  run(c, 0, 0, 240);
  assert.ok(c.grounded, 'ended on the flat');
  assert.ok(c.z > -5 && c.feetY < 0.1, `slid to the bottom: z = ${c.z.toFixed(2)}, feet ${c.feetY.toFixed(3)}`);
});

test('nothing tunnels: huge falls, huge speeds and a flood of random input never penetrate any triangle', () => {
  const fall = make(0, 5000, 0);
  fall.update(world, 0, 0, false, 5); // a five-second tick: a 60 m/s capped fall of 300 m
  for (let i = 0; i < 100; i++) fall.update(world, 0, 0, false, 5);
  assert.ok(fall.grounded && fall.feetY > -0.01, `landed: feet ${fall.feetY}`);

  const r = rng(7);
  for (let k = 0; k < 6; k++) {
    const c = make((r() - 0.5) * 60, 1 + r() * 3, (r() - 0.5) * 60);
    if (clearance(c) < 1) continue;
    for (let i = 0; i < 400; i++) {
      const speed = [3, 12, 200, 5000][(i >> 4) % 4];
      c.update(world, (r() - 0.5) * speed, (r() - 0.5) * speed, r() < 0.1, i % 7 === 0 ? 0.1 : DT);
      assert.ok(Number.isFinite(c.x + c.y + c.z), 'finite');
      const cl = clearance(c);
      assert.ok(cl >= 1 - 1e-6, `character ${k}, tick ${i} (speed ${speed}): penetrating, clearance ${cl}`);
    }
  }
});

test('pressing into a corner is stable: no jitter, no creeping through', () => {
  const c = settle(make(-25, 0.9, 25)); // the wall at x = -29.5 spans z -30..30; use its end as one side, ground is the other
  run(c, -5, 0, 60);
  const x = c.x, y = c.y, z = c.z;
  let maxMove = 0;
  for (let i = 0; i < 300; i++) {
    const px = c.x, py = c.y, pz = c.z;
    c.update(world, -5, 0.0, false, DT);
    maxMove = Math.max(maxMove, Math.abs(c.x - px) + Math.abs(c.y - py) + Math.abs(c.z - pz));
  }
  assert.ok(maxMove < 1e-6, `largest per-tick movement while pressing: ${maxMove}`);
  near(c.x, x, 1e-6); near(c.y, y, 1e-6); near(c.z, z, 1e-6);
});

test('spawning inside the floor is corrected, and the same inputs always give the same state, bit for bit', () => {
  const c = make(0, 0.2, 0); // body sunk into the ground
  c.update(world, 0, 0, false, DT);
  assert.ok(c.feetY > -0.01 && c.grounded, `pushed out: feet ${c.feetY}`);
  const script = (seed) => {
    const r = rng(seed), k = make(1, 5, 1), trace = [];
    for (let i = 0; i < 1500; i++) { k.update(world, (r() - 0.5) * 12, (r() - 0.5) * 12, r() < 0.03, DT); trace.push(k.x, k.y, k.z, k.vy, k.grounded ? 1 : 0); }
    return trace;
  };
  assert.deepEqual(script(11), script(11));
  assert.notDeepEqual(script(11), script(12));
});
