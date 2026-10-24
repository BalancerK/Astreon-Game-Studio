/**
 * @typedef {Object} PacketEntry
 * @property {number} time Milliseconds on the caller's clock.
 * @property {'in' | 'out'} dir
 * @property {number} channel 0 reliable, 1 unreliable
 * @property {number} size Payload bytes.
 * @property {string} type Message type name, e.g. SNAPSHOT.
 * @property {string} summary
 */

/** Ring buffer of recent packets plus running totals per direction and type. Can be paused to read a moment closely. */
export class PacketLog {
  /** @param {number} [capacity] */
  constructor(capacity = 200) {
    this.capacity = capacity;
    /** @type {PacketEntry[]} */
    this.ring = [];
    this.next = 0;
    this.paused = false;
    /** @type {Map<string, {count: number, bytes: number}>} keys like `in:SNAPSHOT` */
    this.totals = new Map();
  }

  /** @param {PacketEntry} e Totals always update; the visible list stops while paused. */
  add(e) {
    const key = `${e.dir}:${e.type}`;
    const t = this.totals.get(key) ?? { count: 0, bytes: 0 };
    t.count++;
    t.bytes += e.size;
    this.totals.set(key, t);
    if (this.paused) return;
    if (this.ring.length < this.capacity) this.ring.push(e);
    else { this.ring[this.next] = e; this.next = (this.next + 1) % this.capacity; }
  }

  /** @param {number} [limit] @returns {PacketEntry[]} Newest first. */
  entries(limit = this.capacity) {
    const n = this.ring.length;
    const out = [];
    for (let i = 0; i < Math.min(limit, n); i++) out.push(this.ring[(this.next + n - 1 - i) % n]);
    return out;
  }

  /** @returns {{count: number, bytes: number}} Totals for one direction. */
  total(dir) {
    let count = 0, bytes = 0;
    for (const [k, v] of this.totals) if (k.startsWith(`${dir}:`)) { count += v.count; bytes += v.bytes; }
    return { count, bytes };
  }

  clear() { this.ring = []; this.next = 0; this.totals.clear(); }
}
