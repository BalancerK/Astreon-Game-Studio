// WebSocket client transport over the standard WebSocket API (browsers, Node 22+, Deno, Bun).
import { CHANNEL, createStats } from '../types.js';

/**
 * Connect to a server started with `listenWebSocket`. Returns immediately;
 * `state` is 'connecting' until the socket opens, then `onOpen` fires.
 *
 * @param {string} url e.g. `ws://localhost:8080/`
 * @param {object} [o]
 * @param {typeof WebSocket} [o.WebSocketImpl]
 * @param {number} [o.softSendLimit] Unreliable messages are dropped while this many bytes are buffered.
 * @param {string | string[]} [o.protocols]
 * @returns {import('../types.js').Transport & {onOpen: (() => void) | null, ws: WebSocket}}
 */
export function connectWebSocket(url, { WebSocketImpl = globalThis.WebSocket, softSendLimit = 64 * 1024, protocols } = {}) {
  if (!WebSocketImpl) throw new Error('no WebSocket implementation available');
  const ws = protocols ? new WebSocketImpl(url, protocols) : new WebSocketImpl(url);
  ws.binaryType = 'arraybuffer';
  let finished = false;

  const t = {
    ws,
    state: /** @type {'connecting'|'open'|'closed'} */ ('connecting'),
    onOpen: null,
    onMessage: null,
    onClose: null,
    stats: { ...createStats(), droppedMessages: 0 },

    send(bytes, channel = CHANNEL.RELIABLE) {
      if (t.state !== 'open') return false;
      if (channel === CHANNEL.UNRELIABLE && ws.bufferedAmount > softSendLimit) {
        t.stats.droppedMessages++;
        return true;
      }
      const framed = new Uint8Array(bytes.length + 1); // copies, so callers can reuse their buffer
      framed[0] = channel;
      framed.set(bytes, 1);
      t.stats.sentMessages++;
      t.stats.sentBytes += bytes.length;
      ws.send(framed);
      return true;
    },

    close(reason = 'closed') {
      if (t.state === 'closed') return;
      const wasOpen = t.state === 'open';
      t.state = 'closed';
      try { ws.close(1000, reason.slice(0, 100)); } catch { /* already closing */ }
      if (wasOpen || !finished) finish(reason);
    },
  };

  function finish(reason) {
    if (finished) return;
    finished = true;
    t.state = 'closed';
    t.onClose?.(reason);
  }

  ws.onopen = () => { if (t.state === 'connecting') { t.state = 'open'; t.onOpen?.(); } };
  ws.onmessage = (ev) => {
    if (!(ev.data instanceof ArrayBuffer) || ev.data.byteLength < 1) return;
    const u8 = new Uint8Array(ev.data);
    if (u8[0] > CHANNEL.UNRELIABLE) { t.close('bad channel tag'); return; }
    t.stats.receivedMessages++;
    t.stats.receivedBytes += u8.length - 1;
    t.onMessage?.(u8.subarray(1), /** @type {0|1} */ (u8[0]));
  };
  ws.onerror = () => {};
  ws.onclose = (ev) => finish(ev.reason || `closed (${ev.code})`);
  return t;
}
