// Finding a way through three dimensions: for things that fly, or climb, or jump between levels. The space is cut into cubes; a cube is free if a body of the agent's size standing (or hovering)
// there touches none of the solid boxes you add. A* then finds a path through the free cubes, and the path is pulled straight wherever there is a clear line. One volume is made for each
// size of agent (a small mecha fits through gaps a large one cannot). Only + - * / and sqrt, so the same boxes and the same question always give the same path on every machine.
//
// ```js
// const nav = new NavVolume({ min: [-60, 0, -60], max: [60, 45, 60], cell: 4, radius: 2, height: 7 });
// nav.addBoxes(level.solids);
// const { status, path } = nav.findPath([-30, 0, 0], [40, 18, 20]);   // status 'found', 'partial' (got as close as it could) or 'none'
// ```

const sqrt = Math.sqrt;
const OFFSETS = [];
for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (dx || dy || dz) OFFSETS.push([dx, dy, dz, sqrt(dx * dx + dy * dy * 1.96 + dz * dz)]);

/** The cheapest first: a binary heap of cell numbers by cost, ties broken by the smaller cell number, so the order never depends on how the engine sorts. */
class Heap {
  constructor(cost) { this.cost = cost; this.items = []; }
  get size() { return this.items.length; }
  less(a, b) { return this.cost[a] < this.cost[b] || (this.cost[a] === this.cost[b] && a < b); }
  push(cell) {
    const h = this.items;
    h.push(cell);
    let i = h.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.less(h[i], h[p])) break;
      [h[i], h[p]] = [h[p], h[i]];
      i = p;
    }
  }
  pop() {
    const h = this.items, top = h[0], last = h.pop();
    if (h.length) {
      h[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < h.length && this.less(h[l], h[m])) m = l;
        if (r < h.length && this.less(h[r], h[m])) m = r;
        if (m === i) break;
        [h[i], h[m]] = [h[m], h[i]];
        i = m;
      }
    }
    return top;
  }
}

/**
 * @typedef {object} Box A solid, with the smaller number first on each axis.
 * @property {number} x0 @property {number} x1 @property {number} y0 @property {number} y1 @property {number} z0 @property {number} z1
 */

/** A three-dimensional navigation volume for one size of agent: add the solid boxes, then ask for paths between points (see the notes at the top of this file). */
export class NavVolume {
  /**
   * @param {object} o
   * @param {number[]} o.min The low corner of the space. @param {number[]} o.max The high corner. @param {number} [o.cell] The size of a cube, in metres (4).
   * @param {number} [o.radius] The agent's half width. @param {number} [o.height] The agent's height. The agent's feet are what the cubes hold, so the lowest layer is the floor.
   */
  constructor({ min, max, cell = 4, radius = 1, height = 5 }) {
    this.min = min.slice();
    this.max = max.slice();
    this.cell = cell;
    this.radius = radius;
    this.height = height;
    this.nx = Math.max(1, Math.ceil((max[0] - min[0]) / cell));
    this.ny = Math.max(1, Math.ceil((max[1] - min[1] - height) / cell) + 1);
    this.nz = Math.max(1, Math.ceil((max[2] - min[2]) / cell));
    this.blocked = new Uint8Array(this.nx * this.ny * this.nz);
    /** Counts every change, so a path made earlier can be told it may be out of date. */
    this.version = 0;
  }

  /** The cube number of a point, or -1 outside the space. @param {number} x @param {number} y @param {number} z */
  cellAt(x, y, z) {
    const ix = Math.floor((x - this.min[0]) / this.cell), iy = Math.floor((y - this.min[1]) / this.cell + 1e-9), iz = Math.floor((z - this.min[2]) / this.cell);
    if (ix < 0 || iy < 0 || iz < 0 || ix >= this.nx || iy >= this.ny || iz >= this.nz) return -1;
    return (iy * this.nz + iz) * this.nx + ix;
  }

  /** Where the agent's feet are for a cube. @param {number} cell @returns {number[]} */
  centerOf(cell) {
    const ix = cell % this.nx, iz = Math.floor(cell / this.nx) % this.nz, iy = Math.floor(cell / (this.nx * this.nz));
    return [this.min[0] + (ix + 0.5) * this.cell, this.min[1] + iy * this.cell, this.min[2] + (iz + 0.5) * this.cell];
  }

