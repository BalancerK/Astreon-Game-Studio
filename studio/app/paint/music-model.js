// The music maker's logic, with no page in it. A song here is a tempo, a length in bars and a few tracks; each track is one voice (a wave, a volume) playing one
// note at a time, and its notes sit on a grid of quarter beats ("steps", sixteen to a bar of four beats). The file a game loads is the kit's song (see the kit's
// music.js): a tempo and, for each track, a list of `[note name, beats]` with `null` for a rest. This converts between the two, edits songs as plain functions that
// return a new song (so undo is a list of earlier songs), and makes starting songs and a "surprise me" tune. Pure: tested in Node.
import { rng } from './sound-model.js';

export const STEPS_PER_BEAT = 4;
export const BEATS_PER_BAR = 4;
export const STEPS_PER_BAR = STEPS_PER_BEAT * BEATS_PER_BAR;
export const SONG_LIMITS = { tracks: 8, bars: 32, bpm: [40, 240], pitch: [36, 96], notes: 600, maxSeconds: 60, chord: 6 };
export const WAVES = ['square', 'triangle', 'sine', 'saw', 'noise'];
export const LENGTHS = [['1/4 beat', 1], ['1/2 beat', 2], ['1 beat', 4], ['2 beats', 8], ['1 bar', 16]];
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const clone = (s) => JSON.parse(JSON.stringify(s));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const BLACK = new Set([1, 3, 6, 8, 10]);

