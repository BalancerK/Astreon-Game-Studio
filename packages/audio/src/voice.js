/**
 * Voice chat on Web Audio: the microphone, the capture of its samples as small frames, the playback of other players' voices (placed in the world or not), and `VoiceChat`, which joins them
 * to the codecs and jitter buffers of `voice-core.js`. It does not choose a network: it hands you packets to send and takes the packets you receive, so it works over the engine's WebSocket
 * transport, over WebRTC data channels, or anything else.
 */
import { spatialize } from './spatial.js';
import { Resampler, FrameSlicer, VoiceActivity, VoiceSender, JitterBuffer, decodeVoicePacket, createCodec, CODEC, rms, Pcm16Codec, AdpcmCodec, OpusCodec, opusAvailable } from './voice-core.js';

// ---------------------------------------------------------------- the microphone

/**
 * The microphone: asks the player's permission, gives a level meter and a speaking flag, and a stream of samples for a voice chat. The browser's own echo cancellation, noise suppression and
 * automatic gain are on by default (they matter a great deal for voice, especially without headphones).
 */
export class Microphone {
  /**
   * Ask for the microphone. Rejects if the player refuses or there is none (`error.name` is `NotAllowedError` or `NotFoundError`).
   * @param {object} [o]
   * @param {BaseAudioContext} o.context The audio context (usually `audio.context`).
   * @param {string} [o.deviceId] A device from `Microphone.devices()`. @param {boolean} [o.echoCancellation] @param {boolean} [o.noiseSuppression] @param {boolean} [o.autoGainControl] (all true)
   * @param {VoiceActivity} [o.vad] @param {() => Promise<MediaStream>} [o.getStream] Replaces `getUserMedia` (tests).
   * @returns {Promise<Microphone>}
   */
  static async open({ context, deviceId, echoCancellation = true, noiseSuppression = true, autoGainControl = true, vad = new VoiceActivity(), getStream } = {}) {
    if (!context) throw new Error('Microphone.open needs the audio context');
    const stream = await (getStream ?? (() => globalThis.navigator.mediaDevices.getUserMedia({ audio: { echoCancellation, noiseSuppression, autoGainControl, ...(deviceId ? { deviceId: { exact: deviceId } } : {}) } })))();
    return new Microphone(context, stream, vad);
  }

  /** The microphones and headsets the player has: `[{ deviceId, label }]` (labels are empty until permission has been given). */
  static async devices(mediaDevices = globalThis.navigator?.mediaDevices) {
    const all = (await mediaDevices?.enumerateDevices?.()) ?? [];
    return all.filter((d) => d.kind === 'audioinput').map((d) => ({ deviceId: d.deviceId, label: d.label }));
  }

  constructor(context, stream, vad) {
    this.context = context; this.stream = stream; this.vad = vad;
    this.source = context.createMediaStreamSource(stream);
    this.analyser = context.createAnalyser();
    this.analyser.fftSize = 1024;
    this.source.connect(this.analyser);
    this.data = new Float32Array(this.analyser.fftSize);
    /** Smoothed loudness, 0 to about 1. */ this.level = 0;
    /** Whether the player is speaking, by the voice activity detector (kept up to date by `update`). */ this.speaking = false;
    this.lastUpdate = 0;
    this.closed = false;
  }

  /** Read the level and the speaking state: call it each frame (or every 50 ms or so). @param {number} [dt] Seconds since the last call (measured from the audio clock if left out). */
  update(dt) {
    if (this.closed) return;
    const now = this.context.currentTime, step = dt ?? Math.max(0, now - this.lastUpdate); this.lastUpdate = now;
    this.analyser.getFloatTimeDomainData(this.data);
    const instant = rms(this.data);
    this.level += (instant - this.level) * Math.min(1, step * 12);
    this.speaking = this.vad.update(instant, Math.max(1, step * 1000));
  }

