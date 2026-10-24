import { VoicePool } from './voices.js';
import { createListener, setListenerFromYawPitch, spatialize } from './spatial.js';
import { synthesize } from './synth.js';
import { buildEffect, occlusionFrequency } from './effects.js';
import { AudioSprite } from './sprites.js';
import { StreamedTrack } from './stream.js';

/**
 * @typedef {Object} Sound A sound ready to play. Make one with `AudioEngine.createSound` or `load`.
 * @property {string} name
 * @property {AudioBuffer} buffer
 * @property {number} duration Seconds
 * @property {string} key Unique id (the per-sound voice limit counts by it)
 *
 * @typedef {Object} PlayOptions
 * @property {string} [bus] Which bus it plays on (default 'sfx')
 * @property {number} [volume] 0..1+ (default 1)
 * @property {number} [pitch] Playback speed: 2 is an octave up (default 1)
 * @property {number} [pitchVariation] Random pitch change, +/- this fraction (0.05 = 5%): repeated sounds stop sounding identical
 * @property {boolean} [loop]
 * @property {number} [pan] -1 (left) .. 1 (right) for sounds with no position
 * @property {number[] | null} [position] [x, y, z] in the world: the sound is placed relative to the listener (distance and left/right)
 * @property {'inverse' | 'linear' | 'exponential'} [model] Distance model for positioned sounds (default 'inverse')
 * @property {number} [refDistance] Full volume closer than this (default 1)
 * @property {number} [maxDistance] Silent beyond this (default 50); one-shots that far away are not started at all
 * @property {number} [rolloff] How fast volume falls with distance (default 1)
 * @property {number} [priority] When voices run out, lower priority gives way first (default 0)
 * @property {number} [maxPerSound] At most this many copies of this sound at once
 * @property {number} [fadeIn] Seconds
 * @property {number} [delay] Seconds from now
 * @property {number} [offset] Start this many seconds into the sound
 * @property {number} [duration] Play only this many seconds from `offset` (a region of a longer sound; `playSprite` sets it). Without `loop`.
 * @property {number} [loopStart] With `loop`: go back to this time (seconds into the sound) at the end of the loop. @property {number} [loopEnd] With `loop`: the end of the looped part.
 * @property {string} [key] What the per-sound voice limit counts this by (default: the sound; `playSprite` uses the sprite and the region)
 * @property {number} [occlusion] 0 (clear) to 1 (heard through a thick wall): dulls and quietens this sound; change it later with `voice.setOcclusion`
 * @property {() => void} [onEnded]
 */

const DEFAULT_BUSES = ['sfx', 'music', 'ui', 'voice'];
// Touching a screen counts as a user gesture only when the finger lifts, not when it lands (a touch pointerdown does not unlock audio)
const GESTURE_EVENTS = ['pointerdown', 'pointerup', 'mousedown', 'click', 'keydown', 'touchend'];
const isTouchStart = (e) => e?.type === 'pointerdown' && e.pointerType === 'touch';
let nextSoundKey = 1;

/**
 * Run `callback` once, at the first click, key press or touch. Browsers only let a page make sound after such a gesture (and log a
 * warning if you create an `AudioContext` earlier), so the cleanest way to start audio is to create the engine in here.
 * @param {() => void} callback
 * @param {EventTarget} [target]
 * @returns {() => void} cancel
 */
export function onUserGesture(callback, target = globalThis) {
  const events = GESTURE_EVENTS;
  let done = false;
  const cancel = () => { for (const e of events) target.removeEventListener(e, handler, true); };
  function handler(e) { if (isTouchStart(e) || done) return; done = true; cancel(); callback(); }
  for (const e of events) target.addEventListener(e, handler, true);
  return cancel;
}

