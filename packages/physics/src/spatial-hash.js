import { sweepAabbVsAabb } from './sweep.js';

/**
 * Uniform-grid broad phase over typed arrays. Rebuilt every tick (counting
 * sort, no per-tick allocation): `clear()`, `insert()` each box, `build()`.
 * Boxes are centre + half extents. Items are identified by a caller-chosen
 * integer `index < capacity` (use the entity slot index).
 *
 * World bounds must contain all motion: items outside collapse into edge
 * cells, and sweeps stop at the grid edge.
 */
export class SpatialHash {
  /**
   * @param {object} o
   * @param {number} o.width World width
   * @param {number} o.height World height
   * @param {number} o.cellSize Pick ~2x the typical box size.
   * @param {number} o.capacity Max item index + 1.
   * @param {number} [o.originX]
   * @param {number} [o.originY]
   */
  constructor({ width, height, cellSize, capacity, originX = 0, originY = 0 }) {
    this.cellSize = cellSize;
    this.originX = originX;
    this.originY = originY;
    this.cols = Math.max(1, Math.ceil(width / cellSize));
    this.rows = Math.max(1, Math.ceil(height / cellSize));
    const cells = this.cols * this.rows;
    this.cellStart = new Int32Array(cells + 1);
    this.cursor = new Int32Array(cells);
    this.cellItems = new Int32Array(capacity * 2);
    this.cx = new Float64Array(capacity);
    this.cy = new Float64Array(capacity);
    this.hw = new Float64Array(capacity);
    this.hh = new Float64Array(capacity);
    this.group = new Uint32Array(capacity);
    this.ids = new Int32Array(capacity);
    this.stamp = new Uint32Array(capacity);
    this.stampId = 0;
    this.count = 0;
    this.tmp = { t: 0, nx: 0, ny: 0, index: -1 };
  }

  clear() { this.count = 0; }

  /**
   * @param {number} index
   * @param {number} cx Centre x
   * @param {number} cy
   * @param {number} hw Half width
   * @param {number} hh
   * @param {number} [group] Bit mask this item belongs to (default 1).
   */
  insert(index, cx, cy, hw, hh, group = 1) {
    this.cx[index] = cx; this.cy[index] = cy;
    this.hw[index] = hw; this.hh[index] = hh;
    this.group[index] = group;
    this.ids[this.count++] = index;
  }

