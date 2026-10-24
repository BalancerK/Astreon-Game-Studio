// The Sequences panel's logic: cutscenes kept in `src/sequences.js` as plain JSON, one for each cutscene:
//
//   export default { "intro": { "duration": 6, "tracks": { "hero": { "x": [[0, 40, "inout"], [3, 200]] } }, "events": [{ "at": 0.5, "kind": "sound", "name": "door" }] } };
//
// A sequence has tracks (the numbers of several things, the camera and the screen, each a row of keys like a clip's) and events (things that happen at a moment: a sound, a line
// of the story, a shake). This builds and changes them, reuses the Clips panel's work for keys, and reads and writes the file. Judging a sequence is the kit's own
// `sequenceProblems`, so the panel and the game agree.
import {
  sequenceProblems, cleanEvent, EVENT_KINDS, SEQUENCE_LIMITS, SPECIAL_TARGETS,
} from '../../../packages/arcade/src/sequences.js';
import { sampleTrack } from '../../../packages/arcade/src/clips.js';
import * as C from './clip-model.js';

export { sequenceProblems, cleanEvent, EVENT_KINDS, SEQUENCE_LIMITS, SPECIAL_TARGETS };
export { freeName, nameProblem, EASES } from './clip-model.js';

const clone = (x) => JSON.parse(JSON.stringify(x));
const round = (n, places = 3) => Math.round(n * 10 ** places) / 10 ** places;
export const NAME = /^[a-z][\w-]{0,31}$/i;
const FIELD = /^[a-z_$][\w$]{0,31}$/i;

/** Ready-made sequences to start from. */
export const PRESETS = {
  walk: () => ({
    duration: 4, skippable: true,
    tracks: { hero: { x: [[0, 40, 'inout'], [3, 300]] }, camera: { x: [[0, 0, 'inout'], [4, 120]] }, screen: { fade: [[0, 1, 'out'], [1, 0]],
      letterbox: [[0, 1]] } },
    events: [{ at: 0, kind: 'music', name: 'calm', volume: 0.6 }],
  }),
  door: () => ({
    duration: 3, skippable: true,
    tracks: { hero: { x: [[0, 40, 'inout'], [1.5, 160]] } },
    events: [{ at: 1.5, kind: 'sound', name: 'door', volume: 1 }, { at: 1.6, kind: 'show', target: 'door' }, { at: 1.6, kind: 'shake', amount: 4,
      seconds: 0.3 },
      { at: 2.2, kind: 'command', name: 'open-door' }],
  }),
  'fade-out': () => ({ duration: 2, skippable: true, tracks: { screen: { fade: [[0, 0, 'in'], [2, 1]] } }, events: [{ at: 2, kind: 'stopMusic' }] }),
  talk: () => ({ duration: 3, skippable: false, tracks: { screen: { letterbox: [[0, 0, 'out'], [0.6, 1]] } }, events: [{ at: 0.8, kind: 'say',
    node: 'start', wait: true }] }),
};

/** A blank sequence: the hero walks across the screen. */
export function newSequence() {
  return { duration: 3, skippable: true, tracks: { hero: { x: [[0, 40, 'inout'], [3, 240]] } }, events: [] };
}

// ---------- the file ----------

/** The sequences as the text of a file. */
export function serializeSequences(table) {
  const body = Object.entries(table).map(([name, s]) => `  ${JSON.stringify(name)}: ${JSON.stringify(s)}`).join(',\n');
  const note = '// Made with the studio\'s Sequences panel. Each is a length, tracks of keys [time, value, how] for the things it moves, '
    + 'and events that happen at a moment.';
  const use = '// Use them with playSequence(game, sequences.intro) and stepSequence(game, sequences.intro, dt) from @engine/arcade.';
  return `${note}\n${use}\nexport default {\n${body}\n};\n`;
}

