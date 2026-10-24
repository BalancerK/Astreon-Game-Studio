// A stand-in for the Web Audio API that records what the engine builds and sets, so the engine's logic can be tested without a browser.
export class Param {
  constructor(value = 1) { this.value = value; this.calls = []; }
  setValueAtTime(v, t) { this.calls.push(['set', v, t]); this.value = v; return this; }
  linearRampToValueAtTime(v, t) { this.calls.push(['ramp', v, t]); this.value = v; return this; }
  setTargetAtTime(v, t, k) { this.calls.push(['target', v, t, k]); this.value = v; return this; }
  cancelScheduledValues(t) { this.calls.push(['cancel', t]); return this; }
}
export class FakeNode {
  constructor(kind) { this.kind = kind; this.to = []; this.disconnected = false; }
  connect(n) { this.to.push(n); return n; }
  disconnect() { this.to = []; this.disconnected = true; }
}
export class FakeContext {
  constructor(state = 'running') {
    this.state = state; this.currentTime = 0; this.sampleRate = 8000; this.sources = []; this.destination = new FakeNode('destination'); this.closed = false;
  }
  createGain() { const n = new FakeNode('gain'); n.gain = new Param(1); return n; }
  createStereoPanner() { const n = new FakeNode('panner'); n.pan = new Param(0); return n; }
  createBiquadFilter() { const n = new FakeNode('biquad'); n.type = 'lowpass'; n.frequency = new Param(350); n.Q = new Param(1); n.gain = new Param(0); return n; }
  createConvolver() { return new FakeNode('convolver'); }
  createDelay() { const n = new FakeNode('delay'); n.delayTime = new Param(0); return n; }
  createWaveShaper() { return new FakeNode('shaper'); }
  createDynamicsCompressor() { const n = new FakeNode('compressor'); for (const k of ['threshold', 'knee', 'ratio', 'attack', 'release']) n[k] = new Param(0); return n; }
  createBufferSource() {
    const n = new FakeNode('source'); n.playbackRate = new Param(1); n.loop = false; n.starts = []; n.stops = [];
    n.start = (when, offset, duration) => n.starts.push(duration === undefined ? [when, offset] : [when, offset, duration]);
    n.stop = (when) => n.stops.push(when);
    n.finish = () => n.onended?.();
    this.sources.push(n);
    return n;
  }
  createBuffer(channels, length, rate) {
    const data = new Float32Array(length);
    return { duration: length / rate, length, sampleRate: rate, getChannelData: () => data, copyToChannel: (d) => data.set(d) };
  }
  createMediaElementSource(el) { const n = new FakeNode('media'); n.element = el; (this.mediaSources ??= []).push(n); return n; }
  async decodeAudioData(bytes) { return this.createBuffer(1, bytes.byteLength, 1000); }
  async resume() { this.state = 'running'; }
  async suspend() { this.state = 'suspended'; }
  close() { this.closed = true; this.state = 'closed'; }
}