  /** Mark the cubes a box blocks (where the agent's body would touch it). @param {Box} b */
  addBox(b) {
    const r = this.radius, h = this.height, c = this.cell;
    const x0 = Math.max(0, Math.floor((b.x0 - r - this.min[0]) / c)), x1 = Math.min(this.nx - 1, Math.floor((b.x1 + r - this.min[0]) / c));
    const z0 = Math.max(0, Math.floor((b.z0 - r - this.min[2]) / c)), z1 = Math.min(this.nz - 1, Math.floor((b.z1 + r - this.min[2]) / c));
    const y0 = Math.max(0, Math.floor((b.y0 - h - this.min[1]) / c)), y1 = Math.min(this.ny - 1, Math.floor((b.y1 - this.min[1]) / c));
    for (let iy = y0; iy <= y1; iy++) {
      const fy = this.min[1] + iy * c;
      if (!(fy + h > b.y0 && fy < b.y1)) continue;
      for (let iz = z0; iz <= z1; iz++) {
        const cz = this.min[2] + (iz + 0.5) * c;
        if (!(cz + r > b.z0 && cz - r < b.z1)) continue;
        for (let ix = x0; ix <= x1; ix++) {
          const cx = this.min[0] + (ix + 0.5) * c;
          if (cx + r > b.x0 && cx - r < b.x1) this.blocked[(iy * this.nz + iz) * this.nx + ix] = 1;
        }
      }
    }
    this.version++;
  }

  /** @param {Box[]} boxes */
  addBoxes(boxes) { for (const b of boxes) this.addBox(b); }

