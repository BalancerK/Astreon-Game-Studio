// Sound: a sound is a small recipe (a synth spec: layers of waves with a pitch, a length and a fade), so it is plain data like everything else, can be made in
// the studio's sound maker and kept in a text file. `play` does not make any noise itself: the game runs in a worker with no speakers, so it sends the recipe
// to the page that does, which makes the sound and plays it.

import { isAssetPath } from './assets.js';
import { effectsLevel } from './settings.js';

const WAVES = new Set(['sine', 'square', 'saw', 'triangle', 'noise']);
const LAYER_KEYS = ['freq', 'freqEnd', 'gain', 'start', 'length', 'attack', 'decay', 'duty', 'lowpass', 'lowpassEnd'];
const MAX_LAYERS = 8;

let registry = {};
let sink = (message) => { globalThis.postMessage?.(message); };

/**
 * Clean up a sound recipe that came from outside (the game's worker is not trusted by the page that plays it): only known fields, numbers that are numbers
 * and in a safe range, at most 3 seconds and 8 layers.
 * @param {unknown} spec
 * @returns {object | null} a clean copy, or null if it is not a usable recipe
 */
export function cleanSound(spec) {
  if (spec && typeof spec === 'object' && spec.file !== undefined) {         // a sound file from the project's assets folder
    return isAssetPath(spec.file) && /\.(wav|mp3|ogg)$/i.test(spec.file) ? { file: spec.file } : null;
  }
  if (!spec || typeof spec !== 'object' || !Array.isArray(spec.layers) || !spec.layers.length || spec.layers.length > MAX_LAYERS) return null;
  const num = (v, lo, hi) => (Number.isFinite(v) && v >= lo && v <= hi ? v : undefined);
  const duration = num(spec.duration ?? 0.3, 0.01, 3);
  if (duration === undefined) return null;
  const layers = [];
  for (const l of spec.layers) {
    if (!l || typeof l !== 'object') return null;
    const out = { wave: WAVES.has(l.wave) ? l.wave : 'sine' };
    for (const k of LAYER_KEYS) {
      if (l[k] === undefined) continue;
      const v = num(l[k], k === 'gain' || k === 'duty' ? 0 : 0.0001, k === 'freq' || k === 'freqEnd' || k.startsWith('lowpass') ? 20000 : 100);
      if (v === undefined) return null;
      out[k] = v;
    }
    if (l.vibrato && typeof l.vibrato === 'object') {
      const rate = num(l.vibrato.rate, 0, 50);
      const depth = num(l.vibrato.depth, 0, 1);
      if (rate !== undefined && depth !== undefined) out.vibrato = { rate, depth };
    }
    layers.push(out);
  }
  return { duration, seed: Number.isInteger(spec.seed) ? spec.seed : 1, gain: num(spec.gain ?? 1, 0, 4) ?? 1, layers };
}

/**
 * Give the sounds names, so a game can say `play('coin')`. A sound is a recipe, or a sound file you imported: `{ file: 'assets/jump.wav' }`. Call it once, at the top of the game's file, with an object of recipes.
 * @param {Object<string, object>} sounds for example what you made in the sound maker
 */
export function sounds(sounds) {
  registry = { ...sounds };
}

/**
 * Play a sound: a name given to {@link sounds}, or a recipe.
 * @param {string | object} sound
 * @param {number} [volume] 0 to 1
 */
export function play(sound, volume = 1) {
  const spec = typeof sound === 'string' ? registry[sound] : sound;
  if (!spec) {
    const known = Object.keys(registry);
    throw new Error(`There is no sound called "${sound}"${known.length ? ` (the sounds are: ${known.join(', ')})` : '. Give your sounds names with sounds({ ... }) first'}.`);
  }
  sink({ t: 'sound', spec, volume: Math.max(0, Math.min(1, (Number(volume) || 0) * effectsLevel())) });      // the player's volume settings apply
}

/** Send a message to the page that makes the noise (what `play` does, for the music functions too). */
export function send(message) {
  sink(message);
}

/**
 * Choose where played sounds go (for tests, or a host that is not the studio). The default sends them to the page the game runs in.
 * @param {(message: {t: 'sound', spec: object, volume: number}) => void} fn
 */
export function setSoundSink(fn) {
  sink = fn;
}
