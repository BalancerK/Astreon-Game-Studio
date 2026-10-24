// WebSocket server transport: own RFC 6455 implementation on Node's http/net, zero dependencies.
import http from 'node:http';
import { createHash } from 'node:crypto';
import { CHANNEL, createStats } from '../types.js';
import { OP, FrameParser, WsError, encodeFrame, encodeClose } from './frame.js';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const KEY_RE = /^[A-Za-z0-9+/]{22}==$/;

/** Value for the Sec-WebSocket-Accept header. @param {string} key */
export const acceptKey = (key) => createHash('sha1').update(key + GUID).digest('base64');

/**
 * @typedef {Object} WsServerOptions
 * @property {number} [port] 0 = pick a free port.
 * @property {string} [host]
 * @property {import('node:http').Server} [server] Attach to an existing HTTP server (shares its port).
 * @property {string | ((pathname: string) => any)} [path] Only this URL path upgrades. A function decides per path: return a falsy value to refuse
 *   (404) or any truthy value to accept; it is exposed as `connection.route` (e.g. `{room: 'alpha'}` for `/ws/alpha`).
 * @property {(req: import('node:http').IncomingMessage, route: any) => boolean | {player?: any}} [authorize] Called for each connection that passed the path check, with the HTTP upgrade request (its URL, headers
 *   and cookies) and the route: return false to refuse it (403), or true / an object to accept; an object's fields are copied onto the connection (e.g. `{player}`).
 * @property {string[] | ((origin: string) => boolean)} [allowedOrigins] Browser Origin allowlist. Unset = allow all.
 * @property {boolean} [requireOrigin] Reject clients that send no Origin header (non-browser clients).
 * @property {string} [subprotocol] Selected if the client offers it.
 * @property {number} [maxPayload] Largest accepted message in bytes.
 * @property {number} [maxConnections]
 * @property {number} [maxConnectionsPerIp]
 * @property {number} [softSendLimit] Unreliable messages are dropped when this many bytes are queued for a client.
 * @property {number} [hardSendLimit] Connection is closed when this many bytes are queued (client not reading).
 * @property {number} [pingIntervalMs]
 * @property {number} [pongTimeoutMs]
 * @property {number} [maxMessagesPerSecond] Sustained inbound rate; exceeding it closes the connection.
 * @property {number} [burstMessages]
 * @property {number} [closeTimeoutMs] Wait this long for the peer's close frame before dropping the socket.
 */
const DEFAULTS = {
  port: 0, host: '127.0.0.1', path: '/', requireOrigin: false,
  maxPayload: 64 * 1024, maxConnections: 1024, maxConnectionsPerIp: 32,
  softSendLimit: 64 * 1024, hardSendLimit: 1024 * 1024,
  pingIntervalMs: 10_000, pongTimeoutMs: 10_000,
  maxMessagesPerSecond: 300, burstMessages: 600, closeTimeoutMs: 2000,
};

