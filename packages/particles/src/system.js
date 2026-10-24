// A CPU particle simulation: a fixed pool of particles in typed arrays (no allocation while running), driven by plain-data effect
// descriptions. It writes into anything with a `push(...)` like the renderer's `ParticleBatch`, so it does not depend on the renderer.
// Presentation only: it uses ordinary maths and a seedable random generator, and never touches game state.

const ORIENT = { billboard: 0, stretch: 1, flat: 2 };
const FIELDS = ['x', 'y', 'z', 'vx', 'vy', 'vz', 'age', 'life', 's0', 's1', 'r0', 'g0', 'b0', 'a0', 'r1', 'g1', 'b1', 'a1', 'drag', 'grav', 'stretch', 'spin', 'rot', 'add', 'hard', 'orient', 'bounce', 'fadeIn', 'hold'];

/**
 * @typedef {object} Effect Everything optional; ranges are `[min, max]` or a single number.
 * @property {number | [number, number]} [count] Particles per burst (default 8).
 * @property {number | [number, number]} [life] Seconds (0.5).
 * @property {number | [number, number]} [speed] Initial speed along a random direction in the cone (0).
 * @property {number} [spread] Cone half-angle around `dir` in radians; Math.PI is every direction (0).
 * @property {number[]} [dir] Cone axis (up).
 * @property {number | [number, number]} [size] Start radius in world units (0.1).
 * @property {number | [number, number]} [sizeEnd] Multiplier on the size at the end of life (1).
 * @property {number[]} [color] Start colour [r, g, b, a] 0..1 (white).
 * @property {number[]} [colorEnd] End colour (the start colour, fully transparent).
 * @property {number} [hold] Fraction of life the colour stays put before fading (0).
 * @property {number} [fadeIn] Fraction of life over which opacity rises from 0 (0).
 * @property {number} [gravity] Multiplier on the system's gravity (0).
 * @property {number} [drag] Speed lost per second, as exp(-drag * dt) (0).
 * @property {number} [stretch] Streak length per unit of speed, for orient 'stretch' (0).
 * @property {number | [number, number]} [spin] Radians per second (0).
 * @property {number} [additive] 0 alpha blended .. 1 adds light (0).
 * @property {number} [hardness] 0 soft .. 1 crisp disc (0).
 * @property {'billboard' | 'stretch' | 'flat'} [orient] Faces the camera, stretches along its velocity, or lies flat on a surface with normal `dir` (a decal; it does not move).
 * @property {number} [bounce] Bounciness off `floorY` (0 = lands and slides to a stop).
 * @property {number} [radius] Random offset of the start position (0).
 */

const pick = (v, rnd, fallback) => (v === undefined ? fallback : typeof v === 'number' ? v : v[0] + (v[1] - v[0]) * rnd());

/** mulberry32: small, fast and seedable, so effects can be reproduced in tests. */
export function seededRandom(seed = 1) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/**
 * Simulates particles on the CPU into a fixed-capacity pool: `burst` and `line` make effects at once, `emitter` makes continuous
 * ones, `update(dt)` moves everything (gravity, an optional bouncing floor), and `writeTo(batch)` fills a `ParticleBatch` for the
 * renderer. Seeded, so the same calls give the same particles.
 */
export class ParticleSystem {
  /**
   * @param {object} [o]
   * @param {number} [o.capacity] Most particles alive at once; new ones are dropped when full (counted in `dropped`).
   * @param {number[]} [o.gravity] Acceleration, default [0, -9.8, 0].
   * @param {number | null} [o.floorY] Height of an invisible floor particles bounce on (null: none).
   * @param {() => number} [o.random] A 0..1 generator (default: seeded, deterministic).
   */
  constructor({ capacity = 4096, gravity = [0, -9.8, 0], floorY = null, random = seededRandom(1) } = {}) {
    this.capacity = capacity;
    this.gravity = gravity;
    this.floorY = floorY;
    this.random = random;
    this.count = 0;
    this.spawned = 0;
    this.dropped = 0;
    for (const f of FIELDS) this[f] = new Float32Array(capacity);
    /** @type {Set<Emitter>} */
    this.emitters = new Set();
  }

  /** Kill everything and stop every emitter. */
  clear() { this.count = 0; this.emitters.clear(); }

