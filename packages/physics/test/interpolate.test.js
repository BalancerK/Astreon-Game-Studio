import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World2D, Body2D, circleShape, boxShape, PhysicsWorld, RigidBody, sphere, PoseInterpolator } from '../src/index.js';

const DT = 1 / 60;
const near = (a, b, tol, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} ${a} vs ${b}`);

test('2D: a falling body is drawn between its last two step positions', () => {
  const world = new World2D();
  const ball = world.add(new Body2D({ shape: circleShape(0.5), x: 0, y: 0 }));
  const view = new PoseInterpolator(world);
  for (let i = 0; i < 5; i++) { view.snapshot(); world.step(DT); }
  const before = ball.y - ball.vy * DT;                      // where it was a step ago (free fall, no damping to speak of)
  const p0 = view.pose(ball, 0), p1 = view.pose(ball, 1), ph = view.pose(ball, 0.5);
  near(p0.y, before, 1e-3); near(p1.y, ball.y, 1e-12); near(ph.y, (p0.y + p1.y) / 2, 1e-12);
  assert.ok(p0.y < ph.y && ph.y < p1.y);
});

test('2D: rotation is blended the short way round, across the half-turn seam', () => {
  const world = new World2D({ gravity: [0, 0] });
  const b = world.add(new Body2D({ shape: boxShape(1, 1), angle: 3.0 }));
  const view = new PoseInterpolator(world);
  view.snapshot();
  b.setAngle(-3.0);                                          // 0.283 rad further round the same way (3.0 -> pi -> -3.0)
  const mid = view.pose(b, 0.5);
  near(Math.abs(mid.angle), Math.PI, 0.02);                  // half way is next to pi, not back at 0
  near(mid.c * mid.c + mid.s * mid.s, 1, 1e-12);
});

test('a body with no snapshot, or alpha out of range, is drawn sensibly', () => {
  const world = new World2D();
  const view = new PoseInterpolator(world);
  const b = world.add(new Body2D({ shape: circleShape(1), x: 3, y: 4 }));
  assert.equal(view.pose(b, 0.3).x, 3);                       // added after (or without) any snapshot: where it is
  view.snapshot(); b.setPosition(5, 4); view.reset(b);
  assert.equal(view.pose(b, 0).x, 5);                         // reset: no ghost trail from the old place
  view.snapshot(); b.setPosition(7, 4);
  assert.equal(view.pose(b, -1).x, 5); assert.equal(view.pose(b, 9).x, 7); assert.equal(view.pose(b, NaN).x, 5);
});

test('it never changes the simulation: a replay with and without it is identical', () => {
  const make = () => { const w = new World2D(); w.add(new Body2D({ shape: boxShape(20, 1), type: 'static', x: 0, y: 11 })); const c = w.add(new Body2D({ shape: boxShape(0.5, 0.5), x: 0, y: 0, angle: 0.3 })); return [w, c]; };
  const [w1, c1] = make(), [w2, c2] = make();
  const v = new PoseInterpolator(w2), out = {};
  for (let i = 0; i < 200; i++) { w1.step(DT); v.snapshot(); w2.step(DT); v.pose(c2, 0.4, out); }
  assert.equal(c1.x, c2.x); assert.equal(c1.y, c2.y); assert.equal(c1.c, c2.c); assert.equal(c1.s, c2.s);
});

test('removed bodies are forgotten', () => {
  const world = new World2D();
  const view = new PoseInterpolator(world);
  for (let i = 0; i < 300; i++) { const b = world.add(new Body2D({ shape: circleShape(1), x: i * 5, y: 0 })); view.snapshot(); world.remove(b); }
  view.snapshot();
  assert.ok(view.before.size <= 70, `kept ${view.before.size}`);
});

test('3D: positions blend and the quaternion stays unit length and takes the short way round', () => {
  const world = new PhysicsWorld({ gravity: [0, 0, 0] });
  const b = world.add(new RigidBody({ shape: sphere(0.5), x: 0, y: 0, z: 0 }));
  const view = new PoseInterpolator(world);
  b.vx = 6;
  view.snapshot(); world.step(DT);
  const p = view.pose(b, 0.5);
  near(p.x, b.x / 2, 1e-9); near(p.qw, 1, 1e-12);
  // the same rotation written with the opposite sign must not spin the long way
  const s = Math.SQRT1_2;
  b.qx = 0; b.qy = s; b.qz = 0; b.qw = s;
  view.snapshot();
  b.qx = 0; b.qy = -s; b.qz = 0; b.qw = -s;
  const q = view.pose(b, 0.5);
  near(Math.hypot(q.qx, q.qy, q.qz, q.qw), 1, 1e-12); near(Math.abs(q.qy), s, 1e-12);
});
