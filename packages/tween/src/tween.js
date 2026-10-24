// Tweens: move numbers (or lists of numbers) on any object from one value to another over time, with an easing, a delay, repeats and yoyo.
// A tween is a pure function of its own clock: `seek(t)` puts every property exactly where it belongs at time t, and `update(dt)` moves the clock on and
// tells you about it (start, repeat, update, complete). Only + - * / and sqrt are used, so a tween inside a deterministic game replays bit for bit.
import { resolveEase } from './easing.js';

const finite = (n) => typeof n === 'number' && Number.isFinite(n);

/**
 * Where a clock is within a repeating animation. Fills `out`: `active` (the delay has passed), `cycle` (0 is the first play), `local` (seconds into this
 * play, 0..duration), `eff` (the same but backwards on a yoyo's return trips), `done` (every repeat is over).
 */
export function locate(out, t, delay, duration, repeat, repeatDelay, yoyo) {
  const u = t - delay;
  out.active = u >= 0;
  out.done = false;
  if (u < 0) { out.cycle = 0; out.local = 0; out.eff = 0; return out; }
  const span = duration + repeatDelay;
  let cycle = span > 0 ? Math.floor(u / span) : (repeat < 0 ? 0 : repeat);
  if (repeat >= 0 && cycle > repeat) cycle = repeat;
  let local = u - cycle * span;
  if (local > duration) local = duration;
  if (repeat >= 0 && cycle >= repeat && u >= repeat * span + duration) { out.done = true; local = duration; }
  out.cycle = cycle; out.local = local;
  out.eff = yoyo && (cycle & 1) === 1 ? duration - local : local;
  return out;
}

const totalOf = (delay, duration, repeat, repeatDelay) => (repeat < 0 ? Infinity : delay + duration * (repeat + 1) + repeatDelay * repeat);

/** What a tween or a timeline has in common: a clock, a speed, pause and kill, and the callbacks. */
class Animation {
  constructor(o) {
    /** Seconds on this animation's own clock (before its delay counts too). */
    this.time = 0;
    this.timeScale = o.timeScale ?? 1;
    this.paused = !!o.paused;
    this.delay = o.delay ?? 0;
    this.repeat = o.repeat ?? 0;
    this.repeatDelay = o.repeatDelay ?? 0;
    this.yoyo = !!o.yoyo;
    this.onStart = o.onStart ?? null; this.onUpdate = o.onUpdate ?? null; this.onRepeat = o.onRepeat ?? null; this.onComplete = o.onComplete ?? null;
    /** True once every play and repeat is over. */
    this.done = false;
    this.killed = false;
    this._last = -1;
    this._startFired = false;
    if (!(this.delay >= 0) || !finite(this.delay)) throw new Error('delay must be 0 or more seconds');
    if (!(this.repeatDelay >= 0) || !finite(this.repeatDelay)) throw new Error('repeatDelay must be 0 or more seconds');
    if (!Number.isInteger(this.repeat)) throw new Error('repeat is a whole number of extra plays (-1 for forever)');
  }

  /** Seconds of one play (without delay or repeats). */
  get duration() { return 0; }

  /** Seconds from the start through the delay and every repeat (Infinity for forever). */
  get totalDuration() { return totalOf(this.delay, this.duration, this.repeat, this.repeatDelay); }

  /** How far through (0..1) including repeats; 0 for something that repeats forever. */
  get progress() { const d = this.totalDuration; return d > 0 && d !== Infinity ? Math.min(1, this.time / d) : (this.done ? 1 : 0); }
  set progress(p) { this.seek(p * this.totalDuration); }

  /** Stop moving the clock (the values stay where they are). */
  pause() { this.paused = true; return this; }
  /** Carry on after `pause`. */
  resume() { this.paused = false; return this; }
  /** Stop for good: a manager drops it, the values stay where they are. */
  kill() { this.killed = true; return this; }

  /** Go back to the start and play again (the starting values found the first time are kept, so it plays the same motion). */
  restart() { this.reset(); this.paused = false; this.seek(0, false); return this; }

