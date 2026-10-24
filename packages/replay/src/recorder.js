import { BinaryWriter, BinaryReader, ProtocolError, Snapshot, SnapshotCodec, SnapshotHistory } from '../../protocol/src/index.js';

const MAGIC = [0x41, 0x53, 0x52, 0x50];                  // "ASRP"
/** The version of the replay file layout this code writes and reads. */
export const REPLAY_FORMAT_VERSION = 1;
const FRAME_SNAPSHOT = 1, FRAME_EVENT = 2;
const META_LIMIT = 1 << 20;

const copyInto = (to, from) => {
  to.tick = from.tick; to.count = from.count;
  to.ids.set(from.ids.subarray(0, from.count)); to.masks.set(from.masks.subarray(0, from.count));
  const F = from.schema.fieldCount; to.vals.set(from.vals.subarray(0, from.count * F));
  return to;
};

/**
 * Records a match as a stream of snapshots, in the same compact delta form the network uses, so five minutes of a world of forty entities is about 1 to 3 megabytes (a full snapshot every
 * `keyframeEvery` ticks makes it possible to jump to any moment without playing everything before it). Game events (a kill, a chat line, a round start) can be recorded between the frames.
 * It records what the **server sent** to a viewer (or the full world), so it plays back on any machine, even one whose simulation would not reproduce the match; for a deterministic game that
 * wants tiny files, see `InputRecorder`.
 */
export class ReplayRecorder {
  /**
   * @param {object} o
   * @param {import('../../protocol/src/index.js').NetSchema} o.schema The replicated-state schema (its hash is stored: a replay only plays against the same one).
   * @param {number} o.capacity Most entities in one snapshot.
   * @param {number} [o.tickRate] Ticks per second of the game (60); stored, so players know the speed.
   * @param {number} [o.keyframeEvery] Ticks between full snapshots (120).
   * @param {number} [o.every] Record only every Nth tick (1: all). 3 at 60 Hz records 20 frames a second and is smoother than it sounds when played with interpolation.
   * @param {Record<string, any>} [o.meta] Anything JSON-able about the match (map, players, version, date): kept in the file header.
   * @param {(bytes: Uint8Array) => void} [o.onChunk] Called with the header and then each frame as it is recorded, to write a file as you go (a server that may crash). When given, nothing is kept in memory.
   */
  constructor({ schema, capacity, tickRate = 60, keyframeEvery = 120, every = 1, meta = {}, onChunk = null }) {
    if (!(keyframeEvery >= 1) || !(every >= 1)) throw new Error('keyframeEvery and every must be at least 1');
    this.schema = schema; this.capacity = capacity; this.tickRate = tickRate; this.keyframeEvery = keyframeEvery; this.every = every;
    this.codec = new SnapshotCodec(schema, capacity);
    this.writer = new BinaryWriter(4096);
    this.prev = new Snapshot(schema, capacity);
    this.havePrev = false;
    this.sinceKey = 0;
    this.onChunk = onChunk;
    this.chunks = [];
    this.bytes = 0;
    /** What has been recorded so far. */
    this.stats = { frames: 0, keyframes: 0, events: 0, bytes: 0, firstTick: -1, lastTick: -1 };
    const h = new BinaryWriter(256);
    for (const b of MAGIC) h.u8(b);
    h.u8(REPLAY_FORMAT_VERSION); h.u32(schema.hash >>> 0); h.u16(tickRate); h.string(JSON.stringify(meta));
    this.#emit(h.finish().slice());
  }

  #emit(bytes) {
    this.bytes += bytes.length; this.stats.bytes = this.bytes;
    if (this.onChunk) this.onChunk(bytes); else this.chunks.push(bytes);
  }

  #frame(kind, payload) {
    const w = new BinaryWriter(payload.length + 8);
    w.u8(kind); w.varuint(payload.length); w.bytesRaw(payload);
    this.#emit(w.finish().slice());
  }

  /**
   * Record a snapshot (a full-world one, or what one viewer is shown). Ticks must increase. Frames skipped by `every` are ignored.
   * @param {Snapshot} snapshot @returns {boolean} whether it was recorded
   */
  record(snapshot) {
    if (this.havePrev) {
      if (snapshot.tick <= this.prev.tick) throw new Error(`replay ticks must increase (got ${snapshot.tick} after ${this.prev.tick})`);
      if (snapshot.tick - this.stats.lastTick < this.every) return false;
    }
    const key = !this.havePrev || this.sinceKey >= Math.max(1, Math.round(this.keyframeEvery / this.every));
    this.writer.reset();
    this.codec.encode(this.writer, snapshot, key ? null : this.prev);
    const payload = this.writer.finish();
    if (payload[0] === 0) { this.stats.keyframes++; this.sinceKey = 0; } else this.sinceKey++;     // the codec sends a full snapshot itself when most of the world changed
    this.#frame(FRAME_SNAPSHOT, payload);
    copyInto(this.prev, snapshot); this.havePrev = true;
    this.stats.frames++; this.stats.lastTick = snapshot.tick; if (this.stats.firstTick < 0) this.stats.firstTick = snapshot.tick;
    return true;
  }

  /** Record something that happened at `tick`: a kill, a goal, a chat line. `data` must be JSON-able. */
  event(tick, type, data = null) {
    const w = new BinaryWriter(64);
    w.varuint(tick); w.string(type); w.string(JSON.stringify(data));
    this.#frame(FRAME_EVENT, w.finish());
    this.stats.events++;
  }

  /** The whole recording as one file (empty after the header if `onChunk` took the frames). @returns {Uint8Array} */
  finish() {
    let n = 0; for (const c of this.chunks) n += c.length;
    const out = new Uint8Array(n); let o = 0;
    for (const c of this.chunks) { out.set(c, o); o += c.length; }
    return out;
  }
}

