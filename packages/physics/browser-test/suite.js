// Cross-engine determinism suite for the 3D physics: hashes every result bit for bit. Run by `node tools/determinism.js`
// in Node, Chrome and Firefox: every hash must be identical everywhere, or client prediction and the server would drift.
import { TriWorld, CharacterController, closestPointOnTriangle, sweepSphereVsTriangle, rayTriangle, moveEllipsoid, createSlide3Result, PhysicsWorld, RigidBody, Manifold, collide, collideTriangle, sphere, box, capsule, resetBodyIds, BallJoint, HingeJoint, DistanceJoint, FixedJoint, ConeJoint, Ragdoll, humanoidRagdollSpec, RaycastVehicle } from '../src/index.js';

/** xorshift32: integer-only PRNG, identical everywhere. */
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s;
  };
}
const unit = (u) => u / 4294967296;

class Hasher {
  constructor() { this.h = 0x811c9dc5; this.f64 = new Float64Array(1); this.u32 = new Uint32Array(this.f64.buffer); }
  word(w) { for (let i = 0; i < 4; i++) this.h = Math.imul(this.h ^ ((w >>> (i * 8)) & 255), 0x01000193); }
  num(v) {
    if (v !== v) { this.word(0x7ff80000); this.word(0); return; }
    this.f64[0] = v;
    this.word(this.u32[0]);
    this.word(this.u32[1]);
  }
  get hex() { return (this.h >>> 0).toString(16).padStart(8, '0'); }
}

function scatteredWorld(r, boxes, tris, size) {
  const w = new TriWorld({ cellSize: 6 });
  const f = () => unit(r()) * size;
  for (let i = 0; i < boxes; i++) w.addBox(f(), f(), f(), 0.5 + unit(r()) * 4, 0.5 + unit(r()) * 4, 0.5 + unit(r()) * 4);
  for (let i = 0; i < tris; i++) w.addTriangle(f(), f(), f(), f(), f(), f(), f(), f(), f());
  return w.build();
}

function narrowPhase() {
  const r = rng(201), h = new Hasher();
  const q = { x: 0, y: 0, z: 0 }, hit = { t: 0, x: 0, y: 0, z: 0, kind: 0 };
  const f = (s) => (unit(r()) - 0.5) * s;
  for (let i = 0; i < 4000; i++) {
    const t = [f(6), f(6), f(6), f(6), f(6), f(6), f(6), f(6), f(6)];
    const p = [f(10), f(10), f(10)], v = [f(12), f(12), f(12)];
    h.num(closestPointOnTriangle(p[0], p[1], p[2], ...t, q)); h.num(q.x); h.num(q.y); h.num(q.z);
    if (sweepSphereVsTriangle(p[0], p[1], p[2], v[0], v[1], v[2], ...t, 1, hit)) { h.word(1); h.num(hit.t); h.num(hit.x); h.num(hit.y); h.num(hit.z); h.word(hit.kind); } else h.word(0);
    h.num(rayTriangle(p[0], p[1], p[2], v[0], v[1], v[2], ...t, 100));
  }
  return h.hex;
}

function broadPhase() {
  const r = rng(202), h = new Hasher();
  const w = scatteredWorld(r, 25, 25, 60);
  const out = new Int32Array(w.triangleCount), hit = { t: 0, index: -1, nx: 0, ny: 0, nz: 0 };
  for (let i = 0; i < 1500; i++) {
    const o = [unit(r()) * 80 - 10, unit(r()) * 80 - 10, unit(r()) * 80 - 10], d = [unit(r()) - 0.5, unit(r()) - 0.5, unit(r()) - 0.5];
    if (w.raycast(o[0], o[1], o[2], d[0], d[1], d[2], 300, hit)) { h.word(1); h.num(hit.t); h.word(hit.index); h.num(hit.nx); h.num(hit.ny); h.num(hit.nz); } else h.word(0);
    const n = w.queryAabb(o[0], o[1], o[2], o[0] + 6, o[1] + 6, o[2] + 6, out);
    h.word(n); for (let k = 0; k < n; k++) h.word(out[k]);
  }
  return h.hex;
}

