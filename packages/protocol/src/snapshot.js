import { ProtocolError } from './binary.js';

const INDEX_BITS = 20;
const INDEX_MASK = (1 << INDEX_BITS) - 1;
const KIND_FULL = 0;
const KIND_DELTA = 1;

/** The decoder needs a baseline snapshot it does not have; ask the server for a full one. */
export class MissingBaselineError extends ProtocolError {
  /** @param {number} baselineTick */
  constructor(baselineTick) {
    super(`missing baseline snapshot for tick ${baselineTick}`);
    this.name = 'MissingBaselineError';
    this.baselineTick = baselineTick;
  }
}

/**
 * Replicated world state at one tick, in quantized "stored" form, rows sorted
 * by entity slot index. Row r has id `ids[r]`, component presence bits
 * `masks[r]`, and `schema.fieldCount` values starting at `r * fieldCount`.
 */
export class Snapshot {
  /**
   * @param {import('./schema.js').NetSchema} schema
   * @param {number} capacity Max entities.
   */
  constructor(schema, capacity) {
    this.schema = schema;
    this.capacity = capacity;
    this.tick = 0;
    this.count = 0;
    this.ids = new Uint32Array(capacity);
    this.masks = new Uint32Array(capacity);
    this.vals = new Float64Array(capacity * schema.fieldCount);
  }

  clear() { this.count = 0; }

  /**
   * Capture entities from a core World. `ids` must be live entity ids in
   * ascending slot-index order (e.g. from `world.query`, or interest management).
   *
   * @param {{stores: Map<any, {data: Record<string, any>, present: Uint8Array}>}} world
   * @param {number} tick
   * @param {Uint32Array} ids
   * @param {number} n Number of ids to use.
   */
  capture(world, tick, ids, n) {
    if (n > this.capacity) throw new RangeError('snapshot capacity exceeded');
    const { comps, fieldCount: F } = this.schema;
    const stores = comps.map((c) => {
      const s = world.stores.get(c.component);
      if (!s) throw new Error(`component "${c.component.name}" is not registered in the world`);
      return s;
    });
    this.tick = tick;
    this.count = n;
    let prev = -1;
    for (let r = 0; r < n; r++) {
      const id = ids[r];
      const idx = id & INDEX_MASK;
      if (idx <= prev) throw new Error('capture ids must be in strictly ascending slot-index order');
      prev = idx;
      this.ids[r] = id;
      let mask = 0;
      const base = r * F;
      for (let c = 0; c < comps.length; c++) {
        const comp = comps[c];
        if (stores[c].present[idx] === 1) {
          mask |= 1 << comp.bit;
          for (const f of comp.fields) this.vals[base + f.col] = f.codec.quantize(stores[c].data[f.name][idx]);
        } else {
          for (const f of comp.fields) this.vals[base + f.col] = 0;
        }
      }
      this.masks[r] = mask >>> 0;
    }
  }

  /** @returns {number} Row of the entity with this exact id, or -1. */
  rowOf(id) {
    let lo = 0, hi = this.count - 1;
    const idx = id & INDEX_MASK;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const midIdx = this.ids[mid] & INDEX_MASK;
      if (midIdx === idx) return this.ids[mid] === id ? mid : -1;
      if (midIdx < idx) lo = mid + 1; else hi = mid - 1;
    }
    return -1;
  }

  /** Natural (dequantized) value of one field. */
  get(row, compBit, fieldName) {
    const comp = this.schema.comps[compBit];
    const f = comp.fields.find((x) => x.name === fieldName);
    return f.codec.dequantize(this.vals[row * this.schema.fieldCount + f.col]);
  }
}

/**
 * Read just the header of a snapshot payload (what `SnapshotCodec.encode` writes first), without
 * decoding entities. For debugging tools and packet inspectors.
 * @param {import('./binary.js').BinaryReader} r Positioned at the snapshot kind byte.
 * @returns {{kind: 'full' | 'delta', tick: number, baselineTick: number | null, removed: number, changed: number}}
 */
export function peekSnapshotHeader(r) {
  const kind = r.u8();
  if (kind !== KIND_FULL && kind !== KIND_DELTA) throw new ProtocolError(`bad snapshot kind ${kind}`);
  const tick = r.varuint();
  let baselineTick = null, removed = 0;
  if (kind === KIND_DELTA) {
    baselineTick = r.varuint();
    removed = r.varuint();
    for (let i = 0; i < removed; i++) { r.varuint(); r.varuint(); }
  }
  return { kind: kind === KIND_FULL ? 'full' : 'delta', tick, baselineTick, removed, changed: r.varuint() };
}

