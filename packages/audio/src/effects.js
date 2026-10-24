/**
 * Effects for audio buses: filters, reverb, echo and a compressor, made from standard Web Audio nodes. A factory such as `lowpass(800)` only describes the effect (plain data);
 * `AudioEngine.addEffect(bus, effect)` builds it on a bus and gives back a handle to change it while it plays.
 *
 * @typedef {{kind: string, [key: string]: any}} EffectSpec
 * @typedef {Object} EffectHandle
 * @property {string} kind
 * @property {boolean} enabled Turn the effect on and off (it is taken out of the chain while off, so it costs nothing)
 * @property {(values: Record<string, number>, fade?: number) => void} set Change settings, optionally gliding over `fade` seconds (for example `{ frequency: 400 }`)
 */

const FILTER_TYPES = ['lowpass', 'highpass', 'bandpass', 'notch', 'lowshelf', 'highshelf', 'peaking', 'allpass'];

/** A filter that lets low sounds through and takes the highs off (a muffled, underwater, behind-a-wall sound). `frequency` in Hz is where the sound starts to dull. */
export const lowpass = (frequency = 800, q = 0.7) => ({ kind: 'filter', type: 'lowpass', frequency, q });
/** A filter that lets high sounds through and takes the lows off (a thin, tinny, telephone sound). */
export const highpass = (frequency = 400, q = 0.7) => ({ kind: 'filter', type: 'highpass', frequency, q });
/** A filter that keeps a band of sounds around `frequency`. */
export const bandpass = (frequency = 1000, q = 1) => ({ kind: 'filter', type: 'bandpass', frequency, q });
/** Any filter: `type` is lowpass, highpass, bandpass, notch, lowshelf, highshelf, peaking or allpass; `gain` in dB is used by the shelves and peaking. */
export function filter(type, frequency = 1000, { q = 0.7, gain = 0 } = {}) {
  if (!FILTER_TYPES.includes(type)) throw new Error(`filter type must be one of ${FILTER_TYPES.join(', ')} (got ${type})`);
  return { kind: 'filter', type, frequency, q, gain };
}
/**
 * Reverberation: the sound of a room. `seconds` is how long the tail lasts (0.3 a small room, 2 a hall, 5 a cathedral), `damping` 0 to 1 how much the highs die first (dull
 * rooms), `wet` how much reverb is mixed in (0 none, 1 only reverb), `preDelay` seconds before it starts.
 */
export const reverb = ({ seconds = 1.5, damping = 0.5, wet = 0.3, preDelay = 0.01, seed = 1 } = {}) => ({ kind: 'reverb', seconds, damping, wet, preDelay, seed });
/** Echo: the sound repeats every `time` seconds, each repeat `feedback` times as loud (below 1), mixed in at `wet`. */
export const echo = ({ time = 0.3, feedback = 0.4, wet = 0.3 } = {}) => ({ kind: 'echo', time, feedback, wet });
/** Evens out loudness: sound over `threshold` dB is turned down by `ratio`. */
export const compressor = ({ threshold = -24, ratio = 4, attack = 0.01, release = 0.2, knee = 12 } = {}) => ({ kind: 'compressor', threshold, ratio, attack, release, knee });

/**
 * The impulse response of a room: decaying noise, made the same way every time from `seed` (a tiny generator, no `Math.random`). It falls by 60 dB in `seconds`, and with
 * `damping` the highs fall faster than the lows. Returned as two channels (left and right differ, which is what makes it sound wide).
 * @returns {Float32Array[]}
 */
export function reverbImpulse(sampleRate, seconds, damping = 0.5, seed = 1) {
  const length = Math.max(1, Math.floor(sampleRate * seconds));
  const channels = [new Float32Array(length), new Float32Array(length)];
  for (let c = 0; c < 2; c++) {
    let state = (seed * 2654435761 + c * 40503 + 12345) >>> 0, low = 0;
    const out = channels[c];
    for (let i = 0; i < length; i++) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      const noise = state / 2147483648 - 1;
      const t = i / length;
      const k = 1 - damping * 0.95 * Math.min(1, t * 1.5);                 // later in the tail the one-pole filter closes, so the highs fade first
      low += (noise - low) * Math.max(0.02, k);
      out[i] = low * Math.exp(-6.907755 * t) * (1 - Math.exp(-i / (sampleRate * 0.002)));   // -60 dB at the end, and a 2 ms rise so it does not click
    }
  }
  // normalise so that wet and dry have the same loudness
  let energy = 0;
  for (const ch of channels) for (let i = 0; i < length; i++) energy += ch[i] * ch[i];
  const gain = energy > 0 ? 1 / Math.sqrt(energy / 2) : 1;
  for (const ch of channels) for (let i = 0; i < length; i++) ch[i] *= gain;
  return channels;
}