  #cellX(x) {
    const c = Math.floor((x - this.originX) / this.cellSize);
    return c < 0 ? 0 : c >= this.cols ? this.cols - 1 : c;
  }

  #cellY(y) {
    const c = Math.floor((y - this.originY) / this.cellSize);
    return c < 0 ? 0 : c >= this.rows ? this.rows - 1 : c;
  }

  /** Index all inserted boxes. Call after the last `insert`. */
  build() {
    const { cellStart, cursor, cols, ids, count } = this;
    cellStart.fill(0);
    for (let k = 0; k < count; k++) {
      const i = ids[k];
      const x0 = this.#cellX(this.cx[i] - this.hw[i]), x1 = this.#cellX(this.cx[i] + this.hw[i]);
      const y0 = this.#cellY(this.cy[i] - this.hh[i]), y1 = this.#cellY(this.cy[i] + this.hh[i]);
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) cellStart[y * cols + x + 1]++;
    }
    for (let c = 0; c < cursor.length; c++) cellStart[c + 1] += cellStart[c];
    const total = cellStart[cursor.length];
    if (total > this.cellItems.length) this.cellItems = new Int32Array(total * 2);
    cursor.set(cellStart.subarray(0, cursor.length));
    const items = this.cellItems;
    for (let k = 0; k < count; k++) {
      const i = ids[k];
      const x0 = this.#cellX(this.cx[i] - this.hw[i]), x1 = this.#cellX(this.cx[i] + this.hw[i]);
      const y0 = this.#cellY(this.cy[i] - this.hh[i]), y1 = this.#cellY(this.cy[i] + this.hh[i]);
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) items[cursor[y * cols + x]++] = i;
    }
  }

  #nextStamp() {
    if (++this.stampId === 0xffffffff) { this.stamp.fill(0); this.stampId = 1; }
    return this.stampId;
  }

  /**
   * Items whose box overlaps the rectangle, deduplicated.
   * @param {number} minX
   * @param {number} minY
   * @param {number} maxX
   * @param {number} maxY
   * @param {Int32Array} out
   * @param {number} [mask] Only items whose group & mask is non-zero.
   * @returns {number} Count written (capped at out.length).
   */
  queryRect(minX, minY, maxX, maxY, out, mask = 0xffffffff) {
    const id = this.#nextStamp();
    const x0 = this.#cellX(minX), x1 = this.#cellX(maxX);
    const y0 = this.#cellY(minY), y1 = this.#cellY(maxY);
    let n = 0;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const c = y * this.cols + x;
        for (let k = this.cellStart[c], e = this.cellStart[c + 1]; k < e; k++) {
          const i = this.cellItems[k];
          if (this.stamp[i] === id) continue;
          this.stamp[i] = id;
          if ((this.group[i] & mask) === 0) continue;
          if (this.cx[i] + this.hw[i] < minX || this.cx[i] - this.hw[i] > maxX) continue;
          if (this.cy[i] + this.hh[i] < minY || this.cy[i] - this.hh[i] > maxY) continue;
          if (n < out.length) out[n++] = i;
        }
      }
    }
    return n;
  }

  /**
   * Sweep a moving box through the grid (Amanatides-Woo cell walk along its
   * centre path, checking a ring of neighbour cells to cover its extents) and
   * find the earliest contact. Zero extents give a ray (hitscan).
   *
   * @param {number} cx Mover centre
   * @param {number} cy
   * @param {number} hw Mover half extents
   * @param {number} hh
   * @param {number} dx Motion over the whole step
   * @param {number} dy
   * @param {number} mask Collide only with items whose group & mask is non-zero.
   * @param {number} ignore Item index to skip (the mover itself), or -1.
   * @param {import('./sweep.js').Hit} hit Written when true is returned.
   * @returns {boolean}
   */
  sweep(cx, cy, hw, hh, dx, dy, mask, ignore, hit) {
    const { cellSize: cs, cols, rows, cellStart, cellItems, group } = this;
    const id = this.#nextStamp();
    const ring = Math.ceil(Math.max(hw, hh) / cs);
    const len = Math.sqrt(dx * dx + dy * dy); // sqrt is exactly specified; hypot is not
    const margin = len > 0 ? ((ring + 1) * cs) / len : 0;
    let gx = this.#cellX(cx), gy = this.#cellY(cy);
    const stepX = dx > 0 ? 1 : -1, stepY = dy > 0 ? 1 : -1;
    const tDeltaX = dx !== 0 ? cs / Math.abs(dx) : Infinity;
    const tDeltaY = dy !== 0 ? cs / Math.abs(dy) : Infinity;
    let tMaxX = dx !== 0 ? (this.originX + (gx + (dx > 0 ? 1 : 0)) * cs - cx) / dx : Infinity;
    let tMaxY = dy !== 0 ? (this.originY + (gy + (dy > 0 ? 1 : 0)) * cs - cy) / dy : Infinity;
    const tmp = this.tmp;
    let best = Infinity;

    for (;;) {
      const yA = gy - ring < 0 ? 0 : gy - ring, yB = gy + ring >= rows ? rows - 1 : gy + ring;
      const xA = gx - ring < 0 ? 0 : gx - ring, xB = gx + ring >= cols ? cols - 1 : gx + ring;
      for (let y = yA; y <= yB; y++) {
        for (let x = xA; x <= xB; x++) {
          const c = y * cols + x;
          for (let k = cellStart[c], e = cellStart[c + 1]; k < e; k++) {
            const i = cellItems[k];
            if (this.stamp[i] === id) continue;
            this.stamp[i] = id;
            if (i === ignore || (group[i] & mask) === 0) continue;
            if (sweepAabbVsAabb(cx, cy, hw, hh, dx, dy, this.cx[i], this.cy[i], this.hw[i], this.hh[i], tmp) && tmp.t < best) {
              best = tmp.t;
              hit.t = tmp.t; hit.nx = tmp.nx; hit.ny = tmp.ny; hit.index = i;
            }
          }
        }
      }
      const next = tMaxX < tMaxY ? tMaxX : tMaxY;
      if (next > 1 || (best !== Infinity && next - margin > best)) break;
      if (tMaxX < tMaxY) { gx += stepX; tMaxX += tDeltaX; if (gx < 0 || gx >= cols) break; }
      else { gy += stepY; tMaxY += tDeltaY; if (gy < 0 || gy >= rows) break; }
    }
    return best !== Infinity;
  }
}
