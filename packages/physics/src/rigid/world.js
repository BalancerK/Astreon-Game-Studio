// The physics world: bodies, joints, the static triangle world, and the step that moves them all.
//
// One step (a fixed `dt`, split into `substeps`): apply gravity and forces, find touching pairs (sweep and prune on x, then the
// shape-specific contact generators, plus the triangles of the static world), warm start and iterate the contact and joint solver,
// move everything, then put resting groups of bodies to sleep and report contacts and triggers.
// Only + - * / and sqrt, and every loop runs in a fixed order, so the same steps from the same state give the same bits everywhere.
import { RigidBody, STATIC_BODY, boundingRadius, minExtent, sphere } from './body.js';
import { Manifold, collide, collideTriangle } from './contacts.js';
import { ContactConstraint, prepareContact, warmStart, solveContact } from './solver.js';
import { rayBody } from './query.js';

const WORLD_KEY = 4503599627370496;   // 2^52: contacts with the static world
const ID_SPAN = 67108864;             // 2^26: ids and triangle numbers are smaller than this

const pairKey = (a, b) => (a.id < b.id ? a.id * ID_SPAN + b.id : b.id * ID_SPAN + a.id);

/**
 * The rigid-body world: bodies, joints, the static triangle world and the fixed-step `step(dt)` that moves them, with sleeping,
 * triggers, ray casts and `getState` / `setState` for saves. Deterministic: only + - * / and sqrt, in a fixed order.
 */
export class PhysicsWorld {
  /**
   * @param {object} [o]
   * @param {number[]} [o.gravity] m/s^2, default [0, -9.81, 0].
   * @param {import('../tri-world.js').TriWorld | null} [o.terrain] Static triangle geometry (built) that bodies collide with.
   * @param {number} [o.substeps] Smaller steps inside each `step` (default 2): stiffer stacks and faster bodies for a bit more cost.
   * @param {number} [o.iterations] Solver passes per substep (default 8).
   * @param {number} [o.sleepTime] Seconds of near-stillness before a group of bodies sleeps (0.5).
   * @param {number} [o.beta] How fast overlap is pushed out (0.2). @param {number} [o.slop] Overlap tolerated without pushing, in metres (0.005).
   * @param {boolean} [o.gyroscopic] Model the way a spinning uneven body wobbles (default true).
   */
  constructor({ gravity = [0, -9.81, 0], terrain = null, substeps = 2, iterations = 8, sleepTime = 0.5, beta = 0.2, slop = 0.005, gyroscopic = true } = {}) {
    this.gravity = gravity;
    this.terrain = terrain;
    this.substeps = substeps; this.iterations = iterations; this.sleepTime = sleepTime;
    this.beta = beta; this.slop = slop; this.gyroscopic = gyroscopic;
    /** Spin (rad/s) a body that is touching something loses every second: rolling resistance, so balls come to rest. */
    this.rollingDamping = 1.5;
    this.sleepLinear = 0.15; this.sleepAngular = 0.25; this.restThreshold = 1; this.maxBias = 3;
    this.maxAngularSpeed = 200;
    /** @type {RigidBody[]} */ this.bodies = [];
    /** @type {import('./joints.js').Joint[]} */ this.joints = [];
    this.time = 0;
    /** Called when two bodies (or a body and the static world: `other` is null) start touching: (a, other, impactSpeed). */
    this.onContactBegin = null;
    this.onContactEnd = null;
    /** Called when a body enters or leaves a sensor: (sensor, body, entered). */
    this.onTrigger = null;
    this.stats = { pairs: 0, contacts: 0, awake: 0, asleep: 0 };
    this.sorted = [];
    this.pool = [];                 // reusable constraints
    this.contacts = 0;              // how many of them are in use this substep
    this.manifold = new Manifold();
    this.cache = new Map(); this.nextCache = new Map();
    this.touching = new Map(); this.inside = new Map();
    this.connected = new Set();
    this.ignored = new Set();       // pairs that never collide (see ignoreCollision)
    this.triBuffer = new Int32Array(256);
    this.sensorHits = [];
    this.probe = new RigidBody({ shape: sphere(0.1), type: 'static' });
  }

