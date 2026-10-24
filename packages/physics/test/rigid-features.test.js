import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PhysicsWorld, RigidBody, box, sphere, capsule, resetBodyIds } from '../src/index.js';
import { TriWorld } from '../src/tri-world.js';

const near = (a, b, eps, msg = '') => assert.ok(Math.abs(a - b) <= eps, `${msg} ${a} is not within ${eps} of ${b}`);
const ground = (extra) => { const t = new TriWorld({ cellSize: 4 }); t.addBox(0, -1, 0, 80, 1, 80); extra?.(t); t.build(); return t; };
const run = (w, seconds, dt = 1 / 60) => { for (let i = 0; i < Math.round(seconds / dt); i++) w.step(dt); };

test('a kinematic platform carries a crate that rests on it, and pushes one in its way', () => {
  const w = new PhysicsWorld({ terrain: ground(), substeps: 4 });
  const platform = w.add(new RigidBody({ shape: box(2, 0.25, 2), type: 'kinematic', x: 0, y: 1, z: 0, friction: 0.9 }));
  const crate = w.add(new RigidBody({ shape: box(0.4, 0.4, 0.4), x: 0, y: 1.7, z: 0, friction: 0.9 }));
  run(w, 1);
  assert.ok(Math.abs(crate.y - 1.65) < 0.02, `resting on it: ${crate.y}`);
  for (let i = 0; i < 180; i++) { w.moveKinematic(platform, platform.x + 2 / 60, 1, 0, 1 / 60); w.step(1 / 60); }
  near(platform.x, 6, 0.05, 'the platform moved 3 s at 2 m/s');
  near(crate.x, platform.x, 0.35, 'and the crate rode along');
  assert.ok(Math.abs(crate.vx - 2) < 0.2);
  const blocker = w.add(new RigidBody({ shape: box(0.4, 0.4, 0.4), x: platform.x + 3.2, y: 0.4, mass: 20 }));
  for (let i = 0; i < 120; i++) { w.moveKinematic(platform, platform.x + 2 / 60, 1, 0, 1 / 60); w.step(1 / 60); }
  assert.ok(blocker.x > platform.x + 2 - 3.2 + 3.2 - 0.1 || blocker.vx > 0 || blocker.x > platform.x + 3.2, 'it does not pass through a body in its way');
});

test('a sleeping crate on a moving platform wakes and goes with it', () => {
  const w = new PhysicsWorld({ substeps: 4 });
  const platform = w.add(new RigidBody({ shape: box(3, 0.25, 3), type: 'kinematic', y: 0, friction: 1 }));
  const crate = w.add(new RigidBody({ shape: box(0.4, 0.4, 0.4), y: 0.65, friction: 1 }));
  run(w, 1.5);
  assert.ok(crate.sleeping, 'it fell asleep on the still platform');
  for (let i = 0; i < 90; i++) { w.moveKinematic(platform, platform.x + 1.5 / 60, 0, 0, 1 / 60); w.step(1 / 60); }
  assert.ok(!crate.sleeping && crate.x > 0.8, `it woke and rode: x = ${crate.x}`);
});

test('sensors report who enters and leaves and push nothing', () => {
  const w = new PhysicsWorld({ terrain: ground() });
  const zone = w.add(new RigidBody({ shape: box(1, 1, 1), type: 'static', x: 0, y: 2, z: 0, sensor: true }));
  const ball = w.add(new RigidBody({ shape: sphere(0.3), x: 0, y: 6, z: 0 }));
  const log = [];
  w.onTrigger = (s, b, entered) => log.push([s === zone, b === ball, entered, Math.round(ball.y * 10) / 10]);
  run(w, 2);
  assert.equal(log.length, 2);
  assert.deepEqual(log[0].slice(0, 3), [true, true, true]); assert.deepEqual(log[1].slice(0, 3), [true, true, false]);
  assert.ok(log[0][3] > 2.5 && log[1][3] < 2.2, 'entered from above, left below');
  near(ball.y, 0.3, 0.01, 'it fell straight through and landed');
});

