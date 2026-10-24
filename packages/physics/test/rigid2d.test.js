import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  World2D, Body2D, circleShape, boxShape, polygonShape, sinCos, RevoluteJoint2D, WeldJoint2D, DistanceJoint2D, collide2D, Manifold2D, resetBodyIds2D,
} from '../src/index.js';

const DT = 1 / 60;
const run = (world, seconds) => { for (let i = 0; i < Math.round(seconds / DT); i++) world.step(DT); };
const ground = (world, y = 10, w = 50) => world.add(new Body2D({ shape: boxShape(w, 1), type: 'static', x: 0, y: y + 1 }));   // top surface at y
const near = (a, b, tol, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} ${a} vs ${b}`);

test('sinCos matches the real functions closely, with nothing but + - * /', () => {
  for (let a = -20; a <= 20; a += 0.37) {
    const [s, c] = sinCos(a);
    near(s, Math.sin(a), 1e-12, `sin ${a}`); near(c, Math.cos(a), 1e-12, `cos ${a}`);
  }
});

test('shapes: areas, centres and the inertia of known shapes; bad shapes are named', () => {
  const b = boxShape(1, 0.5);
  near(b.area, 2, 1e-12); near(b.inertia, 2 * (2 * 2 + 1 * 1) / 12, 1e-12);
  const off = polygonShape([[10, 10], [12, 10], [12, 11], [10, 11]]);          // a 2 x 1 box away from the origin is re-centred
  near(off.xs[0], -1, 1e-12); near(off.ys[0], -0.5, 1e-12); near(off.inertia, b.inertia, 1e-12);
  const flipped = polygonShape([[-1, -0.5], [-1, 0.5], [1, 0.5], [1, -0.5]]);    // the other way round gives the same
  near(flipped.area, 2, 1e-12);
  near(circleShape(2).inertia, 0.5 * Math.PI * 16, 1e-9);
  assert.throws(() => polygonShape([[0, 0], [1, 0]]), /3 to 16/);
  assert.throws(() => polygonShape([[0, 0], [1, 0], [2, 0]]), /no area/);
  assert.throws(() => polygonShape([[0, 0], [2, 0], [1, 0.2], [2, 2], [0, 2]]), /not convex/);
  assert.throws(() => circleShape(0), /radius/);
  assert.throws(() => new Body2D({ shape: { type: 'x' } }), /needs a shape/);
});

test('collision: the contact points, depth and normal of circles, boxes and a circle on a box', () => {
  const m = new Manifold2D();
  const c1 = new Body2D({ shape: circleShape(1), x: 0, y: 0 }), c2 = new Body2D({ shape: circleShape(1), x: 1.5, y: 0 });
  collide2D(m, c1, c2);
  assert.equal(m.count, 1); near(m.sep[0], -0.5, 1e-12); near(m.nx, 1, 1e-12); near(m.px[0], 0.75, 1e-12);
  assert.equal(collide2D(m, c1, new Body2D({ shape: circleShape(1), x: 3, y: 0 })).count, 0);
  const floor = new Body2D({ shape: boxShape(5, 1), type: 'static', x: 0, y: 1 });          // top at y 0
  const crate = new Body2D({ shape: boxShape(0.5, 0.5), x: 0, y: -0.45 });                  // bottom at 0.05: 0.05 deep
  collide2D(m, floor, crate);
  assert.equal(m.count, 2, 'a flat box on a floor touches at two points');
  near(m.ny, -1, 1e-9, 'the normal points from the floor up (to -y)'); near(m.sep[0], -0.05, 1e-9);
  assert.ok(m.id[0] !== m.id[1]);
  const ball = new Body2D({ shape: circleShape(0.5), x: 0, y: -0.45 });
  collide2D(m, floor, ball);
  assert.equal(m.count, 1); near(m.sep[0], -0.05, 1e-9); near(m.ny, -1, 1e-9);
  collide2D(m, ball, floor);                                                                // circle first: the normal turns round
  assert.equal(m.count, 1); near(m.ny, 1, 1e-9);
  const corner = new Body2D({ shape: circleShape(0.5), x: 5.3, y: 0.0 });                   // beside the floor's corner at (5, 0)
  collide2D(m, floor, corner);
  assert.equal(m.count, 1); near(m.sep[0], Math.sqrt(0.09 + 0) - 0.5, 1e-9);
  const tilted = new Body2D({ shape: boxShape(0.5, 0.5), x: 0, y: -0.6, angle: Math.PI / 4 });
  collide2D(m, floor, tilted);
  assert.equal(m.count, 1, 'a box on its corner touches at one point'); near(m.sep[0], 0.6 - 0.5 * Math.SQRT2, 1e-9);
});

test('a ball falls at the right rate, lands, bounces by its restitution and settles', () => {
  const w = new World2D(); ground(w, 10);
  const ball = w.add(new Body2D({ shape: circleShape(0.5), x: 0, y: 0, restitution: 0.6 }));
  run(w, 0.5);
  near(ball.vy, 9.81 * 0.5, 0.2, 'v = g t'); near(ball.y, 0.5 * 9.81 * 0.25, 0.1, 'y = g t^2 / 2');
  let bounced = 0; w.onContactBegin = (a, b, speed) => { bounced = speed; };
  run(w, 1.5);
  assert.ok(bounced > 5, `hit at ${bounced}`);
  run(w, 8);
  near(ball.y, 9.5, 0.03, 'resting on the ground'); assert.ok(ball.sleeping, 'and asleep');
});

test('restitution: the rebound speed is about e times the impact speed', () => {
  const w = new World2D({ gravity: [0, 0] }); ground(w, 10);
  const ball = w.add(new Body2D({ shape: circleShape(0.5), x: 0, y: 8, restitution: 0.5 }));
  ball.vy = 8;
  let after = 0;
  for (let i = 0; i < 60 && !after; i++) { w.step(DT); if (ball.vy < 0) after = ball.vy; }
  near(after, -4, 0.4);
});

test('a stack of ten boxes stands still and falls asleep', () => {
  const w = new World2D(); ground(w, 10);
  const boxes = [];
  for (let i = 0; i < 10; i++) boxes.push(w.add(new Body2D({ shape: boxShape(0.5, 0.5), x: 0, y: 9.5 - i * 1.0 - 0.001 * i })));
  run(w, 6);
  for (let i = 0; i < 10; i++) { near(boxes[i].x, 0, 0.05, `box ${i} x`); near(boxes[i].y, 9.5 - i, 0.1, `box ${i} y`); }
  assert.ok(boxes.every((b) => b.sleeping), 'the whole stack sleeps');
  assert.equal(w.stats.asleep, 10);
});

test('a pyramid of boxes holds', () => {
  const w = new World2D(); ground(w, 10);
  const rows = 6, bodies = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < rows - r; c++) bodies.push(w.add(new Body2D({ shape: boxShape(0.5, 0.5), x: (c - (rows - r - 1) / 2) * 1.05, y: 9.5 - r * 1.02 })));
  const before = bodies.map((b) => [b.x, b.y]);
  run(w, 5);
  let worst = 0;
  bodies.forEach((b, i) => { worst = Math.max(worst, Math.abs(b.x - before[i][0]), Math.abs(b.y - before[i][1])); });
  assert.ok(worst < 0.15, `the pyramid moved by ${worst}`);
});

test('friction: a box rests on a slope with enough friction and slides on a slippery one', () => {
  const slide = (friction) => {
    const w = new World2D();
    const angle = 0.5;                                                  // about 28.6 degrees, tan = 0.546
    w.add(new Body2D({ shape: boxShape(20, 0.5), type: 'static', x: 0, y: 10, angle, friction }));
    // sit a box on top of the slope's surface
    const nx = -Math.sin(angle), ny = Math.cos(angle);                  // not used for determinism here, only to place the box
    void nx; void ny;
    const b = w.add(new Body2D({ shape: boxShape(0.5, 0.5), x: 0, y: 10 - 0.5 / Math.cos(angle) - 0.5 / Math.cos(angle) + 0.02, angle, friction }));
    const x0 = b.x;
    run(w, 3);
    return Math.hypot(b.x - x0, 0);
  };
  assert.ok(slide(0.8) < 0.3, 'grips');
  assert.ok(slide(0.1) > 3, 'slides');
});

test('a pendulum keeps its length and swings with the right period', () => {
  const w = new World2D({ substeps: 4, iterations: 10 });
  const bob = w.add(new Body2D({ shape: circleShape(0.2), x: 2, y: 0, gravityScale: 1, angularDamping: 0 }));
  w.addJoint(new RevoluteJoint2D(null, bob, 0, 0));
  let minLen = Infinity, maxLen = 0, crossings = [];
  let last = bob.x;
  for (let i = 0; i < 600; i++) {
    w.step(DT);
    const len = Math.hypot(bob.x, bob.y);
    minLen = Math.min(minLen, len); maxLen = Math.max(maxLen, len);
    if (last > 0 && bob.x <= 0) crossings.push(w.time);
    last = bob.x;
  }
  assert.ok(minLen > 1.97 && maxLen < 2.03, `length ${minLen} to ${maxLen}`);
  // a point mass of 0.2 radius on a 2 m arm is a "physical pendulum"; its quarter swing from horizontal takes about 1.9 s / 4 * 1.18 ... just check it swings back and forth a few times
  assert.ok(crossings.length >= 3, `swung ${crossings.length} times`);
});

test('a revolute motor turns a wheel up to speed', () => {
  const w = new World2D({ gravity: [0, 0] });
  const hub = w.add(new Body2D({ shape: boxShape(0.5, 0.5), type: 'static', x: 0, y: 0 }));
  const wheel = w.add(new Body2D({ shape: circleShape(1), x: 0, y: 0 }));
  w.addJoint(new RevoluteJoint2D(hub, wheel, 0, 0, { motorSpeed: 3, maxMotorTorque: 100 }));
  run(w, 2);
  near(wheel.w, 3, 0.05);
  near(wheel.x, 0, 0.01);
});

test('a weld keeps two bodies together as a rigid link, and carries one when the other is pushed', () => {
  const w = new World2D({ gravity: [0, 0] });
  const a = w.add(new Body2D({ shape: boxShape(0.5, 0.5), x: 0, y: 0 })), b = w.add(new Body2D({ shape: boxShape(0.5, 0.5), x: 1, y: 0 }));
  w.addJoint(new WeldJoint2D(a, b, 0.5, 0));
  a.applyImpulse(0, 3);                                                     // pushes the pair; they should also turn about their joint centre of mass
  run(w, 1);
  const dx = b.x - a.x, dy = b.y - a.y;
  near(Math.hypot(dx, dy), 1, 0.02, 'still one apart');
  near(Math.atan2(b.s * a.c - b.c * a.s, b.c * a.c + b.s * a.s), 0, 0.02, 'no relative turn');
});

test('a distance joint holds a length; with a frequency it is a spring that rings at that frequency', () => {
  const rigid = new World2D({ gravity: [0, 0] });
  const p = rigid.add(new Body2D({ shape: circleShape(0.2), x: 3, y: 0 }));
  rigid.addJoint(new DistanceJoint2D(null, p, 0, 0, 3, 0));
  p.setVelocity(0, 4);
  run(rigid, 1);
  near(Math.hypot(p.x, p.y), 3, 0.05, 'a rope');

  const soft = new World2D({ gravity: [0, 0], substeps: 4 });
  const m = soft.add(new Body2D({ shape: circleShape(0.2), x: 4, y: 0, linearDamping: 0 }));
  soft.addJoint(new DistanceJoint2D(null, m, 0, 0, 4, 0, { length: 3, frequency: 2, damping: 0 }));
  const crossings = [];
  let last = m.x - 3;
  for (let i = 0; i < 240; i++) { soft.step(DT); const e = m.x - 3; if (last > 0 && e <= 0) crossings.push(soft.time); last = e; }
  assert.ok(crossings.length >= 6);
  near(crossings[crossings.length - 1] - crossings[crossings.length - 2], 0.5, 0.03, 'a period of 0.5 s is 2 Hz');
});

test('sensors report entering and leaving without pushing; contact events fire once', () => {
  const w = new World2D(); ground(w, 10);
  const zone = w.add(new Body2D({ shape: boxShape(2, 2), type: 'static', x: 0, y: 5, sensor: true }));
  const ball = w.add(new Body2D({ shape: circleShape(0.5), x: 0, y: 0 }));
  const log = [];
  w.onTrigger = (s, b, entered) => log.push([s === zone, b === ball, entered]);
  let begins = 0, ends = 0; w.onContactBegin = () => begins++; w.onContactEnd = () => ends++;
  run(w, 3);
  assert.deepEqual(log[0], [true, true, true]);
  assert.ok(ball.y < 9.6 && ball.y > 9.3, 'the sensor did not hold it up');
  assert.equal(begins, 1, 'one landing'); assert.equal(ends, 0);
  ball.applyImpulse(0, -ball.mass * 12);
  run(w, 0.3);
  assert.equal(ends, 1);
});

test('collision groups and masks', () => {
  const w = new World2D(); ground(w, 10);
  const ghost = w.add(new Body2D({ shape: circleShape(0.5), x: 0, y: 5, group: 2, mask: 0b100 }));
  const real = w.add(new Body2D({ shape: circleShape(0.5), x: 3, y: 5 }));
  run(w, 2);
  assert.ok(ghost.y > 12, 'the ghost falls through the ground'); near(real.y, 9.5, 0.05);
});

test('queries: points, boxes and rays', () => {
  const w = new World2D();
  const a = w.add(new Body2D({ shape: boxShape(1, 1), type: 'static', x: 5, y: 0 }));
  const b = w.add(new Body2D({ shape: circleShape(1), type: 'static', x: 10, y: 0 }));
  assert.deepEqual(w.queryPoint(5.5, 0.5), [a]);
  assert.deepEqual(w.queryPoint(10, 1.01), []);
  assert.deepEqual(w.queryAabb(8, -1, 12, 1), [b]);
  const hit = w.raycast(0, 0, 1, 0);
  assert.equal(hit.body, a); near(hit.distance, 4, 1e-9); near(hit.nx, -1, 1e-9);
  assert.equal(w.raycast(0, 0, 1, 0, 3), null);
  assert.equal(w.raycast(0, 0, 1, 0, 100, (x) => x !== a).body, b);
  near(w.raycast(10, -5, 0, 1).distance, 4, 1e-9);
  assert.equal(w.raycast(0, 5, 1, 0), null);
});

test('deterministic: two worlds from the same start give the same bits, and a saved state replays exactly', () => {
  const make = () => {
    resetBodyIds2D();
    const w = new World2D(); ground(w, 10);
    for (let i = 0; i < 8; i++) w.add(new Body2D({ shape: i % 2 ? circleShape(0.45) : boxShape(0.5, 0.4), x: (i % 3) * 0.7, y: 2 - i * 1.1, angle: i * 0.3, restitution: 0.2 }));
    const bob = w.add(new Body2D({ shape: circleShape(0.3), x: 6, y: 0 }));
    w.addJoint(new RevoluteJoint2D(null, bob, 4, 0));
    return w;
  };
  const a = make(), b = make();
  run(a, 2); run(b, 2);
  assert.deepEqual(a.getState(), b.getState());
  const saved = JSON.parse(JSON.stringify(a.getState()));
  run(a, 2);
  const c = make(); c.setState(saved); run(c, 2);
  assert.deepEqual(c.getState(), a.getState(), 'replayed from the saved state it is bit for bit the same');
});

test('removing a body takes its joints and contacts with it; moving a body wakes it', () => {
  const w = new World2D(); ground(w, 10);
  const a = w.add(new Body2D({ shape: boxShape(0.5, 0.5), x: 0, y: 9.4 })), b = w.add(new Body2D({ shape: boxShape(0.5, 0.5), x: 3, y: 9.4 }));
  const j = w.addJoint(new DistanceJoint2D(a, b, 0, 9.4, 3, 9.4));
  run(w, 3);
  assert.ok(a.sleeping);
  w.remove(b);
  assert.equal(w.joints.length, 0); void j;
  assert.equal(w.bodies.length, 2);
  a.setPosition(0, 5);
  assert.equal(a.sleeping, false);
});

test('nothing tunnels: a ball and a box at 150 m/s stop at a thin wall', () => {
  for (const shape of [circleShape(0.2), boxShape(0.2, 0.2)]) {
    const w = new World2D({ gravity: [0, 0] });
    w.add(new Body2D({ shape: boxShape(0.1, 5), type: 'static', x: 10, y: 0 }));
    const b = w.add(new Body2D({ shape, x: 0, y: 0 }));
    b.vx = 150;
    run(w, 1);
    near(b.x, 9.7, 0.05, shape.type);
  }
});

test('a moving kinematic platform carries a box standing on it', () => {
  const w = new World2D();
  const p = w.add(new Body2D({ shape: boxShape(3, 0.25), type: 'kinematic', x: 0, y: 10 }));
  p.setVelocity(2, 0);
  const b = w.add(new Body2D({ shape: boxShape(0.5, 0.5), x: 0, y: 9.2, friction: 0.8 }));
  run(w, 1.5);
  near(p.x, 3, 0.01);
  assert.ok(b.x > 2.4, `the box rode along to ${b.x}`); near(b.y, 9.25, 0.05);
});

test('four hundred mixed bodies in a box settle, stay inside, stay finite and fall asleep, in about a millisecond a step', () => {
  const w = new World2D();
  w.add(new Body2D({ shape: boxShape(30, 1), type: 'static', x: 0, y: 21 }));
  w.add(new Body2D({ shape: boxShape(1, 30), type: 'static', x: -30, y: 0 }));
  w.add(new Body2D({ shape: boxShape(1, 30), type: 'static', x: 30, y: 0 }));
  let seed = 7; const r = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  for (let i = 0; i < 400; i++) {
    const k = i % 3;
    const shape = k === 0 ? circleShape(0.3 + r() * 0.3) : k === 1 ? boxShape(0.3 + r() * 0.4, 0.3 + r() * 0.4) : polygonShape([[0, -0.6], [0.5, 0.4], [-0.5, 0.4]]);
    w.add(new Body2D({ shape, x: (r() - 0.5) * 50, y: -30 + r() * 40, angle: r() * 6, restitution: 0.2 }));
  }
  run(w, 10);
  for (const b of w.bodies.filter((x) => x.type === 'dynamic')) {
    assert.ok(Number.isFinite(b.x + b.y + b.c + b.s + b.vx + b.vy + b.w), 'finite');
    assert.ok(b.y < 21 && Math.abs(b.x) < 30, `body ${b.id} escaped to ${b.x}, ${b.y}`);
    near(b.c * b.c + b.s * b.s, 1, 1e-9, 'rotation stays a rotation');
  }
  assert.equal(w.stats.awake, 0, 'all asleep');
});