/**
 * Encodes/decodes snapshots as full state or as a delta against an acked
 * baseline. Holds scratch buffers, so create one per schema and reuse it.
 *
 * Delta layout (after a kind byte and tick): baseline tick, removed ids,
 * then only entities that changed: slot-index gap, generation, presence mask,
 * and per present component either all fields (new) or a changed-field mask
 * followed by just those fields.
 */
export class SnapshotCodec {
  /**
   * @param {import('./schema.js').NetSchema} schema
   * @param {number} capacity Max entities per snapshot (also the decode limit).
   */
  constructor(schema, capacity) {
    this.schema = schema;
    this.capacity = capacity;
    this.removed = new Uint32Array(capacity);
    this.changedRows = new Int32Array(capacity);
    this.baseRows = new Int32Array(capacity);
  }

  /**
   * @param {import('./binary.js').BinaryWriter} w
   * @param {Snapshot} cur
   * @param {Snapshot | null} baseline Must be an acked snapshot the receiver still holds; null = full.
   */
  encode(w, cur, baseline) {
    const { comps, fieldCount: F } = this.schema;
    let nRemoved = 0, nChanged = 0;
    const B = baseline ? baseline.count : 0;
    let i = 0;
    for (let j = 0; j < cur.count; j++) {
      const idxJ = cur.ids[j] & INDEX_MASK;
      while (i < B && (baseline.ids[i] & INDEX_MASK) < idxJ) this.removed[nRemoved++] = baseline.ids[i++];
      let b = -1;
      if (i < B && (baseline.ids[i] & INDEX_MASK) === idxJ) {
        if (baseline.ids[i] === cur.ids[j]) b = i; else this.removed[nRemoved++] = baseline.ids[i];
        i++;
      }
      if (b < 0 || this.#differs(cur, j, baseline, b, F)) {
        this.changedRows[nChanged] = j;
        this.baseRows[nChanged++] = b;
      }
    }
    while (i < B) this.removed[nRemoved++] = baseline.ids[i++];

    // When most entities changed, a delta costs more than a full snapshot
    // (per-entity overhead) and still depends on the baseline: send full.
    if (baseline && cur.count > 0 && nChanged * 4 >= cur.count * 3) {
      baseline = null;
      nRemoved = 0;
      nChanged = cur.count;
      for (let k = 0; k < nChanged; k++) { this.changedRows[k] = k; this.baseRows[k] = -1; }
    }

    w.u8(baseline ? KIND_DELTA : KIND_FULL);
    w.varuint(cur.tick);
    if (baseline) {
      w.varuint(baseline.tick);
      w.varuint(nRemoved);
      let prev = 0;
      for (let k = 0; k < nRemoved; k++) {
        const id = this.removed[k], idx = id & INDEX_MASK;
        w.varuint(idx - prev); w.varuint(id >>> INDEX_BITS);
        prev = idx;
      }
    }
    w.varuint(nChanged);
    let prev = 0;
    for (let k = 0; k < nChanged; k++) {
      const j = this.changedRows[k], b = this.baseRows[k];
      const id = cur.ids[j], idx = id & INDEX_MASK, mask = cur.masks[j];
      w.varuint(idx - prev); w.varuint(id >>> INDEX_BITS);
      prev = idx;
      w.varuint(mask);
      for (let c = 0; c < comps.length; c++) {
        const comp = comps[c];
        if (((mask >>> comp.bit) & 1) === 0) continue;
        if (b < 0 || ((baseline.masks[b] >>> comp.bit) & 1) === 0) {
          for (const f of comp.fields) f.codec.write(w, cur.vals[j * F + f.col]);
        } else {
          let fm = 0;
          for (let x = 0; x < comp.fields.length; x++) {
            const col = comp.fields[x].col;
            if (cur.vals[j * F + col] !== baseline.vals[b * F + col]) fm |= 1 << x;
          }
          w.varuint(fm >>> 0);
          for (let x = 0; x < comp.fields.length; x++) {
            if ((fm >>> x) & 1) comp.fields[x].codec.write(w, cur.vals[j * F + comp.fields[x].col]);
          }
        }
      }
    }
  }