  // ------------------------------------------------------------ bodies and joints
  /** Add a body (or several); returns the first. */
  add(...bodies) {
    for (const b of bodies) { b.index = this.bodies.length; this.bodies.push(b); this.sorted.push(b); b.refresh(); }
    return bodies[0];
  }

  /** Take a body out of the world (and the joints that use it). */
  remove(body) {
    const i = this.bodies.indexOf(body);
    if (i < 0) return;
    this.bodies.splice(i, 1);
    this.sorted.splice(this.sorted.indexOf(body), 1);
    this.bodies.forEach((b, k) => { b.index = k; });
    this.joints = this.joints.filter((j) => j.a !== body && j.b !== body);
    for (const other of this.bodies) this.ignored.delete(pairKey(body, other));
    this.#rebuildConnected();
    body.wake();
    for (const [k, v] of this.touching) if (v.a === body || v.b === body) this.touching.delete(k);
    for (const [k, v] of this.inside) if (v.sensor === body || v.body === body) this.inside.delete(k);
  }

  /** Add a joint (see joints.js). Both its bodies must already be in the world. */
  addJoint(joint) {
    this.joints.push(joint);
    joint.a.wake(); joint.b.wake();
    this.#rebuildConnected();
    return joint;
  }
  removeJoint(joint) {
    this.joints = this.joints.filter((j) => j !== joint);
    this.#rebuildConnected();
  }
  /** Make two bodies pass through each other (the limbs of one ragdoll, a trailer and its truck). Undone by `allowCollision`. */
  ignoreCollision(a, b) { this.ignored.add(pairKey(a, b)); this.#rebuildConnected(); }
  allowCollision(a, b) { this.ignored.delete(pairKey(a, b)); this.#rebuildConnected(); }
  #rebuildConnected() {
    this.connected.clear();
    for (const k of this.ignored) this.connected.add(k);
    for (const j of this.joints) if (!j.collideConnected) this.connected.add(pairKey(j.a, j.b));
  }

  /**
   * Move a kinematic body toward a pose over `dt`, so bodies riding it are carried along (its velocity is set to cover the distance).
   * Call before `step(dt)`.
   */
  moveKinematic(body, x, y, z, dt) {
    body.vx = (x - body.x) / dt; body.vy = (y - body.y) / dt; body.vz = (z - body.z) / dt;
  }

  // ------------------------------------------------------------ the step
  /** Advance the simulation by `dt` seconds (call it with a fixed dt, like 1/60). */
  step(dt) {
    const h = dt / this.substeps;
    for (let i = 0; i < this.substeps; i++) this.#substep(h);
    for (const body of this.bodies) { body.fx = body.fy = body.fz = body.tx = body.ty = body.tz = 0; }   // forces last for the whole step, however many substeps it has
    this.#updateSleep(dt);
    this.#events();
    this.time += dt;
  }

  #integrateVelocities(h) {
    const g = this.gravity;
    for (const b of this.bodies) {
      if (b.type !== 'dynamic' || b.sleeping) continue;
      const ld = 1 / (1 + h * b.linearDamping), ad = 1 / (1 + h * b.angularDamping);
      b.vx = (b.vx + (g[0] * b.gravityScale + b.fx * b.invMass) * h) * ld;
      b.vy = (b.vy + (g[1] * b.gravityScale + b.fy * b.invMass) * h) * ld;
      b.vz = (b.vz + (g[2] * b.gravityScale + b.fz * b.invMass) * h) * ld;
      let wx = b.wx, wy = b.wy, wz = b.wz;
      if (this.gyroscopic && (wx !== 0 || wy !== 0 || wz !== 0) && b.invIx > 0) {
        // Euler's equation in the body's own frame: the angular velocity of an uneven body turns even with no torque
        const r = b.r, lx = r[0] * wx + r[3] * wy + r[6] * wz, ly = r[1] * wx + r[4] * wy + r[7] * wz, lz = r[2] * wx + r[5] * wy + r[8] * wz;
        const ix = lx / b.invIx, iy = ly / b.invIy, iz = lz / b.invIz; // I w
        const gx = -(ly * iz - lz * iy) * b.invIx, gy = -(lz * ix - lx * iz) * b.invIy, gz = -(lx * iy - ly * ix) * b.invIz;
        const nx = lx + gx * h, ny = ly + gy * h, nz = lz + gz * h;
        wx = r[0] * nx + r[1] * ny + r[2] * nz; wy = r[3] * nx + r[4] * ny + r[5] * nz; wz = r[6] * nx + r[7] * ny + r[8] * nz;
      }
      const iw = b.iw, tx = b.tx, ty = b.ty, tz = b.tz;
      // rolling resistance: a body in contact loses a fixed amount of spin per second, so balls roll to a stop instead of forever
      let rd = 1;
      if (b.touched) { const spin = Math.sqrt(wx * wx + wy * wy + wz * wz); rd = spin > 1e-9 ? Math.max(0, 1 - h * this.rollingDamping / spin) : 1; }
      b.touched = false;
      wx = (wx + (iw[0] * tx + iw[1] * ty + iw[2] * tz) * h) * ad * rd; wy = (wy + (iw[1] * tx + iw[3] * ty + iw[4] * tz) * h) * ad * rd; wz = (wz + (iw[2] * tx + iw[4] * ty + iw[5] * tz) * h) * ad * rd;
      const w2 = wx * wx + wy * wy + wz * wz, wm = this.maxAngularSpeed;
      if (w2 > wm * wm) { const s = wm / Math.sqrt(w2); wx *= s; wy *= s; wz *= s; }
      b.wx = wx; b.wy = wy; b.wz = wz;
    }
  }

