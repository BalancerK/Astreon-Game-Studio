/**
 * Music that follows the game. A tune is split into layers (stems: drums, bass, pad, lead...) that are all the same length. They start at the same instant and loop together, so they never
 * drift apart, and you only change how loud each one is: more layers as the fight heats up, fewer when it is quiet. You can also play a short sound (a stinger) exactly on the next beat or
 * bar, so a jingle lands in time with the music instead of across it.
 *
 *   const music = audio.playLayers({ pad, bass, drums, lead }, { bpm: 132, levels: { pad: 0, bass: 0.25, drums: 0.5, lead: 0.8 } });
 *   music.setIntensity(0.6, 2);                  // bass and drums are in, the lead is not yet; changes glide over two seconds
 *   music.stinger(victoryJingle, { quantize: 'bar' });
 */

/**
 * @typedef {Object} LayeredOptions
 * @property {string} [bus] default 'music'
 * @property {number} [volume] overall level 0..1+ (default 1)
 * @property {number} [fade] seconds the music takes to fade in (default 1.5)
 * @property {number} [bpm] The tempo, for `stinger` and `untilBeat`
 * @property {number} [beatsPerBar] default 4
 * @property {Record<string, number | {at: number, width?: number, max?: number}>} [levels] When each layer is heard as the intensity (0..1) rises. A number is the intensity at which the layer starts
 *   (it is full over the next 0.2); an object gives `at`, `width` (the rise) and `max` (its top level). A layer with no entry is always full. Default intensity 0.
 * @property {number} [intensity] The starting intensity (default 0)
 */

const clamp01 = (v) => Math.max(0, Math.min(1, v));

/** Layers of one tune that play in time together, with a volume each that follows an intensity, and stingers that land on the beat. Made by `AudioEngine.playLayers`. */
export class LayeredMusic {
  /**
   * @param {import('./engine.js').AudioEngine} engine @param {Record<string, import('./engine.js').Sound>} layers @param {LayeredOptions} [o]
   */
  constructor(engine, layers, { bus = 'music', volume = 1, fade = 1.5, bpm = 0, beatsPerBar = 4, levels = {}, intensity = 0 } = {}) {
    const names = Object.keys(layers);
    if (!names.length) throw new Error('layered music needs at least one layer');
    const length = layers[names[0]].duration;
    for (const n of names) if (Math.abs(layers[n].duration - length) > 0.002) throw new Error(`layer "${n}" is ${layers[n].duration.toFixed(3)} s long, not ${length.toFixed(3)} s like "${names[0]}": layers must be the same length to stay in time`);
    this.engine = engine; this.bus = bus; this.length = length; this.bpm = bpm; this.beatsPerBar = beatsPerBar; this.volume = volume;
    this.fade = fade; this.intensity = clamp01(intensity); this.stopped = false;
    this.manual = new Map();                                        // layers set by hand (they ignore the intensity until `setIntensity` is called again)
    this.levels = {};
    for (const n of names) {
      const l = levels[n];
      this.levels[n] = l === undefined ? { at: 0, width: 0.0001, max: 1 } : typeof l === 'number' ? { at: l, width: 0.2, max: 1 } : { at: l.at, width: l.width ?? 0.2, max: l.max ?? 1 };
    }
    const when = engine.context.currentTime;
    this.startedAt = when + 0.06;                                   // every layer is asked to start in the same instant, a moment from now
    this.voices = {};
    for (const n of names) {
      this.voices[n] = engine.play(layers[n], { bus, loop: true, volume: 0, delay: 0.06, priority: 100, key: `music:${n}` });
    }
    this.#apply(fade);
  }

  /** True until `stop` is called. */
  get playing() { return !this.stopped; }

  #target(name) {
    const m = this.manual.get(name);
    if (m !== undefined) return m * this.volume;
    const l = this.levels[name];
    return this.volume * l.max * clamp01((this.intensity - l.at) / Math.max(1e-4, l.width) + (l.at <= 0 ? 1 : 0));
  }

  #apply(time) {
    for (const [name, voice] of Object.entries(this.voices)) voice?.setVolume(this.#target(name), time);
  }

  /** How loud each layer is meant to be right now (0..1+). */
  levelsNow() { return Object.fromEntries(Object.keys(this.voices).map((n) => [n, this.#target(n)])); }

  /** Set the intensity, 0 (calm) to 1 (everything), gliding over `fade` seconds. Layers set by hand with `setLayer` follow the intensity again. */
  setIntensity(value, fade = 1) {
    if (this.stopped) return;
    this.intensity = clamp01(value);
    this.manual.clear();
    this.#apply(fade);
  }

  /** Set one layer's level by hand, gliding over `fade` seconds. */
  setLayer(name, level, fade = 1) {
    if (this.stopped || !this.voices[name]) return;
    this.manual.set(name, Math.max(0, level));
    this.voices[name].setVolume(this.#target(name), fade);
  }

  /** The overall level of the whole tune (its layers keep their balance). */
  setVolume(volume, fade = 0) { this.volume = Math.max(0, volume); if (!this.stopped) this.#apply(fade); }

  /** Seconds into the loop now. */
  get position() { return Math.max(0, (this.engine.context.currentTime - this.startedAt) % this.length); }

  /** Seconds until the next beat (or bar, with `'bar'`). Needs the tempo (`bpm`). */
  untilBeat(unit = 'beat') {
    if (!(this.bpm > 0)) return 0;
    const span = (60 / this.bpm) * (unit === 'bar' ? this.beatsPerBar : 1), t = this.engine.context.currentTime - this.startedAt;
    if (t < 0) return -t;
    const into = t % span;
    return into < 1e-3 ? 0 : span - into;
  }

  /**
   * Play a short sound so that it lands on the next beat or bar of the music (`quantize: 'beat' | 'bar'`; null plays it at once).
   * @param {import('./engine.js').Sound} sound @param {{quantize?: 'beat' | 'bar' | null, bus?: string, volume?: number, duckMusic?: number}} [o]
   * @returns the voice, or null
   */
  stinger(sound, { quantize = 'beat', bus = this.bus, volume = 1, duckMusic = 0 } = {}) {
    if (this.stopped) return null;
    const delay = quantize ? this.untilBeat(quantize) : 0;
    if (duckMusic > 0) {                                           // dip the music under the stinger for its length
      for (const [name, voice] of Object.entries(this.voices)) voice?.setVolume(this.#target(name) * (1 - duckMusic), 0.1);
      const restore = () => { if (!this.stopped) this.#apply(0.6); };
      globalThis.setTimeout?.(restore, (delay + sound.duration) * 1000);
    }
    return this.engine.play(sound, { bus, volume, delay, priority: 50 });
  }

  /** Fade out and stop every layer. */
  stop(fade = 1) {
    if (this.stopped) return;
    this.stopped = true;
    for (const v of Object.values(this.voices)) v?.stop(fade);
  }
}