  /**
   * Spawn a burst.
   * @param {Effect | Effect[]} effect An array plays each part (flash, smoke and sparks of one explosion).
   * @param {number} x @param {number} y @param {number} z
   * @param {{dir?: number[], scale?: number, amount?: number, tint?: number[], velocity?: number[]}} [o] `dir` overrides the effect's axis, `scale` multiplies sizes and speeds, `amount` the particle count, `tint` multiplies the colour, `velocity` is added to every particle (a moving source).
   */
  burst(effect, x, y, z, o = {}) {
    if (Array.isArray(effect)) { for (const e of effect) this.burst(e, x, y, z, o); return; }
    const rnd = this.random, scale = o.scale ?? 1;
    const n = Math.round(pick(effect.count, rnd, 8) * (o.amount ?? 1));
    const dir = o.dir ?? effect.dir ?? [0, 1, 0];
    const dl = Math.hypot(dir[0], dir[1], dir[2]) || 1, dx = dir[0] / dl, dy = dir[1] / dl, dz = dir[2] / dl;
    // two axes perpendicular to dir, to spread the cone around it
    const ax = Math.abs(dy) < 0.99 ? 0 : 1, ay = Math.abs(dy) < 0.99 ? 1 : 0;
    let tx = ay * dz - 0 * dy, ty = 0 * dx - ax * dz, tz = ax * dy - ay * dx; // cross(a, dir)
    const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
    const bx = dy * tz - dz * ty, by = dz * tx - dx * tz, bz = dx * ty - dy * tx; // cross(dir, t)
    const spread = effect.spread ?? 0, cosMax = Math.cos(Math.min(Math.PI, spread));
    const c0 = effect.color ?? [1, 1, 1, 1], c1 = effect.colorEnd ?? [c0[0], c0[1], c0[2], 0], tint = o.tint ?? [1, 1, 1];
    const orient = ORIENT[effect.orient ?? 'billboard'];
    const flat = orient === 2;
    for (let k = 0; k < n; k++) {
      if (this.count >= this.capacity) { this.dropped += n - k; return; }
      const i = this.count++;
      this.spawned++;
      // direction in the cone (uniform over the cap)
      const cosT = 1 - rnd() * (1 - cosMax), sinT = Math.sqrt(Math.max(0, 1 - cosT * cosT)), phi = rnd() * 6.283185307;
      const px = Math.cos(phi) * sinT, py = Math.sin(phi) * sinT;
      const sx = dx * cosT + tx * px + bx * py, sy = dy * cosT + ty * px + by * py, sz = dz * cosT + tz * px + bz * py;
      const speed = pick(effect.speed, rnd, 0) * scale;
      const rad = effect.radius ?? 0;
      let ox = 0, oy = 0, oz = 0;
      if (rad > 0) { const a = rnd() * 6.283185307, b = rnd() * 2 - 1, r = rad * scale * Math.cbrt(rnd()), s = Math.sqrt(1 - b * b); ox = Math.cos(a) * s * r; oy = b * r; oz = Math.sin(a) * s * r; }
      this.x[i] = x + ox; this.y[i] = y + oy; this.z[i] = z + oz;
      if (flat) { this.vx[i] = dx; this.vy[i] = dy; this.vz[i] = dz; } // the normal; decals do not move
      else {
        this.vx[i] = sx * speed + (o.velocity?.[0] ?? 0); this.vy[i] = sy * speed + (o.velocity?.[1] ?? 0); this.vz[i] = sz * speed + (o.velocity?.[2] ?? 0);
      }
      this.age[i] = 0;
      this.life[i] = Math.max(1e-3, pick(effect.life, rnd, 0.5));
      this.s0[i] = pick(effect.size, rnd, 0.1) * scale;
      this.s1[i] = this.s0[i] * pick(effect.sizeEnd, rnd, 1);
      this.r0[i] = c0[0] * tint[0]; this.g0[i] = c0[1] * tint[1]; this.b0[i] = c0[2] * tint[2]; this.a0[i] = c0[3] ?? 1;
      this.r1[i] = c1[0] * tint[0]; this.g1[i] = c1[1] * tint[1]; this.b1[i] = c1[2] * tint[2]; this.a1[i] = c1[3] ?? 0;
      this.drag[i] = effect.drag ?? 0; this.grav[i] = effect.gravity ?? 0; this.stretch[i] = effect.stretch ?? 0;
      this.spin[i] = pick(effect.spin, rnd, 0);
      this.rot[i] = flat || effect.spin !== undefined || effect.randomRotation ? rnd() * 6.283185307 : 0;
      this.add[i] = effect.additive ?? 0; this.hard[i] = effect.hardness ?? 0; this.orient[i] = orient;
      this.bounce[i] = effect.bounce ?? 0; this.fadeIn[i] = effect.fadeIn ?? 0; this.hold[i] = effect.hold ?? 0;
    }
  }

  /**
   * Particles along a segment (a tracer's glow, a trail): one burst every `spacing` world units.
   * @param {Effect | Effect[]} effect
   */
  line(effect, x0, y0, z0, x1, y1, z1, spacing = 0.5, o = {}) {
    const len = Math.hypot(x1 - x0, y1 - y0, z1 - z0), n = Math.max(1, Math.floor(len / spacing));
    for (let k = 0; k <= n; k++) { const u = k / n; this.burst(effect, x0 + (x1 - x0) * u, y0 + (y1 - y0) * u, z0 + (z1 - z0) * u, o); }
  }