/**
 * Plays a replay back. Give it the bytes (a file, or what `ReplayRecorder.finish()` returned) and the schema it was recorded with; call `update(dt)` each frame, and draw `history`
 * (the same `SnapshotHistory` a live client draws from, so interpolation code is shared: `history.around(player.tickAt)`). Seek anywhere, change speed, pause, loop.
 * A recording cut short by a crash plays up to where it stopped (`truncated` is true).
 */
export class ReplayPlayer {
  /**
   * @param {Uint8Array} bytes @param {object} o
   * @param {import('../../protocol/src/index.js').NetSchema} o.schema @param {number} o.capacity Same as when recording (at least).
   * @param {(snapshot: Snapshot, index: number) => void} [o.onSnapshot] Called for each frame played, in order (and for the frame landed on by a seek).
   * @param {(event: {tick: number, type: string, data: any}) => void} [o.onEvent] Called for each event as the playhead passes it (not during a seek).
   * @throws {ProtocolError} Not a replay, a newer format, or recorded with a different schema.
   */
  constructor(bytes, { schema, capacity, onSnapshot = null, onEvent = null }) {
    this.schema = schema; this.capacity = capacity; this.onSnapshot = onSnapshot; this.onEvent = onEvent;
    this.bytes = bytes;
    const r = new BinaryReader(bytes);
    for (const b of MAGIC) if (r.u8() !== b) throw new ProtocolError('not a replay file');
    const version = r.u8();
    if (version > REPLAY_FORMAT_VERSION) throw new ProtocolError(`this replay uses file format ${version}; this engine reads up to ${REPLAY_FORMAT_VERSION}`);
    const hash = r.u32(), tickRate = r.u16();
    let meta; try { meta = JSON.parse(r.string(META_LIMIT)); } catch { throw new ProtocolError('the replay header is damaged'); }
    if (hash !== (schema.hash >>> 0)) throw new ProtocolError('this replay was recorded with a different replicated-state schema');
    /** `{version, tickRate, meta}` from the file header. */
    this.header = { version, tickRate, meta };
    this.tickRate = tickRate; this.meta = meta;
    /** Every snapshot frame: `{tick, offset, length, key}` (`key`: a full snapshot, a place a seek can start). */
    this.frames = [];
    /** Every event, in order: `{tick, type, data}`. */
    this.events = [];
    this.truncated = false;
    while (r.remaining > 0) {
      try {
        const kind = r.u8(), len = r.varuint(), start = r.pos;
        if (len > r.remaining) { this.truncated = true; break; }
        if (kind === FRAME_SNAPSHOT) {
          const head = new BinaryReader(bytes.subarray(start, start + len)), k = head.u8(), tick = head.varuint();
          this.frames.push({ tick, offset: start, length: len, key: k === 0 });
        } else if (kind === FRAME_EVENT) {
          const e = new BinaryReader(bytes.subarray(start, start + len));
          const tick = e.varuint(), type = e.string(256);
          this.events.push({ tick, type, data: JSON.parse(e.string(META_LIMIT)) });
        }
        r.pos = start + len;
      } catch { this.truncated = true; break; }
    }
    this.codec = new SnapshotCodec(schema, capacity);
    /** The snapshots decoded around the playhead: the current frame and the next, for interpolation. */
    this.history = new SnapshotHistory(schema, capacity, 5);
    /** @type {Snapshot | null} */ this.current = null;
    this.index = -1; this.decoded = -1;
    /** Seconds played from the first frame. */
    this.time = 0;
    this.speed = 1; this.playing = true; this.loop = false;
    this.lastEventTick = this.frames.length ? this.frames[0].tick - 1 : -1;
    if (this.frames.length && !this.frames[0].key) throw new ProtocolError('the replay does not begin with a full snapshot');
    if (this.frames.length) this.#decodeTo(0);
  }

