// Clips: numbers that change over time, such as a coin that bobs up and down, a door that slides open, a title that fades in. A clip is a length and a track for each
// number, and a track is a list of keys `[time, value, how]`: at that time the number has that value, and `how` says how it gets to the next key ('linear', 'in' (starts
// slow), 'out' (ends slow), 'inout', or 'step' (jumps)). Plain data, made in the studio's Clips panel and kept in `src/clips.js`:
//
//   const bob = { duration: 1, loop: true, tracks: { y: [[0, 100, 'inout'], [0.5, 92, 'inout'], [1, 100]] } };
//   stepClip(coin, bob, dt);          // every tick: sets coin.y from the clip

/**
 * @typedef {[number, number, ('linear' | 'in' | 'out' | 'inout' | 'step')?]} Key
 * @typedef {{duration: number, loop?: boolean, tracks: Object<string, Key[]>}} Clip
 */

export const EASES = ['linear', 'in', 'out', 'inout', 'step'];
export const CLIP_LIMITS = { duration: 120, tracks: 16, keys: 200 };

/** How far along a segment a number is, 0 to 1, made slow at the start ('in'), the end ('out') or both ('inout'). */
export function ease(how, u) {
  const x = Math.max(0, Math.min(1, u));
  switch (how) {
    case 'in': return x * x;
    case 'out': return 1 - (1 - x) * (1 - x);
    case 'inout': return x < 0.5 ? 2 * x * x : 1 - 2 * (1 - x) * (1 - x);
    case 'step': return x >= 1 ? 1 : 0;
    default: return x;
  }
}

/** The value of one track at a time: before the first key it is the first value, after the last key the last. */
export function sampleTrack(keys, time) {
  if (!keys?.length) return undefined;
  if (time <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [t1, v1] = keys[i];
    if (time <= t1) {
      const [t0, v0, how] = keys[i - 1];
      return v0 + (v1 - v0) * ease(how, t1 === t0 ? 1 : (time - t0) / (t1 - t0));
    }
  }
  return keys[keys.length - 1][1];
}

/** The time inside the clip: a looping clip wraps round, another stops at its end. */
export const clipTime = (clip, time) => (clip.loop && clip.duration > 0 ? ((time % clip.duration) + clip.duration) % clip.duration : Math.max(0, Math.min(time, clip.duration)));

/** Every number of a clip at a time, as `{ y: 96.5, alpha: 1 }`. */
export function sampleClip(clip, time) {
  const t = clipTime(clip, time);
  const out = {};
  for (const [field, keys] of Object.entries(clip.tracks ?? {})) out[field] = sampleTrack(keys, t);
  return out;
}

/**
 * Play a clip on a thing: call it every tick. The thing keeps its own clock (`thing.clipTime`, with the clip's name in `thing.clipName` so a different clip starts from
 * the beginning), and the clip's numbers are set on the thing. Returns true while the clip is still playing (a looping clip always is).
 * @param {object} thing
 * @param {Clip} clip
 * @param {number} dt
 * @param {string} [name] which clip this is (default: the same one every time)
 */
export function stepClip(thing, clip, dt, name = 'clip') {
  if (thing.clipName !== name) { thing.clipName = name; thing.clipTime = 0; }
  thing.clipTime = (thing.clipTime ?? 0) + dt;
  for (const [field, value] of Object.entries(sampleClip(clip, thing.clipTime))) if (value !== undefined) thing[field] = value;
  return clip.loop || thing.clipTime < clip.duration;
}

/**
 * Look a clip over and say what is wrong, in plain words.
 * @param {Clip} clip
 * @returns {{field: string, kind: 'shape' | 'time' | 'order' | 'value' | 'ease' | 'length', message: string}[]}
 */
export function clipProblems(clip) {
  const out = [];
  const add = (field, kind, message) => out.push({ field, kind, message });
  if (!clip || typeof clip !== 'object') { add('', 'shape', 'A clip is an object with a length and tracks.'); return out; }
  if (!(clip.duration > 0 && clip.duration <= CLIP_LIMITS.duration)) add('', 'length', `A clip lasts more than 0 and at most ${CLIP_LIMITS.duration} seconds.`);
  const fields = Object.keys(clip.tracks ?? {});
  if (!fields.length) add('', 'shape', 'This clip has no tracks.');
  if (fields.length > CLIP_LIMITS.tracks) add('', 'shape', `At most ${CLIP_LIMITS.tracks} tracks.`);
  for (const field of fields) {
    const keys = clip.tracks[field];
    if (!Array.isArray(keys) || !keys.length) { add(field, 'shape', `The track "${field}" has no keys.`); continue; }
    if (keys.length > CLIP_LIMITS.keys) add(field, 'shape', `The track "${field}" has more than ${CLIP_LIMITS.keys} keys.`);
    keys.forEach(([time, value, how], i) => {
      if (!Number.isFinite(time) || !Number.isFinite(value)) add(field, 'value', `A key of "${field}" is not a pair of numbers.`);
      else if (time < 0 || time > clip.duration) add(field, 'time', `A key of "${field}" at ${time} s is outside the clip (0 to ${clip.duration} s).`);
      if (i > 0 && time < keys[i - 1][0]) add(field, 'order', `The keys of "${field}" are not in time order.`);
      if (how !== undefined && !EASES.includes(how)) add(field, 'ease', `"${how}" is not a way to move between keys (use ${EASES.join(', ')}).`);
    });
  }
  return out;
}
