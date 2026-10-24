import { SpatialHash } from '../../physics/src/index.js';

const INDEX_BITS = 20;
const INDEX_MASK = (1 << INDEX_BITS) - 1;

/**
 * Interest management: which entities does a given client need to know about? A uniform grid over entity
 * positions, rebuilt once per tick, answers "everything within R of this point" cheaply, so the cost of
 * serving a client depends on how much is near it, not on how big the world is.
 *
 * Hysteresis stops flicker at the boundary: an entity becomes visible inside `enterRadius` but only
 * stops being visible outside `leaveRadius` (> enter).
 */
export class InterestGrid {
  /**
   * @param {object} o
   * @param {number} o.width World width
   * @param {number} o.height
   * @param {number} o.capacity Max entity slot index + 1.
   * @param {number} [o.cellSize] Roughly the view radius works well.
   */
  constructor({ width, height, capacity, cellSize = 256 }) {
    this.hash = new SpatialHash({ width, height, cellSize, capacity });
    this.found = new Int32Array(capacity);
    this.candSlot = new Int32Array(capacity);
    this.candDist = new Float64Array(capacity);
    this.order = new Int32Array(capacity);
    this.xs = null;
    this.ys = null;
  }

  /**
   * Index this tick's positions. Call once per tick before any `query`.
   * @param {Uint32Array} ids Live entity ids (any order).
   * @param {number} n
   * @param {Float32Array | Float64Array} xs Position by slot index
   * @param {Float32Array | Float64Array} ys
   */
  rebuild(ids, n, xs, ys) {
    this.xs = xs;
    this.ys = ys;
    const h = this.hash;
    h.clear();
    for (let k = 0; k < n; k++) {
      const slot = ids[k] & INDEX_MASK;
      h.insert(slot, xs[slot], ys[slot], 0.5, 0.5);
    }
    h.build();
  }

  /**
   * Entities this client should see, as ids sorted by slot index.
   *
   * @param {object} q
   * @param {number} q.cx Centre (usually the client's own entity)
   * @param {number} q.cy
   * @param {number} q.enterRadius
   * @param {number} q.leaveRadius >= enterRadius
   * @param {Uint32Array} q.prevMark Per-client: id + 1 at each slot visible last tick (0 = not visible)
   * @param {Uint16Array | Uint8Array | Int32Array | Uint32Array} q.generations Entity generations by slot
   * @param {number} q.maxVisible Hard cap; the nearest entities win.
   * @param {Uint32Array} q.outIds Receives the ids
   * @returns {number} Count written
   */
  query({ cx, cy, enterRadius, leaveRadius, prevMark, generations, maxVisible, outIds }) {
    const { xs, ys, found, candSlot, candDist } = this;
    const n = this.hash.queryRect(cx - leaveRadius, cy - leaveRadius, cx + leaveRadius, cy + leaveRadius, found);
    const enter2 = enterRadius * enterRadius, leave2 = leaveRadius * leaveRadius;
    let m = 0;
    for (let k = 0; k < n; k++) {
      const slot = found[k];
      const dx = xs[slot] - cx, dy = ys[slot] - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 <= enter2 || (d2 <= leave2 && prevMark[slot] === (((generations[slot] << INDEX_BITS) | slot) >>> 0) + 1)) {
        candSlot[m] = slot;
        candDist[m] = d2;
        m++;
      }
    }
    let keep = candSlot.subarray(0, m);
    if (m > maxVisible) {
      const order = this.order.subarray(0, m);
      for (let i = 0; i < m; i++) order[i] = i;
      order.sort((a, b) => candDist[a] - candDist[b]);
      const nearest = new Int32Array(maxVisible); // rare path (crowded area)
      for (let i = 0; i < maxVisible; i++) nearest[i] = candSlot[order[i]];
      keep = nearest;
      m = maxVisible;
    }
    keep.sort(); // typed arrays sort numerically: ascending slot index, as snapshots require
    for (let i = 0; i < m; i++) outIds[i] = ((generations[keep[i]] << INDEX_BITS) | keep[i]) >>> 0;
    return m;
  }
}
