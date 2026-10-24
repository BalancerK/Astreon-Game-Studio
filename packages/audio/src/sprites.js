/**
 * Audio sprites: many short sounds in one file. A game with sixty effects makes sixty requests and decodes sixty buffers; with a sprite it makes one, and plays *regions* of it by name
 * (`audio.playSprite(sprite, 'shot')`). `packSounds` builds the one buffer from separate sounds (including ones made in code) and the map of where each lies; a sprite file made by another
 * tool comes with its own map (`spriteMapFromMs` reads the common `{ name: [startMs, lengthMs, loop?] }` form).
 */

/**
 * A region of a sprite, in seconds.
 * @typedef {{start: number, duration: number, loop: boolean}} SpriteRegion
 */

/** One sound with named regions. Make it with `AudioEngine.createSprite`. */
export class AudioSprite {
  /**
   * @param {import('./engine.js').Sound} sound The one sound holding everything.
   * @param {Record<string, [number, number] | [number, number, boolean] | {start: number, duration: number, loop?: boolean}>} map Region by name, in seconds: `[start, duration, loop?]` or `{ start, duration, loop }`.
   */
  constructor(sound, map) {
    this.sound = sound;
    /** @type {Map<string, SpriteRegion>} */
    this.regions = new Map();
    for (const [name, r] of Object.entries(map)) {
      const region = Array.isArray(r) ? { start: r[0], duration: r[1], loop: !!r[2] } : { start: r.start, duration: r.duration, loop: !!r.loop };
      if (!(region.start >= 0) || !(region.duration > 0)) throw new Error(`sprite region "${name}" needs a start from 0 and a length above 0`);
      if (sound.duration !== undefined && region.start >= sound.duration) throw new Error(`sprite region "${name}" starts at ${region.start} s, past the end of the sound (${sound.duration.toFixed(3)} s)`);
      this.regions.set(name, region);
    }
  }
  /** The names of the regions. */
  get names() { return [...this.regions.keys()]; }
  has(name) { return this.regions.has(name); }
  /** @returns {SpriteRegion} */
  region(name) {
    const r = this.regions.get(name);
    if (!r) throw new Error(`the sprite has no region "${name}" (it has ${this.names.join(', ') || 'none'})`);
    return r;
  }
}

/**
 * Read a sprite map written in milliseconds, the form many sprite tools and libraries use: `{ shot: [0, 450], music: [1000, 8000, true] }`.
 * @param {Record<string, [number, number] | [number, number, boolean]>} ms @returns {Record<string, [number, number, boolean]>} the same in seconds
 */
export function spriteMapFromMs(ms) {
  const out = {};
  for (const [name, r] of Object.entries(ms)) out[name] = [r[0] / 1000, r[1] / 1000, !!r[2]];
  return out;
}

/**
 * Join sounds into one buffer with a little silence between them, and say where each is. Give it what `synthesize` returns (`{ sampleRate, data }`), keyed by name; all must share one sample rate.
 * Pass the result to `AudioEngine.createSprite` (or `createSound` and `new AudioSprite`).
 * @param {Record<string, {sampleRate: number, data: Float32Array}>} sounds
 * @param {{gap?: number, loop?: string[]}} [o] `gap`: seconds of silence between sounds (0.05); `loop`: names that loop.
 * @returns {{sampleRate: number, data: Float32Array, map: Record<string, [number, number, boolean]>}}
 */
export function packSounds(sounds, { gap = 0.05, loop = [] } = {}) {
  const names = Object.keys(sounds);
  if (names.length === 0) throw new Error('packSounds needs at least one sound');
  const rate = sounds[names[0]].sampleRate;
  for (const n of names) if (sounds[n].sampleRate !== rate) throw new Error(`"${n}" is ${sounds[n].sampleRate} Hz but "${names[0]}" is ${rate} Hz: render them at one rate`);
  const pad = Math.round(gap * rate);
  let total = 0; for (const n of names) total += sounds[n].data.length + pad;
  const data = new Float32Array(total), map = {};
  let at = 0;
  for (const n of names) {
    data.set(sounds[n].data, at);
    map[n] = [at / rate, sounds[n].data.length / rate, loop.includes(n)];
    at += sounds[n].data.length + pad;
  }
  return { sampleRate: rate, data, map };
}
