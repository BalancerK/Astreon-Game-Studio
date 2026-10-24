import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RigidBody, sphere, box, capsule } from '../src/rigid/body.js';
import { Manifold, collide, collideTriangle } from '../src/rigid/contacts.js';

const near = (a, b, eps = 1e-9, msg = '') => assert.ok(Math.abs(a - b) <= eps, `${msg} ${a} is not within ${eps} of ${b}`);
const body = (shape, x, y, z, rotation, type = 'dynamic') => new RigidBody({ shape, x, y, z, rotation, type });
const quatAxis = (ax, ay, az, angle) => { const s = Math.sin(angle / 2), l = Math.hypot(ax, ay, az); return [ax / l * s, ay / l * s, az / l * s, Math.cos(angle / 2)]; };

test('sphere against sphere: normal from A to B, depth is the overlap, point between the surfaces', () => {
  const m = new Manifold();
  collide(body(sphere(1), 0, 0, 0), body(sphere(0.5), 1.2, 0, 0), m);
  assert.equal(m.n, 1);
  near(m.nx, 1); near(m.ny, 0); near(m.depth[0], 0.3); near(m.px[0], 1 - 0.15);
  collide(body(sphere(1), 0, 0, 0), body(sphere(0.5), 1.6, 0, 0), m);
  assert.equal(m.n, 0, 'apart');
  collide(body(sphere(1), 0, 0, 0), body(sphere(1), 0, 0, 0), m);
  assert.equal(m.n, 1, 'same centre: still a contact, with some normal');
  near(Math.hypot(m.nx, m.ny, m.nz), 1);
});

test('sphere against box: face, edge, corner and inside; normal always from A to B', () => {
  const m = new Manifold();
  const b = body(box(1, 1, 1), 0, 0, 0);
  collide(body(sphere(0.5), 0, 1.4, 0), b, m);
  assert.equal(m.n, 1); near(m.nx, 0); near(m.ny, -1); near(m.depth[0], 0.1); near(m.py[0], 1 - 0.05 + 0.0, 0.06);
  collide(b, body(sphere(0.5), 0, 1.4, 0), m); // the other way round
  near(m.ny, 1, 1e-9, 'box then sphere: the normal flips');
  collide(body(sphere(0.5), 1.3, 1.3, 0), b, m); // beside an edge
  near(m.nx, -Math.SQRT1_2, 1e-9); near(m.ny, -Math.SQRT1_2, 1e-9);
  near(m.depth[0], 0.5 - Math.hypot(0.3, 0.3), 1e-9);
  collide(body(sphere(0.5), 1.25, 1.25, 1.25), b, m); // beside a corner
  near(m.depth[0], 0.5 - Math.hypot(0.25, 0.25, 0.25), 1e-9);
  collide(body(sphere(0.2), 0.9, 0.1, 0.0), b, m); // centre inside: leaves by the nearest face (+x), depth 0.1 + 0.2
  near(m.nx, -1); near(m.depth[0], 0.3);
  collide(body(sphere(0.5), 3, 0, 0), b, m);
  assert.equal(m.n, 0);
  const rotated = body(box(1, 1, 1), 0, 0, 0, quatAxis(0, 0, 1, Math.PI / 4)); // a diamond: its corner points along +x at distance sqrt 2
  collide(body(sphere(0.5), 1.8, 0, 0), rotated, m);
  assert.equal(m.n, 1); near(m.nx, -1, 1e-9); near(m.depth[0], 0.5 - (1.8 - Math.SQRT2), 1e-9);
});

