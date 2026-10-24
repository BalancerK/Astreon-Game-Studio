// A stand-in for WebRTC, so the signalling and the transport can be tested in Node with no browser and no network: peer connections that find each other through their handshake text.
// It models what the real thing does that matters to the code: offers and answers, candidates found one by one then "complete", channels that open only once both ends are linked, ordered and
// unordered delivery, and connection states that change.

let nextId = 1;
const registry = new Map();

export class FakeChannel {
  constructor(pc, label, opts) {
    this.pc = pc; this.label = label; this.id = opts.id; this.ordered = opts.ordered !== false; this.maxRetransmits = opts.maxRetransmits; this.negotiated = !!opts.negotiated;
    this.readyState = 'connecting'; this.bufferedAmount = 0; this.binaryType = 'blob';
    this.onopen = null; this.onclose = null; this.onmessage = null; this.onerror = null;
    this.sent = [];
  }
  send(data) {
    if (this.readyState !== 'open') throw new Error('InvalidStateError: channel is not open');
    this.sent.push(data);
    const remote = this.remote;
    const lose = !this.ordered && this.maxRetransmits === 0 && FakePeerConnection.loss > 0 && FakePeerConnection.random() < FakePeerConnection.loss;
    if (lose) return;
    const copy = data instanceof Uint8Array ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) : data;
    queueMicrotask(() => { if (remote.readyState === 'open') remote.onmessage?.({ data: remote.binaryType === 'arraybuffer' || typeof copy === 'string' ? copy : new Blob([copy]) }); });
  }
  close() {
    if (this.readyState === 'closed') return;
    this.readyState = 'closed';
    queueMicrotask(() => this.onclose?.());
    const r = this.remote;
    if (r && r.readyState !== 'closed') { r.readyState = 'closed'; queueMicrotask(() => r.onclose?.()); }
  }
}

export class FakePeerConnection {
  static loss = 0;
  static random = Math.random;
  /** When true, peers never manage to connect (a firewall in the way). */
  static blocked = false;
  static reset() { FakePeerConnection.loss = 0; FakePeerConnection.blocked = false; FakePeerConnection.random = Math.random; FakePeerConnection.created = []; registry.clear(); }
  static created = [];

  constructor(config = {}) {
    this.id = `fake${nextId++}`;
    this.config = config;
    this.localDescription = null; this.remoteDescription = null;
    this.connectionState = 'new'; this.iceGatheringState = 'new';
    this.channels = [];
    this.candidatesAdded = [];
    this.onicecandidate = null; this.onconnectionstatechange = null;
    this.listeners = {};
    this.closed = false;
    this.gathered = false;
    registry.set(this.id, this);
    FakePeerConnection.created.push(this);
  }
  addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
  #emit(type) { for (const fn of this.listeners[type] ?? []) fn({ type }); }
  createDataChannel(label, opts = {}) { const dc = new FakeChannel(this, label, opts); this.channels.push(dc); return dc; }
  async createOffer() { return { type: 'offer', sdp: `v=0\r\no=fake ${this.id}\r\n` }; }
  async createAnswer() { return { type: 'answer', sdp: `v=0\r\no=fake ${this.id}\r\n` }; }
  async setLocalDescription(desc) {
    this.#local = desc;
    this.iceGatheringState = 'gathering'; this.#emit('icegatheringstatechange');
    setTimeout(() => {
      if (this.closed) return;
      for (let i = 0; i < 2; i++) this.onicecandidate?.({ candidate: { candidate: `candidate:${i} fake ${this.id}`, sdpMid: '0', sdpMLineIndex: 0 } });
      this.gathered = true;
      this.iceGatheringState = 'complete'; this.#emit('icegatheringstatechange');
      this.onicecandidate?.({ candidate: null });
      this.#try();
    }, 0);
  }
  #local = null;
  get localDescription() { return this.#local && { type: this.#local.type, sdp: this.#local.sdp + (this.gathered ? 'a=candidate:fake\r\n' : '') }; }
  set localDescription(v) { this.#local = v; }
  async setRemoteDescription(desc) {
    if (!desc || typeof desc.sdp !== 'string' || !desc.sdp.startsWith('v=0')) throw new Error('InvalidSessionDescriptionError');
    const m = /o=fake (\w+)/.exec(desc.sdp);
    if (!m) throw new Error('InvalidSessionDescriptionError: not understood');
    this.remoteId = m[1]; this.remoteDescription = desc;
    this.remoteHasCandidates = desc.sdp.includes('a=candidate');
    this.#try();
  }
  async addIceCandidate(c) {
    if (!this.remoteDescription) throw new Error('InvalidStateError: no remote description');
    if (!c || typeof c.candidate !== 'string') throw new Error('TypeError: bad candidate');
    this.candidatesAdded.push(c);
    this.#try();
  }
  #try() {
    if (this.closed || this.connectionState === 'connected' || !this.#local || !this.remoteDescription) return;
    const remote = registry.get(this.remoteId);
    if (!remote || remote.closed || FakePeerConnection.blocked) return;
    const mine = this.candidatesAdded.length > 0 || this.remoteHasCandidates, theirs = remote.candidatesAdded.length > 0 || remote.remoteHasCandidates;
    if (!mine || !theirs || !remote.remoteDescription || !remote.localDescription) return;
    if (remote.remoteId !== this.id) return;
    this.#connect(remote); remote.#connect(this);
  }
  #connect(remote) {
    this.connectionState = 'connected';
    for (const dc of this.channels) {
      const twin = remote.channels.find((c) => c.id === dc.id);
      if (!twin) continue;
      dc.remote = twin;
    }
    queueMicrotask(() => {
      this.onconnectionstatechange?.();
      for (const dc of this.channels) if (dc.remote && dc.readyState === 'connecting') { dc.readyState = 'open'; dc.onopen?.(); }
    });
  }
  /** Simulate the network dropping or coming back, or the connection failing outright. */
  setState(state) { this.connectionState = state; this.onconnectionstatechange?.(); }
  close() {
    if (this.closed) return;
    this.closed = true; this.connectionState = 'closed';
    for (const dc of this.channels) dc.close();
    registry.delete(this.id);
  }
  async getStats() { const m = new Map(); m.set('p', { type: 'candidate-pair', nominated: true, currentRoundTripTime: 0.042 }); return m; }
}