function slideFuzz() {
  const r = rng(203), h = new Hasher(), out = createSlide3Result();
  const w = scatteredWorld(r, 18, 30, 40);
  for (let i = 0; i < 3000; i++) {
    const mag = [2, 20, 400, 1e5][i % 4];
    const f = (s) => (unit(r()) - 0.5) * s;
    moveEllipsoid(w, unit(r()) * 40, unit(r()) * 40, unit(r()) * 40, f(mag), f(mag), f(mag), 0.4, 0.9, 0.4, out, i % 3 === 0 ? 0.7 : 0, i % 5 === 0);
    h.num(out.x); h.num(out.y); h.num(out.z); h.word(out.count);
    for (let c = 0; c < out.count; c++) { h.num(out.normals[c * 3]); h.num(out.normals[c * 3 + 1]); h.num(out.normals[c * 3 + 2]); h.word(out.tri[c]); h.word(out.kind[c]); }
  }
  return h.hex;
}

/** A small level with a ramp, steep ramp, stairs, a block, a wall, a ceiling and a ledge. */
function level() {
  const w = new TriWorld({ cellSize: 4 });
  w.addBox(0, -1, 0, 100, 1, 100);
  const rise30 = 10 * 0.5773502691896257, rise60 = 10 * 1.7320508075688772;
  w.addQuad(-12, 0, -5, -8, 0, -5, -8, rise30, -15, -12, rise30, -15);
  w.addQuad(8, 0, -5, 12, 0, -5, 12, rise60, -15, 8, rise60, -15);
  for (let i = 0; i < 6; i++) w.addBox(6 + i * 0.8 + 0.4, (i + 1) * 0.15, 40, 0.4, (i + 1) * 0.15, 2);
  w.addBox(10.9, 0.9, 40, 1.5, 0.9, 2);
  w.addBox(0, 0.3, 60, 3, 0.3, 3);
  w.addBox(-30, 5, 0, 0.5, 5, 30);
  w.addBox(0, 4, 80, 8, 0.5, 8);
  w.addBox(60, 1.5, 0, 6, 1.5, 6);
  return w.build();
}

function character() {
  const w = level();
  const r = rng(204), h = new Hasher();
  for (let k = 0; k < 12; k++) {
    const starts = [[0, 6, 0], [-10, 1, 0], [10, 9, -9], [3, 1, 40], [0, 1, 54], [58, 4, 0], [-20, 1, 0], [0, 1, 80], [-10, 1, -2], [10.5, 3, 40], [30, 5, 30], [1, 2, 1]];
    const c = new CharacterController({ x: starts[k][0], y: starts[k][1], z: starts[k][2] });
    for (let i = 0; i < 700; i++) {
      const speed = [0, 3, 6, 40][(i >> 5) % 4];
      c.update(w, (unit(r()) - 0.5) * speed, (unit(r()) - 0.5) * speed, unit(r()) < 0.02, i % 50 === 0 ? 0.05 : 1 / 60);
      h.num(c.x); h.num(c.y); h.num(c.z); h.num(c.vy); h.word(c.grounded ? 1 : 0); h.word(c.blocked ? 1 : 0); h.num(c.groundNy);
    }
  }
  return h.hex;
}

const shapeOf = (r, k) => (k % 3 === 0 ? sphere(0.3 + unit(r()) * 0.4) : k % 3 === 1 ? box(0.2 + unit(r()) * 0.5, 0.2 + unit(r()) * 0.5, 0.2 + unit(r()) * 0.5) : capsule(0.2 + unit(r()) * 0.3, 0.2 + unit(r()) * 0.5));
const randomRotation = (r) => { const q = [unit(r()) - 0.5, unit(r()) - 0.5, unit(r()) - 0.5, unit(r()) - 0.5 + 0.7]; const l = Math.sqrt(q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3]); return q.map((v) => v / l); };

