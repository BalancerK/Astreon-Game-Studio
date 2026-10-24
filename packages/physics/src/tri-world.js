import { rayTriangle } from './sweep3d.js';

/**
 * Static 3D collision geometry: a triangle soup indexed by a uniform 3D grid (typed arrays, built once). Everything the
 * 3D character controller, hitscan and line-of-sight need: `queryAabb` (candidates for a moving shape) and `raycast`.
 * Boxes, quads and arbitrary indexed meshes (a glTF's positions and indices) all become triangles.
 *
 * Conventions: right-handed, +y up (see @engine/math). Triangles are two-sided, so winding only matters for `normal*`
 * (outward by the right-hand rule: (b - a) x (c - a)).
 *
 * Usage: add geometry, call `build()` once, then query. Adding after `build()` requires another `build()`.
 */
export class TriWorld {
  /**
   * @param {object} [o]
   * @param {number} [o.cellSize] Grid cell edge; about the size of a character is a good start.
   * @param {number} [o.maxCells] Upper bound on grid cells; the cell size grows to respect it (huge flat worlds).
   */
  constructor({ cellSize = 4, maxCells = 1 << 20 } = {}) {
    this.cellSize = cellSize;
    this.maxCells = maxCells;
    /** a, b, c vertices of triangle i at [9i .. 9i+8]. */
    this.verts = new Float64Array(9 * 256);
    this.count = 0;
    this.built = false;
    this.nx = new Float64Array(0); this.ny = new Float64Array(0); this.nz = new Float64Array(0);
    this.cellStart = new Int32Array(1);
    this.cellItems = new Int32Array(0);
    this.cols = 1; this.rows = 1; this.layers = 1;
    this.minX = 0; this.minY = 0; this.minZ = 0; this.maxX = 0; this.maxY = 0; this.maxZ = 0;
    this.stamp = new Uint32Array(0);
    this.stampId = 0;
  }

  get triangleCount() { return this.count; }

  /** Add one triangle; returns its index. */
  addTriangle(ax, ay, az, bx, by, bz, cx, cy, cz) {
    if ((this.count + 1) * 9 > this.verts.length) {
      const next = new Float64Array(this.verts.length * 2);
      next.set(this.verts);
      this.verts = next;
    }
    const o = this.count * 9, v = this.verts;
    v[o] = ax; v[o + 1] = ay; v[o + 2] = az; v[o + 3] = bx; v[o + 4] = by; v[o + 5] = bz; v[o + 6] = cx; v[o + 7] = cy; v[o + 8] = cz;
    this.built = false;
    return this.count++;
  }

  /** A quad a, b, c, d (in order around its edge) as two triangles. */
  addQuad(ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz) {
    this.addTriangle(ax, ay, az, bx, by, bz, cx, cy, cz);
    this.addTriangle(ax, ay, az, cx, cy, cz, dx, dy, dz);
  }

  /** An axis-aligned box (centre and half extents) as 12 triangles with outward normals. */
  addBox(cx, cy, cz, hx, hy, hz) {
    const x0 = cx - hx, x1 = cx + hx, y0 = cy - hy, y1 = cy + hy, z0 = cz - hz, z1 = cz + hz;
    this.addQuad(x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1); // +z
    this.addQuad(x1, y0, z0, x0, y0, z0, x0, y1, z0, x1, y1, z0); // -z
    this.addQuad(x1, y0, z1, x1, y0, z0, x1, y1, z0, x1, y1, z1); // +x
    this.addQuad(x0, y0, z0, x0, y0, z1, x0, y1, z1, x0, y1, z0); // -x
    this.addQuad(x0, y1, z1, x1, y1, z1, x1, y1, z0, x0, y1, z0); // +y
    this.addQuad(x0, y0, z0, x1, y0, z0, x1, y0, z1, x0, y0, z1); // -y
  }

  /**
   * Add triangles given as nine numbers each (three corners): what `Heightmap.toTriangles()` in `@engine/render` gives for terrain, or any triangle list you have built.
   * @param {ArrayLike<number>} triangles
   */
  addTriangles(triangles) {
    for (let i = 0; i + 8 < triangles.length; i += 9) this.addTriangle(triangles[i], triangles[i + 1], triangles[i + 2], triangles[i + 3], triangles[i + 4], triangles[i + 5], triangles[i + 6], triangles[i + 7], triangles[i + 8]);
  }

  /**
   * An indexed triangle mesh.
   * @param {ArrayLike<number>} positions x, y, z per vertex
   * @param {ArrayLike<number>} indices three vertex indices per triangle
   */
  addMesh(positions, indices) {
    for (let i = 0; i + 2 < indices.length; i += 3) {
      const a = indices[i] * 3, b = indices[i + 1] * 3, c = indices[i + 2] * 3;
      this.addTriangle(positions[a], positions[a + 1], positions[a + 2], positions[b], positions[b + 1], positions[b + 2], positions[c], positions[c + 1], positions[c + 2]);
    }
  }

