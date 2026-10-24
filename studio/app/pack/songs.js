// The free pack's songs: loops for the music maker, in its own form (a tempo, bars, and tracks of notes on a grid of quarter beats). The first three are the music
// maker's starting songs; the rest are new. Made for this project and given away under CC0.
import { PRESETS } from '../paint/music-model.js';

const STEPS_PER_BAR = 16;
const at = (notes, bar) => notes.map(([step, pitch, len]) => ({ step: step + bar * STEPS_PER_BAR, pitch, len }));
/** The notes of a chord on top of a root (as MIDI numbers): minor or major. */
const triad = (root, minor) => [root, root + (minor ? 3 : 4), root + 7];
/** A bar of an arpeggio: the notes of a chord, one every `every` steps, going up and round. */
const arp = (chord, bar, every = 2, octave = 0) => {
  const out = [];
  for (let s = 0, i = 0; s < STEPS_PER_BAR; s += every, i++) out.push([s, chord[i % chord.length] + octave, every]);
  return at(out, bar);
};
/** A low note that stays within the music maker's range (36 and up): the same note, brought into the bottom octave it allows. */
const fold = (pitch) => 36 + (((pitch - 36) % 12) + 12) % 12;
/** A bar of bass: the root on the beat, held. */
const bass = (root, bar, pattern = [[0, 8], [8, 8]]) => at(pattern.map(([s, len]) => [s, fold(root), len]), bar);

const song = (bpm, bars, tracks) => ({ bpm, bars, tracks });