/** Read a sequences file. Throws an Error that says what is wrong. */
export function parseSequences(text) {
  const m = /export\s+default\s+([\s\S]*?);?\s*$/.exec(String(text ?? ''));
  if (!m) throw new Error('This file is not a set of sequences: it should say "export default { ... }".');
  let data;
  try {
    data = JSON.parse(m[1]);
  } catch {
    throw new Error('This sequences file has been edited into something the Sequences panel cannot read. '
      + 'Keep the part after "export default" as plain JSON.');
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('The sequences file should hold an object of named sequences.');
  for (const [name, s] of Object.entries(data)) {
    if (!NAME.test(name) || !s || typeof s !== 'object') throw new Error(`The sequence "${name.slice(0, 32)}" is not usable.`);
    if (!(s.duration > 0)) s.duration = 1;
    s.tracks = s.tracks && typeof s.tracks === 'object' ? s.tracks : {};
    s.events = Array.isArray(s.events) ? s.events : [];
    for (const [target, fields] of Object.entries(s.tracks)) {
      if (!NAME.test(target) || !fields || typeof fields !== 'object') {
        throw new Error(`In "${name}", the track for "${target.slice(0, 32)}" is not usable.`);
      }
    }
  }
  return data;
}

// ---------- the tracks ----------

/** Why a target (a thing, "camera" or "screen") cannot be added, or null. */
export function targetProblem(seq, target) {
  if (!NAME.test(target)) return 'Use a kind of thing like hero or door, or camera or screen';
  if (target in seq.tracks) return 'This sequence already has tracks for that';
  if (Object.keys(seq.tracks).length >= SEQUENCE_LIMITS.targets) return `At most ${SEQUENCE_LIMITS.targets} things`;
  return null;
}

/** Why a number name cannot be used for a target, or null. */
export function fieldProblem(seq, target, field) {
  if (!FIELD.test(field)) return 'Use a name like x, y, alpha or w';
  if (SPECIAL_TARGETS[target] && !SPECIAL_TARGETS[target].includes(field)) return `${target} has ${SPECIAL_TARGETS[target].join(' and ')}`;
  if (field in (seq.tracks[target] ?? {})) return 'There is already a track for that';
  if (Object.keys(seq.tracks[target] ?? {}).length >= SEQUENCE_LIMITS.fields) return `At most ${SEQUENCE_LIMITS.fields} tracks for one thing`;
  return null;
}

/** The length of a sequence, with keys and events past the new end pulled back to it. */
export function setDuration(seq, seconds) {
  const d = Math.max(0.1, Math.min(SEQUENCE_LIMITS.duration, round(seconds, 2)));
  const out = clone(seq);
  out.duration = d;
  for (const fields of Object.values(out.tracks)) {
    for (const [f, keys] of Object.entries(fields)) fields[f] = keys.map(([t, v, how]) => (how === undefined ? [Math.min(t, d), v] : [Math.min(t,
      d), v, how]));
  }
  out.events = out.events.map((e) => ({ ...e, at: Math.min(e.at, d) }));
  return out;
}

/** Whether the player may skip it. */
export function setSkippable(seq, skippable) {
  return { ...clone(seq), skippable: Boolean(skippable) };
}

/** Tracks for a new target, starting with one number held flat (the first of the target's own numbers for the camera and the screen). */
export function addTarget(seq, target, field = SPECIAL_TARGETS[target]?.[0] ?? 'x', value = 0) {
  const problem = targetProblem(seq, target) ?? fieldProblem(seq, target, field);
  if (problem) throw new Error(problem);
  const out = clone(seq);
  out.tracks[target] = { [field]: [[0, value, 'linear'], [out.duration, value]] };
  return out;
}

/** A target and all its tracks taken away. */
export function removeTarget(seq, target) {
  const out = clone(seq);
  delete out.tracks[target];
  return out;
}

/** A track added to a target. */
export function addField(seq, target, field, value = 0) {
  const problem = fieldProblem(seq, target, field);
  if (problem) throw new Error(problem);
  const out = clone(seq);
  out.tracks[target][field] = [[0, value, 'linear'], [out.duration, value]];
  return out;
}

/** A track taken away (a target with no tracks left goes too). */
export function removeField(seq, target, field) {
  const out = clone(seq);
  delete out.tracks[target][field];
  if (!Object.keys(out.tracks[target]).length) delete out.tracks[target];
  return out;
}

const asClip = (seq, target, field) => ({ duration: seq.duration, tracks: { [field]: seq.tracks[target][field] } });
const putBack = (seq, target, field, clip) => {
  const out = clone(seq);
  out.tracks[target][field] = clip.tracks[field];
  return out;
};

/** A key put in a track. Returns the sequence and which key it is. */
export function addKey(seq, target, field, time, value) {
  const r = C.addKey(asClip(seq, target, field), field, time, value);
  return { seq: putBack(seq, target, field, r.clip), index: r.index };
}

/** A key moved to another time and value. Returns the sequence and the key's new index. */
export function moveKey(seq, target, field, index, time, value) {
  const r = C.moveKey(asClip(seq, target, field), field, index, time, value);
  return { seq: putBack(seq, target, field, r.clip), index: r.index };
}

/** How a key moves on to the next one. */
export function setEase(seq, target, field, index, how) {
  return putBack(seq, target, field, C.setEase(asClip(seq, target, field), field, index, how));
}

/** A key taken away (a track keeps at least one). */
export function removeKey(seq, target, field, index) {
  return putBack(seq, target, field, C.removeKey(asClip(seq, target, field), field, index));
}

// ---------- the events ----------

const sortedEvents = (events) => events.map((e, i) => ({ e, i })).sort((a, b) => a.e.at - b.e.at || a.i - b.i).map((x) => x.e);

/** An event added at a time, with its kind's starting settings. Returns the sequence and the event's place in the list. */
export function addEvent(seq, kind, at) {
  if (!EVENT_KINDS[kind]) throw new Error(`"${kind}" is not something that can happen in a sequence.`);
  if (seq.events.length >= SEQUENCE_LIMITS.events) throw new Error(`At most ${SEQUENCE_LIMITS.events} events.`);
  const out = clone(seq);
  const event = cleanEvent({ kind, at: round(at) }, out.duration);
  out.events = sortedEvents([...out.events, event]);
  return { seq: out, index: out.events.indexOf(event) };
}

/** An event moved to another time. Returns the sequence and the event's new place. */
export function moveEvent(seq, index, at) {
  const out = clone(seq);
  const [event] = out.events.splice(index, 1);
  event.at = Math.max(0, Math.min(out.duration, round(at)));
  out.events.push(event);
  out.events = sortedEvents(out.events);
  return { seq: out, index: out.events.indexOf(event) };
}

/** Change an event's settings (held to the kit's ranges). */
export function setEvent(seq, index, props) {
  const out = clone(seq);
  out.events[index] = cleanEvent({ ...out.events[index], ...props }, out.duration);
  return out;
}

/** An event taken away. */
export function removeEvent(seq, index) {
  const out = clone(seq);
  out.events.splice(index, 1);
  return out;
}

// ---------- the preview ----------

/**
 * What a sequence looks like at a time, without playing anything: where each target is, where the camera is, how faded the screen is, and which events have happened by then.
 * @param {object} seq
 * @param {number} time
 * @returns {{things: Object<string, Object<string, number>>, camera: {x: number, y: number}, screen: {fade: number, letterbox: number}, happened: object[]}}
 */
export function previewAt(seq, time) {
  const things = {};
  const camera = { x: 0, y: 0 };
  const screen = { fade: 0, letterbox: 0 };
  for (const [target, fields] of Object.entries(seq.tracks)) {
    const into = target === 'camera' ? camera : target === 'screen' ? screen : (things[target] = {});
    for (const [field, keys] of Object.entries(fields)) {
      const v = sampleTrack(keys, time);
      if (v !== undefined) into[field] = target === 'screen' ? Math.max(0, Math.min(1, v)) : v;
    }
  }
  return { things, camera, screen, happened: seq.events.filter((e) => e.at <= time) };
}

/** A one-line description of an event, for the timeline and the log. */
export function describeEvent(e) {
  const k = EVENT_KINDS[e.kind];
  if (!k) return e.kind;
  const detail = e.name ?? e.node ?? e.target ?? '';
  return detail ? `${k.label}: ${detail}` : k.label;
}
