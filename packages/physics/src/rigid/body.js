// Rigid bodies: shapes, mass properties and state. Plain scalar fields (no allocation while stepping) and only + - * / and sqrt,
// so a server and a client that run the same steps from the same state agree to the last bit.

/** @typedef {{type: 'sphere', radius: number} | {type: 'box', hx: number, hy: number, hz: number} | {type: 'capsule', radius: number, halfHeight: number}} Shape */

/** A ball. */
export const sphere = (radius) => ({ type: 'sphere', radius });
/** A box from its half extents (a 1 x 1 x 1 m crate is `box(0.5, 0.5, 0.5)`). */
export const box = (hx, hy, hz) => ({ type: 'box', hx, hy, hz });
/** A capsule standing along the body's local y axis: a cylinder `2 * halfHeight` long capped by two hemispheres. */
export const capsule = (radius, halfHeight) => ({ type: 'capsule', radius, halfHeight });

/** Radius of the smallest sphere around the shape's centre that contains it. */
export function boundingRadius(s) {
  if (s.type === 'sphere') return s.radius;
  if (s.type === 'box') return Math.sqrt(s.hx * s.hx + s.hy * s.hy + s.hz * s.hz);
  return s.radius + s.halfHeight;
}

/** Smallest half extent: how far the body can move in one step before it may skip through thin things. */
export function minExtent(s) {
  if (s.type === 'sphere' || s.type === 'capsule') return s.radius;
  return Math.min(s.hx, s.hy, s.hz);
}

const PI = 3.141592653589793;

/** Volume in cubic metres (mass = density x volume). */
export function volume(s) {
  if (s.type === 'sphere') return (4 / 3) * PI * s.radius * s.radius * s.radius;
  if (s.type === 'box') return 8 * s.hx * s.hy * s.hz;
  const r = s.radius;
  return PI * r * r * (2 * s.halfHeight) + (4 / 3) * PI * r * r * r;
}

/** Diagonal of the inertia tensor (kg m^2) of a solid shape of this mass, about its centre. */
function inertia(s, m) {
  if (s.type === 'sphere') { const i = 0.4 * m * s.radius * s.radius; return [i, i, i]; }
  if (s.type === 'box') {
    const x = 2 * s.hx, y = 2 * s.hy, z = 2 * s.hz;
    return [m * (y * y + z * z) / 12, m * (x * x + z * z) / 12, m * (x * x + y * y) / 12];
  }
  // a capsule: the cylinder and the two hemispheres, by their share of the volume
  const r = s.radius, h = 2 * s.halfHeight;
  const vc = PI * r * r * h, vs = (4 / 3) * PI * r * r * r, mc = m * vc / (vc + vs), ms = m - mc;
  const iy = 0.5 * mc * r * r + 0.4 * ms * r * r;
  const ix = mc * (3 * r * r + h * h) / 12 + ms * (0.4 * r * r + 0.25 * h * h + 0.375 * h * r); // hemispheres' centres sit h/2 + 3r/8 away
  return [ix, iy, ix];
}

let nextId = 1; // (the static stand-in below takes 1)

/** Reset the id counter (a new world, or a test that wants stable numbers). */
export function resetBodyIds() { nextId = 2; }

/**
 * A simulated object: a sphere, box or capsule with mass, friction, restitution, damping, and a type (`dynamic`, `kinematic` or
 * `static`); also sensors (triggers), bullets (continuous collision) and a `userData` slot for your own data.
 */
