// The contact solver: sequential impulses (a few passes over every contact point, normal and friction, accumulating clamped impulses),
// warm-started from the previous step so resting stacks settle and stay. Only + - * / and sqrt.

/** Multiply a world-space inverse inertia (6 numbers: xx xy xz yy yz zz) by a vector, into out. */
export function mulInertia(iw, x, y, z, out) {
  out[0] = iw[0] * x + iw[1] * y + iw[2] * z; out[1] = iw[1] * x + iw[3] * y + iw[4] * z; out[2] = iw[2] * x + iw[4] * y + iw[5] * z;
}

const tmp = [0, 0, 0];

/** How hard a unit impulse along `d` at offset `r` from the body's centre is to apply: 1/m + d . ((I^-1 (r x d)) x r). */
function effectiveMass(b, rx, ry, rz, dx, dy, dz) {
  if (b.invMass === 0) return 0;
  const cx = ry * dz - rz * dy, cy = rz * dx - rx * dz, cz = rx * dy - ry * dx;
  mulInertia(b.iw, cx, cy, cz, tmp);
  return b.invMass + dx * (tmp[1] * rz - tmp[2] * ry) + dy * (tmp[2] * rx - tmp[0] * rz) + dz * (tmp[0] * ry - tmp[1] * rx);
}

/** Apply an impulse P at offset r to a body (sign +1) or take it away (-1). */
export function pushImpulse(b, sign, rx, ry, rz, px, py, pz) {
  if (b.invMass === 0) return;
  const s = sign * b.invMass;
  b.vx += px * s; b.vy += py * s; b.vz += pz * s;
  mulInertia(b.iw, ry * pz - rz * py, rz * px - rx * pz, rx * py - ry * px, tmp);
  b.wx += sign * tmp[0]; b.wy += sign * tmp[1]; b.wz += sign * tmp[2];
}

export class ContactPoint {
  constructor() {
    this.rax = 0; this.ray = 0; this.raz = 0; this.rbx = 0; this.rby = 0; this.rbz = 0;
    this.kn = 0; this.k1 = 0; this.k2 = 0; this.bias = 0; this.depth = 0;
    this.jn = 0; this.j1 = 0; this.j2 = 0; this.px = 0; this.py = 0; this.pz = 0; this.vn0 = 0;
  }
}

export class ContactConstraint {
  constructor() {
    this.a = null; this.b = null; this.n = 0; this.key = 0;
    this.nx = 0; this.ny = 1; this.nz = 0; this.t1x = 1; this.t1y = 0; this.t1z = 0; this.t2x = 0; this.t2y = 0; this.t2z = 1;
    this.friction = 0; this.restitution = 0;
    this.begin = false; this.impactSpeed = 0;
    this.points = [new ContactPoint(), new ContactPoint(), new ContactPoint(), new ContactPoint()];
  }
}

/**
 * Set a constraint up from a manifold: lever arms, effective masses, target velocities, and the impulses remembered from last step.
 * @param {ContactConstraint} c
 * @param {import('./body.js').RigidBody} a
 * @param {import('./body.js').RigidBody} b
 * @param {import('./contacts.js').Manifold} m
 * @param {{h: number, beta: number, slop: number, maxBias: number, restThreshold: number}} o
 * @param {{n: number, px: Float64Array, py: Float64Array, pz: Float64Array, jn: Float64Array, jx: Float64Array, jy: Float64Array, jz: Float64Array} | undefined} old Last step's points and impulses for this pair.
 */
