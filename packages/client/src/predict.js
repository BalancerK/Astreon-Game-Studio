// Client-side prediction with server reconciliation, for any game. You give it the SAME step function the server runs for one player's input; it applies each input at once (so the player
// never waits for the network), remembers what it predicted, and when the server says "I have applied your inputs up to N and you were here", it checks. Nearly always the guess was right
// and nothing happens. When it was wrong (something pushed you that you could not know about), the server's answer is adopted, every input newer than N is replayed on top of it, and the
// jump is hidden by easing a visual offset to zero. What is drawn comes from `renderState(alpha)`.
//
// A state is a flat object of numbers (`{ x, y, vx, vy, onGround: 1 }`; use 0 and 1 for yes and no), so it can be copied cheaply and compared exactly. Inputs are plain data and must not be
// changed after they are recorded. The step function must be deterministic (see `@engine/math`) and must be the very function the server uses: a different one is a game that is always
// "corrected".
//
//   const predictor = new Predictor({ step: (s, input, dt) => movePlayer(s, input, dt), dt: 1 / 60, initial: { x: 0, y: 0 } });
//   predictor.record(seq, input);                          // every tick, the same seq you send to the server
//   predictor.reconcile(snapshot.ackSeq, snapshot.me);     // on every snapshot: the last input the server applied, and your state after it
//   predictor.smooth(frameSeconds);                        // every rendered frame
//   const drawAt = predictor.renderState(alpha);           // where to draw yourself (alpha: how far through the current tick)

const copy = (s) => ({ ...s });
const sq = (v) => v * v;                                  // not `**`: the same result on every engine

/**
 * @typedef {Object<string, number>} FlatState A flat object of numbers.
 */

/**
 * Client-side prediction with server reconciliation: applies your own inputs at once with the server's step function, checks them against the server's acknowledged state, and when
 * they disagree adopts the server's state, replays the newer inputs and eases the visible jump away. Draw `renderState(alpha)`.
 */
export class Predictor {
  /**
   * @param {object} o
   * @param {(state: FlatState, input: any, dt: number) => void} o.step Applies one input to a state, changing it in place. The server's own function.
   * @param {number} o.dt Seconds per input (one tick).
   * @param {FlatState} [o.initial] Where the player starts. Without it the predictor waits for the first `reconcile` to learn where it is.
   * @param {number} [o.capacity] Inputs remembered (must be more than the longest stretch the server has not yet acknowledged). Default 256.
   * @param {number} [o.tolerance] How far (in the units of `error`) the server may differ before it counts as a mismatch. Default 0.08.
   * @param {number} [o.snapDistance] A correction larger than this jumps instead of easing. Default 200.
   * @param {number} [o.smoothHalfLife] Seconds for a correction offset to halve. Default 0.06.
   * @param {string[]} [o.smooth] The numbers that are interpolated and eased when drawn (positions). Default `['x', 'y']`.
   * @param {(ours: FlatState, theirs: FlatState) => number} [o.error] How far apart two states are. Default: the distance over the `smooth` numbers.
   */
  constructor({ step, dt, initial, capacity = 256, tolerance = 0.08, snapDistance = 200, smoothHalfLife = 0.06, smooth = ['x', 'y'], error } = {}) {
    if (typeof step !== 'function') throw new Error('Predictor needs a step function: the same one the server runs for one input.');
    if (!(dt > 0)) throw new Error('Predictor needs dt, the seconds that one input covers.');
    this.step = step;
    this.dt = dt;
    this.capacity = capacity;
    this.tolerance = tolerance;
    this.snapDistance = snapDistance;
    this.smoothHalfLife = smoothHalfLife;
    this.smoothKeys = smooth;
    this.error = error ?? ((a, b) => Math.sqrt(smooth.reduce((sum, k) => (k in a ? sum + sq((b[k] ?? a[k]) - a[k]) : sum), 0)));
    this.initialized = false;
    this.state = {};
    this.prev = {};
    this.offset = Object.fromEntries(smooth.map((k) => [k, 0]));
    this.seqs = new Int32Array(capacity).fill(-1);
    this.inputs = new Array(capacity).fill(null);
    this.after = new Array(capacity).fill(null);                 // the state after each input: what the server's answer is compared with
    this.newestSeq = 0;
    this.ackedSeq = 0;
    this.stats = { corrections: 0, snaps: 0, maxError: 0, lastError: 0, reconciles: 0 };
    if (initial) { this.state = copy(initial); this.prev = copy(initial); this.initialized = true; }
  }