/** 'A4' for 69, 'C#3' for 49. */
export const noteName = (midi) => `${NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;
/** 69 for 'A4' (and for 'Bb2' and the like); null when it is not a note name. */
export function midiOf(name) {
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(name ?? '');
  if (!m) return null;
  const base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
  return base + (Number(m[3]) + 1) * 12;
}
export const isBlackKey = (midi) => BLACK.has(midi % 12);

/** A starter track. */
export function newTrack(wave = 'square') {
  return { wave, gain: wave === 'triangle' ? 0.5 : 0.3, notes: [] };
}

/** An empty song. */
export function newSong(bpm = 120, bars = 4) {
  return { bpm, bars, tracks: [newTrack('square'), newTrack('triangle')] };
}

export const songSteps = (song) => song.bars * STEPS_PER_BAR;
export const songSeconds = (song) => (songSteps(song) / STEPS_PER_BEAT) * (60 / song.bpm);

/** What is wrong with a song as the editor holds it, or null. */
export function problemWith(song) {
  if (!song || typeof song !== 'object') return 'a song is an object';
  if (!(song.bpm >= SONG_LIMITS.bpm[0] && song.bpm <= SONG_LIMITS.bpm[1])) {
    return `the tempo must be from ${SONG_LIMITS.bpm[0]} to ${SONG_LIMITS.bpm[1]} beats a minute`;
  }
  if (!Number.isInteger(song.bars) || song.bars < 1 || song.bars > SONG_LIMITS.bars) return `a song is 1 to ${SONG_LIMITS.bars} bars long`;
  if (songSeconds(song) > SONG_LIMITS.maxSeconds) {
    return `a song can be at most ${SONG_LIMITS.maxSeconds} seconds long (this one is ${Math.round(songSeconds(song))})`;
  }
  if (!Array.isArray(song.tracks) || !song.tracks.length || song.tracks.length > SONG_LIMITS.tracks) {
    return `a song has 1 to ${SONG_LIMITS.tracks} tracks`;
  }
  return null;
}

// ---------- to and from the kit's song ----------

/**
 * A track's notes put in order, one place at a time: notes that start together and last the same time are a chord (up to six); otherwise a note ends where the
 * next one begins, a lower note wins over a higher one that starts with it, and what falls outside the song is cut.
 */
export function tidyNotes(notes, steps) {
  const sorted = notes.filter((n) => n.step >= 0 && n.step < steps && n.len >= 1).sort((a, b) => a.step - b.step || a.pitch - b.pitch);
  const groups = [];
  for (const n of sorted) {
    const group = groups.at(-1);
    if (group && group[0].step === n.step) {
      if (n.len === group[0].len && group.length < SONG_LIMITS.chord && !group.some((x) => x.pitch === n.pitch)) group.push({ ...n });
      continue;
    }
    groups.push([{ ...n }]);
  }
  return groups.flatMap((group, i) => {
    const head = group[0];
    const room = (groups[i + 1]?.[0].step ?? steps) - head.step;
    const len = Math.min(head.len, steps - head.step, 16 * STEPS_PER_BEAT, room);
    return group.map((n) => ({ ...n, len }));
  });
}

/** The song as the kit wants it (what `music({ ... })` and `playMusic` take). The loop is exactly `bars` long, so it joins without a gap. */
export function toKit(song) {
  const steps = songSteps(song);
  const tracks = song.tracks.map((t) => {
    const list = [];
    const rest = (n) => { while (n > 0) { const piece = Math.min(n, 16 * STEPS_PER_BEAT); list.push([null, piece / STEPS_PER_BEAT]); n -= piece; } };
    let at = 0;
    const tidy = tidyNotes(t.notes, steps);
    for (let i = 0; i < tidy.length; i++) {
      const n = tidy[i];
      if (i && tidy[i - 1].step === n.step) continue;                                      // part of a chord that was already written
      const names = tidy.filter((x) => x.step === n.step).map((x) => noteName(x.pitch));
      rest(n.step - at);
      list.push([names.length === 1 ? names[0] : names, n.len / STEPS_PER_BEAT]);
      at = n.step + n.len;
    }
    rest(steps - at);
    const out = { wave: t.wave, gain: t.gain };
    if (t.decay !== undefined) out.decay = t.decay;
    if (t.lowpass !== undefined) out.lowpass = t.lowpass;
    return { ...(t.name ? { name: t.name } : {}), ...out, notes: list };
  });
  return { bpm: song.bpm, tracks };
}

/** Read a kit song into the editor's shape. Lengths that do not fall on a quarter beat are moved to the nearest one. @returns {{song: object, rounded: boolean}} */
export function fromKit(spec) {
  let rounded = false;
  const q = (beats) => { const s = Math.round(beats * STEPS_PER_BEAT); if (Math.abs(s - beats * STEPS_PER_BEAT) > 1e-6) rounded = true; return s; };
  let longest = 0;
  const tracks = (spec.tracks ?? []).map((t) => {
    const notes = [];
    let at = 0;
    for (const [name, beats] of t.notes ?? []) {
      const len = Math.max(1, q(beats));
      for (const one of Array.isArray(name) ? name.slice(0, SONG_LIMITS.chord) : [name]) {
        const pitch = one === null ? null : midiOf(one);
        if (pitch !== null) notes.push({ step: at, pitch: clamp(pitch, ...SONG_LIMITS.pitch), len });
      }
      at += len;
    }
    longest = Math.max(longest, at);
    const out = { wave: WAVES.includes(t.wave) ? t.wave : 'square', gain: Number.isFinite(t.gain) ? t.gain : 0.3, notes };
    if (t.name) out.name = String(t.name).slice(0, 24);
    if (Number.isFinite(t.decay)) out.decay = t.decay;
    if (Number.isFinite(t.lowpass)) out.lowpass = t.lowpass;
    return out;
  });
  const bars = clamp(Math.ceil(longest / STEPS_PER_BAR) || 1, 1, SONG_LIMITS.bars);
  return { song: { bpm: clamp(Number(spec.bpm) || 120, ...SONG_LIMITS.bpm), bars, tracks }, rounded };
}

// ---------- editing ----------

/** The note on a track that covers a step at a pitch, as an index, or -1. */
export function noteAt(song, track, step, pitch) {
  return song.tracks[track].notes.findIndex((n) => n.pitch === pitch && step >= n.step && step < n.step + n.len);
}

/**
 * Click on a cell: an empty cell gets a note of this length, replacing what it overlaps on that track, unless a note already starts there and lasts the same
 * time, which makes a chord; a cell on a note removes it.
 */
export function toggleNote(song, track, step, pitch, len = 4) {
  const steps = songSteps(song);
  if (!song.tracks[track] || step < 0 || step >= steps || pitch < SONG_LIMITS.pitch[0] || pitch > SONG_LIMITS.pitch[1]) return song;
  const next = clone(song);
  const t = next.tracks[track];
  const hit = noteAt(song, track, step, pitch);
  if (hit >= 0) { t.notes.splice(hit, 1); return next; }
  const length = Math.min(len, steps - step);
  const together = (n) => n.step === step && n.len === length;
  if (t.notes.filter(together).length >= SONG_LIMITS.chord) return song;
  t.notes = t.notes.filter((n) => together(n) || n.step + n.len <= step || n.step >= step + length);
  if (t.notes.length >= SONG_LIMITS.notes / 2) return song;
  t.notes.push({ step, pitch, len: length });
  t.notes.sort((a, b) => a.step - b.step);
  return next;
}

/** Change one note: its pitch, its start or its length. */
export function setNote(song, track, index, patch) {
  const n = song.tracks[track]?.notes[index];
  if (!n) return song;
  const next = clone(song);
  const merged = { ...n, ...patch };
  merged.pitch = clamp(merged.pitch, ...SONG_LIMITS.pitch);
  merged.step = clamp(merged.step, 0, songSteps(song) - 1);
  merged.len = clamp(merged.len, 1, songSteps(song) - merged.step);
  next.tracks[track].notes[index] = merged;
  next.tracks[track].notes = tidyNotes(next.tracks[track].notes, songSteps(song));
  return next;
}

export function setTrack(song, track, patch) {
  if (!song.tracks[track]) return song;
  const next = clone(song);
  const t = { ...next.tracks[track], ...patch };
  if (!WAVES.includes(t.wave)) return song;
  t.gain = clamp(Number(t.gain), 0, 1);
  for (const k of ['decay', 'lowpass']) if (t[k] === undefined || t[k] === null || Number.isNaN(t[k])) delete t[k];
  next.tracks[track] = t;
  return next;
}

export function addTrack(song, wave = 'square') {
  if (song.tracks.length >= SONG_LIMITS.tracks) return song;
  const next = clone(song);
  next.tracks.push(newTrack(wave));
  return next;
}

export function removeTrack(song, track) {
  if (song.tracks.length <= 1 || !song.tracks[track]) return song;
  const next = clone(song);
  next.tracks.splice(track, 1);
  return next;
}

export function clearTrack(song, track) {
  if (!song.tracks[track]) return song;
  const next = clone(song);
  next.tracks[track].notes = [];
  return next;
}

export function setTempo(song, bpm) {
  const v = clamp(Math.round(Number(bpm) || 120), ...SONG_LIMITS.bpm);
  const next = { ...clone(song), bpm: v };
  return problemWith(next) ? song : next;
}

/** Change the length in bars; notes beyond the new end are cut. */
export function setBars(song, bars) {
  const v = clamp(Math.round(Number(bars) || 1), 1, SONG_LIMITS.bars);
  const next = clone(song);
  next.bars = v;
  if (problemWith(next)) return song;
  for (const t of next.tracks) t.notes = tidyNotes(t.notes, songSteps(next));
  return next;
}

/** Move every note of a track up or down by semitones (staying inside the keyboard). */
export function transpose(song, track, semitones) {
  const t = song.tracks[track];
  if (!t || !t.notes.length) return song;
  const lo = Math.min(...t.notes.map((n) => n.pitch));
  const hi = Math.max(...t.notes.map((n) => n.pitch));
  if (lo + semitones < SONG_LIMITS.pitch[0] || hi + semitones > SONG_LIMITS.pitch[1]) return song;
  const next = clone(song);
  for (const n of next.tracks[track].notes) n.pitch += semitones;
  return next;
}

/** Repeat what is in the first `bars` bars of a track to fill the whole song. */
export function repeatTrack(song, track, bars) {
  const t = song.tracks[track];
  const span = Math.max(1, bars) * STEPS_PER_BAR;
  if (!t || span >= songSteps(song)) return song;
  const next = clone(song);
  const source = t.notes.filter((n) => n.step < span);
  const out = [...source];
  for (let at = span; at < songSteps(song); at += span) {
    for (const n of source) if (n.step + at < songSteps(song)) out.push({ ...n, step: n.step + at });
  }
  next.tracks[track].notes = tidyNotes(out, songSteps(next));
  return next;
}

// ---------- starting songs ----------

const SCALES = { major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10], pentatonic: [0, 2, 4, 7, 9] };

/** A tune made from a seed: a bass line under a melody, in a scale, that always loops. */
export function surprise(seed = 1, { scale = 'pentatonic', root = 60, bars = 4, bpm = 112 } = {}) {
  const rand = rng(seed);
  const degrees = SCALES[scale] ?? SCALES.pentatonic;
  const pick = (lo, count) => {
    const d = Math.floor(rand() * count);
    return lo + 12 * Math.floor(d / degrees.length) + degrees[d % degrees.length];
  };
  const song = { bpm, bars, tracks: [newTrack('triangle'), newTrack('square')] };
  song.tracks[1].gain = 0.25;
  const bass = [];
  const lead = [];
  for (let bar = 0; bar < bars; bar++) {
    bass.push({ step: bar * STEPS_PER_BAR, pitch: pick(root - 24, degrees.length), len: 8 });
    bass.push({ step: bar * STEPS_PER_BAR + 8, pitch: pick(root - 24, degrees.length), len: 8 });
    let at = bar * STEPS_PER_BAR;
    while (at < (bar + 1) * STEPS_PER_BAR) {
      const len = [2, 2, 4, 4, 8][Math.floor(rand() * 5)];
      const room = (bar + 1) * STEPS_PER_BAR - at;
      const used = Math.min(len, room);
      if (rand() > 0.2) lead.push({ step: at, pitch: pick(root, degrees.length * 2), len: used });
      at += used;
    }
  }
  song.tracks[0].notes = tidyNotes(bass, songSteps(song));
  song.tracks[1].notes = tidyNotes(lead, songSteps(song));
  return song;
}

const bar = (notes, at = 0) => notes.map(([step, pitch, len]) => ({ step: step + at * STEPS_PER_BAR, pitch, len }));

/** Songs to start from. */
export const PRESETS = {
  calm: () => ({
    bpm: 96, bars: 4,
    tracks: [
      {
        wave: 'triangle', gain: 0.5, decay: 1.4,
        notes: [0, 1, 2, 3].flatMap((b) => bar([[0, [45, 43, 41, 43][b]], [8, [45, 43, 41, 43][b] + 7]].map(([s, p]) => [s, p, 8]), b)),
      },
      {
        wave: 'sine', gain: 0.22, decay: 0.45,
        notes: [0, 1, 2, 3].flatMap((b) => bar([0, 2, 4, 6, 8, 10, 12, 14].map((s, i) => [s, [57, 60, 64, 60][i % 4] + [0, -2, -4, -2][b], 2]), b)),
      },
    ],
  }),
  chase: () => ({
    bpm: 160, bars: 4,
    tracks: [
      {
        wave: 'saw', gain: 0.22, decay: 0.2, lowpass: 1800,
        notes: [0, 1, 2, 3].flatMap((b) => bar([0, 2, 4, 6, 8, 10, 12, 14].map((s) => [s, [40, 40, 43, 38][b], 2]), b)),
      },
      {
        wave: 'square', gain: 0.2, decay: 0.15,
        notes: [0, 1, 2, 3].flatMap((b) => bar([[0, 64, 2], [2, 67, 2], [4, 71, 4], [8, 69, 2], [10, 67, 2], [12, [64, 62, 64, 59][b], 4]], b)),
      },
    ],
  }),
  jingle: () => ({
    bpm: 132, bars: 2,
    tracks: [
      {
        wave: 'square', gain: 0.28, decay: 0.3,
        notes: bar([[0, 72, 2], [2, 76, 2], [4, 79, 2], [6, 84, 6], [14, 79, 2], [16, 77, 2], [18, 81, 2], [20, 84, 12]]),
      },
      { wave: 'triangle', gain: 0.5, decay: 1, notes: bar([[0, 48, 8], [8, 55, 8], [16, 53, 8], [24, 48, 8]]) },
    ],
  }),
};

// ---------- the file ----------

/** The songs of a project as the text of a file: the kit's songs by name. */
export function serializeSongs(songs) {
  const body = Object.entries(songs).map(([name, song]) => `  ${JSON.stringify(name)}: ${JSON.stringify(toKit(song))}`).join(',\n');
  const note = '// Made with the studio\'s music maker. Each song is a tempo and tracks of [note, beats]; null is a rest.';
  return `${note}\n// Use them with music(...) and playMusic('name') from @engine/arcade.\nexport default {\n${body}\n};\n`;
}

