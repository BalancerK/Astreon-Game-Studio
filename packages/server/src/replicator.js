import { Snapshot, SnapshotCodec, SnapshotHistory } from '../../protocol/src/index.js';

const INDEX_MASK = (1 << 20) - 1;

/**
 * Everything the server remembers and decides for ONE client's replication.
 *
 * A client's "view" is the snapshot it was sent: only the entities it is interested in, and (when a
 * bandwidth budget is set) not all of them freshly updated, because far-away, low-priority entities
 * may carry slightly older values. So deltas are computed against the *views we actually sent* (kept in
 * a per-client history, keyed by tick), not against the world.
 *
 * Per tick: `setVisible` (who), `buildView` (what values, within budget), `encode` (bytes + history).
 *
 * Budget: each unsent entity accumulates priority (faster when near), the highest-priority ones get
 * fresh values, and an AIMD controller adjusts how many per tick so the measured bytes/second tracks
 * the budget. The client's own entity and entities it has never seen are always fresh.
 */
export class ClientReplicator {
  /**
   * @param {object} o
   * @param {import('../../protocol/src/index.js').NetSchema} o.schema
   * @param {number} o.worldCapacity Max entity slots in the world.
   * @param {number} [o.maxVisible] Max entities in one view.
   * @param {number} [o.historySize] Views remembered (ack lag you can serve deltas for).
   * @param {number} [o.bytesPerSecond] Budget; Infinity = unlimited.
   * @param {number} [o.tickRate]
   * @param {number} [o.minUpdates] Never refresh fewer than this many entities per tick (each costs about ackLag x its size, so keep it small).
   * @param {number} [o.priorityRange] Distance (world units) at which update priority has halved.
   * @param {{component: number, x: string, y: string, z?: string}} [o.position] Which replicated fields are the position (for `positionAt`). Add `z` for a 3D game: `positionAt` then reports all three coordinates.
   */
  constructor({ schema, worldCapacity, maxVisible = 384, historySize = 32, bytesPerSecond = Infinity, tickRate = 60, minUpdates = 2, priorityRange = 250, position = { component: 0, x: 'x', y: 'y' } }) {
    this.schema = schema;
    const posComp = schema.comps[position.component];
    this.posBit = posComp.bit;
    this.fx = posComp.fields.find((f) => f.name === position.x);
    this.fy = posComp.fields.find((f) => f.name === position.y);
    this.fz = position.z ? posComp.fields.find((f) => f.name === position.z) : null;
    this.maxVisible = maxVisible;
    this.history = new SnapshotHistory(schema, maxVisible, historySize);
    this.codec = new SnapshotCodec(schema, maxVisible);
    this.budgetPerTick = bytesPerSecond / tickRate;
    this.minUpdates = minUpdates;
    this.priorityRange = priorityRange;
    this.visible = new Uint32Array(maxVisible);
    this.visibleCount = 0;
    this.prevMark = new Uint32Array(worldCapacity); // id + 1 for slots visible last tick
    this.priority = new Float32Array(worldCapacity);
    // scratch for buildView
    this.rowSrc = new Int32Array(maxVisible);
    this.rowLast = new Int32Array(maxVisible);
    this.rowFresh = new Uint8Array(maxVisible);
    this.cand = new Int32Array(maxVisible);
    this.candPrio = new Float32Array(maxVisible);
    this.order = new Int32Array(maxVisible);
    /** Current allowance of fresh (non-mandatory) updates per tick. Infinity until the budget binds. */
    this.allowance = Infinity;
    /** @type {Snapshot | null} */
    this.view = null;
    this.lastCandidates = 0;
    this.stats = { views: 0, bytes: 0, lastBytes: 0, fresh: 0, stale: 0, visible: 0, full: 0 };
  }

