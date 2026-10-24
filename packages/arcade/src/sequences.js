// Sequences: a cutscene on one timeline. Where a clip moves the numbers of one thing, a sequence moves several: the hero walks to the door, the camera slides across the room, the
// screen fades to black, and at moments along the way things happen (a sound plays, a line is said, the screen shakes, the door is shown, the game is told to do something). Plain
// data, made in the studio's Sequences panel and kept in `src/sequences.js`:
//
//   const intro = { duration: 6, tracks: { hero: { x: [[0, 40, 'inout'], [3, 200]] }, camera: { x: [[0, 0], [6, 120, 'inout']] }, screen: { fade: [[4.5, 0], [6, 1]] } },
//                   events: [{ at: 0.5, kind: 'sound', name: 'door' }, { at: 3, kind: 'say', node: 'greeting', wait: true }] };
//   playSequence(game, intro);                  // when the cutscene starts
//   stepSequence(game, intro, dt, { skip });    // every tick while it is on (skip: the player pressed a key to skip it)
//   drawSequence(g, game);                      // every frame, over the game: the fade and the black bars
//
// What it remembers is plain data in the game (`game.sequence`), so saving, rewinding and recordings work. The camera's own `followSmooth` should be left alone while a sequence is on
// (see `sequenceActive`), or it will pull the camera back.

import { sampleTrack } from './clips.js';
import { all, first } from './things.js';
import { play } from './sound.js';
import { playMusic, stopMusic } from './music.js';
import { shake, burst } from './effects.js';
import { startStory, storyActive } from './story.js';
import { screen } from './screen.js';

/**
 * @typedef {{at: number, kind: string, [param: string]: any}} SequenceEvent
 * @typedef {{duration: number, skippable?: boolean, tracks: Object<string, Object<string, import('./clips.js').Key[]>>, events?: SequenceEvent[]}} Sequence
 */

/** The limits a sequence is held to. */
export const SEQUENCE_LIMITS = { duration: 300, targets: 8, fields: 8, keys: 200, events: 100, name: 32 };

/** The numbers the two special targets have: the camera's place, and the screen's fade to black and black bars (each from 0 to 1). */
export const SPECIAL_TARGETS = { camera: ['x', 'y'], screen: ['fade', 'letterbox'] };

const num = (label, def, min, max, step = 1) => ({ label, kind: 'number', default: def, min, max, step });
const text = (label, def) => ({ label, kind: 'text', default: def });

/** Everything that can happen at a moment of a sequence: what it is called, what it does, and its settings (name, kind, the starting value and the range). */
export const EVENT_KINDS = {
  sound: { label: 'Play a sound', help: 'Plays one of your sounds.', params: { name: text('Sound', 'coin'), volume: num('Volume', 1, 0, 1, 0.05) } },
  music: { label: 'Start a song', help: 'Starts one of your songs, instead of the one playing.', params: { name: text('Song', 'calm'),
    volume: num('Volume', 0.6, 0, 1, 0.05) } },
  stopMusic: { label: 'Stop the music', help: 'Fades the music out.', params: {} },
  shake: { label: 'Shake the screen', help: 'Shakes the screen for a moment.', params: { amount: num('How hard', 6, 0, 40, 1),
    seconds: num('For how long (s)', 0.4, 0.05, 5, 0.05) } },
  say: {
    label: 'Say a line of the story',
      help: 'Starts a part of the story (a node of your dialogue). The sequence waits while it is talking, if you ask it to.',
    params: { node: text('Story part', 'start'), wait: { label: 'Wait until it is finished', kind: 'flag', default: true } },
  },
  burst: {
    label: 'Burst of sparks', help: 'A burst of sparks on a thing (or in the middle of the screen when there is none).',
    params: { target: text('On', 'hero'), count: num('How many', 14, 1, 100, 1), color: text('Colour', '#ffd23c') },
  },
  show: { label: 'Show a thing', help: 'Makes the first thing of a kind visible.', params: { target: text('Thing', 'door') } },
  hide: { label: 'Hide a thing', help: 'Hides the first thing of a kind.', params: { target: text('Thing', 'door') } },
  command: {
    label: 'Tell the game',
      help: 'Sends the game a message to act on, for anything the sequence cannot do itself (open a door, add to the score). Read them with takeSequenceCommands.',
    params: { name: text('Message', 'open-door'), arg: text('Extra (optional)', '') },
  },
};

/**
 * Make one event safe: a known kind, a time in the sequence, every setting there and within its range.
 * @param {unknown} spec
 * @param {number} [duration] the length of the sequence
 * @returns {SequenceEvent | null}
 */