  get frameCount() { return this.frames.length; }
  get firstTick() { return this.frames.length ? this.frames[0].tick : 0; }
  get lastTick() { return this.frames.length ? this.frames[this.frames.length - 1].tick : 0; }
  /** Length in seconds. */
  get duration() { return (this.lastTick - this.firstTick) / this.tickRate; }
  /** The playhead as a (fractional) game tick, for `history.around(tickAt)`. */
  get tickAt() { return this.firstTick + this.time * this.tickRate; }
  /** Whether the playhead is at the end. */
  get finished() { return this.time >= this.duration; }

  #decode(i) {
    const f = this.frames[i], slot = this.history.acquire();
    this.codec.decode(new BinaryReader(this.bytes.subarray(f.offset, f.offset + f.length)), (t) => this.history.get(t), slot);
    this.history.commit(slot);
    return slot;
  }

  /**
   * Make frame i the current one. The frame after it is decoded too and kept in `history` (so a renderer can interpolate toward it). Playing along decodes one frame at a time; a jump
   * (or a step back) starts again from the last full snapshot at or before the target.
   */
  #decodeTo(i) {
    const last = this.frames.length - 1, want = Math.min(i + 1, last), before = this.index;
    if (!(i === this.index && this.decoded >= want)) {
      const reuse = this.decoded >= 0 && i >= this.decoded - 2 && want <= this.decoded && i >= 0;             // both frames are still in the ring of decoded frames
      if (!reuse) {
        let from = this.decoded + 1;
        if (this.decoded < 0 || want < this.decoded || this.#keyBetween(this.decoded, want)) { from = i; while (from > 0 && !this.frames[from].key) from--; }
        for (let k = from; k <= want; k++) this.#decode(k);
        this.decoded = want;
      }
    }
    this.current = this.history.get(this.frames[i].tick);
    this.index = i;
    if (this.onSnapshot) {                                                  // playing along tells of every frame passed (those still held); a jump, of where it landed
      const first = i - before <= 3 && before >= 0 && i > before ? before + 1 : i;
      for (let k = first; k <= i; k++) { const s = this.history.get(this.frames[k].tick); if (s) this.onSnapshot(s, k); }
    }
  }
  #keyBetween(a, b) { for (let k = b; k > a; k--) if (this.frames[k].key) return true; return false; }

  /** The index of the last frame at or before a tick (0 before the first). */
  frameAt(tick) {
    let lo = 0, hi = this.frames.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (this.frames[mid].tick <= tick) lo = mid; else hi = mid - 1; }
    return lo;
  }

  /** Jump to a game tick (clamped to the recording). The frame at or before it becomes `current`. */
  seekTick(tick) {
    if (!this.frames.length) return this;
    const t = Math.max(this.firstTick, Math.min(this.lastTick, tick));
    this.#decodeTo(this.frameAt(t));
    this.time = (t - this.firstTick) / this.tickRate;
    this.lastEventTick = t;
    return this;
  }
  /** Jump to a time in seconds from the start. */
  seek(seconds) { return this.seekTick(this.firstTick + seconds * this.tickRate); }

  /**
   * Advance by `dt` real seconds (times `speed`, unless paused): decodes the frames passed, calls `onSnapshot` for each and `onEvent` for each event passed. At the end it stops, or starts again with `loop`.
   * @returns {number} how many frames were played
   */
  update(dt) {
    if (!this.frames.length || !this.playing) return 0;
    const before = this.index;
    let t = this.time + dt * this.speed;
    const end = this.duration;
    if (t >= end) { if (this.loop && end > 0) { this.#fireEvents(this.lastTick); this.seekTick(this.firstTick); this.lastEventTick = this.firstTick - 1; t = t % end; } else { t = end; } }
    this.time = Math.max(0, t);
    const tick = this.firstTick + this.time * this.tickRate;
    this.#decodeTo(this.frameAt(tick));
    this.#fireEvents(tick);
    return this.index >= before ? this.index - before : this.index + 1;      // (after a loop: the frames since the start)
  }

  #fireEvents(tick) {
    if (!this.onEvent) { this.lastEventTick = tick; return; }
    for (const e of this.events) if (e.tick > this.lastEventTick && e.tick <= tick) this.onEvent(e);
    this.lastEventTick = tick;
  }

  /** The events with `from < tick <= to`. */
  eventsBetween(from, to) { return this.events.filter((e) => e.tick > from && e.tick <= to); }
}