/**
 * Sound for games on the Web Audio API: a mixer of named buses (master, sfx, music, ui, voice, or your own), voice limiting
 * with priorities, positional sound relative to a listener (distance fall-off and left/right panning), music with cross-fades,
 * and sounds that can be made in code (see `synth.js`) so a game needs no audio files to start.
 *
 * Browsers keep audio silent until the player has interacted with the page; the engine listens for the first click, key press
 * or touch and starts then (`unlockOnGesture`). Until it is running, one-shot sounds are skipped (a burst of stale sounds
 * would play the moment it unlocks) while looping music is kept waiting.
 */
export class AudioEngine {
  /**
   * @param {object} [o]
   * @param {BaseAudioContext} [o.context] Use this context (for example an `OfflineAudioContext` in a test); default: a new `AudioContext`
   * @param {string[]} [o.buses] Extra bus names besides 'master'
   * @param {number} [o.maxVoices] Sounds playing at once (default 48)
   * @param {boolean} [o.compressor] A limiter on the master output so loud pile-ups do not clip: a compressor, then a soft clipper that
   *   never exceeds +-1 (default true). It adds about 3 dB of make-up gain to quiet sounds (that is how Web Audio compressors work).
   * @param {boolean} [o.unlock] Start on the first user gesture (default true when there is a page)
   * @param {boolean} [o.pauseWhenHidden] Suspend audio while the tab is hidden (default true)
   * @param {boolean} [o.skipWhenSuspended] Skip one-shot sounds while the context is not running (default true; an offline context renders
   *   from 'suspended', so give it false)
   */
  constructor({ context, buses = DEFAULT_BUSES, maxVoices = 48, compressor = true, unlock = true, pauseWhenHidden = true, skipWhenSuspended = true } = {}) {
    this.skipWhenSuspended = skipWhenSuspended;
    const Ctor = globalThis.AudioContext ?? globalThis.webkitAudioContext;
    if (!context && !Ctor) throw new Error('Web Audio is not available here');
    this.ownsContext = !context;
    this.context = context ?? new Ctor({ latencyHint: 'interactive' });
    const ctx = this.context;
    this.listener = createListener();
    this.pool = new VoicePool({ max: maxVoices });
    /** @type {Set<object>} */
    this.voices = new Set();
    this.stats = { played: 0, culled: 0, stolen: 0, denied: 0, skipped: 0 };
    this.music = null;
    this.musicSound = null;
    this.scratch = { gain: 0, pan: 0, distance: 0 };

    const master = ctx.createGain();
    let masterHead = ctx.destination;
    if (compressor && ctx.createDynamicsCompressor) {
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -10; comp.knee.value = 12; comp.ratio.value = 6; comp.attack.value = 0.003; comp.release.value = 0.15;
      masterHead = comp;
      this.compressor = comp;
      let tail = comp;
      if (ctx.createWaveShaper) { // and a soft clipper after it: tanh never goes beyond +-1, whatever the pile-up
        const shaper = ctx.createWaveShaper();
        const curve = new Float32Array(4097);
        for (let i = 0; i < curve.length; i++) curve[i] = Math.tanh((i / 2048 - 1) * 4) / Math.tanh(4) * 0.985;
        shaper.curve = curve;
        comp.connect(shaper);
        tail = shaper;
        this.softClipper = shaper;
      }
      tail.connect(ctx.destination);
    }
    /** A bus is a gain (its volume, where voices connect), then its effects, then a gain for ducking, then the next bus (master, then the limiter). */
    this.buses = new Map();
    this.duckRules = [];
    const makeBus = (node, down) => {
      const duck = ctx.createGain();
      node.connect(duck); duck.connect(down);
      return { node, duck, down, volume: 1, muted: false, effects: [], duckLevel: 1 };
    };
    this.buses.set('master', makeBus(master, masterHead));
    for (const name of buses) {
      if (name === 'master' || this.buses.has(name)) throw new Error(`bus "${name}" is reserved or listed twice`);
      this.buses.set(name, makeBus(ctx.createGain(), master));
    }

    if (unlock && globalThis.addEventListener) this.unlockOnGesture();
    if (pauseWhenHidden && globalThis.document?.addEventListener) {
      this.visibilityHandler = () => { if (globalThis.document.hidden) this.suspend(); else this.resume(); };
      globalThis.document.addEventListener('visibilitychange', this.visibilityHandler);
    }
  }

