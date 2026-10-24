/**
 * Sound effects and music made in code: no audio files needed. Everything here is plain maths on `Float32Array`s, so it runs in
 * Node (tests, tools) as well as in the browser; `AudioEngine.createSound` turns the result into a playable sound.
 *
 * @typedef {Object} SynthLayer One voice of a sound: an oscillator or noise with an envelope.
 * @property {'sine' | 'square' | 'saw' | 'triangle' | 'noise'} [wave]
 * @property {number} [freq] Hz (default 440)
 * @property {number} [freqEnd] Hz at the end of the layer: the pitch glides there exponentially
 * @property {number} [gain] 0..1 (default 1)
 * @property {number} [start] Seconds into the sound the layer begins (default 0)
 * @property {number} [length] Seconds the layer lasts (default: until the end of the sound)
 * @property {number} [attack] Seconds to rise to full level (default 0.002)
 * @property {number} [decay] Time constant of the exponential fall after the attack, seconds (default: a quarter of the length)
 * @property {number} [duty] Square wave pulse width 0..1 (default 0.5)
 * @property {number} [lowpass] Cut-off in Hz of a one-pole low-pass filter
 * @property {number} [lowpassEnd] Cut-off at the end (the filter sweeps there)
 * @property {{rate: number, depth: number}} [vibrato] Pitch wobble: `depth` is the fraction of the frequency (0.02 = 2%)
 *
 * @typedef {Object} SynthSpec
 * @property {number} [duration] Seconds (default 0.3)
 * @property {number} [sampleRate] Default 44100
 * @property {number} [seed] Seed for noise (default 1): the same spec always makes the same sound
 * @property {number} [gain] Overall level before the peak limit (default 1)
 * @property {number} [peak] The result is scaled down if it would peak above this (default 0.9)
 * @property {SynthLayer[]} [layers]
 */

/** @typedef {{sampleRate: number, data: Float32Array}} PcmSound Mono samples in -1..1 */

function rng(seed) { let s = seed >>> 0 || 1; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }

const TWO_PI = Math.PI * 2;

/**
 * Render a spec into mono samples.
 * @param {SynthSpec} spec
 * @returns {PcmSound}
 */
export function synthesize({ duration = 0.3, sampleRate = 44100, seed = 1, gain = 1, peak = 0.9, layers = [] } = {}) {
  if (!(duration > 0 && duration <= 60)) throw new Error(`duration must be 0..60 seconds (got ${duration})`);
  if (!(sampleRate >= 8000 && sampleRate <= 192000)) throw new Error(`sampleRate must be 8000..192000 (got ${sampleRate})`);
  const length = Math.round(duration * sampleRate), data = new Float32Array(length);
  const rand = rng(seed);
  for (const layer of layers) {
    const {
      wave = 'sine', freq = 440, freqEnd = freq, gain: g = 1, start = 0, attack = 0.002, duty = 0.5, lowpass, vibrato,
    } = layer;
    const first = Math.max(0, Math.round(start * sampleRate)), len = Math.min(length - first, Math.round((layer.length ?? duration - start) * sampleRate));
    if (len <= 0) continue;
    const decay = layer.decay ?? (len / sampleRate) / 4;
    const lowEnd = layer.lowpassEnd ?? lowpass;
    let phase = 0, filtered = 0;
    const release = Math.min(len, Math.round(0.004 * sampleRate)); // a few ms of fade at the end of every layer: no click
    for (let i = 0; i < len; i++) {
      const t = i / sampleRate, u = len > 1 ? i / (len - 1) : 0;
      let f = freq * Math.pow(freqEnd / freq, u);
      if (vibrato) f *= 1 + vibrato.depth * Math.sin(TWO_PI * vibrato.rate * t);
      phase += f / sampleRate;
      phase -= Math.floor(phase);
      let x;
      switch (wave) {
        case 'sine': x = Math.sin(TWO_PI * phase); break;
        case 'square': x = phase < duty ? 1 : -1; break;
        case 'saw': x = 2 * phase - 1; break;
        case 'triangle': x = 4 * Math.abs(phase - 0.5) - 1; break;
        case 'noise': x = rand() * 2 - 1; break;
        default: throw new Error(`unknown wave "${wave}"`);
      }
      if (lowpass) {
        const cutoff = lowpass * Math.pow(lowEnd / lowpass, u);
        filtered += (1 - Math.exp(-TWO_PI * cutoff / sampleRate)) * (x - filtered);
        x = filtered;
      }
      const env = (t < attack ? t / attack : 1) * Math.exp(-Math.max(0, t - attack) / decay);
      const fade = i >= len - release ? (len - 1 - i) / release : 1;
      data[first + i] += x * env * g * fade;
    }
  }
  let max = 0;
  for (let i = 0; i < length; i++) { data[i] *= gain; if (Math.abs(data[i]) > max) max = Math.abs(data[i]); }
  if (max > peak) { const k = peak / max; for (let i = 0; i < length; i++) data[i] *= k; }
  return { sampleRate, data };
}

// ---------- ready-made sound effects ----------

/**
 * A small library of game sounds as specs, so a prototype has sound from the first minute. Each takes an optional `variation`
 * (any number) so repeated sounds (footsteps, shots) are not identical.
 */