const ramp = (param, value, time, now) => {
  const current = param.value;
  param.cancelScheduledValues(now);
  param.setValueAtTime(current, now);
  if (time > 0) param.linearRampToValueAtTime(value, now + time); else param.setValueAtTime(value, now);
};

/**
 * Build an effect from its description on an audio context.
 * @param {BaseAudioContext} ctx
 * @param {EffectSpec} spec
 * @returns {{input: AudioNode, output: AudioNode, set: (values: Record<string, number>, fade: number) => void, nodes: AudioNode[]}}
 */
export function buildEffect(ctx, spec) {
  const now = () => ctx.currentTime;
  if (spec.kind === 'filter') {
    const f = ctx.createBiquadFilter();
    f.type = spec.type; f.frequency.value = spec.frequency; f.Q.value = spec.q; if (f.gain) f.gain.value = spec.gain ?? 0;
    return {
      input: f, output: f, nodes: [f],
      set(values, fade) {
        if (values.frequency !== undefined) ramp(f.frequency, values.frequency, fade, now());
        if (values.q !== undefined) ramp(f.Q, values.q, fade, now());
        if (values.gain !== undefined && f.gain) ramp(f.gain, values.gain, fade, now());
      },
    };
  }
  if (spec.kind === 'reverb') {
    const input = ctx.createGain(), output = ctx.createGain(), dry = ctx.createGain(), wet = ctx.createGain(), pre = ctx.createDelay(Math.max(1, spec.preDelay + 0.1));
    const convolver = ctx.createConvolver();
    const ir = reverbImpulse(ctx.sampleRate ?? 48000, spec.seconds, spec.damping, spec.seed);
    const buffer = ctx.createBuffer(2, ir[0].length, ctx.sampleRate ?? 48000);
    for (let c = 0; c < 2; c++) { if (buffer.copyToChannel) buffer.copyToChannel(ir[c], c); else buffer.getChannelData(c).set(ir[c]); }
    convolver.buffer = buffer;
    pre.delayTime.value = spec.preDelay;
    dry.gain.value = 1 - spec.wet * 0.5; wet.gain.value = spec.wet;
    input.connect(dry); dry.connect(output);
    input.connect(pre); pre.connect(convolver); convolver.connect(wet); wet.connect(output);
    return {
      input, output, nodes: [input, output, dry, wet, pre, convolver],
      set(values, fade) {
        if (values.wet !== undefined) { ramp(wet.gain, values.wet, fade, now()); ramp(dry.gain, 1 - values.wet * 0.5, fade, now()); }
        if (values.preDelay !== undefined) ramp(pre.delayTime, values.preDelay, fade, now());
      },
    };
  }
  if (spec.kind === 'echo') {
    const input = ctx.createGain(), output = ctx.createGain(), dry = ctx.createGain(), wet = ctx.createGain(), delay = ctx.createDelay(Math.max(1, spec.time * 2)), feedback = ctx.createGain();
    delay.delayTime.value = spec.time; feedback.gain.value = Math.min(0.95, spec.feedback); wet.gain.value = spec.wet; dry.gain.value = 1;
    input.connect(dry); dry.connect(output);
    input.connect(delay); delay.connect(wet); wet.connect(output);
    delay.connect(feedback); feedback.connect(delay);
    return {
      input, output, nodes: [input, output, dry, wet, delay, feedback],
      set(values, fade) {
        if (values.wet !== undefined) ramp(wet.gain, values.wet, fade, now());
        if (values.feedback !== undefined) ramp(feedback.gain, Math.min(0.95, values.feedback), fade, now());
        if (values.time !== undefined) ramp(delay.delayTime, values.time, fade, now());
      },
    };
  }
  if (spec.kind === 'compressor') {
    const c = ctx.createDynamicsCompressor();
    c.threshold.value = spec.threshold; c.ratio.value = spec.ratio; c.attack.value = spec.attack; c.release.value = spec.release; c.knee.value = spec.knee;
    return {
      input: c, output: c, nodes: [c],
      set(values, fade) {
        if (values.threshold !== undefined) ramp(c.threshold, values.threshold, fade, now());
        if (values.ratio !== undefined) ramp(c.ratio, values.ratio, fade, now());
      },
    };
  }
  throw new Error(`unknown effect "${spec.kind}": make one with lowpass, highpass, bandpass, filter, reverb, echo or compressor`);
}

/** The cut-off frequency (Hz) that dulls a sound by `amount` (0 untouched, 1 fully muffled, as if heard through a thick wall). */
export function occlusionFrequency(amount) {
  const a = Math.sqrt(Math.max(0, Math.min(1, amount)));                     // the first part of a wall dulls the most
  return 22000 * Math.exp(a * Math.log(450 / 22000));
}
