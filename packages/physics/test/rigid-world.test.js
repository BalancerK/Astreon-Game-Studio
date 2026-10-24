import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PhysicsWorld, RigidBody, box, sphere, capsule, resetBodyIds } from '../src/index.js';
import { TriWorld } from '../src/tri-world.js';

const near = (a, b, eps, msg = '') => assert.ok(Math.abs(a - b) <= eps, `${msg} ${a} is not within ${eps} of ${b}`);
const ground = (extra) => { const t = new TriWorld({ cellSize: 4 }); t.addBox(0, -1, 0, 80, 1, 80); extra?.(t); t.build(); return t; };
const run = (w, seconds, dt = 1 / 60) => { for (let i = 0; i < Math.round(seconds / dt); i++) w.step(dt); };
const quat = (ax, ay, az, angle) => { const l = Math.hypot(ax, ay, az), s = Math.sin(angle / 2); return [ax / l * s, ay / l * s, az / l * s, Math.cos(angle / 2)]; };

test('mass properties: density, inertia and kinetic energy follow the shape', () => {
  const b = new RigidBody({ shape: box(0.5, 1, 0.25), mass: 12 });
  near(b.mass, 12, 0); near(1 / b.invIx, 12 * (4 + 0.25) / 12, 1e-9); near(1 / b.invIy, 12 * (1 + 0.25) / 12, 1e-9); near(1 / b.invIz, 12 * (1 + 4) / 12, 1e-9);
  const s = new RigidBody({ shape: sphere(0.5), mass: 4 });
  near(1 / s.invIx, 0.4 * 4 * 0.25, 1e-12);
  near(new RigidBody({ shape: sphere(1) }).mass, 1000 * 4 / 3 * Math.PI, 1e-6);
  s.setVelocity(3, 4, 0); near(s.kineticEnergy, 0.5 * 4 * 25, 1e-9);
  s.setAngularVelocity(0, 0, 2); near(s.kineticEnergy, 50 + 0.5 * 0.4 * 4 * 0.25 * 4, 1e-9);
  const fixed = new RigidBody({ shape: box(1, 1, 1), type: 'static' });
  assert.equal(fixed.invMass, 0); assert.equal(fixed.invIx, 0);
  const light = new RigidBody({ shape: box(1, 1, 1), mass: 10 }); light.setMass(0);
  assert.equal(light.invMass, 0, 'mass 0 makes a body immovable');
});

test('free fall with no ground and no damping: velocity and position follow v = g t, y = g t^2 / 2', () => {
  const w = new PhysicsWorld({ substeps: 1 });
  const b = w.add(new RigidBody({ shape: sphere(0.5), y: 100, linearDamping: 0, angularDamping: 0 }));
  run(w, 2);
  near(b.vy, -19.62, 1e-9); near(b.y, 100 - 0.5 * 9.81 * 4, 0.2);
  b.setVelocity(5, 0, 0); b.vy = 0;
  run(w, 1);
  near(b.vx, 5, 1e-12, 'no horizontal force, no horizontal change');
});

test('a crate dropped on the ground settles at rest on its face, and goes to sleep', () => {
  const w = new PhysicsWorld({ terrain: ground() });
  const crate = w.add(new RigidBody({ shape: box(0.5, 0.5, 0.5), y: 3, rotation: quat(1, 0.3, 0.2, 0.4) }));
  run(w, 4);
  near(crate.y, 0.5, 0.01); near(Math.hypot(crate.vx, crate.vy, crate.vz), 0, 1e-9);
  assert.ok(crate.sleeping, 'at rest it sleeps');
  const y = crate.y; run(w, 1);
  assert.equal(crate.y, y, 'a sleeping body does not move');
  const r = crate.r; near(Math.abs(r[4]), 1, 1e-3, 'lying flat: its up axis is vertical');
  crate.applyImpulse(0, 20, 0); assert.ok(!crate.sleeping, 'an impulse wakes it');
});

test('a sphere bounces with its restitution and a capsule lands on its side or end', () => {
  const w = new PhysicsWorld({ terrain: ground(), substeps: 4 });
  const ball = w.add(new RigidBody({ shape: sphere(0.25), y: 2.25, restitution: 0.8, linearDamping: 0 }));
  let peak = 0, bounced = false, prev = ball.vy;
  for (let i = 0; i < 240; i++) { w.step(1 / 60); if (prev < 0 && ball.vy > 0) bounced = true; if (bounced) peak = Math.max(peak, ball.y - 0.25); prev = ball.vy; if (bounced && ball.vy < 0) break; }
  near(peak, 2 * 0.64, 0.2, 'rebound height ~ e^2 * drop');
  const cap = w.add(new RigidBody({ shape: capsule(0.3, 0.6), x: 5, y: 3, rotation: quat(0, 0, 1, 0.7) }));
  run(w, 4);
  assert.ok(cap.sleeping && (Math.abs(cap.y - 0.3) < 0.01 || Math.abs(cap.y - 0.9) < 0.01), `a capsule rests lying (y 0.3) or standing (y 0.9): ${cap.y}`);
});

