// The sound maker's logic: a sound is a recipe (see the kit's sound.js): a length and a few layers, each a wave with a pitch that can glide, a volume and a fade.
// This builds and changes recipes, starts you from presets, mutates one for "surprise me", and reads and writes the file that holds a game's sounds:
//
//   export default { "coin": { "duration": 0.3, "layers": [ { "wave": "square", "freq": 988, ... } ] }, "jump": { ... } };

export const WAVES = ['sine', 'square', 'saw', 'triangle', 'noise'];
const clone = (s) => JSON.parse(JSON.stringify(s));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** Ranges the controls use (the kit applies its own limits again before anything plays). */
export const RANGES = {
  freq: [20, 8000], freqEnd: [20, 8000], gain: [0, 1], start: [0, 2], length: [0.01, 3], attack: [0.001, 0.5], decay: [0.005, 3], duty: [0.05, 0.95],
  lowpass: [100, 12000], lowpassEnd: [100, 12000],
};

/** A starter sound: one clean beep. */
export function newSound() {
  return { duration: 0.3, seed: 1, layers: [newLayer()] };
}

/** A starter layer. */
export function newLayer(wave = 'sine') {
  return { wave, freq: 440, gain: 0.8, decay: 0.1 };
}

/** Ready-made sounds to start from (all made of the same recipe parts, so each one can be changed). */
export const PRESETS = {
  coin: {
    duration: 0.35, seed: 1,
    layers: [{ wave: 'square', freq: 988, decay: 0.1, length: 0.08, gain: 0.45 },
      { wave: 'square', freq: 1319, start: 0.08, decay: 0.12, gain: 0.45 }],
  },
  jump: {
    duration: 0.18, seed: 1,
    layers: [{ wave: 'sine', freq: 260, freqEnd: 560, decay: 0.09, gain: 0.8 },
      { wave: 'triangle', freq: 130, freqEnd: 280, decay: 0.09, gain: 0.4 }],
  },
  hit: {
    duration: 0.12, seed: 1,
    layers: [{ wave: 'square', freq: 880, freqEnd: 330, decay: 0.03, gain: 0.5, duty: 0.4 },
      { wave: 'noise', lowpass: 5000, decay: 0.02, gain: 0.5 }],
  },
  laser: { duration: 0.25, seed: 1, layers: [{ wave: 'saw', freq: 1800, freqEnd: 200, decay: 0.12, gain: 0.5, lowpass: 6000 }] },
  powerup: {
    duration: 0.5, seed: 1,
    layers: [{ wave: 'saw', freq: 220, freqEnd: 880, decay: 0.3, gain: 0.5, lowpass: 3000 },
      { wave: 'sine', freq: 440, freqEnd: 1760, decay: 0.3, gain: 0.5 }],
  },
  explosion: {
    duration: 1, seed: 5,
    layers: [{ wave: 'noise', lowpass: 3500, lowpassEnd: 150, decay: 0.28, gain: 1 }, { wave: 'sine', freq: 85, freqEnd: 28, decay: 0.35, gain: 1 }],
  },
  click: { duration: 0.05, seed: 1, layers: [{ wave: 'square', freq: 1400, freqEnd: 900, decay: 0.01, gain: 0.5 }] },
  lose: {
    duration: 0.6, seed: 1,
    layers: [{ wave: 'triangle', freq: 400, freqEnd: 90, decay: 0.3, gain: 0.7 },
      { wave: 'square', freq: 200, freqEnd: 60, decay: 0.25, gain: 0.3, duty: 0.3 }],
  },
};

/** A copy of a preset. */
export function preset(name) {
  return clone(PRESETS[name] ?? PRESETS.coin);
}

/** Change one number of one layer, kept inside its range. */
export function setLayerValue(sound, i, key, value) {
  const next = clone(sound);
  const layer = next.layers[i];
  if (!layer) return sound;
  if (key === 'wave') { if (WAVES.includes(value)) layer.wave = value; return next; }
  const range = RANGES[key];
  if (!range || !Number.isFinite(value)) return sound;
  layer[key] = clamp(value, range[0], range[1]);
  return next;
}

/** Remove an optional number from a layer (for example the glide: `freqEnd`). */
export function clearLayerValue(sound, i, key) {
  const next = clone(sound);
  if (next.layers[i]) delete next.layers[i][key];
  return next;
}

