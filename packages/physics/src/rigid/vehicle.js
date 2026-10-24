// A raycast vehicle: a chassis body held up by spring-and-damper "wheels" that are rays, with tyre friction, engine, brakes and steering. Only + - * / and sqrt (and the engine's own sin and cos).
import { sin, cos } from '../../../math/src/index.js';

/**
 * @typedef {Object} WheelSpec
 * @property {number} x @property {number} y @property {number} z Where the suspension is fixed to the chassis, in the chassis's own coordinates (the top of the spring).
 * @property {number} [radius] 0.35.
 * @property {number} [suspensionLength] How far below the fixing the wheel's centre hangs with the spring fully extended (0.3 m).
 * @property {number} [maxCompression] How far the spring can compress before it bottoms out (80% of the length).
 * @property {number} [stiffness] Spring constant, N/m. Default: set so the car sags by a quarter of the suspension length at rest on all of its wheels, from the chassis mass.
 * @property {number} [damping] N s/m. Default: about 0.4 of critical damping for that spring.
 * @property {number} [friction] Tyre grip as a multiple of the load pressing it down (1.2: the tyre can push sideways with up to 1.2 times its load).
 * @property {number} [steer] How much of the steering angle this wheel takes (front wheels 1, rear 0; default 0).
 * @property {number} [drive] Share of the engine force this wheel gets (default 0; shares are normalised).
 * @property {number} [brake] Share of the brake force (default 1).
 * @property {boolean} [handbrake] Whether the hand brake locks this wheel (the rear wheels).
 */

/**
 * A car, bike, cart, hovercraft or anything else that rolls on springs. The chassis is an ordinary dynamic `RigidBody` in the world; each wheel casts a ray down from its fixing, pushes the
 * chassis up with a spring and damper where it hits, and grips the ground sideways and along (engine, brakes, rolling resistance) up to what its load allows (a friction circle: a wheel that is
 * braking hard has less grip to turn with). Call `update(dt)` once per tick, **before** `world.step(dt)`.
 *
 * Chassis axes: `forward` (default +z) and `up` (default +y) in its own coordinates; positive `steering` turns toward the right, the side your right hand is on looking along `forward` with `up` overhead (with forward +z that is -x).
 */
export class RaycastVehicle {
  /**
   * @param {import('./world.js').PhysicsWorld} world @param {import('./body.js').RigidBody} chassis
   * @param {object} o
   * @param {WheelSpec[]} o.wheels
   * @param {number[]} [o.forward] @param {number[]} [o.up]
   * @param {number} [o.rollingResistance] Fraction of its load a rolling wheel loses to friction (0.015).
   * @param {number} [o.maxSuspensionForce] Cap on any one spring's force in newtons (default: eight times the car's weight divided by the number of wheels).
   * @param {number[][]} [o.antiRoll] `[wheelA, wheelB, stiffness]`: an anti-roll bar between two wheels (N/m of the difference in their compression), to keep the car level in corners.
   */
  constructor(world, chassis, { wheels, forward = [0, 0, 1], up = [0, 1, 0], rollingResistance = 0.015, maxSuspensionForce, antiRoll = [] }) {
    if (!wheels?.length) throw new Error('a vehicle needs at least one wheel');
    this.world = world; this.chassis = chassis;
    this.forward = forward; this.up = up;
    this.rollingResistance = rollingResistance;
    this.antiRoll = antiRoll;
    /** Steering angle in radians (positive turns right). Set it every tick. */
    this.steering = 0;
    /** Total engine force in newtons, shared among the driven wheels (negative reverses). */
    this.engineForce = 0;
    /** Total brake force in newtons, shared among the wheels. */
    this.brake = 0;
    /** Extra brake force in newtons on each wheel that has `handbrake` (a locked wheel still only grips as much as its load allows). */
    this.handbrake = 0;
    const n = wheels.length, weight = chassis.mass * 9.81;
    this.maxSuspensionForce = maxSuspensionForce ?? 8 * weight / n;
    const driveSum = wheels.reduce((s, w) => s + (w.drive ?? 0), 0) || 1, brakeSum = wheels.reduce((s, w) => s + (w.brake ?? 1), 0) || 1;
    this.wheels = wheels.map((w) => {
      const length = w.suspensionLength ?? 0.3;
      const stiffness = w.stiffness ?? (weight / n) / (length * 0.25);
      return {
        x: w.x, y: w.y, z: w.z, radius: w.radius ?? 0.35, length, maxCompression: w.maxCompression ?? length * 0.8,
        stiffness, damping: w.damping ?? 0.8 * Math.sqrt(stiffness * (chassis.mass / n)), friction: w.friction ?? 1.2,
        steer: w.steer ?? 0, drive: (w.drive ?? 0) / driveSum, brake: (w.brake ?? 1) / brakeSum, handbrake: !!w.handbrake,
        // state, as of the last update
        contact: false, compression: 0, load: 0, suspension: length, spin: 0, spinSpeed: 0, steerAngle: 0, slip: 0, ground: null,
        point: [0, 0, 0], normal: [0, 1, 0], origin: [0, 0, 0],
      };
    });
    this.hit = { t: 0, body: null, nx: 0, ny: 0, nz: 0, x: 0, y: 0, z: 0 };
    this.notChassis = (b) => b !== this.chassis;
  }