/** @type {{name: string, title: string, category: string, tags: string[], make: () => any}[]} */
export const SONGS = [
  { name: 'calm', title: 'Calm', category: 'Gentle', tags: ['quiet', 'menu', 'slow', 'relax'], make: PRESETS.calm },
  { name: 'chase', title: 'Chase', category: 'Action', tags: ['fast', 'run', 'danger', 'tense'], make: PRESETS.chase },
  { name: 'jingle', title: 'Jingle', category: 'Jingles', tags: ['short', 'fanfare', 'level', 'win'], make: PRESETS.jingle },
  {
    name: 'cheerful', title: 'Cheerful', category: 'Happy', tags: ['bright', 'platformer', 'fun', 'major', 'level'],
    make: () => {
      const chords = [[60, false], [57, true], [53, false], [55, false]];                        // C, A minor, F, G
      return song(124, 4, [
        { wave: 'triangle', gain: 0.5, decay: 0.6, notes: chords.flatMap(([r], b) => bass(r - 24, b, [[0, 4], [4, 4], [8, 4], [12, 4]])) },
        { wave: 'square', gain: 0.18, decay: 0.2, notes: chords.flatMap(([r, m], b) => arp(triad(r, m), b, 2, 12)) },
        {
          wave: 'sine', gain: 0.4, decay: 0.5,
          notes: [[0, 76, 4], [4, 79, 2], [6, 76, 2], [8, 74, 4], [12, 72, 4], [16, 72, 4], [20, 76, 4], [24, 79, 4], [28, 76, 4], [32, 77, 4], [36, 81, 2], [38, 77, 2], [40, 74, 4], [44, 72, 4],
            [48, 74, 4], [52, 79, 4], [56, 79, 2], [58, 77, 2], [60, 74, 4]].map(([step, pitch, len]) => ({ step, pitch, len })),
        },
      ]);
    },
  },
  {
    name: 'adventure', title: 'Adventure', category: 'Happy', tags: ['explore', 'travel', 'quest', 'march'],
    make: () => {
      const chords = [[57, true], [53, false], [60, false], [55, false]];                        // A minor, F, C, G
      return song(112, 4, [
        { wave: 'triangle', gain: 0.5, decay: 0.8, notes: chords.flatMap(([r], b) => bass(r - 24, b, [[0, 6], [6, 2], [8, 6], [14, 2]])) },
        { wave: 'saw', gain: 0.12, decay: 0.3, lowpass: 2600, notes: chords.flatMap(([r, m], b) => arp(triad(r, m), b, 4, 0)) },
        {
          wave: 'square', gain: 0.2, decay: 0.25,
          notes: [[0, 69, 4], [4, 72, 2], [6, 76, 2], [8, 74, 4], [12, 72, 4], [16, 72, 6], [22, 69, 2], [24, 71, 4], [28, 72, 4], [32, 76, 4], [36, 79, 2], [38, 76, 2], [40, 72, 8],
            [48, 74, 4], [52, 71, 4], [56, 67, 4], [60, 71, 4]].map(([step, pitch, len]) => ({ step, pitch, len })),
        },
      ]);
    },
  },
  {
    name: 'spooky', title: 'Spooky', category: 'Dark', tags: ['haunted', 'night', 'minor', 'cave', 'creepy'],
    make: () => {
      const chords = [[57, true], [53, false], [50, true], [52, false]];                         // A minor, F, D minor, E
      return song(84, 4, [
        { wave: 'saw', gain: 0.25, decay: 1.2, lowpass: 900, notes: chords.flatMap(([r], b) => bass(r - 24, b, [[0, 16]])) },
        { wave: 'triangle', gain: 0.3, decay: 0.9, notes: chords.flatMap(([r, m], b) => at(triad(r, m).map((p, i) => [i * 4 + 2, p + 12, 3]), b)) },
        {
          wave: 'sine', gain: 0.3, decay: 1.2,
          notes: [[8, 81, 4], [12, 80, 4], [24, 77, 4], [28, 76, 8], [40, 74, 4], [44, 77, 4], [56, 76, 8]].map(([step, pitch, len]) => ({ step, pitch, len })),
        },
      ]);
    },
  },
  {
    name: 'boss', title: 'Boss fight', category: 'Action', tags: ['battle', 'tense', 'fast', 'minor', 'danger'],
    make: () => {
      const chords = [[52, true], [52, true], [48, false], [47, false]];                         // E minor, E minor, C, B
      return song(150, 4, [
        { wave: 'square', gain: 0.22, decay: 0.12, lowpass: 1400, notes: chords.flatMap(([r], b) => bass(r - 12, b, [0, 2, 4, 6, 8, 10, 12, 14].map((s) => [s, 2]))) },
        { wave: 'saw', gain: 0.16, decay: 0.2, lowpass: 3200, notes: chords.flatMap(([r, m], b) => at([[0, triad(r, m)[2] + 12, 3], [4, triad(r, m)[1] + 12, 3], [8, triad(r, m)[2] + 12, 3], [12, r + 24, 4]], b)) },
        { wave: 'triangle', gain: 0.45, decay: 0.3, notes: chords.flatMap(([r], b) => at([[0, fold(r - 24), 2], [8, fold(r - 24), 2]], b)) },
      ]);
    },
  },
  {
    name: 'lullaby', title: 'Lullaby', category: 'Gentle', tags: ['sleep', 'soft', 'slow', 'sweet'],
    make: () => song(70, 4, [
      { wave: 'sine', gain: 0.4, decay: 1.4, notes: [[0, 72, 6], [6, 76, 2], [8, 79, 8], [16, 77, 6], [22, 74, 2], [24, 72, 8], [32, 72, 6], [36, 76, 2], [40, 79, 4], [44, 84, 4], [48, 83, 8], [56, 79, 8]].map(([step, pitch, len]) => ({ step, pitch, len })) },
      { wave: 'triangle', gain: 0.3, decay: 1.5, notes: [[0, 48, 8], [8, 55, 8], [16, 53, 8], [24, 48, 8], [32, 48, 8], [40, 55, 8], [48, 55, 8], [56, 43, 8]].map(([step, pitch, len]) => ({ step, pitch, len })) },
    ]),
  },
  {
    name: 'menu', title: 'Menu', category: 'Gentle', tags: ['title', 'relax', 'loop', 'start'],
    make: () => {
      const chords = [[60, false], [57, true], [62, true], [55, false]];                         // C, A minor, D minor, G
      return song(100, 4, [
        { wave: 'triangle', gain: 0.45, decay: 1, notes: chords.flatMap(([r], b) => bass(r - 24, b, [[0, 8], [8, 8]])) },
        { wave: 'sine', gain: 0.28, decay: 0.7, notes: chords.flatMap(([r, m], b) => arp([...triad(r, m), r + 12], b, 4, 12)) },
        { wave: 'square', gain: 0.1, decay: 0.3, lowpass: 2200, notes: chords.flatMap(([r, m], b) => at([[0, triad(r, m)[2] + 24, 6], [8, triad(r, m)[1] + 24, 6]], b)) },
      ]);
    },
  },
];