/** Read a songs file. Throws an Error that says what is wrong. @returns {{songs: Record<string, object>, rounded: string[]}} */
export function parseSongs(text) {
  const m = /export\s+default\s+([\s\S]*?);?\s*$/.exec(String(text ?? ''));
  if (!m) throw new Error('This file is not a list of songs: it should say "export default { ... }".');
  let data;
  try {
    data = JSON.parse(m[1]);
  } catch {
    throw new Error('This songs file has been edited into something the music maker cannot read. '
      + 'Keep the part after "export default" as plain JSON.');
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('The songs file should hold an object of named songs.');
  const songs = {};
  const rounded = [];
  for (const [name, spec] of Object.entries(data)) {
    if (!/^[a-z][\w-]{0,31}$/i.test(name) || !spec || !Array.isArray(spec.tracks) || !spec.tracks.length) {
      throw new Error(`The song "${name.slice(0, 32)}" is not a usable song.`);
    }
    const out = fromKit(spec);
    const problem = problemWith(out.song);
    if (problem) throw new Error(`The song "${name}": ${problem}.`);
    songs[name] = out.song;
    if (out.rounded) rounded.push(name);
  }
  return { songs, rounded };
}

/** A name for a new song that is not taken. */
export function freeName(songs, wanted) {
  const base = String(wanted).replace(/[^\w-]/g, '').replace(/^[^a-z]+/i, '') || 'song';
  if (!(base in songs)) return base;
  for (let n = 2; n < 1000; n++) if (!(`${base}${n}` in songs)) return `${base}${n}`;
  return `${base}${Date.now()}`;
}
