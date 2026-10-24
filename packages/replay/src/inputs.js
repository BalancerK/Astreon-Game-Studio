/** The version of the input-replay layout this code writes and reads. */
export const INPUT_REPLAY_VERSION = 1;

/** A 32-bit FNV-1a hash of any JSON-able value, as 8 hex digits (for comparing the state of two runs). */
export function hashState(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(16).padStart(8, '0');
}

/** The replay does not reproduce what was recorded: the state at `tick` hashes differently from the recording. */
export class ReplayDesyncError extends Error {
  /** @param {number} tick @param {string} expected @param {string} actual */
  constructor(tick, expected, actual) {
    super(`the replay has drifted from the recording at tick ${tick} (recorded state ${expected}, now ${actual})`);
    this.name = 'ReplayDesyncError'; this.tick = tick; this.expected = expected; this.actual = actual;
  }
}

/**
 * Records a match of a **deterministic** game as its inputs: the starting state, then what each player pressed on each tick. Because the simulation gives the same result every time (that is what
 * the fixed timestep and `@engine/math` are for), playing the inputs back through it reproduces the whole match, and a ten-minute match is a few kilobytes. Every `checkpointEvery` ticks it also
 * keeps a copy of the game state (so a player can jump into the middle) and every `hashEvery` ticks a hash of it (so a replay that has stopped matching, after an update changed the rules, is caught
 * at once, not by someone noticing the wrong ending).
 *
 * Call `record(tick, inputs)` at the start of every tick, before the simulation runs it, with whatever your simulation takes as input for that tick (anything JSON-able: a map from player to
 * buttons). Ticks must be consecutive.
 */
export class InputRecorder {
  /**
   * @param {object} o
   * @param {string} [o.game] Name of the game, stored.
   * @param {number} [o.version] Version of the game's rules (1): a replay of another version is refused by the player's caller, not guessed at.
   * @param {number} [o.tickRate] Ticks per second (60).
   * @param {Record<string, any>} [o.meta] Anything about the match (map, players, seed, date).
   * @param {() => any} [o.save] Returns the game state as plain data (it is copied by `JSON`), for checkpoints. Without it the replay can only be played from the start.
   * @param {() => any} [o.hash] Returns a number or string that is the same whenever the game state is the same, for catching drift. Default: `hashState(save())` if `save` is given.
   * @param {number} [o.checkpointEvery] Ticks between saved states (600). @param {number} [o.hashEvery] Ticks between hashes (60).
   */
  constructor({ game = '', version = 1, tickRate = 60, meta = {}, save = null, hash = null, checkpointEvery = 600, hashEvery = 60 }) {
    this.game = game; this.version = version; this.tickRate = tickRate; this.meta = meta;
    this.save = save; this.hash = hash ?? (save ? () => hashState(save()) : null);
    this.checkpointEvery = checkpointEvery; this.hashEvery = hashEvery;
    this.runs = []; this.lastText = null;                       // the inputs, run-length encoded: [count, input]
    this.startTick = -1; this.nextTick = -1;
    this.checkpoints = []; this.hashes = [];
  }

  /** The number of ticks recorded. */
  get ticks() { return this.startTick < 0 ? 0 : this.nextTick - this.startTick; }

  /** Record the inputs of `tick` (call before running the tick). */
  record(tick, inputs = null) {
    if (this.startTick < 0) this.startTick = this.nextTick = tick;
    if (tick !== this.nextTick) throw new Error(`replay ticks must be consecutive (expected ${this.nextTick}, got ${tick})`);
    const rel = tick - this.startTick;
    if (this.save && rel % this.checkpointEvery === 0) this.checkpoints.push({ tick, state: JSON.parse(JSON.stringify(this.save())), hash: this.hash ? String(this.hash()) : undefined });
    else if (this.hash && rel % this.hashEvery === 0) this.hashes.push([tick, String(this.hash())]);
    const text = JSON.stringify(inputs ?? null);
    if (text === this.lastText) this.runs[this.runs.length - 1][0]++;
    else { this.runs.push([1, inputs ?? null]); this.lastText = text; }
    this.nextTick++;
  }

  /** The recording as plain, JSON-safe data. @returns {object} */
  finish() {
    return { format: 'engine-input-replay', version: INPUT_REPLAY_VERSION, game: this.game, gameVersion: this.version, tickRate: this.tickRate, meta: this.meta, startTick: Math.max(this.startTick, 0), ticks: this.ticks, runs: this.runs, checkpoints: this.checkpoints, hashes: this.hashes };
  }

  /** The recording as text (a file, a message, a bug report). */
  toText() { return JSON.stringify(this.finish()); }
}

/**
 * Plays an input recording back through your simulation: it hands your `step` the recorded inputs, tick by tick, checking the recorded hashes as it goes. It can jump to any tick (it restores the
 * nearest saved state before it with `load` and plays forward from there), run faster or slower, pause and loop.
 */