  /** 'running', 'suspended' or 'closed'. Sounds only play while 'running'. */
  get state() { return this.context.state; }

  /** Number of voices playing right now. */
  get activeVoices() { return this.voices.size; }

  resume() { return this.context.state === 'closed' ? Promise.resolve() : Promise.resolve(this.context.resume?.()); }
  suspend() { return this.context.state === 'closed' ? Promise.resolve() : Promise.resolve(this.context.suspend?.()); }

  /**
   * Start the audio at the first click, key press or touch on `target` (browsers require a gesture).
   * @param {EventTarget} [target]
   */
  unlockOnGesture(target = globalThis) {
    const events = GESTURE_EVENTS;
    const handler = (e) => {
      if (isTouchStart(e)) return;
      this.resume().then(() => {
        if (this.music?.blocked) this.music.start();                      // a streamed track the browser would not start before a gesture
        if (this.context.state === 'running') for (const e of events) target.removeEventListener(e, handler, true);
      });
    };
    for (const e of events) target.addEventListener(e, handler, true);
    this.unlockCleanup = () => { for (const e of events) target.removeEventListener(e, handler, true); };
  }

  // ---------- buses ----------

  #bus(name) {
    const b = this.buses.get(name);
    if (!b) throw new Error(`no bus named "${name}" (have: ${[...this.buses.keys()].join(', ')})`);
    return b;
  }

  #applyBus(b, fade) {
    const param = b.node.gain, now = this.context.currentTime, target = b.muted ? 0 : b.volume;
    const current = param.value; // read before cancelling: cancelling also drops a value set at this very moment
    param.cancelScheduledValues(now);
    param.setValueAtTime(current, now);
    if (fade > 0) param.linearRampToValueAtTime(target, now + fade); else param.setValueAtTime(target, now);
  }

  /** Set a bus's volume (0..1+), optionally fading over `fade` seconds. */
  setVolume(bus, volume, fade = 0) {
    if (!(volume >= 0)) throw new Error(`volume must be 0 or more (got ${volume})`);
    const b = this.#bus(bus);
    b.volume = volume;
    this.#applyBus(b, fade);
  }

  getVolume(bus) { return this.#bus(bus).volume; }

  /** Mute or unmute a bus without losing its volume setting. */
  setMuted(bus, muted, fade = 0) {
    const b = this.#bus(bus);
    b.muted = !!muted;
    this.#applyBus(b, fade);
  }

  isMuted(bus) { return this.#bus(bus).muted; }

  // ---------- effects and ducking ----------

  /** Connect a bus's volume gain through its enabled effects to its ducking gain. */
  #rewire(b) {
    b.node.disconnect();
    for (const h of b.effects) h.built.output.disconnect();
    let last = b.node;
    for (const h of b.effects) if (h.enabled) { last.connect(h.built.input); last = h.built.output; }
    last.connect(b.duck);
  }

  /**
   * Put an effect on a bus: everything that plays on it passes through (effects run in the order added). Make the description with `lowpass`, `highpass`, `bandpass`, `filter`,
   * `reverb`, `echo` or `compressor`. Returns a handle: `handle.set({ frequency: 400 }, 0.5)` glides a setting, `handle.enabled = false` bypasses it, `handle.remove()` takes it out.
   * @param {string} bus
   * @param {import('./effects.js').EffectSpec} spec
   * @returns {import('./effects.js').EffectHandle & {remove: () => void, bus: string}}
   */
  addEffect(bus, spec) {
    const b = this.#bus(bus);
    const built = buildEffect(this.context, spec);
    const engine = this;
    let enabled = true;
    const handle = {
      kind: spec.kind === 'filter' ? spec.type : spec.kind, bus, built,
      get enabled() { return enabled; },
      set enabled(v) { if (!!v !== enabled) { enabled = !!v; engine.#rewire(b); } },
      set: (values, fade = 0) => built.set(values, fade),
      remove: () => this.removeEffect(handle),
    };
    b.effects.push(handle);
    this.#rewire(b);
    return handle;
  }

  /** Take an effect off its bus. */
  removeEffect(handle) {
    const b = this.#bus(handle.bus), i = b.effects.indexOf(handle);
    if (i < 0) return;
    b.effects.splice(i, 1);
    this.#rewire(b);
    try { for (const n of handle.built.nodes) n.disconnect(); } catch { /* already disconnected */ }
  }

  /** The effects on a bus, in order. */
  effects(bus) { return [...this.#bus(bus).effects]; }

  /**
   * Ducking: turn the `target` bus down while anything plays on the `trigger` bus (music quieter while someone speaks). The target dips to `amount` of its volume over `attack`
   * seconds, holds for `hold` seconds after the last trigger sound ends, and recovers over `release`. Several rules can share a target; the quietest wins.
   * @param {{target: string, trigger: string, amount?: number, attack?: number, release?: number, hold?: number}} o
   * @returns {{remove: () => void}}
   */
  addDuck({ target, trigger, amount = 0.3, attack = 0.05, release = 0.6, hold = 0.15 }) {
    this.#bus(target); this.#bus(trigger);
    if (!(amount >= 0 && amount <= 1)) throw new Error(`duck amount is a fraction from 0 to 1 (got ${amount})`);
    const rule = { target, trigger, amount, attack, release, hold, active: 0, remove: () => { this.duckRules = this.duckRules.filter((r) => r !== rule); this.#applyDuck(target); } };
    for (const v of this.voices) if (v.bus === trigger) rule.active++;
    this.duckRules.push(rule);
    this.#applyDuck(target);
    return rule;
  }

  /** Set a bus's ducking level by hand (1 normal, 0.3 dipped), gliding over `fade` seconds. Rules from `addDuck` take over again the next time a trigger starts or ends. */
  setDuck(bus, level, fade = 0) {
    const b = this.#bus(bus), now = this.context.currentTime;
    b.duckLevel = level;
    const current = b.duck.gain.value;
    b.duck.gain.cancelScheduledValues(now);
    b.duck.gain.setValueAtTime(current, now);
    if (fade > 0) b.duck.gain.linearRampToValueAtTime(level, now + fade); else b.duck.gain.setValueAtTime(level, now);
  }

  #applyDuck(name) {
    const b = this.#bus(name), now = this.context.currentTime;
    let level = 1, attack = Infinity, release = 0.05, hold = 0;
    for (const r of this.duckRules) {
      if (r.target !== name) continue;
      release = Math.max(release, r.release); hold = Math.max(hold, r.hold);
      if (r.active > 0) { level = Math.min(level, r.amount); attack = Math.min(attack, r.attack); }
    }
    const param = b.duck.gain, current = param.value, down = level < b.duckLevel;
    b.duckLevel = level;
    param.cancelScheduledValues(now);
    param.setValueAtTime(current, now);
    param.setTargetAtTime(level, down ? now : now + hold, Math.max(0.001, (down ? attack : release) / 3));   // (a time constant is a third of the time to settle)
  }

  #duckTriggered(bus, delta) {
    for (const r of this.duckRules) if (r.trigger === bus) r.active = Math.max(0, r.active + delta);
    const targets = new Set(this.duckRules.filter((r) => r.trigger === bus).map((r) => r.target));
    for (const t of targets) this.#applyDuck(t);
  }

  // ---------- sounds ----------

  /**
   * Make a playable sound from a decoded `AudioBuffer`, PCM samples (`{sampleRate, data}`, e.g. from `synthesize`) or a synth spec.
   * @param {AudioBuffer | {sampleRate: number, data: Float32Array} | import('./synth.js').SynthSpec} source
   * @param {string} [name]
   * @returns {Sound}
   */
  createSound(source, name = `sound${nextSoundKey}`) {
    let buffer;
    if (source && typeof source.getChannelData === 'function') buffer = source;
    else {
      const pcm = source?.data instanceof Float32Array ? source : synthesize(source);
      buffer = this.context.createBuffer(1, pcm.data.length, pcm.sampleRate);
      if (buffer.copyToChannel) buffer.copyToChannel(pcm.data, 0); else buffer.getChannelData(0).set(pcm.data);
    }
    return { name, buffer, duration: buffer.duration, key: `${name}#${nextSoundKey++}` };
  }

  /** Download and decode an audio file (anything the browser plays: wav, mp3, ogg...). */
  async load(url, name = url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`could not load ${url} (${res.status})`);
    const buffer = await this.context.decodeAudioData(await res.arrayBuffer());
    return this.createSound(buffer, name);
  }

  /** Load several files at once: `{ shot: 'sfx/shot.ogg', ... }` gives `{ shot: Sound, ... }`. */
  async loadAll(files) {
    const entries = await Promise.all(Object.entries(files).map(async ([name, url]) => [name, await this.load(url, name)]));
    return Object.fromEntries(entries);
  }

  // ---------- playing ----------

  /**
   * Play a sound. Returns a voice you can adjust or stop, or null when the sound was not started (the engine is not running yet,
   * the sound is too far away to hear, or every voice is busy with something more important).
   * @param {Sound} sound
   * @param {PlayOptions} [opts]
   */
  play(sound, opts = {}) {
    if (!sound) return null;
    const {
      bus = 'sfx', volume = 1, pitch = 1, pitchVariation = 0, loop = false, pan = 0, position = null, model, refDistance, maxDistance, rolloff,
      priority = 0, maxPerSound = Infinity, fadeIn = 0, delay = 0, offset = 0, duration, loopStart, loopEnd, key, occlusion, onEnded,
    } = opts;
    const ctx = this.context, target = this.#bus(bus);
    if (!loop && this.skipWhenSuspended && ctx.state !== 'running') { this.stats.skipped++; return null; }
    const distanceOptions = { model, refDistance, maxDistance, rolloff };
    for (const k of Object.keys(distanceOptions)) if (distanceOptions[k] === undefined) delete distanceOptions[k];
    let sp = null;
    if (position) {
      sp = spatialize(this.listener, position[0], position[1], position[2], distanceOptions, { gain: 0, pan: 0, distance: 0 });
      if (sp.gain < 0.002 && !loop) { this.stats.culled++; return null; }
    }
    const grant = this.pool.request({ key: key ?? sound.key, priority, maxPerSound, now: ctx.currentTime });
    if (!grant.granted) { this.stats.denied++; return null; }
    if (grant.steal) { this.#voiceById(grant.steal.id)?.stop(0.02); this.stats.stolen++; }

    const src = ctx.createBufferSource();
    src.buffer = sound.buffer;
    src.loop = loop;
    if (loop && loopEnd !== undefined) { src.loopStart = loopStart ?? 0; src.loopEnd = loopEnd; }
    src.playbackRate.value = pitch * (1 + (Math.random() * 2 - 1) * pitchVariation);
    const gain = ctx.createGain();
    gain.gain.value = fadeIn > 0 ? 0 : volume;
    src.connect(gain);
    let tail = gain, spatial = null, panner = null;
    if (sp) { spatial = ctx.createGain(); spatial.gain.value = sp.gain; tail.connect(spatial); tail = spatial; }
    if (ctx.createStereoPanner) { panner = ctx.createStereoPanner(); panner.pan.value = sp ? sp.pan : Math.max(-1, Math.min(1, pan)); tail.connect(panner); tail = panner; }
    tail.connect(target.node);

    const voice = {
      id: grant.id, sound, bus, loop, position: position ? [position[0], position[1], position[2]] : null, distanceOptions, priority,
      src, gain, spatial, panner, volume, ended: false, occ: null, occGain: null, firstAfterGain: null,
      get playing() { return !this.ended; },
      stop: (fade = 0) => this.#stopVoice(voice, fade),
      setVolume: (v, time = 0) => this.#rampGain(voice, v, time),
      setPitch: (p, time = 0) => {
        const now = ctx.currentTime, current = src.playbackRate.value;
        src.playbackRate.cancelScheduledValues(now); src.playbackRate.setValueAtTime(current, now);
        if (time > 0) src.playbackRate.linearRampToValueAtTime(p, now + time); else src.playbackRate.setValueAtTime(p, now);
      },
      setPosition: (x, y, z) => { if (voice.position) { voice.position[0] = x; voice.position[1] = y; voice.position[2] = z; } },
      setOcclusion: (amount, time = 0) => this.#occlude(voice, amount, time),
      setPan: (p) => { if (panner && !voice.position) panner.pan.value = Math.max(-1, Math.min(1, p)); },
    };
    src.onended = () => this.#finish(voice, onEnded);
    voice.firstAfterGain = spatial ?? panner ?? target.node;
    if (occlusion !== undefined) this.#occlude(voice, occlusion, 0);
    this.voices.add(voice);
    this.#duckTriggered(bus, 1);
    if (duration !== undefined && !loop) src.start(ctx.currentTime + delay, offset, duration); else src.start(ctx.currentTime + delay, offset);
    if (fadeIn > 0) this.#rampGain(voice, volume, fadeIn);
    this.stats.played++;
    return voice;
  }

  /** Dull and quieten a voice as if a wall stood between it and the listener. */
  #occlude(voice, amount, time) {
    if (voice.ended) return;
    const ctx = this.context, now = ctx.currentTime;
    if (!voice.occ) {
      if (!(amount > 0)) return;
      const occ = ctx.createBiquadFilter(), occGain = ctx.createGain();
      occ.type = 'lowpass'; occ.Q.value = 0.7; occ.frequency.value = 22000;
      voice.gain.disconnect();
      voice.gain.connect(occ); occ.connect(occGain); occGain.connect(voice.firstAfterGain);
      voice.occ = occ; voice.occGain = occGain;
    }
    const to = (param, value) => {
      const current = param.value;
      param.cancelScheduledValues(now); param.setValueAtTime(current, now);
      if (time > 0) param.linearRampToValueAtTime(value, now + time); else param.setValueAtTime(value, now);
    };
    to(voice.occ.frequency, occlusionFrequency(amount));
    to(voice.occGain.gain, 1 - 0.5 * Math.max(0, Math.min(1, amount)));
  }

  #voiceById(id) { for (const v of this.voices) if (v.id === id) return v; return null; }

  #rampGain(voice, v, time) {
    const param = voice.gain.gain, now = this.context.currentTime;
    voice.volume = v;
    const current = param.value; // read before cancelling (see setVolume)
    param.cancelScheduledValues(now);
    param.setValueAtTime(current, now);
    if (time > 0) param.linearRampToValueAtTime(v, now + time); else param.setValueAtTime(v, now);
  }

  #stopVoice(voice, fade) {
    if (voice.ended) return;
    const now = this.context.currentTime;
    if (fade > 0) {
      this.#rampGain(voice, 0, fade);
      try { voice.src.stop(now + fade + 0.02); } catch { /* already stopped */ }
    } else {
      try { voice.src.stop(now); } catch { /* not started yet or already stopped */ }
    }
  }

  #finish(voice, onEnded) {
    if (voice.ended) return;
    voice.ended = true;
    this.voices.delete(voice);
    this.pool.release(voice.id);
    if (this.music === voice) this.music = null;
    try { voice.src.disconnect(); voice.gain.disconnect(); voice.occ?.disconnect(); voice.occGain?.disconnect(); voice.spatial?.disconnect(); voice.panner?.disconnect(); } catch { /* already disconnected */ }
    this.#duckTriggered(voice.bus, -1);
    onEnded?.();
  }

  /** Stop every voice (on one bus, or all of them), optionally fading out. */
  stopAll(bus, fade = 0) {
    for (const v of [...this.voices]) if (!bus || v.bus === bus) v.stop(fade);
  }

  // ---------- sprites ----------

  /**
   * Make a sprite: one sound with named regions. Give it a `Sound` and a map `{ name: [start, duration, loop?] }` in seconds, or what `packSounds` returned.
   * @param {Sound | {sampleRate: number, data: Float32Array, map: Record<string, any>}} source @param {Record<string, any>} [map] @param {string} [name]
   * @returns {AudioSprite}
   */
  createSprite(source, map, name = 'sprite') {
    if (source && source.map && source.data) return new AudioSprite(this.createSound(source, name), source.map);
    return new AudioSprite(source, map);
  }

  /**
   * Play one region of a sprite by name, with the usual play options (position, pitch, bus, volume...). A region marked `loop` loops within itself.
   * @param {AudioSprite} sprite @param {string} regionName @param {PlayOptions} [opts]
   */
  playSprite(sprite, regionName, opts = {}) {
    const r = sprite.region(regionName);
    return this.play(sprite.sound, { ...opts, offset: r.start, duration: r.loop ? undefined : r.duration, loop: opts.loop ?? r.loop, loopStart: r.start, loopEnd: r.loop ? r.start + r.duration : undefined, key: opts.key ?? `${sprite.sound.key}:${regionName}` });
  }

  // ---------- music ----------

  /**
   * Play a looping track on the 'music' bus, cross-fading from the current one. Asking for the track that already plays does nothing.
   * @param {Sound} sound
   * @param {{volume?: number, fade?: number, bus?: string}} [o]
   */
  playMusic(sound, { volume = 1, fade = 1.5, bus = 'music' } = {}) {
    if (this.musicSound === sound && this.music?.playing) return this.music;
    this.music?.stop(fade);
    this.musicSound = sound;
    this.music = this.play(sound, { bus, volume, loop: true, fadeIn: fade, priority: 100 });
    return this.music;
  }

  /**
   * Stream a long track from a file through the 'music' bus, cross-fading from the current one: it starts at once and keeps almost nothing in memory (see `StreamedTrack`).
   * Asking for the track that is already streaming does nothing. The result also has `pause`, `resume`, `seek`, `currentTime` and `duration`.
   * @param {string} url @param {{volume?: number, fade?: number, bus?: string, loop?: boolean, createElement?: () => HTMLMediaElement, onEnded?: () => void, onError?: (e: any) => void}} [o]
   * @returns {StreamedTrack}
   */
  streamMusic(url, { volume = 1, fade = 1.5, bus = 'music', loop = true, createElement, onEnded, onError } = {}) {
    if (this.musicSound === url && this.music?.playing) return this.music;
    this.music?.stop(fade);
    this.musicSound = url;
    this.music = new StreamedTrack(this, url, { volume, fade, bus, loop, createElement, onEnded, onError });
    return this.music;
  }

  stopMusic(fade = 1) {
    this.music?.stop(fade);
    this.music = null; this.musicSound = null;
  }

  // ---------- the listener, and the per-frame update ----------

  /** Put the listener (your camera) somewhere and facing a direction (yaw and pitch as for `Camera3D`). */
  setListener(x, y, z, yaw, pitch = 0) { return setListenerFromYawPitch(this.listener, x, y, z, yaw, pitch); }

  /** Call once per frame after moving the listener and any sound sources: updates loudness and panning of positioned voices. */
  update() {
    const now = this.context.currentTime, sc = this.scratch;
    for (const v of this.voices) {
      if (!v.position) continue;
      spatialize(this.listener, v.position[0], v.position[1], v.position[2], v.distanceOptions, sc);
      v.spatial.gain.setTargetAtTime(sc.gain, now, 0.03);
      v.panner?.pan.setTargetAtTime(sc.pan, now, 0.03);
    }
  }

  /** Stop everything and release the audio device (if the engine made it). */
  dispose() {
    this.stopAll();
    this.unlockCleanup?.();
    if (this.visibilityHandler) globalThis.document?.removeEventListener('visibilitychange', this.visibilityHandler);
    if (this.ownsContext) this.context.close?.();
  }
}
