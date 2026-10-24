// Joints: constraints between two bodies (or a body and the world), solved with the same sequential impulses as contacts.
// Ball-and-socket, hinge (with limits and a motor), fixed (weld) and distance (rope, rod, spring). Only + - * / and sqrt.
import { STATIC_BODY } from './body.js';
import { mulInertia, pushImpulse } from './solver.js';
import { atan2 } from '../../../math/src/index.js';

const t3 = [0, 0, 0];
const TWO_PI = 6.283185307179586;

function inv3(m, out) { // inverse of a symmetric-or-not 3x3 (row-major), false if singular
  const a = m[0], b = m[1], c = m[2], d = m[3], e = m[4], f = m[5], g = m[6], h = m[7], i = m[8];
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-18) return false;
  const k = 1 / det;
  out[0] = A * k; out[1] = -(b * i - c * h) * k; out[2] = (b * f - c * e) * k;
  out[3] = B * k; out[4] = (a * i - c * g) * k; out[5] = -(a * f - c * d) * k;
  out[6] = C * k; out[7] = -(a * h - b * g) * k; out[8] = (a * e - b * d) * k;
  return true;
}

/** Base: two bodies (null stands for the world). Angles, speeds and impulses are those of body b relative to body a. */
// Base: two bodies, a flag for whether they still collide with each other, and an optional break threshold. */
/**
 * Base of all joints: two bodies (`null` means the world), whether they still collide with each other, and an optional break
 * threshold. Angles, speeds and impulses are those of body b relative to body a.
 */
export class Joint {
  constructor(a, b) {
    this.a = a ?? STATIC_BODY; // null: the world
    this.b = b ?? STATIC_BODY;
    /** Whether the two bodies still collide with each other (off by default: a chain's links overlap at the joints). */
    this.collideConnected = false;
    /** The joint snaps when it has to push with more than this impulse in one step (Infinity: never). */
    this.breakImpulse = Infinity;
    this.broken = false;
    /** Like a body's key: matches a saved joint to this one when the scene is rebuilt in a new session. */
    this.key = null;
  }
  prepare() {}
  warmStart() {}
  solve() {}
  /** The numbers that must be remembered to carry on exactly where it left off (impulses for warm starting, hinge angle). */
  saveState() { return []; }
  loadState() {}
}

