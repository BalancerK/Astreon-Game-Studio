import { Manifold2D, collide2D } from './collide.js';

// The 2D physics world: bodies and joints, and the fixed step that moves them.
//
// One step (a fixed `dt`, split into `substeps`): push bodies with gravity and forces, find the pairs whose boxes overlap (sweep and prune on x, in a fixed order), work out where each
// pair touches, warm start the contacts with last step's impulses and iterate them with the joints, then move everything. After the last substep, resting groups sleep and the
// begin/end/trigger events are reported. Only + - * / and sqrt, and every loop has a fixed order, so the same steps from the same state give the same bits everywhere.

const ID_SPAN = 67108864;                          // 2^26: body numbers stay below this
const pairKey = (a, b) => (a.id < b.id ? a.id * ID_SPAN + b.id : b.id * ID_SPAN + a.id);

class Arbiter {
  constructor(a, b) {
    this.a = a; this.b = b;
    this.count = 0; this.nx = 0; this.ny = 0;
    this.friction = 0; this.restitution = 0;
    this.pts = [newPoint(), newPoint()];
    this.touching = false; this.near = false; this.stamp = -1; this.impact = 0; this.sensor = false;
  }
}
const newPoint = () => ({ id: 0, px: 0, py: 0, sep: 0, rAx: 0, rAy: 0, rBx: 0, rBy: 0, Pn: 0, Pt: 0, mN: 0, mT: 0, bias: 0 });

/**
 * The 2D rigid-body world. Gravity is in metres per second squared with +y down (the 2D renderer's direction), so the default is `[0, 9.81]`.
 */
export class World2D {
  /**
   * @param {object} [o]
   * @param {number[]} [o.gravity]
   * @param {number} [o.substeps] Smaller steps inside each `step` (default 2): stiffer stacks and faster bodies for a little more cost.
   * @param {number} [o.iterations] Solver passes per substep (default 8).
   * @param {number} [o.sleepTime] Seconds of stillness before a group of bodies sleeps (0.5).
   * @param {number} [o.beta] How fast overlap is pushed out (0.2). @param {number} [o.slop] Overlap that is tolerated, in metres (0.005).
   */
  constructor({ gravity = [0, 9.81], substeps = 2, iterations = 8, sleepTime = 0.5, beta = 0.2, slop = 0.005 } = {}) {
    this.gravity = gravity; this.substeps = substeps; this.iterations = iterations; this.sleepTime = sleepTime; this.beta = beta; this.slop = slop;
    this.sleepLinear = 0.05; this.sleepAngular = 0.1; this.restThreshold = 1; this.maxBias = 3; this.maxSpeed = 200; this.margin = 0.02;
    /** @type {import('./body.js').Body2D[]} */ this.bodies = [];
    /** @type {import('./joints.js').Joint2D[]} */ this.joints = [];
    this.time = 0;
    /** Called when two bodies start touching: (a, b, impactSpeed). */
    this.onContactBegin = null;
    /** Called when two bodies stop touching: (a, b). */
    this.onContactEnd = null;
    /** Called when a body enters or leaves a sensor: (sensor, body, entered). */
    this.onTrigger = null;
    this.stats = { pairs: 0, contacts: 0, awake: 0, asleep: 0 };
    this.sorted = [];
    this.arbiters = new Map();
    this.live = [];                    // arbiters with contact points this substep, in a fixed order
    this.inside = new Map(); this.insideNow = new Map();
    this.connected = new Set();
    this.manifold = new Manifold2D();
    this.stamp = 0;
  }

  // ---------------------------------------------------------------- bodies and joints
  /** Add bodies; returns the first. */
  add(...bodies) {
    for (const b of bodies) { b.index = this.bodies.length; this.bodies.push(b); this.sorted.push(b); b.refresh(); }
    return bodies[0];
  }

  /** Take a body out (and the joints that use it). */
  remove(body) {
    const i = this.bodies.indexOf(body);
    if (i < 0) return;
    this.bodies.splice(i, 1);
    this.sorted.splice(this.sorted.indexOf(body), 1);
    this.bodies.forEach((b, k) => { b.index = k; });
    this.joints = this.joints.filter((j) => j.a !== body && j.b !== body);
    this.#rebuildConnected();
    for (const [k, v] of this.arbiters) if (v.a === body || v.b === body) { if (v.touching && this.onContactEnd && !v.sensor) this.onContactEnd(v.a, v.b); this.arbiters.delete(k); }
    for (const [k, v] of this.inside) if (v.sensor === body || v.body === body) this.inside.delete(k);
    for (const b of this.bodies) b.wake();
  }

