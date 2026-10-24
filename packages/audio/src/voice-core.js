/**
 * The parts of voice chat that need no browser: turning microphone samples into small packets and back (three codecs), putting packets that arrive late, early, twice or never back into a smooth
 * stream (the jitter buffer), deciding when someone is speaking, and deciding who hears whom. Everything here runs in Node and is tested there; `voice.js` connects it to Web Audio.
 */

// ---------------------------------------------------------------- levels and speaking

/** Root-mean-square level of a block of samples (0 silence, about 0.7 for a full-scale sine). @param {Float32Array} samples */
export function rms(samples) {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length);
}

/** Largest absolute sample. @param {Float32Array} samples */
export function peak(samples) { let p = 0; for (let i = 0; i < samples.length; i++) { const a = Math.abs(samples[i]); if (a > p) p = a; } return p; }

/**
 * Voice activity detection: says when someone is speaking from the level of each frame. It needs the level above `threshold` for `attackMs` before it says yes (so a click or a cough does not
 * open it), and keeps saying yes for `holdMs` after the level drops (so the ends of words are not cut).
 */
export class VoiceActivity {
  /** @param {{threshold?: number, attackMs?: number, holdMs?: number}} [o] threshold is an RMS level (0.015), attackMs 40, holdMs 300. */
  constructor({ threshold = 0.015, attackMs = 40, holdMs = 300 } = {}) { Object.assign(this, { threshold, attackMs, holdMs }); this.speaking = false; this.above = 0; this.below = 0; }
  /** Feed the level of one frame lasting `frameMs`; returns whether speech is on. */
  update(level, frameMs) {
    if (level >= this.threshold) { this.above += frameMs; this.below = 0; if (!this.speaking && this.above >= this.attackMs) this.speaking = true; }
    else { this.above = 0; this.below += frameMs; if (this.speaking && this.below >= this.holdMs) this.speaking = false; }
    return this.speaking;
  }
  reset() { this.speaking = false; this.above = 0; this.below = 0; }
}

// ---------------------------------------------------------------- resampling and framing

/**
 * Changes the sample rate of a stream that arrives in chunks of any size (an audio worklet's 128 samples, say). Going down (48 kHz to 16 kHz) it averages over each output sample's span,
 * which also removes what the lower rate could not hold; going up it interpolates.
 */
export class Resampler {
  /** @param {number} fromRate @param {number} toRate */
  constructor(fromRate, toRate) { this.fromRate = fromRate; this.toRate = toRate; this.ratio = fromRate / toRate; this.buf = new Float32Array(0); this.pos = 0; }
  /** @param {Float32Array} chunk @returns {Float32Array} the samples that are now complete */
  push(chunk) {
    if (this.fromRate === this.toRate) return chunk;
    const merged = new Float32Array(this.buf.length + chunk.length); merged.set(this.buf); merged.set(chunk, this.buf.length);
    const r = this.ratio, out = [];
    let pos = this.pos;
    if (r >= 1) {
      while (pos + r <= merged.length) {
        let sum = 0, a = pos; const end = pos + r;
        while (a < end) { const i = Math.floor(a), next = Math.min(i + 1, end), w = next - a; sum += merged[i] * w; a = next; }
        out.push(sum / r); pos += r;
      }
    } else {
      while (pos + 1 < merged.length) { const i = Math.floor(pos), f = pos - i; out.push(merged[i] * (1 - f) + merged[i + 1] * f); pos += r; }
    }
    const drop = Math.max(0, Math.floor(pos) - 1);
    this.buf = merged.slice(drop); this.pos = pos - drop;
    return Float32Array.from(out);
  }
  reset() { this.buf = new Float32Array(0); this.pos = 0; }
}