export function cleanEvent(spec, duration = SEQUENCE_LIMITS.duration) {
  const kind = EVENT_KINDS[spec?.kind];
  if (!kind) return null;
  const out = { at: Math.max(0, Math.min(duration, Number.isFinite(spec.at) ? spec.at : 0)), kind: spec.kind };
  for (const [name, p] of Object.entries(kind.params)) {
    const v = spec[name];
    if (p.kind === 'number') out[name] = Math.max(p.min, Math.min(p.max, Number.isFinite(v) ? v : p.default));
    else if (p.kind === 'flag') out[name] = typeof v === 'boolean' ? v : p.default;
    else out[name] = typeof v === 'string' && v.length <= SEQUENCE_LIMITS.name * 2 ? v : p.default;
  }
  return out;
}

const sortedEvents = (seq) => (seq.events ?? []).map((e, index) => ({ e, index })).sort((a, b) => a.e.at - b.e.at || a.index - b.index);

/** The thing a track moves: the camera, the screen's own numbers, or the first thing of a kind. */
function targetOf(game, state, name) {
  if (name === 'camera') return (game.camera ??= { x: 0, y: 0 });
  if (name === 'screen') return state.screen;
  return first(game, name);
}

function applyTracks(game, state, seq, time) {
  for (const [name, fields] of Object.entries(seq.tracks ?? {})) {
    const target = targetOf(game, state, name);
    if (!target) continue;                                                     // the hero is gone: its track has nothing to move
    for (const [field, keys] of Object.entries(fields)) {
      const v = sampleTrack(keys, time);
      if (v !== undefined) target[field] = name === 'screen' ? Math.max(0, Math.min(1, v)) : v;
    }
  }
}

function fire(game, state, e) {
  switch (e.kind) {
    case 'sound': play(e.name, e.volume); break;
    case 'music': playMusic(e.name, { volume: e.volume }); break;
    case 'stopMusic': stopMusic(); break;
    case 'shake': shake(game, e.amount, e.seconds); break;
    case 'say':
      startStory(game, e.node);
      if (e.wait) state.waiting = true;
      break;
    case 'burst': {
      const t = first(game, e.target);
      burst(game, t ? t.x + t.w / 2 : screen().width / 2, t ? t.y + t.h / 2 : screen().height / 2, { count: e.count, color: e.color });
      break;
    }
    case 'show': for (const t of all(game, e.target).slice(0, 1)) delete t.hidden; break;
    case 'hide': for (const t of all(game, e.target).slice(0, 1)) t.hidden = true; break;
    case 'command': state.commands.push(e.arg ? { name: e.name, arg: e.arg } : { name: e.name }); break;
    default: break;
  }
}

/**
 * Begin a sequence (one that is already going is replaced).
 * @param {object} game
 * @param {Sequence} seq
 * @param {string} [name] which sequence this is (for the game to tell them apart)
 */
export function playSequence(game, seq, name = 'sequence') {
  game.sequence = { name, time: 0, fired: [], done: false, waiting: false, commands: [], screen: { fade: 0, letterbox: 0,
    ...game.sequence?.screen } };
  applyTracks(game, game.sequence, seq, 0);
}

/**
 * Move a sequence on: call it every tick. Tracks set the numbers of the things they are for, and each event happens once, when its time comes. While a line of the story that the
 * sequence is waiting for is on, time stands still. Returns true while the sequence is still going.
 * @param {object} game
 * @param {Sequence} seq
 * @param {number} dt
 * @param {{skip?: boolean}} [opts] `skip`: jump to the end (it only works for a sequence that is skippable). Everything is put where it ends up, and only the events that change the game (`show`, `hide` and `command`) still happen
 * @returns {boolean}
 */
export function stepSequence(game, seq, dt, { skip = false } = {}) {
  const state = game.sequence;
  if (!state || state.done) return false;
  const duration = Math.max(0.01, seq.duration ?? 1);
  const events = sortedEvents(seq);
  if (skip && seq.skippable !== false) {
    state.time = duration;
    applyTracks(game, state, seq, duration);
    for (const { e, index } of events) {
      if (!state.fired.includes(index) && ['show', 'hide', 'command'].includes(e.kind)) fire(game, state, cleanEvent(e, duration) ?? e);
      state.fired.push(index);
    }
    if (game.story && state.waiting) game.story.ended = true;
    state.waiting = false;
    state.done = true;
    return false;
  }
  if (state.waiting) {
    if (storyActive(game)) return true;
    state.waiting = false;
  }
  state.time = Math.min(duration, state.time + Math.max(0, dt));
  applyTracks(game, state, seq, state.time);
  for (const { e, index } of events) {
    if (e.at > state.time || state.fired.includes(index)) continue;
    state.fired.push(index);
    const clean = cleanEvent(e, duration);
    if (clean) fire(game, state, clean);
    if (state.waiting) break;                                                  // wait for the story before the events after it
  }
  if (state.time >= duration && !state.waiting && state.fired.length >= events.length) state.done = true;
  return !state.done;
}