/** Three linear rows holding a point of each body together: the anchor of a ball-and-socket, a hinge and a weld. */
class PointJoint extends Joint {
  constructor(a, b, ax, ay, az) {
    super(a, b);
    a = this.a;
    this.la = a.toLocal(ax, ay, az, [0, 0, 0]);
    this.lb = this.b.toLocal(ax, ay, az, [0, 0, 0]);
    this.jx = 0; this.jy = 0; this.jz = 0;
    this.K = new Float64Array(9); this.Ki = new Float64Array(9);
    this.rax = 0; this.ray = 0; this.raz = 0; this.rbx = 0; this.rby = 0; this.rbz = 0;
    this.bx = 0; this.by = 0; this.bz = 0;
  }
  saveState() { return [this.jx, this.jy, this.jz]; }
  loadState(s) { this.jx = s[0]; this.jy = s[1]; this.jz = s[2]; }
  preparePoint(h, beta) {
    const { a, b, la, lb } = this, ra = a.r, rb = b.r;
    this.rax = ra[0] * la[0] + ra[1] * la[1] + ra[2] * la[2]; this.ray = ra[3] * la[0] + ra[4] * la[1] + ra[5] * la[2]; this.raz = ra[6] * la[0] + ra[7] * la[1] + ra[8] * la[2];
    this.rbx = rb[0] * lb[0] + rb[1] * lb[1] + rb[2] * lb[2]; this.rby = rb[3] * lb[0] + rb[4] * lb[1] + rb[5] * lb[2]; this.rbz = rb[6] * lb[0] + rb[7] * lb[1] + rb[8] * lb[2];
    // K: the response of the relative anchor velocity to a unit impulse along each axis
    const K = this.K, m = a.invMass + b.invMass;
    for (let e = 0; e < 3; e++) {
      const px = e === 0 ? 1 : 0, py = e === 1 ? 1 : 0, pz = e === 2 ? 1 : 0;
      let vx = m * px, vy = m * py, vz = m * pz;
      for (const [body, rx, ry, rz] of [[a, this.rax, this.ray, this.raz], [b, this.rbx, this.rby, this.rbz]]) {
        if (body.invMass === 0) continue;
        mulInertia(body.iw, ry * pz - rz * py, rz * px - rx * pz, rx * py - ry * px, t3);
        vx += t3[1] * rz - t3[2] * ry; vy += t3[2] * rx - t3[0] * rz; vz += t3[0] * ry - t3[1] * rx;
      }
      K[e] = vx; K[3 + e] = vy; K[6 + e] = vz;
    }
    this.ok = inv3(K, this.Ki);
    const k = beta / h;
    this.bx = k * ((b.x + this.rbx) - (a.x + this.rax)); this.by = k * ((b.y + this.rby) - (a.y + this.ray)); this.bz = k * ((b.z + this.rbz) - (a.z + this.raz));
  }
  warmPoint() {
    pushImpulse(this.a, -1, this.rax, this.ray, this.raz, this.jx, this.jy, this.jz);
    pushImpulse(this.b, 1, this.rbx, this.rby, this.rbz, this.jx, this.jy, this.jz);
  }
  solvePoint() {
    if (!this.ok) return;
    const { a, b } = this, Ki = this.Ki;
    const cx = b.vx + b.wy * this.rbz - b.wz * this.rby - a.vx - a.wy * this.raz + a.wz * this.ray + this.bx;
    const cy = b.vy + b.wz * this.rbx - b.wx * this.rbz - a.vy - a.wz * this.rax + a.wx * this.raz + this.by;
    const cz = b.vz + b.wx * this.rby - b.wy * this.rbx - a.vz - a.wx * this.ray + a.wy * this.rax + this.bz;
    const px = -(Ki[0] * cx + Ki[1] * cy + Ki[2] * cz), py = -(Ki[3] * cx + Ki[4] * cy + Ki[5] * cz), pz = -(Ki[6] * cx + Ki[7] * cy + Ki[8] * cz);
    this.jx += px; this.jy += py; this.jz += pz;
    pushImpulse(a, -1, this.rax, this.ray, this.raz, px, py, pz);
    pushImpulse(b, 1, this.rbx, this.rby, this.rbz, px, py, pz);
  }
}

/** A ball-and-socket: the two bodies share a point and rotate freely about it (a shoulder, a rope link). */
export class BallJoint extends PointJoint {
  /** @param {import('./body.js').RigidBody | null} a @param {import('./body.js').RigidBody | null} b null is the world. @param {number[]} anchor world position */
  constructor(a, b, anchor) { super(a, b, anchor[0], anchor[1], anchor[2]); }
  prepare(h, beta) { this.preparePoint(h, beta); }
  warmStart() { this.warmPoint(); }
  solve() { this.solvePoint(); }
}

/** Angular rows along one direction: removes relative spin about `u`, with a target speed `bias` (per second). */
function angularRow(a, b, ux, uy, uz) {
  mulInertia(a.iw, ux, uy, uz, t3); const ka = ux * t3[0] + uy * t3[1] + uz * t3[2];
  mulInertia(b.iw, ux, uy, uz, t3); const kb = ux * t3[0] + uy * t3[1] + uz * t3[2];
  const k = ka + kb;
  return k > 0 ? 1 / k : 0;
}
function spin(b, sign, ix, iy, iz) {
  if (b.invMass === 0 && b.invIx === 0) return;
  mulInertia(b.iw, ix, iy, iz, t3);
  b.wx += sign * t3[0]; b.wy += sign * t3[1]; b.wz += sign * t3[2];
}

/**
 * A hinge: the bodies share a point and can only rotate about one axis (a door, a wheel, a knee).
 * Optional `limits: [min, max]` in radians about the axis, and a `motor` { speed (rad/s), maxTorque (N m) }.
 */