/** Cuts a stream arriving in chunks of any size into frames of exactly `frameSamples`. */
export class FrameSlicer {
  /** @param {number} frameSamples */
  constructor(frameSamples) { this.n = frameSamples; this.buf = new Float32Array(frameSamples); this.fill = 0; }
  /** @param {Float32Array} chunk @returns {Float32Array[]} the frames completed (each a fresh array) */
  push(chunk) {
    const frames = [];
    let i = 0;
    while (i < chunk.length) {
      const take = Math.min(this.n - this.fill, chunk.length - i);
      this.buf.set(chunk.subarray(i, i + take), this.fill); this.fill += take; i += take;
      if (this.fill === this.n) { frames.push(this.buf.slice()); this.fill = 0; }
    }
    return frames;
  }
}

// ---------------------------------------------------------------- codecs

/** Codec numbers on the wire. */
export const CODEC = Object.freeze({ pcm16: 0, adpcm: 1, opus: 2 });

const clamp16 = (v) => (v > 32767 ? 32767 : v < -32768 ? -32768 : v);

/** 16-bit samples, uncompressed: the plainest, 32 KB/s at 16 kHz. Good for testing and for a fast local network. */
export class Pcm16Codec {
  constructor() { this.id = CODEC.pcm16; this.name = 'pcm16'; }
  encode(frame) {
    const out = new Uint8Array(frame.length * 2), view = new DataView(out.buffer);
    for (let i = 0; i < frame.length; i++) view.setInt16(i * 2, clamp16(Math.round(frame[i] * 32768)), true);
    return out;
  }
  decode(bytes) {
    const n = bytes.length >> 1, out = new Float32Array(n), view = new DataView(bytes.buffer, bytes.byteOffset, n * 2);
    for (let i = 0; i < n; i++) out[i] = view.getInt16(i * 2, true) / 32768;
    return out;
  }
}

const STEPS = [7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41, 45, 50, 55, 60, 66, 73, 80, 88, 97, 107, 118, 130, 143, 157, 173, 190, 209, 230, 253, 279, 307, 337, 371, 408, 449, 494, 544, 598, 658, 724, 796, 876, 963, 1060, 1166, 1282, 1411, 1552, 1707, 1878, 2066, 2272, 2499, 2749, 3024, 3327, 3660, 4026, 4428, 4871, 5358, 5894, 6484, 7132, 7845, 8630, 9493, 10442, 11487, 12635, 13899, 15289, 16818, 18500, 20350, 22385, 24623, 27086, 29794, 32767];
const ADJUST = [-1, -1, -1, -1, 2, 4, 6, 8];

/**
 * IMA ADPCM: four bits a sample, about 8 KB/s at 16 kHz mono, a quarter of 16-bit PCM and cheap enough to run in plain JavaScript anywhere. Each frame starts with the encoder's state, so a lost
 * frame never damages the next one. Speech comes through clearly; it is not as small as Opus.
 */
export class AdpcmCodec {
  constructor() { this.id = CODEC.adpcm; this.name = 'adpcm'; this.predictor = 0; this.index = 0; }
  encode(frame) {
    const out = new Uint8Array(3 + ((frame.length + 1) >> 1));
    out[0] = this.predictor & 255; out[1] = (this.predictor >> 8) & 255; out[2] = this.index;
    let pred = this.predictor, idx = this.index;
    for (let i = 0; i < frame.length; i++) {
      const sample = clamp16(Math.round(frame[i] * 32768));
      let diff = sample - pred, code = 0; const step = STEPS[idx];
      if (diff < 0) { code = 8; diff = -diff; }
      let delta = step >> 3, s = step;
      if (diff >= s) { code |= 4; diff -= s; delta += s; }
      s >>= 1; if (diff >= s) { code |= 2; diff -= s; delta += s; }
      s >>= 1; if (diff >= s) { code |= 1; delta += s; }
      pred = clamp16(code & 8 ? pred - delta : pred + delta);
      idx = Math.max(0, Math.min(88, idx + ADJUST[code & 7]));
      out[3 + (i >> 1)] |= i & 1 ? code << 4 : code;
    }
    this.predictor = pred; this.index = idx;
    return out;
  }
  decode(bytes, samples = (bytes.length - 3) * 2) {
    let pred = (bytes[0] | (bytes[1] << 8)) << 16 >> 16, idx = Math.min(88, bytes[2]);
    const out = new Float32Array(samples);
    for (let i = 0; i < samples; i++) {
      const byte = bytes[3 + (i >> 1)], code = i & 1 ? byte >> 4 : byte & 15;
      const step = STEPS[idx];
      let delta = step >> 3;
      if (code & 4) delta += step; if (code & 2) delta += step >> 1; if (code & 1) delta += step >> 2;
      pred = clamp16(code & 8 ? pred - delta : pred + delta);
      idx = Math.max(0, Math.min(88, idx + ADJUST[code & 7]));
      out[i] = pred / 32768;
    }
    return out;
  }
}