  #differs(cur, j, base, b, F) {
    if (cur.masks[j] !== base.masks[b]) return true;
    const a = j * F, c = b * F;
    for (let k = 0; k < F; k++) if (cur.vals[a + k] !== base.vals[c + k]) return true;
    return false;
  }

  /**
   * @param {import('./binary.js').BinaryReader} r
   * @param {(tick: number) => Snapshot | undefined} getBaseline Look up a held snapshot by tick.
   * @param {Snapshot} out Receives the result; must not be a held baseline.
   * @returns {Snapshot} `out`
   * @throws {ProtocolError} Malformed data; {MissingBaselineError} if the baseline is gone.
   */
  decode(r, getBaseline, out) {
    const { comps, fieldCount: F } = this.schema;
    const kind = r.u8();
    if (kind !== KIND_FULL && kind !== KIND_DELTA) throw new ProtocolError(`bad snapshot kind ${kind}`);
    const tick = r.varuint();
    let baseline = null, nRemoved = 0;
    if (kind === KIND_DELTA) {
      const bt = r.varuint();
      baseline = getBaseline(bt);
      if (!baseline) throw new MissingBaselineError(bt);
      nRemoved = r.varuint();
      if (nRemoved > this.capacity) throw new ProtocolError('too many removed entities');
      let prev = 0;
      for (let k = 0; k < nRemoved; k++) {
        const idx = prev + r.varuint(), gen = r.varuint();
        if (idx > INDEX_MASK || gen > 0xfff) throw new ProtocolError('bad entity id');
        this.removed[k] = ((gen << INDEX_BITS) | idx) >>> 0;
        prev = idx;
      }
    }
    const nChanged = r.varuint();
    if (nChanged > this.capacity) throw new ProtocolError('too many entities');

    out.clear();
    out.tick = tick;
    let bi = 0, rk = 0, outRow = 0, prev = 0;
    const B = baseline ? baseline.count : 0;
    const isRemoved = (id) => {
      // `removed` is in ascending slot order, same as baseline rows.
      while (rk < nRemoved && (this.removed[rk] & INDEX_MASK) < (id & INDEX_MASK)) rk++;
      return rk < nRemoved && this.removed[rk] === id;
    };
    const copyBaselineRow = (row) => {
      if (outRow >= this.capacity) throw new ProtocolError('snapshot capacity exceeded');
      out.ids[outRow] = baseline.ids[row];
      out.masks[outRow] = baseline.masks[row];
      out.vals.set(baseline.vals.subarray(row * F, row * F + F), outRow * F);
      outRow++;
    };

    for (let k = 0; k < nChanged; k++) {
      const idx = prev + r.varuint(), gen = r.varuint();
      if (idx > INDEX_MASK || gen > 0xfff || (k > 0 && idx === prev)) throw new ProtocolError('bad entity id');
      prev = idx;
      const id = ((gen << INDEX_BITS) | idx) >>> 0;
      // Emit untouched baseline rows that come before this entity.
      let b = -1;
      while (bi < B && (baseline.ids[bi] & INDEX_MASK) < idx) {
        if (!isRemoved(baseline.ids[bi])) copyBaselineRow(bi);
        bi++;
      }
      if (bi < B && (baseline.ids[bi] & INDEX_MASK) === idx) {
        if (baseline.ids[bi] === id) b = bi;
        else if (!isRemoved(baseline.ids[bi])) throw new ProtocolError('slot reused without removal');
        bi++;
      }
      if (outRow >= this.capacity) throw new ProtocolError('snapshot capacity exceeded');
      const mask = r.varuint();
      if (comps.length < 32 && mask >>> comps.length !== 0) throw new ProtocolError('component mask out of range');
      out.ids[outRow] = id;
      out.masks[outRow] = mask;
      const row = outRow * F;
      if (b >= 0) out.vals.set(baseline.vals.subarray(b * F, b * F + F), row); else out.vals.fill(0, row, row + F);
      for (let c = 0; c < comps.length; c++) {
        const comp = comps[c];
        if (((mask >>> comp.bit) & 1) === 0) {
          for (const f of comp.fields) out.vals[row + f.col] = 0;
          continue;
        }
        if (b < 0 || ((baseline.masks[b] >>> comp.bit) & 1) === 0) {
          for (const f of comp.fields) out.vals[row + f.col] = f.codec.read(r);
        } else {
          const fm = r.varuint();
          if (comp.fields.length < 32 && fm >>> comp.fields.length !== 0) throw new ProtocolError('field mask out of range');
          for (let x = 0; x < comp.fields.length; x++) {
            if ((fm >>> x) & 1) out.vals[row + comp.fields[x].col] = comp.fields[x].codec.read(r);
          }
        }
      }
      outRow++;
    }
    while (bi < B) {
      if (!isRemoved(baseline.ids[bi])) copyBaselineRow(bi);
      bi++;
    }
    out.count = outRow;
    return out;
  }
}