/** Is a sequence going? */
export const sequenceActive = (game) => Boolean(game.sequence) && !game.sequence.done;

/** What the sequence has asked the game to do (`command` events), once: the list is emptied. Each is `{ name, arg? }`. */
export function takeSequenceCommands(game) {
  return game.sequence ? game.sequence.commands.splice(0) : [];
}

/** Forget the sequence, and with it the fade and the black bars it left behind. */
export function clearSequence(game) {
  delete game.sequence;
}

/**
 * Draw what a sequence puts over the picture: the fade to black and the black bars at the top and bottom. Call it every frame, after drawing the game (and before the story's box).
 * @param {CanvasRenderingContext2D} g
 * @param {{sequence?: {screen: {fade: number, letterbox: number}}}} game
 * @param {{width?: number, height?: number}} [opts] the screen's size
 */
export function drawSequence(g, game, { width = screen().width, height = screen().height } = {}) {
  const fx = game.sequence?.screen;
  if (!fx) return;
  g.save();
  g.fillStyle = '#000000';
  if (fx.letterbox > 0) {
    const bar = Math.round(fx.letterbox * height * 0.14);
    g.fillRect(0, 0, width, bar);
    g.fillRect(0, height - bar, width, bar);
  }
  if (fx.fade > 0) {
    g.globalAlpha = Math.min(1, fx.fade);
    g.fillRect(0, 0, width, height);
  }
  g.restore();
}

/**
 * Look a sequence over and say what is wrong, in plain words. Give it what the game has (`known`) and it also says which sounds, songs and story parts do not exist.
 * @param {Sequence} seq
 * @param {{sounds?: string[], songs?: string[], nodes?: string[]}} [known] the names of the game's sounds, songs and story parts
 * @returns {{where: string, message: string}[]}
 */
export function sequenceProblems(seq, known = {}) {
  const out = [];
  const add = (where, message) => out.push({ where, message });
  if (!seq || typeof seq !== 'object') { add('', 'A sequence is an object with a length, tracks and events.'); return out; }
  const duration = seq.duration;
  if (!(duration > 0 && duration <= SEQUENCE_LIMITS.duration)) add('',
    `A sequence lasts more than 0 and at most ${SEQUENCE_LIMITS.duration} seconds.`);
  const targets = Object.entries(seq.tracks ?? {});
  if (targets.length > SEQUENCE_LIMITS.targets) add('', `At most ${SEQUENCE_LIMITS.targets} things can have tracks.`);
  for (const [name, fields] of targets) {
    const list = Object.entries(fields ?? {});
    if (list.length > SEQUENCE_LIMITS.fields) add(name, `"${name}" has more than ${SEQUENCE_LIMITS.fields} tracks.`);
    for (const [field, keys] of list) {
      const special = SPECIAL_TARGETS[name];
      if (special && !special.includes(field)) add(name, `"${name}" has no number called "${field}" (it has ${special.join(' and ')}).`);
      if (!Array.isArray(keys) || !keys.length) { add(name, `The track "${name}.${field}" has no keys.`); continue; }
      if (keys.length > SEQUENCE_LIMITS.keys) add(name, `The track "${name}.${field}" has more than ${SEQUENCE_LIMITS.keys} keys.`);
      keys.forEach(([time, value], i) => {
        if (!Number.isFinite(time) || !Number.isFinite(value)) add(name, `A key of "${name}.${field}" is not a pair of numbers.`);
        else if (time < 0 || time > duration) add(name, `A key of "${name}.${field}" at ${time} s is outside the sequence (0 to ${duration} s).`);
        if (i > 0 && time < keys[i - 1][0]) add(name, `The keys of "${name}.${field}" are not in time order.`);
      });
    }
  }
  const events = seq.events ?? [];
  if (events.length > SEQUENCE_LIMITS.events) add('', `At most ${SEQUENCE_LIMITS.events} events.`);
  events.forEach((e, i) => {
    const where = `event ${i + 1}`;
    if (!EVENT_KINDS[e?.kind]) { add(where, `"${e?.kind}" is not something that can happen in a sequence.`); return; }
    if (!(e.at >= 0 && e.at <= duration)) add(where, `${EVENT_KINDS[e.kind].label} at ${e.at} s is outside the sequence (0 to ${duration} s).`);
    if (e.kind === 'sound' && known.sounds && !known.sounds.includes(e.name)) add(where, `There is no sound called "${e.name}".`);
    if (e.kind === 'music' && known.songs && !known.songs.includes(e.name)) add(where, `There is no song called "${e.name}".`);
    if (e.kind === 'say' && known.nodes && !known.nodes.includes(e.node)) add(where, `There is no story part called "${e.node}".`);
  });
  return out;
}