/** Is Opus available here (the WebCodecs `AudioEncoder` / `AudioDecoder`, in recent Chrome, Edge and Firefox)? */
export const opusAvailable = () => typeof globalThis.AudioEncoder === 'function' && typeof globalThis.AudioDecoder === 'function' && typeof globalThis.AudioData === 'function';

/**
 * Opus through the browser's WebCodecs: speech in 2 to 3 KB/s (24 kbit/s here) with the loss handling Opus is known for. Asynchronous; make it with `await OpusCodec.create(...)`, and
 * only where `opusAvailable()`.
 */
export class OpusCodec {
  /** @param {{sampleRate?: number, bitrate?: number}} [o] sampleRate 16000 (8000, 12000, 16000, 24000 or 48000), bitrate 24000. */
  static async create({ sampleRate = 16000, bitrate = 24000 } = {}) {
    if (!opusAvailable()) throw new Error('Opus needs WebCodecs audio, which this browser does not have: use the adpcm codec');
    const c = new OpusCodec(sampleRate, bitrate);
    await c.ready;
    return c;
  }
  constructor(sampleRate, bitrate) {
    this.id = CODEC.opus; this.name = 'opus'; this.sampleRate = sampleRate;
    this.encodeWaiters = []; this.decodeWaiters = []; this.t = 0;
    this.encoder = new globalThis.AudioEncoder({ output: (chunk) => { const b = new Uint8Array(chunk.byteLength); chunk.copyTo(b); this.encodeWaiters.shift()?.(b); }, error: (e) => { this.error = e; } });
    this.decoder = new globalThis.AudioDecoder({ output: (data) => { const f = new Float32Array(data.numberOfFrames); data.copyTo(f, { planeIndex: 0, format: 'f32-planar' }); data.close(); this.decodeWaiters.shift()?.(f); }, error: (e) => { this.error = e; } });
    this.encoder.configure({ codec: 'opus', sampleRate, numberOfChannels: 1, bitrate });
    this.decoder.configure({ codec: 'opus', sampleRate, numberOfChannels: 1 });
    this.ready = Promise.resolve();
  }
  /** @param {Float32Array} frame 2.5, 5, 10, 20, 40 or 60 ms of samples @returns {Promise<Uint8Array>} */
  encode(frame) {
    return new Promise((resolve, reject) => {
      this.encodeWaiters.push(resolve);
      try {
        const data = new globalThis.AudioData({ format: 'f32-planar', sampleRate: this.sampleRate, numberOfFrames: frame.length, numberOfChannels: 1, timestamp: this.t, data: frame });
        this.t += Math.round((frame.length / this.sampleRate) * 1e6);
        this.encoder.encode(data); data.close();
      } catch (e) { this.encodeWaiters.pop(); reject(e); }
    });
  }
  /** @param {Uint8Array} bytes @returns {Promise<Float32Array>} */
  decode(bytes) {
    return new Promise((resolve, reject) => {
      this.decodeWaiters.push(resolve);
      try { this.decoder.decode(new globalThis.EncodedAudioChunk({ type: 'key', timestamp: this.t, data: bytes })); this.t += 20000; } catch (e) { this.decodeWaiters.pop(); reject(e); }
    });
  }
  close() { try { this.encoder.close(); this.decoder.close(); } catch { /* already closed */ } }
}

/** Make a synchronous codec by name (`'pcm16'` or `'adpcm'`); for Opus use `OpusCodec.create`. */
export function createCodec(name) {
  if (name === 'pcm16') return new Pcm16Codec();
  if (name === 'adpcm') return new AdpcmCodec();
  throw new Error(`unknown codec "${name}" (pcm16 and adpcm are built in; opus is made with OpusCodec.create)`);
}

