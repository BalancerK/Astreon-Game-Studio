import { BinaryWriter, BinaryReader, ProtocolError, MissingBaselineError, Snapshot, SnapshotCodec, SnapshotHistory, writeSnapshotHeader, readSnapshotHeader } from '../../protocol/src/index.js';

/**
 * Watching a match: the server keeps the whole world for spectators, a few seconds behind what the players are doing (so nobody can tell a team where the enemy is), and sends it to any
 * number of viewers. All spectators who have the same snapshot as a starting point get **the same bytes**, so the cost of a hundred spectators is a few encodes, not a hundred.
 *
 * Each tick, `push` the full-world snapshot. Each time you send to a spectator, ask for `packet(spectatorId, ackTick)` (the newest tick that spectator says it has) and send the bytes as they are.
 * The packets have the same layout as a player's snapshot packets (`MSG.SNAPSHOT`, input ack 0, the delta), so a spectator's client can read them with the normal client code or `SnapshotReceiver`.
 */
export class SpectatorFeed {
  /**
   * @param {object} o
   * @param {import('../../protocol/src/index.js').NetSchema} o.schema
   * @param {number} o.worldCapacity Most entities in the world.
   * @param {number} [o.delayTicks] How far behind the live game spectators are (default 0; 600 is ten seconds at 60 Hz).
   * @param {number} [o.every] Keep every Nth tick for spectators (1). 3 at 60 Hz sends 20 snapshots a second, a third of the bandwidth, and plays well with interpolation.
   * @param {number} [o.ackLag] How many kept snapshots back a spectator's acknowledgement may be and still get a delta (32); older ones get a full snapshot.
   */
  constructor({ schema, worldCapacity, delayTicks = 0, every = 1, ackLag = 32 }) {
    this.schema = schema; this.delayTicks = delayTicks; this.every = Math.max(1, every);
    this.codec = new SnapshotCodec(schema, worldCapacity);
    this.history = new SnapshotHistory(schema, worldCapacity, Math.ceil(delayTicks / this.every) + ackLag + 2);
    this.writer = new BinaryWriter(8192);
    this.spectators = new Set();
    /** The newest tick pushed. */ this.latestTick = -1;
    this.lastStored = -Infinity;
    this.cache = new Map(); this.cacheTarget = -1;
    this.stats = { pushed: 0, stored: 0, encodes: 0, cacheHits: 0, bytes: 0 };
  }

  /** Give the feed this tick's full-world snapshot (its rows are copied; keep using your own). */
  push(snapshot) {
    this.stats.pushed++;
    if (snapshot.tick <= this.latestTick) throw new Error(`spectator ticks must increase (got ${snapshot.tick} after ${this.latestTick})`);
    this.latestTick = snapshot.tick;
    if (snapshot.tick - this.lastStored < this.every) return;
    const slot = this.history.acquire(), F = this.schema.fieldCount;
    slot.tick = snapshot.tick; slot.count = snapshot.count;
    slot.ids.set(snapshot.ids.subarray(0, snapshot.count)); slot.masks.set(snapshot.masks.subarray(0, snapshot.count)); slot.vals.set(snapshot.vals.subarray(0, snapshot.count * F));
    this.history.commit(slot);
    this.lastStored = snapshot.tick; this.stats.stored++;
  }

  /** Someone starts watching. */
  add(id) { this.spectators.add(id); }
  /** Someone stops. */
  remove(id) { this.spectators.delete(id); }
  get size() { return this.spectators.size; }

  /** The tick spectators are being shown: the newest kept snapshot at least `delayTicks` old, or -1 if there is none yet. */
  get targetTick() {
    const want = this.latestTick - this.delayTicks;
    let best = -1;
    for (let t = Math.floor(want); t >= want - this.every - 1 && best < 0; t--) if (this.history.get(t)) best = t;
    if (best >= 0) return best;
    const { before } = this.history.around(want);
    return before ? before.tick : -1;
  }

  /**
   * What to send a spectator now. `ackTick` is the newest tick they have confirmed (-1 for none: they get a full snapshot). Returns null if there is nothing new for them (or nothing to show
   * yet). The returned bytes are shared with other spectators: send them, do not change them.
   * @param {any} id @param {number} [ackTick] @returns {Uint8Array | null}
   */
  packet(id, ackTick = -1) {
    const target = this.targetTick;
    if (target < 0 || ackTick === target) return null;
    const snap = this.history.get(target);
    if (!snap) return null;
    let base = ackTick >= 0 ? this.history.get(ackTick) : undefined;
    if (base && base.tick >= target) base = undefined;
    if (target !== this.cacheTarget) { this.cache.clear(); this.cacheTarget = target; }
    const key = base ? base.tick : -1;
    let bytes = this.cache.get(key);
    if (bytes) { this.stats.cacheHits++; return bytes; }
    this.writer.reset();
    writeSnapshotHeader(this.writer, 0);
    this.codec.encode(this.writer, snap, base ?? null);
    bytes = this.writer.finish().slice();
    this.cache.set(key, bytes);
    this.stats.encodes++; this.stats.bytes += bytes.length;
    return bytes;
  }
}

/**
 * The other end: turns the snapshot packets of a live game (a player's or a spectator's) into snapshots, keeps the ones needed to read the next delta, and says which tick to acknowledge.
 * A delta whose starting point is missing is not an error: it sets `needsFull`, and acknowledging -1 gets a full snapshot next.
 */
export class SnapshotReceiver {
  /** @param {object} o @param {import('../../protocol/src/index.js').NetSchema} o.schema @param {number} o.capacity @param {number} [o.historySize] */
  constructor({ schema, capacity, historySize = 32 }) {
    this.history = new SnapshotHistory(schema, capacity, historySize);
    this.codec = new SnapshotCodec(schema, capacity);
    /** The newest tick received and applied (-1: none). Send this back as the acknowledgement. */
    this.latestTick = -1;
    /** Set when a delta could not be read for want of its starting snapshot; the next acknowledgement should be -1. */
    this.needsFull = false;
    /** The input acknowledgement carried by the last packet (0 for a spectator). */
    this.inputAck = 0;
    this.stats = { snapshots: 0, full: 0, stale: 0, missing: 0, bad: 0 };
  }

  /** What to put in the acknowledgement: the newest tick, or -1 if a full snapshot is needed. */
  get ackTick() { return this.needsFull ? -1 : this.latestTick; }

  /**
   * Read one packet.
   * @param {Uint8Array | BinaryReader} packet A snapshot packet (with its message header). @param {{header?: boolean}} [o] `header: false` for a bare snapshot payload (as in a replay file).
   * @returns {Snapshot | null} the new snapshot (valid until it is evicted from `history`), or null for a stale, duplicate or unreadable packet
   */
  receive(packet, { header = true } = {}) {
    const r = packet instanceof BinaryReader ? packet : new BinaryReader(packet);
    const slot = this.history.acquire();
    try {
      if (header) this.inputAck = readSnapshotHeader(r);
      this.codec.decode(r, (t) => this.history.get(t), slot);
    } catch (e) {
      if (e instanceof MissingBaselineError) { this.needsFull = true; this.stats.missing++; return null; }
      if (e instanceof ProtocolError) { this.stats.bad++; return null; }
      throw e;
    }
    if (slot.tick <= this.latestTick) { this.stats.stale++; return null; }      // late, or a repeat
    this.history.commit(slot);
    this.latestTick = slot.tick; this.needsFull = false; this.stats.snapshots++;
    return slot;
  }
}