  /** Record this tick's visible set (ids sorted by slot index) and remember it for hysteresis. */
  setVisible(ids, count) {
    for (let i = 0; i < this.visibleCount; i++) this.prevMark[this.visible[i] & INDEX_MASK] = 0;
    this.visible.set(ids.subarray(0, count));
    this.visibleCount = count;
    for (let i = 0; i < count; i++) this.prevMark[ids[i] & INDEX_MASK] = ids[i] + 1;
  }

  /**
   * Build this tick's view from the full-world snapshot.
   *
   * @param {Snapshot} src Full-world snapshot of this tick (rows sorted by slot index).
   * @param {number} tick
   * @param {number} selfId The client's own entity id (always fresh), or -1.
   * @param {number} cx Client position, for priority by distance.
   * @param {number} cy
   * @param {Float32Array | Float64Array} xs World positions by slot
   * @param {Float32Array | Float64Array} ys
   * @returns {Snapshot} The view (also stored as `this.view`).
   */
  buildView(src, tick, selfId, cx, cy, xs, ys) {
    const F = this.schema.fieldCount;
    const last = this.history.latest() ?? null;
    const view = this.history.acquire();
    const { visible, visibleCount, rowSrc, rowLast, rowFresh, cand, candPrio, priority } = this;

    // 1. Pair each visible entity with its source row and its row in the last view we sent.
    let m = 0, nMandatory = 0, nCand = 0, sr = 0;
    for (let k = 0; k < visibleCount; k++) {
      const id = visible[k], idx = id & INDEX_MASK;
      while (sr < src.count && (src.ids[sr] & INDEX_MASK) < idx) sr++;
      if (sr >= src.count || src.ids[sr] !== id) continue; // vanished since the query
      const lr = last ? last.rowOf(id) : -1;
      rowSrc[m] = sr;
      rowLast[m] = lr;
      if (lr < 0 || id === selfId) { rowFresh[m] = 1; nMandatory++; } else { rowFresh[m] = 0; cand[nCand] = m; nCand++; }
      m++;
    }

    // 2. Candidates earn priority by being near; the best ones get fresh values this tick.
    for (let c = 0; c < nCand; c++) {
      const r = cand[c];
      const slot = src.ids[rowSrc[r]] & INDEX_MASK;
      const dx = xs[slot] - cx, dy = ys[slot] - cy;
      priority[slot] += 1 / (1 + Math.sqrt(dx * dx + dy * dy) / this.priorityRange);
      candPrio[c] = priority[slot];
    }
    const room = Math.max(this.minUpdates, Math.floor(Math.min(this.allowance, 1e9)));
    let fresh = nCand;
    if (nCand > room) {
      fresh = room;
      const order = this.order.subarray(0, nCand);
      for (let c = 0; c < nCand; c++) order[c] = c;
      order.sort((a, b) => candPrio[b] - candPrio[a]);
      for (let c = fresh; c < nCand; c++) rowFresh[cand[order[c]]] = 0;
      for (let c = 0; c < fresh; c++) rowFresh[cand[order[c]]] = 1;
    } else {
      for (let c = 0; c < nCand; c++) rowFresh[cand[c]] = 1;
    }
    for (let r = 0; r < m; r++) if (rowFresh[r]) priority[src.ids[rowSrc[r]] & INDEX_MASK] = 0;

    // 3. Fresh rows copy the world; stale rows repeat what the client already has.
    let freshCount = 0;
    for (let r = 0; r < m; r++) {
      const from = rowFresh[r] ? src : last;
      const fr = rowFresh[r] ? rowSrc[r] : rowLast[r];
      view.ids[r] = from.ids[fr];
      view.masks[r] = from.masks[fr];
      view.vals.set(from.vals.subarray(fr * F, fr * F + F), r * F);
      freshCount += rowFresh[r];
    }
    view.count = m;
    view.tick = tick;
    this.view = view;
    this.lastCandidates = m;
    this.stats.fresh += freshCount;
    this.stats.stale += m - freshCount;
    this.stats.visible = m;
    return view;
  }