  /** Chassis-local direction to world. */
  #dir(v) {
    const r = this.chassis.r;
    return [r[0] * v[0] + r[1] * v[1] + r[2] * v[2], r[3] * v[0] + r[4] * v[1] + r[5] * v[2], r[6] * v[0] + r[7] * v[1] + r[8] * v[2]];
  }

  /** Apply the suspension, tyre and engine forces for this tick to the chassis. Call before `world.step(dt)`. */
  update(dt) {
    const ch = this.chassis, world = this.world, hit = this.hit;
    const up = this.#dir(this.up), fwd = this.#dir(this.forward);
    const right = [fwd[1] * up[2] - fwd[2] * up[1], fwd[2] * up[0] - fwd[0] * up[2], fwd[0] * up[1] - fwd[1] * up[0]];   // forward x up
    const compress = [];
    for (const w of this.wheels) {
      const o = ch.toWorld(w.x, w.y, w.z, w.origin);
      w.contact = false; w.load = 0; w.compression = 0; w.ground = null; w.suspension = w.length;
      if (!world.raycast(o[0], o[1], o[2], -up[0], -up[1], -up[2], w.length + w.radius, hit, this.notChassis)) { w.spinSpeed *= 1 - Math.min(1, 0.5 * dt); w.spin += w.spinSpeed * dt; compress.push(0); continue; }
      const nx = hit.nx, ny = hit.ny, nz = hit.nz;
      if (nx * up[0] + ny * up[1] + nz * up[2] < 0.3) { compress.push(0); continue; }     // a wall or a steep face is not ground
      const s = hit.t - w.radius, x = Math.min(w.length - s, w.maxCompression);
      w.contact = true; w.compression = Math.max(x, 0); w.suspension = Math.max(w.length - w.compression, 0); w.ground = hit.body;
      w.point[0] = hit.x; w.point[1] = hit.y; w.point[2] = hit.z; w.normal[0] = nx; w.normal[1] = ny; w.normal[2] = nz;
      compress.push(w.compression);
    }
    // anti-roll bars push down on the more compressed side and up on the other
    const extra = new Array(this.wheels.length).fill(0);
    for (const [ia, ib, k] of this.antiRoll) {
      const a = this.wheels[ia], b = this.wheels[ib];
      if (!a.contact || !b.contact) continue;
      const f = k * (compress[ia] - compress[ib]);
      extra[ia] += f; extra[ib] -= f;
    }
    const vel = [0, 0, 0], gv = [0, 0, 0];
    this.wheels.forEach((w, wi) => {
      if (!w.contact) return;
      const p = w.point, n = w.normal;
      ch.velocityAt(p[0], p[1], p[2], vel);
      if (w.ground && w.ground.type !== 'static') { w.ground.velocityAt(p[0], p[1], p[2], gv); vel[0] -= gv[0]; vel[1] -= gv[1]; vel[2] -= gv[2]; }
      // the spring and the damper, along the ground normal
      const vn = vel[0] * n[0] + vel[1] * n[1] + vel[2] * n[2];
      let fn = w.stiffness * w.compression - w.damping * vn + extra[wi];
      fn = fn < 0 ? 0 : fn > this.maxSuspensionForce ? this.maxSuspensionForce : fn;
      w.load = fn;
      let fx = n[0] * fn, fy = n[1] * fn, fz = n[2] * fn;
      // the wheel's own directions on the ground: forward (turned by the steering) and sideways
      const sa = this.steering * w.steer, sn = sin(sa), cs = cos(sa);
      w.steerAngle = sa;
      let wfx = fwd[0] * cs + right[0] * sn, wfy = fwd[1] * cs + right[1] * sn, wfz = fwd[2] * cs + right[2] * sn;
      const d = wfx * n[0] + wfy * n[1] + wfz * n[2];
      wfx -= n[0] * d; wfy -= n[1] * d; wfz -= n[2] * d;
      const wl = Math.sqrt(wfx * wfx + wfy * wfy + wfz * wfz) || 1;
      wfx /= wl; wfy /= wl; wfz /= wl;
      const wrx = wfy * n[2] - wfz * n[1], wry = wfz * n[0] - wfx * n[2], wrz = wfx * n[1] - wfy * n[0];   // forward x normal: to the right
      const vl = vel[0] * wrx + vel[1] * wry + vel[2] * wrz, vf = vel[0] * wfx + vel[1] * wfy + vel[2] * wfz;
      // how hard the chassis answers an impulse at this point along a direction: 1 / (1/m + (r x d) . I^-1 (r x d))
      const rx = p[0] - ch.x, ry = p[1] - ch.y, rz = p[2] - ch.z;
      const eff = (dx, dy, dz) => {
        const cx = ry * dz - rz * dy, cy = rz * dx - rx * dz, cz = rx * dy - ry * dx, iw = ch.iw;
        const ix = iw[0] * cx + iw[1] * cy + iw[2] * cz, iy = iw[1] * cx + iw[3] * cy + iw[4] * cz, iz = iw[2] * cx + iw[4] * cy + iw[5] * cz;
        return 1 / (ch.invMass + cx * ix + cy * iy + cz * iz);
      };
      const grip = w.friction * fn;
      let lat = -vl * eff(wrx, wry, wrz) / dt;                                          // the force that would stop the sideways slide within this step
      let lon = this.engineForce * w.drive;
      const brakeForce = this.brake * w.brake + (w.handbrake ? this.handbrake : 0);
      const stop = -vf * eff(wfx, wfy, wfz) / dt;                                       // the force that would stop the wheel rolling
      if (brakeForce > 0) lon += Math.abs(stop) < brakeForce ? stop : (stop < 0 ? -brakeForce : brakeForce);
      else if (lon === 0) { const roll = this.rollingResistance * fn; lon += Math.abs(stop) < roll ? stop : (stop < 0 ? -roll : roll); }
      else { const roll = this.rollingResistance * fn; lon += vf > 0 ? -roll : vf < 0 ? roll : 0; }
      const mag = Math.sqrt(lat * lat + lon * lon);                                     // the friction circle: grip is shared between turning and driving
      w.slip = grip > 0 ? Math.min(mag / grip, 4) : 0;
      if (mag > grip) { const k = mag > 0 ? grip / mag : 0; lat *= k; lon *= k; }
      fx += wrx * lat + wfx * lon; fy += wry * lat + wfy * lon; fz += wrz * lat + wfz * lon;
      ch.applyForce(fx, fy, fz, p[0], p[1], p[2]);
      if (w.ground && w.ground.type === 'dynamic') w.ground.applyForce(-fx, -fy, -fz, p[0], p[1], p[2]);   // and the ground answers back
      w.spinSpeed = vf / w.radius; w.spin += w.spinSpeed * dt;
    });
  }

  /**
   * The matrix to draw wheel `i` with (column-major 4x4, in the world): the wheel's centre, its axle along the local x axis, so a cylinder lying along x spins about it; it includes steering,
   * the spin so far and how far the spring has compressed. @param {number} i @param {Float32Array | number[]} [out]
   */
  wheelMatrix(i, out = new Float32Array(16)) {
    const w = this.wheels[i], ch = this.chassis;
    const up = this.#dir(this.up), fwd = this.#dir(this.forward);
    const right = [fwd[1] * up[2] - fwd[2] * up[1], fwd[2] * up[0] - fwd[0] * up[2], fwd[0] * up[1] - fwd[1] * up[0]];
    const o = ch.toWorld(w.x, w.y, w.z, [0, 0, 0]), s = sin(w.steerAngle), c = cos(w.steerAngle), sp = sin(w.spin), cp = cos(w.spin);
    const ax = [right[0] * c - fwd[0] * s, right[1] * c - fwd[1] * s, right[2] * c - fwd[2] * s];           // the axle, turned by the steering
    const fw = [fwd[0] * c + right[0] * s, fwd[1] * c + right[1] * s, fwd[2] * c + right[2] * s];           // the way it rolls
    // spin about the axle: y' = up cos + forward sin, z' = forward cos - up sin
    const y = [up[0] * cp + fw[0] * sp, up[1] * cp + fw[1] * sp, up[2] * cp + fw[2] * sp], z = [fw[0] * cp - up[0] * sp, fw[1] * cp - up[1] * sp, fw[2] * cp - up[2] * sp];
    const px = o[0] - up[0] * w.suspension, py = o[1] - up[1] * w.suspension, pz = o[2] - up[2] * w.suspension;
    out[0] = ax[0]; out[1] = ax[1]; out[2] = ax[2]; out[3] = 0;
    out[4] = y[0]; out[5] = y[1]; out[6] = y[2]; out[7] = 0;
    out[8] = z[0]; out[9] = z[1]; out[10] = z[2]; out[11] = 0;
    out[12] = px; out[13] = py; out[14] = pz; out[15] = 1;
    return out;
  }

  /** The car's speed along its forward direction in m/s (negative when reversing). */
  get speed() { const f = this.#dir(this.forward), c = this.chassis; return c.vx * f[0] + c.vy * f[1] + c.vz * f[2]; }
  /** How many wheels are touching the ground. */
  get wheelsOnGround() { return this.wheels.reduce((n, w) => n + (w.contact ? 1 : 0), 0); }
}