  /** Mute the microphone itself (the browser stops using it: the indicator goes off). */
  set muted(v) { for (const t of this.stream.getAudioTracks()) t.enabled = !v; }
  get muted() { return this.stream.getAudioTracks().every((t) => !t.enabled); }

  /** Let go of the microphone and the permission indicator. */
  close() {
    this.closed = true;
    this.source.disconnect();
    for (const t of this.stream.getTracks()) t.stop();
  }
}

const WORKLET = `class Capture extends AudioWorkletProcessor {
  process(inputs) { const ch = inputs[0]?.[0]; if (ch && ch.length) this.port.postMessage(ch.slice()); return true; }
}
registerProcessor('engine-capture', Capture);`;

/**
 * Get the samples of a microphone as frames of `frameMs` at `sampleRate`: they are read by an audio worklet (off the main thread) and brought to the wanted rate. Falls back to a script
 * processor where worklets are missing. Returns `{ stop }`.
 * @param {Microphone} mic @param {(frame: Float32Array) => void} onFrame @param {{sampleRate?: number, frameMs?: number}} [o] sampleRate 16000, frameMs 20.
 * @returns {Promise<{stop: () => void}>}
 */
export async function captureFrames(mic, onFrame, { sampleRate = 16000, frameMs = 20 } = {}) {
  const ctx = mic.context, resampler = new Resampler(ctx.sampleRate, sampleRate), slicer = new FrameSlicer(Math.round((sampleRate * frameMs) / 1000));
  const feed = (chunk) => { for (const f of slicer.push(resampler.push(chunk))) onFrame(f); };
  const mute = ctx.createGain(); mute.gain.value = 0; mute.connect(ctx.destination);      // a capture node must be connected to run, but must not be heard
  if (ctx.audioWorklet && globalThis.Blob && globalThis.URL?.createObjectURL) {
    const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
    try { await ctx.audioWorklet.addModule(url); } finally { URL.revokeObjectURL(url); }
    const node = new AudioWorkletNode(ctx, 'engine-capture', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1 });
    node.port.onmessage = (e) => feed(e.data);
    mic.source.connect(node); node.connect(mute);
    return { stop() { node.port.onmessage = null; mic.source.disconnect(node); node.disconnect(); mute.disconnect(); } };
  }
  const node = ctx.createScriptProcessor(2048, 1, 1);
  node.onaudioprocess = (e) => feed(new Float32Array(e.inputBuffer.getChannelData(0)));
  mic.source.connect(node); node.connect(mute);
  return { stop() { node.onaudioprocess = null; mic.source.disconnect(node); node.disconnect(); mute.disconnect(); } };
}

// ---------------------------------------------------------------- hearing others

/**
 * One remote speaker being played: decoded frames are laid end to end on the audio clock, through a volume and (placed in the world) a distance gain and a left-right pan, onto the voice bus.
 * `skip()` covers a missing frame with a moment of silence, `repeat()` with the last frame fading out.
 */
export class VoicePlayback {
  /** @param {import('./engine.js').AudioEngine} engine @param {{bus?: string, sampleRate?: number, lead?: number, position?: number[] | null, maxDistance?: number, refDistance?: number}} [o] */
  constructor(engine, { bus = 'voice', sampleRate = 16000, lead = 0.04, position = null, refDistance = 3, maxDistance = 40 } = {}) {
    this.engine = engine; this.sampleRate = sampleRate; this.lead = lead; this.position = position; this.distanceOptions = { refDistance, maxDistance };
    const ctx = engine.context;
    this.volumeNode = ctx.createGain(); this.spatialNode = ctx.createGain();
    this.volumeNode.connect(this.spatialNode);
    let tail = this.spatialNode;
    if (ctx.createStereoPanner) { this.panner = ctx.createStereoPanner(); tail.connect(this.panner); tail = this.panner; }
    tail.connect(engine.buses.get(bus).node);
    this.nextTime = 0; this.lastFrame = null; this.scratch = { gain: 1, pan: 0, distance: 0 }; this.sources = new Set();
    this.update();
  }
  /** @param {number} v 0..1+ */
  set volume(v) { this.volumeNode.gain.value = v; }
  get volume() { return this.volumeNode.gain.value; }
  /** Re-aim the sound at the world position of the speaker (or `null` to hear them in your head, as for a team channel). */
  setPosition(x, y, z) { this.position = x === null ? null : [x, y, z]; this.update(); }
  /** Call each frame so a moving speaker or listener stays in the right place. */
  update() {
    if (!this.position) { this.spatialNode.gain.value = 1; if (this.panner) this.panner.pan.value = 0; return; }
    const sp = spatialize(this.engine.listener, this.position[0], this.position[1], this.position[2], this.distanceOptions, this.scratch);
    this.spatialNode.gain.value = sp.gain; if (this.panner) this.panner.pan.value = sp.pan;
  }
  /** Is this speaker out of earshot (so there is no point decoding them)? */
  get inaudible() { return this.position !== null && this.spatialNode.gain.value < 0.002; }