/** Contacts between random pairs of shapes in random poses, and against random triangles. */
function rigidContacts() {
  const r = rng(301), h = new Hasher(), m = new Manifold();
  resetBodyIds();
  for (let i = 0; i < 3000; i++) {
    const a = new RigidBody({ shape: shapeOf(r, i), x: (unit(r()) - 0.5) * 2, y: (unit(r()) - 0.5) * 2, z: (unit(r()) - 0.5) * 2, rotation: randomRotation(r) });
    const b = new RigidBody({ shape: shapeOf(r, i + (i >> 2)), x: (unit(r()) - 0.5) * 2, y: (unit(r()) - 0.5) * 2, z: (unit(r()) - 0.5) * 2, rotation: randomRotation(r) });
    collide(a, b, m);
    h.word(m.n); if (m.n > 0) { h.num(m.nx); h.num(m.ny); h.num(m.nz); for (let k = 0; k < m.n; k++) { h.num(m.px[k]); h.num(m.py[k]); h.num(m.pz[k]); h.num(m.depth[k]); } }
    const tri = [0, 0, 0, 0, 0, 0, 0, 0, 0].map(() => (unit(r()) - 0.5) * 3);
    collideTriangle(a, tri, 0, m);
    h.word(m.n); if (m.n > 0) { h.num(m.nx); h.num(m.ny); h.num(m.nz); for (let k = 0; k < m.n; k++) { h.num(m.px[k]); h.num(m.py[k]); h.num(m.pz[k]); h.num(m.depth[k]); } }
  }
  return h.hex;
}

const hashWorld = (h, w) => { for (const b of w.bodies) { h.num(b.x); h.num(b.y); h.num(b.z); h.num(b.qx); h.num(b.qy); h.num(b.qz); h.num(b.qw); h.num(b.vx); h.num(b.vy); h.num(b.vz); h.num(b.wx); h.num(b.wy); h.num(b.wz); h.word(b.sleeping ? 1 : 0); } };

/** A pile of mixed bodies dropped on a terrain with a ramp, 400 steps: every pose and velocity, bit for bit. */
function rigidPile() {
  const r = rng(302), h = new Hasher();
  resetBodyIds();
  const t = new TriWorld({ cellSize: 4 });
  t.addBox(0, -1, 0, 40, 1, 40); t.addQuad(5, 0, -6, 12, 2.5, -6, 12, 2.5, 6, 5, 0, 6); t.addBox(-8, 1, 0, 0.5, 1, 6);
  t.build();
  const w = new PhysicsWorld({ terrain: t });
  for (let i = 0; i < 60; i++) w.add(new RigidBody({ shape: shapeOf(r, i), x: (unit(r()) - 0.5) * 14, y: 1.5 + unit(r()) * 8, z: (unit(r()) - 0.5) * 8, rotation: randomRotation(r), restitution: unit(r()) * 0.4, friction: 0.3 + unit(r()) * 0.5, mass: 2 + unit(r()) * 8 }));
  for (let i = 0; i < 400; i++) { w.step(1 / 60); if (i % 50 === 0) hashWorld(h, w); }
  hashWorld(h, w);
  return h.hex;
}

/** Joints: a chain, a hinged door with a motor, a welded pair and a spring, 300 steps. */
function rigidJoints() {
  const h = new Hasher();
  resetBodyIds();
  const w = new PhysicsWorld({ iterations: 12, substeps: 3 });
  let prev = null;
  for (let i = 0; i < 8; i++) {
    const l = w.add(new RigidBody({ shape: box(0.05, 0.25, 0.05), x: 0, y: 10 - i * 0.5 - 0.25, mass: 0.5, canSleep: false }));
    w.addJoint(new BallJoint(prev, l, [0, 10 - i * 0.5, 0])); prev = l;
  }
  const door = w.add(new RigidBody({ shape: box(0.6, 1, 0.05), x: 5.6, y: 1, mass: 8, canSleep: false }));
  w.addJoint(new HingeJoint(null, door, [5, 1, 0], [0, 1, 0], { motor: { speed: 1.5, maxTorque: 100 }, limits: [-1, 2] }));
  const a = w.add(new RigidBody({ shape: box(0.5, 0.5, 0.5), x: 10, y: 5, mass: 3, canSleep: false })), b = w.add(new RigidBody({ shape: box(0.5, 0.5, 0.5), x: 11, y: 5, mass: 3, canSleep: false }));
  w.addJoint(new FixedJoint(a, b, [10.5, 5, 0]));
  const s = w.add(new RigidBody({ shape: sphere(0.3), x: 15, y: 4, mass: 1, canSleep: false }));
  w.addJoint(new DistanceJoint(null, s, [15, 6, 0], [15, 4, 0], { length: 1.5, frequency: 2, damping: 0.2 }));
  w.bodies[0].applyImpulse(3, 0, 1); a.setAngularVelocity(1, 2, 3);
  for (let i = 0; i < 300; i++) { w.step(1 / 60); if (i % 30 === 0) hashWorld(h, w); }
  hashWorld(h, w);
  return h.hex;
}

