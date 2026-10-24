import { Animation, BLEND } from './animation.js';

/**
 * Playing animations: tracks, crossfades, queues and events.
 *
 * A **track** plays one animation at a time. Track 0 is usually the body (idle, walk, jump); higher tracks are layered on top (a wave, a hit flash, a mouth), each with an `alpha`
 * and a blend: `replace` pulls the pose toward the animation, `add` adds its change on top. Starting a new animation on a track crossfades from the old one over the *mix* time, and
 * only the things both animate are blended: what only the old one moved eases back to the rest pose, what only the new one moves eases in.
 *
 * ```js
 * const state = new AnimationState(data, { defaultMix: 0.2 });
 * state.setAnimation(0, 'idle', { loop: true });
 * state.addAnimation(1, 'wave', { delay: 1 });
 * state.on('event', (entry, e) => { if (e.name === 'footstep') playStep(); });
 * // each frame:
 * state.update(dt); state.apply(skeleton); skeleton.updateWorldTransform();
 * ```
 */

const EMPTY = new Animation('<empty>', [], 0);

/** One animation playing (or waiting) on a track. Change `timeScale`, `alpha`, `blend` or `time` to steer it. */
export class TrackEntry {
  /** @param {Animation} animation @param {number} track @param {boolean} loop */
  constructor(animation, track, loop) {
    this.animation = animation; this.track = track; this.loop = loop;
    /** Seconds into the animation now, and a moment ago. */ this.time = 0; this.lastTime = -1;
    /** Speed (1 normal, 0.5 half, negative is not supported). */ this.timeScale = 1;
    /** How strongly it shows, 0..1. */ this.alpha = 1;
    /** `'replace'` or `'add'`. */ this.blend = BLEND.replace;
    /** How far through the crossfade from the previous animation (`from`) it is, and how long that takes. */ this.mixTime = 0; this.mixDuration = 0;
    /** @type {TrackEntry | null} */ this.from = null;
    /** @type {TrackEntry | null} */ this.next = null;
    /** Seconds after the one before ends (or, for a loop, finishes its pass) before this one starts. */ this.delay = 0;
    /** The track is cleared when the time reaches this. */ this.trackEnd = Infinity;
    this.clearWhenMixed = false; this.passes = 0;
    /** When (in the time of the entry before it) a queued entry starts; worked out the first time it is checked. @type {number | undefined} */ this.startAt = undefined;
  }
  /** Is this the animation that has finished playing (non-looping and at its end)? */
  get finished() { return !this.loop && this.time >= this.animation.duration; }
}

/** The tracks of one skeleton's animations: what plays, what waits, what is crossfading. One state poses any `Skeleton` made from the same data. */
export class AnimationState {
  /** @param {import('./loader.js').SkeletonData} data @param {{defaultMix?: number}} [o] `defaultMix`: crossfade seconds when nothing more specific is set. */
  constructor(data, { defaultMix = 0 } = {}) {
    this.data = data; this.defaultMix = defaultMix;
    /** @type {(TrackEntry | null)[]} */ this.tracks = [];
    /** Speed of everything: 1 normal. */ this.timeScale = 1;
    this.mixes = new Map();
    this.listeners = { start: [], end: [], complete: [], event: [], interrupt: [] };
  }

  /** Subscribe: `'start'`, `'end'` (left the track), `'interrupt'` (replaced by another), `'complete'` (a pass through finished), `'event'`. The callback gets `(entry, event?)`. Returns a function that unsubscribes. @param {string} type @param {(entry: TrackEntry, event?: object) => void} fn */
  on(type, fn) {
    const list = this.listeners[type];
    if (!list) throw new Error(`unknown listener type "${type}"`);
    list.push(fn);
    return () => { const i = list.indexOf(fn); if (i >= 0) list.splice(i, 1); };
  }
  #emit(type, entry, event) { for (const fn of this.listeners[type].slice()) fn(entry, event); }

  /** Crossfade time (seconds) between two named animations, replacing the default. @param {string} from @param {string} to @param {number} seconds */
  setMix(from, to, seconds) { this.mixes.set(`${from}>${to}`, seconds); }
  getMix(from, to) { return this.mixes.get(`${from}>${to}`) ?? this.defaultMix; }

  #resolve(a) { return a instanceof Animation ? a : this.data.animation(a); }

  /**
   * Play an animation on a track now, crossfading from what was there.
   * @param {number} track @param {string | Animation} animation
   * @param {{loop?: boolean, mix?: number, alpha?: number, blend?: 'replace' | 'add', timeScale?: number, trackEnd?: number}} [o]
   * @returns {TrackEntry}
   */
  setAnimation(track, animation, { loop = false, mix, alpha = 1, blend = BLEND.replace, timeScale = 1, trackEnd = Infinity } = {}) {
    const anim = this.#resolve(animation), entry = new TrackEntry(anim, track, loop);
    Object.assign(entry, { alpha, blend, timeScale, trackEnd });
    const current = this.tracks[track];
    if (current) {
      const m = mix ?? this.getMix(current.animation.name, anim.name);
      this.#emit('interrupt', current);
      if (m > 0) { current.from = null; current.next = null; entry.from = current; entry.mixDuration = m; } else this.#emit('end', current);
    }
    this.tracks[track] = entry;
    this.#emit('start', entry);
    return entry;
  }