export class HingeJoint extends PointJoint {
  /** @param {number[]} anchor world position @param {number[]} axis world direction of the hinge axis */
  constructor(a, b, anchor, axis, { limits = null, motor = null } = {}) {
    super(a, b, anchor[0], anchor[1], anchor[2]);
    a = this.a;
    const l = Math.sqrt(axis[0] * axis[0] + axis[1] * axis[1] + axis[2] * axis[2]);
    const ax = axis[0] / l, ay = axis[1] / l, az = axis[2] / l;
    this.axA = a.toLocal(a.x + ax, a.y + ay, a.z + az, [0, 0, 0]); this.axB = this.b.toLocal(this.b.x + ax, this.b.y + ay, this.b.z + az, [0, 0, 0]);
    // a reference direction perpendicular to the axis, in both bodies, to measure the angle by
    let rx, ry, rz;
    if (Math.abs(ay) < 0.9) { rx = -az; ry = 0; rz = ax; } else { rx = 0; ry = az; rz = -ay; }
    const rl = Math.sqrt(rx * rx + ry * ry + rz * rz); rx /= rl; ry /= rl; rz /= rl;
    this.refA = a.toLocal(a.x + rx, a.y + ry, a.z + rz, [0, 0, 0]); this.refB = this.b.toLocal(this.b.x + rx, this.b.y + ry, this.b.z + rz, [0, 0, 0]);
    this.limits = limits; this.motor = motor;
    this.angle = 0; this.turns = 0; this.lastRaw = 0;
    this.j1 = 0; this.j2 = 0; this.jLimit = 0; this.jMotor = 0;
    this.u = [0, 0, 0]; this.v = [0, 0, 0]; this.w = [0, 0, 0];
    this.k1 = 0; this.k2 = 0; this.kAxis = 0; this.e1 = 0; this.e2 = 0; this.limitBias = 0; this.limitActive = 0; this.h = 1;
  }
  saveState() { return [this.jx, this.jy, this.jz, this.j1, this.j2, this.jLimit, this.jMotor, this.angle, this.lastRaw]; }
  loadState(s) { this.jx = s[0]; this.jy = s[1]; this.jz = s[2]; this.j1 = s[3]; this.j2 = s[4]; this.jLimit = s[5]; this.jMotor = s[6]; this.angle = s[7]; this.lastRaw = s[8]; }
  /** The current hinge angle in radians (0 at creation, continuing past a half turn). */
  get hingeAngle() { return this.angle; }
  prepare(h, beta) {
    this.preparePoint(h, beta);
    const { a, b } = this;
    this.h = h;
    const ra = a.r, rb = b.r;
    const wa = [ra[0] * this.axA[0] + ra[1] * this.axA[1] + ra[2] * this.axA[2], ra[3] * this.axA[0] + ra[4] * this.axA[1] + ra[5] * this.axA[2], ra[6] * this.axA[0] + ra[7] * this.axA[1] + ra[8] * this.axA[2]];
    const wb = [rb[0] * this.axB[0] + rb[1] * this.axB[1] + rb[2] * this.axB[2], rb[3] * this.axB[0] + rb[4] * this.axB[1] + rb[5] * this.axB[2], rb[6] * this.axB[0] + rb[7] * this.axB[1] + rb[8] * this.axB[2]];
    // the axis directions (in a's frame) and the two directions perpendicular to it
    this.w[0] = wa[0]; this.w[1] = wa[1]; this.w[2] = wa[2];
    const u = this.u, v = this.v;
    if (Math.abs(wa[1]) < 0.9) { u[0] = -wa[2]; u[1] = 0; u[2] = wa[0]; } else { u[0] = 0; u[1] = wa[2]; u[2] = -wa[1]; }
    const ul = Math.sqrt(u[0] * u[0] + u[1] * u[1] + u[2] * u[2]); u[0] /= ul; u[1] /= ul; u[2] /= ul;
    v[0] = wa[1] * u[2] - wa[2] * u[1]; v[1] = wa[2] * u[0] - wa[0] * u[2]; v[2] = wa[0] * u[1] - wa[1] * u[0];
    this.k1 = angularRow(a, b, u[0], u[1], u[2]); this.k2 = angularRow(a, b, v[0], v[1], v[2]); this.kAxis = angularRow(a, b, wa[0], wa[1], wa[2]);
    // misalignment of the two axes: a x b, measured along u and v
    const cx = wa[1] * wb[2] - wa[2] * wb[1], cy = wa[2] * wb[0] - wa[0] * wb[2], cz = wa[0] * wb[1] - wa[1] * wb[0];
    const k = beta / h;
    this.e1 = k * (cx * u[0] + cy * u[1] + cz * u[2]); this.e2 = k * (cx * v[0] + cy * v[1] + cz * v[2]);
    // the angle about the axis, from the reference directions
    const fa = [ra[0] * this.refA[0] + ra[1] * this.refA[1] + ra[2] * this.refA[2], ra[3] * this.refA[0] + ra[4] * this.refA[1] + ra[5] * this.refA[2], ra[6] * this.refA[0] + ra[7] * this.refA[1] + ra[8] * this.refA[2]];
    const fb = [rb[0] * this.refB[0] + rb[1] * this.refB[1] + rb[2] * this.refB[2], rb[3] * this.refB[0] + rb[4] * this.refB[1] + rb[5] * this.refB[2], rb[6] * this.refB[0] + rb[7] * this.refB[1] + rb[8] * this.refB[2]];
    const sinp = (fa[1] * fb[2] - fa[2] * fb[1]) * wa[0] + (fa[2] * fb[0] - fa[0] * fb[2]) * wa[1] + (fa[0] * fb[1] - fa[1] * fb[0]) * wa[2];
    const cosp = fa[0] * fb[0] + fa[1] * fb[1] + fa[2] * fb[2];
    const raw = atan2(sinp, cosp);
    let d = raw - this.lastRaw;
    if (d > 3.141592653589793) d -= TWO_PI; else if (d < -3.141592653589793) d += TWO_PI; // unwrap so the angle can pass half a turn
    this.angle += d; this.lastRaw = raw;
    this.limitActive = 0;
    if (this.limits) {
      if (this.angle < this.limits[0]) { this.limitActive = 1; this.limitBias = beta / h * (this.angle - this.limits[0]); }
      else if (this.angle > this.limits[1]) { this.limitActive = -1; this.limitBias = beta / h * (this.angle - this.limits[1]); }
    }
  }
  warmStart() {
    this.warmPoint();
    const { a, b, u, v, w } = this;
    const x = u[0] * this.j1 + v[0] * this.j2 + w[0] * (this.jLimit + this.jMotor), y = u[1] * this.j1 + v[1] * this.j2 + w[1] * (this.jLimit + this.jMotor), z = u[2] * this.j1 + v[2] * this.j2 + w[2] * (this.jLimit + this.jMotor);
    spin(a, -1, x, y, z); spin(b, 1, x, y, z);
  }
  solve() {
    this.solvePoint();
    const { a, b, u, v, w } = this;
    const rel = (d) => (b.wx - a.wx) * d[0] + (b.wy - a.wy) * d[1] + (b.wz - a.wz) * d[2];
    let j = -(rel(u) + this.e1) * this.k1; this.j1 += j; spin(a, -1, u[0] * j, u[1] * j, u[2] * j); spin(b, 1, u[0] * j, u[1] * j, u[2] * j);
    j = -(rel(v) + this.e2) * this.k2; this.j2 += j; spin(a, -1, v[0] * j, v[1] * j, v[2] * j); spin(b, 1, v[0] * j, v[1] * j, v[2] * j);
    if (this.motor) {
      const max = this.motor.maxTorque * this.h;
      const old = this.jMotor;
      let n = old - (rel(w) - this.motor.speed) * this.kAxis;
      n = n > max ? max : n < -max ? -max : n;
      j = n - old; this.jMotor = n; spin(a, -1, w[0] * j, w[1] * j, w[2] * j); spin(b, 1, w[0] * j, w[1] * j, w[2] * j);
    }
    if (this.limitActive !== 0) { // one-sided: only push back, never pull
      const old = this.jLimit;
      let n = old - (rel(w) + this.limitBias) * this.kAxis;
      n = this.limitActive > 0 ? (n < 0 ? 0 : n) : (n > 0 ? 0 : n);
      j = n - old; this.jLimit = n; spin(a, -1, w[0] * j, w[1] * j, w[2] * j); spin(b, 1, w[0] * j, w[1] * j, w[2] * j);
    } else this.jLimit = 0;
  }
}

