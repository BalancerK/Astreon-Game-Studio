import { mat4, quat } from '../../math/src/index.js';

/**
 * Skeletal animation: a joint hierarchy, keyframed clips, poses you can blend, and the palette of skinning matrices the
 * renderers turn into a deformed mesh (see `createSkinnedMesh` and `DrawList3D.addSkinned`).
 *
 * Presentation only: this runs on clients, never inside the shared deterministic simulation, so it may use ordinary maths.
 * Conventions match the engine (right-handed, +y up, column-major matrices, quaternions as [x, y, z, w]).
 */

/** A joint hierarchy (any order; parents may come after children). `t`, `r`, `s` are the local rest translation, rotation and scale. */
export class Skeleton {
  /**
   * @param {{name?: string, parent: number, t?: ArrayLike<number>, r?: ArrayLike<number>, s?: ArrayLike<number>}[]} joints
   * @param {object} [o]
   * @param {ArrayLike<number>} [o.inverseBind] 16 floats per joint (from a glTF skin). Default: the inverse of each joint's rest world matrix.
   * @param {ArrayLike<number>} [o.rootMatrix] Transform of whatever the root joints hang from (default identity).
   */
  constructor(joints, { inverseBind, rootMatrix } = {}) {
    const n = joints.length;
    if (n === 0 || n > 255) throw new Error(`a skeleton needs 1 to 255 joints (got ${n})`);
    this.count = n;
    this.names = joints.map((j, i) => j.name ?? `joint${i}`);
    this.parents = new Int16Array(n);
    this.restT = new Float32Array(n * 3);
    this.restR = new Float32Array(n * 4);
    this.restS = new Float32Array(n * 3);
    joints.forEach((j, i) => {
      if (!Number.isInteger(j.parent) || j.parent < -1 || j.parent >= n || j.parent === i) throw new Error(`joint ${i} ("${this.names[i]}") has an invalid parent (${j.parent})`);
      this.parents[i] = j.parent;
      this.restT.set(j.t ?? [0, 0, 0], i * 3);
      this.restR.set(j.r ?? [0, 0, 0, 1], i * 4);
      this.restS.set(j.s ?? [1, 1, 1], i * 3);
    });
    // evaluation order: every joint after its parent (and a check that the hierarchy has no loop)
    this.order = new Int16Array(n);
    {
      const done = new Uint8Array(n);
      let m = 0;
      for (let pass = 0; m < n; pass++) {
        if (pass > n) throw new Error('the joint hierarchy contains a loop');
        for (let i = 0; i < n; i++) if (!done[i] && (this.parents[i] < 0 || done[this.parents[i]])) { done[i] = 1; this.order[m++] = i; }
      }
    }
    this.rootMatrix = Float64Array.from(rootMatrix ?? mat4.identity(new Float64Array(16)));
    this.world = new Float64Array(n * 16); // scratch: joint world matrices of the last palette computation
    this.local = new Float64Array(16);
    this.product = new Float64Array(16);
    this.inverseBind = new Float64Array(n * 16);
    if (inverseBind) {
      if (inverseBind.length !== n * 16) throw new Error('inverseBind needs 16 floats per joint');
      this.inverseBind.set(inverseBind);
    } else {
      this.#computeWorld(this.createPose().setRest(this));
      const tmp = new Float64Array(16);
      for (let i = 0; i < n; i++) { mat4.invert(tmp, this.world.subarray(i * 16, i * 16 + 16)); this.inverseBind.set(tmp, i * 16); }
    }
  }

  indexOf(name) { return this.names.indexOf(name); }

  createPose() { return new Pose(this.count); }

  #computeWorld(pose) {
    const { count, parents, world, local, order } = this;
    for (let o = 0; o < count; o++) {
      const i = order[o];
      mat4.compose(local, pose.t[i * 3], pose.t[i * 3 + 1], pose.t[i * 3 + 2], pose.r.subarray(i * 4, i * 4 + 4), pose.s[i * 3], pose.s[i * 3 + 1], pose.s[i * 3 + 2]);
      const w = world.subarray(i * 16, i * 16 + 16);
      mat4.multiply(w, parents[i] >= 0 ? world.subarray(parents[i] * 16, parents[i] * 16 + 16) : this.rootMatrix, local);
    }
  }

  /**
   * The skinning matrices of a pose: for each joint, its world matrix times its inverse bind matrix. These go into the
   * `palette` of `DrawList3D.addSkinned`.
   * @param {Pose} pose
   * @param {Float32Array} [out] At least `offset + count * 16` floats (default: a new array)
   * @param {number} [offset] First float to write
   */
  computePalette(pose, out = new Float32Array(this.count * 16), offset = 0) {
    this.#computeWorld(pose);
    const { product, world, inverseBind } = this;
    for (let i = 0; i < this.count; i++) {
      mat4.multiply(product, world.subarray(i * 16, i * 16 + 16), inverseBind.subarray(i * 16, i * 16 + 16));
      for (let k = 0; k < 16; k++) out[offset + i * 16 + k] = product[k];
    }
    return out;
  }

  /** World matrix of a joint after the last `computePalette` (a view into scratch memory: copy it to keep it). */
  jointWorld(i) { return this.world.subarray(i * 16, i * 16 + 16); }
}

