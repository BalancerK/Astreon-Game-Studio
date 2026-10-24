// Steering: small functions that turn "where do I want to go" into a velocity to walk with, on the ground plane. Each writes a desired
// velocity {x, z} (metres per second) into `out` and returns it; combine several with `blend`. An agent is any object with
// x, y, z, vx, vz (and a `maxSpeed`). Only + - * / and sqrt, no allocation per call, and randomness comes from the generator you pass.

/** A moving thing to steer. Positions in metres, velocities in m/s. */
export class SteeringAgent {
  constructor({ x = 0, y = 0, z = 0, maxSpeed = 4, maxAccel = 25, radius = 0.4 } = {}) {
    this.x = x; this.y = y; this.z = z; this.vx = 0; this.vz = 0;
    this.maxSpeed = maxSpeed; this.maxAccel = maxAccel; this.radius = radius;
  }
}

const len = (x, z) => Math.sqrt(x * x + z * z);

/** Clamp a vector to a length. */
export function limit(out, max) {
  const l = len(out.x, out.z);
  if (l > max && l > 0) { const k = max / l; out.x *= k; out.z *= k; }
  return out;
}

/** Walk straight toward a point at full speed. */
export function seek(agent, tx, tz, out = { x: 0, z: 0 }) {
  const dx = tx - agent.x, dz = tz - agent.z, l = len(dx, dz);
  if (l < 1e-9) { out.x = 0; out.z = 0; } else { out.x = dx / l * agent.maxSpeed; out.z = dz / l * agent.maxSpeed; }
  return out;
}

/** Walk away from a point at full speed. */
export function flee(agent, fx, fz, out = { x: 0, z: 0 }) {
  seek(agent, fx, fz, out); out.x = -out.x; out.z = -out.z;
  return out;
}

/** Like seek, but slow down inside `slowRadius` and stop at the point (speed falls off linearly with the distance left). */
export function arrive(agent, tx, tz, slowRadius = 2, out = { x: 0, z: 0 }) {
  const dx = tx - agent.x, dz = tz - agent.z, l = len(dx, dz);
  if (l < 1e-6) { out.x = 0; out.z = 0; return out; }
  const speed = l >= slowRadius ? agent.maxSpeed : agent.maxSpeed * (l / slowRadius);
  out.x = dx / l * speed; out.z = dz / l * speed;
  return out;
}

/** Seek where a moving target will be (looking ahead by the time it takes to reach it). target: {x, z, vx, vz}. */
export function pursue(agent, target, out = { x: 0, z: 0 }) {
  const dx = target.x - agent.x, dz = target.z - agent.z, d = len(dx, dz);
  const ahead = d / (agent.maxSpeed + len(target.vx ?? 0, target.vz ?? 0) + 1e-9);
  return seek(agent, target.x + (target.vx ?? 0) * ahead, target.z + (target.vz ?? 0) * ahead, out);
}

/** Run from where a moving target will be. */
export function evade(agent, target, out = { x: 0, z: 0 }) {
  pursue(agent, target, out); out.x = -out.x; out.z = -out.z;
  return out;
}

/**
 * Meander: keep going roughly the way you were going, turning a little at random. `state` is `{dx, dz}` (create with `{dx: 1, dz: 0}`).
 * @param {() => number} rng 0..1
 * @param {number} [turn] How much the heading may change per call, 0..1 (0.3).
 */
export function wander(agent, state, rng, turn = 0.3, out = { x: 0, z: 0 }) {
  let nx = state.dx + (rng() - 0.5) * 2 * turn, nz = state.dz + (rng() - 0.5) * 2 * turn;
  const l = len(nx, nz) || 1;
  nx /= l; nz /= l;
  state.dx = nx; state.dz = nz;
  out.x = nx * agent.maxSpeed * 0.6; out.z = nz * agent.maxSpeed * 0.6;
  return out;
}

/**
 * Push away from neighbours that are too close (each pushes harder the closer it is).
 * @param {{x: number, z: number, radius?: number}[]} neighbours
 */
export function separation(agent, neighbours, distance = 1.5, out = { x: 0, z: 0 }) {
  let sx = 0, sz = 0;
  for (const o of neighbours) {
    if (o === agent) continue;
    const dx = agent.x - o.x, dz = agent.z - o.z, d = len(dx, dz), want = distance + (o.radius ?? 0) + agent.radius;
    if (d < want && d > 1e-9) { const k = (want - d) / want / d; sx += dx * k; sz += dz * k; }
  }
  out.x = sx * agent.maxSpeed; out.z = sz * agent.maxSpeed;
  return out;
}

/** Match the average heading of neighbours. */
export function alignment(agent, neighbours, out = { x: 0, z: 0 }) {
  let sx = 0, sz = 0, n = 0;
  for (const o of neighbours) { if (o === agent) continue; sx += o.vx ?? 0; sz += o.vz ?? 0; n++; }
  out.x = n ? sx / n : 0; out.z = n ? sz / n : 0;
  return out;
}