  addJoint(joint) {
    this.joints.push(joint);
    joint.a.wake(); joint.b.wake();
    this.#rebuildConnected();
    return joint;
  }
  removeJoint(joint) {
    this.joints = this.joints.filter((j) => j !== joint);
    this.#rebuildConnected();
    joint.a.wake(); joint.b.wake();
  }
  #rebuildConnected() {
    this.connected.clear();
    for (const j of this.joints) if (!j.collideConnected) this.connected.add(pairKey(j.a, j.b));
  }

  // ---------------------------------------------------------------- the step
  /** Advance by `dt` seconds (call it with a fixed dt, like 1/60). */
  step(dt) {
    const h = dt / this.substeps;
    this.stamp++;
    this.insideNow.clear();
    for (let i = 0; i < this.substeps; i++) this.#substep(h);
    for (const b of this.bodies) { b.fx = 0; b.fy = 0; b.torque = 0; }
    this.#updateSleep(dt);
    this.#events();
    this.time += dt;
  }

  #substep(h) {
    const g = this.gravity, maxV = this.maxSpeed;
    for (const b of this.bodies) {
      if (b.type !== 'dynamic' || b.sleeping) continue;
      b.vx += (g[0] * b.gravityScale + b.fx * b.invMass) * h;
      b.vy += (g[1] * b.gravityScale + b.fy * b.invMass) * h;
      b.w += b.torque * b.invInertia * h;
      const lin = 1 / (1 + h * b.linearDamping), ang = 1 / (1 + h * b.angularDamping);
      b.vx *= lin; b.vy *= lin; b.w *= ang;
      const s2 = b.vx * b.vx + b.vy * b.vy;
      if (s2 > maxV * maxV) { const k = maxV / Math.sqrt(s2); b.vx *= k; b.vy *= k; }
    }
    this.#findContacts(h);
    const live = this.live, joints = this.joints;
    for (const arb of live) this.#prestep(arb, h);
    for (const j of joints) j.prestep(h, this.beta);
    for (const arb of live) this.#warmStart(arb);
    for (const j of joints) j.warmStart();
    for (let it = 0; it < this.iterations; it++) {
      for (const j of joints) j.solve(h);
      for (const arb of live) this.#solve(arb);
    }
    for (const b of this.bodies) {
      if (b.type === 'static' || b.sleeping) continue;
      b.x += b.vx * h; b.y += b.vy * h;
      if (b.w !== 0) {                                                      // turn by w * h exactly (a rational rotation: same length every time)
        const t = b.w * h / 2, t2 = t * t, dc = (1 - t2) / (1 + t2), ds = 2 * t / (1 + t2);
        const c = b.c * dc - b.s * ds, s = b.s * dc + b.c * ds;
        b.c = c; b.s = s;
      }
      b.refresh();
    }
  }

  /** Sweep and prune on x, then the exact test of each pair whose boxes overlap. Fills `live` with the arbiters that have contact points. */
  #findContacts(h) {
    const sorted = this.sorted, live = this.live;
    live.length = 0;
    // insertion sort by left edge: the order barely changes from step to step, so this is close to linear, and it is stable (the same every time)
    for (let i = 1; i < sorted.length; i++) {
      const v = sorted[i];
      let j = i - 1;
      while (j >= 0 && sorted[j].minX > v.minX) { sorted[j + 1] = sorted[j]; j--; }
      sorted[j + 1] = v;
    }
    let pairs = 0, fastest = 0;
    for (const b of sorted) { const r = Math.sqrt(b.vx * b.vx + b.vy * b.vy) + Math.abs(b.w) * b.radius; if (r > fastest) fastest = r; }
    const pad = this.margin + 2 * fastest * h;                              // how far past a box another can be and still be worth testing
    for (let i = 0; i < sorted.length; i++) {
      const a = sorted[i];
      for (let j = i + 1; j < sorted.length; j++) {
        const b = sorted[j];
        if (b.minX > a.maxX + pad) break;
        const reach = this.margin + (Math.sqrt(a.vx * a.vx + a.vy * a.vy) + Math.abs(a.w) * a.radius + Math.sqrt(b.vx * b.vx + b.vy * b.vy) + Math.abs(b.w) * b.radius) * h;
        if (b.minX > a.maxX + reach || a.minX > b.maxX + reach || b.minY > a.maxY + reach || a.minY > b.maxY + reach) continue;
        if (a.type !== 'dynamic' && b.type !== 'dynamic') continue;
        if ((a.sleeping || a.type === 'static') && (b.sleeping || b.type === 'static')) continue;
        if ((a.mask & b.group) === 0 || (b.mask & a.group) === 0) continue;
        if (this.connected.size > 0 && this.connected.has(pairKey(a, b))) continue;
        pairs++;
        const first = a.id < b.id ? a : b, second = first === a ? b : a;
        // fast pairs are looked for further ahead: a contact found before the shapes touch is solved as a limit on the approach speed ("speculative"), so nothing sinks in and bounces back out
        const m = collide2D(this.manifold, first, second, reach);
        const sensor = a.sensor || b.sensor;
        if (m.count === 0) continue;
        if (sensor) {
          const s = a.sensor ? a : b, o = s === a ? b : a;
          this.insideNow.set(pairKey(s, o), { sensor: s, body: o });
          continue;
        }
        const key = pairKey(a, b);
        let arb = this.arbiters.get(key);
        if (!arb) { arb = new Arbiter(first, second); this.arbiters.set(key, arb); }
        this.#update(arb, m, first, second);
        live.push(arb);
        if (first.sleeping && second.type !== 'static' && !second.sleeping) first.wake();
        else if (second.sleeping && first.type !== 'static' && !first.sleeping) second.wake();
      }
    }
    this.stats.pairs = pairs; this.stats.contacts = live.length;
  }

  #update(arb, m, a, b) {
    // keep the accumulated impulses of points that are the same feature as last time
    const old0 = arb.pts[0], old1 = arb.pts[1], had = arb.count;
    const keep = [{ id: old0.id, Pn: old0.Pn, Pt: old0.Pt }, { id: old1.id, Pn: old1.Pn, Pt: old1.Pt }];
    arb.count = m.count; arb.nx = m.nx; arb.ny = m.ny;
    arb.friction = Math.sqrt(a.friction * b.friction);
    arb.restitution = Math.max(a.restitution, b.restitution);
    for (let k = 0; k < m.count; k++) {
      const p = arb.pts[k];
      p.id = m.id[k]; p.px = m.px[k]; p.py = m.py[k]; p.sep = m.sep[k];
      p.Pn = 0; p.Pt = 0;
      for (let q = 0; q < had && q < 2; q++) if (keep[q].id === p.id) { p.Pn = keep[q].Pn; p.Pt = keep[q].Pt; break; }
    }
    arb.stamp = this.stamp;
    let near = Infinity;
    for (let k = 0; k < m.count; k++) if (m.sep[k] < near) near = m.sep[k];
    arb.near = near <= 0.01;
  }

  #prestep(arb, h) {
    const a = arb.a, b = arb.b, nx = arb.nx, ny = arb.ny, tx = ny, ty = -nx;
    for (let k = 0; k < arb.count; k++) {
      const p = arb.pts[k];
      p.rAx = p.px - a.x; p.rAy = p.py - a.y; p.rBx = p.px - b.x; p.rBy = p.py - b.y;
      const rnA = p.rAx * ny - p.rAy * nx, rnB = p.rBx * ny - p.rBy * nx;
      const kN = a.invMass + b.invMass + a.invInertia * rnA * rnA + b.invInertia * rnB * rnB;
      p.mN = kN > 0 ? 1 / kN : 0;
      const rtA = p.rAx * ty - p.rAy * tx, rtB = p.rBx * ty - p.rBy * tx;
      const kT = a.invMass + b.invMass + a.invInertia * rtA * rtA + b.invInertia * rtB * rtB;
      p.mT = kT > 0 ? 1 / kT : 0;
      let bias = -this.beta / h * Math.min(0, p.sep + this.slop);
      if (bias > this.maxBias) bias = this.maxBias;
      const dvx = b.vx - b.w * p.rBy - a.vx + a.w * p.rAy, dvy = b.vy + b.w * p.rBx - a.vy - a.w * p.rAx, vn = dvx * nx + dvy * ny;
      const bounce = vn < -this.restThreshold && arb.restitution > 0;
      if (bounce) { const r = -arb.restitution * vn; if (r > bias) bias = r; }
      if (p.sep > 0) {
        if (bounce) { p.mN = 0; p.mT = 0; bias = 0; }                  // a bounce waits until the shapes really meet, so it keeps its energy
        else bias = -p.sep / h;                                        // otherwise: it may close the gap, but no faster
      }
      p.bias = bias;
      if (-vn > arb.impact) arb.impact = -vn;
    }
  }

  #warmStart(arb) {
    const a = arb.a, b = arb.b, nx = arb.nx, ny = arb.ny, tx = ny, ty = -nx;
    for (let k = 0; k < arb.count; k++) {
      const p = arb.pts[k], ix = p.Pn * nx + p.Pt * tx, iy = p.Pn * ny + p.Pt * ty;
      a.vx -= a.invMass * ix; a.vy -= a.invMass * iy; a.w -= a.invInertia * (p.rAx * iy - p.rAy * ix);
      b.vx += b.invMass * ix; b.vy += b.invMass * iy; b.w += b.invInertia * (p.rBx * iy - p.rBy * ix);
    }
  }

  #solve(arb) {
    const a = arb.a, b = arb.b, nx = arb.nx, ny = arb.ny, tx = ny, ty = -nx;
    for (let k = 0; k < arb.count; k++) {                                  // friction first, so the normal impulse (which matters more) has the last word
      const p = arb.pts[k];
      let dvx = b.vx - b.w * p.rBy - a.vx + a.w * p.rAy, dvy = b.vy + b.w * p.rBx - a.vy - a.w * p.rAx;
      const max = arb.friction * p.Pn;
      let dPt = -(dvx * tx + dvy * ty) * p.mT;
      const old = p.Pt; p.Pt = Math.max(-max, Math.min(max, old + dPt)); dPt = p.Pt - old;
      let ix = dPt * tx, iy = dPt * ty;
      a.vx -= a.invMass * ix; a.vy -= a.invMass * iy; a.w -= a.invInertia * (p.rAx * iy - p.rAy * ix);
      b.vx += b.invMass * ix; b.vy += b.invMass * iy; b.w += b.invInertia * (p.rBx * iy - p.rBy * ix);
      dvx = b.vx - b.w * p.rBy - a.vx + a.w * p.rAy; dvy = b.vy + b.w * p.rBx - a.vy - a.w * p.rAx;
      let dPn = (-(dvx * nx + dvy * ny) + p.bias) * p.mN;
      const oldN = p.Pn; p.Pn = Math.max(0, oldN + dPn); dPn = p.Pn - oldN;
      ix = dPn * nx; iy = dPn * ny;
      a.vx -= a.invMass * ix; a.vy -= a.invMass * iy; a.w -= a.invInertia * (p.rAx * iy - p.rAy * ix);
      b.vx += b.invMass * ix; b.vy += b.invMass * iy; b.w += b.invInertia * (p.rBx * iy - p.rBy * ix);
    }
  }

  // ---------------------------------------------------------------- sleeping and events
  #updateSleep(dt) {
    const bodies = this.bodies, n = bodies.length;
    const parent = new Int32Array(n);
    for (let i = 0; i < n; i++) parent[i] = i;
    const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
    const join = (a, b) => { if (a.type === 'dynamic' && b.type === 'dynamic') { const x = find(a.index), y = find(b.index); if (x !== y) parent[Math.max(x, y)] = Math.min(x, y); } };
    for (const arb of this.arbiters.values()) if (arb.count > 0 && arb.stamp === this.stamp) join(arb.a, arb.b);
    for (const j of this.joints) join(j.a, j.b);
    const rest = new Float64Array(n).fill(Infinity);
    for (let i = 0; i < n; i++) {
      const b = bodies[i];
      if (b.type !== 'dynamic') continue;
      const still = b.canSleep && b.vx * b.vx + b.vy * b.vy < this.sleepLinear * this.sleepLinear && b.w * b.w < this.sleepAngular * this.sleepAngular;
      b.sleepTimer = still ? b.sleepTimer + dt : 0;
      const root = find(i);
      rest[root] = Math.min(rest[root], b.sleepTimer);
    }
    for (let i = 0; i < n; i++) {
      const b = bodies[i];
      if (b.type !== 'dynamic') continue;
      if (rest[find(i)] >= this.sleepTime && !b.sleeping) { b.sleeping = true; b.vx = 0; b.vy = 0; b.w = 0; }
    }
    let awake = 0, asleep = 0;
    for (const b of bodies) if (b.type === 'dynamic') { if (b.sleeping) asleep++; else awake++; }
    this.stats.awake = awake; this.stats.asleep = asleep;
  }

  #events() {
    for (const [key, arb] of this.arbiters) {
      const now = arb.count > 0 && arb.near && arb.stamp === this.stamp;
      if (now && !arb.touching) { arb.touching = true; this.onContactBegin?.(arb.a, arb.b, arb.impact); }
      else if (!now && arb.touching) {
        // a pair that fell asleep together is still touching
        if (!(arb.a.sleeping || arb.a.type === 'static') || !(arb.b.sleeping || arb.b.type === 'static')) { arb.touching = false; this.onContactEnd?.(arb.a, arb.b); }
      }
      if (!now) { if (!arb.touching) this.arbiters.delete(key); }
      if (now) arb.impact = 0;
      if (arb.stamp !== this.stamp) { arb.count = 0; arb.impact = 0; }
    }
    for (const [key, v] of this.insideNow) if (!this.inside.has(key)) { this.inside.set(key, v); this.onTrigger?.(v.sensor, v.body, true); }
    for (const [key, v] of this.inside) {
      if (this.insideNow.has(key)) continue;
      if (v.sensor.sleeping && v.body.sleeping) continue;
      this.inside.delete(key);
      this.onTrigger?.(v.sensor, v.body, false);
    }
  }

  // ---------------------------------------------------------------- queries
  /** Every body whose bounding box overlaps a rectangle. */
  queryAabb(minX, minY, maxX, maxY, filter = null) {
    const out = [];
    for (const b of this.bodies) if (b.maxX >= minX && b.minX <= maxX && b.maxY >= minY && b.minY <= maxY && (!filter || filter(b))) out.push(b);
    return out;
  }

  /** Every body that contains a point. */
  queryPoint(x, y, filter = null) {
    const out = [];
    for (const b of this.bodies) {
      if (x < b.minX || x > b.maxX || y < b.minY || y > b.maxY || (filter && !filter(b))) continue;
      if (b.shape.type === 'circle') { const dx = x - b.x, dy = y - b.y; if (dx * dx + dy * dy <= b.shape.radius * b.shape.radius) out.push(b); continue; }
      let inside = true;
      for (let i = 0; i < b.shape.count && inside; i++) if (b.wnx[i] * (x - b.wx[i]) + b.wny[i] * (y - b.wy[i]) > 0) inside = false;
      if (inside) out.push(b);
    }
    return out;
  }

  /**
   * The first body a ray hits.
   * @param {number} ox @param {number} oy Start. @param {number} dx @param {number} dy Direction (any length).
   * @param {number} [maxDistance] @param {(body: import('./body.js').Body2D) => boolean} [filter] Return false to ignore a body.
   * @returns {{body: import('./body.js').Body2D, distance: number, x: number, y: number, nx: number, ny: number} | null}
   */
  raycast(ox, oy, dx, dy, maxDistance = Infinity, filter = null) {
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len === 0) return null;
    dx /= len; dy /= len;
    let best = null, bestT = maxDistance;
    for (const b of this.bodies) {
      if (b.sensor || (filter && !filter(b))) continue;
      const hit = rayBody(b, ox, oy, dx, dy, bestT);
      if (hit && hit.t < bestT) { bestT = hit.t; best = { body: b, distance: hit.t, x: ox + dx * hit.t, y: oy + dy * hit.t, nx: hit.nx, ny: hit.ny }; }
    }
    return best;
  }

  // ---------------------------------------------------------------- saving
  /** The whole moving state as plain data (for saves, rollback and tests). Joints and shapes are not in it: make them the same way again. */
  getState() {
    return {
      time: this.time, stamp: this.stamp,
      bodies: this.bodies.map((b) => [b.id, b.x, b.y, b.c, b.s, b.vx, b.vy, b.w, b.sleeping ? 1 : 0, b.sleepTimer]),
      contacts: [...this.arbiters.entries()].map(([k, a]) => [k, a.touching ? 1 : 0, a.pts[0].id, a.pts[0].Pn, a.pts[0].Pt, a.pts[1].id, a.pts[1].Pn, a.pts[1].Pt, a.count]),
      joints: this.joints.map((j) => [j.Px ?? 0, j.Py ?? 0, j.Pm ?? 0, j.Pa ?? 0, j.P ?? 0]),
    };
  }

  /** Put the state back (the same bodies and joints must be in the world, matched by body number). */
  setState(s) {
    const byId = new Map(this.bodies.map((b) => [b.id, b]));
    this.time = s.time; this.stamp = s.stamp;
    for (const [id, x, y, c, sn, vx, vy, w, sl, st] of s.bodies) {
      const b = byId.get(id);
      if (!b) throw new Error(`setState: there is no body ${id} in this world`);
      b.x = x; b.y = y; b.c = c; b.s = sn; b.vx = vx; b.vy = vy; b.w = w; b.sleeping = sl === 1; b.sleepTimer = st; b.fx = 0; b.fy = 0; b.torque = 0;
      b.refresh();
    }
    this.arbiters.clear();
    for (const [key, touching, id0, pn0, pt0, id1, pn1, pt1, count] of s.contacts) {
      const lo = Math.floor(key / ID_SPAN), hi = key - lo * ID_SPAN, a = byId.get(lo), b = byId.get(hi);
      if (!a || !b) continue;
      const arb = new Arbiter(a, b);
      arb.touching = touching === 1; arb.count = count; arb.stamp = s.stamp;
      arb.pts[0].id = id0; arb.pts[0].Pn = pn0; arb.pts[0].Pt = pt0; arb.pts[1].id = id1; arb.pts[1].Pn = pn1; arb.pts[1].Pt = pt1;
      this.arbiters.set(key, arb);
    }
    this.joints.forEach((j, i) => { const t = s.joints[i]; if (t) { j.Px = t[0]; j.Py = t[1]; if ('Pm' in j) j.Pm = t[2]; if ('Pa' in j) j.Pa = t[3]; if ('P' in j) j.P = t[4]; } });
    this.sorted = [...this.bodies];
    this.inside.clear();
  }
}