/** Local translation, rotation and scale of every joint. */
export class Pose {
  constructor(count) {
    this.count = count;
    this.t = new Float32Array(count * 3);
    this.r = new Float32Array(count * 4);
    this.s = new Float32Array(count * 3);
  }

  /** Reset to the skeleton's rest pose. @returns {this} */
  setRest(skeleton) {
    this.t.set(skeleton.restT); this.r.set(skeleton.restR); this.s.set(skeleton.restS);
    return this;
  }

  copy(other) { this.t.set(other.t); this.r.set(other.r); this.s.set(other.s); return this; }
}

/**
 * A keyframed animation. Each track drives one channel of one joint: translation (`t`, 3 values per key), rotation (`r`,
 * 4 values, a quaternion) or scale (`s`). Channels without a track keep the rest pose.
 *
 * @typedef {{joint: number, path: 't' | 'r' | 's', times: ArrayLike<number>, values: ArrayLike<number>, step?: boolean}} Track
 */
export class AnimationClip {
  /**
   * @param {string} name
   * @param {Track[]} tracks Key times in seconds, ascending.
   * @param {object} [o]
   * @param {boolean} [o.loop] Wrap around at the end (default true).
   * @param {number} [o.duration] Default: the latest key time.
   * @param {{time: number, name: string, data?: any}[]} [o.events] Moments to tell the game about (see `addEvent`)
   */
  constructor(name, tracks, { loop = true, duration, events = [] } = {}) {
    this.name = name;
    this.loop = loop;
    /** @type {{time: number, name: string, data: any}[]} Sorted by time. */
    this.events = [];
    for (const e of events) this.addEvent(e.time, e.name, e.data);
    this.tracks = tracks.map((tr) => {
      const size = tr.path === 'r' ? 4 : 3;
      if (!['t', 'r', 's'].includes(tr.path)) throw new Error(`track path must be t, r or s (got ${tr.path})`);
      if (tr.times.length === 0 || tr.values.length !== tr.times.length * size) throw new Error(`track for joint ${tr.joint} ("${tr.path}") has ${tr.times.length} times but ${tr.values.length} values (need ${size} per key)`);
      return { joint: tr.joint, path: tr.path, times: Float32Array.from(tr.times), values: Float32Array.from(tr.values), step: !!tr.step };
    });
    this.duration = duration ?? this.tracks.reduce((m, tr) => Math.max(m, tr.times[tr.times.length - 1]), 0);
  }

  /**
   * Mark a moment of the clip to be reported while it plays: a footstep when the foot lands, a swing's hit frame, a sound cue. An `Animator` calls its `onEvent(name, data, clip)`
   * when the clip's time passes the moment (every lap of a looping clip). Events at the same time fire in the order added.
   * @param {number} time Seconds into the clip (0 to its duration)
   * @param {string} name What to tell the game
   * @param {any} [data] Anything you want handed back
   */
  addEvent(time, name, data = null) {
    if (!(time >= 0)) throw new Error(`an animation event needs a time of 0 or more (got ${time})`);
    if (typeof name !== 'string' || name === '') throw new Error('an animation event needs a name');
    let i = this.events.length;
    while (i > 0 && this.events[i - 1].time > time) i--;
    this.events.splice(i, 0, { time, name, data });
    return this;
  }

  /**
   * Call `fn(event)` for the events a clip's playback passes going from playback time `from` to `to` (forward only): those after `from` up to and including `to`, and also
   * those at `from` itself when `includeStart` (the very first moment of a clip). A looping clip reports every lap it crosses; one that does not loop stops at its end.
   */
  eventsBetween(from, to, fn, includeStart = false) {
    const events = this.events, d = this.duration;
    if (events.length === 0 || !(to > from) && !includeStart) return;
    const within = (lo, hi, inclusive) => {
      for (const e of events) if ((e.time > lo || (inclusive && e.time >= lo)) && e.time <= hi) fn(e);
    };
    if (!this.loop || d <= 0) { within(Math.max(0, Math.min(d, from)), Math.max(0, Math.min(d, to)), includeStart); return; }
    let lap = Math.floor(from / d) * d;
    within(from - lap, Math.min(to, lap + d) - lap, includeStart);
    for (let guard = 0; lap + d <= to; guard++) {                         // each lap boundary reached: the events at 0 start the new lap, then the rest of it
      if (guard > 10000) break;                                           // a huge step over a very short clip: stop rather than loop for ever
      lap += d;
      for (const e of events) if (e.time === 0) fn(e);
      within(0, Math.min(to, lap + d) - lap, false);
    }
  }