  /** How many inputs were sent but not yet acknowledged. */
  get pending() { return this.newestSeq - this.ackedSeq; }

  /**
   * Remember an input and apply it at once. Call it every tick with a `seq` that goes up by one each time (starting at 1), the same number you send to the server.
   * @param {number} seq
   * @param {any} input
   */
  record(seq, input) {
    const s = seq % this.capacity;
    this.seqs[s] = seq;
    this.inputs[s] = input;
    this.after[s] = null;
    this.newestSeq = seq;
    if (!this.initialized) return;
    this.prev = copy(this.state);
    this.#apply(s);
  }

  #apply(s) {
    this.step(this.state, this.inputs[s], this.dt);
    this.after[s] = copy(this.state);
  }

  #replayFrom(ackSeq) {
    for (let seq = ackSeq + 1; seq <= this.newestSeq; seq++) {
      const s = seq % this.capacity;
      if (this.seqs[s] === seq) this.#apply(s);
    }
  }

  /**
   * Check the prediction against what the server says. Call it for every snapshot that carries your own state.
   * @param {number} ackSeq The last input the server had applied when it made this snapshot.
   * @param {FlatState} serverState Your state after that input, as the server has it (it may leave out numbers it does not send).
   * @returns {number} How far the state moved because of the correction (0 when the prediction was right).
   */
  reconcile(ackSeq, serverState) {
    this.stats.reconciles++;
    if (ackSeq < this.ackedSeq) return 0;                           // older than something already handled
    if (!this.initialized) {
      this.initialized = true;
      this.state = { ...this.state, ...serverState };
      this.#replayFrom(ackSeq);
      this.prev = copy(this.state);
      this.ackedSeq = ackSeq;
      return 0;
    }
    if (ackSeq === 0) return 0;                                      // the server has not applied anything of ours yet
    const s = ackSeq % this.capacity;
    const known = this.seqs[s] === ackSeq && this.after[s] !== null;
    if (known) {
      const err = this.error(this.after[s], { ...this.after[s], ...serverState });
      this.stats.lastError = err;
      if (err > this.stats.maxError) this.stats.maxError = err;
      if (err <= this.tolerance) { this.ackedSeq = ackSeq; return 0; }
    }
    // A real mismatch, or we never knew where this input left us: adopt the server's state at the ack and replay what came after it (possible while those inputs are still remembered).
    const before = copy(this.state);
    this.state = { ...this.state, ...serverState };
    const complete = ackSeq >= this.newestSeq || ackSeq > this.newestSeq - this.capacity;
    if (complete) {
      if (this.seqs[s] === ackSeq) this.after[s] = copy(this.state);
      this.#replayFrom(ackSeq);
    }
    this.ackedSeq = ackSeq;
    const live = this.smoothKeys.filter((k) => k in this.state && k in before);        // a state without a `y` has nothing to smooth there
    const moved = Math.sqrt(live.reduce((sum, k) => sum + sq(this.state[k] - before[k]), 0));
    if (!known && complete && moved <= this.tolerance) return 0;     // only filled in a missing baseline: nothing visibly changed
    this.stats.corrections++;
    if (moved > this.snapDistance || !complete) {
      this.stats.snaps++;
      for (const k of live) this.offset[k] = 0;
      this.prev = copy(this.state);
    } else {
      for (const k of live) {                                        // keep what is drawn continuous: shift the previous tick the same way and offset by the opposite
        const d = this.state[k] - before[k];
        this.prev[k] += d;
        this.offset[k] -= d;
      }
    }
    return moved;
  }

  /** Ease the correction offset towards zero. Call it once for every rendered frame. @param {number} dt Seconds since the last frame. */
  smooth(dt) {
    const k = 0.5 ** (dt / this.smoothHalfLife);                      // determinism-ok: only changes what is drawn, never the simulation
    for (const key of this.smoothKeys) {
      this.offset[key] *= k;
      if (Math.abs(this.offset[key]) < 0.01) this.offset[key] = 0;
    }
  }

  /**
   * The state to draw: the smoothed numbers are interpolated between the last two predicted ticks plus the fading correction; every other number is as it is now.
   * @param {number} alpha 0 to 1: how far we are through the current tick.
   * @param {FlatState} [out]
   * @returns {FlatState}
   */
  renderState(alpha, out = {}) {
    Object.assign(out, this.state);
    for (const k of this.smoothKeys) {
      if (!(k in this.state)) continue;
      const before = this.prev[k] ?? this.state[k];
      out[k] = before + (this.state[k] - before) * alpha + this.offset[k];
    }
    return out;
  }
}