  /** Forget how far it got, without moving anything. */
  reset() { this.time = 0; this._last = -1; this.done = false; this.killed = false; this._startFired = false; }

  /** Put everything back as before it began and forget that it ever started (a timeline does this to what it has not reached yet, after a rewind). */
  unreach() { if (this._last < 0) return; this.seek(0, false); this.reset(); }

  /** Move the clock on by `dt` seconds (times `timeScale`), setting values and calling the callbacks. A manager calls this for you. */
  update(dt) {
    if (this.paused || this.done || this.killed) return;
    this.seek(this.time + dt * this.timeScale, true);
  }

  /** Put the clock at `t` seconds. With `events` the callbacks for what was passed are called (only going forward); without, it moves silently. */
  seek(t, events = false) { throw new Error(`${this.constructor.name} has no seek`); }

  /** Does this animation (or anything inside it) move `target`? */
  uses(target) { return false; }
}

const SC0 = {}, SC1 = {};

/** One property being tweened: where it lives, and the numbers it goes between. */
function parseValue(v, base, key) {
  if (typeof v === 'string') {
    const m = /^([+-])=(-?\d*\.?\d+(?:e[+-]?\d+)?)$/i.exec(v.trim());
    if (!m || !finite(base)) throw new Error(`"${v}" for ${key}: relative values look like "+=10" or "-=2.5" and need a number to start from`);
    return m[1] === '+' ? base + Number(m[2]) : base - Number(m[2]);
  }
  if (Array.isArray(v)) {
    if (!Array.isArray(base) || base.length !== v.length) throw new Error(`${key}: a list of ${v.length} numbers needs a list of ${v.length} numbers to start from`);
    return v.map((x, i) => parseValue(x, base[i], `${key}[${i}]`));
  }
  if (!finite(v)) throw new Error(`${key} must go to a number (got ${v})`);
  return v;
}

const resolve = (target, key) => {
  let holder = target;
  const parts = key.split('.');
  for (let i = 0; i < parts.length - 1; i++) {
    holder = holder?.[parts[i]];
    if (holder === null || typeof holder !== 'object') throw new Error(`cannot tween "${key}": "${parts.slice(0, i + 1).join('.')}" is not an object`);
  }
  return [holder, parts[parts.length - 1]];
};

const asNumbers = (v, key) => {
  if (Array.isArray(v) || ArrayBuffer.isView(v)) return Array.from(v);
  if (!finite(v)) throw new Error(`cannot tween "${key}": it is ${typeof v === 'number' ? v : typeof v}, not a number or a list of numbers`);
  return v;
};

/**
 * Moves properties of `target` to new values. Make them with `Tweens.to(...)` (which also plays them), or directly and call `update(dt)` yourself.
 * Properties may be dotted paths (`'position.x'`), numbers, lists of numbers (`[r, g, b]` are tweened in place, also typed arrays), and relative (`'+=50'`).
 */
export class Tween extends Animation {
  /**
   * @param {object} target
   * @param {{ to?: object, from?: object }} props `to` only: from where it is now; `from` only: from these to where it is now; both: between them.
   * @param {object} [o]
   * @param {number} [o.duration] Seconds (0.5). @param {number} [o.delay] Seconds before it starts (0).
   * @param {import('./easing.js').EaseSpec} [o.ease] A name like `'cubicOut'`, a function of 0..1, or four numbers for a bezier (linear).
   * @param {number} [o.repeat] Extra plays (0); -1 for forever. @param {number} [o.repeatDelay] Seconds between plays. @param {boolean} [o.yoyo] Every second play runs backwards.
   * @param {number} [o.timeScale] Speed (1). @param {boolean} [o.paused]
   * @param {(t: Tween) => void} [o.onStart] Once, when the delay is over. @param {(t: Tween) => void} [o.onUpdate] @param {(t: Tween) => void} [o.onRepeat] @param {(t: Tween) => void} [o.onComplete]
   */
  constructor(target, props, o = {}) {
    super(o);
    if (target === null || typeof target !== 'object') throw new Error('a tween needs an object to move');
    if (!props || (!props.to && !props.from)) throw new Error('a tween needs `to` and/or `from` values');
    this.target = target;
    this._to = props.to ?? null; this._from = props.from ?? null;
    this._duration = o.duration ?? 0.5;
    if (!(this._duration >= 0) || !finite(this._duration)) throw new Error('duration must be 0 or more seconds');
    this.ease = resolveEase(o.ease);
    /** @type {{holder: any, key: string, a: any, b: any}[]} */ this._props = [];
    this._captured = false;
    for (const k of Object.keys({ ...this._to, ...this._from })) resolve(target, k);          // a wrong path fails now, not on the first frame
  }

