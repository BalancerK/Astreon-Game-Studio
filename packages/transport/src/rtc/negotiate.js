// The offer / answer / candidate exchange that sets a peer connection up, independent of how the messages travel.
import { openChannels, RtcTransport } from './transport.js';

/**
 * @typedef {object} RtcOptions
 * @property {RTCIceServer[]} [iceServers] STUN / TURN servers. Empty by default: peers on the same network find each other, and nothing is sent to a third party. Add a STUN server to connect across the internet through most routers.
 * @property {{RTCPeerConnection: typeof RTCPeerConnection}} [rtc] Where `RTCPeerConnection` comes from (default: the global one); tests pass a fake.
 * @property {number} [connectTimeoutMs] Give up on a peer that has not connected after this long (default 20 s).
 * @property {boolean} [trickle] Send candidates as they are found (default). `false` waits until all are in and puts them in the offer or answer, for codes that are copied by hand.
 * @property {number} [maxMessageBytes] @property {number} [softSendLimit] @property {number} [hardSendLimit] @property {number} [disconnectGraceMs] See `RtcTransport`.
 * @property {{setTimeout: typeof setTimeout, clearTimeout: typeof clearTimeout}} [timers]
 */

/** The options `RtcTransport` takes, picked out. @param {RtcOptions} o @param {string} peerId */
export const transportOptions = (o, peerId) => ({ peerId, maxMessageBytes: o.maxMessageBytes, softSendLimit: o.softSendLimit, hardSendLimit: o.hardSendLimit, disconnectGraceMs: o.disconnectGraceMs, timers: o.timers });

/**
 * One end of a negotiation. `send` carries signalling messages to the other end (`{t: 'offer' | 'answer' | 'ice', ...}`); `receive` takes what the other end sent.
 * The side that starts it (`offerer`) makes the data channels and the offer; the other answers. Candidates that arrive before the remote description are held until it is set.
 */
export class Negotiation {
  /**
   * @param {object} o
   * @param {boolean} o.offerer @param {(message: object) => void} o.send @param {string} [o.peerId] @param {RtcOptions} [o.options]
   */
  constructor({ offerer, send, peerId = '', options = {} }) {
    const Impl = (options.rtc ?? globalThis).RTCPeerConnection;
    if (!Impl) throw new Error('no RTCPeerConnection available (WebRTC needs a browser, or pass { rtc })');
    this.options = options; this.offerer = offerer; this.send = send; this.peerId = peerId;
    this.pc = new Impl({ iceServers: options.iceServers ?? [] });
    this.channels = openChannels(this.pc);
    this.pending = [];
    this.remoteSet = false;
    /** The answer has arrived (even if it is still being applied): the other side has done its part and may now go. */
    this.answered = false;
    this.done = false;
    this.timers = options.timers ?? globalThis;
    const t = new RtcTransport(this.pc, this.channels, transportOptions(options, peerId));
    /** The transport, from the start: 'connecting' until the channels open. */
    this.rtcTransport = t;
    /** Resolves with the open transport; rejects with an Error if negotiation fails or times out. @type {Promise<RtcTransport>} */
    this.transport = new Promise((resolve, reject) => {
      this.fail = (reason) => { if (this.done) return; this.done = true; this.timers.clearTimeout(this.timer); reject(new Error(reason)); t.close(reason); };
      t.watch('open', () => { if (this.done) return; this.done = true; this.timers.clearTimeout(this.timer); resolve(t); });
      t.watch('close', (reason) => this.fail(`connection ${reason}`));
    });
    this.transport.catch(() => {});
    this.timer = this.timers.setTimeout(() => this.fail('timed out connecting'), options.connectTimeoutMs ?? 20_000);
    this.pc.onicecandidate = (ev) => { if (ev.candidate && !this.done && options.trickle !== false) this.send({ t: 'ice', candidate: { candidate: ev.candidate.candidate, sdpMid: ev.candidate.sdpMid, sdpMLineIndex: ev.candidate.sdpMLineIndex } }); };
  }

  /** With candidates not trickled: wait until the browser has found them all (or `gatherMs` has passed). */
  async #gathered(gatherMs = 4000) {
    const pc = this.pc;
    if (this.options.trickle !== false || pc.iceGatheringState === 'complete') return;
    await new Promise((resolve) => {
      const timer = this.timers.setTimeout(resolve, gatherMs);
      const check = () => { if (pc.iceGatheringState === 'complete') { this.timers.clearTimeout(timer); resolve(); } };
      pc.addEventListener?.('icegatheringstatechange', check);
      const prev = pc.onicecandidate;
      pc.onicecandidate = (ev) => { prev?.(ev); if (!ev.candidate) check(); };
    });
  }

  /** Start: make the offer and send it. Only for the offering side. */
  async start() {
    try {
      await this.pc.setLocalDescription(await this.pc.createOffer());
      await this.#gathered();
      this.send({ t: 'offer', sdp: this.pc.localDescription.sdp });
    } catch (e) { this.fail(`could not make an offer: ${e.message}`); }
  }

  /** @param {any} message What the other end sent. */
  async receive(message) {
    if (this.done || !message || typeof message !== 'object') return;
    if (message.t === 'answer') this.answered = true;
    try {
      if (message.t === 'offer' && !this.offerer && typeof message.sdp === 'string') {
        await this.pc.setRemoteDescription({ type: 'offer', sdp: message.sdp });
        this.remoteSet = true;
        await this.pc.setLocalDescription(await this.pc.createAnswer());
        await this.#gathered();
        this.send({ t: 'answer', sdp: this.pc.localDescription.sdp });
        await this.#flush();
      } else if (message.t === 'answer' && this.offerer && typeof message.sdp === 'string') {
        await this.pc.setRemoteDescription({ type: 'answer', sdp: message.sdp });
        this.remoteSet = true;
        await this.#flush();
      } else if (message.t === 'ice' && message.candidate && typeof message.candidate === 'object') {
        if (this.remoteSet) await this.pc.addIceCandidate(message.candidate); else this.pending.push(message.candidate);
      }
    } catch (e) { this.fail(`negotiation failed: ${e.message}`); }
  }

  async #flush() { const held = this.pending; this.pending = []; for (const c of held) await this.pc.addIceCandidate(c); }

  /** Stop and tear down (a transport that already opened is left alone). */
  cancel(reason = 'cancelled') { if (!this.done) this.fail(reason); }
}