/** @implements {import('../types.js').Transport} */
class WsConnection {
  constructor(socket, opts, ip, onGone) {
    this.socket = socket;
    this.opts = opts;
    this.ip = ip;
    this.onGone = onGone;
    this.state = /** @type {'connecting'|'open'|'closed'} */ ('open');
    this.onMessage = null;
    this.onClose = null;
    this.stats = { ...createStats(), droppedMessages: 0 };
    /** Latest round-trip estimate from ping/pong, ms (NaN until measured). */
    this.rttMs = NaN;
    this.tokens = opts.burstMessages;
    this.lastRefill = Date.now();
    this.awaitingPongSince = 0;
    this.finished = false;

    this.parser = new FrameParser({
      expectMasked: true,
      maxMessageSize: opts.maxPayload + 1,
      onMessage: (p) => this.#inbound(p),
      onPing: (p) => { if (this.state === 'open') socket.write(encodeFrame(OP.PONG, p)); },
      onPong: (p) => {
        if (p.length === 8) this.rttMs = Date.now() - Number(p.readBigUInt64BE(0));
        this.awaitingPongSince = 0;
      },
      onClose: (code, reason) => this.#peerClosed(code, reason),
    });

    socket.on('data', (chunk) => this.#data(chunk));
    // HTTP server sockets are half-open by default: a client that vanishes without a
    // Close frame only produces 'end', never 'close', unless we end our side too.
    socket.on('end', () => { socket.end(); this.#finish('connection ended'); });
    socket.on('close', () => this.#finish('connection closed'));
    socket.on('error', (e) => this.#finish(`socket error: ${e.message}`));
    this.timer = setInterval(() => this.#heartbeat(), opts.pingIntervalMs);
    this.timer.unref();
  }

  #data(chunk) {
    if (this.state === 'closed' && this.finished) return;
    try {
      this.parser.push(chunk);
    } catch (e) {
      const code = e instanceof WsError ? e.code : 1011;
      this.#fail(code, e instanceof WsError ? e.message : 'internal error');
    }
  }

  #inbound(payload) {
    if (this.state !== 'open') return;
    const now = Date.now();
    this.tokens = Math.min(this.opts.burstMessages, this.tokens + ((now - this.lastRefill) / 1000) * this.opts.maxMessagesPerSecond);
    this.lastRefill = now;
    if (--this.tokens < 0) throw new WsError(1008, 'message rate limit exceeded');
    if (payload.length < 1 || payload[0] > CHANNEL.UNRELIABLE) throw new WsError(1002, 'bad channel tag');
    if (payload.length - 1 > this.opts.maxPayload) throw new WsError(1009, 'message too large');
    this.stats.receivedMessages++;
    this.stats.receivedBytes += payload.length - 1;
    this.onMessage?.(payload.subarray(1), payload[0]);
  }

  #heartbeat() {
    if (this.state !== 'open') return;
    const now = Date.now();
    if (this.awaitingPongSince && now - this.awaitingPongSince > this.opts.pongTimeoutMs) {
      this.state = 'closed';
      this.socket.destroy();
      this.#finish('ping timeout');
      return;
    }
    if (!this.awaitingPongSince) {
      this.awaitingPongSince = now;
      const p = Buffer.allocUnsafe(8);
      p.writeBigUInt64BE(BigInt(now));
      this.socket.write(encodeFrame(OP.PING, p));
    }
  }

  send(bytes, channel = CHANNEL.RELIABLE) {
    if (this.state !== 'open') return false;
    const queued = this.socket.writableLength;
    if (queued > this.opts.hardSendLimit) {
      this.#fail(1008, 'client is not reading (send buffer overflow)');
      return false;
    }
    if (channel === CHANNEL.UNRELIABLE && queued > this.opts.softSendLimit) {
      this.stats.droppedMessages++; // newer state will supersede it anyway
      return true;
    }
    this.stats.sentMessages++;
    this.stats.sentBytes += bytes.length;
    this.socket.write(encodeFrame(OP.BINARY, bytes, channel));
    return true;
  }

  close(reason = 'closed', code = 1000) {
    if (this.state === 'closed') return;
    this.state = 'closed';
    this.#sendCloseAndEnd(code, reason);
    this.#finish(reason);
  }

  #peerClosed(code, reason) {
    if (this.state === 'closed') { this.socket.end(); return; } // reply to our own close
    this.state = 'closed';
    this.#sendCloseAndEnd(code === 1005 ? 1000 : code, '');
    this.#finish(reason || `peer closed (${code})`);
  }

  #fail(code, message) {
    if (this.state === 'closed' && this.finished) return;
    this.state = 'closed';
    this.#sendCloseAndEnd(code, message);
    this.#finish(message);
  }

  #sendCloseAndEnd(code, reason) {
    if (!this.socket.writable) return;
    this.socket.write(encodeFrame(OP.CLOSE, encodeClose(code, reason)));
    this.socket.end();
    const t = setTimeout(() => this.socket.destroy(), this.opts.closeTimeoutMs);
    t.unref();
    this.socket.once('close', () => clearTimeout(t));
  }

  #finish(reason) {
    if (this.finished) return;
    this.finished = true;
    this.state = 'closed';
    clearInterval(this.timer);
    this.onGone(this);
    this.onClose?.(reason);
  }
}

/**
 * Start a WebSocket server. Resolves once listening.
 * @param {WsServerOptions} options
 * @returns {Promise<import('../types.js').Listener & {port: number, host: string, connections: Set<any>, close: () => Promise<void>}>}
 */