/** A weld: the bodies keep their relative position and orientation (a bolted-on part that can break off). */
export class FixedJoint extends PointJoint {
  constructor(a, b, anchor) {
    super(a, b, anchor[0], anchor[1], anchor[2]);
    a = this.a;
    // the orientation of b as seen by a: conj(qa) * qb
    const q = this.b;
    const cx = -a.qx, cy = -a.qy, cz = -a.qz, cw = a.qw;
    this.rqx = cw * q.qx + cx * q.qw + cy * q.qz - cz * q.qy;
    this.rqy = cw * q.qy - cx * q.qz + cy * q.qw + cz * q.qx;
    this.rqz = cw * q.qz + cx * q.qy - cy * q.qx + cz * q.qw;
    this.rqw = cw * q.qw - cx * q.qx - cy * q.qy - cz * q.qz;
    this.L = [0, 0, 0]; this.Ang = new Float64Array(9); this.AngInv = new Float64Array(9); this.angOk = false; this.ex = 0; this.ey = 0; this.ez = 0;
  }
  saveState() { return [this.jx, this.jy, this.jz, this.L[0], this.L[1], this.L[2]]; }
  loadState(s) { this.jx = s[0]; this.jy = s[1]; this.jz = s[2]; this.L[0] = s[3]; this.L[1] = s[4]; this.L[2] = s[5]; }
  prepare(h, beta) {
    this.preparePoint(h, beta);
    const { a, b } = this;
    // target orientation of b: qa * rel; the error is the rotation from there to the actual one, as a vector
    const tx = a.qw * this.rqx + a.qx * this.rqw + a.qy * this.rqz - a.qz * this.rqy;
    const ty = a.qw * this.rqy - a.qx * this.rqz + a.qy * this.rqw + a.qz * this.rqx;
    const tz = a.qw * this.rqz + a.qx * this.rqy - a.qy * this.rqx + a.qz * this.rqw;
    const tw = a.qw * this.rqw - a.qx * this.rqx - a.qy * this.rqy - a.qz * this.rqz;
    // dq = qb * conj(target)
    const dx = b.qw * -tx + b.qx * tw + b.qy * -tz - b.qz * -ty;
    const dy = b.qw * -ty - b.qx * -tz + b.qy * tw + b.qz * -tx;
    const dz = b.qw * -tz + b.qx * -ty - b.qy * -tx + b.qz * tw;
    const dw = b.qw * tw - b.qx * -tx - b.qy * -ty - b.qz * -tz;
    const s = dw < 0 ? -2 : 2;
    const k = beta / h;
    this.ex = k * s * dx; this.ey = k * s * dy; this.ez = k * s * dz;
    const A = this.Ang, ia = a.iw, ib = b.iw;
    A[0] = ia[0] + ib[0]; A[1] = ia[1] + ib[1]; A[2] = ia[2] + ib[2]; A[3] = ia[1] + ib[1]; A[4] = ia[3] + ib[3]; A[5] = ia[4] + ib[4]; A[6] = ia[2] + ib[2]; A[7] = ia[4] + ib[4]; A[8] = ia[5] + ib[5];
    this.angOk = inv3(A, this.AngInv);
  }
  warmStart() { this.warmPoint(); spin(this.a, -1, this.L[0], this.L[1], this.L[2]); spin(this.b, 1, this.L[0], this.L[1], this.L[2]); }
  solve() {
    this.solvePoint();
    if (!this.angOk) return;
    const { a, b } = this, K = this.AngInv;
    const cx = b.wx - a.wx + this.ex, cy = b.wy - a.wy + this.ey, cz = b.wz - a.wz + this.ez;
    // the angular rows act on the inverse-inertia sum, so the impulse is applied as torque-impulse: L = -(Ia^-1 + Ib^-1)^-1 c
    const lx = -(K[0] * cx + K[1] * cy + K[2] * cz), ly = -(K[3] * cx + K[4] * cy + K[5] * cz), lz = -(K[6] * cx + K[7] * cy + K[8] * cz);
    this.L[0] += lx; this.L[1] += ly; this.L[2] += lz;
    spin(a, -1, lx, ly, lz); spin(b, 1, lx, ly, lz);
  }
}