test('contact events: begin with the impact speed, end when it leaves; the static world appears as null', () => {
  const w = new PhysicsWorld({ terrain: ground() });
  const ball = w.add(new RigidBody({ shape: sphere(0.5), y: 5, restitution: 0.5 }));
  const log = [];
  w.onContactBegin = (a, b, speed) => log.push(['begin', a === ball, b, speed]);
  w.onContactEnd = (a, b) => log.push(['end', a === ball, b]);
  run(w, 2);
  const first = log[0];
  assert.equal(first[0], 'begin'); assert.equal(first[2], null);
  near(first[3], Math.sqrt(2 * 9.81 * 4.5), 0.8, 'impact speed');
  assert.ok(log.some((e) => e[0] === 'end'), 'it bounced off');
  assert.ok(log.filter((e) => e[0] === 'begin').length >= 2, 'and landed again');
  const other = w.add(new RigidBody({ shape: box(0.5, 0.5, 0.5), x: 5, y: 0.5 }));
  const log2 = [];
  w.onContactBegin = (a, b) => log2.push([a, b]);
  const dropper = w.add(new RigidBody({ shape: box(0.3, 0.3, 0.3), x: 5, y: 3 }));
  run(w, 2);
  assert.ok(log2.some(([a, b]) => (a === dropper && b === other) || (a === other && b === dropper)), 'a body-body contact is reported with both');
});

test('ray casts find bodies of every shape and the static world, nearest first, with the right normals', () => {
  const w = new PhysicsWorld({ terrain: ground() });
  const s = w.add(new RigidBody({ shape: sphere(1), x: 0, y: 1, z: -10, type: 'static' }));
  const b = w.add(new RigidBody({ shape: box(1, 1, 1), x: 5, y: 1, z: -10, type: 'static', rotation: [0, 0.3826834323650898, 0, 0.9238795325112867] }));
  const c = w.add(new RigidBody({ shape: capsule(0.5, 1), x: -5, y: 1.5, z: -10, type: 'static' }));
  const hit = {};
  assert.ok(w.raycast(0, 1, 0, 0, 0, -1, 100, hit)); assert.equal(hit.body, s); near(hit.t, 9, 1e-9); near(hit.nz, 1, 1e-9); near(hit.z, -9, 1e-9);
  assert.ok(w.raycast(5, 1, 0, 0, 0, -1, 100, hit)); assert.equal(hit.body, b); near(hit.t, 10 - Math.SQRT2, 1e-9); near(Math.abs(hit.nx) + Math.abs(hit.nz), Math.SQRT2, 1e-9);
  assert.ok(w.raycast(-5, 1.5, 0, 0, 0, -1, 100, hit)); assert.equal(hit.body, c); near(hit.t, 9.5, 1e-9);
  assert.ok(w.raycast(-5, 2.8, 0, 0, 0, -1, 100, hit) === true); assert.equal(hit.body, c, 'the cap');
  assert.ok(w.raycast(-5, 0.6, -20, 0, 0, 1, 100, hit)); assert.equal(hit.body, c); near(hit.nz, -1, 1e-9);
  assert.ok(w.raycast(0, 10, 0, 0, -1, 0, 100, hit)); assert.equal(hit.body, null, 'the ground'); near(hit.y, 0, 1e-9); near(hit.ny, 1, 1e-9);
  assert.ok(!w.raycast(0, 1, 0, 0, 0, 1, 100, hit) || hit.body === null, 'nothing behind');
  assert.ok(!w.raycast(0, 1, 0, 0, 0, -1, 5, hit), 'out of range');
  assert.ok(w.raycast(0, 10, -10, 0, -1, 0, 100, hit) && hit.body === s, 'from above it hits the ball first');
  assert.ok(w.raycast(0, 10, -10, 0, -1, 0, 100, hit, (body) => body !== s) && hit.body === null, 'a filter skips bodies: now only the ground');
  const zone = w.add(new RigidBody({ shape: box(1, 1, 1), type: 'static', x: 0, y: 1, z: -4, sensor: true }));
  assert.ok(w.raycast(0, 1, 0, 0, 0, -1, 100, hit) && hit.body === s, 'sensors are invisible to rays'); assert.ok(zone.sensor);
});