  /**
   * Queue an animation after the one playing (and after anything already queued). It starts `delay` seconds after the one before finishes, less the crossfade, so they overlap.
   * @param {number} track @param {string | Animation} animation @param {{loop?: boolean, delay?: number, mix?: number, alpha?: number, blend?: 'replace' | 'add', timeScale?: number}} [o]
   */
  addAnimation(track, animation, { loop = false, delay = 0, mix, alpha = 1, blend = BLEND.replace, timeScale = 1 } = {}) {
    let last = this.tracks[track];
    if (!last) return this.setAnimation(track, animation, { loop, mix, alpha, blend, timeScale });
    while (last.next) last = last.next;
    const anim = this.#resolve(animation), entry = new TrackEntry(anim, track, loop);
    Object.assign(entry, { alpha, blend, timeScale, delay, mixDuration: mix ?? this.getMix(last.animation.name, anim.name) });
    last.next = entry;
    return entry;
  }

  /** Fade a track out to nothing over `mix` seconds, then clear it. @param {number} track @param {number} [mix] */
  setEmptyAnimation(track, mix = 0.2) {
    const entry = this.setAnimation(track, EMPTY, { mix });
    entry.clearWhenMixed = true;
    if (!entry.from) this.clearTrack(track);
    return entry;
  }

  /** Stop a track at once, leaving the pose to whatever else is playing. @param {number} track */
  clearTrack(track) {
    const e = this.tracks[track];
    if (!e) return;
    this.#emit('end', e);
    this.tracks[track] = null;
  }
  clearTracks() { for (let i = 0; i < this.tracks.length; i++) this.clearTrack(i); this.tracks.length = 0; }
  /** What is playing on a track, if anything. @param {number} track */
  getCurrent(track) { return this.tracks[track] ?? null; }

  /**
   * Move time forward: advance the animations and crossfades, start queued ones, call the listeners. Returns the events that fired.
   * @param {number} dt Seconds. @returns {object[]}
   */
  update(dt) {
    dt *= this.timeScale;
    const fired = [];
    for (let t = 0; t < this.tracks.length; t++) {
      const e = this.tracks[t];
      if (e) this.#advance(e, dt, fired, true);
    }
    return fired;
  }

  #advance(e, dt, fired, top) {
    e.lastTime = e.time;
    e.time += dt * e.timeScale;
    const events = e.animation.collectEvents(e.lastTime, e.time, e.loop);
    for (const ev of events) { fired.push(ev); this.#emit('event', e, ev); }
    const d = e.animation.duration;
    if (e.loop ? d > 0 && Math.floor(e.time / d) > Math.floor(Math.max(0, e.lastTime) / d) : e.lastTime < d && e.time >= d) { e.passes++; this.#emit('complete', e); }
    if (e.from) {
      e.mixTime += dt;
      this.#advance(e.from, dt, fired, false);
      if (e.mixTime >= e.mixDuration) { this.#emit('end', e.from); e.from = null; }
    }
    if (!top) return;
    if (e.clearWhenMixed && !e.from) { this.clearTrack(e.track); return; }
    if (e.time >= e.trackEnd) { this.clearTrack(e.track); return; }
    const n = e.next;
    if (n) {
      const dur = e.animation.duration;
      if (n.startAt === undefined) n.startAt = (e.loop && dur > 0 ? (Math.floor(Math.max(0, e.lastTime) / dur) + 1) * dur : dur) - n.mixDuration + n.delay;   // worked out once, when it first gets a chance
      if (e.time >= n.startAt) {
        e.next = null;
        n.from = n.mixDuration > 0 ? e : null;
        if (n.from) { e.from = null; this.#emit('interrupt', e); } else this.#emit('end', e);
        n.time = Math.max(0, e.time - n.startAt); n.lastTime = -1;
        this.tracks[e.track] = n;
        this.#emit('start', n);
      }
    }
  }

  /**
   * Pose a skeleton from the tracks: it is set to its setup pose, then each track in order is applied on top. Call `skeleton.updateWorldTransform()` afterwards.
   * @param {import('./skeleton.js').Skeleton} skeleton
   */
  apply(skeleton) {
    skeleton.setToSetupPose();
    for (const e of this.tracks) {
      if (!e) continue;
      if (e.from && e.mixDuration > 0) {
        const m = Math.min(1, e.mixTime / e.mixDuration), from = e.from, shared = e.animation.keys;
        from.animation.apply(skeleton, from.time, e.alpha, e.blend, from.loop, shared, false);            // what both animate: the old one at full strength, then the new one blended over it
        from.animation.apply(skeleton, from.time, e.alpha * (1 - m), e.blend, from.loop, shared, true);    // what only the old one animates fades back to the rest pose
        e.animation.apply(skeleton, e.time, e.alpha * m, e.blend, e.loop);
      } else e.animation.apply(skeleton, e.time, e.alpha, e.blend, e.loop);
    }
    return skeleton;
  }
}