function rigidRagdoll() {
  const h = new Hasher();
  resetBodyIds();
  const terrain = new TriWorld(); terrain.addBox(0, -1, 0, 50, 1, 50); terrain.build();
  const w = new PhysicsWorld({ terrain, substeps: 4, iterations: 16 });
  const rag = new Ragdoll(humanoidRagdollSpec({ height: 1.8, mass: 75 }), { x: 0, y: 1, z: 0, yaw: 0.5 }).addTo(w);
  const pendulum = w.add(new RigidBody({ shape: box(0.03, 0.5, 0.03), x: 4, y: -0.5 + 6, z: 0, mass: 1, canSleep: false }));
  w.addJoint(new ConeJoint(null, pendulum, [4, 6, 0], [0, -1, 0], 0.5)); pendulum.setVelocity(4, 0, 0);
  rag.applyImpulse('head', 30, 0, 10);
  for (let i = 0; i < 240; i++) { w.step(1 / 60); if (i % 40 === 0) hashWorld(h, w); }
  hashWorld(h, w);
  return h.hex;
}

function rigidVehicle() {
  const h = new Hasher();
  resetBodyIds();
  const terrain = new TriWorld(); terrain.addBox(0, -1, 0, 80, 1, 80); terrain.build();
  const w = new PhysicsWorld({ terrain, substeps: 2, iterations: 8 });
  const chassis = w.add(new RigidBody({ shape: box(0.9, 0.25, 2.0), x: 0, y: 1.2, z: 0, mass: 1200, linearDamping: 0, canSleep: false }));
  const wheel = (x, z, front) => ({ x, y: -0.1, z, radius: 0.35, suspensionLength: 0.3, friction: 0.9, steer: front ? 1 : 0, drive: 1, handbrake: !front });
  const car = new RaycastVehicle(w, chassis, { wheels: [wheel(0.8, 1.3, true), wheel(-0.8, 1.3, true), wheel(0.8, -1.3, false), wheel(-0.8, -1.3, false)], antiRoll: [[0, 1, 15000], [2, 3, 15000]] });
  for (let i = 0; i < 360; i++) {
    car.engineForce = i < 200 ? 3500 : 0; car.brake = i >= 300 ? 6000 : 0; car.handbrake = i >= 250 && i < 300 ? 4000 : 0;
    car.steering = i < 120 ? 0 : i < 240 ? 0.25 : -0.2;
    car.update(1 / 60); w.step(1 / 60);
    if (i % 30 === 0) { hashWorld(h, w); for (const wh of car.wheels) { h.num(wh.spin); h.num(wh.compression); h.num(wh.load); } }
  }
  hashWorld(h, w);
  return h.hex;
}

/** @returns {{exact: Record<string, string>, probe: Record<string, string>}} */
export function runPhysics3dSuite() {
  return {
    exact: { 'physics3d.narrow': narrowPhase(), 'physics3d.broad': broadPhase(), 'physics3d.slide': slideFuzz(), 'physics3d.character': character(), 'rigid.contacts': rigidContacts(), 'rigid.pile': rigidPile(), 'rigid.joints': rigidJoints(), 'rigid.ragdoll': rigidRagdoll(), 'rigid.vehicle': rigidVehicle() },
    probe: {},
  };
}