  get duration() { return this._duration; }

  uses(target) { return this.target === target; }

  /** Read the starting values now (when the delay ends), so a tween made early still starts from where the thing is when it begins. */
  _capture() {
    this._captured = true;
    const keys = Object.keys({ ...this._to, ...this._from });
    for (const key of keys) {
      const [holder, k] = resolve(this.target, key);
      const cur = asNumbers(holder[k], key);
      let a, b;
      const hasFrom = this._from && key in this._from, hasTo = this._to && key in this._to;
      if (hasFrom && hasTo) { a = parseValue(this._from[key], cur, key); b = parseValue(this._to[key], a, key); }
      else if (hasFrom) { b = cur; a = parseValue(this._from[key], cur, key); }
      else { a = cur; b = parseValue(this._to[key], cur, key); }
      this._props.push({ holder, key: k, a, b });
    }
  }

  _write(p) {
    for (const pr of this._props) {
      const { holder, key, a, b } = pr;
      if (typeof a === 'number') holder[key] = a + (b - a) * p;
      else { const arr = holder[key]; for (let i = 0; i < a.length; i++) arr[i] = a[i] + (b[i] - a[i]) * p; }
    }
  }

  seek(t, events = false) {
    t = t > 0 ? t : 0;
    const prev = this._last;
    const L = locate(SC1, t, this.delay, this._duration, this.repeat, this.repeatDelay, this.yoyo);
    const active = L.active, cycle = L.cycle, eff = L.eff, finished = L.done;
    let cycle0 = 0;
    if (prev >= 0) cycle0 = locate(SC0, prev, this.delay, this._duration, this.repeat, this.repeatDelay, this.yoyo).cycle;
    this._last = t; this.time = t;
    this.done = finished;
    if (active && !this._captured) this._capture();
    if (this._captured) {
      const p = active ? (this._duration > 0 ? eff / this._duration : 1) : 0;
      this._write(active ? this.ease(p < 0 ? 0 : p > 1 ? 1 : p) : 0);
    }
    if (!events) return;
    const forward = t > prev;
    if (active && !this._startFired) { this._startFired = true; this.onStart?.(this); }
    if (forward && cycle > cycle0) for (let c = cycle0; c < cycle; c++) this.onRepeat?.(this);
    if (active) this.onUpdate?.(this);
    if (finished && forward && !this.killed) {
      const total = this.totalDuration;
      if (prev < total) this.onComplete?.(this);
    }
  }
}

const POSITION = /^(<|>|[A-Za-z_][\w-]*)?(?:([+-])=(\d*\.?\d+))?$/;

/**
 * Several tweens, calls and other timelines laid out on one clock, played, repeated, sped up, paused and sought as one. Items go at the end by default,
 * or at a time (`2`), after a label (`'boom+=0.5'`), relative to the end (`'-=0.3'`, overlapping), or with the previous item (`'<'`, `'<+=0.2'`).
 */
export class Timeline extends Animation {
  /** @param {object} [o] The same `delay`, `repeat`, `repeatDelay`, `yoyo`, `timeScale`, `paused` and callbacks as a tween. */
  constructor(o = {}) {
    super(o);
    /** @type {{item: Animation | null, fn: Function | null, start: number, end: number}[]} */ this.entries = [];
    /** @type {Map<string, number>} */ this.labels = new Map();
    this._duration = 0;
    this._lastStart = 0;
  }

  get duration() { return this._duration; }

  uses(target) { return this.entries.some((e) => e.item?.uses(target)); }

  /** A name for a moment on the timeline, for later items to be placed relative to. */
  label(name, at) {
    this.labels.set(name, this._position(at));
    return this;
  }

