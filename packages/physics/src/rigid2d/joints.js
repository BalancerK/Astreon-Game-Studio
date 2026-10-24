import { Body2D } from './body.js';
import { circleShape } from './shapes.js';

// Joints tie two bodies together. They are solved with the contacts, a few passes each step. Pass `null` for a body to fix the joint to the world.

/** The fixed point of the world, for joints given `null` instead of a body. */
const ground = new Body2D({ shape: circleShape(0.01), type: 'static' });

/** Base of the joints: the two bodies, whether they may collide with each other, and the steps the world calls. */
export class Joint2D {
  /**
   * @param {Body2D | null} a @param {Body2D | null} b `null` is the world.
   * @param {boolean} [collideConnected] Whether the two bodies still collide with each other (false).
   */
  constructor(a, b, collideConnected = false) {
    if (!a && !b) throw new Error('a joint needs at least one body');
    this.a = a ?? ground; this.b = b ?? ground; this.collideConnected = collideConnected;
  }
  prestep() {}
  warmStart() {}
  solve() {}
}

/** The 2 x 2 mass of a point constraint (it holds two anchor points together), inverted. */
function pointMass(j) {
  const a = j.a, b = j.b, ma = a.invMass, mb = b.invMass, ia = a.invInertia, ib = b.invInertia;
  const k11 = ma + mb + ia * j.rAy * j.rAy + ib * j.rBy * j.rBy, k12 = -ia * j.rAx * j.rAy - ib * j.rBx * j.rBy, k22 = ma + mb + ia * j.rAx * j.rAx + ib * j.rBx * j.rBx;
  const det = k11 * k22 - k12 * k12;
  const inv = det !== 0 ? 1 / det : 0;
  j.m11 = k22 * inv; j.m12 = -k12 * inv; j.m22 = k11 * inv;
}

function applyImpulse(j, ix, iy) {
  const a = j.a, b = j.b;
  a.vx -= a.invMass * ix; a.vy -= a.invMass * iy; a.w -= a.invInertia * (j.rAx * iy - j.rAy * ix);
  b.vx += b.invMass * ix; b.vy += b.invMass * iy; b.w += b.invInertia * (j.rBx * iy - j.rBy * ix);
}

/**
 * A pin: the point (`x`, `y`, in the world when you make it) stays in the same place on both bodies, which can turn about it, like a hinge, a wheel's axle or a
 * pendulum's pivot. Optionally a motor turns it.
 */
export class RevoluteJoint2D extends Joint2D {
  /** @param {number} x @param {number} y The pivot, as a world position now. @param {object} [o] `motorSpeed` (rad/s) and `maxMotorTorque` (N m) turn it; `collideConnected`. */
  constructor(a, b, x, y, { motorSpeed = 0, maxMotorTorque = 0, collideConnected = false } = {}) {
    super(a, b, collideConnected);
    [this.lax, this.lay] = this.a.worldToLocal(x, y);
    [this.lbx, this.lby] = this.b.worldToLocal(x, y);
    this.motorSpeed = motorSpeed; this.maxMotorTorque = maxMotorTorque;
    this.Px = 0; this.Py = 0; this.Pm = 0;
  }
  prestep(h, beta) {
    const a = this.a, b = this.b;
    this.rAx = a.c * this.lax - a.s * this.lay; this.rAy = a.s * this.lax + a.c * this.lay;
    this.rBx = b.c * this.lbx - b.s * this.lby; this.rBy = b.s * this.lbx + b.c * this.lby;
    pointMass(this);
    const ex = b.x + this.rBx - a.x - this.rAx, ey = b.y + this.rBy - a.y - this.rAy;
    this.biasX = -beta / h * ex; this.biasY = -beta / h * ey;
    const ki = a.invInertia + b.invInertia;
    this.mMotor = ki > 0 ? 1 / ki : 0;
  }
  warmStart() { applyImpulse(this, this.Px, this.Py); this.a.w -= this.a.invInertia * this.Pm; this.b.w += this.b.invInertia * this.Pm; }
  solve(h) {
    const a = this.a, b = this.b;
    if (this.maxMotorTorque > 0) {
      const cdot = b.w - a.w - this.motorSpeed, max = this.maxMotorTorque * h;
      let imp = -this.mMotor * cdot;
      const old = this.Pm; this.Pm = Math.max(-max, Math.min(max, old + imp)); imp = this.Pm - old;
      a.w -= a.invInertia * imp; b.w += b.invInertia * imp;
    }
    const dvx = b.vx - b.w * this.rBy - a.vx + a.w * this.rAy, dvy = b.vy + b.w * this.rBx - a.vy - a.w * this.rAx;
    const rx = this.biasX - dvx, ry = this.biasY - dvy;
    const ix = this.m11 * rx + this.m12 * ry, iy = this.m12 * rx + this.m22 * ry;
    applyImpulse(this, ix, iy);
    this.Px += ix; this.Py += iy;
  }
}

