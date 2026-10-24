import { createBody, stepPlayer } from '../shared/game.js';

/**
 * Client-side prediction with server reconciliation for the local 3D player. Same scheme as the 2D arena, but the state being
 * predicted is a whole character: position, vertical speed and whether it stands on ground.
 *
 * Every local input is applied at once with `stepPlayer` (the function the server uses) and remembered with the position it
 * produced. A snapshot says "I applied inputs up to N and your state was S": if S matches what we predicted after N nothing
 * happens; otherwise we adopt S, replay inputs newer than N, and ease the visible jump away.
 */
export class PredictedPlayer3D {
  /**
   * @param {import('../../../packages/physics/src/index.js').TriWorld} level
   * @param {number} dt Seconds per input
   * @param {object} [o]
   * @param {object} [o.rules]
   * @param {number} [o.capacity] Inputs remembered (must exceed the longest unacknowledged span).
   * @param {number} [o.tolerance] Metres; a little over the position quantization step.
   * @param {number} [o.snapDistance] Corrections larger than this jump instead of easing.
   * @param {number} [o.smoothHalfLife]
   */
  constructor(level, dt, { rules = undefined, capacity = 256, tolerance = 0.03, snapDistance = 5, smoothHalfLife = 0.06 } = {}) {
    this.level = level;
    this.dt = dt;
    this.rules = rules;
    this.capacity = capacity;
    this.tolerance = tolerance;
    this.snapDistance = snapDistance;
    this.smoothHalfLife = smoothHalfLife;
    this.body = createBody(0, 0, 0, rules);
    this.initialized = false;
    this.prevX = 0; this.prevY = 0; this.prevZ = 0;
    this.offX = 0; this.offY = 0; this.offZ = 0;
    this.seqs = new Int32Array(capacity).fill(-1);
    this.mx = new Int8Array(capacity);
    this.my = new Int8Array(capacity);
    this.buttons = new Uint8Array(capacity);
    this.yaws = new Float64Array(capacity);
    this.rx = new Float64Array(capacity).fill(NaN); // position after applying that input
    this.ry = new Float64Array(capacity);
    this.rz = new Float64Array(capacity);
    this.newestSeq = 0;
    this.ackedSeq = 0;
    this.input = { moveX: 0, moveY: 0, buttons: 0, yaw: 0 };
    this.stats = { corrections: 0, snaps: 0, maxError: 0, lastError: 0, reconciles: 0 };
  }

  get x() { return this.body.x; }
  get y() { return this.body.y; }
  get z() { return this.body.z; }
  get pending() { return this.newestSeq - this.ackedSeq; }

  /** Record (and, once initialised, apply) the input for the next tick. `yaw` must be the quantized value that is sent. */
  record(seq, moveX, moveY, buttons, yaw) {
    const s = seq % this.capacity;
    this.seqs[s] = seq;
    this.mx[s] = moveX; this.my[s] = moveY; this.buttons[s] = buttons; this.yaws[s] = yaw;
    this.newestSeq = seq;
    if (!this.initialized) { this.rx[s] = NaN; return; }
    this.prevX = this.body.x; this.prevY = this.body.y; this.prevZ = this.body.z;
    this.#step(s);
  }

  #step(s) {
    const i = this.input;
    i.moveX = this.mx[s]; i.moveY = this.my[s]; i.buttons = this.buttons[s]; i.yaw = this.yaws[s];
    stepPlayer(this.level, this.body, i, this.dt, this.rules);
    this.rx[s] = this.body.x; this.ry[s] = this.body.y; this.rz[s] = this.body.z;
  }

  #adopt(x, y, z, vy, grounded) {
    const b = this.body;
    b.x = x; b.y = y; b.z = z; b.vy = vy; b.grounded = grounded;
  }

  /** Compare against the server's state after it applied input `ackSeq`. @returns {number} Size of the correction (0 = prediction was right). */
  reconcile(ackSeq, x, y, z, vy, grounded) {
    this.stats.reconciles++;
    if (ackSeq < this.ackedSeq) return 0;
    const b = this.body;
    if (!this.initialized) {
      this.initialized = true;
      this.#adopt(x, y, z, vy, grounded);
      this.#replayFrom(ackSeq);
      this.prevX = b.x; this.prevY = b.y; this.prevZ = b.z;
      this.ackedSeq = ackSeq;
      return 0;
    }
    if (ackSeq === 0) return 0;
    const s = ackSeq % this.capacity;
    const known = this.seqs[s] === ackSeq && !Number.isNaN(this.rx[s]);
    if (known) {
      const ex = x - this.rx[s], ey = y - this.ry[s], ez = z - this.rz[s];
      const err = Math.sqrt(ex * ex + ey * ey + ez * ez);
      this.stats.lastError = err;
      if (err > this.stats.maxError) this.stats.maxError = err;
      if (err <= this.tolerance) { this.ackedSeq = ackSeq; return 0; }
    }
    const ox = b.x, oy = b.y, oz = b.z;
    this.#adopt(x, y, z, vy, grounded);
    const complete = ackSeq >= this.newestSeq || ackSeq > this.newestSeq - this.capacity;
    if (complete) {
      if (this.seqs[s] === ackSeq) { this.rx[s] = x; this.ry[s] = y; this.rz[s] = z; }
      this.#replayFrom(ackSeq);
    }
    this.ackedSeq = ackSeq;
    const dx = b.x - ox, dy = b.y - oy, dz = b.z - oz;
    const moved = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (!known && complete && moved <= this.tolerance) return 0;
    this.stats.corrections++;
    if (moved > this.snapDistance || !complete) {
      this.stats.snaps++;
      this.offX = this.offY = this.offZ = 0;
      this.prevX = b.x; this.prevY = b.y; this.prevZ = b.z;
    } else {
      this.prevX += dx; this.prevY += dy; this.prevZ += dz;
      this.offX -= dx; this.offY -= dy; this.offZ -= dz;
    }
    return moved;
  }

  #replayFrom(ackSeq) {
    for (let seq = ackSeq + 1; seq <= this.newestSeq; seq++) {
      const s = seq % this.capacity;
      if (this.seqs[s] === seq) this.#step(s);
    }
  }

  /** Ease the correction offset toward zero; call once per rendered frame. */
  smooth(dt) {
    const k = 0.5 ** (dt / this.smoothHalfLife); // determinism-ok: visual smoothing only, never feeds simulation
    this.offX *= k; this.offY *= k; this.offZ *= k;
    if (Math.abs(this.offX) < 0.002) this.offX = 0;
    if (Math.abs(this.offY) < 0.002) this.offY = 0;
    if (Math.abs(this.offZ) < 0.002) this.offZ = 0;
  }

  /** @param {number} alpha 0..1 progress between the last two predicted ticks */
  renderPosition(alpha, out = { x: 0, y: 0, z: 0 }) {
    const b = this.body;
    out.x = this.prevX + (b.x - this.prevX) * alpha + this.offX;
    out.y = this.prevY + (b.y - this.prevY) * alpha + this.offY;
    out.z = this.prevZ + (b.z - this.prevZ) * alpha + this.offZ;
    return out;
  }
}