  #at() { const now = this.engine.context.currentTime; if (this.nextTime < now + 0.005) this.nextTime = now + this.lead; return this.nextTime; }
  /** Lay a frame of samples at the end of what is already queued. @param {Float32Array} frame */
  play(frame) {
    const ctx = this.engine.context, buffer = ctx.createBuffer(1, frame.length, this.sampleRate);
    if (buffer.copyToChannel) buffer.copyToChannel(frame, 0); else buffer.getChannelData(0).set(frame);
    const src = ctx.createBufferSource(); src.buffer = buffer; src.connect(this.volumeNode);
    const at = this.#at(); src.start(at); this.nextTime = at + frame.length / this.sampleRate; this.lastFrame = frame;
    this.sources.add(src); src.onended = () => this.sources.delete(src);
  }
  /** A frame is missing: leave a gap the length of one. @param {number} samples */
  skip(samples) { this.#at(); this.nextTime += samples / this.sampleRate; this.lastFrame = null; }
  /** A frame is missing: cover it with the last one played, fading out (one repeat sounds better than a hole). */
  repeat() {
    if (!this.lastFrame) return;
    const f = new Float32Array(this.lastFrame.length); for (let i = 0; i < f.length; i++) f[i] = this.lastFrame[i] * (1 - i / f.length) * 0.5;
    this.play(f); this.lastFrame = null;
  }
  /** Stop and let go. */
  close() { for (const s of this.sources) { try { s.stop(); } catch { /* already stopped */ } } this.sources.clear(); this.volumeNode.disconnect(); this.spatialNode.disconnect(); this.panner?.disconnect(); }
}

// ---------------------------------------------------------------- the chat

/**
 * Voice chat for a game: send your voice, hear the others. You give it the audio engine, a codec and a place to send packets; it runs the microphone capture, voice detection or push-to-talk,
 * encoding, and for each remote player a jitter buffer, decoder and positioned playback on the engine's `voice` bus (which also takes part in the engine's ducking and effects: the music can
 * duck while players talk).
 *
 * ```js
 * const chat = new VoiceChat({ engine: audio, codec: 'adpcm', onPacket: (bytes) => net.sendVoice(bytes) });
 * await chat.start();                                   // asks for the microphone
 * net.onVoice = (fromId, bytes) => chat.receive(fromId, bytes);
 * // each frame: chat.setSpeakerPosition(id, [x, y, z]) for those in the world, then chat.update()
 * ```
 */
export class VoiceChat {
  /**
   * @param {object} o
   * @param {import('./engine.js').AudioEngine} o.engine
   * @param {'pcm16' | 'adpcm' | 'opus'} [o.codec] Default 'opus' where the browser has it, else 'adpcm'. Others' packets are decoded by whatever codec they say they use.
   * @param {(packet: Uint8Array) => void} o.onPacket Your network: send this to the other players (or to the server, which routes it: see `VoiceRouter`).
   * @param {number} [o.sampleRate] 16000. @param {number} [o.frameMs] 20. @param {number} [o.bitrate] For Opus, 24000.
   * @param {boolean | {threshold?: number, attackMs?: number, holdMs?: number}} [o.vad] Send only while speaking (default true); false sends everything while not muted.
   * @param {boolean} [o.spatial] Voices come from where their speakers are (default true; `setSpeakerPosition`). @param {number} [o.maxDistance] How far a voice carries (40).
   * @param {number} [o.jitterFrames] Starting delay in frames (3). @param {() => number} [o.clock] Milliseconds (default `performance.now`).
   */
  constructor({ engine, codec, onPacket, sampleRate = 16000, frameMs = 20, bitrate = 24000, vad = true, spatial = true, maxDistance = 40, jitterFrames = 3, clock = () => globalThis.performance?.now() ?? Date.now() }) {
    Object.assign(this, { engine, sampleRate, frameMs, bitrate, spatial, maxDistance, jitterFrames, clock, onPacket });
    this.codecName = codec ?? (opusAvailable() ? 'opus' : 'adpcm');
    this.frameSamples = Math.round((sampleRate * frameMs) / 1000);
    this.vad = vad === false ? null : new VoiceActivity(vad === true ? {} : vad);
    /** @type {Map<any, {jitter: JitterBuffer, playback: VoicePlayback, codecs: Map<number, any>, speaking: boolean, lastHeard: number, lastPull: number, muted: boolean, volume: number, pending: number}>} */
    this.speakers = new Map();
    /** Called with `(id, speaking)` when a remote player starts or stops talking (for a speaker icon). */
    this.onSpeaking = null;
    /** Called when you start or stop transmitting. */
    this.onTransmit = null;
    this.deafened = false;
    this.mic = null; this.capture = null; this.sender = null;
    this.stats = { received: 0, rejected: 0, decoded: 0, lost: 0, concealed: 0 };
    this.ready = null;
  }

