// The Clips panel's logic: numbers that change over time, kept in `src/clips.js` as plain JSON, one clip for each effect:
//
//   export default { "bob": { "duration": 1, "loop": true, "tracks": { "y": [[0, 100, "inout"], [0.5, 90, "inout"], [1, 100]] } } };
//
// A track is the list of keys of one number (`[time, value, how]`). This builds and changes clips, keeps keys in time order, and reads and writes the file. Judging a clip
// is the kit's own `clipProblems`, so the panel and the game agree.
import { clipProblems, sampleClip, sampleTrack, EASES, CLIP_LIMITS } from '../../../packages/arcade/src/clips.js';

export { clipProblems, sampleClip, sampleTrack, EASES, CLIP_LIMITS };

const clone = (x) => JSON.parse(JSON.stringify(x));
export const NAME = /^[a-z][\w-]{0,31}$/i;
export const FIELD = /^[a-z_$][\w$]{0,31}$/i;

/** Ready-made clips to start from. */
export const PRESETS = {
  bob: () => ({ duration: 1, loop: true, tracks: { y: [[0, 0, 'inout'], [0.5, -8, 'inout'], [1, 0]] } }),
  'fade-in': () => ({ duration: 0.6, loop: false, tracks: { alpha: [[0, 0, 'out'], [0.6, 1]] } }),
  'slide-in': () => ({ duration: 0.5, loop: false, tracks: { x: [[0, -100, 'out'], [0.5, 0]], alpha: [[0, 0], [0.25, 1]] } }),
  pulse: () => ({ duration: 0.8, loop: true, tracks: { w: [[0, 32, 'inout'], [0.4, 40, 'inout'], [0.8, 32]], h: [[0, 32, 'inout'], [0.4, 40,
    'inout'], [0.8, 32]] } }),
  'pop-out': () => ({ duration: 0.3, loop: false, tracks: { w: [[0, 32, 'in'], [0.3, 0]], h: [[0, 32, 'in'], [0.3, 0]], alpha: [[0, 1], [0.3,
    0]] } }),
};

/** A blank clip: one number that moves from 0 to 100 and back. */
export function newClip() {
  return { duration: 1, loop: true, tracks: { x: [[0, 0, 'linear'], [1, 100]] } };
}

// ---------- the file ----------

/** The clips as the text of a file. */
export function serializeClips(clips) {
  const body = Object.entries(clips).map(([name, c]) => `  ${JSON.stringify(name)}: ${JSON.stringify(c)}`).join(',\n');
  const note = '// Made with the studio\'s Clips panel. Each clip is a length and a track of keys [time, value, how] for each number.';
  return `${note}\n// Use them with stepClip(thing, clips.bob, dt) from @engine/arcade.\nexport default {\n${body}\n};\n`;
}

