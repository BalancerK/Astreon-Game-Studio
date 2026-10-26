// One WebTransport session as a `Transport` (see ../types.js): the reliable channel is a bidirectional stream (ordered, lossless, messages with their length in front), the unreliable channel is the
// session's datagrams (one QUIC packet each: they may be lost, repeated or reordered, and one lost is never waited for, which is the point). A payload too big for a datagram (about 1200 bytes)
// goes on the reliable channel instead, and is counted in `stats.oversize`. The client and the server both build this from a session and a stream.
import { CHANNEL, createStats } from '../types.js';
import { encodeMessage, MessageParser, MAX_STREAM_MESSAGE } from './frame.js';

/** How many datagrams may wait to be sent before new ones are dropped (a burst of a few in one tick is normal; a long queue means the sender is outrunning the network). */
const MAX_QUEUED_DATAGRAMS = 32;

/**
 * @typedef {Object} WtSessionLike What a session of either implementation (the browser's `WebTransport`, or the Node package's) offers.
 * @property {Promise<any>} closed
 * @property {(info?: {closeCode?: number, reason?: string}) => void} close
 * @property {{readable: ReadableStream<Uint8Array>, writable: WritableStream<Uint8Array>, maxDatagramSize?: number}} datagrams
 * @property {() => Promise<any>} [getStats]
 */

/**
 * Make a `Transport` from a WebTransport session and the bidirectional stream used as its reliable channel (the client and the server both use this).
 * @param {{session: WtSessionLike, stream: {readable: ReadableStream<Uint8Array>, writable: WritableStream<Uint8Array>}, maxMessageSize?: number, statsEveryMs?: number}} o
 * @returns {import('../types.js').Transport & {rttMs: number, maxDatagramSize: number, session: WtSessionLike, stats: any}}
 */
export function createWtTransport({ session, stream, maxMessageSize = MAX_STREAM_MESSAGE, statsEveryMs = 1000 }) {
  const streamWriter = stream.writable.getWriter();
  const datagramWriter = session.datagrams.writable.getWriter();
  let finished = false, statsTimer = null;

  const t = {
    session,
    state: /** @type {'connecting'|'open'|'closed'} */ ('open'),
    onMessage: null,
    onClose: null,
    stats: { ...createStats(), droppedMessages: 0, oversize: 0 },
    /** The round trip in milliseconds, as the session reports it (NaN until it does; browsers report it, the Node package may not). */
    rttMs: NaN,
    /** The largest payload that goes in one datagram. */
    get maxDatagramSize() { return session.datagrams.maxDatagramSize ?? 1000; },

    send(bytes, channel = CHANNEL.RELIABLE) {
      if (t.state !== 'open') return false;
      if (channel === CHANNEL.UNRELIABLE) {
        if (bytes.length <= t.maxDatagramSize) {
          if ((datagramWriter.desiredSize ?? 0) <= -MAX_QUEUED_DATAGRAMS) { t.stats.droppedMessages++; return true; }      // a long queue of datagrams not yet sent (the network is slower than the sender): this one is dropped, as the contract allows
          datagramWriter.write(bytes.slice()).catch(() => {});
          t.stats.sentMessages++; t.stats.sentBytes += bytes.length;
          return true;
        }
        t.stats.oversize++;
      }
      streamWriter.write(encodeMessage(bytes)).catch(() => {});
      t.stats.sentMessages++; t.stats.sentBytes += bytes.length;
      return true;
    },

    close(reason = 'closed') {
      if (t.state === 'closed') return;
      t.state = 'closed';
      try { session.close({ closeCode: 0, reason: reason.slice(0, 100) }); } catch { /* already closing */ }
      finish(reason);
    },
  };

  function finish(reason) {
    if (finished) return;
    finished = true;
    t.state = 'closed';
    if (statsTimer) clearInterval(statsTimer);
    t.onClose?.(reason);
  }

  const parser = new MessageParser({
    maxMessageSize,
    onMessage: (bytes) => { t.stats.receivedMessages++; t.stats.receivedBytes += bytes.length; t.onMessage?.(bytes, CHANNEL.RELIABLE); },
  });

  (async () => {                                                      // the stream: messages with their length in front
    const reader = stream.readable.getReader();
    try {
      for (;;) { const { value, done } = await reader.read(); if (done) break; parser.push(value); }
    } catch (e) { t.close(`stream error: ${e?.message ?? e}`); }
  })();
  (async () => {                                                      // the datagrams: each one a message
    const reader = session.datagrams.readable.getReader();
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        t.stats.receivedMessages++; t.stats.receivedBytes += value.length;
        t.onMessage?.(value, CHANNEL.UNRELIABLE);
      }
    } catch { /* the session ended */ }
  })();
  session.closed.then((info) => finish(info?.reason || 'closed'), (e) => finish(`closed: ${e?.message ?? e}`));

  if (session.getStats && statsEveryMs > 0) {                         // the round trip, when the session says (a browser does)
    statsTimer = setInterval(async () => {
      try { const s = await session.getStats(); if (Number.isFinite(s?.smoothedRtt)) t.rttMs = s.smoothedRtt; } catch { /* not available */ }
    }, statsEveryMs);
    statsTimer.unref?.();
  }
  return t;
}