export class RigidBody {
  /**
   * @param {object} o
   * @param {Shape} o.shape
   * @param {'dynamic' | 'kinematic' | 'static'} [o.type] Dynamic bodies are simulated; kinematic ones move only as you tell them (platforms) and push others; static ones never move.
   * @param {number} [o.mass] kg (default: density 1000 x volume, like water). Ignored for kinematic and static bodies.
   * @param {number} [o.x] @param {number} [o.y] @param {number} [o.z] Centre position.
   * @param {number[]} [o.rotation] Orientation as a quaternion [x, y, z, w] (default: none).
   * @param {number} [o.friction] Coulomb friction coefficient (0.5). Two bodies use the geometric mean of theirs.
   * @param {number} [o.restitution] Bounciness 0..1 (0). Two bodies use the larger.
   * @param {number} [o.linearDamping] Speed lost per second as a fraction (0.01). @param {number} [o.angularDamping] (0.02)
   * @param {number} [o.gravityScale] 1 normal, 0 floating.
   * @param {boolean} [o.sensor] A trigger: reports who is inside it but never pushes anything.
   * @param {boolean} [o.canSleep] false keeps it awake even when still (default true).
   * @param {boolean} [o.bullet] Treat as very fast: its path is checked against the static world so it cannot skip through thin walls.
   * @param {number} [o.group] Collision category bits (1) and `mask`: which categories it collides with (all).
   * @param {number} [o.mask]
   * @param {any} [o.userData] Anything you want to find again (an entity id, a mesh).
   */
  constructor({ shape, type = 'dynamic', mass, x = 0, y = 0, z = 0, rotation = [0, 0, 0, 1], friction = 0.5, restitution = 0, linearDamping = 0.01, angularDamping = 0.02, gravityScale = 1, sensor = false, bullet = false, canSleep = true, group = 1, mask = 0xffff, userData = null }) {
    this.id = nextId++;
    /** A name that stays the same between sessions (set it yourself): saved states are matched by it. */
    this.key = null;
    this.shape = shape;
    this.type = type;
    this.x = x; this.y = y; this.z = z;
    this.qx = rotation[0]; this.qy = rotation[1]; this.qz = rotation[2]; this.qw = rotation[3];
    this.vx = 0; this.vy = 0; this.vz = 0; this.wx = 0; this.wy = 0; this.wz = 0;
    this.fx = 0; this.fy = 0; this.fz = 0; this.tx = 0; this.ty = 0; this.tz = 0;
    this.friction = friction; this.restitution = restitution;
    this.linearDamping = linearDamping; this.angularDamping = angularDamping; this.gravityScale = gravityScale;
    this.sensor = sensor; this.bullet = bullet; this.group = group; this.mask = mask; this.userData = userData;
    this.sleeping = false; this.sleepTime = 0; this.canSleep = canSleep; this.sleepGroup = null;
    this.r = new Float64Array(9);       // rotation matrix, row-major
    this.iw = new Float64Array(6);      // world inverse inertia: xx xy xz yy yz zz
    this.minX = 0; this.minY = 0; this.minZ = 0; this.maxX = 0; this.maxY = 0; this.maxZ = 0;
    this.island = -1; this.index = -1; this.touched = false;
    this.setMass(type === 'dynamic' ? (mass ?? 1000 * volume(shape)) : 0);
  }

  get dynamic() { return this.type === 'dynamic'; }

  /** Set the mass (kg); 0 makes the body immovable. Inertia follows from the shape. */
  setMass(m) {
    this.mass = m;
    this.invMass = m > 0 ? 1 / m : 0;
    if (m > 0) { const i = inertia(this.shape, m); this.invIx = 1 / i[0]; this.invIy = 1 / i[1]; this.invIz = 1 / i[2]; } else { this.invIx = this.invIy = this.invIz = 0; }
    this.refresh();
  }

  /** Recompute the rotation matrix, world inertia and bounding box after the pose changed. */
  refresh() {
    const { qx: x, qy: y, qz: z, qw: w, r } = this;
    const xx = x * x, yy = y * y, zz = z * z, xy = x * y, xz = x * z, yz = y * z, wx = w * x, wy = w * y, wz = w * z;
    r[0] = 1 - 2 * (yy + zz); r[1] = 2 * (xy - wz); r[2] = 2 * (xz + wy);
    r[3] = 2 * (xy + wz); r[4] = 1 - 2 * (xx + zz); r[5] = 2 * (yz - wx);
    r[6] = 2 * (xz - wy); r[7] = 2 * (yz + wx); r[8] = 1 - 2 * (xx + yy);
    // world inverse inertia = R diag(i) R^T
    const a = this.invIx, b = this.invIy, c = this.invIz, iw = this.iw;
    iw[0] = r[0] * r[0] * a + r[1] * r[1] * b + r[2] * r[2] * c;
    iw[1] = r[0] * r[3] * a + r[1] * r[4] * b + r[2] * r[5] * c;
    iw[2] = r[0] * r[6] * a + r[1] * r[7] * b + r[2] * r[8] * c;
    iw[3] = r[3] * r[3] * a + r[4] * r[4] * b + r[5] * r[5] * c;
    iw[4] = r[3] * r[6] * a + r[4] * r[7] * b + r[5] * r[8] * c;
    iw[5] = r[6] * r[6] * a + r[7] * r[7] * b + r[8] * r[8] * c;
    this.#bounds();
  }