/** Glue: the two bodies keep the relative position and angle they had when the joint was made (a rigid link; it can flex a little under heavy load). */
export class WeldJoint2D extends Joint2D {
  /** @param {number} x @param {number} y The point the link is made at, as a world position now. */
  constructor(a, b, x, y, { collideConnected = false } = {}) {
    super(a, b, collideConnected);
    [this.lax, this.lay] = this.a.worldToLocal(x, y);
    [this.lbx, this.lby] = this.b.worldToLocal(x, y);
    // the turn of b relative to a, to be kept
    this.refC = this.b.c * this.a.c + this.b.s * this.a.s; this.refS = this.b.s * this.a.c - this.b.c * this.a.s;
    this.Px = 0; this.Py = 0; this.Pa = 0;
  }
  prestep(h, beta) {
    const a = this.a, b = this.b;
    this.rAx = a.c * this.lax - a.s * this.lay; this.rAy = a.s * this.lax + a.c * this.lay;
    this.rBx = b.c * this.lbx - b.s * this.lby; this.rBy = b.s * this.lbx + b.c * this.lby;
    pointMass(this);
    const ex = b.x + this.rBx - a.x - this.rAx, ey = b.y + this.rBy - a.y - this.rAy;
    this.biasX = -beta / h * ex; this.biasY = -beta / h * ey;
    const cr = b.c * a.c + b.s * a.s, sr = b.s * a.c - b.c * a.s;
    this.angleError = sr * this.refC - cr * this.refS;                       // sine of the angle by which the link has turned
    this.biasA = -beta / h * this.angleError;
    const ki = a.invInertia + b.invInertia;
    this.mAngle = ki > 0 ? 1 / ki : 0;
  }
  warmStart() { applyImpulse(this, this.Px, this.Py); this.a.w -= this.a.invInertia * this.Pa; this.b.w += this.b.invInertia * this.Pa; }
  solve() {
    const a = this.a, b = this.b;
    const ia = this.mAngle * (this.biasA - (b.w - a.w));
    a.w -= a.invInertia * ia; b.w += b.invInertia * ia; this.Pa += ia;
    const dvx = b.vx - b.w * this.rBy - a.vx + a.w * this.rAy, dvy = b.vy + b.w * this.rBx - a.vy - a.w * this.rAx;
    const rx = this.biasX - dvx, ry = this.biasY - dvy;
    const ix = this.m11 * rx + this.m12 * ry, iy = this.m12 * rx + this.m22 * ry;
    applyImpulse(this, ix, iy);
    this.Px += ix; this.Py += iy;
  }
}

/** A rod or spring between a point on each body, keeping them `length` apart. With `frequency` above 0 it is a spring (Hz) with `damping` (0 loose to 1 no bounce). */
export class DistanceJoint2D extends Joint2D {
  /**
   * @param {number} ax @param {number} ay World point on body a, now. @param {number} bx @param {number} by World point on body b, now.
   * @param {object} [o] `length` (default: the distance now), `frequency` (Hz, 0 = rigid), `damping`, `collideConnected`.
   */
  constructor(a, b, ax, ay, bx, by, { length, frequency = 0, damping = 0.5, collideConnected = false } = {}) {
    super(a, b, collideConnected);
    [this.lax, this.lay] = this.a.worldToLocal(ax, ay);
    [this.lbx, this.lby] = this.b.worldToLocal(bx, by);
    this.length = length ?? Math.sqrt((bx - ax) * (bx - ax) + (by - ay) * (by - ay));
    this.frequency = frequency; this.damping = damping;
    this.P = 0;
  }
  prestep(h, beta) {
    const a = this.a, b = this.b;
    this.rAx = a.c * this.lax - a.s * this.lay; this.rAy = a.s * this.lax + a.c * this.lay;
    this.rBx = b.c * this.lbx - b.s * this.lby; this.rBy = b.s * this.lbx + b.c * this.lby;
    const dx = b.x + this.rBx - a.x - this.rAx, dy = b.y + this.rBy - a.y - this.rAy, d = Math.sqrt(dx * dx + dy * dy);
    this.nx = d > 1e-9 ? dx / d : 0; this.ny = d > 1e-9 ? dy / d : 1;
    const cA = this.rAx * this.ny - this.rAy * this.nx, cB = this.rBx * this.ny - this.rBy * this.nx;
    const k = a.invMass + b.invMass + a.invInertia * cA * cA + b.invInertia * cB * cB;
    const error = d - this.length;
    if (this.frequency > 0 && k > 0) {
      const m = 1 / k, omega = 6.283185307179586 * this.frequency, damp = 2 * m * this.damping * omega, spring = m * omega * omega;
      this.gamma = 1 / (h * (damp + h * spring));
      this.bias = error * h * spring * this.gamma;
      this.mass = 1 / (k + this.gamma);
    } else { this.gamma = 0; this.bias = beta / h * error; this.mass = k > 0 ? 1 / k : 0; }
  }
  warmStart() { applyImpulse(this, this.P * this.nx, this.P * this.ny); }
  solve() {
    const a = this.a, b = this.b;
    const dvx = b.vx - b.w * this.rBy - a.vx + a.w * this.rAy, dvy = b.vy + b.w * this.rBx - a.vy - a.w * this.rAx;
    const cdot = dvx * this.nx + dvy * this.ny;
    const imp = -this.mass * (cdot + this.bias + this.gamma * this.P);
    this.P += imp;
    applyImpulse(this, imp * this.nx, imp * this.ny);
  }
}