  async #codec(id) {
    if (id === CODEC.pcm16) return new Pcm16Codec();
    if (id === CODEC.adpcm) return new AdpcmCodec();
    return OpusCodec.create({ sampleRate: this.sampleRate, bitrate: this.bitrate });
  }

  /**
   * Ask for the microphone and start sending. Rejects if the player says no (the chat can still be used to listen: call `receive` without `start`).
   * @param {Microphone | Parameters<typeof Microphone.open>[0]} [mic] An open microphone, or options for `Microphone.open` (`deviceId`, ...).
   */
  async start(mic) {
    this.mic = mic instanceof Microphone ? mic : await Microphone.open({ context: this.engine.context, vad: this.vad ?? new VoiceActivity(), ...(mic ?? {}) });
    const codec = this.codecName === 'opus' ? await OpusCodec.create({ sampleRate: this.sampleRate, bitrate: this.bitrate }) : createCodec(this.codecName);
    this.sender = new VoiceSender({ codec, frameMs: this.frameMs, onPacket: (p) => this.onPacket(p), vad: this.vad, clock: this.clock });
    this.capture = await captureFrames(this.mic, (f) => this.#frame(f), { sampleRate: this.sampleRate, frameMs: this.frameMs });
    return this;
  }
  #frame(f) { const was = this.sender.speaking; this.sender.push(f); if (was !== this.sender.speaking) this.onTransmit?.(this.sender.speaking); }

  /** Are you transmitting now? */
  get transmitting() { return !!this.sender?.speaking; }
  /** Your microphone level, 0 to 1ish (for a meter). */
  get level() { return this.sender?.level ?? 0; }
  /** Push-to-talk: `true` transmits, `false` does not, `null` goes back to voice detection. */
  set pushToTalk(v) { if (this.sender) this.sender.pushToTalk = v; }
  /** Stop sending (you still hear others). */
  set muted(v) { if (this.sender) this.sender.muted = v; this.mic && (this.mic.muted = v); }
  get muted() { return !!this.sender?.muted; }
  /** Stop hearing everyone. */
  set deafen(v) { this.deafened = v; for (const s of this.speakers.values()) s.playback.volume = v || s.muted ? 0 : s.volume; }

  #speaker(id) {
    let s = this.speakers.get(id);
    if (!s) {
      s = { jitter: new JitterBuffer({ targetFrames: this.jitterFrames }), playback: new VoicePlayback(this.engine, { sampleRate: this.sampleRate, position: null, maxDistance: this.maxDistance }), codecs: new Map(), speaking: false, lastHeard: 0, lastPull: this.clock(), muted: false, volume: 1, pending: 0, creating: new Map() };
      if (this.deafened) s.playback.volume = 0;
      this.speakers.set(id, s);
    }
    return s;
  }

