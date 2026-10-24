import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PhysicsWorld, RigidBody, box, sphere, BallJoint, HingeJoint, FixedJoint, DistanceJoint } from '../src/index.js';
import { TriWorld } from '../src/tri-world.js';

const near = (a, b, eps, msg = '') => assert.ok(Math.abs(a - b) <= eps, `${msg} ${a} is not within ${eps} of ${b}`);
const run = (w, seconds, dt = 1 / 60) => { for (let i = 0; i < Math.round(seconds / dt); i++) w.step(dt); };
const air = (o = {}) => new PhysicsWorld({ substeps: 4, iterations: 12, ...o });
const bob = (x, y, z, r = 0.05) => new RigidBody({ shape: sphere(r), x, y, z, mass: 1, linearDamping: 0, angularDamping: 0, canSleep: false });

test('a ball-and-socket pendulum keeps its length and swings with the right period', () => {
  const w = air();
  const L = 2, b = w.add(bob(L * Math.sin(0.3), -L * Math.cos(0.3), 0));
  w.addJoint(new BallJoint(b, null, [0, 0, 0]));
  let maxErr = 0, crossings = [], prev = b.x;
  for (let i = 0; i < 60 * 12; i++) {
    w.step(1 / 60);
    maxErr = Math.max(maxErr, Math.abs(Math.hypot(b.x, b.y, b.z) - L));
    if (prev > 0 && b.x <= 0) crossings.push(w.time);
    prev = b.x;
  }
  assert.ok(maxErr < 0.01, `the string stays taut: error ${maxErr}`);
  const period = (crossings[crossings.length - 1] - crossings[0]) / (crossings.length - 1);
  const expected = 2 * Math.PI * Math.sqrt(L / 9.81) * (1 + 0.3 * 0.3 / 16);
  near(period, expected, expected * 0.03, 'period');
});

test('a ball joint between two bodies keeps the shared point together while both move', () => {
  const w = air();
  const a = w.add(new RigidBody({ shape: box(0.5, 0.1, 0.1), x: 0, y: 5, mass: 2, canSleep: false }));
  const b = w.add(new RigidBody({ shape: box(0.5, 0.1, 0.1), x: 1, y: 5, mass: 2, canSleep: false }));
  w.addJoint(new BallJoint(a, b, [0.5, 5, 0]));
  a.setAngularVelocity(0, 0, 3);
  let worst = 0;
  const pa = [0, 0, 0], pb = [0, 0, 0];
  for (let i = 0; i < 180; i++) {
    w.step(1 / 60);
    a.toWorld(0.5, 0, 0, pa); b.toWorld(-0.5, 0, 0, pb);
    worst = Math.max(worst, Math.hypot(pa[0] - pb[0], pa[1] - pb[1], pa[2] - pb[2]));
  }
  assert.ok(worst < 0.02, `the joint point stays together: ${worst}`);
});

test('a hinge only turns about its axis; limits stop it; a motor turns it', () => {
  // a door: a slab hinged at one edge to the world about the vertical axis, pushed sideways
  const make = (opts, push) => {
    const w = air({ gravity: [0, 0, 0] });
    const door = w.add(new RigidBody({ shape: box(0.6, 1, 0.05), x: 0.6, y: 1, z: 0, mass: 8, linearDamping: 0, angularDamping: 0.05, canSleep: false }));
    const hinge = w.addJoint(new HingeJoint(null, door, [0, 1, 0], [0, 1, 0], opts));
    push?.(door);
    return { w, door, hinge };
  };
  const free = make({}, (d) => d.applyImpulse(0, 0, 8, 1.2, 1, 0));
  run(free.w, 1.5);
  assert.ok(Math.abs(free.hinge.hingeAngle) > 0.5, `it swung: ${free.hinge.hingeAngle}`);
  const ax = free.door.r; // its own up axis stays vertical, and its centre stays on a circle of radius 0.6 about the hinge
  near(Math.abs(ax[4]), 1, 1e-3); near(Math.hypot(free.door.x, free.door.z), 0.6, 0.01); near(free.door.y, 1, 0.01);
  const stopped = make({ limits: [-0.3, 0.5] }, (d) => d.applyImpulse(0, 0, 40, 1.2, 1, 0));
  let hi = -9, lo = 9;
  for (let i = 0; i < 180; i++) { stopped.w.step(1 / 60); hi = Math.max(hi, stopped.hinge.hingeAngle); lo = Math.min(lo, stopped.hinge.hingeAngle); }
  assert.ok(hi < 0.55 && hi > 0.4 && lo > -0.35, `limits hold: ${lo}..${hi}`);
  const driven = make({ motor: { speed: 2, maxTorque: 500 } });
  run(driven.w, 1);
  near(driven.door.wy, 2, 0.15, 'motor speed'); assert.ok(Math.abs(driven.hinge.hingeAngle) > 1.5);
  const weak = make({ motor: { speed: 2, maxTorque: 0.001 } });
  run(weak.w, 1);
  assert.ok(Math.abs(weak.door.wy) < 0.1, 'a weak motor cannot turn a heavy door fast');
});

test('a hinge angle keeps counting past half a turn', () => {
  const w = air({ gravity: [0, 0, 0] });
  const wheel = w.add(new RigidBody({ shape: box(1, 1, 0.1), mass: 4, canSleep: false, linearDamping: 0, angularDamping: 0 }));
  const hinge = w.addJoint(new HingeJoint(null, wheel, [0, 0, 0], [0, 0, 1]));
  wheel.setAngularVelocity(0, 0, 4);
  run(w, 2);
  near(hinge.hingeAngle, 8, 0.2, 'about 4 rad/s for 2 s');
});