/** Read a clips file. Throws an Error that says what is wrong. */
export function parseClips(text) {
  const m = /export\s+default\s+([\s\S]*?);?\s*$/.exec(String(text ?? ''));
  if (!m) throw new Error('This file is not a set of clips: it should say "export default { ... }".');
  let data;
  try {
    data = JSON.parse(m[1]);
  } catch {
    throw new Error('This clips file has been edited into something the Clips panel cannot read. '
      + 'Keep the part after "export default" as plain JSON.');
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('The clips file should hold an object of named clips.');
  for (const [name, c] of Object.entries(data)) {
    if (!NAME.test(name) || !c || typeof c !== 'object' || !c.tracks || typeof c.tracks !== 'object') {
      throw new Error(`The clip "${name.slice(0, 32)}" is not usable.`);
    }
    if (!(c.duration > 0)) c.duration = 1;
    for (const [field, keys] of Object.entries(c.tracks)) {
      if (!FIELD.test(field) || !Array.isArray(keys)) throw new Error(`In "${name}", the track "${field.slice(0, 32)}" is not usable.`);
    }
  }
  return data;
}

/** A name for a new clip that is not taken. */
export function freeName(taken, wanted) {
  const base = String(wanted).replace(/[^\w-]/g, '').replace(/^[^a-z]+/i, '') || 'clip';
  if (!(base in taken)) return base;
  for (let n = 2; n < 1000; n++) if (!(`${base}${n}` in taken)) return `${base}${n}`;
  return `${base}${Date.now()}`;
}

/** Why a clip name cannot be used, or null. */
export function nameProblem(name, taken) {
  if (!NAME.test(name)) return 'Use letters and numbers, starting with a letter';
  return taken(name) ? 'There is already a clip with that name' : null;
}

/** Why a track (number) name cannot be used, or null. */
export function fieldProblem(clip, field) {
  if (!FIELD.test(field)) return 'Use a name like x, y, alpha or w';
  if (field in clip.tracks) return 'This clip already has a track with that name';
  if (Object.keys(clip.tracks).length >= CLIP_LIMITS.tracks) return `At most ${CLIP_LIMITS.tracks} tracks`;
  return null;
}

// ---------- changing a clip ----------

const round = (n, places = 3) => Math.round(n * 10 ** places) / 10 ** places;
const sorted = (keys) => [...keys].sort((a, b) => a[0] - b[0]);

/** The length of a clip, with keys that would now fall outside it pulled back to the end. */
export function setDuration(clip, seconds) {
  const d = Math.max(0.05, Math.min(CLIP_LIMITS.duration, round(seconds, 2)));
  const out = clone(clip);
  out.duration = d;
  for (const [f, keys] of Object.entries(out.tracks)) out.tracks[f] = sorted(keys.map(([t, v, how]) => (how === undefined ? [Math.min(t, d),
    v] : [Math.min(t, d), v, how])));
  return out;
}

/** Whether the clip repeats. */
export function setLoop(clip, loop) {
  return { ...clone(clip), loop: Boolean(loop) };
}

/** A track added, starting with the value the clip has at its start (or 0) held flat. */
export function addTrack(clip, field, value = 0) {
  const out = clone(clip);
  out.tracks[field] = [[0, value, 'linear'], [out.duration, value]];
  return out;
}

/** A track taken away (a clip keeps at least one). */
export function removeTrack(clip, field) {
  if (Object.keys(clip.tracks).length <= 1) throw new Error('A clip needs at least one track.');
  const out = clone(clip);
  delete out.tracks[field];
  return out;
}

/** A track renamed, in place. */
export function renameTrack(clip, from, to) {
  const out = { ...clone(clip), tracks: {} };
  for (const [f, keys] of Object.entries(clip.tracks)) out.tracks[f === from ? to : f] = clone(keys);
  return out;
}

/** A key put in a track (at the same time as an existing key, it replaces that key). Returns the new clip and which key it is. */
export function addKey(clip, field, time, value) {
  const out = clone(clip);
  const t = Math.max(0, Math.min(out.duration, round(time)));
  const keys = out.tracks[field].filter((k) => Math.abs(k[0] - t) > 1e-6);
  if (keys.length >= CLIP_LIMITS.keys) throw new Error(`At most ${CLIP_LIMITS.keys} keys in a track.`);
  keys.push([t, round(value)]);
  out.tracks[field] = sorted(keys);
  return { clip: out, index: out.tracks[field].findIndex((k) => k[0] === t) };
}

/** A key moved to another time and value (it keeps its easing; it cannot pass over another key's place, it replaces that one). Returns the clip and the key's new index. */
export function moveKey(clip, field, index, time, value) {
  const out = clone(clip);
  const keys = out.tracks[field];
  const [, , how] = keys[index];
  const t = Math.max(0, Math.min(out.duration, round(time)));
  const rest = keys.filter((_, i) => i !== index && Math.abs(keys[i][0] - t) > 1e-6);
  rest.push(how === undefined ? [t, round(value)] : [t, round(value), how]);
  out.tracks[field] = sorted(rest);
  return { clip: out, index: out.tracks[field].findIndex((k) => k[0] === t) };
}

/** How a key moves on to the next one. */
export function setEase(clip, field, index, how) {
  const out = clone(clip);
  const [t, v] = out.tracks[field][index];
  out.tracks[field][index] = how && how !== 'linear' ? [t, v, how] : [t, v];
  return out;
}

/** A key taken away (a track keeps at least one). */
export function removeKey(clip, field, index) {
  if (clip.tracks[field].length <= 1) throw new Error('A track needs at least one key.');
  const out = clone(clip);
  out.tracks[field].splice(index, 1);
  return out;
}

/** The lowest and highest value of a track, widened a little so a flat track still has a height (for drawing). */
export function rangeOf(keys) {
  const values = keys.map((k) => k[1]);
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  if (hi - lo < 1e-6) { lo -= 1; hi += 1; }
  const pad = (hi - lo) * 0.15;
  return [lo - pad, hi + pad];
}