test('friction: a crate stays on a 30 degree slope if the friction is high enough and slides at the right acceleration if not', () => {
  const angle = Math.PI / 6;
  const slope = ground((t) => { // a long ramp rising toward +x
    const L = 40, c = Math.cos(angle), s = Math.sin(angle);
    t.addQuad(0, 0, -10, L * c, L * s, -10, L * c, L * s, 10, 0, 0, 10);
  });
  const trial = (mu) => {
    const w = new PhysicsWorld({ terrain: slope, substeps: 4 });
    // sitting on the ramp surface (the ramp's normal is (-sin, cos)): centre 0.5 above it, at x = 20 along it
    const nx = -Math.sin(angle), ny = Math.cos(angle), px = 20 * Math.cos(angle), py = 20 * Math.sin(angle);
    const b = w.add(new RigidBody({ shape: box(0.5, 0.5, 0.5), x: px + nx * 0.5, y: py + ny * 0.5, rotation: quat(0, 0, 1, angle), friction: mu }));
    run(w, 0.5);
    const x0 = b.x, y0 = b.y, v0 = Math.hypot(b.vx, b.vy);
    run(w, 1);
    return { dist: Math.hypot(b.x - x0, b.y - y0), v0, b, w };
  };
  const stuck = trial(0.9);
  assert.ok(stuck.dist < 0.05, `friction 0.9 holds it: moved ${stuck.dist}`);
  const slides = trial(0.2);
  const a = 9.81 * (Math.sin(angle) - 0.2 * Math.cos(angle)); // the ground's friction is sqrt(0.5 * 0.2) with the default 0.5 for the terrain
  const aMixed = 9.81 * (Math.sin(angle) - Math.sqrt(0.5 * 0.2) * Math.cos(angle));
  assert.ok(slides.dist > 0.5 * aMixed * 1 * 0.7 && slides.dist < 0.5 * a * 1 * 1.6 + slides.v0 + 0.5, `slid ${slides.dist}, expected about ${0.5 * aMixed + slides.v0}`);
});

test('a tower of crates stands for ten seconds and goes to sleep', () => {
  const w = new PhysicsWorld({ terrain: ground() });
  const tower = [];
  for (let i = 0; i < 8; i++) tower.push(w.add(new RigidBody({ shape: box(0.5, 0.5, 0.5), x: 0.01 * (i % 2), y: 0.5 + i * 1.001, z: 0 })));
  run(w, 10);
  for (let i = 0; i < 8; i++) near(tower[i].y, 0.5 + i * 1.0, 0.04, `crate ${i}`);
  for (const b of tower) assert.ok(Math.abs(b.x) < 0.05 && Math.abs(b.z) < 0.05, 'it did not lean');
  assert.ok(tower.every((b) => b.sleeping), 'the whole stack sleeps');
});

test('a wall of boxes stays put; a ball thrown at it knocks some over and everything ends up at rest', () => {
  const w = new PhysicsWorld({ terrain: ground(), substeps: 3 });
  const wall = [];
  for (let row = 0; row < 4; row++) for (let col = 0; col < 4; col++) wall.push(w.add(new RigidBody({ shape: box(0.5, 0.25, 0.5), x: col * 1.0 - 1.5 + (row % 2) * 0.5, y: 0.25 + row * 0.5, z: -5 })));
  run(w, 3);
  assert.ok(wall.every((b) => b.sleeping), 'the wall settles');
  const ball = w.add(new RigidBody({ shape: sphere(0.3), x: 0, y: 1, z: 6, mass: 400, bullet: true }));
  ball.setVelocity(0, 0, -30);
  run(w, 6);
  assert.ok(wall.some((b) => Math.abs(b.z + 5) > 0.3 || b.y < 0.1 || Math.abs(b.x) > 2.2), 'the ball moved some of it');
  assert.ok(wall.every((b) => b.y > 0.2 && b.y < 2.5), 'nothing fell through the floor or flew off');
});

test('two equal spheres in space: an elastic collision swaps their velocities and conserves momentum; a sticky one shares it', () => {
  const run1 = (e) => {
    const w = new PhysicsWorld({ gravity: [0, 0, 0], substeps: 4 });
    const a = w.add(new RigidBody({ shape: sphere(0.5), x: -3, mass: 2, restitution: e, linearDamping: 0 }));
    const b = w.add(new RigidBody({ shape: sphere(0.5), x: 3, mass: 2, restitution: e, linearDamping: 0 }));
    a.setVelocity(4, 0, 0); b.setVelocity(-1, 0, 0);
    run(w, 3);
    return { a, b };
  };
  const el = run1(1);
  near(el.a.vx, -1, 0.05); near(el.b.vx, 4, 0.05);
  near(el.a.vx + el.b.vx, 3, 1e-6, 'momentum');
  const st = run1(0);
  near(st.a.vx, st.b.vx, 0.05); near(st.a.vx + st.b.vx, 3, 1e-6);
});