export class InputPlayer {
  /**
   * @param {object | string} replay What `InputRecorder.finish()` returned, or its text.
   * @param {object} o
   * @param {(inputs: any, tick: number) => void} o.step Run one tick of the game with these inputs.
   * @param {(state: any) => void} [o.load] Put the game into a saved state (needed to seek, to start from a state other than the game's fresh one, and to loop).
   * @param {() => any} [o.hash] The same function the recording used, to check the replay still matches (without it nothing is verified).
   * @param {(error: ReplayDesyncError) => void} [o.onDesync] Called when a hash differs. Without it the error is thrown from `advance` / `update`.
   * @throws {Error} Not an input replay, or a newer layout than this engine reads.
   */
  constructor(replay, { step, load = null, hash = null, onDesync = null }) {
    const r = typeof replay === 'string' ? JSON.parse(replay) : replay;
    if (r?.format !== 'engine-input-replay') throw new Error('not an input replay');
    if (r.version > INPUT_REPLAY_VERSION) throw new Error(`this input replay uses layout ${r.version}; this engine reads up to ${INPUT_REPLAY_VERSION}`);
    this.replay = r; this.step = step; this.load = load; this.hash = hash; this.onDesync = onDesync;
    this.tickRate = r.tickRate; this.meta = r.meta; this.startTick = r.startTick; this.ticks = r.ticks;
    this.starts = []; let at = 0;                                // the first tick (relative) of each run, for finding the inputs of any tick
    for (const [n] of r.runs) { this.starts.push(at); at += n; }
    this.hashAt = new Map(r.hashes.map(([t, h]) => [t, h]));
    for (const c of r.checkpoints) if (c.hash !== undefined) this.hashAt.set(c.tick, c.hash);
    /** The next tick to run. */ this.tick = r.startTick;
    this.speed = 1; this.playing = true; this.loop = false;
    this.carry = 0;
    this.desyncs = [];
    this.fresh = true;
  }

  get endTick() { return this.startTick + this.ticks; }
  /** Length in seconds. */ get duration() { return this.ticks / this.tickRate; }
  /** Seconds played. */ get time() { return (this.tick - this.startTick) / this.tickRate; }
  get finished() { return this.tick >= this.endTick; }

  /** The recorded inputs of a tick. */
  inputsAt(tick) {
    const rel = tick - this.startTick;
    if (rel < 0 || rel >= this.ticks) throw new RangeError(`tick ${tick} is outside the recording (${this.startTick} to ${this.endTick - 1})`);
    let lo = 0, hi = this.starts.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (this.starts[mid] <= rel) lo = mid; else hi = mid - 1; }
    return this.replay.runs[lo][1];
  }

  /** Put the game at the start of the recording: the first checkpoint, if there is one (otherwise the game must be fresh). */
  rewind() {
    const first = this.replay.checkpoints[0];
    if (first) { if (!this.load) throw new Error('rewinding needs a load function to put the game back into its recorded starting state'); this.load(JSON.parse(JSON.stringify(first.state))); }
    else if (!this.fresh) throw new Error('this replay has no saved state: rewinding needs the game to be started again from its beginning');
    this.tick = this.startTick; this.carry = 0;
    return this;
  }

  /** Run `n` ticks (stops at the end). Returns how many ran. */
  advance(n = 1) {
    if (this.fresh && this.replay.checkpoints[0] && this.load && this.tick === this.startTick) { this.load(JSON.parse(JSON.stringify(this.replay.checkpoints[0].state))); }
    this.fresh = false;
    let ran = 0;
    while (ran < n && this.tick < this.endTick) {
      const want = this.hash ? this.hashAt.get(this.tick) : undefined;
      if (want !== undefined) {
        const got = String(this.hash());
        if (got !== want) {
          const e = new ReplayDesyncError(this.tick, want, got);
          this.desyncs.push(e);
          if (this.onDesync) this.onDesync(e); else throw e;
        }
      }
      this.step(this.inputsAt(this.tick), this.tick);
      this.tick++; ran++;
    }
    return ran;
  }

  /** Jump so that the next tick to run is `tick` (clamped): restores the nearest saved state at or before it, then plays forward. Needs `load` and a recorded `save`. */
  seek(tick) {
    const t = Math.max(this.startTick, Math.min(this.endTick, tick));
    if (t === this.tick) return this;
    if (t > this.tick) { this.advance(t - this.tick); return this; }
    const cps = this.replay.checkpoints;
    if (!this.load || !cps.length) throw new Error('seeking backwards needs a recorded save and a load function');
    let best = cps[0]; for (const c of cps) if (c.tick <= t) best = c;
    this.load(JSON.parse(JSON.stringify(best.state)));
    this.tick = best.tick; this.carry = 0;
    this.advance(t - best.tick);
    return this;
  }

  /** Play along for `dt` real seconds (times `speed`, unless paused). Returns how many ticks ran. */
  update(dt) {
    if (!this.playing) return 0;
    this.carry += dt * this.speed * this.tickRate;
    const n = Math.floor(this.carry); this.carry -= n;
    let ran = this.advance(n);
    if (this.finished && this.loop && this.ticks > 0) { this.rewind(); this.fresh = false; if (ran < n) ran += this.advance(n - ran); }
    return ran;
  }
}