  /** Where a speaker is in the world (their voice comes from there). Pass `null` to hear them evenly (a teammate on a radio). @param {any} id @param {number[] | null} position */
  setSpeakerPosition(id, position) { if (this.spatial) this.#speaker(id).playback.setPosition(position ? position[0] : null, position?.[1], position?.[2]); }
  /** Their volume, 0 to 1 and up. */
  setSpeakerVolume(id, v) { const s = this.#speaker(id); s.volume = v; if (!this.deafened && !s.muted) s.playback.volume = v; }
  /** Stop hearing one player. */
  muteSpeaker(id, muted = true) { const s = this.#speaker(id); s.muted = muted; s.playback.volume = muted || this.deafened ? 0 : s.volume; }
  isSpeaking(id) { return !!this.speakers.get(id)?.speaking; }
  /** Forget a speaker (they left). */
  removeSpeaker(id) { const s = this.speakers.get(id); if (s) { s.playback.close(); this.speakers.delete(id); } }

  /**
   * A voice packet arrived from player `id`. Malformed packets are counted and ignored.
   * @param {any} id @param {Uint8Array} bytes @returns {Promise<void>}
   */
  async receive(id, bytes) {
    const p = decodeVoicePacket(bytes);
    if (!p) { this.stats.rejected++; return; }
    this.stats.received++;
    const s = this.#speaker(id);
    if (s.muted || this.deafened) return;
    let frame = null;
    if (p.payload.length > 0) {
      let codec = s.codecs.get(p.codec);
      if (!codec) { s.creating.set(p.codec, s.creating.get(p.codec) ?? this.#codec(p.codec)); codec = await s.creating.get(p.codec); s.codecs.set(p.codec, codec); }
      try { frame = await codec.decode(p.payload, p.codec === CODEC.adpcm ? this.frameSamples : undefined); } catch { this.stats.rejected++; return; }
      this.stats.decoded++;
    }
    s.jitter.push(p.seq, frame ?? new Float32Array(0), p.end);
    s.lastHeard = this.clock();
  }

  /** Move playback along: call once per frame (or a few times a second at least). Pulls the frames that have come due from each speaker's jitter buffer and plays them. */
  update() {
    const now = this.clock();
    for (const [id, s] of this.speakers) {
      s.playback.update();
      const due = Math.min(10, Math.floor((now - s.lastPull) / this.frameMs));
      if (due > 0) s.lastPull += due * this.frameMs;
      if (now - s.lastPull > 500) s.lastPull = now;
      for (let i = 0; i < due; i++) {
        const out = s.jitter.pull();
        if (out.kind === 'frame') { if (out.frame.length) s.playback.play(out.frame); }
        else if (out.kind === 'lost') { this.stats.lost++; if (!s.playback.inaudible) { s.playback.repeat(); this.stats.concealed++; } s.playback.skip(this.frameSamples); }
      }
      const speaking = s.jitter.playing && now - s.lastHeard < 400;
      if (speaking !== s.speaking) { s.speaking = speaking; this.onSpeaking?.(id, speaking); }
    }
  }

  /** Stop everything: the microphone, the capture and every speaker. */
  dispose() {
    this.capture?.stop(); this.mic?.close();
    for (const id of [...this.speakers.keys()]) this.removeSpeaker(id);
    this.sender = null; this.mic = null; this.capture = null;
  }
}