test('a fixed joint keeps two boxes welded together under load', () => {
  const t = new TriWorld(); t.addBox(0, -1, 0, 50, 1, 50); t.build();
  const w = air({ terrain: t });
  const a = w.add(new RigidBody({ shape: box(0.5, 0.5, 0.5), x: 0, y: 0.5, mass: 5 }));
  const b = w.add(new RigidBody({ shape: box(0.5, 0.5, 0.5), x: 1, y: 0.5, mass: 5 })); // beside it, welded
  w.addJoint(new FixedJoint(a, b, [0.5, 0.5, 0]));
  const rel0 = [b.x - a.x, b.y - a.y, b.z - a.z];
  a.setVelocity(3, 0, 0); a.setAngularVelocity(0, 2, 0);
  run(w, 2);
  assert.ok(Math.abs(Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) - 1) < 0.03, 'still one block apart');
  const dot = a.qx * b.qx + a.qy * b.qy + a.qz * b.qz + a.qw * b.qw;
  assert.ok(Math.abs(dot) > 0.999, 'and turning together');
});

test('a distance joint: a rod keeps its length, a rope only limits it, a spring oscillates at its frequency', () => {
  const rod = air();
  const a = rod.add(bob(0, 5, 0)), b = rod.add(bob(2, 5, 0));
  a.type = 'static'; a.setMass(0);
  rod.addJoint(new DistanceJoint(a, b, [0, 5, 0], [2, 5, 0], {}));
  run(rod, 3);
  near(Math.hypot(b.x - a.x, b.y - a.y), 2, 0.02, 'a rod');
  const rope = air();
  const top = rope.add(bob(0, 5, 0)); top.type = 'static'; top.setMass(0);
  const weight = rope.add(bob(0.5, 4.5, 0));
  rope.addJoint(new DistanceJoint(top, weight, [0, 5, 0], [0.5, 4.5, 0], { max: 2 }));
  run(rope, 0.5);
  assert.ok(weight.y < 4.0 && Math.hypot(weight.x, weight.y - 5) < 2.02, 'a rope lets it fall until it is taut');
  run(rope, 3);
  assert.ok(Math.hypot(weight.x, weight.y - 5) < 2.05, 'and then holds');
  const spring = air({ gravity: [0, 0, 0] });
  const anchor = spring.add(bob(0, 0, 0)); anchor.type = 'static'; anchor.setMass(0);
  const m = spring.add(bob(3, 0, 0));
  spring.addJoint(new DistanceJoint(anchor, m, [0, 0, 0], [3, 0, 0], { length: 2, frequency: 1, damping: 0.02 }));
  let crossings = [], prev = m.x - 2;
  for (let i = 0; i < 60 * 8; i++) { spring.step(1 / 60); const d = m.x - 2; if (prev > 0 && d <= 0) crossings.push(spring.time); prev = d; }
  const period = (crossings[crossings.length - 1] - crossings[0]) / (crossings.length - 1);
  near(period, 1, 0.08, 'one hertz');
});

test('a chain of links hangs stable and stretches no more than a little', () => {
  const w = air({ iterations: 20 });
  const links = [];
  let prev = null;
  for (let i = 0; i < 12; i++) {
    const l = w.add(new RigidBody({ shape: box(0.05, 0.25, 0.05), x: 0, y: 10 - i * 0.5 - 0.25, z: 0, mass: 0.5, canSleep: false }));
    w.addJoint(new BallJoint(prev ?? l, prev ? l : null, [0, 10 - i * 0.5, 0]));
    links.push(l); prev = l;
  }
  links[0].applyImpulse(5, 0, 0);
  run(w, 6);
  let speed = 0; for (const l of links) speed = Math.max(speed, Math.hypot(l.vx, l.vy, l.vz));
  assert.ok(speed < 12, `no explosion: ${speed}`);
  const bottom = links[11];
  assert.ok(Math.hypot(bottom.x, bottom.y - 10) < 6.3, `the chain is about 6 m long: ${Math.hypot(bottom.x, bottom.y - 10)}`);
});

test('a joint that has to push too hard breaks', () => {
  const w = air();
  const a = w.add(bob(0, 10, 0)); a.type = 'static'; a.setMass(0);
  const heavy = w.add(new RigidBody({ shape: sphere(0.3), x: 0, y: 9, mass: 500, canSleep: false }));
  const j = w.addJoint(new DistanceJoint(a, heavy, [0, 10, 0], [0, 9, 0], {}));
  j.breakImpulse = 20;
  run(w, 1);
  assert.ok(j.broken && !w.joints.includes(j), 'it snapped');
  assert.ok(heavy.y < 8, 'and the weight fell');
});

test('joined bodies do not collide with each other unless asked', () => {
  const run1 = (collide) => {
    const w = air({ gravity: [0, 0, 0] });
    const a = w.add(new RigidBody({ shape: sphere(0.5), x: 0, mass: 1, canSleep: false }));
    const b = w.add(new RigidBody({ shape: sphere(0.5), x: 0.6, mass: 1, canSleep: false }));
    const j = new BallJoint(a, b, [0.3, 0, 0]);
    j.collideConnected = collide; w.addJoint(j);
    run(w, 0.5);
    return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  };
  near(run1(false), 0.6, 0.01, 'they overlap freely: no contact forces');
  assert.ok(Math.abs(run1(true) - 0.6) > 0.01, 'with collideConnected the contact pushes against the joint');
});
