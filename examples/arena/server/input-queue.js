/**
 * Per-client queue of sequenced inputs, plus the pacing rules that keep the
 * server authoritative:
 *
 * - Inputs are applied strictly in sequence order, one tick of movement each.
 * - Duplicates and stale (older) sequence numbers are ignored.
 * - If inputs were lost (a gap in sequence numbers), the previous input is
 *   repeated for the missing ones, since players rarely change input within a
 *   few ticks; this keeps the client's prediction close to the server's result.
 *   Buttons in `eventMask` (e.g. fire) are one-shot events, not held state, so they are NOT repeated.
 * - Pacing: the server earns one "credit" per tick (capped) and each applied
 *   input costs one. Starved ticks bank credit so jitter can be caught up, but
 *   a client flooding inputs cannot move faster than the tick rate (anti speed-hack).
 * - The queue is bounded; on overflow the oldest inputs are dropped.
 */
export class InputQueue {
  /**
   * @param {object} [o]
   * @param {number} [o.capacity] Max queued inputs.
   * @param {number} [o.maxGapFill] Most lost inputs to synthesise at once.
   * @param {number} [o.maxCredit] Most banked ticks of catch-up.
   * @param {number} [o.eventMask] Button bits that are one-shot events and must not be repeated when filling gaps.
   */
  constructor({ capacity = 32, maxGapFill = 8, maxCredit = 4, eventMask = 0 } = {}) {
    this.capacity = capacity;
    this.maxGapFill = maxGapFill;
    this.maxCredit = maxCredit;
    this.eventMask = eventMask;
    this.seqs = new Int32Array(capacity);
    this.xs = new Int8Array(capacity);
    this.ys = new Int8Array(capacity);
    this.buttons = new Uint8Array(capacity);
    this.aimXs = new Int8Array(capacity);
    this.aimYs = new Int8Array(capacity);
    this.views = new Uint16Array(capacity);
    this.head = 0;
    this.count = 0;
    /** Highest sequence number enqueued (real or synthesised). */
    this.lastSeq = 0;
    this.lastX = 0; this.lastY = 0; this.lastButtons = 0; this.lastAimX = 0; this.lastAimY = 0;
    this.credit = 0;
    this.stats = { dropped: 0, filled: 0, duplicates: 0, applied: 0 };
  }

  get length() { return this.count; }

  #enqueue(seq, x, y, b, ax, ay, view) {
    if (this.count === this.capacity) { // overflow: drop the oldest
      this.head = (this.head + 1) % this.capacity;
      this.count--;
      this.stats.dropped++;
    }
    const i = (this.head + this.count) % this.capacity;
    this.seqs[i] = seq; this.xs[i] = x; this.ys[i] = y; this.buttons[i] = b;
    this.aimXs[i] = ax; this.aimYs[i] = ay; this.views[i] = view;
    this.count++;
    this.lastSeq = seq; this.lastX = x; this.lastY = y; this.lastButtons = b; this.lastAimX = ax; this.lastAimY = ay;
  }

  /**
   * @param {number} seq
   * @param {number} x Move axis
   * @param {number} y
   * @param {number} b Buttons
   * @param {number} [ax] Aim direction
   * @param {number} [ay]
   * @param {number} [view] Claimed view tick (quarter ticks)
   * @returns {boolean} False for duplicate or stale inputs.
   */
  push(seq, x, y, b, ax = 0, ay = 0, view = 0) {
    if (seq <= this.lastSeq) { this.stats.duplicates++; return false; }
    const firstFill = Math.max(this.lastSeq + 1, seq - this.maxGapFill);
    for (let s = firstFill; s < seq; s++) {
      this.#enqueue(s, this.lastX, this.lastY, this.lastButtons & ~this.eventMask, this.lastAimX, this.lastAimY, 0);
      this.stats.filled++;
    }
    this.#enqueue(seq, x, y, b, ax, ay, view);
    return true;
  }

  /** Call once per server tick: earn credit. */
  tick() {
    if (this.credit < this.maxCredit) this.credit++;
  }

  /**
   * Take the next input if one is queued and credit allows.
   * @param {{seq: number, x: number, y: number, buttons: number, aimX: number, aimY: number, view: number}} out
   * @returns {boolean}
   */
  pop(out) {
    if (this.count === 0 || this.credit < 1) return false;
    this.credit--;
    const i = this.head;
    out.seq = this.seqs[i]; out.x = this.xs[i]; out.y = this.ys[i]; out.buttons = this.buttons[i];
    out.aimX = this.aimXs[i]; out.aimY = this.aimYs[i]; out.view = this.views[i];
    this.head = (this.head + 1) % this.capacity;
    this.count--;
    this.stats.applied++;
    return true;
  }
}