  _position(at) {
    if (typeof at === 'number') {
      if (!finite(at) || at < 0) throw new Error('a time on a timeline is 0 or more seconds');
      return at;
    }
    if (at === undefined || at === null) return this._duration;
    const m = POSITION.exec(String(at).trim());
    if (!m) throw new Error(`"${at}" is not a place on a timeline (use a number of seconds, "+=0.5", "-=0.5", "<", "<+=0.2" or "label+=1")`);
    let base;
    if (m[1] === undefined || m[1] === '>') base = this._duration;
    else if (m[1] === '<') base = this._lastStart;
    else if (this.labels.has(m[1])) base = this.labels.get(m[1]);
    else throw new Error(`no label "${m[1]}" on this timeline (labels: ${[...this.labels.keys()].join(', ') || 'none'})`);
    const off = m[3] === undefined ? 0 : (m[2] === '-' ? -1 : 1) * Number(m[3]);
    return Math.max(0, base + off);
  }

  /**
   * Put a tween, a timeline or a function on the timeline. A function is called once as the clock passes its place (every lap of a repeat).
   * @param {Animation | (() => void)} item @param {number | string} [at]
   */
  add(item, at) {
    const start = this._position(at);
    if (typeof item === 'function') {
      const e = { item: null, fn: item, start, end: start };
      this.entries.push(e);
      this._lastStart = start;
      this._duration = Math.max(this._duration, start);
    } else if (item instanceof Animation) {
      const len = item.totalDuration;
      if (len === Infinity) throw new Error('a timeline cannot hold something that repeats forever; give it a number of repeats');
      this.entries.push({ item, fn: null, start, end: start + len });
      this._lastStart = start;
      this._duration = Math.max(this._duration, start + len);
    } else throw new Error('add a Tween, a Timeline or a function');
    this.entries.sort((x, y) => x.start - y.start);       // stable: items at the same time keep the order they were added in
    return this;
  }

  /** Tween properties of `target` to values: `timeline.to(box, { x: 100 }, { duration: 1 }, '+=0.2')`. */
  to(target, to, o, at) { return this.add(new Tween(target, { to }, o), at); }
  /** Tween properties of `target` from values to where they are when it starts. */
  from(target, from, o, at) { return this.add(new Tween(target, { from }, o), at); }
  /** Tween properties of `target` between two sets of values. */
  fromTo(target, from, to, o, at) { return this.add(new Tween(target, { from, to }, o), at); }
  /** Call a function as the clock passes `at`. */
  call(fn, at) { return this.add(fn, at); }
  /** Leave a gap of `seconds` after everything so far. */
  wait(seconds) { this._duration += seconds; return this; }

  seek(t, events = false) {
    t = t > 0 ? t : 0;
    const prev = this._last;
    const dur = this._duration;
    const L = locate(SC1, t, this.delay, dur, this.repeat, this.repeatDelay, this.yoyo);
    const active = L.active, cycle1 = L.cycle, eff1 = L.eff, finished = L.done;
    let cycle0 = 0, eff0 = 0;
    if (prev >= 0) { const P = locate(SC0, prev, this.delay, dur, this.repeat, this.repeatDelay, this.yoyo); cycle0 = P.cycle; eff0 = P.eff; }
    this._last = t; this.time = t;
    this.done = finished;
    const forward = events && t > prev;
    if (!active) {
      if (prev >= this.delay) { for (let i = this.entries.length - 1; i >= 0; i--) this.entries[i].item?.unreach(); }
      return;
    }
    if (events && !this._startFired) { this._startFired = true; this.onStart?.(this); }
    if (!forward) { this.#children(eff1, false); if (events) this.onUpdate?.(this); return; }
    // going forward, lap by lap (a very long step over a long repeat only plays the last 64 laps)
    let first = cycle0;
    if (cycle1 - cycle0 > 64) first = cycle1 - 64;
    const wasBefore = prev < this.delay;                       // the first moment after the delay includes things placed at time 0
    const resume = !wasBefore && first === cycle0;             // carrying on inside a lap that was already under way
    for (let c = first; c <= cycle1; c++) {
      const reversed = this.yoyo && (c & 1) === 1;
      const startAt = reversed ? dur : 0, endAt = reversed ? 0 : dur;
      const carry = c === cycle0 && resume;
      const from = carry ? eff0 : startAt;
      const to = c === cycle1 ? eff1 : endAt;
      const inclusive = !carry;
      this.#fire(from, to, inclusive);
      this.#children(to, true);
      if (c < cycle1) this.onRepeat?.(this);
    }
    this.onUpdate?.(this);
    if (finished && prev < this.totalDuration && !this.killed) this.onComplete?.(this);
  }

  #fire(from, to, inclusive) {
    const es = this.entries;
    if (from <= to) {
      for (let i = 0; i < es.length; i++) {
        const e = es[i];
        if (e.fn && (inclusive ? e.start >= from : e.start > from) && e.start <= to) e.fn(this);
      }
    } else {
      for (let i = es.length - 1; i >= 0; i--) {
        const e = es[i];
        if (e.fn && (inclusive ? e.start <= from : e.start < from) && e.start >= to) e.fn(this);
      }
    }
  }

