import { angleDelta } from './skeleton.js';

/**
 * Animations: lists of keyframes for bone poses, slot colours and attachments, mesh deformation, the draw order, IK settings and events, with the curve that eases between keys.
 *
 * Bone keys are *relative to the setup pose*: a rotation of 0 is the design pose, a translation of (0, 0) is where the bone rests, a scale of 1 is its normal size. That way an animation
 * keeps working if the setup pose is adjusted.
 */

/** Which way keys are applied. `replace` moves the pose toward the animation (with `alpha` 1, to it); `add` adds the animation's change from the setup pose on top of the pose. */
export const BLEND = Object.freeze({ replace: 'replace', add: 'add' });

/** The index of the last key at or before `t`, or -1 before the first. @param {ArrayLike<number>} times @param {number} t */
export function frameIndex(times, t) {
  let lo = 0, hi = times.length - 1;
  if (hi < 0 || t < times[0]) return -1;
  if (t >= times[hi]) return hi;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (times[mid] <= t) lo = mid; else hi = mid; }
  return lo;
}

/**
 * How far along the way from one key to the next a value is, once the curve is applied. `curve` is `null` for a straight line, `'stepped'` to hold the first value until the next key,
 * or `[cx1, cy1, cx2, cy2]` for a Bezier ease (control points in a 0..1 box of time and value, like CSS `cubic-bezier`).
 * @param {null | 'stepped' | number[]} curve @param {number} f 0..1, the time fraction
 */
export function curveFraction(curve, f) {
  if (!curve) return f;
  if (curve === 'stepped') return 0;
  const [x1, y1, x2, y2] = curve;
  let lo = 0, hi = 1, s = f;
  for (let i = 0; i < 24; i++) {                                    // find s where the curve's x equals f
    s = (lo + hi) / 2;
    const u = 1 - s, x = 3 * u * u * s * x1 + 3 * u * s * s * x2 + s * s * s;
    if (x < f) lo = s; else hi = s;
  }
  const u = 1 - s;
  return 3 * u * u * s * y1 + 3 * u * s * s * y2 + s * s * s;
}

/** Interpolate a value channel between the keys around `t`. `values` has `stride` numbers per key; writes them to `out`. */
function sample(times, values, stride, curves, t, out) {
  const i = frameIndex(times, t);
  if (i < 0) { for (let k = 0; k < stride; k++) out[k] = values[k]; return; }
  if (i >= times.length - 1) { for (let k = 0; k < stride; k++) out[k] = values[i * stride + k]; return; }
  const f = curveFraction(curves?.[i] ?? null, (t - times[i]) / (times[i + 1] - times[i]));
  for (let k = 0; k < stride; k++) out[k] = values[i * stride + k] + (values[(i + 1) * stride + k] - values[i * stride + k]) * f;
}

const tmp = new Float32Array(4);

/** Common base: a timeline has a `key` that names what it animates (two timelines with the same key fight over the same thing), and `times`. */
class Timeline {
  constructor(key, times) { this.key = key; this.times = Float32Array.from(times); }
  /** The time of the last key. */
  get duration() { return this.times.length ? this.times[this.times.length - 1] : 0; }
}

/** Turns a bone: keys of one angle (degrees, relative to the setup rotation). */
export class RotateTimeline extends Timeline {
  /** @param {number} bone Bone index @param {ArrayLike<number>} times @param {ArrayLike<number>} values @param {(null | 'stepped' | number[])[]} [curves] */
  constructor(bone, times, values, curves) { super(`rotate:${bone}`, times); this.bone = bone; this.values = Float32Array.from(values); this.curves = curves; }
  apply(skeleton, time, alpha, blend) {
    const b = skeleton.bones[this.bone];
    sample(this.times, this.values, 1, this.curves, time, tmp);
    if (blend === BLEND.add) { b.rotation += tmp[0] * alpha; return; }
    const target = b.data.rotation + tmp[0];
    b.rotation = alpha >= 1 ? target : b.rotation + angleDelta(b.rotation, target) * alpha;
  }
}

