// The Time Machine's core, with no page and no worker in it, so the same code runs in the game's worker, in Node tests and in a command-line replay checker.
//
// A game here is deterministic: the same state and the same inputs give the same next state. So recording a game is cheap: keep the *inputs* (a key going
// down or up, a value edited in the inspector, each stamped with the tick it happened at) and a copy of the state once a second. From that:
//   seek(t)   restore the nearest copy before t and run the game forward to t, applying the recorded inputs
//   replay    run the recorded inputs again from any moment, with the code as it is now ("what if the jump were higher?")
//   export    the start state, the inputs and a checksum of the state every second, as one small file that reproduces the game on another computer
//   verify    run an exported file again and say whether every checksum matches (it does not if the game used Math.random() or the clock)
//
// A tick is one call of the game's `update`, 1/60 s. Inputs stamped `at: n` take effect before update number n.

export const TICK_RATE = 60;
const FORBIDDEN = new Set(['__proto__', 'prototype', 'constructor']);
const MAX_DEPTH = 24;

/** A checksum of the game state (FNV-1a over its JSON): equal states give equal checksums. */
export function hashState(state) {
  const text = JSON.stringify(state) ?? '';
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

const clone = (value) => structuredClone(value);

/** Is this a path the inspector may edit? A list of keys (text) and positions (whole numbers), not too long, with nothing that could reach a prototype. */
export function validPath(path) {
  return Array.isArray(path) && path.length > 0 && path.length <= MAX_DEPTH
    && path.every((k) => (typeof k === 'string' && k.length <= 200 && !FORBIDDEN.has(k)) || (Number.isInteger(k) && k >= 0 && k < 1e9));
}

/**
 * Change one value in the state, where it already is. Only numbers, text, true/false and null may be written, and only over a value of that kind.
 * @returns {boolean} whether it was changed (with `dry`, whether it could be: nothing is changed)
 */
export function setPath(state, path, value, dry = false) {
  if (!validPath(path)) return false;
  if (!(value === null || ['number', 'string', 'boolean'].includes(typeof value))) return false;
  if (typeof value === 'number' && !Number.isFinite(value)) return false;
  let at = state;
  for (let i = 0; i < path.length - 1; i++) {
    if (at === null || typeof at !== 'object' || !Object.hasOwn(at, path[i])) return false;
    at = at[path[i]];
  }
  const key = path[path.length - 1];
  if (at === null || typeof at !== 'object' || !Object.hasOwn(at, key)) return false;
  const old = at[key];
  if (old !== null && typeof old === 'object') return false;
  if (!dry) at[key] = value;
  return true;
}

/** Read one value from the state (undefined if the path leads nowhere). */
export function getPath(state, path) {
  let at = state;
  for (const k of path) {
    if (at === null || typeof at !== 'object' || !Object.hasOwn(at, k)) return undefined;
    at = at[k];
  }
  return at;
}

/**
 * @typedef {{at: number, k: 'key', down: boolean, code: string} | {at: number, k: 'edit', path: (string|number)[], value: any}} TimeEvent
 * @typedef {{tick: number, state: any, held: string[], eventIndex: number, hash: string, run: number}} Snapshot
 */

export class Timeline {
  /**
   * @param {{snapshotEvery?: number, maxSnapshots?: number, maxBytes?: number, dt?: number}} [o]
   *   `snapshotEvery` ticks between copies of the state; `maxSnapshots` and `maxBytes` bound how far back you can go
   */
  constructor({ snapshotEvery = 60, maxSnapshots = 600, maxBytes = 48_000_000, dt = 1 / TICK_RATE } = {}) {
    this.every = snapshotEvery;
    this.maxSnapshots = maxSnapshots;
    this.maxBytes = maxBytes;
    this.dt = dt;
    this.run = 0;                 // which version of the code is running (a snapshot made by other code is not checked against)
    this.stateBytes = 0;
    this.reset(null);
  }

  /** Start a new recording from a state (a new game, or a restart). */
  reset(state, { tick = 0, held = [] } = {}) {
    this.tick = tick;
    this.maxTick = tick;
    this.held = new Set(held);
    /** @type {TimeEvent[]} */
    this.events = [];
    this.cursor = 0;              // the next event not yet applied
    /** @type {Snapshot[]} */
    this.snapshots = [];
    this.mode = 'live';           // 'live': inputs are recorded as they come; 'replay': inputs come from the recording
    this.paused = false;
    this.diverged = null;         // { tick } when a replay did not match what was recorded
    this.replayEnded = false;
    if (state !== null && state !== undefined) this.#snapshot(state);
  }

  /** Is anything recorded to go back to? */
  get hasHistory() { return this.snapshots.length > 0; }

  /** The first and last tick that can be gone to. */
  get range() { return { from: this.snapshots[0]?.tick ?? this.tick, to: this.maxTick }; }

  #snapshot(state) {
    const json = JSON.stringify(state) ?? '';
    this.stateBytes = Math.max(json.length, Math.round(this.stateBytes * 0.5));
    this.snapshots.push({
      tick: this.tick, state: clone(state), held: [...this.held], eventIndex: this.cursor, hash: hashState(state), run: this.run,
    });
    this.#trim();
  }

  /** Forget the oldest history when there is too much of it. */
  #trim() {
    const byBytes = Math.max(2, Math.floor(this.maxBytes / Math.max(1, this.stateBytes * 2)));        // 2 bytes a character in memory, roughly
    const keep = Math.min(this.maxSnapshots, byBytes);
    if (this.snapshots.length <= keep) return;
    const drop = this.snapshots.length - keep;
    this.snapshots.splice(0, drop);
    const dropEvents = this.snapshots[0].eventIndex;
    if (dropEvents > 0) {
      this.events.splice(0, dropEvents);
      for (const s of this.snapshots) s.eventIndex -= dropEvents;
      this.cursor = Math.max(0, this.cursor - dropEvents);
    }
  }

  #apply(state, event) {
    if (event.k === 'key') {
      if (event.down) this.held.add(event.code); else this.held.delete(event.code);
    } else if (event.k === 'edit') {
      setPath(state, event.path, event.value);
    }
  }

  #insert(event) {
    this.events.splice(this.cursor, 0, event);
    this.cursor++;
  }

  /** A key went down or up. Recorded and applied while live; ignored while replaying or paused. */
  key(down, code) {
    if (this.mode === 'replay' || this.paused) return false;
    if (down === this.held.has(code)) return false;                                  // a repeat of what is already so
    this.#insert({ at: this.tick, k: 'key', down: !!down, code: String(code).slice(0, 40) });
    if (down) this.held.add(code); else this.held.delete(code);
    return true;
  }

  /** A value was edited by hand (in the inspector). It is part of the recording, so a replay makes the same edit at the same moment. */
  edit(state, path, value) {
    if (this.mode === 'replay') return false;
    if (!setPath(state, path, value, true)) return false;                          // only recorded if it will apply
    this.#insert({ at: this.tick, k: 'edit', path: [...path], value });
    setPath(state, path, value);
    return true;
  }

  /** Run one tick of the game. */
  step(state, update) {
    while (this.cursor < this.events.length && this.events[this.cursor].at <= this.tick) this.#apply(state, this.events[this.cursor++]);
    update(state, this.held, this.dt);
    this.tick++;
    if (this.tick > this.maxTick) this.maxTick = this.tick;
    if (this.tick % this.every === 0 && this.mode !== 'verify') this.#sample(state);
    if (this.mode === 'replay' && this.tick >= this.maxTick) this.#endReplay();
  }

  /** A copy is due at this tick: keep one, or (re-running a moment) check that the state is what it was. */
  #sample(state) {
    const have = this.snapshots.find((s) => s.tick === this.tick);
    if (!have) { this.#snapshot(state); return; }
    if (have.run === this.run && have.hash !== hashState(state) && !this.diverged) this.diverged = { tick: this.tick };
    if (this.mode === 'replay') {                                                   // keep the newest result of the re-run
      have.state = clone(state); have.hash = hashState(state); have.run = this.run; have.held = [...this.held]; have.eventIndex = this.cursor;
    }
  }

  #endReplay() {
    this.mode = 'live';
    this.paused = true;
    this.replayEnded = true;
  }

  /**
   * Go to a tick and return the state there (the game is not changed until you use the state). Going forward continues from the current state;
   * going back restores the nearest copy before it and runs forward.
   * @param {any} state the current state
   * @param {number} target
   * @param {(state: any, keys: Set<string>, dt: number) => void} update
   * @returns {any} the state at the tick it arrived at
   */
  seek(state, target, update) {
    const { from, to } = this.range;
    const goal = Math.max(from, Math.min(to, Math.trunc(target)));
    let at = state;
    if (goal < this.tick) {
      let at0 = -1;
      this.snapshots.forEach((s, i) => { if (s.tick <= goal) at0 = i; });
      if (at0 < 0) return state;
      // start one copy earlier when there is one, so the run to the goal crosses a copy and any difference from what was recorded shows
      const snap = this.snapshots[Math.max(0, at0 - 1)];
      at = clone(snap.state);
      this.tick = snap.tick;
      this.held = new Set(snap.held);
      this.cursor = snap.eventIndex;
    }
    const mode = this.mode;
    this.mode = 'resim';                                                             // inputs come from the recording; nothing new is recorded
    while (this.tick < goal) this.step(at, update);
    this.mode = mode === 'replay' ? 'replay' : 'live';
    return at;
  }

  /**
   * Run the recording again from the current tick with the code as it is now, to the end of what was recorded (inputs come from the recording).
   * Where it ends, the timeline is paused: compare it with what happened before.
   */
  startReplay() {
    this.mode = 'replay';
    this.paused = false;
    this.replayEnded = this.tick >= this.maxTick;
    this.diverged = null;
    if (this.replayEnded) this.#endReplay();
  }

  /** Go on live from the current tick, forgetting what was recorded after it. */
  playLive() {
    this.events.length = this.cursor;
    this.snapshots = this.snapshots.filter((s) => s.tick <= this.tick);
    this.maxTick = this.tick;
    this.mode = 'live';
    this.paused = false;
    this.replayEnded = false;
  }

  /** Where the recording stands, for the timeline in the studio. */
  status() {
    return {
      tick: this.tick, from: this.range.from, to: this.maxTick, paused: this.paused, mode: this.mode === 'replay' ? 'replay' : 'live',
      snapshots: this.snapshots.map((s) => s.tick), edits: this.events.filter((e) => e.k === 'edit').map((e) => e.at),
      diverged: this.diverged, replayEnded: this.replayEnded, bytes: this.snapshots.length * this.stateBytes * 2,
    };
  }

  /** Everything needed to reproduce what was recorded, as plain data (a file you can share). */
  exportReplay() {
    const first = this.snapshots[0];
    if (!first) return null;
    return {
      format: 'engine-replay', version: 1, tickRate: TICK_RATE, every: this.every,
      start: { tick: first.tick, state: clone(first.state), held: [...first.held] },
      events: clone(this.events.slice(first.eventIndex)),
      endTick: this.maxTick,
      checkpoints: this.snapshots.map((s) => [s.tick, s.hash]),
    };
  }

  /**
   * A timeline holding an exported recording, paused at its start.
   * @param {object} replay a checked replay (see {@link checkReplay})
   * @returns {{timeline: Timeline, state: any}}
   */
  static fromReplay(replay, options = {}) {
    const t = new Timeline({ ...options, snapshotEvery: replay.every });
    const state = clone(replay.start.state);
    t.reset(null, { tick: replay.start.tick, held: replay.start.held });
    t.events = clone(replay.events);
    t.maxTick = replay.endTick;
    t.snapshots.push({ tick: replay.start.tick, state: clone(state), held: [...replay.start.held], eventIndex: 0, hash: hashState(state), run: 0 });
    t.expected = new Map(replay.checkpoints);
    t.paused = true;
    return { timeline: t, state };
  }
}