  #children(x, events) {
    const es = this.entries;
    for (let i = es.length - 1; i >= 0; i--) {                 // what a rewind left ahead of the clock goes back first, last-placed first
      const e = es[i];
      if (e.item && x < e.start && e.item._last >= 0) e.item.unreach();
    }
    for (let i = 0; i < es.length; i++) {
      const e = es[i];
      if (!e.item || x < e.start) continue;
      const len = e.end - e.start, local = x - e.start;
      e.item.seek(local > len ? len : local, events);
    }
  }

  reset() {
    super.reset();
    for (const e of this.entries) e.item?.reset();
  }
}

/**
 * Plays tweens and timelines: make them with `to`, `from`, `fromTo` or `timeline`, then call `update(dt)` once per step. Finished and killed ones are dropped.
 *
 * ```js
 * const tweens = new Tweens();
 * tweens.to(box, { x: 300, 'scale.y': 2 }, { duration: 1, ease: 'elasticOut', onComplete: () => spawnDust() });
 * tweens.timeline().to(a, { y: 0 }, { duration: 0.3 }).call(playSound).to(b, { alpha: 1 }, { duration: 0.2 }, '-=0.1');
 * // each step:  tweens.update(1 / 60);
 * ```
 */
export class Tweens {
  constructor() {
    /** @type {Animation[]} */ this.items = [];
    /** Speed of everything here (1 normal, 0.5 slow motion). */
    this.timeScale = 1;
    /** Stops everything without losing their places. */
    this.paused = false;
  }

  /** How many are playing or waiting. */
  get count() { return this.items.length; }

  /** Play a tween or timeline you made yourself. */
  add(anim) { if (!this.items.includes(anim)) this.items.push(anim); return anim; }

  /** Move properties of `target` to values. See `Tween` for the options. */
  to(target, to, o) { return this.add(new Tween(target, { to }, o)); }
  /** Move properties of `target` from values to where they are when it starts. */
  from(target, from, o) { return this.add(new Tween(target, { from }, o)); }
  /** Move properties of `target` between two sets of values. */
  fromTo(target, from, to, o) { return this.add(new Tween(target, { from, to }, o)); }
  /** A new timeline that this plays. */
  timeline(o) { return this.add(new Timeline(o)); }

  /** Stop and drop every tween that moves `target` (timelines holding one are dropped whole). Returns how many went. */
  killTweensOf(target) {
    let n = 0;
    for (const a of this.items) if (a.uses(target)) { a.kill(); n++; }
    this.items = this.items.filter((a) => !a.killed);
    return n;
  }

  /** Stop and drop everything. */
  killAll() { for (const a of this.items) a.kill(); this.items = []; }

  /** Move every animation on by `dt` seconds. */
  update(dt) {
    if (this.paused) return;
    const d = dt * this.timeScale;
    for (const a of [...this.items]) a.update(d);
    if (this.items.some((a) => a.done || a.killed)) this.items = this.items.filter((a) => !a.done && !a.killed);
  }
}
