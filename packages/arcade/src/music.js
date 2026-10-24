// Music: a song is plain data too (a tempo and a few tracks of notes), so it can be made in the studio's Music panel and kept in a text file. A song loops
// without a click and plays one at a time: starting another fades the first. Like sounds, the game only sends the song to the page that has the speakers.
import { send } from './sound.js';
import { musicLevel, onSettingChange } from './settings.js';

const WAVES = new Set(['sine', 'square', 'saw', 'triangle', 'noise']);
const NOTE = /^[A-G][#b]?-?\d$/;
export const MUSIC_LIMITS = { tracks: 8, notes: 600, beats: 128, seconds: 60, chord: 6 };

let registry = {};

/**
 * Clean up a song that came from outside (the game's worker is not trusted by the page that plays it): known fields only, notes that are note names such as
 * 'A4' or 'C#3' (or null for a rest, or a list of up to six names for a chord), lengths in a sane range, at most 8 tracks, 600 notes a track and a minute of music.
 * @param {unknown} spec
 * @returns {{bpm: number, tracks: {wave: string, gain: number, decay?: number, lowpass?: number, notes: [string | null, number][]}[]} | null}
 */
export function cleanSong(spec) {
  if (!spec || typeof spec !== 'object' || !Array.isArray(spec.tracks) || !spec.tracks.length || spec.tracks.length > MUSIC_LIMITS.tracks) return null;
  const bpm = Number(spec.bpm ?? 120);
  if (!(bpm >= 40 && bpm <= 240)) return null;
  const tracks = [];
  let longest = 0;
  for (const t of spec.tracks) {
    if (!t || typeof t !== 'object' || !Array.isArray(t.notes) || t.notes.length > MUSIC_LIMITS.notes) return null;
    const out = { wave: WAVES.has(t.wave) ? t.wave : 'square', gain: Number.isFinite(t.gain) ? Math.max(0, Math.min(1, t.gain)) : 0.3, notes: [] };
    if (Number.isFinite(t.decay)) out.decay = Math.max(0.01, Math.min(8, t.decay));
    if (Number.isFinite(t.lowpass)) out.lowpass = Math.max(100, Math.min(12000, t.lowpass));
    let beats = 0;
    for (const n of t.notes) {
      const one = (x) => typeof x === 'string' && NOTE.test(x);
      const chord = Array.isArray(n?.[0]) && n[0].length >= 1 && n[0].length <= MUSIC_LIMITS.chord && n[0].every(one);
      if (!Array.isArray(n) || n.length !== 2 || !(n[1] > 0 && n[1] <= 16) || !(n[0] === null || one(n[0]) || chord)) return null;
      out.notes.push([chord ? [...n[0]] : n[0], n[1]]);
      beats += n[1];
    }
    longest = Math.max(longest, beats);
    tracks.push(out);
  }
  if (longest <= 0 || longest > MUSIC_LIMITS.beats || (longest * 60) / bpm > MUSIC_LIMITS.seconds) return null;
  return { bpm, tracks };
}

/**
 * Give songs names, so a game can say `playMusic('calm')`. Call it once, at the top of the game's file, with the songs you made in the Music panel.
 * @param {Object<string, object>} songs
 */
export function music(songs) {
  registry = { ...songs };
}

/**
 * Start a song (a name given to {@link music}) and let it repeat. If that song is already playing it just keeps going, so it is safe to call every time a
 * level starts. Another song fades the one before it.
 * @param {string} name
 * @param {{volume?: number, loop?: boolean}} [o] `volume` 0 to 1 (default 0.6)
 */
export function playMusic(name, { volume = 0.6, loop = true } = {}) {
  const spec = registry[name];
  if (!spec) {
    const known = Object.keys(registry);
    throw new Error(`There is no song called "${name}"${known.length ? ` (the songs are: ${known.join(', ')})` : '. Give your songs names with music({ ... }) first'}.`);
  }
  playing = { name, spec, volume: Math.max(0, Math.min(1, Number(volume) || 0)), loop: !!loop };
  send({ t: 'music', action: 'play', ...playing, volume: playing.volume * musicLevel() });
}

// the song that is playing, so a change of the music volume reaches it at once
let playing = null;
onSettingChange(() => { if (playing) send({ t: 'music', action: 'play', ...playing, volume: playing.volume * musicLevel() }); });

/** Fade the music out. */
export function stopMusic() {
  playing = null;
  send({ t: 'music', action: 'stop' });
}