  #sweepAndPrune() {
    const s = this.sorted;
    for (let i = 1; i < s.length; i++) { // insertion sort by minX: nearly sorted from the last step, so almost free
      const b = s[i];
      let j = i - 1;
      while (j >= 0 && (s[j].minX > b.minX || (s[j].minX === b.minX && s[j].id > b.id))) { s[j + 1] = s[j]; j--; }
      s[j + 1] = b;
    }
  }

  #constraint() {
    if (this.contacts >= this.pool.length) this.pool.push(new ContactConstraint());
    return this.pool[this.contacts++];
  }

  #narrowphase(h) {
    this.contacts = 0;
    this.sensorHits.length = 0;
    this.nextCache.clear();
    const s = this.sorted, m = this.manifold, n = s.length;
    const opts = { h, beta: this.beta, slop: this.slop, maxBias: this.maxBias, restThreshold: this.restThreshold };
    this.prep = opts;
    let pairs = 0;
    const take = (a, b, key) => {
      const c = this.#constraint();
      c.key = key;
      prepareContact(c, a, b, m, opts, this.cache.get(key));
      pairs++;
    };
    for (let i = 0; i < n; i++) {
      const a = s[i];
      for (let j = i + 1; j < n; j++) {
        const b = s[j];
        if (b.minX > a.maxX) break;
        if (b.minY > a.maxY || b.maxY < a.minY || b.minZ > a.maxZ || b.maxZ < a.minZ) continue;
        if ((a.group & b.mask) === 0 || (b.group & a.mask) === 0) continue;
        const aLive = a.type === 'dynamic' && !a.sleeping, bLive = b.type === 'dynamic' && !b.sleeping;
        const sensorPair = a.sensor || b.sensor;
        if (sensorPair) { // a trigger never pushes: just note who is inside it
          if (!(a.sensor && b.sensor)) { collide(a, b, m); if (m.n > 0) this.sensorHits.push(a.sensor ? a : b, a.sensor ? b : a); }
          continue;
        }
        if (!aLive && !bLive) {
          // a moving kinematic body wakes the sleeper it touches
          const kin = a.type === 'kinematic' ? a : b.type === 'kinematic' ? b : null, other = kin === a ? b : a;
          if (kin && other.type === 'dynamic' && other.sleeping && (kin.vx !== 0 || kin.vy !== 0 || kin.vz !== 0 || kin.wx !== 0 || kin.wy !== 0 || kin.wz !== 0)) { collide(a, b, m); if (m.n > 0) other.wake(); }
          continue;
        }
        if (this.connected.size > 0 && this.connected.has(pairKey(a, b))) continue;
        collide(a, b, m);
        if (m.n === 0) continue;
        if (!aLive && a.type === 'dynamic') a.wake(); // a sleeper that something awake is pushing on
        if (!bLive && b.type === 'dynamic') b.wake();
        take(a, b, pairKey(a, b));
      }
    }
    const terrain = this.terrain;
    if (terrain) {
      for (const a of this.bodies) {
        if (a.type !== 'dynamic' || a.sleeping || a.sensor) continue;
        const pad = 0.02;
        let count = terrain.queryAabb(a.minX - pad, a.minY - pad, a.minZ - pad, a.maxX + pad, a.maxY + pad, a.maxZ + pad, this.triBuffer);
        if (count === this.triBuffer.length) { this.triBuffer = new Int32Array(this.triBuffer.length * 4); count = terrain.queryAabb(a.minX - pad, a.minY - pad, a.minZ - pad, a.maxX + pad, a.maxY + pad, a.maxZ + pad, this.triBuffer); }
        const idx = this.triBuffer.subarray(0, count).sort(); // a fixed order, whatever the grid returned first
        for (let k = 0; k < count; k++) {
          collideTriangle(a, terrain.verts, idx[k] * 9, m);
          if (m.n > 0) take(a, STATIC_BODY, WORLD_KEY + a.id * ID_SPAN + idx[k]);
        }
      }
    }
    this.stats.pairs = pairs;
  }

  #substep(h) {
    this.#integrateVelocities(h);
    this.#sweepAndPrune();
    this.#narrowphase(h);
    const cs = this.pool, n = this.contacts, joints = this.joints;
    for (const j of joints) { j.prepare(h, this.beta); }
    for (const j of joints) j.warmStart();
    for (let i = 0; i < n; i++) { warmStart(cs[i]); cs[i].a.touched = true; cs[i].b.touched = true; }
    for (let it = 0; it < this.iterations; it++) {
      for (const j of joints) j.solve();
      for (let i = 0; i < n; i++) solveContact(cs[i]);
    }
    // keep what the contacts learned for the next step's warm start, and drop joints that were pushed too hard
    for (let i = 0; i < n; i++) {
      const c = cs[i];
      let e = this.nextCache.get(c.key);
      if (!e) { e = { n: 0, px: new Float64Array(4), py: new Float64Array(4), pz: new Float64Array(4), jn: new Float64Array(4), jx: new Float64Array(4), jy: new Float64Array(4), jz: new Float64Array(4) }; this.nextCache.set(c.key, e); }
      e.n = c.n;
      for (let k = 0; k < c.n; k++) {
        const p = c.points[k];
        e.px[k] = p.px; e.py[k] = p.py; e.pz[k] = p.pz; e.jn[k] = p.jn;
        e.jx[k] = c.t1x * p.j1 + c.t2x * p.j2; e.jy[k] = c.t1y * p.j1 + c.t2y * p.j2; e.jz[k] = c.t1z * p.j1 + c.t2z * p.j2;
      }
    }
    [this.cache, this.nextCache] = [this.nextCache, this.cache];
    for (const j of joints) if (!j.broken && j.breakImpulse < Infinity && this.#jointImpulse(j) > j.breakImpulse) j.broken = true;
    if (joints.some((j) => j.broken)) { this.joints = joints.filter((j) => !j.broken); this.#rebuildConnected(); }
    this.#integratePositions(h);
  }

  #jointImpulse(j) { const x = j.jx ?? 0, y = j.jy ?? 0, z = j.jz ?? 0, d = j.j ?? 0; return Math.sqrt(x * x + y * y + z * z + d * d); }

  #integratePositions(h) {
    const terrain = this.terrain;
    const ray = { t: 0, index: 0, nx: 0, ny: 0, nz: 0 };
    for (const b of this.bodies) {
      if (b.type === 'static' || b.sleeping) continue;
      let dx = b.vx * h, dy = b.vy * h, dz = b.vz * h;
      if (terrain && b.type === 'dynamic' && !b.sensor) { // a fast body must not skip through a thin wall: stop it at the first surface its path meets
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (dist > 1e-9 && (b.bullet || dist > 0.75 * minExtent(b.shape))) {
          const rad = boundingRadius(b.shape);
          if (terrain.raycast(b.x, b.y, b.z, dx / dist, dy / dist, dz / dist, dist + rad, ray) && ray.t - rad < dist) {
            const go = Math.max(0, ray.t - rad) / dist;
            dx *= go; dy *= go; dz *= go;
          }
        }
      }
      b.x += dx; b.y += dy; b.z += dz;
      if (b.wx !== 0 || b.wy !== 0 || b.wz !== 0) {
        const hx = b.wx * h * 0.5, hy = b.wy * h * 0.5, hz = b.wz * h * 0.5;
        const qx = b.qx, qy = b.qy, qz = b.qz, qw = b.qw;
        let nx = qx + hx * qw + hy * qz - hz * qy, ny = qy - hx * qz + hy * qw + hz * qx, nz = qz + hx * qy - hy * qx + hz * qw, nw = qw - hx * qx - hy * qy - hz * qz;
        const l = Math.sqrt(nx * nx + ny * ny + nz * nz + nw * nw);
        b.qx = nx / l; b.qy = ny / l; b.qz = nz / l; b.qw = nw / l;
      }
      b.refresh();
    }
  }

  // ------------------------------------------------------------ sleeping and events
  #updateSleep(dt) {
    const bodies = this.bodies, n = bodies.length;
    const parent = new Int32Array(n);
    for (let i = 0; i < n; i++) parent[i] = i;
    const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
    const union = (i, j) => { const a = find(i), b = find(j); if (a !== b) parent[Math.max(a, b)] = Math.min(a, b); };
    const lin = this.sleepLinear * this.sleepLinear, ang = this.sleepAngular * this.sleepAngular;
    let awake = 0;
    for (const b of bodies) {
      if (b.type !== 'dynamic' || b.sleeping) continue;
      const still = b.vx * b.vx + b.vy * b.vy + b.vz * b.vz < lin && b.wx * b.wx + b.wy * b.wy + b.wz * b.wz < ang;
      if (still && b.canSleep) b.sleepTime += dt; else b.sleepTime = 0;
    }
    for (let i = 0; i < this.contacts; i++) {
      const c = this.pool[i], a = c.a, b = c.b;
      if (b === STATIC_BODY) continue;
      if (a.type === 'dynamic' && b.type === 'dynamic') union(a.index, b.index);
      else { // resting on a platform that is moving is not resting
        const mover = a.type === 'dynamic' ? b : a, rider = mover === a ? b : a;
        if (mover.type === 'kinematic' && (mover.vx !== 0 || mover.vy !== 0 || mover.vz !== 0 || mover.wx !== 0 || mover.wy !== 0 || mover.wz !== 0)) rider.sleepTime = 0;
      }
    }
    for (const j of this.joints) if (j.a.type === 'dynamic' && j.b.type === 'dynamic') union(j.a.index, j.b.index);
    const minSleep = new Float64Array(n).fill(Infinity);
    for (const b of bodies) { if (b.type === 'dynamic' && !b.sleeping) { const r = find(b.index); if (b.sleepTime < minSleep[r]) minSleep[r] = b.sleepTime; } }
    const groups = new Map();
    for (const b of bodies) {
      if (b.type !== 'dynamic' || b.sleeping) continue;
      const r = find(b.index);
      if (minSleep[r] >= this.sleepTime) { let g = groups.get(r); if (!g) groups.set(r, g = []); g.push(b); }
      else awake++;
    }
    for (const g of groups.values()) for (const b of g) {
      b.sleeping = true; b.sleepGroup = g;
      b.vx = b.vy = b.vz = b.wx = b.wy = b.wz = 0;
    }
    this.stats.awake = awake; this.stats.asleep = bodies.filter((b) => b.sleeping).length; this.stats.contacts = this.contacts;
  }

  #events() {
    if (this.onContactBegin || this.onContactEnd) {
      const now = new Map();
      for (let i = 0; i < this.contacts; i++) {
        const c = this.pool[i];
        const key = c.b === STATIC_BODY ? WORLD_KEY + c.a.id : pairKey(c.a, c.b);
        const e = now.get(key);
        if (e) { if (c.impactSpeed > e.speed) e.speed = c.impactSpeed; } else now.set(key, { a: c.a, b: c.b === STATIC_BODY ? null : c.b, speed: c.impactSpeed });
      }
      if (this.onContactBegin) for (const [k, e] of now) if (!this.touching.has(k)) this.onContactBegin(e.a, e.b, e.speed);
      if (this.onContactEnd) for (const [k, e] of this.touching) if (!now.has(k)) this.onContactEnd(e.a, e.b);
      this.touching = now;
    }
    if (this.onTrigger || this.inside.size > 0 || this.sensorHits.length > 0) {
      const now = new Map();
      for (let i = 0; i < this.sensorHits.length; i += 2) {
        const sensor = this.sensorHits[i], body = this.sensorHits[i + 1];
        now.set(sensor.id * ID_SPAN + body.id, { sensor, body });
      }
      if (this.onTrigger) {
        for (const [k, e] of now) if (!this.inside.has(k)) this.onTrigger(e.sensor, e.body, true);
        for (const [k, e] of this.inside) if (!now.has(k)) this.onTrigger(e.sensor, e.body, false);
      }
      this.inside = now;
    }
  }

  // ------------------------------------------------------------ queries
  /**
   * The nearest thing a ray hits: a body or the static world (`hit.body` is null for the world). The direction is normalised for you.
   * @param {number} maxDistance
   * @param {{t: number, body: RigidBody | null, nx: number, ny: number, nz: number, x: number, y: number, z: number}} [hit] Written when true is returned.
   * @param {(body: RigidBody) => boolean} [filter] Return false to skip a body.
   * @returns {boolean}
   */
  raycast(ox, oy, oz, dx, dy, dz, maxDistance, hit = { t: 0, body: null, nx: 0, ny: 0, nz: 0, x: 0, y: 0, z: 0 }, filter = null) {
    const l = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (l === 0) return false;
    dx /= l; dy /= l; dz /= l;
    let best = maxDistance, found = null;
    const n = [0, 0, 0];
    for (const b of this.bodies) {
      if (b.sensor || (filter && !filter(b))) continue;
      const t = rayBody(b, ox, oy, oz, dx, dy, dz, best, n);
      if (t >= 0 && t <= best) { best = t; found = b; hit.nx = n[0]; hit.ny = n[1]; hit.nz = n[2]; }
    }
    let world = false;
    if (this.terrain) {
      const th = { t: 0, index: 0, nx: 0, ny: 0, nz: 0 };
      if (this.terrain.raycast(ox, oy, oz, dx, dy, dz, best, th) && th.t <= best) { best = th.t; world = true; hit.nx = th.nx; hit.ny = th.ny; hit.nz = th.nz; }
    }
    if (!found && !world) return false;
    hit.t = best; hit.body = world ? null : found;
    hit.x = ox + dx * best; hit.y = oy + dy * best; hit.z = oz + dz * best;
    return true;
  }

  /** Bodies whose bounding boxes overlap this box. */
  queryAabb(minX, minY, minZ, maxX, maxY, maxZ) {
    return this.bodies.filter((b) => b.maxX >= minX && b.minX <= maxX && b.maxY >= minY && b.minY <= maxY && b.maxZ >= minZ && b.minZ <= maxZ);
  }

  /** Bodies that actually overlap a sphere. */
  overlapSphere(x, y, z, radius) {
    const probe = this.probe, m = this.manifold;
    probe.shape = sphere(radius); probe.x = x; probe.y = y; probe.z = z; probe.refresh();
    return this.bodies.filter((b) => {
      if (b.maxX < x - radius || b.minX > x + radius || b.maxY < y - radius || b.minY > y + radius || b.maxZ < z - radius || b.minZ > z + radius) return false;
      collide(probe, b, m);
      return m.n > 0;
    });
  }

  // ------------------------------------------------------------ saving
  /**
   * Everything needed to carry on exactly where the world is now, as plain data (a save file, a network resync): every body's pose,
   * velocity and sleep state, the contact impulses used for warm starting, and the joints' impulses. Restoring it and stepping gives
   * the same bits as never having stopped. Rebuild the same scene first; bodies and joints are matched by their `key` (a string you set,
   * stable between sessions) or, without one, by id (bodies) and order (joints). Across sessions, give bodies and joints keys.
   */
  getState() {
    const groups = new Map();
    const bodies = this.bodies.map((b) => {
      let g = -1;
      if (b.sleepGroup) { if (!groups.has(b.sleepGroup)) groups.set(b.sleepGroup, groups.size); g = groups.get(b.sleepGroup); }
      return { id: b.id, key: b.key ?? null, x: b.x, y: b.y, z: b.z, q: [b.qx, b.qy, b.qz, b.qw], v: [b.vx, b.vy, b.vz], w: [b.wx, b.wy, b.wz], sleeping: b.sleeping, sleepTime: b.sleepTime, touched: b.touched, group: g };
    });
    const contacts = [];
    for (const [key, e] of this.cache) contacts.push([key, e.n, Array.from(e.px), Array.from(e.py), Array.from(e.pz), Array.from(e.jn), Array.from(e.jx), Array.from(e.jy), Array.from(e.jz)]);
    return { time: this.time, bodies, contacts, joints: this.joints.map((j) => ({ key: j.key ?? null, s: j.saveState() })) };
  }

  /** Put the world back to a state from `getState` (matched by key, else by id; bodies that are not in the world are ignored). */
  setState(state) {
    const byId = new Map(this.bodies.map((b) => [b.id, b])), byKey = new Map();
    for (const b of this.bodies) if (b.key != null) byKey.set(b.key, b);
    const groups = new Map(), idMap = new Map(); // saved id -> body now
    for (const s of state.bodies) {
      const b = s.key != null ? byKey.get(s.key) : byId.get(s.id);
      if (!b) continue;
      idMap.set(s.id, b);
      b.x = s.x; b.y = s.y; b.z = s.z; b.qx = s.q[0]; b.qy = s.q[1]; b.qz = s.q[2]; b.qw = s.q[3];
      b.vx = s.v[0]; b.vy = s.v[1]; b.vz = s.v[2]; b.wx = s.w[0]; b.wy = s.w[1]; b.wz = s.w[2];
      b.sleeping = !!s.sleeping; b.sleepTime = s.sleepTime ?? 0; b.touched = !!s.touched; b.sleepGroup = null;
      if (s.group >= 0) { if (!groups.has(s.group)) groups.set(s.group, []); groups.get(s.group).push(b); b.sleepGroup = groups.get(s.group); }
      b.fx = b.fy = b.fz = b.tx = b.ty = b.tz = 0;
      b.refresh();
    }
    this.cache.clear(); this.nextCache.clear();
    for (const [saved, n, px, py, pz, jn, jx, jy, jz] of state.contacts ?? []) {
      let key = saved; // contact keys are made of body ids: bodies that have new ids need new keys
      if (saved >= WORLD_KEY) { const rest = saved - WORLD_KEY, b = idMap.get(Math.floor(rest / ID_SPAN)); if (!b) continue; key = WORLD_KEY + b.id * ID_SPAN + (rest % ID_SPAN); }
      else { const a = idMap.get(Math.floor(saved / ID_SPAN)), b = idMap.get(saved % ID_SPAN); if (!a || !b) continue; key = pairKey(a, b); }
      this.cache.set(key, { n, px: Float64Array.from(px), py: Float64Array.from(py), pz: Float64Array.from(pz), jn: Float64Array.from(jn), jx: Float64Array.from(jx), jy: Float64Array.from(jy), jz: Float64Array.from(jz) });
    }
    const jointsByKey = new Map();
    for (const j of this.joints) if (j.key != null) jointsByKey.set(j.key, j);
    (state.joints ?? []).forEach((entry, i) => { const j = entry.key != null ? jointsByKey.get(entry.key) : this.joints[i]; j?.loadState(entry.s); });
    this.time = state.time ?? this.time;
    this.touching.clear(); this.inside.clear();
  }
}