  /**
   * A continuous source: `rate` bursts per second, and/or one burst per `spacing` world units it moves (a trail behind a projectile).
   * Move it with `emitter.move(x, y, z)`; stop it with `emitter.stop()`.
   * @param {Effect | Effect[]} effect
   * @param {{x?: number, y?: number, z?: number, rate?: number, spacing?: number, dir?: number[], scale?: number, life?: number}} [o] `life`: stop by itself after that many seconds.
   */
  emitter(effect, o = {}) {
    const e = new Emitter(this, effect, o);
    this.emitters.add(e);
    return e;
  }

  /** Advance by `dt` seconds. */
  update(dt) {
    if (dt <= 0) return;
    for (const e of this.emitters) e.update(dt);
    const g = this.gravity, floor = this.floorY;
    let i = 0;
    while (i < this.count) {
      const age = this.age[i] += dt;
      if (age >= this.life[i]) { this.#remove(i); continue; }
      if (this.orient[i] !== 2) {
        const damp = this.drag[i] > 0 ? Math.exp(-this.drag[i] * dt) : 1, gs = this.grav[i] * dt;
        this.vx[i] = (this.vx[i] + g[0] * gs) * damp; this.vy[i] = (this.vy[i] + g[1] * gs) * damp; this.vz[i] = (this.vz[i] + g[2] * gs) * damp;
        this.x[i] += this.vx[i] * dt; this.y[i] += this.vy[i] * dt; this.z[i] += this.vz[i] * dt;
        if (floor !== null && this.y[i] < floor && this.grav[i] > 0) {
          this.y[i] = floor;
          this.vy[i] = -this.vy[i] * this.bounce[i];
          this.vx[i] *= 0.7; this.vz[i] *= 0.7;
          if (Math.abs(this.vy[i]) < 0.3) this.vy[i] = 0;
        }
        this.rot[i] += this.spin[i] * dt;
      }
      i++;
    }
  }

  #remove(i) {
    const last = --this.count;
    if (i === last) return;
    for (const f of FIELDS) this[f][i] = this[f][last];
  }

  /**
   * Add every live particle to a batch (anything with `push(x, y, z, size, r, g, b, a, vx, vy, vz, stretch, rot, additive, hardness, orient)`).
   * @param {{push: Function}} batch
   */
  writeTo(batch) {
    for (let i = 0; i < this.count; i++) {
      const t = this.age[i] / this.life[i], h = this.hold[i];
      const u = h > 0 ? Math.max(0, (t - h) / (1 - h)) : t;
      let a = this.a0[i] + (this.a1[i] - this.a0[i]) * u;
      if (this.fadeIn[i] > 0 && t < this.fadeIn[i]) a *= t / this.fadeIn[i];
      batch.push(
        this.x[i], this.y[i], this.z[i], this.s0[i] + (this.s1[i] - this.s0[i]) * t,
        this.r0[i] + (this.r1[i] - this.r0[i]) * u, this.g0[i] + (this.g1[i] - this.g0[i]) * u, this.b0[i] + (this.b1[i] - this.b0[i]) * u, a,
        this.vx[i], this.vy[i], this.vz[i], this.stretch[i], this.rot[i], this.add[i], this.hard[i], this.orient[i],
      );
    }
  }
}

/**
 * A source that keeps making an effect: at a `rate` per second, or every `spacing` metres it moves. Made by
 * `ParticleSystem.emitter`; move it with `move(x, y, z)` and end it with `stop()`.
 */
export class Emitter {
  constructor(system, effect, { x = 0, y = 0, z = 0, rate = 0, spacing = 0, dir, scale, life = Infinity } = {}) {
    this.system = system; this.effect = effect;
    this.x = x; this.y = y; this.z = z;
    this.px = x; this.py = y; this.pz = z; // where it was at the last update
    this.rate = rate; this.spacing = spacing; this.dir = dir; this.scale = scale;
    this.life = life;
    this.acc = 0; this.travel = 0;
    this.active = true;
  }
  move(x, y, z) { this.x = x; this.y = y; this.z = z; }
  stop() { this.active = false; this.system.emitters.delete(this); }
  update(dt) {
    const o = { dir: this.dir, scale: this.scale };
    const dx = this.x - this.px, dy = this.y - this.py, dz = this.z - this.pz, dist = Math.hypot(dx, dy, dz);
    if (this.spacing > 0 && dist > 0) {
      this.travel += dist;
      while (this.travel >= this.spacing) { // along the path it just took
        this.travel -= this.spacing;
        const u = 1 - this.travel / dist;
        this.system.burst(this.effect, this.px + dx * u, this.py + dy * u, this.pz + dz * u, o);
      }
    }
    if (this.rate > 0) {
      this.acc += this.rate * dt;
      while (this.acc >= 1) { this.acc -= 1; const u = this.acc / Math.max(1e-9, this.rate * dt); this.system.burst(this.effect, this.x - dx * u, this.y - dy * u, this.z - dz * u, o); }
    }
    this.px = this.x; this.py = this.y; this.pz = this.z;
    if ((this.life -= dt) <= 0) this.stop();
  }
}