test('capsule against sphere, capsule and box', () => {
  const m = new Manifold();
  const cap = body(capsule(0.5, 1), 0, 0, 0);
  collide(cap, body(sphere(0.5), 0.9, 0.5, 0), m);
  assert.equal(m.n, 1); near(m.nx, 1); near(m.depth[0], 0.1);
  collide(body(sphere(0.5), 0.2, 1.8, 0), cap, m); // above the capsule's top end (its axis ends at y = 1)
  assert.equal(m.n, 1); near(m.nx, -0.2 / Math.hypot(0.2, 0.8), 1e-9); near(m.ny, -0.8 / Math.hypot(0.2, 0.8), 1e-9); near(m.depth[0], 1 - Math.hypot(0.2, 0.8), 1e-9);
  collide(cap, body(capsule(0.5, 1), 0.8, 0, 0), m); // parallel, side by side
  assert.equal(m.n, 1); near(m.nx, 1); near(m.depth[0], 0.2);
  const crossed = body(capsule(0.5, 1), 0, 0, 0.9, quatAxis(0, 0, 1, Math.PI / 2)); // lying along x, 0.9 m in front of the first's middle
  collide(cap, crossed, m);
  assert.equal(m.n, 1); near(Math.abs(m.nz), 1, 1e-9); near(m.depth[0], 1 - 0.9, 1e-9);
  const floor = body(box(5, 0.5, 5), 0, -0.5, 0, undefined, 'static');
  collide(body(capsule(0.5, 1), 0, 1.45, 0), floor, m); // standing: its bottom cap touches the top face (y = 0) 5 cm deep
  assert.equal(m.n, 1); near(m.ny, -1, 1e-9); near(m.depth[0], 0.05, 1e-9);
  collide(body(capsule(0.5, 1), 0, 0.45, 0, quatAxis(0, 0, 1, Math.PI / 2)), floor, m); // lying: both ends touch
  assert.ok(m.n >= 2, 'a capsule lying on a floor touches along its length');
  near(m.ny, -1, 1e-9);
});

test('box against box: stacked boxes give four contacts spread over the face, with the right depth and normal', () => {
  const m = new Manifold();
  collide(body(box(1, 0.5, 1), 0, 0, 0), body(box(0.5, 0.5, 0.5), 0.2, 0.95, 0.1), m);
  assert.equal(m.n, 4);
  near(m.nx, 0); near(m.ny, 1); near(m.nz, 0);
  for (let i = 0; i < 4; i++) near(m.depth[i], 0.05, 1e-9);
  const xs = [...m.px.slice(0, 4)], zs = [...m.pz.slice(0, 4)];
  near(Math.max(...xs) - Math.min(...xs), 1, 1e-9); near(Math.max(...zs) - Math.min(...zs), 1, 1e-9); // the small box's footprint
  collide(body(box(0.5, 0.5, 0.5), 0.2, 0.95, 0.1), body(box(1, 0.5, 1), 0, 0, 0), m); // reversed: the normal flips
  assert.equal(m.n, 4); near(m.ny, -1);
  collide(body(box(1, 0.5, 1), 0, 0, 0), body(box(0.5, 0.5, 0.5), 0.2, 1.1, 0.1), m);
  assert.equal(m.n, 0, 'apart');
});

test('box against box: overhang is clipped to the face below, and tilted boxes touch along an edge', () => {
  const m = new Manifold();
  collide(body(box(1, 0.5, 1), 0, 0, 0), body(box(1, 0.5, 1), 1.5, 0.95, 0), m); // half over the edge
  assert.equal(m.n, 4);
  for (let i = 0; i < 4; i++) assert.ok(m.px[i] <= 1 + 1e-9 && m.px[i] >= 0.5 - 1e-9, `x ${m.px[i]} inside the overlap`);
  const tilted = body(box(0.5, 0.5, 0.5), 0, 1.0 + 0.35, 0, quatAxis(0, 0, 1, Math.PI / 4)); // balanced on one edge: its lowest edge at y = 1.0 + 0.35 - 0.7071
  collide(body(box(2, 0.5, 2), 0, 0.5, 0), tilted, m); // top face of the first at y = 1.0
  assert.ok(m.n >= 1); near(m.ny, 1, 1e-6);
  near(Math.max(...m.depth.slice(0, m.n)), 1.0 - (1.35 - Math.SQRT1_2), 1e-6);
});

test('box against box: two crossed edges give one point and an edge-edge normal', () => {
  const m = new Manifold();
  const a = body(box(1, 1, 1), 0, 0, 0, quatAxis(1, 0, 0, Math.PI / 4));
  const b = body(box(1, 1, 1), 0, 0, 0, quatAxis(0, 0, 1, Math.PI / 4));
  b.setPosition(0, Math.SQRT2 + Math.SQRT2 - 0.05, 0); // a's top edge (along x) and b's lowest edge (along z) cross, overlapping by 5 cm
  collide(a, b, m);
  assert.equal(m.n, 1);
  near(Math.abs(m.ny), 1, 1e-6); near(m.depth[0], 0.05, 1e-6);
  near(m.px[0], 0, 1e-6); near(m.pz[0], 0, 1e-6);
});