/** Add a layer (at most 8). */
export function addLayer(sound, wave = 'sine') {
  if (sound.layers.length >= 8) return sound;
  const next = clone(sound);
  next.layers.push(newLayer(wave));
  return next;
}

/** Remove a layer (never the last one). */
export function removeLayer(sound, i) {
  if (sound.layers.length <= 1 || !sound.layers[i]) return sound;
  const next = clone(sound);
  next.layers.splice(i, 1);
  return next;
}

/** Change the length of the whole sound. */
export function setDuration(sound, seconds) {
  if (!Number.isFinite(seconds)) return sound;
  return { ...clone(sound), duration: clamp(seconds, 0.05, 3) };
}

/** A small random generator (the same seed gives the same numbers), so "surprise me" can be tested. */
export function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

/**
 * A variation of a sound: pitches, fades and volumes nudged, sometimes a wave swapped. Every result is a sound the kit will play.
 * @param {object} sound
 * @param {number} seed
 * @param {number} [amount] how far to wander, 0 to 1
 */
export function mutate(sound, seed, amount = 0.4) {
  const rand = rng(seed);
  const next = clone(sound);
  const wiggle = (v, lo, hi) => clamp(v * (1 + (rand() * 2 - 1) * amount), lo, hi);
  next.duration = wiggle(next.duration, 0.05, 3);
  for (const layer of next.layers) {
    layer.freq = wiggle(layer.freq ?? 440, ...RANGES.freq);
    if (layer.freqEnd !== undefined) layer.freqEnd = wiggle(layer.freqEnd, ...RANGES.freqEnd);
    layer.gain = clamp((layer.gain ?? 0.8) * (0.8 + rand() * 0.4), 0.1, 1);
    if (layer.decay !== undefined) layer.decay = wiggle(layer.decay, ...RANGES.decay);
    if (rand() < amount * 0.25) layer.wave = WAVES[Math.floor(rand() * WAVES.length)];
  }
  next.seed = Math.floor(rand() * 1000) + 1;
  return next;
}

/** All of a game's sounds as the text of a file. */
export function serializeSounds(sounds) {
  const body = Object.entries(sounds).map(([name, s]) => `  ${JSON.stringify(name)}: ${JSON.stringify(s)}`).join(',\n');
  const note = '// Made with the studio\'s sound maker. Each sound is a recipe: layers of waves with a pitch, a volume and a fade.';
  return `${note}\n// Use them with sounds(...) and play('name') from @engine/arcade.\nexport default {\n${body}\n};\n`;
}

/** Read a sounds file. Throws an Error that says what is wrong. */
export function parseSounds(text) {
  const m = /export\s+default\s+([\s\S]*?);?\s*$/.exec(String(text ?? ''));
  if (!m) throw new Error('This file is not a list of sounds: it should say "export default { ... }".');
  let data;
  try {
    data = JSON.parse(m[1]);
  } catch {
    throw new Error('This sounds file has been edited into something the sound maker cannot read. '
      + 'Keep the part after "export default" as plain JSON.');
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('The sounds file should hold an object of named sounds.');
  for (const [name, s] of Object.entries(data)) {
    const usable = /^[a-z][\w-]{0,31}$/i.test(name) && s && Array.isArray(s.layers) && s.layers.length;
    if (!usable) throw new Error(`The sound "${name.slice(0, 32)}" is not a usable recipe.`);
  }
  return data;
}

/** A name for a new sound that is not taken (coin, coin2, coin3...). */
export function freeName(sounds, wanted) {
  const base = String(wanted).replace(/[^\w-]/g, '').replace(/^[^a-z]+/i, '') || 'sound';
  if (!(base in sounds)) return base;
  for (let n = 2; n < 1000; n++) if (!(`${base}${n}` in sounds)) return `${base}${n}`;
  return `${base}${Date.now()}`;
}

/** Points to draw the sound's shape: the loudest part of each slice of its length (made from the samples the synth gives back). */
export function outline(samples, points = 120) {
  const out = [];
  const step = Math.max(1, Math.floor(samples.length / points));
  for (let i = 0; i < samples.length; i += step) {
    let peak = 0;
    for (let j = i; j < Math.min(samples.length, i + step); j++) peak = Math.max(peak, Math.abs(samples[j]));
    out.push(peak);
  }
  return out;
}