  /** Time within the clip for a playback time: wrapped when looping, clamped otherwise. */
  wrap(time) {
    if (this.duration <= 0) return 0;
    if (this.loop) { const t = time % this.duration; return t < 0 ? t + this.duration : t; }
    return Math.max(0, Math.min(this.duration, time));
  }
}

const qa = [0, 0, 0, 1], qb = [0, 0, 0, 1], qo = [0, 0, 0, 1];

/**
 * Evaluate a clip at a time into `out` (starting from the rest pose, so untouched channels stay at rest).
 * @param {Skeleton} skeleton
 * @param {AnimationClip} clip
 * @param {number} time Seconds (wrapped or clamped according to `clip.loop`)
 * @param {Pose} out
 */
export function samplePose(skeleton, clip, time, out) {
  out.setRest(skeleton);
  const at = clip.wrap(time);
  for (const tr of clip.tracks) {
    const { times, values } = tr, n = times.length, size = tr.path === 'r' ? 4 : 3;
    let lo = 0, hi = n; // hi ends as the first key strictly after `at`
    while (lo < hi) { const mid = (lo + hi) >> 1; if (times[mid] > at) hi = mid; else lo = mid + 1; }
    const i0 = Math.max(0, hi - 1), i1 = Math.min(n - 1, hi);
    const span = times[i1] - times[i0];
    const u = tr.step || span <= 0 ? 0 : Math.max(0, Math.min(1, (at - times[i0]) / span));
    const target = tr.path === 't' ? out.t : tr.path === 'r' ? out.r : out.s;
    const o = tr.joint * size;
    if (tr.path === 'r') {
      for (let k = 0; k < 4; k++) { qa[k] = values[i0 * 4 + k]; qb[k] = values[i1 * 4 + k]; }
      quat.nlerp(qo, qa, qb, u);
      for (let k = 0; k < 4; k++) target[o + k] = qo[k];
    } else {
      for (let k = 0; k < size; k++) target[o + k] = values[i0 * size + k] + (values[i1 * size + k] - values[i0 * size + k]) * u;
    }
  }
  return out;
}

/** out = a blended toward b by weight w (0 = a, 1 = b). Rotations take the short way round. `out` may be `a`. */
export function blendPoses(out, a, b, w) {
  for (let i = 0; i < a.t.length; i++) out.t[i] = a.t[i] + (b.t[i] - a.t[i]) * w;
  for (let i = 0; i < a.s.length; i++) out.s[i] = a.s[i] + (b.s[i] - a.s[i]) * w;
  for (let j = 0; j < a.count; j++) {
    for (let k = 0; k < 4; k++) { qa[k] = a.r[j * 4 + k]; qb[k] = b.r[j * 4 + k]; }
    quat.nlerp(qo, qa, qb, w);
    for (let k = 0; k < 4; k++) out.r[j * 4 + k] = qo[k];
  }
  return out;
}

/**
 * Plays one clip at a time and cross-fades when you switch. Call `update(dt)` once per frame, then read `pose`.
 */
export class Animator {
  /**
   * @param {Skeleton} skeleton
   * @param {object} [o]
   * @param {{joint: number | string, axes?: string} | null} [o.rootMotion] Take the movement of a joint (the root, usually) out of the animation and report it as `motion` instead, so the
   *   game moves the character by it and the feet do not slide. `axes` says which to take: 'xz' (default, walking on the ground), 'xyz' or any of x, y, z.
   */
  constructor(skeleton, { rootMotion = null } = {}) {
    this.skeleton = skeleton;
    /** Called when playback passes an event of the current clip: `(name, data, clip)`. */
    this.onEvent = null;
    /** How far the root moved during the last `update`, in the skeleton's own space (x, y, z); all zero without `rootMotion`. Turn it by the character's facing before using it. */
    this.motion = new Float32Array(3);
    this.rootMotion = null;
    if (rootMotion) {
      const joint = typeof rootMotion.joint === 'number' ? rootMotion.joint : skeleton.indexOf(rootMotion.joint);
      if (!(joint >= 0 && joint < skeleton.count)) throw new Error(`rootMotion: no joint "${rootMotion.joint}"`);
      const axes = [...(rootMotion.axes ?? 'xz')].map((c) => 'xyz'.indexOf(c));
      if (axes.length === 0 || axes.some((a) => a < 0)) throw new Error(`rootMotion axes are made of x, y and z (got "${rootMotion.axes}")`);
      this.rootMotion = { joint, axes };
    }
    this.scratchA = new Float32Array(3); this.scratchB = new Float32Array(3);
    this.pose = skeleton.createPose().setRest(skeleton);
    this.current = null; // {clip, time, speed}
    this.fading = null;  // {clip, time, speed}: what we are fading away from
    this.fadeTime = 0;
    this.fadeLength = 0;
    this.a = skeleton.createPose();
    this.b = skeleton.createPose();
  }

