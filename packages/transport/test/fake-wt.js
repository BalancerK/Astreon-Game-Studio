// A WebTransport that lives in one process, for tests that must not need a network or the native QUIC package: a fake `Http3Server` and a fake `WebTransport` class that find each other by port.
// Datagrams can be made to get lost (a function decides), streams are lossless and ordered, like the real thing.

const servers = new Map();

/** Two ends of a pipe made of web streams. */
function pipe() {
  let controller;
  const readable = new ReadableStream({ start(c) { controller = c; } });
  const writable = new WritableStream({ write(chunk) { controller.enqueue(chunk); }, close() { try { controller.close(); } catch { /* closed */ } } });
  return { readable, writable };
}

function deferred() { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; }

/** @param {{drop?: (direction: 'up' | 'down', bytes: Uint8Array) => boolean, maxDatagramSize?: number}} [o] */
export function createFakeWt({ drop = () => false, maxDatagramSize = 1200 } = {}) {
  class FakeHttp3Server {
    constructor(args) {
      this.args = args; this.port = args.port || 40000 + servers.size; this.host = args.host;
      this.ready = Promise.resolve(); this.certUpdates = 0; this.stopped = false;
      this.paths = new Map();
      servers.set(this.port, this);
    }
    startServer() {}
    stopServer() { this.stopped = true; servers.delete(this.port); for (const c of this.paths.values()) c.close(); }
    updateCert() { this.certUpdates++; }
    address() { return { port: this.port, host: this.host, family: 'IPv4' }; }
    sessionStream(path) {
      return Promise.resolve(new ReadableStream({ start: (c) => { this.paths.set(path, c); } }));
    }
    accept(path, session) { this.paths.get(path)?.enqueue(session); }
  }

  class FakeWebTransport {
    constructor(url, options) {
      this.options = options;
      const u = new URL(url);
      const server = servers.get(Number(u.port));
      const ready = deferred(), closed = deferred(), serverClosed = deferred();
      this.ready = ready.promise; this.closed = closed.promise;
      const up = pipe(), down = pipe();                              // datagrams: client to server, and back
      const lossy = (stream, direction) => {
        const { readable, writable } = pipe();
        const w = stream.writable.getWriter();
        return { readable: stream.readable, writable: new WritableStream({ write(chunk) { if (!drop(direction, chunk)) return w.write(chunk); } }), raw: { readable, writable } };
      };
      const dgUp = lossy(up, 'up'), dgDown = lossy(down, 'down');
      this.datagrams = { readable: dgDown.readable, writable: dgUp.writable, maxDatagramSize };
      const clientToServer = pipe(), serverToClient = pipe();         // the one stream
      let streamOpened = null;
      const incoming = new ReadableStream({ start(c) { streamOpened = c; } });
      this.createBidirectionalStream = async () => {
        streamOpened.enqueue({ readable: clientToServer.readable, writable: serverToClient.writable });
        return { readable: serverToClient.readable, writable: clientToServer.writable };
      };
      const serverSession = {
        ready: Promise.resolve(), closed: serverClosed.promise,
        datagrams: { readable: dgUp.readable, writable: dgDown.writable, maxDatagramSize },
        incomingBidirectionalStreams: incoming,
        close: (info) => { serverClosed.resolve(info ?? {}); closed.resolve(info ?? {}); },
      };
      this.close = (info) => { closed.resolve(info ?? {}); serverClosed.resolve(info ?? {}); };
      this.serverSession = serverSession;
      if (!server) { ready.resolve(); queueMicrotask(() => closed.resolve({ reason: 'no server' })); return; }
      server.accept(u.pathname, serverSession);
      ready.resolve();
    }
  }
  return { Http3Server: FakeHttp3Server, WebTransport: FakeWebTransport };
}