/**
 * Run an exported recording again from its start and check every checksum.
 * @param {object} replay a checked replay
 * @param {(state: any, keys: Set<string>, dt: number) => void} update the game's update function
 * @returns {{ok: boolean, ticks: number, divergedAt: number | null, checked: number}}
 */
export function verifyReplay(replay, update) {
  const { timeline: t, state } = Timeline.fromReplay(replay);
  let checked = 0;
  let divergedAt = null;
  t.mode = 'verify';
  while (t.tick < replay.endTick) {
    t.step(state, update);
    const want = t.expected.get(t.tick);
    if (want !== undefined && t.tick !== replay.start.tick) {
      checked++;
      if (hashState(state) !== want) { divergedAt = t.tick; break; }
    }
  }
  return { ok: divergedAt === null, ticks: t.tick - replay.start.tick, divergedAt, checked };
}

const LIMITS = { events: 200_000, checkpoints: 20_000, stateJson: 5_000_000, files: 400, fileBytes: 2_000_000, tick: 1e9 };

/**
 * Check a replay that came from outside (a file somebody sent) and return a clean copy, or throw an Error that says what is wrong.
 * @param {unknown} data
 * @returns {{format: 'engine-replay', version: 1, tickRate: number, every: number, start: {tick: number, state: any, held: string[]},
 *   events: TimeEvent[], endTick: number, checkpoints: [number, string][], files?: Record<string, string>, name?: string}}
 */