/** Ray against one body: distance along the (unit) direction and the surface normal, or null. */
function rayBody(b, ox, oy, dx, dy, maxT) {
  if (b.shape.type === 'circle') {
    const mx = ox - b.x, my = oy - b.y, r = b.shape.radius, bq = mx * dx + my * dy, cq = mx * mx + my * my - r * r;
    if (cq <= 0 || (cq > 0 && bq > 0)) return null;                         // starts inside, or points away
    const disc = bq * bq - cq;
    if (disc < 0) return null;
    let t = -bq - Math.sqrt(disc);
    if (t < 0) t = 0;
    if (t > maxT) return null;
    const px = ox + dx * t - b.x, py = oy + dy * t - b.y, l = Math.sqrt(px * px + py * py) || 1;
    return { t, nx: px / l, ny: py / l };
  }
  let lo = 0, hi = maxT, nx = 0, ny = 0;
  for (let i = 0; i < b.shape.count; i++) {
    const num = b.wnx[i] * (b.wx[i] - ox) + b.wny[i] * (b.wy[i] - oy), den = b.wnx[i] * dx + b.wny[i] * dy;
    if (den === 0) { if (num < 0) return null; continue; }
    const t = num / den;
    if (den < 0) { if (t > lo) { lo = t; nx = b.wnx[i]; ny = b.wny[i]; } }
    else if (t < hi) hi = t;
    if (hi < lo) return null;
  }
  if ((nx === 0 && ny === 0) || lo > maxT) return null;                      // no face was entered: the ray starts inside, or misses
  return { t: lo, nx, ny };
}