/** Move toward the middle of the neighbours. */
export function cohesion(agent, neighbours, out = { x: 0, z: 0 }) {
  let cx = 0, cz = 0, n = 0;
  for (const o of neighbours) { if (o === agent) continue; cx += o.x; cz += o.z; n++; }
  return n ? seek(agent, cx / n, cz / n, out) : (out.x = 0, out.z = 0, out);
}

/**
 * Steer around things ahead: probe along the way you are heading with `blocked(fromX, fromZ, toX, toZ)` (a ray cast or a nav
 * line-of-walk test returning true if something is in the way) and swerve to whichever side is clear.
 * @param {(x0: number, z0: number, x1: number, z1: number) => boolean} blocked
 */
export function avoidObstacles(agent, blocked, lookAhead = 2, out = { x: 0, z: 0 }) {
  const sp = len(agent.vx, agent.vz);
  out.x = 0; out.z = 0;
  if (sp < 0.05) return out;
  const hx = agent.vx / sp, hz = agent.vz / sp, reach = lookAhead + sp * 0.3;
  if (!blocked(agent.x, agent.z, agent.x + hx * reach, agent.z + hz * reach)) return out;
  // try ever wider angles on each side (rotating the heading with small fixed rotations, no trig)
  let cx = hx, cz = hz;
  const C = 0.8660254037844386, S = 0.5; // 30 degrees
  for (let i = 0; i < 3; i++) {
    for (const side of [1, -1]) {
      // rotate (hx, hz) by side * (i + 1) * 30 degrees
      let rx = hx, rz = hz;
      for (let k = 0; k <= i; k++) { const nx = rx * C - side * rz * S, nz = side * rx * S + rz * C; rx = nx; rz = nz; }
      if (!blocked(agent.x, agent.z, agent.x + rx * reach, agent.z + rz * reach)) { out.x = rx * agent.maxSpeed; out.z = rz * agent.maxSpeed; return out; }
    }
  }
  out.x = -cx * agent.maxSpeed * 0.3; out.z = -cz * agent.maxSpeed * 0.3; // boxed in: back off
  return out;
}

/** The weighted sum of desired velocities, limited to the agent's top speed. @param {[{x: number, z: number}, number][]} parts */
export function blend(agent, parts, out = { x: 0, z: 0 }) {
  out.x = 0; out.z = 0;
  for (const [v, w] of parts) { out.x += v.x * w; out.z += v.z * w; }
  return limit(out, agent.maxSpeed);
}

/** Change the agent's velocity toward a desired one, no faster than its acceleration allows. */
export function accelerate(agent, desired, dt) {
  let ax = desired.x - agent.vx, az = desired.z - agent.vz;
  const l = len(ax, az), maxStep = agent.maxAccel * dt;
  if (l > maxStep && l > 0) { ax *= maxStep / l; az *= maxStep / l; }
  agent.vx += ax; agent.vz += az;
  return agent;
}

/**
 * Walks an agent along a path (the points from `findPath`): head for the next point, move on when close, slow down at the end.
 * `stuck` turns true when it has made no progress for `stuckTime` seconds (a moved obstacle, a blocked door): ask for a new path.
 */
export class PathFollower {
  /** @param {{x: number, y: number, z: number}[]} path */
  constructor(path = [], { reach = 0.35, slowRadius = 1.5, stuckTime = 1.2 } = {}) {
    this.reach = reach; this.slowRadius = slowRadius; this.stuckTime = stuckTime;
    this.set(path);
  }
  set(path) { this.path = path; this.index = path.length > 1 ? 1 : 0; this.done = path.length === 0; this.stuck = false; this.idle = 0; this.best = Infinity; }
  /** The point being walked to, or null. */
  get target() { return this.path[this.index] ?? null; }
  /** Metres left along the path from the agent. */
  remaining(agent) {
    if (this.done) return 0;
    let d = len(this.path[this.index].x - agent.x, this.path[this.index].z - agent.z);
    for (let i = this.index + 1; i < this.path.length; i++) d += len(this.path[i].x - this.path[i - 1].x, this.path[i].z - this.path[i - 1].z);
    return d;
  }
  /** The velocity to walk with this tick. @returns {{x: number, z: number}} out */
  desired(agent, dt, out = { x: 0, z: 0 }) {
    if (this.done) { out.x = 0; out.z = 0; return out; }
    let t = this.path[this.index];
    while (this.index < this.path.length - 1 && len(t.x - agent.x, t.z - agent.z) < this.reach) {
      this.index++; t = this.path[this.index]; this.best = Infinity; // moved on to the next point
    }
    const last = this.index === this.path.length - 1, d = len(t.x - agent.x, t.z - agent.z);
    if (last && d < this.reach) { this.done = true; out.x = 0; out.z = 0; return out; }
    if (last) arrive(agent, t.x, t.z, this.slowRadius, out); else seek(agent, t.x, t.z, out);
    if (d < this.best - 0.02) { this.best = d; this.idle = 0; } else { this.idle += dt; if (this.idle > this.stuckTime) this.stuck = true; }
    return out;
  }
}