export const sfx = {
  /** A gunshot: a crack of noise on a thump. */
  shot: (v = 0) => ({ duration: 0.28, seed: 11 + v, layers: [
    { wave: 'noise', lowpass: 7000, lowpassEnd: 1200, decay: 0.05, gain: 0.9 },
    { wave: 'sine', freq: 190, freqEnd: 45, decay: 0.07, gain: 1 },
  ] }),
  /** A bullet landing: a short sharp tick. */
  hit: () => ({ duration: 0.12, layers: [
    { wave: 'square', freq: 880, freqEnd: 330, decay: 0.03, gain: 0.5, duty: 0.4 },
    { wave: 'noise', lowpass: 5000, decay: 0.02, gain: 0.5 },
  ] }),
  /** A bright confirmation ping (a hit marker). */
  ping: () => ({ duration: 0.2, layers: [
    { wave: 'sine', freq: 1568, decay: 0.05, gain: 0.7 }, { wave: 'sine', freq: 2349, decay: 0.035, gain: 0.35 },
  ] }),
  explosion: () => ({ duration: 1.1, seed: 5, layers: [
    { wave: 'noise', lowpass: 3500, lowpassEnd: 150, decay: 0.28, gain: 1 },
    { wave: 'sine', freq: 85, freqEnd: 28, decay: 0.35, gain: 1 },
  ] }),
  jump: () => ({ duration: 0.18, layers: [{ wave: 'sine', freq: 260, freqEnd: 560, decay: 0.09, gain: 0.8 }, { wave: 'triangle', freq: 130, freqEnd: 280, decay: 0.09, gain: 0.4 }] }),
  land: () => ({ duration: 0.16, seed: 3, layers: [
    { wave: 'noise', lowpass: 900, decay: 0.04, gain: 0.8 }, { wave: 'sine', freq: 95, freqEnd: 50, decay: 0.05, gain: 0.9 },
  ] }),
  footstep: (v = 0) => ({ duration: 0.11, seed: 21 + v * 7, layers: [
    { wave: 'noise', lowpass: 650 + (v % 3) * 140, decay: 0.03, gain: 0.9 }, { wave: 'sine', freq: 70 + (v % 4) * 8, freqEnd: 45, decay: 0.03, gain: 0.5 },
  ] }),
  click: () => ({ duration: 0.05, layers: [{ wave: 'square', freq: 1400, freqEnd: 900, decay: 0.01, gain: 0.5 }] }),
  coin: () => ({ duration: 0.35, layers: [
    { wave: 'square', freq: 988, decay: 0.1, length: 0.08, gain: 0.45 }, { wave: 'square', freq: 1319, start: 0.08, decay: 0.12, gain: 0.45 },
  ] }),
  powerup: () => ({ duration: 0.5, layers: [{ wave: 'saw', freq: 220, freqEnd: 880, decay: 0.3, gain: 0.5, lowpass: 3000 }, { wave: 'sine', freq: 440, freqEnd: 1760, decay: 0.3, gain: 0.5 }] }),
  alarm: () => ({ duration: 0.8, layers: [{ wave: 'square', freq: 700, freqEnd: 700, decay: 5, gain: 0.35, vibrato: { rate: 5, depth: 0.3 } }] }),
};

// ---------- a tiny music sequencer ----------

const NOTE_OFFSETS = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };

/** Frequency in Hz of a note name like 'A4', 'C#3' or 'Bb2' (A4 = 440). */
export function noteFrequency(name) {
  const m = /^([A-G][#b]?)(-?\d)$/.exec(name);
  if (!m || !(m[1] in NOTE_OFFSETS)) throw new Error(`not a note name: "${name}"`);
  return 440 * Math.pow(2, (NOTE_OFFSETS[m[1]] + (Number(m[2]) + 1) * 12 - 69) / 12);
}

/**
 * Render a looping tune. Each track is a list of `[note, beats]` (note `null` is a rest, a list of names is a chord); tracks play together. The result is
 * exactly `beats * 60 / bpm` seconds long and starts and ends silent, so it loops without a click.
 * @param {{bpm?: number, sampleRate?: number, tracks: {wave?: SynthLayer['wave'], gain?: number, decay?: number, lowpass?: number, notes: [string | null, number][]}[]}} spec
 * @returns {PcmSound}
 */
export function sequence({ bpm = 120, sampleRate = 44100, tracks }) {
  const beat = 60 / bpm;
  let total = 0;
  for (const tr of tracks) total = Math.max(total, tr.notes.reduce((n, [, b]) => n + b, 0));
  const layers = [];
  for (const tr of tracks) {
    let at = 0;
    for (const [note, beats] of tr.notes) {
      // a chord is a list of names: every one sounds for the whole length
      for (const name of Array.isArray(note) ? note : [note]) if (name) layers.push({ wave: tr.wave ?? 'square', freq: noteFrequency(name), start: at * beat, length: beats * beat, attack: 0.004, decay: tr.decay ?? beats * beat * 0.6, gain: tr.gain ?? 0.3, lowpass: tr.lowpass, duty: 0.35 });
      at += beats;
    }
  }
  return synthesize({ duration: total * beat, sampleRate, layers, peak: 0.85 });
}

/** A ready-made calm loop for menus and ambience: a slow bass line under a soft arpeggio (8 seconds at 120 bpm). */
export function ambientLoop(sampleRate = 44100) {
  const arp = ['A3', 'C4', 'E4', 'C4', 'G3', 'B3', 'D4', 'B3', 'F3', 'A3', 'C4', 'A3', 'G3', 'B3', 'D4', 'B3'];
  return sequence({
    bpm: 120, sampleRate,
    tracks: [
      { wave: 'triangle', gain: 0.5, decay: 1.4, notes: [['A2', 4], ['G2', 4], ['F2', 4], ['G2', 4]] },
      { wave: 'sine', gain: 0.22, decay: 0.45, notes: arp.flatMap((n) => [[n, 1], [null, 0]]) },
      { wave: 'saw', gain: 0.07, decay: 3, lowpass: 900, notes: [['E3', 8], ['D3', 8]] },
    ],
  });
}