  /**
   * Mark the ground: every cube whose feet would be inside the land is blocked. The land is a function from a place to its height; the highest point under the agent's width counts, so the
   * agent never fits through a gap between two hills that is narrower than its body.
   * @param {(x: number, z: number) => number} heightAt
   */
  addHeightfield(heightAt) {
    const r = this.radius, c = this.cell;
    for (let iz = 0; iz < this.nz; iz++) {
      for (let ix = 0; ix < this.nx; ix++) {
        const cx = this.min[0] + (ix + 0.5) * c, cz = this.min[2] + (iz + 0.5) * c;
        let ground = -Infinity;
        for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) ground = Math.max(ground, heightAt(cx + a * (c / 2 + r) * 0.8, cz + b * (c / 2 + r) * 0.8));
        for (let iy = 0; iy < this.ny; iy++) {
          if (this.min[1] + iy * c < ground - 1e-6) this.blocked[(iy * this.nz + iz) * this.nx + ix] = 1; else break;
        }
      }
    }
    this.version++;
  }

  /** Is the agent allowed to be with its feet here? @param {number} x @param {number} y @param {number} z */
  free(x, y, z) {
    const i = this.cellAt(x, y, z);
    return i >= 0 && this.blocked[i] === 0;
  }

  /** The nearest free point to somewhere (a spot inside a wall, say), looking outward a few cubes. Returns null if none is near. */
  nearestFree(x, y, z, rings = 4) {
    const i = this.cellAt(x, Math.max(this.min[1], y), z);
    const base = i >= 0 ? i : this.cellAt(Math.min(this.max[0] - 1e-6, Math.max(this.min[0], x)), Math.max(this.min[1], y), Math.min(this.max[2] - 1e-6, Math.max(this.min[2], z)));
    if (base < 0) return null;
    const ix = base % this.nx, iz = Math.floor(base / this.nx) % this.nz, iy = Math.floor(base / (this.nx * this.nz));
    let best = -1, bestD = Infinity;
    for (let d = 0; d <= rings && best < 0; d++) {
      for (let dy = -d; dy <= d; dy++) for (let dz = -d; dz <= d; dz++) for (let dx = -d; dx <= d; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) !== d) continue;
        const jx = ix + dx, jy = iy + dy, jz = iz + dz;
        if (jx < 0 || jy < 0 || jz < 0 || jx >= this.nx || jy >= this.ny || jz >= this.nz) continue;
        const j = (jy * this.nz + jz) * this.nx + jx;
        if (this.blocked[j]) continue;
        const c = this.centerOf(j), ex = c[0] - x, ey = c[1] - y, ez = c[2] - z, dist = ex * ex + ey * ey + ez * ez;
        if (dist < bestD) { bestD = dist; best = j; }
      }
    }
    return best < 0 ? null : this.centerOf(best);
  }

  /** Is the straight line between two points clear (every step along it is a free place)? @param {number[]} a @param {number[]} b */
  lineClear(a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], len = sqrt(dx * dx + dy * dy + dz * dz);
    const steps = Math.max(1, Math.ceil(len / (this.cell * 0.5)));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      if (!this.free(a[0] + dx * t, a[1] + dy * t, a[2] + dz * t)) return false;
    }
    return true;
  }

  /**
   * Find a path. The start and the goal are moved to the nearest free place if they are inside something.
   * @param {number[]} from @param {number[]} to @param {{maxNodes?: number, smooth?: boolean}} [o]
   * @returns {{status: 'found' | 'partial' | 'none', path: number[][], cost: number}} `partial` means the goal cannot be reached; the path ends as near to it as the search got.
   */
  findPath(from, to, { maxNodes = 40000, smooth = true } = {}) {
    const s0 = this.nearestFree(from[0], from[1], from[2]), g0 = this.nearestFree(to[0], to[1], to[2]);
    if (!s0 || !g0) return { status: 'none', path: [], cost: 0 };
    const start = this.cellAt(s0[0], s0[1], s0[2]), goal = this.cellAt(g0[0], g0[1], g0[2]);
    const total = this.blocked.length;
    // the working arrays are kept between searches (a big volume searched often would otherwise make a lot of garbage)
    const w = (this.work ??= { g: new Float64Array(total), f: new Float64Array(total), came: new Int32Array(total), closed: new Uint8Array(total) });
    const { g, f, came, closed } = w;
    g.fill(Infinity); f.fill(Infinity); came.fill(-1); closed.fill(0);
    const gc = this.centerOf(goal);
    const heuristic = (cell) => {
      const c = this.centerOf(cell), ex = c[0] - gc[0], ey = c[1] - gc[1], ez = c[2] - gc[2];
      return sqrt(ex * ex + ey * ey + ez * ez);
    };
    const open = new Heap(f);
    g[start] = 0;
    f[start] = heuristic(start);
    open.push(start);
    let nearest = start, nearestH = f[start], expanded = 0;
    const layer = this.nx * this.nz;
    while (open.size && expanded < maxNodes) {
      const cur = open.pop();
      if (closed[cur]) continue;
      closed[cur] = 1;
      expanded++;
      if (cur === goal) { nearest = cur; break; }
      const h = f[cur] - g[cur];
      if (h < nearestH) { nearestH = h; nearest = cur; }
      const ix = cur % this.nx, iz = Math.floor(cur / this.nx) % this.nz, iy = Math.floor(cur / layer);
      for (const [dx, dy, dz, step] of OFFSETS) {
        const jx = ix + dx, jy = iy + dy, jz = iz + dz;
        if (jx < 0 || jy < 0 || jz < 0 || jx >= this.nx || jy >= this.ny || jz >= this.nz) continue;
        const j = jy * layer + jz * this.nx + jx;
        if (closed[j] || this.blocked[j]) continue;
        if ((dx && this.blocked[iy * layer + iz * this.nx + jx]) || (dz && this.blocked[iy * layer + jz * this.nx + ix]) || (dy && this.blocked[jy * layer + iz * this.nx + ix])) continue;
        const cost = g[cur] + step * this.cell;
        if (cost < g[j]) {
          g[j] = cost;
          f[j] = cost + heuristic(j);
          came[j] = cur;
          open.push(j);
        }
      }
    }
    const end = closed[goal] ? goal : nearest;
    const cells = [];
    for (let c = end; c !== -1; c = came[c]) cells.push(c);
    cells.reverse();
    let points = cells.map((c) => this.centerOf(c));
    if (smooth) points = this.#smooth(points);
    const status = end === goal ? 'found' : end === start ? 'none' : 'partial';
    return { status, path: points, cost: g[end] };
  }

  /** Pull the path straight: from each point, jump to the furthest later point that can be reached in a straight line. */
  #smooth(points) {
    if (points.length <= 2) return points;
    const out = [points[0]];
    let i = 0;
    while (i < points.length - 1) {
      let j = points.length - 1;
      while (j > i + 1 && !this.lineClear(points[i], points[j])) j--;
      out.push(points[j]);
      i = j;
    }
    return out;
  }
}