  /**
   * Encode the view as a delta against the view the client acknowledged (or a full snapshot if that is gone
   * or ackTick is 0), remember it, and adapt the update allowance to the budget.
   *
   * @param {import('../../protocol/src/index.js').BinaryWriter} w Positioned after any message header.
   * @param {number} ackTick Newest tick the client confirmed receiving.
   * @param {number} [overhead] Bytes already written for the header (counted against the budget).
   * @returns {number} Payload bytes written
   */
  encode(w, ackTick, overhead = 0) {
    const baseline = ackTick > 0 ? this.history.get(ackTick) : undefined;
    const start = w.pos;
    this.codec.encode(w, this.view, baseline ?? null);
    const bytes = w.pos - start;
    this.history.commit(this.view);

    const total = bytes + overhead;
    const s = this.stats;
    s.views++; s.bytes += total; s.lastBytes = total;
    if (w.bytes[start] === 0) s.full++; // snapshot kind byte: 0 = full
    this.#adapt(total);
    return bytes;
  }

  /**
   * Where this client was *shown* entity `id` at a (fractional) server tick: interpolated between the two
   * views we sent around that tick, exactly as a client renders them. This is the basis for lag
   * compensation: judge a shot against what the shooter actually saw. Returns false if the entity was not
   * in the client's view then, so entities a client could not see cannot be hit.
   *
   * @param {number} tick
   * @param {number} id
   * @param {{x: number, y: number, z?: number}} out `z` is written only when the replicator was given a `position.z`.
   * @param {number} [teleportDistance] Jumps larger than this (respawns) are not interpolated across.
   * @returns {boolean}
   */
  positionAt(tick, id, out, teleportDistance = 300) {
    const { before, after } = this.history.around(tick);
    const to = after ?? before;
    if (!to) return false;
    const from = before && after && before !== after ? before : null;
    const F = this.schema.fieldCount;
    const rt = to.rowOf(id);
    if (rt < 0 || ((to.masks[rt] >>> this.posBit) & 1) === 0) return false;
    let x = this.fx.codec.dequantize(to.vals[rt * F + this.fx.col]);
    let y = this.fy.codec.dequantize(to.vals[rt * F + this.fy.col]);
    let z = this.fz ? this.fz.codec.dequantize(to.vals[rt * F + this.fz.col]) : 0;
    if (from) {
      const rf = from.rowOf(id);
      if (rf >= 0) {
        const x0 = this.fx.codec.dequantize(from.vals[rf * F + this.fx.col]);
        const y0 = this.fy.codec.dequantize(from.vals[rf * F + this.fy.col]);
        const z0 = this.fz ? this.fz.codec.dequantize(from.vals[rf * F + this.fz.col]) : 0;
        if (Math.abs(x - x0) < teleportDistance && Math.abs(y - y0) < teleportDistance && Math.abs(z - z0) < teleportDistance) {
          const t = (tick - from.tick) / (to.tick - from.tick);
          x = x0 + (x - x0) * t;
          y = y0 + (y - y0) * t;
          z = z0 + (z - z0) * t;
        }
      }
    }
    out.x = x;
    out.y = y;
    if (this.fz) out.z = z;
    return true;
  }

  /** AIMD: shrink the allowance quickly when over budget, grow it gently when comfortably under. */
  #adapt(bytes) {
    if (!(this.budgetPerTick < Infinity)) return;
    const base = Math.min(this.allowance, this.lastCandidates);
    if (bytes > this.budgetPerTick * 1.05) this.allowance = Math.max(this.minUpdates, base * 0.9);
    else if (bytes < this.budgetPerTick * 0.85 && this.allowance < this.lastCandidates) this.allowance = Math.min(this.lastCandidates + 1, this.allowance + 1 + this.allowance * 0.03);
    else if (bytes < this.budgetPerTick * 0.85) this.allowance = Infinity;
  }
}