/** Moves, resizes or shears a bone: keys of an (x, y) pair. `kind` is `'translate'` (relative to the setup position), `'scale'` (a multiplier of the setup scale) or `'shear'` (degrees, relative). */
export class Vec2Timeline extends Timeline {
  /** @param {'translate' | 'scale' | 'shear'} kind @param {number} bone @param {ArrayLike<number>} times @param {ArrayLike<number>} values x, y for each key @param {(null | 'stepped' | number[])[]} [curves] */
  constructor(kind, bone, times, values, curves) { super(`${kind}:${bone}`, times); this.kind = kind; this.bone = bone; this.values = Float32Array.from(values); this.curves = curves; }
  apply(skeleton, time, alpha, blend) {
    const b = skeleton.bones[this.bone], d = b.data;
    sample(this.times, this.values, 2, this.curves, time, tmp);
    const vx = tmp[0], vy = tmp[1];
    if (this.kind === 'translate') {
      if (blend === BLEND.add) { b.x += vx * alpha; b.y += vy * alpha; } else { b.x += (d.x + vx - b.x) * alpha; b.y += (d.y + vy - b.y) * alpha; }
    } else if (this.kind === 'scale') {
      if (blend === BLEND.add) { b.scaleX += d.scaleX * (vx - 1) * alpha; b.scaleY += d.scaleY * (vy - 1) * alpha; } else { b.scaleX += (d.scaleX * vx - b.scaleX) * alpha; b.scaleY += (d.scaleY * vy - b.scaleY) * alpha; }
    } else if (blend === BLEND.add) { b.shearX += vx * alpha; b.shearY += vy * alpha; } else { b.shearX += (d.shearX + vx - b.shearX) * alpha; b.shearY += (d.shearY + vy - b.shearY) * alpha; }
  }
}

/** Changes a slot's colour: keys of [r, g, b, a] in 0..1 (absolute). */
export class ColorTimeline extends Timeline {
  /** @param {number} slot Slot index @param {ArrayLike<number>} times @param {ArrayLike<number>} values r, g, b, a for each key @param {(null | 'stepped' | number[])[]} [curves] */
  constructor(slot, times, values, curves) { super(`color:${slot}`, times); this.slot = slot; this.values = Float32Array.from(values); this.curves = curves; }
  apply(skeleton, time, alpha, blend) {
    const s = skeleton.slots[this.slot], c = s.color, d = s.data.color;
    sample(this.times, this.values, 4, this.curves, time, tmp);
    for (let k = 0; k < 4; k++) c[k] = blend === BLEND.add ? c[k] + (tmp[k] - d[k]) * alpha : c[k] + (tmp[k] - c[k]) * alpha;
  }
}

/** Switches which attachment a slot shows (or hides it with `null`). A switch needs at least half the animation's weight, so a fade does not flicker. */
export class AttachmentTimeline extends Timeline {
  /** @param {number} slot @param {ArrayLike<number>} times @param {(string | null)[]} names */
  constructor(slot, times, names) { super(`attachment:${slot}`, times); this.slot = slot; this.names = names; }
  apply(skeleton, time, alpha) {
    if (alpha < 0.5) return;
    const i = frameIndex(this.times, time), s = skeleton.slots[this.slot];
    if (i < 0) return;
    const name = this.names[i];
    if (s.attachment !== name) { s.attachment = name; s.deform = null; }
  }
}

/** Pushes a mesh's points around: keys of one offset for every point (two numbers per point, or for a weighted mesh two per bone influence), added to the setup positions. */
export class DeformTimeline extends Timeline {
  /** @param {number} slot @param {object} attachment The mesh this deforms @param {ArrayLike<number>} times @param {Float32Array[]} frames One offset array per key @param {(null | 'stepped' | number[])[]} [curves] */
  constructor(slot, attachment, times, frames, curves) { super(`deform:${slot}:${attachment.name}`, times); this.slot = slot; this.attachment = attachment; this.frames = frames; this.curves = curves; }
  apply(skeleton, time, alpha, blend) {
    const s = skeleton.slots[this.slot];
    if (skeleton.attachmentOf(s) !== this.attachment) return;
    const n = this.frames[0].length;
    if (!s.deform || s.deform.length !== n) s.deform = new Float32Array(n);
    const out = s.deform, i = frameIndex(this.times, time);
    const f0 = this.frames[Math.max(0, i)], f1 = this.frames[Math.min(this.frames.length - 1, i + 1)];
    const f = i < 0 || i >= this.times.length - 1 ? 0 : curveFraction(this.curves?.[i] ?? null, (time - this.times[i]) / (this.times[i + 1] - this.times[i]));
    for (let k = 0; k < n; k++) {
      const v = i < 0 ? this.frames[0][k] : f0[k] + (f1[k] - f0[k]) * f;
      out[k] = blend === BLEND.add ? out[k] + v * alpha : out[k] + (v - out[k]) * alpha;
    }
  }
}