  /**
   * Switch to a clip (no effect if it is already the current one, unless `restart`).
   * @param {AnimationClip} clip
   * @param {object} [o]
   * @param {number} [o.fade] Cross-fade length in seconds
   * @param {number} [o.speed] Playback speed multiplier
   * @param {boolean} [o.restart]
   */
  play(clip, { fade = 0.2, speed = 1, restart = false } = {}) {
    if (this.current?.clip === clip && !restart) { this.current.speed = speed; return; }
    this.fading = this.current && fade > 0 ? this.current : null;
    this.fadeTime = 0; this.fadeLength = fade;
    this.current = { clip, time: 0, speed, fresh: true };
  }

  /** Add the root's movement over a stretch of the clip to `motion`, and hold the root still in the pose. */
  takeRootMotion(clip, from, to, pose) {
    if (to !== from) this.rootDisplacement(clip, from, to);
    this.stripRoot(clip, pose);
  }

  rootDisplacement(clip, from, to) {
    const { joint } = this.rootMotion, sk = this.skeleton, a = this.scratchA, b = this.scratchB, d = clip.duration, out = this.motion;
    const add = (t1, t0) => { jointTranslation(sk, clip, joint, t1, a); jointTranslation(sk, clip, joint, t0, b); for (let q = 0; q < 3; q++) out[q] += a[q] - b[q]; };
    if (!clip.loop || d <= 0) { add(Math.max(0, Math.min(d, to)), Math.max(0, Math.min(d, from))); return; }
    const ka = Math.floor(from / d), kb = Math.floor(to / d);
    if (ka === kb) { add(to - kb * d, from - ka * d); return; }
    add(d, from - ka * d);                                              // to the end of the lap it was in,
    for (let lap = ka + 1; lap < kb; lap++) add(d, 0);                  // whole laps,
    add(to - kb * d, 0);                                                // and into the lap it is in now
  }

  stripRoot(clip, pose) {
    const { joint, axes } = this.rootMotion, anchor = jointTranslation(this.skeleton, clip, joint, 0, this.scratchB);
    for (const axis of axes) pose.t[joint * 3 + axis] = anchor[axis];
  }

  update(dt) {
    const cur = this.current;
    this.motion.fill(0);
    if (!cur) return this.pose;
    const before = cur.time;
    cur.time += dt * cur.speed;
    if (this.onEvent && cur.clip.events.length > 0 && cur.time >= before) cur.clip.eventsBetween(before, cur.time, (e) => this.onEvent(e.name, e.data, cur.clip), cur.fresh);
    cur.fresh = false;
    samplePose(this.skeleton, cur.clip, cur.time, this.pose);
    if (this.rootMotion) this.takeRootMotion(cur.clip, before, cur.time, this.pose);
    if (this.fading) {
      this.fading.time += dt * this.fading.speed;
      this.fadeTime += dt;
      const w = this.fadeTime / this.fadeLength;
      if (w >= 1) this.fading = null;
      else {
        samplePose(this.skeleton, this.fading.clip, this.fading.time, this.a);
        if (this.rootMotion) this.stripRoot(this.fading.clip, this.a);
        blendPoses(this.pose, this.a, this.pose, w);
      }
    }
    return this.pose;
  }
}

// ---------- root motion ----------

/** Translation of a joint at a time within a clip (the rest pose's where the clip has no track for it). */
function jointTranslation(skeleton, clip, joint, at, out) {
  const track = clip.tracks.find((tr) => tr.joint === joint && tr.path === 't');
  if (!track) { for (let k = 0; k < 3; k++) out[k] = skeleton.restT[joint * 3 + k]; return out; }
  const { times, values } = track, n = times.length;
  let lo = 0, hi = n;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (times[mid] > at) hi = mid; else lo = mid + 1; }
  const i0 = Math.max(0, hi - 1), i1 = Math.min(n - 1, hi), span = times[i1] - times[i0];
  const u = track.step || span <= 0 ? 0 : Math.max(0, Math.min(1, (at - times[i0]) / span));
  for (let k = 0; k < 3; k++) out[k] = values[i0 * 3 + k] + (values[i1 * 3 + k] - values[i0 * 3 + k]) * u;
  return out;
}