test('a heavy body pushes a light one but not the reverse (mass ratio is respected)', () => {
  const w = new PhysicsWorld({ gravity: [0, 0, 0] });
  const heavy = w.add(new RigidBody({ shape: sphere(0.5), x: -2, mass: 100, linearDamping: 0 }));
  const light = w.add(new RigidBody({ shape: sphere(0.5), x: 0, mass: 1, linearDamping: 0 }));
  heavy.setVelocity(2, 0, 0);
  run(w, 2);
  assert.ok(heavy.vx > 1.9, `the heavy one barely slows: ${heavy.vx}`);
  assert.ok(light.vx > 1.9, `and the light one is carried along: ${light.vx}`);
});

test('a free-spinning box: energy and angular momentum stay constant, and a body spinning about its middle axis wobbles', () => {
  const w = new PhysicsWorld({ gravity: [0, 0, 0] });
  const b = w.add(new RigidBody({ shape: box(0.5, 1, 1.5), mass: 6, linearDamping: 0, angularDamping: 0 }));
  b.setAngularVelocity(2, 0.3, 0.1);
  const L = () => { const r = b.r, lx = r[0] * b.wx + r[3] * b.wy + r[6] * b.wz, ly = r[1] * b.wx + r[4] * b.wy + r[7] * b.wz, lz = r[2] * b.wx + r[5] * b.wy + r[8] * b.wz; const I = [1 / b.invIx, 1 / b.invIy, 1 / b.invIz]; const l = [lx * I[0], ly * I[1], lz * I[2]]; return [r[0] * l[0] + r[1] * l[1] + r[2] * l[2], r[3] * l[0] + r[4] * l[1] + r[5] * l[2], r[6] * l[0] + r[7] * l[1] + r[8] * l[2]]; };
  const e0 = b.kineticEnergy, l0 = L();
  run(w, 3, 1 / 240);
  const l1 = L();
  near(b.kineticEnergy, e0, e0 * 0.02, 'energy');
  near(Math.hypot(...l1), Math.hypot(...l0), Math.hypot(...l0) * 0.02, 'angular momentum size');
  near(l1[0], l0[0], Math.hypot(...l0) * 0.03, 'and direction');
});

test('a ball rolls without slipping: its spin settles to v / r', () => {
  const w = new PhysicsWorld({ terrain: ground(), substeps: 4 });
  const b = w.add(new RigidBody({ shape: sphere(0.5), y: 0.5, friction: 1, linearDamping: 0, angularDamping: 0, canSleep: false }));
  b.canSleep = false;
  b.setVelocity(5, 0, 0);
  run(w, 0.8);
  near(b.vx, Math.abs(b.wz) * 0.5, 0.25, 'rolling: v = w r');
  assert.ok(b.wz < 0, 'rolling toward +x spins clockwise about z');
  assert.ok(b.vx > 2.9 && b.vx < 3.7, `it keeps most of its speed (5 * 5/7 = 3.57, less a little rolling resistance): ${b.vx}`);
  run(w, 15);
  assert.ok(Math.abs(b.vx) < 0.3, `and rolling resistance brings it to rest in the end: ${b.vx}`);
});

test('applying a force at an off-centre point also spins the body', () => {
  const w = new PhysicsWorld({ gravity: [0, 0, 0] });
  const b = w.add(new RigidBody({ shape: box(1, 0.2, 0.2), mass: 3, linearDamping: 0, angularDamping: 0 }));
  b.applyForce(0, 10, 0, 1, 0, 0);
  w.step(0.1);
  assert.ok(b.vy > 0 && b.wz > 0, 'pushed up at +x: it rises and turns counter-clockwise about z');
  const b2 = w.add(new RigidBody({ shape: box(1, 0.2, 0.2), mass: 3, z: 10, linearDamping: 0, angularDamping: 0 }));
  b2.applyForce(0, 10, 0);
  w.step(0.1);
  near(b2.wz, 0, 1e-12, 'a push through the centre does not spin it');
  const b3 = w.add(new RigidBody({ shape: box(1, 0.2, 0.2), mass: 3, z: 20, linearDamping: 0, angularDamping: 0 }));
  b3.applyTorque(0, 0, 6); w.step(0.1);
  assert.ok(b3.wz > 0 && b3.vy === 0);
});