/** Reorders the slots for drawing: keys of a full order (slot indexes back to front), or `null` for the setup order. */
export class DrawOrderTimeline extends Timeline {
  /** @param {ArrayLike<number>} times @param {(number[] | null)[]} orders */
  constructor(times, orders) { super('draworder', times); this.orders = orders; }
  apply(skeleton, time, alpha) {
    if (alpha < 0.5) return;
    const i = frameIndex(this.times, time);
    if (i < 0) return;
    const order = this.orders[i];
    for (let k = 0; k < skeleton.slots.length; k++) skeleton.drawOrder[k] = skeleton.slots[order ? order[k] : k];
  }
}

/** Changes an IK constraint: keys of its mix (0 off, 1 fully on) and bend direction (1 or -1). */
export class IkTimeline extends Timeline {
  /** @param {number} ik @param {ArrayLike<number>} times @param {ArrayLike<number>} mixes @param {ArrayLike<number>} bends @param {(null | 'stepped' | number[])[]} [curves] */
  constructor(ik, times, mixes, bends, curves) { super(`ik:${ik}`, times); this.ik = ik; this.mixes = Float32Array.from(mixes); this.bends = Int8Array.from(bends); this.curves = curves; }
  apply(skeleton, time, alpha) {
    const c = skeleton.ik[this.ik];
    sample(this.times, this.mixes, 1, this.curves, time, tmp);
    c.mix += (tmp[0] - c.mix) * alpha;
    const i = frameIndex(this.times, time);
    if (i >= 0 && alpha >= 0.5) c.bend = this.bends[i];
  }
}

/** Marks moments for the game to react to (a footstep, a sword hit): keys of an event. Not applied to the pose; `Animation.collectEvents` finds the ones that passed. */
export class EventTimeline extends Timeline {
  /** @param {ArrayLike<number>} times @param {{name: string, int: number, float: number, string: string}[]} events */
  constructor(times, events) { super('events', times); this.events = events; }
  apply() {}
}

/** One animation: its name, its length in seconds, and its timelines. */
export class Animation {
  /** @param {string} name @param {Timeline[]} timelines @param {number} [duration] Defaults to the time of the last key. */
  constructor(name, timelines, duration) {
    this.name = name; this.timelines = timelines;
    this.duration = duration ?? timelines.reduce((m, t) => Math.max(m, t.duration), 0);
    /** What it animates, so a crossfade can tell which things two animations share. */
    this.keys = new Set(timelines.filter((t) => !(t instanceof EventTimeline)).map((t) => t.key));
  }

  /**
   * Pose a skeleton as this animation has it at `time`.
   * @param {import('./skeleton.js').Skeleton} skeleton @param {number} time Seconds; with `loop`, wrapped to the length. @param {number} [alpha] How strongly (0..1). @param {'replace' | 'add'} [blend] @param {boolean} [loop]
   * @param {Set<string> | null} [only] When given, only timelines whose key is in (or, with `except`, not in) the set are applied. @param {boolean} [except]
   */
  apply(skeleton, time, alpha = 1, blend = BLEND.replace, loop = false, only = null, except = false) {
    if (loop && this.duration > 0) time %= this.duration;
    for (const t of this.timelines) {
      if (t instanceof EventTimeline) continue;
      if (only && only.has(t.key) === except) continue;
      t.apply(skeleton, time, alpha, blend);
    }
  }

  /**
   * The events that happen in (`lastTime`, `time`], in order; with `loop`, every pass through the animation counts, across the wrap from the end back to the start. A first call with `lastTime` below zero includes events at time 0.
   * @param {number} lastTime @param {number} time @param {boolean} loop @param {object[]} [out]
   */
  collectEvents(lastTime, time, loop, out = []) {
    const d = this.duration, found = [];
    for (const t of this.timelines) {
      if (!(t instanceof EventTimeline)) continue;
      for (let i = 0; i < t.times.length; i++) {
        const e = t.times[i];
        if (loop && d > 0) {
          // an event happens at e, e + d, e + 2d... : every one inside (lastTime, time]
          for (let n = Math.max(0, Math.floor((lastTime - e) / d) + 1); n * d + e <= time; n++) if (n * d + e > lastTime) found.push({ at: n * d + e, event: { ...t.events[i], time: e } });
        } else if (e > lastTime && e <= time) found.push({ at: e, event: { ...t.events[i], time: e } });
      }
    }
    found.sort((x, y) => x.at - y.at);
    for (const f of found) out.push(f.event);
    return out;
  }
}