test('collision groups and masks decide who collides', () => {
  const w = new PhysicsWorld({ terrain: ground() });
  const ghost = w.add(new RigidBody({ shape: box(0.5, 0.5, 0.5), y: 3, group: 2, mask: 0b100 }));   // collides only with group 4
  const solid = w.add(new RigidBody({ shape: box(0.5, 0.5, 0.5), y: 0.5, group: 1, mask: 0xffff }));
  run(w, 2);
  assert.ok(ghost.y < 0.5, `it passed through the other box: ${ghost.y}`);
  const w2 = new PhysicsWorld({ terrain: ground() });
  const a = w2.add(new RigidBody({ shape: sphere(0.5), x: 0, y: 3, group: 4, mask: 0xffff }));
  const b = w2.add(new RigidBody({ shape: sphere(0.5), x: 0, y: 0.5, group: 8, mask: 0xffff }));
  run(w2, 2);
  assert.ok(a.y > 1.2 && Math.abs(b.y - 0.5) < 0.02, 'both masks allow it: a lands on b');
});

test('a fast bullet cannot tunnel through a zero-thickness wall; a slow ball bounces off it', () => {
  const wall = ground((t) => t.addQuad(-20, 0, -10, 20, 0, -10, 20, 10, -10, -20, 10, -10));
  for (const speed of [20, 90, 300, 1500]) {
    const w = new PhysicsWorld({ terrain: wall, gravity: [0, 0, 0] });
    const b = w.add(new RigidBody({ shape: sphere(0.1), x: 0, y: 2, z: 0, mass: 0.1, bullet: true, restitution: 0.2 }));
    b.setVelocity(0, 0, -speed);
    run(w, 1.5);
    assert.ok(b.z > -10 - 1e-3, `at ${speed} m/s it stayed on the near side: z = ${b.z}`);
  }
  const heavy = new PhysicsWorld({ terrain: wall, gravity: [0, 0, 0] });
  const slow = heavy.add(new RigidBody({ shape: sphere(0.3), z: -5, y: 2, restitution: 0.7, linearDamping: 0 }));
  slow.setVelocity(0, 0, -5);
  run(heavy, 3);
  assert.ok(slow.vz > 2.5, `it bounced back: ${slow.vz}`);
});

test('an island of bodies sleeps together and wakes together when something hits it', () => {
  const w = new PhysicsWorld({ terrain: ground() });
  const pile = [0, 1, 2].map((i) => w.add(new RigidBody({ shape: box(0.5, 0.5, 0.5), x: 0, y: 0.5 + i * 1.0, z: 0 })));
  const far = w.add(new RigidBody({ shape: box(0.5, 0.5, 0.5), x: 20, y: 0.5 }));
  run(w, 3);
  assert.ok(pile.every((b) => b.sleeping) && far.sleeping);
  assert.equal(w.stats.awake, 0); assert.equal(w.stats.asleep, 4);
  const ball = w.add(new RigidBody({ shape: sphere(0.3), x: 0, y: 6, z: 0.2, mass: 5 }));
  run(w, 1.2);
  assert.ok(pile.every((b) => !b.sleeping), 'hitting the top wakes the whole pile');
  assert.ok(far.sleeping, 'and nothing else');
  run(w, 5);
  assert.ok(ball.sleeping || ball.y < 1.2);
});

test('queries: boxes overlapping a region and a sphere', () => {
  const w = new PhysicsWorld();
  const a = w.add(new RigidBody({ shape: sphere(1), x: 0, y: 0, z: 0, type: 'static' }));
  const b = w.add(new RigidBody({ shape: box(1, 1, 1), x: 3, y: 0, z: 0, type: 'static' }));
  const c = w.add(new RigidBody({ shape: capsule(0.5, 1), x: 0, y: 5, z: 0, type: 'static' }));
  assert.deepEqual(w.queryAabb(-1, -1, -1, 4, 1, 1), [a, b]);
  assert.deepEqual(w.overlapSphere(1.5, 0, 0, 0.6), [a, b], 'touches both');
  assert.deepEqual(w.overlapSphere(0, 3.6, 0, 0.5), [c], 'the capsule reaches down to y = 3.5');
  assert.deepEqual(w.overlapSphere(10, 10, 10, 1), []);
});