  #bounds() {
    const s = this.shape, r = this.r;
    let ex, ey, ez;
    if (s.type === 'sphere') ex = ey = ez = s.radius;
    else if (s.type === 'box') {
      ex = Math.abs(r[0]) * s.hx + Math.abs(r[1]) * s.hy + Math.abs(r[2]) * s.hz;
      ey = Math.abs(r[3]) * s.hx + Math.abs(r[4]) * s.hy + Math.abs(r[5]) * s.hz;
      ez = Math.abs(r[6]) * s.hx + Math.abs(r[7]) * s.hy + Math.abs(r[8]) * s.hz;
    } else { // the capsule's axis is the matrix's second column
      ex = Math.abs(r[1]) * s.halfHeight + s.radius; ey = Math.abs(r[4]) * s.halfHeight + s.radius; ez = Math.abs(r[7]) * s.halfHeight + s.radius;
    }
    this.minX = this.x - ex; this.maxX = this.x + ex; this.minY = this.y - ey; this.maxY = this.y + ey; this.minZ = this.z - ez; this.maxZ = this.z + ez;
  }

  /** Put the body somewhere (and wake it). Velocity is kept. */
  setPosition(x, y, z) { this.x = x; this.y = y; this.z = z; this.wake(); this.refresh(); }
  /** Orientation as a quaternion [x, y, z, w] (normalised for you). */
  setRotation(qx, qy, qz, qw) {
    const l = Math.sqrt(qx * qx + qy * qy + qz * qz + qw * qw) || 1;
    this.qx = qx / l; this.qy = qy / l; this.qz = qz / l; this.qw = qw / l;
    this.wake(); this.refresh();
  }
  setVelocity(vx, vy, vz) { this.vx = vx; this.vy = vy; this.vz = vz; this.wake(); }
  setAngularVelocity(wx, wy, wz) { this.wx = wx; this.wy = wy; this.wz = wz; this.wake(); }

  /** Add a force (newtons) for the next step, at the centre or at a world point (which also turns the body). */
  applyForce(fx, fy, fz, px, py, pz) {
    this.fx += fx; this.fy += fy; this.fz += fz;
    if (px !== undefined) { const rx = px - this.x, ry = py - this.y, rz = pz - this.z; this.tx += ry * fz - rz * fy; this.ty += rz * fx - rx * fz; this.tz += rx * fy - ry * fx; }
    this.wake();
  }
  applyTorque(tx, ty, tz) { this.tx += tx; this.ty += ty; this.tz += tz; this.wake(); }
  /** Change velocity at once by an impulse (newton-seconds), at the centre or at a world point. */
  applyImpulse(ix, iy, iz, px, py, pz) {
    if (this.invMass === 0) return;
    this.vx += ix * this.invMass; this.vy += iy * this.invMass; this.vz += iz * this.invMass;
    if (px !== undefined) {
      const rx = px - this.x, ry = py - this.y, rz = pz - this.z;
      const tx = ry * iz - rz * iy, ty = rz * ix - rx * iz, tz = rx * iy - ry * ix, iw = this.iw;
      this.wx += iw[0] * tx + iw[1] * ty + iw[2] * tz; this.wy += iw[1] * tx + iw[3] * ty + iw[4] * tz; this.wz += iw[2] * tx + iw[4] * ty + iw[5] * tz;
    }
    this.wake();
  }

  /** Wake the body, and with it everything that went to sleep touching it. */
  wake() {
    const g = this.sleepGroup;
    this.sleeping = false; this.sleepTime = 0; this.sleepGroup = null;
    if (g) for (const o of g) { o.sleeping = false; o.sleepTime = 0; o.sleepGroup = null; }
  }

  /** World position of a point given in the body's own coordinates. @param {number[]} out */
  toWorld(lx, ly, lz, out = [0, 0, 0]) {
    const r = this.r;
    out[0] = this.x + r[0] * lx + r[1] * ly + r[2] * lz; out[1] = this.y + r[3] * lx + r[4] * ly + r[5] * lz; out[2] = this.z + r[6] * lx + r[7] * ly + r[8] * lz;
    return out;
  }
  /** A world point in the body's own coordinates. */
  toLocal(wx, wy, wz, out = [0, 0, 0]) {
    const r = this.r, dx = wx - this.x, dy = wy - this.y, dz = wz - this.z;
    out[0] = r[0] * dx + r[3] * dy + r[6] * dz; out[1] = r[1] * dx + r[4] * dy + r[7] * dz; out[2] = r[2] * dx + r[5] * dy + r[8] * dz;
    return out;
  }
  /** Velocity of the material point of the body at a world position. */
  velocityAt(px, py, pz, out = [0, 0, 0]) {
    const rx = px - this.x, ry = py - this.y, rz = pz - this.z;
    out[0] = this.vx + this.wy * rz - this.wz * ry; out[1] = this.vy + this.wz * rx - this.wx * rz; out[2] = this.vz + this.wx * ry - this.wy * rx;
    return out;
  }
  /** Kinetic energy in joules. */
  get kineticEnergy() {
    const l = 0.5 * this.mass * (this.vx * this.vx + this.vy * this.vy + this.vz * this.vz);
    const r = this.r, lx = r[0] * this.wx + r[3] * this.wy + r[6] * this.wz, ly = r[1] * this.wx + r[4] * this.wy + r[7] * this.wz, lz = r[2] * this.wx + r[5] * this.wy + r[8] * this.wz;
    const a = this.invIx ? lx * lx / this.invIx : 0, b = this.invIy ? ly * ly / this.invIy : 0, c = this.invIz ? lz * lz / this.invIz : 0;
    return l + 0.5 * (a + b + c);
  }
}

/** The immovable stand-in for the static world (triangle meshes) in contacts. */
export const STATIC_BODY = new RigidBody({ shape: sphere(1), type: 'static' });
