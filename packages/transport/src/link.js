import { CHANNEL } from './types.js';

/** Small fast seeded PRNG (mulberry32) so simulated networks are reproducible. */
export function createRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * One direction of a simulated network path.
 *
 * @typedef {Object} LinkConfig
 * @property {number} [latencyMs] One-way delay.
 * @property {number} [jitterMs] Extra random delay, uniform in [0, jitterMs].
 * @property {number} [loss] Packet loss probability 0..1.
 * @property {number} [duplicate] Chance an unreliable packet is delivered twice.
 * @property {number} [reorder] Chance an unreliable packet is held back extra.
 * @property {number} [reorderDelayMs] How long a reordered packet is held (default 20).
 * @property {number} [bandwidthBps] Bits per second; 0 = unlimited.
 * @property {number} [maxQueueMs] Unreliable packets that would wait longer than this are tail-dropped (default 200).
 * @property {number} [retransmitMs] Delay per lost reliable attempt (default max(2 x latency, 100)).
 */
export class LinkSimulator {
  /**
   * @param {import('./clock.js').Clock} clock
   * @param {() => number} rng
   * @param {LinkConfig} [config]
   */
  constructor(clock, rng, config = {}) {
    this.clock = clock;
    this.rng = rng;
    this.config = {
      latencyMs: 0, jitterMs: 0, loss: 0, duplicate: 0, reorder: 0,
      reorderDelayMs: 20, bandwidthBps: 0, maxQueueMs: 200, ...config,
    };
    this.busyUntil = 0;
    this.lastReliable = 0;
    this.stats = { sent: 0, dropped: 0, duplicated: 0, retransmits: 0 };
  }

  /**
   * Schedule delivery of one message according to the link conditions.
   * Reliable messages are never lost or reordered: a "lost" attempt costs a
   * retransmit delay and every later reliable message waits behind it
   * (head-of-line blocking, as on TCP/WebSocket).
   *
   * @param {import('./types.js').Channel} channel
   * @param {number} size Bytes (for bandwidth accounting).
   * @param {() => void} deliver
   * @returns {boolean} False if the message was dropped.
   */
  transmit(channel, size, deliver) {
    const c = this.config;
    const now = this.clock.now();
    this.stats.sent++;
    let depart = now;
    if (c.bandwidthBps > 0) {
      const start = Math.max(now, this.busyUntil);
      if (channel === CHANNEL.UNRELIABLE && start - now > c.maxQueueMs) {
        this.stats.dropped++;
        return false;
      }
      depart = start + (size * 8000) / c.bandwidthBps;
      this.busyUntil = depart;
    }
    let t = depart + c.latencyMs + (c.jitterMs > 0 ? this.rng() * c.jitterMs : 0);

    if (channel === CHANNEL.RELIABLE) {
      const rto = c.retransmitMs ?? Math.max(2 * c.latencyMs, 100);
      for (let tries = 0; tries < 16 && this.rng() < c.loss; tries++) {
        t += rto;
        this.stats.retransmits++;
      }
      if (t < this.lastReliable) t = this.lastReliable; // in-order: wait for earlier messages
      this.lastReliable = t;
      this.clock.schedule(t - now, deliver);
      return true;
    }

    if (this.rng() < c.loss) {
      this.stats.dropped++;
      return false;
    }
    if (this.rng() < c.reorder) t += c.reorderDelayMs;
    this.clock.schedule(t - now, deliver);
    if (this.rng() < c.duplicate) {
      this.stats.duplicated++;
      this.clock.schedule(t - now + this.rng() * (c.jitterMs + 5), deliver);
    }
    return true;
  }
}
