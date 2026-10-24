// WebRTC data channels as a Transport: one reliable ordered channel and one unreliable unordered channel per peer.
import { CHANNEL, createStats } from '../types.js';

/** Label of the reliable, ordered data channel (id 0; both ends agree on the labels and ids in advance). */
export const RELIABLE_LABEL = 'reliable';
/** Label of the unreliable, unordered data channel (id 1). */
export const UNRELIABLE_LABEL = 'unreliable';

/**
 * Create the two data channels on a peer connection. They are *negotiated*: both ends make them with the same ids, so neither has to wait for the other to announce them.
 * The unreliable one is truly unreliable (no retransmits, no ordering), which is what snapshots and inputs want and what a WebSocket cannot give.
 * @param {RTCPeerConnection} pc
 * @returns {{reliable: RTCDataChannel, unreliable: RTCDataChannel}}
 */
export function openChannels(pc) {
  return {
    reliable: pc.createDataChannel(RELIABLE_LABEL, { ordered: true, negotiated: true, id: 0 }),
    unreliable: pc.createDataChannel(UNRELIABLE_LABEL, { ordered: false, maxRetransmits: 0, negotiated: true, id: 1 }),
  };
}

/**
 * A peer-to-peer connection as a `Transport`. It is 'connecting' until both channels are open, 'open' while they are, and 'closed' for good when either closes, the connection fails, or
 * it stays 'disconnected' longer than `disconnectGraceMs` (a brief network blip is forgiven).
 *
 * @implements {import('../types.js').Transport}
 */
export class RtcTransport {
  /**
   * @param {RTCPeerConnection} pc
   * @param {{reliable: RTCDataChannel, unreliable: RTCDataChannel}} channels From `openChannels`.
   * @param {object} [o]
   * @param {string} [o.peerId] Who is on the other end (as the signalling named them).
   * @param {number} [o.maxMessageBytes] Larger messages are refused on send and close the connection on receipt.
   * @param {number} [o.softSendLimit] Unreliable messages are dropped while this many bytes are queued.
   * @param {number} [o.hardSendLimit] The connection is closed when this many bytes are queued on the reliable channel (the other end is not reading).
   * @param {number} [o.disconnectGraceMs]
   * @param {{setTimeout: typeof setTimeout, clearTimeout: typeof clearTimeout}} [o.timers]
   */
  constructor(pc, channels, { peerId = '', maxMessageBytes = 64 * 1024, softSendLimit = 64 * 1024, hardSendLimit = 8 * 1024 * 1024, disconnectGraceMs = 4000, timers = globalThis } = {}) {
    this.pc = pc; this.channels = channels; this.peerId = peerId;
    this.opts = { maxMessageBytes, softSendLimit, hardSendLimit, disconnectGraceMs };
    this.timers = timers;
    /** @type {'connecting' | 'open' | 'closed'} */ this.state = 'connecting';
    /** @type {((bytes: Uint8Array, channel: import('../types.js').Channel) => void) | null} */ this.onMessage = null;
    /** @type {((reason: string) => void) | null} */ this.onClose = null;
    /** @type {(() => void) | null} */ this.onOpen = null;
    this.stats = { ...createStats(), droppedMessages: 0 };
    /** The latest round-trip time from `measureRtt`, in ms (NaN until measured). */
    this.rttMs = NaN;
    this.graceTimer = null;
    this.hooks = { open: [], close: [] };
    for (const [dc, tag] of [[channels.reliable, CHANNEL.RELIABLE], [channels.unreliable, CHANNEL.UNRELIABLE]]) {
      dc.binaryType = 'arraybuffer';
      dc.onopen = () => this.#maybeOpen();
      dc.onclose = () => this.close('channel closed');
      dc.onerror = () => {};
      dc.onmessage = (ev) => this.#receive(ev.data, tag);
    }
    pc.onconnectionstatechange = () => this.#connectionState();
    this.#maybeOpen();
  }

  #maybeOpen() {
    if (this.state !== 'connecting') return;
    if (this.channels.reliable.readyState !== 'open' || this.channels.unreliable.readyState !== 'open') return;
    this.state = 'open';
    for (const fn of this.hooks.open) fn();
    this.onOpen?.();
  }

  #connectionState() {
    const s = this.pc.connectionState;
    if (s === 'failed') this.close('connection failed');
    else if (s === 'closed') this.close('closed');
    else if (s === 'disconnected') {
      this.graceTimer ??= this.timers.setTimeout(() => this.close('connection lost'), this.opts.disconnectGraceMs);
    } else if (this.graceTimer !== null) { this.timers.clearTimeout(this.graceTimer); this.graceTimer = null; }
  }

  #receive(data, tag) {
    if (this.state === 'closed') return;
    if (!(data instanceof ArrayBuffer)) { this.close('bad message'); return; }      // text frames are not part of the protocol
    if (data.byteLength > this.opts.maxMessageBytes) { this.close('message too large'); return; }
    this.stats.receivedMessages++; this.stats.receivedBytes += data.byteLength;
    this.onMessage?.(new Uint8Array(data), tag);
  }

  /** @param {Uint8Array} bytes @param {import('../types.js').Channel} [channel] @returns {boolean} False if the connection is not open or the message was refused. */
  send(bytes, channel = CHANNEL.RELIABLE) {
    if (this.state !== 'open') return false;
    if (bytes.length > this.opts.maxMessageBytes) { this.stats.droppedMessages++; return false; }
    const dc = channel === CHANNEL.UNRELIABLE ? this.channels.unreliable : this.channels.reliable;
    if (channel === CHANNEL.UNRELIABLE) {
      if (dc.bufferedAmount > this.opts.softSendLimit) { this.stats.droppedMessages++; return true; }
    } else if (dc.bufferedAmount > this.opts.hardSendLimit) { this.close('send queue overflow'); return false; }
    try { dc.send(bytes.slice()); } catch { this.close('send failed'); return false; }    // a copy, so callers can reuse their buffer at once
    this.stats.sentMessages++; this.stats.sentBytes += bytes.length;
    return true;
  }

  /** @param {string} [reason] */
  close(reason = 'closed') {
    if (this.state === 'closed') return;
    this.state = 'closed';
    if (this.graceTimer !== null) { this.timers.clearTimeout(this.graceTimer); this.graceTimer = null; }
    for (const dc of [this.channels.reliable, this.channels.unreliable]) { dc.onopen = dc.onclose = dc.onmessage = null; try { dc.close(); } catch { /* already closed */ } }
    this.pc.onconnectionstatechange = null;
    try { this.pc.close(); } catch { /* already closed */ }
    for (const fn of this.hooks.close) fn(reason);
    this.onClose?.(reason);
  }

  /** Be told when this transport opens or closes, without touching `onOpen` / `onClose` (which belong to whoever uses it). @param {'open' | 'close'} what @param {(reason?: string) => void} fn */
  watch(what, fn) { this.hooks[what].push(fn); }

  /**
   * Ask the browser for the round-trip time of the selected network path. Sets `rttMs` and returns it, or returns null if nothing is available (yet, or in an environment without `getStats`).
   * @returns {Promise<number | null>}
   */
  async measureRtt() {
    if (this.state !== 'open' || typeof this.pc.getStats !== 'function') return null;
    const stats = await this.pc.getStats();
    let best = null;
    stats.forEach((r) => { if (r.type === 'candidate-pair' && (r.nominated || r.selected) && typeof r.currentRoundTripTime === 'number') best = r.currentRoundTripTime * 1000; });
    if (best !== null) this.rttMs = best;
    return best;
  }
}
