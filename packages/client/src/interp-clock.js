const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/**
 * Decides which server tick to draw other entities at.
 *
 * Snapshots arrive "late" by the network latency plus some queueing jitter. For
 * smooth interpolation we render slightly in the past: far enough behind the
 * newest snapshot that the next one has (almost always) arrived, but no
 * further, because every extra tick of delay is visible lag.
 *
 * Measured per snapshot:
 *  - lateness `m`: smoothed (arrival time in ticks - snapshot tick), i.e. the latency floor plus average queueing;
 *  - jitter `d`: smoothed mean deviation of lateness (RFC 3550 style);
 *  - gap: spacing between accepted snapshot ticks (1 normally, larger when packets are lost). The buffer
 *    follows a slowly decaying *peak* of the gap, not its mean, because one lost snapshot must not starve rendering;
 *  - step detection: if lateness stays far from its estimate for several snapshots (a route change), the estimate
 *    jumps to the new level at once instead of crawling there.
 *
 * Buffer depth = peak gap + k * jitter, clamped. The defaults (k = 4, minimum 2 ticks) came from sweeping
 * the arena network lab (`tools/arena-netlab-sweep.js`): with k = 3 and a 1.5 tick minimum, a link with only
 * 10 ms of jitter starved 4% of frames; k = 4 with a 2 tick minimum removed that at a cost of ~8 ms. The render clock then slews toward
 * `now - m - buffer` by speeding up or slowing down at most `maxRateAdjust`,
 * so a changing target never makes motion visibly jump, and it only snaps when
 * the target moves far away (e.g. a route change).
 */
export class InterpolationClock {
  /**
   * @param {object} o
   * @param {number} o.tickMs Server tick period in milliseconds.
   * @param {number} [o.k] Jitter safety multiplier (default 4).
   * @param {number} [o.minBufferTicks] Smallest buffer (default 2 ticks).
   * @param {number} [o.maxBufferTicks]
   * @param {number} [o.maxRateAdjust] Largest playback speed change (0.1 = +-10%).
   * @param {number} [o.gain] Rate change per tick of error.
   * @param {number} [o.snapTicks] Errors larger than this jump instead of slewing.
   * @param {number} [o.stepTicks] Lateness deviations larger than this, sustained, count as a latency step.
   * @param {number | null} [o.fixedDelayMs] Use a fixed delay behind the newest snapshot instead of adapting (for comparisons).
   */
  constructor({ tickMs, k = 4, minBufferTicks = 2, maxBufferTicks = 20, maxRateAdjust = 0.1, gain = 0.2, snapTicks = 8, stepTicks = 6, fixedDelayMs = null }) {
    this.tickMs = tickMs;
    this.k = k;
    this.minBuffer = minBufferTicks;
    this.maxBuffer = maxBufferTicks;
    this.maxRateAdjust = maxRateAdjust;
    this.gain = gain;
    this.snapTicks = snapTicks;
    this.stepTicks = stepTicks;
    this.outliers = 0;
    this.outlierSum = 0;
    this.fixedDelayMs = fixedDelayMs;
    /** Smoothed lateness in ticks (null until the first snapshot). */
    this.lateness = null;
    this.jitter = 0;
    this.gap = 1;
    this.gapPeak = 1;
    this.lastTick = 0;
    this.latestTick = 0;
    this.rt = 0;
    this.lastNow = 0;
    this.started = false;
    this.rate = 1;
    this.snaps = 0;
  }

  /**
   * Feed every accepted (newer) snapshot.
   * @param {number} arrivalMs
   * @param {number} tick
   */
  onSnapshot(arrivalMs, tick) {
    const sample = arrivalMs / this.tickMs - tick;
    if (this.lateness === null) {
      this.lateness = sample;
    } else if (Math.abs(sample - this.lateness) > this.stepTicks) {
      // Far from the estimate: a spike, or a real latency step? Decide after a few in a row.
      this.outliers++;
      this.outlierSum += sample;
      if (this.outliers >= 5) {
        this.lateness = this.outlierSum / this.outliers;
        this.jitter = 0;
        this.outliers = 0;
        this.outlierSum = 0;
      }
    } else {
      this.outliers = 0;
      this.outlierSum = 0;
      this.jitter += (Math.abs(sample - this.lateness) - this.jitter) / 16;
      this.lateness += (sample - this.lateness) / 16;
    }
    if (this.lastTick > 0 || this.latestTick > 0) {
      const g = clamp(tick - this.lastTick, 1, 10);
      this.gap += (g - this.gap) / 16;
      this.gapPeak = g > this.gapPeak ? g : this.gapPeak + (g - this.gapPeak) / 32;
    }
    this.lastTick = tick;
    if (tick > this.latestTick) this.latestTick = tick;
  }

  /** Ticks of buffering behind the newest snapshot that we aim for. */
  get bufferTicks() {
    if (this.fixedDelayMs !== null) return this.fixedDelayMs / this.tickMs;
    return clamp(this.gapPeak + this.k * this.jitter, this.minBuffer, this.maxBuffer);
  }

  /** Best estimate of the server's current tick (fractional), or NaN before any snapshot. */
  serverTickNow(nowMs) {
    return this.lateness === null ? NaN : nowMs / this.tickMs - this.lateness;
  }

  /**
   * The tick to draw at, advancing smoothly. Call once per rendered frame.
   * @param {number} nowMs
   * @returns {number} Fractional server tick, or NaN before the first snapshot.
   */
  renderTick(nowMs) {
    if (this.lateness === null) return NaN;
    const desired = nowMs / this.tickMs - this.lateness - this.bufferTicks;
    if (!this.started) {
      this.started = true;
      this.rt = desired;
      this.lastNow = nowMs;
      return this.rt;
    }
    const dtTicks = (nowMs - this.lastNow) / this.tickMs;
    this.lastNow = nowMs;
    const err = desired - this.rt;
    if (Math.abs(err) > this.snapTicks) {
      this.rt = desired;
      this.rate = 1;
      this.snaps++;
    } else {
      this.rate = 1 + clamp(err * this.gain, -this.maxRateAdjust, this.maxRateAdjust);
      this.rt += dtTicks * this.rate;
    }
    return this.rt;
  }

  /** Numbers for a debug overlay. */
  status(nowMs) {
    const ms = this.tickMs;
    return {
      latenessMs: (this.lateness ?? NaN) * ms,
      jitterMs: this.jitter * ms,
      gap: this.gap,
      gapPeak: this.gapPeak,
      bufferMs: this.bufferTicks * ms,
      /** Actual distance between the newest snapshot and what we draw. */
      behindNewestMs: this.started ? (this.latestTick - this.rt) * ms : NaN,
      rate: this.rate,
      snaps: this.snaps,
      serverTick: this.serverTickNow(nowMs),
    };
  }
}