test('box against a triangle: the ground gives contacts over its footprint; a ramp tilts the normal; the far side counts too', () => {
  const m = new Manifold();
  const ground = [-5, 0, -5, 5, 0, 5, 5, 0, -5]; // winding gives a normal pointing -y or +y: triangles are two-sided
  const crate = body(box(0.5, 0.5, 0.5), 1, 0.45, 1);
  collideTriangle(crate, ground, 0, m);
  assert.ok(m.n >= 1);
  near(m.nx, 0, 1e-9); near(Math.abs(m.ny), 1, 1e-9);
  assert.ok(m.ny < 0, 'from the box down into the ground');
  for (let i = 0; i < m.n; i++) near(m.depth[i], 0.05, 1e-9);
  const flipped = [-5, 0, -5, 5, 0, -5, 5, 0, 5]; // the other winding: same contact
  collideTriangle(crate, flipped, 0, m);
  assert.ok(m.n >= 1 && m.ny < 0);
  collideTriangle(body(box(0.5, 0.5, 0.5), 1, 0.6, 1), ground, 0, m);
  assert.equal(m.n, 0, 'above the ground');
  const fourCorners = body(box(0.5, 0.5, 0.5), 3.5, 0.45, 3.5);
  const tri2 = [-5, 0, -5, 5, 0, 5, -5, 0, 5];
  let total = 0;
  for (const tri of [ground, tri2]) { collideTriangle(fourCorners, tri, 0, m); total += m.n; }
  assert.ok(total >= 4, `a crate on two triangles has contacts on both: ${total}`);
  const ramp = [0, 0, 0, 4, 0, 0, 0, 4, 0]; // a vertical wall in the xy plane
  collideTriangle(body(box(0.5, 0.5, 0.5), 1, 1, 0.49), ramp, 0, m);
  assert.ok(m.n >= 1); near(Math.abs(m.nz), 1, 1e-9);
});

test('box against a triangle: an edge poking in, and a box on top of a thin spike', () => {
  const m = new Manifold();
  const wall = [0, -5, -5, 0, 5, -5, 0, 0, 5];
  const tilted = body(box(0.5, 0.5, 0.5), 0.55, 0, 0, quatAxis(0, 0, 1, Math.PI / 4)); // an edge toward the wall at x = 0
  collideTriangle(tilted, wall, 0, m);
  assert.ok(m.n >= 1); near(Math.abs(m.nx), 1, 1e-9);
  near(Math.max(...m.depth.slice(0, m.n)), Math.SQRT1_2 - 0.55, 1e-9);
  const small = [0, 0, 0, 0.2, 0, 0, 0.1, 0, 0.2];
  collideTriangle(body(box(1, 1, 1), 0.1, 0.99, 0.1), small, 0, m);
  assert.ok(m.n >= 1); near(m.ny, -1, 1e-9);
});

test('sphere and capsule against triangles', () => {
  const m = new Manifold();
  const ground = [-5, 0, -5, 5, 0, 5, 5, 0, -5];
  collideTriangle(body(sphere(0.5), 1, 0.45, 1), ground, 0, m);
  assert.equal(m.n, 1); near(m.ny, -1); near(m.depth[0], 0.05, 1e-9);
  collideTriangle(body(sphere(0.5), 1, 0.6, 1), ground, 0, m);
  assert.equal(m.n, 0);
  const ball = body(sphere(0.5), 1, 0, 1); ball.vy = -3; // centre exactly on the plane: the side it came from decides
  collideTriangle(ball, ground, 0, m);
  assert.equal(m.n, 1); assert.ok(m.ny < 0 && Math.abs(m.depth[0] - 0.5) < 1e-9);
  const lying = body(capsule(0.3, 1), 1, 0.25, 1, quatAxis(0, 0, 1, Math.PI / 2));
  collideTriangle(lying, ground, 0, m);
  assert.equal(m.n, 2, 'a capsule lying on the ground touches at both ends'); near(m.ny, -1, 1e-9);
  const tall = body(capsule(0.3, 1), 1, 1.25, 1);
  collideTriangle(tall, ground, 0, m);
  assert.equal(m.n, 1); near(m.depth[0], 0.05, 1e-9);
});