/**
 * A distance joint between two points: a rod (fixed `length`), a rope (`min`/`max` range) or a spring (`frequency` in Hz and
 * `damping` ratio, soft so it stretches).
 */
export class DistanceJoint extends Joint {
  /** @param {number[]} anchorA world position on a @param {number[]} anchorB world position on b */
  constructor(a, b, anchorA, anchorB, { length, min = null, max = null, frequency = 0, damping = 0.5 } = {}) {
    super(a, b);
    a = this.a;
    this.la = a.toLocal(anchorA[0], anchorA[1], anchorA[2], [0, 0, 0]); this.lb = this.b.toLocal(anchorB[0], anchorB[1], anchorB[2], [0, 0, 0]);
    const dx = anchorB[0] - anchorA[0], dy = anchorB[1] - anchorA[1], dz = anchorB[2] - anchorA[2];
    this.length = length ?? Math.sqrt(dx * dx + dy * dy + dz * dz);
    this.min = min; this.max = max; this.frequency = frequency; this.damping = damping;
    this.j = 0; this.k = 0; this.bias = 0; this.gamma = 0; this.active = false;
    this.nx = 0; this.ny = 1; this.nz = 0; this.rax = 0; this.ray = 0; this.raz = 0; this.rbx = 0; this.rby = 0; this.rbz = 0;
  }
  saveState() { return [this.j]; }
  loadState(s) { this.j = s[0]; }
  prepare(h, beta) {
    const { a, b, la, lb } = this, ra = a.r, rb = b.r;
    this.rax = ra[0] * la[0] + ra[1] * la[1] + ra[2] * la[2]; this.ray = ra[3] * la[0] + ra[4] * la[1] + ra[5] * la[2]; this.raz = ra[6] * la[0] + ra[7] * la[1] + ra[8] * la[2];
    this.rbx = rb[0] * lb[0] + rb[1] * lb[1] + rb[2] * lb[2]; this.rby = rb[3] * lb[0] + rb[4] * lb[1] + rb[5] * lb[2]; this.rbz = rb[6] * lb[0] + rb[7] * lb[1] + rb[8] * lb[2];
    const dx = b.x + this.rbx - a.x - this.rax, dy = b.y + this.rby - a.y - this.ray, dz = b.z + this.rbz - a.z - this.raz;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d > 1e-9) { this.nx = dx / d; this.ny = dy / d; this.nz = dz / d; }
    const lo = this.min ?? this.length, hi = this.max ?? this.length;
    const C = d < lo ? d - lo : d > hi ? d - hi : 0; // error outside the allowed range
    this.active = this.frequency > 0 ? true : C !== 0 || (this.min === null && this.max === null);
    let m = a.invMass + b.invMass;
    for (const [body, rx, ry, rz] of [[a, this.rax, this.ray, this.raz], [b, this.rbx, this.rby, this.rbz]]) {
      if (body.invMass === 0) continue;
      mulInertia(body.iw, ry * this.nz - rz * this.ny, rz * this.nx - rx * this.nz, rx * this.ny - ry * this.nx, t3);
      m += this.nx * (t3[1] * rz - t3[2] * ry) + this.ny * (t3[2] * rx - t3[0] * rz) + this.nz * (t3[0] * ry - t3[1] * rx);
    }
    const mass = m > 0 ? 1 / m : 0;
    if (this.frequency > 0) { // soft: a spring with this frequency and damping ratio
      const omega = 6.283185307179586 * this.frequency, dc = 2 * mass * this.damping * omega, kk = mass * omega * omega;
      const g = h * (dc + h * kk);
      this.gamma = g > 0 ? 1 / g : 0;
      this.bias = (d - this.length) * h * kk * this.gamma;
      this.k = 1 / (m + this.gamma);
    } else { this.gamma = 0; this.bias = beta / h * C; this.k = mass; }
  }
  warmStart() {
    if (!this.active) { this.j = 0; return; }
    const px = this.nx * this.j, py = this.ny * this.j, pz = this.nz * this.j;
    pushImpulse(this.a, -1, this.rax, this.ray, this.raz, px, py, pz); pushImpulse(this.b, 1, this.rbx, this.rby, this.rbz, px, py, pz);
  }
  solve() {
    if (!this.active) return;
    const { a, b } = this;
    const dvx = b.vx + b.wy * this.rbz - b.wz * this.rby - a.vx - a.wy * this.raz + a.wz * this.ray;
    const dvy = b.vy + b.wz * this.rbx - b.wx * this.rbz - a.vy - a.wz * this.rax + a.wx * this.raz;
    const dvz = b.vz + b.wx * this.rby - b.wy * this.rbx - a.vz - a.wx * this.ray + a.wy * this.rax;
    const cdot = dvx * this.nx + dvy * this.ny + dvz * this.nz;
    let j = -this.k * (cdot + this.bias + this.gamma * this.j);
    if (this.frequency === 0 && (this.min !== null || this.max !== null)) { // a rope pulls but does not push (and a strut the reverse)
      const old = this.j, n = old + j;
      const d2 = (b.x + this.rbx - a.x - this.rax) * this.nx + (b.y + this.rby - a.y - this.ray) * this.ny + (b.z + this.rbz - a.z - this.raz) * this.nz;
      const tooFar = d2 > (this.max ?? Infinity);
      j = (tooFar ? (n > 0 ? 0 : n) : (n < 0 ? 0 : n)) - old;
    }
    this.j += j;
    pushImpulse(a, -1, this.rax, this.ray, this.raz, this.nx * j, this.ny * j, this.nz * j);
    pushImpulse(b, 1, this.rbx, this.rby, this.rbz, this.nx * j, this.ny * j, this.nz * j);
  }
}

