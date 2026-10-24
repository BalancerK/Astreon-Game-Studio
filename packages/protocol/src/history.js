import { Snapshot } from './snapshot.js';

/**
 * Fixed ring of recent snapshots, looked up by tick. The server keeps one per
 * client (or one shared) to find the acked baseline for deltas; the client
 * keeps one to decode incoming deltas.
 *
 * Usage: `slot = h.acquire()`, fill it (capture/decode), then `h.commit(slot)`.
 * A slot that was acquired but never committed (e.g. decode threw) is never
 * returned by `get`, so a half-written snapshot can't become a baseline.
 * Acquiring evicts the oldest entry, so size the ring larger than the
 * longest ack lag you want to serve deltas for; beyond that, `get` returns
 * undefined and the sender falls back to a full snapshot.
 */
export class SnapshotHistory {
  /**
   * @param {import('./schema.js').NetSchema} schema
   * @param {number} capacity Entities per snapshot.
   * @param {number} [size] Snapshots kept.
   */
  constructor(schema, capacity, size = 32) {
    this.slots = Array.from({ length: size }, () => new Snapshot(schema, capacity));
    this.valid = new Uint8Array(size);
    this.order = new Float64Array(size).fill(-1); // commit order, for eviction
    this.counter = 0;
  }

  /** @returns {Snapshot} The oldest slot, emptied and invalid until committed. */
  acquire() {
    let oldest = 0;
    for (let i = 1; i < this.slots.length; i++) if (this.order[i] < this.order[oldest]) oldest = i;
    this.valid[oldest] = 0;
    this.order[oldest] = -1;
    const s = this.slots[oldest];
    s.clear();
    return s;
  }

  /** @param {Snapshot} slot */
  commit(slot) {
    const i = this.slots.indexOf(slot);
    if (i < 0) throw new Error('slot does not belong to this history');
    this.valid[i] = 1;
    this.order[i] = ++this.counter;
  }

  /** @param {number} tick @returns {Snapshot | undefined} */
  get(tick) {
    for (let i = 0; i < this.slots.length; i++) {
      if (this.valid[i] === 1 && this.slots[i].tick === tick) return this.slots[i];
    }
    return undefined;
  }

  /**
   * Committed snapshots closest to `tick` on each side, for interpolation.
   * `before.tick <= tick <= after.tick` when both exist; either may be undefined.
   * @param {number} tick
   * @returns {{before: Snapshot | undefined, after: Snapshot | undefined}}
   */
  around(tick) {
    let before, after;
    for (let i = 0; i < this.slots.length; i++) {
      if (this.valid[i] !== 1) continue;
      const s = this.slots[i];
      if (s.tick <= tick && (!before || s.tick > before.tick)) before = s;
      if (s.tick >= tick && (!after || s.tick < after.tick)) after = s;
    }
    return { before, after };
  }

  /** @returns {Snapshot | undefined} The most recently committed snapshot. */
  latest() {
    let best = -1;
    for (let i = 0; i < this.slots.length; i++) if (this.valid[i] === 1 && (best < 0 || this.order[i] > this.order[best])) best = i;
    return best < 0 ? undefined : this.slots[best];
  }
}
