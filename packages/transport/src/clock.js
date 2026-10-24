/**
 * Clocks schedule callbacks in milliseconds. `VirtualClock` only moves when
 * told to, which makes network tests instant and fully deterministic.
 * `RealClock` uses wall time for in-process demos.
 *
 * @typedef {Object} Clock
 * @property {() => number} now
 * @property {(delayMs: number, fn: () => void) => void} schedule
 */

/** Deterministic clock: events fire in (time, insertion) order as time is advanced. */
export class VirtualClock {
  /** @param {number} [start] */
  constructor(start = 0) {
    this.time = start;
    this.heap = [];
    this.seq = 0;
  }

  now() { return this.time; }
  get pending() { return this.heap.length; }

  schedule(delayMs, fn) {
    const e = { t: this.time + (delayMs > 0 ? delayMs : 0), s: this.seq++, fn };
    const h = this.heap;
    let i = h.push(e) - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.#less(h[p], e)) break;
      h[i] = h[p];
      i = p;
    }
    h[i] = e;
  }

  #less(a, b) { return a.t < b.t || (a.t === b.t && a.s < b.s); }

  #pop() {
    const h = this.heap;
    const top = h[0];
    const last = h.pop();
    if (h.length > 0) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= h.length) break;
        if (c + 1 < h.length && this.#less(h[c + 1], h[c])) c++;
        if (this.#less(last, h[c])) break;
        h[i] = h[c];
        i = c;
      }
      h[i] = last;
    }
    return top;
  }

  /** Run every event due at or before `time`, then set the clock to `time`. */
  runUntil(time) {
    while (this.heap.length > 0 && this.heap[0].t <= time) {
      const e = this.#pop();
      this.time = e.t;
      e.fn();
    }
    if (time > this.time) this.time = time;
  }

  /** @param {number} ms */
  advance(ms) { this.runUntil(this.time + ms); }

  /** Run until nothing is scheduled. @param {number} [maxEvents] Guard against endless rescheduling. */
  runAll(maxEvents = 1e7) {
    for (let n = 0; this.heap.length > 0; n++) {
      if (n >= maxEvents) throw new Error('VirtualClock.runAll: too many events (runaway schedule?)');
      const e = this.#pop();
      this.time = e.t;
      e.fn();
    }
  }
}

/**
 * The real clock: `now()` from `performance.now()` and `schedule` with `setTimeout`. Tests swap it for a fake one.
 */
export class RealClock {
  now() { return performance.now(); }
  schedule(delayMs, fn) { setTimeout(fn, delayMs); }
}