  /** Compute normals and the grid. Call once after adding geometry. */
  build() {
    const n = this.count, v = this.verts;
    this.nx = new Float64Array(n); this.ny = new Float64Array(n); this.nz = new Float64Array(n);
    let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < n; i++) {
      const o = i * 9;
      const e1x = v[o + 3] - v[o], e1y = v[o + 4] - v[o + 1], e1z = v[o + 5] - v[o + 2];
      const e2x = v[o + 6] - v[o], e2y = v[o + 7] - v[o + 1], e2z = v[o + 8] - v[o + 2];
      const x = e1y * e2z - e1z * e2y, y = e1z * e2x - e1x * e2z, z = e1x * e2y - e1y * e2x;
      const len = Math.sqrt(x * x + y * y + z * z);
      if (len > 0) { this.nx[i] = x / len; this.ny[i] = y / len; this.nz[i] = z / len; }
      for (let k = 0; k < 3; k++) {
        const px = v[o + k * 3], py = v[o + k * 3 + 1], pz = v[o + k * 3 + 2];
        if (px < minX) minX = px; if (px > maxX) maxX = px;
        if (py < minY) minY = py; if (py > maxY) maxY = py;
        if (pz < minZ) minZ = pz; if (pz > maxZ) maxZ = pz;
      }
    }
    if (n === 0) { minX = minY = minZ = 0; maxX = maxY = maxZ = 1; }
    const pad = 1e-6;
    this.minX = minX - pad; this.minY = minY - pad; this.minZ = minZ - pad;
    this.maxX = maxX + pad; this.maxY = maxY + pad; this.maxZ = maxZ + pad;
    let cs = this.cellSize;
    const dims = () => [Math.max(1, Math.ceil((this.maxX - this.minX) / cs)), Math.max(1, Math.ceil((this.maxY - this.minY) / cs)), Math.max(1, Math.ceil((this.maxZ - this.minZ) / cs))];
    let [cols, rows, layers] = dims();
    while (cols * rows * layers > this.maxCells) { cs *= 1.25; [cols, rows, layers] = dims(); }
    this.cs = cs; this.cols = cols; this.rows = rows; this.layers = layers;
    const cells = cols * rows * layers;
    const start = new Int32Array(cells + 1);
    const range = (i, out) => { // cell range covered by triangle i
      const o = i * 9;
      let lx = Infinity, ly = Infinity, lz = Infinity, hx = -Infinity, hy = -Infinity, hz = -Infinity;
      for (let k = 0; k < 3; k++) {
        const px = v[o + k * 3], py = v[o + k * 3 + 1], pz = v[o + k * 3 + 2];
        if (px < lx) lx = px; if (px > hx) hx = px;
        if (py < ly) ly = py; if (py > hy) hy = py;
        if (pz < lz) lz = pz; if (pz > hz) hz = pz;
      }
      out[0] = this.#cell(lx, this.minX, cols); out[1] = this.#cell(hx, this.minX, cols);
      out[2] = this.#cell(ly, this.minY, rows); out[3] = this.#cell(hy, this.minY, rows);
      out[4] = this.#cell(lz, this.minZ, layers); out[5] = this.#cell(hz, this.minZ, layers);
    };
    const r = new Int32Array(6);
    for (let i = 0; i < n; i++) {
      range(i, r);
      for (let z = r[4]; z <= r[5]; z++) for (let y = r[2]; y <= r[3]; y++) for (let x = r[0]; x <= r[1]; x++) start[(z * rows + y) * cols + x + 1]++;
    }
    for (let c = 0; c < cells; c++) start[c + 1] += start[c];
    const items = new Int32Array(start[cells]);
    const cursor = start.slice(0, cells);
    for (let i = 0; i < n; i++) {
      range(i, r);
      for (let z = r[4]; z <= r[5]; z++) for (let y = r[2]; y <= r[3]; y++) for (let x = r[0]; x <= r[1]; x++) items[cursor[(z * rows + y) * cols + x]++] = i;
    }
    this.cellStart = start;
    this.cellItems = items;
    this.stamp = new Uint32Array(n);
    this.stampId = 0;
    this.built = true;
    return this;
  }

  #cell(p, min, n) {
    const c = Math.floor((p - min) / this.cs);
    return c < 0 ? 0 : c >= n ? n - 1 : c;
  }

  #nextStamp() {
    if (++this.stampId === 0xffffffff) { this.stamp.fill(0); this.stampId = 1; }
    return this.stampId;
  }

  /**
   * Triangles whose cells overlap the box (a superset of those touching it: callers run their own narrow phase).
   * @param {Int32Array} out
   * @returns {number} Count written (capped at out.length).
   */
  queryAabb(minX, minY, minZ, maxX, maxY, maxZ, out) {
    const id = this.#nextStamp();
    const x0 = this.#cell(minX, this.minX, this.cols), x1 = this.#cell(maxX, this.minX, this.cols);
    const y0 = this.#cell(minY, this.minY, this.rows), y1 = this.#cell(maxY, this.minY, this.rows);
    const z0 = this.#cell(minZ, this.minZ, this.layers), z1 = this.#cell(maxZ, this.minZ, this.layers);
    const { cellStart, cellItems, stamp, cols, rows } = this;
    let n = 0;
    for (let z = z0; z <= z1; z++) {
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const c = (z * rows + y) * cols + x;
          for (let k = cellStart[c], e = cellStart[c + 1]; k < e; k++) {
            const i = cellItems[k];
            if (stamp[i] === id) continue;
            stamp[i] = id;
            if (n < out.length) out[n++] = i;
          }
        }
      }
    }
    return n;
  }

  /**
   * Nearest triangle hit by a ray (a 3D cell walk, so cost follows the length of the ray, not the size of the world).
   * The direction need not be unit length: `t` is in multiples of it.
   *
   * @param {number} maxT Furthest hit considered, in multiples of the direction.
   * @param {{t: number, index: number, nx: number, ny: number, nz: number}} hit Written when true is returned (the normal faces the ray).
   * @returns {boolean}
   */
  raycast(ox, oy, oz, dx, dy, dz, maxT, hit) {
    const { cs, cols, rows, layers, cellStart, cellItems, stamp, verts } = this;
    // clip the ray to the grid box
    let tEnter = 0, tExit = maxT;
    const slab = (o, d, lo, hi) => {
      if (d === 0) return o >= lo && o <= hi;
      let a = (lo - o) / d, b = (hi - o) / d;
      if (a > b) { const t = a; a = b; b = t; }
      if (a > tEnter) tEnter = a;
      if (b < tExit) tExit = b;
      return tEnter <= tExit;
    };
    if (!slab(ox, dx, this.minX, this.maxX) || !slab(oy, dy, this.minY, this.maxY) || !slab(oz, dz, this.minZ, this.maxZ)) return false;
    const px = ox + dx * tEnter, py = oy + dy * tEnter, pz = oz + dz * tEnter;
    let gx = this.#cell(px, this.minX, cols), gy = this.#cell(py, this.minY, rows), gz = this.#cell(pz, this.minZ, layers);
    const sx = dx > 0 ? 1 : -1, sy = dy > 0 ? 1 : -1, sz = dz > 0 ? 1 : -1;
    const tdx = dx !== 0 ? cs / Math.abs(dx) : Infinity, tdy = dy !== 0 ? cs / Math.abs(dy) : Infinity, tdz = dz !== 0 ? cs / Math.abs(dz) : Infinity;
    let tmx = dx !== 0 ? (this.minX + (gx + (dx > 0 ? 1 : 0)) * cs - ox) / dx : Infinity;
    let tmy = dy !== 0 ? (this.minY + (gy + (dy > 0 ? 1 : 0)) * cs - oy) / dy : Infinity;
    let tmz = dz !== 0 ? (this.minZ + (gz + (dz > 0 ? 1 : 0)) * cs - oz) / dz : Infinity;
    const id = this.#nextStamp();
    let best = maxT, found = false, bestIndex = -1;
    for (;;) {
      const c = (gz * rows + gy) * cols + gx;
      for (let k = cellStart[c], e = cellStart[c + 1]; k < e; k++) {
        const i = cellItems[k];
        if (stamp[i] === id) continue;
        stamp[i] = id;
        const o = i * 9;
        const t = rayTriangle(ox, oy, oz, dx, dy, dz, verts[o], verts[o + 1], verts[o + 2], verts[o + 3], verts[o + 4], verts[o + 5], verts[o + 6], verts[o + 7], verts[o + 8], best);
        if (t >= 0 && t <= best) { best = t; found = true; bestIndex = i; }
      }
      const next = tmx < tmy ? (tmx < tmz ? tmx : tmz) : (tmy < tmz ? tmy : tmz);
      if (found && best <= next) break; // nothing in later cells can be nearer
      if (next > tExit) break;
      if (tmx <= tmy && tmx <= tmz) { gx += sx; tmx += tdx; if (gx < 0 || gx >= cols) break; }
      else if (tmy <= tmz) { gy += sy; tmy += tdy; if (gy < 0 || gy >= rows) break; }
      else { gz += sz; tmz += tdz; if (gz < 0 || gz >= layers) break; }
    }
    if (!found) return false;
    hit.t = best; hit.index = bestIndex;
    const f = this.nx[bestIndex] * dx + this.ny[bestIndex] * dy + this.nz[bestIndex] * dz > 0 ? -1 : 1; // face the ray
    hit.nx = this.nx[bestIndex] * f; hit.ny = this.ny[bestIndex] * f; hit.nz = this.nz[bestIndex] * f;
    return true;
  }
}
