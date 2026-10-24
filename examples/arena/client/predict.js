import { applyInput } from '../shared/game.js';

/**
 * Client-side prediction with server reconciliation for the local player.
 *
 * Every local input is applied immediately with the same `applyInput` the
 * server uses, and remembered together with the position it produced. When a
 * snapshot arrives, the server says "I have applied inputs up to N and your
 * position was (x, y) then":
 *  - if that matches what we predicted after input N (within `tolerance`),
 *    nothing happens: the usual case, so the player never feels corrections;
 *  - otherwise we adopt the server's position and replay every input newer than
 *    N, then hide the jump by easing a visual offset to zero.
 *
 * Rendering reads `renderPosition(alpha)`: interpolated between the last two
 * predicted ticks plus the decaying correction offset.
 */
export class PredictedPlayer {
  /**
   * @param {import('../../../packages/physics/src/index.js').SpatialHash} walls
   * @param {number} dt Seconds per input (one tick)
   * @param {object} [o]
   * @param {number} [o.capacity] Inputs remembered (must exceed the longest unacked span).
   * @param {number} [o.tolerance] Match threshold in world units (a bit over the position quantization step).
   * @param {number} [o.snapDistance] Corrections larger than this jump instead of easing.
   * @param {number} [o.smoothHalfLife] Seconds for a correction offset to halve.
   */
  constructor(walls, dt, { capacity = 256, tolerance = 0.08, snapDistance = 200, smoothHalfLife = 0.06, rules = undefined } = {}) {
    this.rules = rules; // the same rule values the server uses (undefined = defaults)
    this.walls = walls;
    this.dt = dt;
    this.capacity = capacity;
    this.tolerance = tolerance;
    this.snapDistance = snapDistance;
    this.smoothHalfLife = smoothHalfLife;
    this.initialized = false;
    this.x = 0; this.y = 0;
    this.prevX = 0; this.prevY = 0;
    this.offsetX = 0; this.offsetY = 0;
    this.seqs = new Int32Array(capacity).fill(-1);
    this.mx = new Int8Array(capacity);
    this.my = new Int8Array(capacity);
    this.buttons = new Uint8Array(capacity);
    this.px = new Float64Array(capacity).fill(NaN); // position after applying that input
    this.py = new Float64Array(capacity).fill(NaN);
    this.newestSeq = 0;
    this.ackedSeq = 0;
    this.point = { x: 0, y: 0 };
    this.stats = { corrections: 0, snaps: 0, maxError: 0, lastError: 0, reconciles: 0 };
  }

  /** Inputs sent but not yet acknowledged by the server. */
  get pending() { return this.newestSeq - this.ackedSeq; }

  /**
   * Record (and, once initialised, apply) the input for the next tick.
   * @param {number} seq Strictly increasing, starting at 1.
   */
  record(seq, moveX, moveY, buttons) {
    const s = seq % this.capacity;
    this.seqs[s] = seq;
    this.mx[s] = moveX; this.my[s] = moveY; this.buttons[s] = buttons;
    this.newestSeq = seq;
    if (!this.initialized) { this.px[s] = NaN; this.py[s] = NaN; return; }
    this.prevX = this.x; this.prevY = this.y;
    this.#step(s);
  }

  #step(s) {
    const p = this.point;
    p.x = this.x; p.y = this.y;
    applyInput(this.walls, p, this.mx[s], this.my[s], this.buttons[s], this.dt, this.rules);
    this.x = p.x; this.y = p.y;
    this.px[s] = p.x; this.py[s] = p.y;
  }

  /**
   * Compare against the server's state after it applied input `ackSeq`.
   * @param {number} ackSeq
   * @param {number} serverX
   * @param {number} serverY
   * @returns {number} Size of the correction applied (0 = prediction was right).
   */
  reconcile(ackSeq, serverX, serverY) {
    this.stats.reconciles++;
    if (ackSeq < this.ackedSeq) return 0; // older than something already handled
    if (!this.initialized) {
      this.initialized = true;
      this.x = serverX; this.y = serverY;
      this.#replayFrom(ackSeq);
      this.prevX = this.x; this.prevY = this.y;
      this.ackedSeq = ackSeq;
      return 0;
    }
    const s = ackSeq % this.capacity;
    const known = ackSeq > 0 && this.seqs[s] === ackSeq && !Number.isNaN(this.px[s]);
    if (ackSeq === 0) return 0; // server has not applied anything of ours yet
    if (known) {
      const ex = serverX - this.px[s], ey = serverY - this.py[s];
      const err = Math.sqrt(ex * ex + ey * ey);
      this.stats.lastError = err;
      if (err > this.stats.maxError) this.stats.maxError = err;
      if (err <= this.tolerance) { this.ackedSeq = ackSeq; return 0; }
    }
    // Either a real mismatch, or we never knew where this input left us (it was sent before prediction started,
    // so its position was never computed). Both cases: adopt the server's state at the ack and replay what
    // follows, which is possible as long as the inputs after the ack are still remembered.
    const oldX = this.x, oldY = this.y;
    this.x = serverX; this.y = serverY;
    const complete = ackSeq >= this.newestSeq || ackSeq > this.newestSeq - this.capacity;
    if (complete) {
      if (this.seqs[s] === ackSeq) { this.px[s] = serverX; this.py[s] = serverY; } // now we know: later acks of it compare normally
      this.#replayFrom(ackSeq);
    }
    this.ackedSeq = ackSeq;
    const dx = this.x - oldX, dy = this.y - oldY;
    const moved = Math.sqrt(dx * dx + dy * dy);
    if (!known && complete && moved <= this.tolerance) return 0; // only filled in a missing baseline: nothing visibly changed
    this.stats.corrections++;
    if (moved > this.snapDistance || !complete) {
      this.stats.snaps++;
      this.offsetX = this.offsetY = 0;
      this.prevX = this.x; this.prevY = this.y;
    } else {
      // Keep the rendered position continuous: shift the previous tick the same way, offset by the opposite.
      this.prevX += dx; this.prevY += dy;
      this.offsetX -= dx; this.offsetY -= dy;
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
    this.offsetX *= k; this.offsetY *= k;
    if (Math.abs(this.offsetX) < 0.01) this.offsetX = 0;
    if (Math.abs(this.offsetY) < 0.01) this.offsetY = 0;
  }

  /**
   * @param {number} alpha 0..1 progress between the last two predicted ticks
   * @param {{x: number, y: number}} [out]
   */
  renderPosition(alpha, out = { x: 0, y: 0 }) {
    out.x = this.prevX + (this.x - this.prevX) * alpha + this.offsetX;
    out.y = this.prevY + (this.y - this.prevY) * alpha + this.offsetY;
    return out;
  }
}