export function prepareContact(c, a, b, m, o, old) {
  c.a = a; c.b = b; c.n = m.n;
  c.nx = m.nx; c.ny = m.ny; c.nz = m.nz;
  // two tangents perpendicular to the normal
  if (Math.abs(c.nx) < 0.57735) { const l = Math.sqrt(c.ny * c.ny + c.nz * c.nz); c.t1x = 0; c.t1y = -c.nz / l; c.t1z = c.ny / l; }
  else { const l = Math.sqrt(c.nx * c.nx + c.ny * c.ny); c.t1x = c.ny / l; c.t1y = -c.nx / l; c.t1z = 0; }
  c.t2x = c.ny * c.t1z - c.nz * c.t1y; c.t2y = c.nz * c.t1x - c.nx * c.t1z; c.t2z = c.nx * c.t1y - c.ny * c.t1x;
  c.friction = Math.sqrt(a.friction * b.friction);
  c.restitution = a.restitution > b.restitution ? a.restitution : b.restitution;
  let impact = 0;
  for (let i = 0; i < m.n; i++) {
    const p = c.points[i];
    p.px = m.px[i]; p.py = m.py[i]; p.pz = m.pz[i]; p.depth = m.depth[i];
    p.rax = p.px - a.x; p.ray = p.py - a.y; p.raz = p.pz - a.z; p.rbx = p.px - b.x; p.rby = p.py - b.y; p.rbz = p.pz - b.z;
    p.kn = effectiveMass(a, p.rax, p.ray, p.raz, c.nx, c.ny, c.nz) + effectiveMass(b, p.rbx, p.rby, p.rbz, c.nx, c.ny, c.nz);
    p.k1 = effectiveMass(a, p.rax, p.ray, p.raz, c.t1x, c.t1y, c.t1z) + effectiveMass(b, p.rbx, p.rby, p.rbz, c.t1x, c.t1y, c.t1z);
    p.k2 = effectiveMass(a, p.rax, p.ray, p.raz, c.t2x, c.t2y, c.t2z) + effectiveMass(b, p.rbx, p.rby, p.rbz, c.t2x, c.t2y, c.t2z);
    p.kn = p.kn > 0 ? 1 / p.kn : 0; p.k1 = p.k1 > 0 ? 1 / p.k1 : 0; p.k2 = p.k2 > 0 ? 1 / p.k2 : 0;
    const dvx = b.vx + b.wy * p.rbz - b.wz * p.rby - a.vx - a.wy * p.raz + a.wz * p.ray;
    const dvy = b.vy + b.wz * p.rbx - b.wx * p.rbz - a.vy - a.wz * p.rax + a.wx * p.raz;
    const dvz = b.vz + b.wx * p.rby - b.wy * p.rbx - a.vz - a.wx * p.ray + a.wy * p.rax;
    p.vn0 = dvx * c.nx + dvy * c.ny + dvz * c.nz;
    if (-p.vn0 > impact) impact = -p.vn0;
    // the speed it should leave with: enough to undo the overlap (softly), or to bounce
    let bias = 0;
    if (p.depth > o.slop) { bias = o.beta * (p.depth - o.slop) / o.h; if (bias > o.maxBias) bias = o.maxBias; }
    else if (p.depth < 0) bias = p.depth / o.h; // not touching yet: allowed to close the gap this step, no more
    if (c.restitution > 0 && p.vn0 < -o.restThreshold) { const r = -c.restitution * p.vn0; if (r > bias) bias = r; }
    p.bias = bias;
    // warm start: the impulses of the nearest point from last step (friction is kept as a world vector)
    p.jn = 0; p.j1 = 0; p.j2 = 0;
    if (old) {
      let best = -1, bd = 0.0025;
      for (let k = 0; k < old.n; k++) {
        const dx = old.px[k] - p.px, dy = old.py[k] - p.py, dz = old.pz[k] - p.pz, d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < bd) { bd = d2; best = k; }
      }
      if (best >= 0) {
        p.jn = old.jn[best];
        p.j1 = old.jx[best] * c.t1x + old.jy[best] * c.t1y + old.jz[best] * c.t1z;
        p.j2 = old.jx[best] * c.t2x + old.jy[best] * c.t2y + old.jz[best] * c.t2z;
      }
    }
  }
  c.impactSpeed = impact;
}

/** Apply the remembered impulses before iterating. */
export function warmStart(c) {
  const { a, b } = c;
  for (let i = 0; i < c.n; i++) {
    const p = c.points[i];
    const px = c.nx * p.jn + c.t1x * p.j1 + c.t2x * p.j2, py = c.ny * p.jn + c.t1y * p.j1 + c.t2y * p.j2, pz = c.nz * p.jn + c.t1z * p.j1 + c.t2z * p.j2;
    pushImpulse(a, -1, p.rax, p.ray, p.raz, px, py, pz);
    pushImpulse(b, 1, p.rbx, p.rby, p.rbz, px, py, pz);
  }
}

/** One pass over the points of a constraint: friction first (it is limited by the normal impulse so far), then the normal. */
export function solveContact(c) {
  const { a, b } = c;
  for (let i = 0; i < c.n; i++) {
    const p = c.points[i];
    let dvx = b.vx + b.wy * p.rbz - b.wz * p.rby - a.vx - a.wy * p.raz + a.wz * p.ray;
    let dvy = b.vy + b.wz * p.rbx - b.wx * p.rbz - a.vy - a.wz * p.rax + a.wx * p.raz;
    let dvz = b.vz + b.wx * p.rby - b.wy * p.rbx - a.vz - a.wx * p.ray + a.wy * p.rax;
    // friction: remove the sliding velocity along both tangents, within the friction cone
    const max = c.friction * p.jn;
    let d1 = -(dvx * c.t1x + dvy * c.t1y + dvz * c.t1z) * p.k1, d2 = -(dvx * c.t2x + dvy * c.t2y + dvz * c.t2z) * p.k2;
    let n1 = p.j1 + d1, n2 = p.j2 + d2;
    const len2 = n1 * n1 + n2 * n2;
    if (len2 > max * max) { const s = len2 > 0 ? max / Math.sqrt(len2) : 0; n1 *= s; n2 *= s; }
    d1 = n1 - p.j1; d2 = n2 - p.j2; p.j1 = n1; p.j2 = n2;
    let fx = c.t1x * d1 + c.t2x * d2, fy = c.t1y * d1 + c.t2y * d2, fz = c.t1z * d1 + c.t2z * d2;
    pushImpulse(a, -1, p.rax, p.ray, p.raz, fx, fy, fz);
    pushImpulse(b, 1, p.rbx, p.rby, p.rbz, fx, fy, fz);
    // normal
    dvx = b.vx + b.wy * p.rbz - b.wz * p.rby - a.vx - a.wy * p.raz + a.wz * p.ray;
    dvy = b.vy + b.wz * p.rbx - b.wx * p.rbz - a.vy - a.wz * p.rax + a.wx * p.raz;
    dvz = b.vz + b.wx * p.rby - b.wy * p.rbx - a.vz - a.wx * p.ray + a.wy * p.rax;
    const vn = dvx * c.nx + dvy * c.ny + dvz * c.nz;
    let dj = (p.bias - vn) * p.kn;
    const nj = p.jn + dj > 0 ? p.jn + dj : 0;
    dj = nj - p.jn; p.jn = nj;
    fx = c.nx * dj; fy = c.ny * dj; fz = c.nz * dj;
    pushImpulse(a, -1, p.rax, p.ray, p.raz, fx, fy, fz);
    pushImpulse(b, 1, p.rbx, p.rby, p.rbz, fx, fy, fz);
  }
}
