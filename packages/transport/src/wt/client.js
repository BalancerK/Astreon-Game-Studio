// WebTransport client: browsers (Chrome, Edge, Firefox, recent Safari) and anything else with a standard `WebTransport` class, including the Node package `@fails-components/webtransport` (pass its
// class as `WebTransportImpl`). Over HTTP/3, so over UDP. See ./transport.js for how the two channels map.
import { createWtTransport } from './transport.js';
import { encodeMessage } from './frame.js';

/** @param {string | Uint8Array} hash base64 text or the 32 bytes @returns {Uint8Array} */
function hashBytes(hash) {
  if (typeof hash !== 'string') return hash;
  const bin = atob(hash.trim());
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/**
 * Connect to a server started with `listenWebTransport` (or any WebTransport server that takes a stream opened by the client as the reliable channel). Returns at once; `state` is 'connecting'
 * until the session is up, then `onOpen` is called.
 * @param {string} url e.g. `https://game.example:8788/wt`
 * @param {{certificateHashes?: Array<string | Uint8Array>, WebTransportImpl?: any, maxMessageSize?: number, statsEveryMs?: number}} [o]
 * `certificateHashes` (SHA-256 of the server's certificate, base64) lets a page trust a self-signed certificate that is valid for up to two weeks, which is what `createSelfSignedCert` makes.
 * @returns {import('../types.js').Transport & {onOpen: (() => void) | null, rttMs: number, maxDatagramSize: number, session: any}}
 */
export function connectWebTransport(url, { certificateHashes, WebTransportImpl = globalThis.WebTransport, maxMessageSize, statsEveryMs } = {}) {
  if (!WebTransportImpl) throw new Error('no WebTransport implementation available');
  const options = certificateHashes?.length ? { serverCertificateHashes: certificateHashes.map((h) => ({ algorithm: 'sha-256', value: hashBytes(h) })) } : undefined;
  const wt = new WebTransportImpl(url, options);
  let inner = null, finished = false;
  const t = {
    session: wt,
    state: /** @type {'connecting'|'open'|'closed'} */ ('connecting'),
    onOpen: null,
    onMessage: null,
    onClose: null,
    stats: { sentMessages: 0, sentBytes: 0, receivedMessages: 0, receivedBytes: 0, droppedMessages: 0, oversize: 0 },
    get rttMs() { return inner ? inner.rttMs : NaN; },
    get maxDatagramSize() { return inner?.maxDatagramSize ?? 1000; },
    send(bytes, channel) { return inner ? inner.send(bytes, channel) : false; },
    close(reason = 'closed') {
      if (t.state === 'closed') return;
      if (inner) { inner.close(reason); return; }
      t.state = 'closed';
      try { wt.close({ closeCode: 0, reason: reason.slice(0, 100) }); } catch { /* not open yet */ }
      finish(reason);
    },
  };
  function finish(reason) {
    if (finished) return;
    finished = true;
    t.state = 'closed';
    t.onClose?.(reason);
  }
  wt.closed.then((info) => finish(info?.reason || 'closed'), (e) => finish(`closed: ${e?.message ?? e}`));
  wt.ready.then(async () => {
    const stream = await wt.createBidirectionalStream();
    const writer = stream.writable.getWriter();
    await writer.write(encodeMessage(new Uint8Array(0)));            // (the stream is only seen by the server once something is sent on it)
    writer.releaseLock();
    inner = createWtTransport({ session: wt, stream, maxMessageSize, statsEveryMs });
    inner.onMessage = (bytes, channel) => t.onMessage?.(bytes, channel);
    inner.onClose = (reason) => finish(reason);
    t.stats = inner.stats;
    if (t.state === 'connecting') { t.state = 'open'; t.onOpen?.(); }
  }).catch((e) => { finish(`could not connect: ${e?.message ?? e}`); });
  return t;
}