// ---------------------------------------------------------------- packets

/** Bytes before the payload of a voice packet. */
export const VOICE_HEADER_BYTES = 8;
const END = 1;

/**
 * A voice packet: 8 bytes of header (flags, codec, sequence number, time in milliseconds) and the encoded audio. A packet with `end` set and no audio marks the end of a burst of speech.
 * @param {{codec: number, seq: number, timestamp: number, payload: Uint8Array, end?: boolean}} p @returns {Uint8Array}
 */
export function encodeVoicePacket({ codec, seq, timestamp, payload, end = false }) {
  const out = new Uint8Array(VOICE_HEADER_BYTES + payload.length), view = new DataView(out.buffer);
  out[0] = end ? END : 0; out[1] = codec; view.setUint16(2, seq & 0xffff, true); view.setUint32(4, timestamp >>> 0, true);
  out.set(payload, VOICE_HEADER_BYTES);
  return out;
}

/** Read a voice packet. Anything malformed returns null (a network boundary: never throws). @param {Uint8Array} bytes @returns {{codec: number, seq: number, timestamp: number, payload: Uint8Array, end: boolean} | null} */
export function decodeVoicePacket(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < VOICE_HEADER_BYTES || bytes.length > 4096) return null;
  if ((bytes[0] & ~END) !== 0 || bytes[1] > CODEC.opus) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { end: (bytes[0] & END) !== 0, codec: bytes[1], seq: view.getUint16(2, true), timestamp: view.getUint32(4, true), payload: bytes.subarray(VOICE_HEADER_BYTES) };
}

// ---------------------------------------------------------------- the jitter buffer

const seqDiff = (a, b) => { const d = (a - b) & 0xffff; return d > 0x7fff ? d - 0x10000 : d; };

/**
 * Packets cross a network late, out of order, twice or not at all; speech has to come out at an even pace. The jitter buffer holds a few frames back (the *delay*), puts them in order, and
 * on each tick of the playback clock (`pull`, once per frame) gives the next frame, or says one is missing so the player can cover the gap. The delay adapts: it grows when packets keep
 * arriving too late to use and shrinks again when the network is steady. A burst of speech ends with an `end` packet, after which the buffer goes quiet until the next burst.
 */
export class JitterBuffer {
  /**
   * @param {object} [o]
   * @param {number} [o.targetFrames] How many frames to hold back to start (3, which is 60 ms of 20 ms frames). @param {number} [o.minFrames] The least the adaptive delay goes down to (2). @param {number} [o.maxFrames] The most it goes up to (15).
   * @param {number} [o.maxBuffered] Frames held before the oldest are dropped to catch up (30). @param {number} [o.maxConceal] Missing frames in a row before it gives up and goes quiet (8). @param {boolean} [o.adaptive]
   */
  constructor({ targetFrames = 3, minFrames = 2, maxFrames = 15, maxBuffered = 30, maxConceal = 8, adaptive = true } = {}) {
    Object.assign(this, { target: targetFrames, minFrames, maxFrames, maxBuffered, maxConceal, adaptive });
    /** @type {Map<number, {frame: any, end: boolean}>} */ this.held = new Map();
    this.playing = false; this.expected = 0; this.highest = 0; this.started = false; this.concealed = 0; this.sinceTrouble = 0;
    this.stats = { received: 0, played: 0, lost: 0, late: 0, duplicate: 0, dropped: 0, bursts: 0 };
  }

  /** Frames waiting. */
  get buffered() { return this.held.size; }