/**
 * A ball-and-socket whose swing is limited: the two bodies share a point, and the angle between `axis` (a direction fixed in each body, taken from the world direction you pass at
 * creation) as seen on body a and on body b may not exceed `maxSwing` radians. A shoulder that cannot reach behind the back, a neck, a hip. Twist about the axis is free.
 * Angles and impulses are those of body b relative to body a.
 */
export class ConeJoint extends PointJoint {
  /** @param {number[]} anchor world position @param {number[]} axis world direction of the cone's centre line @param {number} maxSwing radians, 0 to just under pi */
  constructor(a, b, anchor, axis, maxSwing) {
    super(a, b, anchor[0], anchor[1], anchor[2]);
    a = this.a;
    const l = Math.sqrt(axis[0] * axis[0] + axis[1] * axis[1] + axis[2] * axis[2]);
    const ax = axis[0] / l, ay = axis[1] / l, az = axis[2] / l;
    this.axA = a.toLocal(a.x + ax, a.y + ay, a.z + az, [0, 0, 0]); this.axB = this.b.toLocal(this.b.x + ax, this.b.y + ay, this.b.z + az, [0, 0, 0]);
    this.maxSwing = maxSwing;
    /** The current swing in radians (as of the last step). */
    this.swing = 0;
    this.jCone = 0; this.n = [0, 0, 0]; this.active = false; this.coneBias = 0; this.kCone = 0;
  }
  saveState() { return [this.jx, this.jy, this.jz, this.jCone]; }
  loadState(s) { this.jx = s[0]; this.jy = s[1]; this.jz = s[2]; this.jCone = s[3] ?? 0; }
  prepare(h, beta) {
    this.preparePoint(h, beta);
    const { a, b } = this, ra = a.r, rb = b.r, A = this.axA, B = this.axB;
    const wax = ra[0] * A[0] + ra[1] * A[1] + ra[2] * A[2], way = ra[3] * A[0] + ra[4] * A[1] + ra[5] * A[2], waz = ra[6] * A[0] + ra[7] * A[1] + ra[8] * A[2];
    const wbx = rb[0] * B[0] + rb[1] * B[1] + rb[2] * B[2], wby = rb[3] * B[0] + rb[4] * B[1] + rb[5] * B[2], wbz = rb[6] * B[0] + rb[7] * B[1] + rb[8] * B[2];
    const cx = way * wbz - waz * wby, cy = waz * wbx - wax * wbz, cz = wax * wby - way * wbx;
    const s = Math.sqrt(cx * cx + cy * cy + cz * cz);
    this.swing = atan2(s, wax * wbx + way * wby + waz * wbz);
    this.active = this.swing > this.maxSwing && s > 1e-9;
    if (this.active) {
      this.n[0] = cx / s; this.n[1] = cy / s; this.n[2] = cz / s;      // turning b about this axis, in the positive sense, widens the swing
      this.coneBias = beta / h * (this.swing - this.maxSwing);
      this.kCone = angularRow(a, b, this.n[0], this.n[1], this.n[2]);
    } else this.jCone = 0;
  }
  warmStart() {
    this.warmPoint();
    if (!this.active) return;
    const n = this.n;
    spin(this.a, -1, n[0] * this.jCone, n[1] * this.jCone, n[2] * this.jCone); spin(this.b, 1, n[0] * this.jCone, n[1] * this.jCone, n[2] * this.jCone);
  }
  solve() {
    this.solvePoint();
    if (!this.active) return;
    const { a, b, n } = this;
    const rel = (b.wx - a.wx) * n[0] + (b.wy - a.wy) * n[1] + (b.wz - a.wz) * n[2];
    const old = this.jCone;
    let next = old - (rel + this.coneBias) * this.kCone;
    if (next > 0) next = 0;                                            // one-sided: only push back, never pull
    const j = next - old; this.jCone = next;
    spin(a, -1, n[0] * j, n[1] * j, n[2] * j); spin(b, 1, n[0] * j, n[1] * j, n[2] * j);
  }
}
