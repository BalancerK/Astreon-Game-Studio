// WebTransport server transport, Node only. Node has no HTTP/3 of its own, so this uses the package `@fails-components/webtransport` (with its `-transport-http3-quiche` binary package), which is an
// optional peer: nothing else in the engine needs it. Pass its module as `implementation`: the engine imports no outside package itself, and the game's own copy is the one used.
// Each session becomes a `Transport` like a WebSocket connection, with both channels (see ./transport.js).
import { randomBytes } from 'node:crypto';
import { createWtTransport } from './transport.js';
import { createSelfSignedCert, certificateHash } from './cert.js';

/** The hash of a certificate given as text, or null if it cannot be read (the server then does not know its own hash). */
const hashOrNull = (pem) => { try { return pem ? certificateHash(pem) : null; } catch { return null; } };

const INSTALL = 'WebTransport on Node needs the optional packages (npm install @fails-components/webtransport @fails-components/webtransport-transport-http3-quiche), and the module passed as `implementation`';

/**
 * @typedef {Object} WtServerOptions
 * @property {number} [port] 0 = pick a free one (UDP).
 * @property {string} [host]
 * @property {string} [path] The URL path sessions are accepted on.
 * @property {string} [cert] PEM certificate (with `privKey`); or use `selfSigned`.
 * @property {string} [privKey]
 * @property {{hosts?: string[], days?: number, rotateEveryDays?: number} | true} [selfSigned] Make a certificate a page can trust by hash, and replace it before it runs out (the hash changes: see `onCertificate`).
 * @property {any} [implementation] The `@fails-components/webtransport` module (anything with an `Http3Server` of the same shape).
 * @property {string} [secret] Keeps session tokens private to this server; made up if left out.
 * @property {number} [maxConnections]
 * @property {number} [maxMessageSize] Largest message on the reliable stream.
 * @property {number} [acceptTimeoutMs] How long a session may take to open its stream before it is closed.
 */

/**
 * Start a WebTransport server.
 * @param {WtServerOptions} [options]
 * @returns {Promise<{onConnection: ((connection: import('../types.js').Transport) => void) | null, port: number, host: string, path: string, readonly certificateHash: string | null, readonly certificateExpires: Date | null,
 *   onCertificate: ((hash: string, expires: Date) => void) | null, connections: Set<any>, rotateCertificate: () => string | null, close: () => Promise<void>}>}
 */
export async function listenWebTransport(options = {}) {
  const { port = 0, host = '0.0.0.0', path = '/', secret = randomBytes(16).toString('hex'), maxConnections = 1024, maxMessageSize, acceptTimeoutMs = 10_000, selfSigned = null } = options;
  const impl = options.implementation;
  if (!impl?.Http3Server) throw new Error(`${INSTALL} (no Http3Server in the module given)`);

  const selfOptions = selfSigned === true ? {} : selfSigned;
  let current = selfOptions ? createSelfSignedCert(selfOptions) : { cert: options.cert, privKey: options.privKey, hash: hashOrNull(options.cert), notAfter: null };
  if (!current.cert || !current.privKey) throw new Error('listenWebTransport needs cert and privKey, or selfSigned');

  const server = new impl.Http3Server({ port, host, secret, cert: current.cert, privKey: current.privKey });
  server.startServer();
  await server.ready;
  const connections = new Set();
  const listener = {
    onConnection: null,
    onCertificate: null,
    port: server.address()?.port ?? port,
    host,
    path,
    connections,
    get certificateHash() { return current.hash ?? null; },
    get certificateExpires() { return current.notAfter ?? null; },
    /** Replace the certificate with a new self-signed one; open sessions keep going. Returns the new hash (null if the certificate is not self-signed). */
    rotateCertificate() {
      if (!selfOptions) return null;
      current = createSelfSignedCert(selfOptions);
      server.updateCert(current.cert, current.privKey, false);
      listener.onCertificate?.(current.hash, current.notAfter);
      return current.hash;
    },
    async close() {
      clearInterval(rotation);
      for (const c of [...connections]) c.close('server shutting down');
      try { server.stopServer(); } catch { /* already stopped */ }
    },
  };
  const rotation = selfOptions ? setInterval(() => listener.rotateCertificate(), (selfOptions.rotateEveryDays ?? 5) * 86_400_000) : null;
  rotation?.unref?.();

  (async () => {                                                      // every session that asks for this path
    const sessions = await server.sessionStream(path);
    const reader = sessions.getReader();
    for (;;) {
      const { value: session, done } = await reader.read();
      if (done) break;
      accept(session).catch(() => { try { session.close({ closeCode: 1, reason: 'failed' }); } catch { /* gone */ } });
    }
  })().catch(() => {});

  /** Wait for the session to be up and for the client's stream, then hand it over as a transport. */
  async function accept(session) {
    await session.ready;
    if (connections.size >= maxConnections) { session.close({ closeCode: 2, reason: 'server full' }); return; }
    const incoming = session.incomingBidirectionalStreams.getReader();
    const timeout = setTimeout(() => { try { session.close({ closeCode: 3, reason: 'no stream' }); } catch { /* gone */ } }, acceptTimeoutMs);
    const { value: stream, done } = await incoming.read();
    clearTimeout(timeout);
    incoming.releaseLock();
    if (done || !stream) return;
    const conn = createWtTransport({ session, stream, maxMessageSize, statsEveryMs: 1000 });
    connections.add(conn);
    conn.session.closed.then(() => connections.delete(conn), () => connections.delete(conn));
    listener.onConnection?.(conn);
  }
  return listener;
}