export function checkReplay(data) {
  const bad = (why) => { throw new Error(`This is not a replay this studio can use: ${why}.`); };
  if (!data || typeof data !== 'object' || data.format !== 'engine-replay') bad('it is not a replay file');
  if (data.version !== 1) bad(`it is version ${String(data.version)} and this studio reads version 1`);
  const tick = (v, what) => (Number.isInteger(v) && v >= 0 && v <= LIMITS.tick ? v : bad(`${what} is not a tick number`));
  const every = Number.isInteger(data.every) && data.every >= 1 && data.every <= 100_000 ? data.every : bad('the checkpoint spacing is wrong');
  const start = data.start;
  if (!start || typeof start !== 'object') bad('it has no starting state');
  const json = JSON.stringify(start.state);
  if (json === undefined || json.length > LIMITS.stateJson) bad('the starting state is missing or too big');
  const keysOk = Array.isArray(start.held) && start.held.length < 50 && start.held.every((k) => typeof k === 'string' && k.length < 40);
  const held = keysOk ? [...start.held] : bad('the held keys are wrong');
  if (!Array.isArray(data.events) || data.events.length > LIMITS.events) bad('the list of inputs is missing or too long');
  let last = 0;
  const events = data.events.map((e, i) => {
    if (!e || typeof e !== 'object') bad(`input ${i + 1} is not an object`);
    const at = tick(e.at, `the time of input ${i + 1}`);
    if (at < last) bad('the inputs are not in time order');
    last = at;
    if (e.k === 'key') {
      if (typeof e.down !== 'boolean' || typeof e.code !== 'string' || e.code.length >= 40) bad(`key input ${i + 1} is wrong`);
      return { at, k: 'key', down: e.down, code: e.code };
    }
    if (e.k === 'edit') {
      if (!validPath(e.path)) bad(`edit ${i + 1} has an unsafe path`);
      const plain = e.value === null || ['string', 'boolean'].includes(typeof e.value) || (typeof e.value === 'number' && Number.isFinite(e.value));
      if (!plain) bad(`edit ${i + 1} has an unsupported value`);
      return { at, k: 'edit', path: [...e.path], value: e.value };
    }
    return bad(`input ${i + 1} is of an unknown kind`);
  });
  const endTick = tick(data.endTick, 'the end');
  if (!Array.isArray(data.checkpoints) || data.checkpoints.length > LIMITS.checkpoints) bad('the checkpoints are missing or too many');
  const checkpoints = data.checkpoints.map((c, i) => {
    const fine = Array.isArray(c) && Number.isInteger(c[0]) && typeof c[1] === 'string' && /^[0-9a-f]{8}$/.test(c[1]);
    return fine ? [c[0], c[1]] : bad(`checkpoint ${i + 1} is wrong`);
  });
  const out = {
    format: 'engine-replay', version: 1, tickRate: TICK_RATE, every, endTick, checkpoints, events,
    start: { tick: tick(start.tick, 'the start'), state: JSON.parse(json), held },
  };
  if (data.files !== undefined) {
    const entries = data.files && typeof data.files === 'object' ? Object.entries(data.files) : bad('the files are wrong');
    if (entries.length > LIMITS.files) bad('it has too many files');
    let total = 0;
    out.files = {};
    for (const [path, text] of entries) {
      const unsafe = path.length > 200 || /(^|\/)\.\.(\/|$)|^\/|\\|\0/.test(path);
      if (typeof text !== 'string' || unsafe) bad(`the file "${path.slice(0, 40)}" is not allowed`);
      total += text.length;
      if (total > LIMITS.fileBytes) bad('the files are too big');
      out.files[path] = text;
    }
  }
  if (typeof data.name === 'string') out.name = data.name.slice(0, 100);
  return out;
}