test('removing a body takes its joints with it and later steps run fine', () => {
  const w = new PhysicsWorld({ terrain: ground() });
  const a = w.add(new RigidBody({ shape: sphere(0.3), y: 3 })), b = w.add(new RigidBody({ shape: sphere(0.3), y: 3, x: 1 }));
  assert.equal(w.bodies.length, 2);
  w.remove(a);
  assert.equal(w.bodies.length, 1); assert.equal(b.index, 0);
  run(w, 2);
  near(b.y, 0.3, 0.01);
  w.remove(a); // already gone: harmless
});

test('the state can be saved and restored: the same steps from it give exactly the same result', () => {
  const make = () => {
    resetBodyIds(); // the same bodies get the same numbers in every copy of the scene
    const w = new PhysicsWorld({ terrain: ground() });
    for (let i = 0; i < 12; i++) w.add(new RigidBody({ shape: i % 3 === 0 ? sphere(0.4) : i % 3 === 1 ? box(0.4, 0.3, 0.5) : capsule(0.25, 0.4), x: (i % 4) * 1.3 - 2, y: 2 + i * 0.9, z: Math.floor(i / 4) * 1.1, rotation: [0.1 * i, 0.2, 0.05, 0.97], restitution: 0.2 }));
    return w;
  };
  const w = make();
  run(w, 1);
  const saved = JSON.parse(JSON.stringify(w.getState())); // through JSON: it really is plain data
  run(w, 2);
  const direct = w.getState();
  const w2 = make();
  w2.setState(saved);
  run(w2, 2);
  assert.deepEqual(w2.getState(), direct, 'bit-for-bit: restoring a save is not an approximation');
  const w3 = make();
  run(w3, 3);
  assert.deepEqual(w3.getState(), direct, 'and so is simply running it again');
});

test('a saved state is matched by key, so a scene rebuilt in another order (and with new ids) is restored and carries on the same', () => {
  const make = (reverse) => {
    resetBodyIds();
    const w = new PhysicsWorld({ terrain: ground() });
    const specs = [0, 1, 2, 3, 4, 5].map((i) => ({ key: `b${i}`, shape: i % 2 ? sphere(0.4) : box(0.4, 0.3, 0.4), x: (i % 3) * 1.2 - 1.2, y: 1 + i * 1.1, z: 0.15 * i }));
    for (const s of reverse ? specs.slice().reverse() : specs) { const b = new RigidBody(s); b.key = s.key; w.add(b); }
    return w;
  };
  const w = make(false); run(w, 1.2);
  const saved = JSON.parse(JSON.stringify(w.getState()));
  run(w, 1);
  const w2 = make(true); w2.setState(saved); run(w2, 1);
  const pos = (world) => world.bodies.slice().sort((a, b) => a.key < b.key ? -1 : 1).map((b) => [b.x, b.y, b.z]);
  for (let i = 0; i < 6; i++) for (let k = 0; k < 3; k++) near(pos(w2)[i][k], pos(w)[i][k], 1e-6, `body ${i}`);
  const w3 = make(true); w3.setState({ ...saved, bodies: saved.bodies.map((s) => ({ ...s, key: s.key === 'b0' ? 'gone' : s.key })) });
  assert.ok(w3.bodies.every((b) => b.key === 'b0' || b.y > 0.2), 'a saved body with no match is ignored, the rest are restored');
});

test('a big pile stays finite and ends up resting (a stress test)', () => {
  const w = new PhysicsWorld({ terrain: ground(), substeps: 2 });
  for (let i = 0; i < 150; i++) {
    const shape = i % 3 === 0 ? sphere(0.3 + (i % 5) * 0.05) : i % 3 === 1 ? box(0.3, 0.3 + (i % 4) * 0.05, 0.4) : capsule(0.25, 0.4);
    w.add(new RigidBody({ shape, x: ((i * 37) % 11) * 0.35 - 2, y: 1 + Math.floor(i / 9) * 0.9, z: ((i * 53) % 9) * 0.35 - 1.4, rotation: [0.1 * (i % 7), 0.2, 0.1 * (i % 5), 1], mass: 5 }));
  }
  run(w, 8);
  for (const b of w.bodies) { assert.ok(Number.isFinite(b.x + b.y + b.z + b.qw), 'finite'); assert.ok(b.y > 0.1 && b.y < 12, `${b.id} y=${b.y}`); }
  assert.ok(w.bodies.filter((b) => b.sleeping).length > 100, `most of the pile sleeps: ${w.stats.asleep}`);
});