  /** A packet arrived. @param {number} seq @param {any} frame What `pull` will hand back (decoded samples, or the payload). @param {boolean} [end] */
  push(seq, frame, end = false) {
    this.stats.received++;
    if (!this.started || (!this.playing && this.held.size === 0)) {            // the first packet of a burst: start counting from it
      this.expected = seq; this.highest = seq; this.started = true; this.concealed = 0;
    }
    if (this.playing && seqDiff(seq, this.expected) < 0) { this.stats.late++; this.#trouble(); return; }       // too late: its turn has passed
    if (!this.playing && seqDiff(seq, this.expected) < 0) this.expected = seq;                                 // before the start: it becomes the start
    if (this.held.has(seq)) { this.stats.duplicate++; return; }
    this.held.set(seq, { frame, end });
    if (seqDiff(seq, this.highest) > 0) this.highest = seq;
    if (this.held.size > this.maxBuffered) {                                   // far behind: skip ahead to the oldest we have
      let oldest = null; for (const k of this.held.keys()) if (oldest === null || seqDiff(k, oldest) < 0) oldest = k;
      while (this.held.size > this.maxBuffered) { this.held.delete(oldest); this.stats.dropped++; oldest = (oldest + 1) & 0xffff; while (!this.held.has(oldest) && seqDiff(oldest, this.highest) <= 0) oldest = (oldest + 1) & 0xffff; }
      this.expected = oldest;
    }
  }

  #trouble() {
    this.sinceTrouble = 0;
    if (this.adaptive && this.target < this.maxFrames && this.stats.late % 2 === 0) this.target++;
  }

  /**
   * One tick of the playback clock. Returns `{ kind: 'frame', frame }`, `{ kind: 'lost' }` (cover the gap: a frame was due and has not come), or `{ kind: 'idle' }` (nothing to play: before
   * the first burst, between bursts, or after the sender went quiet).
   * @returns {{kind: 'frame' | 'lost' | 'idle', frame?: any, end?: boolean}}
   */
  pull() {
    if (!this.playing) {
      if (this.held.size === 0) return { kind: 'idle' };
      const span = seqDiff(this.highest, this.expected) + 1;
      let ends = false; for (const v of this.held.values()) if (v.end) ends = true;
      if (this.held.size < this.target && span < this.target && !ends) return { kind: 'idle' };       // still filling (a short burst that has already ended need not wait)
      this.playing = true; this.stats.bursts++;
    }
    const got = this.held.get(this.expected);
    this.sinceTrouble++;
    if (this.adaptive && this.sinceTrouble > 500 && this.target > this.minFrames) { this.target--; this.sinceTrouble = 0; }
    if (got) {
      this.held.delete(this.expected); this.expected = (this.expected + 1) & 0xffff; this.concealed = 0; this.stats.played++;
      if (got.end) { this.playing = false; this.started = false; this.held.clear(); return { kind: 'frame', frame: got.frame, end: true }; }
      return { kind: 'frame', frame: got.frame };
    }
    this.stats.lost++;
    const waitingAhead = this.held.size > 0;
    this.expected = (this.expected + 1) & 0xffff;
    this.concealed++;
    if (!waitingAhead && this.concealed > this.maxConceal) { this.playing = false; this.started = false; this.held.clear(); return { kind: 'idle' }; }
    if (!waitingAhead && this.adaptive && this.target < this.maxFrames) this.target++;       // ran dry: wait a little longer next time
    return { kind: 'lost' };
  }

  reset() { this.held.clear(); this.playing = false; this.started = false; this.concealed = 0; }
}

// ---------------------------------------------------------------- sending

/**
 * Turns frames from a microphone into packets: decides whether to send (voice activity, push-to-talk or muted), encodes, numbers the packets, and marks the end of each burst of speech.
 * Frames are a fixed number of samples (`frameSamples`, 20 ms at the codec's rate). Works with synchronous codecs and with Opus (the packets then come out a moment later, in order).
 */
export class VoiceSender {
  /**
   * @param {object} o
   * @param {{id: number, encode(frame: Float32Array): Uint8Array | Promise<Uint8Array>}} o.codec @param {number} o.frameMs Length of a frame in milliseconds (20).
   * @param {(packet: Uint8Array) => void} o.onPacket Where packets go: your network.
   * @param {VoiceActivity | null} [o.vad] Send only while speech is detected (default: a standard detector); null sends everything.
   * @param {() => number} [o.clock] Milliseconds (default `performance.now`).
   */
  constructor({ codec, frameMs = 20, onPacket, vad = new VoiceActivity(), clock = () => globalThis.performance?.now() ?? Date.now() }) {
    Object.assign(this, { codec, frameMs, onPacket, vad, clock });
    /** Push-to-talk: when set to true or false, only transmit while true (voice detection is ignored). `null` (default) means automatic. */
    this.pushToTalk = null;
    this.muted = false;
    this.seq = 0; this.talking = false; this.level = 0;
    this.stats = { frames: 0, packets: 0, bytes: 0, bursts: 0 };
  }