export function listenWebSocket(options = {}) {
  const opts = { ...DEFAULTS, ...options };
  const connections = new Set();
  const perIp = new Map();
  const owned = !opts.server;
  const server = opts.server ?? http.createServer((req, res) => {
    res.writeHead(426, { 'Content-Type': 'text/plain', Upgrade: 'websocket' });
    res.end('WebSocket endpoint');
  });

  const listener = {
    onConnection: null,
    port: 0,
    host: opts.host,
    connections,
    close: async () => {
      server.off('upgrade', onUpgrade);
      for (const c of [...connections]) c.close('server shutting down', 1001);
      if (owned) {
        await new Promise((resolve) => {
          const t = setTimeout(() => { server.closeAllConnections?.(); }, opts.closeTimeoutMs + 100);
          t.unref();
          server.close(() => { clearTimeout(t); resolve(); });
        });
      }
    },
  };

  function onUpgrade(req, socket, head) {
    const reject = (status, text, extra = '') => {
      socket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n${extra}\r\n`);
    };
    socket.on('error', () => {}); // errors before the transport takes over
    let pathname;
    try { pathname = new URL(req.url, 'http://x').pathname; } catch { return reject(400, 'Bad Request'); }
    const route = typeof opts.path === 'function' ? opts.path(pathname) : pathname === opts.path;
    if (!route) return reject(404, 'Not Found');
    if (req.method !== 'GET') return reject(405, 'Method Not Allowed');
    let accepted = null;
    if (opts.authorize) {
      try { accepted = opts.authorize(req, route); } catch { accepted = false; }
      if (!accepted) return reject(403, 'Forbidden');
    }
    const h = req.headers;
    if (String(h.upgrade).toLowerCase() !== 'websocket' || !/(^|,)\s*upgrade\s*(,|$)/i.test(String(h.connection))) {
      return reject(400, 'Bad Request');
    }
    if (h['sec-websocket-version'] !== '13') return reject(426, 'Upgrade Required', 'Sec-WebSocket-Version: 13\r\n');
    const key = h['sec-websocket-key'];
    if (typeof key !== 'string' || !KEY_RE.test(key)) return reject(400, 'Bad Request');
    const origin = h.origin;
    if (opts.requireOrigin && !origin) return reject(403, 'Forbidden');
    if (origin && opts.allowedOrigins) {
      const ok = typeof opts.allowedOrigins === 'function' ? opts.allowedOrigins(origin) : opts.allowedOrigins.includes(origin);
      if (!ok) return reject(403, 'Forbidden');
    }
    const ip = req.socket.remoteAddress ?? 'unknown';
    if (connections.size >= opts.maxConnections) return reject(503, 'Service Unavailable');
    if ((perIp.get(ip) ?? 0) >= opts.maxConnectionsPerIp) return reject(429, 'Too Many Requests');

    let protocolHeader = '';
    if (opts.subprotocol) {
      const offered = String(h['sec-websocket-protocol'] ?? '').split(',').map((s) => s.trim());
      if (offered.includes(opts.subprotocol)) protocolHeader = `Sec-WebSocket-Protocol: ${opts.subprotocol}\r\n`;
    }
    socket.setNoDelay(true); // Nagle adds up to ~40 ms to small game packets
    socket.setTimeout(0);
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${acceptKey(key)}\r\n${protocolHeader}\r\n`,
    );
    perIp.set(ip, (perIp.get(ip) ?? 0) + 1);
    const conn = new WsConnection(socket, opts, ip, (c) => {
      connections.delete(c);
      const n = (perIp.get(c.ip) ?? 1) - 1;
      if (n <= 0) perIp.delete(c.ip); else perIp.set(c.ip, n);
    });
    connections.add(conn);
    conn.route = route;
    if (accepted && typeof accepted === 'object') Object.assign(conn, accepted);
    listener.onConnection?.(conn);
    if (head && head.length > 0) conn.parser.push(head);
  }

  server.on('upgrade', onUpgrade);
  return new Promise((resolve, reject) => {
    const done = () => {
      const addr = server.address();
      listener.port = typeof addr === 'object' && addr ? addr.port : opts.port;
      resolve(listener);
    };
    if (owned) {
      server.once('error', reject);
      server.listen(opts.port, opts.host, done);
    } else if (server.listening) done();
    else server.once('listening', done);
  });
}
