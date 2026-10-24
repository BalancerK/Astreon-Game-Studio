import { VirtualClock } from './clock.js';
import { LinkSimulator, createRng } from './link.js';
import { CHANNEL, createStats } from './types.js';

/** @implements {import('./types.js').Transport} */
class MemoryTransport {
  /** @param {LinkSimulator} outLink Path used for messages this end sends. */
  constructor(outLink) {
    this.outLink = outLink;
    /** @type {MemoryTransport | null} */
    this.peer = null;
    this.state = /** @type {'connecting'|'open'|'closed'} */ ('open');
    this.onMessage = null;
    this.onClose = null;
    this.stats = createStats();
  }

  send(bytes, channel = CHANNEL.RELIABLE) {
    if (this.state === 'closed') return false;
    const copy = bytes.slice(); // callers reuse their buffers
    this.stats.sentMessages++;
    this.stats.sentBytes += copy.length;
    const peer = this.peer;
    this.outLink.transmit(channel, copy.length, () => peer._receive(copy, channel));
    return true;
  }

  _receive(bytes, channel) {
    if (this.state !== 'open') return;
    this.stats.receivedMessages++;
    this.stats.receivedBytes += bytes.length;
    this.onMessage?.(bytes, channel);
  }

  close(reason = 'closed') {
    if (this.state === 'closed') return;
    this.state = 'closed';
    const peer = this.peer;
    // Ordered after every message already sent, like a TCP FIN.
    this.outLink.transmit(CHANNEL.RELIABLE, 0, () => peer._remoteClosed(reason));
    this.onClose?.(reason);
  }

  _remoteClosed(reason) {
    if (this.state === 'closed') return;
    this.state = 'closed';
    this.onClose?.(reason);
  }
}

/**
 * In-process network for tests, tools and single-page demos. Supports the same
 * listen/connect flow as a real server, with simulated latency, jitter, loss,
 * duplication, reordering and bandwidth limits per direction.
 *
 * `link` accepts either one config used for both directions, or `{ up, down }`
 * (up = client to server). A client's `connect` may override it per connection.
 */
export class MemoryNetwork {
  /**
   * @param {object} [o]
   * @param {import('./clock.js').Clock} [o.clock] Defaults to a new VirtualClock.
   * @param {number} [o.seed]
   * @param {import('./link.js').LinkConfig | {up?: import('./link.js').LinkConfig, down?: import('./link.js').LinkConfig}} [o.link]
   */
  constructor({ clock = new VirtualClock(), seed = 1, link = {} } = {}) {
    this.clock = clock;
    this.rng = createRng(seed);
    this.link = link;
    /** @type {Map<string, import('./types.js').Listener>} */
    this.listeners = new Map();
  }

  /** @param {string} address @returns {import('./types.js').Listener} */
  listen(address) {
    if (this.listeners.has(address)) throw new Error(`address "${address}" is already in use`);
    const listener = {
      onConnection: null,
      close: () => { this.listeners.delete(address); },
    };
    this.listeners.set(address, listener);
    return listener;
  }

  /**
   * @param {string} address
   * @param {typeof this.link} [link] Per-connection override.
   * @returns {import('./types.js').Transport} The client end; usable immediately.
   */
  connect(address, link = this.link) {
    const listener = this.listeners.get(address);
    if (!listener) throw new Error(`no listener at "${address}"`);
    const both = 'up' in link || 'down' in link ? link : { up: link, down: link };
    const up = new LinkSimulator(this.clock, this.rng, both.up ?? {});
    const down = new LinkSimulator(this.clock, this.rng, both.down ?? {});
    const client = new MemoryTransport(up);
    const server = new MemoryTransport(down);
    client.peer = server;
    server.peer = client;
    server.state = 'connecting';
    // The server learns of the client after the reliable one-way delay; later
    // reliable messages are ordered behind this, unreliable ones sent too
    // early are dropped (the server end is not open yet).
    up.transmit(CHANNEL.RELIABLE, 0, () => {
      if (client.state === 'closed' || !this.listeners.has(address)) return;
      server.state = 'open';
      listener.onConnection?.(server);
    });
    return client;
  }
}