  /** Is a burst of speech going out? */
  get speaking() { return this.talking; }

  /** Feed one frame of microphone samples. */
  push(frame) {
    this.stats.frames++;
    this.level = rms(frame);
    const wants = this.muted ? false : this.pushToTalk !== null ? this.pushToTalk : this.vad ? this.vad.update(this.level, this.frameMs) : true;
    if (wants) {
      if (!this.talking) { this.talking = true; this.stats.bursts++; }
      this.#send(frame, false);
    } else if (this.talking) {
      this.talking = false;
      this.#send(null, true);
    }
  }

  #send(frame, end) {
    const seq = this.seq = (this.seq + 1) & 0xffff, timestamp = Math.round(this.clock());
    const emit = (payload) => {
      const packet = encodeVoicePacket({ codec: this.codec.id, seq, timestamp, payload, end });
      this.stats.packets++; this.stats.bytes += packet.length;
      this.onPacket(packet);
    };
    if (!frame) { const pending = this.pending; if (pending) pending.then(() => emit(new Uint8Array(0))); else emit(new Uint8Array(0)); return; }
    const out = this.codec.encode(frame);
    if (out && typeof out.then === 'function') { this.pending = (this.pending ?? Promise.resolve()).then(() => out).then(emit); } else emit(out);
  }
}

// ---------------------------------------------------------------- who hears whom

/**
 * The server's side of voice chat: given who is talking and who is listening, decides who hears them and how loudly. Pure logic (no sockets): your game sends the packet to each returned id.
 * Modes: `'proximity'` (within `maxDistance`, fading with distance), `'team'` (same team, any distance), `'global'` (everyone). A speaker can also be on a private `channel` (a party), heard only
 * by listeners on the same one.
 */
export class VoiceRouter {
  /** @param {{mode?: 'proximity' | 'team' | 'global', maxDistance?: number, falloff?: 'linear' | 'inverse'}} [o] */
  constructor({ mode = 'proximity', maxDistance = 40, falloff = 'linear' } = {}) { Object.assign(this, { mode, maxDistance, falloff }); }
  /**
   * @param {{id: any, x?: number, y?: number, z?: number, team?: any, channel?: any}} speaker
   * @param {Iterable<{id: any, x?: number, y?: number, z?: number, team?: any, channel?: any, deaf?: boolean, muted?: Set<any>}>} listeners
   * @returns {{id: any, gain: number, distance: number}[]}
   */
  route(speaker, listeners) {
    const out = [];
    for (const l of listeners) {
      if (l.id === speaker.id || l.deaf || l.muted?.has(speaker.id)) continue;
      if (speaker.channel !== undefined && speaker.channel !== null) { if (l.channel !== speaker.channel) continue; out.push({ id: l.id, gain: 1, distance: 0 }); continue; }
      const distance = Math.hypot((l.x ?? 0) - (speaker.x ?? 0), (l.y ?? 0) - (speaker.y ?? 0), (l.z ?? 0) - (speaker.z ?? 0));
      if (this.mode === 'team') { if (l.team !== speaker.team) continue; out.push({ id: l.id, gain: 1, distance }); continue; }
      if (this.mode === 'global') { out.push({ id: l.id, gain: 1, distance }); continue; }
      if (distance > this.maxDistance) continue;
      const gain = this.falloff === 'inverse' ? Math.min(1, 1 / (1 + distance / 4)) * (1 - distance / this.maxDistance) : 1 - distance / this.maxDistance;
      out.push({ id: l.id, gain, distance });
    }
    return out;
  }
}
