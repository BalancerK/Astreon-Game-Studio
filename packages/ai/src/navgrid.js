// A navigation grid built from a triangle world: for every column of a regular grid, every standable floor (several per column in a
// multi-storey level), joined to its eight neighbours where an agent of a given size can walk (steps, slopes, short drops), minus a
// margin around walls and ledges for the agent's radius. Paths run over it (see path.js) and agents can be kept off blocked cells.
//
// Built once from a `TriWorld` with ray casts (the same level the physics uses), so what the AI thinks is walkable is what the
// character controller can actually walk. Deterministic: only + - * / and sqrt, fixed iteration order.

import { cos, tan } from '../../math/src/index.js';

const DX = [1, 1, 0, -1, -1, -1, 0, 1];
const DZ = [0, 1, 1, 1, 0, -1, -1, -1];
const DIST = [1, Math.SQRT2, 1, Math.SQRT2, 1, Math.SQRT2, 1, Math.SQRT2];
/** The eight directions: 0 = +x, then clockwise seen from above (+z is 2). Even numbers are straight, odd are diagonal. */
export const DIRECTIONS = Object.freeze({ dx: DX, dz: DZ });

/**
 * @typedef {object} NavOptions
 * @property {{minX: number, minZ: number, maxX: number, maxZ: number}} bounds Area to cover (metres).
 * @property {number} [cellSize] Grid spacing (0.5). Smaller finds narrower gaps and costs more memory and build time.
 * @property {number} [agentRadius] Keep this far from walls and ledges (0.4).
 * @property {number} [agentHeight] Headroom needed above a floor (1.8).
 * @property {number} [stepHeight] Highest step it climbs (0.4).
 * @property {number} [maxSlope] Steepest slope it walks, in degrees (45).
 * @property {number} [maxDrop] Longest drop it will step off, one way (1.2); 0 for none.
 * @property {number} [maxGap] Widest gap (a crack between two platforms, a missing step) it will step across (0.6 m); 0 for none.
 * @property {number} [top] Highest floor to look for (default 60) and `bottom` the lowest (-5).
 * @property {number} [maxLayers] Floors kept per column (6).
 */

/**
 * A grid of the walkable floor in a level, built once from its collision triangles: a height per cell, several floors per column
 * (stairs, bridges), cells too close to walls removed for the agent's radius, and links for drops and small gaps. Create it with
 * `NavGrid.build(world, options)` and search it with `findPath`.
 */
export class NavGrid {
  /** Use `NavGrid.build(world, options)`. */
  constructor(o) {
    this.cellSize = o.cellSize; this.minX = o.minX; this.minZ = o.minZ; this.cols = o.cols; this.rows = o.rows;
    this.agentRadius = o.agentRadius; this.agentHeight = o.agentHeight; this.stepHeight = o.stepHeight; this.maxSlope = o.maxSlope; this.maxDrop = o.maxDrop; this.maxGap = o.maxGap;
    this.count = 0;
    this.x = new Float32Array(0); this.y = new Float32Array(0); this.z = new Float32Array(0);
    this.colOf = new Int32Array(0);
    this.colStart = new Int32Array(this.cols * this.rows + 1);
    /** Neighbour of node n in direction d: adj[n * 8 + d], or -1. */
    this.adj = new Int32Array(0);
    /** 1 when a node is a place agents may stand (cleared by erosion). */
    this.walk = new Uint8Array(0);
    /** The kind of ground (0 = normal); each kind has a cost multiplier in `areaCost`. */
    this.area = new Uint8Array(0);
    this.areaCost = new Float32Array(32).fill(1);
    /** Number of obstacles covering a node; above zero it cannot be entered. */
    this.blocked = new Int16Array(0);
    /** Extra connections (jumps, ladders, teleports) between nodes, as flat lists per node. */
    this.links = new Map();
    /** Goes up whenever blocking or links change, so agents know to look for a new path. */
    this.version = 0;
    this.obstacles = new Map();
    this.nextObstacle = 1;
  }

  /**
   * @param {import('../../physics/src/tri-world.js').TriWorld} world A built world. Triangles should be wound so their normal points out of the solid (boxes and glTF meshes are); a floor below another surface counts only if it faces up.
   * @param {NavOptions} options
   */
  static build(world, options) {
    const { bounds } = options;
    const o = {
      cellSize: options.cellSize ?? 0.5, agentRadius: options.agentRadius ?? 0.4, agentHeight: options.agentHeight ?? 1.8,
      stepHeight: options.stepHeight ?? 0.4, maxSlope: options.maxSlope ?? 45, maxDrop: options.maxDrop ?? 1.2, maxGap: options.maxGap ?? 0.6,
    };
    o.minX = bounds.minX; o.minZ = bounds.minZ;
    o.cols = Math.max(1, Math.ceil((bounds.maxX - bounds.minX) / o.cellSize)); o.rows = Math.max(1, Math.ceil((bounds.maxZ - bounds.minZ) / o.cellSize));
    const nav = new NavGrid(o);
    nav.#sample(world, options.top ?? 60, options.bottom ?? -5, options.maxLayers ?? 6);
    nav.#link(world);
    nav.#erode();
    nav.#drops(world);
    return nav;
  }

  // ---------------------------------------------------------------- building
  #sample(world, top, bottom, maxLayers) {
    const { cols, rows, cellSize, minX, minZ, agentHeight } = this;
    const cosSlope = cos(this.maxSlope * 0.017453292519943295);
    const xs = [], ys = [], zs = [], colOf = [];
    const hit = { t: 0, index: 0, nx: 0, ny: 0, nz: 0 }, head = { t: 0, index: 0, nx: 0, ny: 0, nz: 0 };
    for (let iz = 0; iz < rows; iz++) {
      for (let ix = 0; ix < cols; ix++) {
        const col = iz * cols + ix;
        this.colStart[col] = xs.length;
        const cx = minX + (ix + 0.5) * cellSize + 0.00137, cz = minZ + (iz + 0.5) * cellSize + 0.00219; // off the exact grid lines of boxes
        let y = top, first = true;
        for (let layer = 0; layer < maxLayers && y > bottom; ) {
          if (!world.raycast(cx, y, cz, 0, -1, 0, y - bottom, hit)) break;
          const fy = y - hit.t;
          // a floor: not too steep; and below another surface only if its own winding says it faces up (the underside of a slab does not)
          if (hit.ny >= cosSlope && (first || world.ny[hit.index] > 0.05) && !world.raycast(cx, fy + 0.02, cz, 0, 1, 0, agentHeight - 0.02, head)) {
            xs.push(cx); ys.push(fy); zs.push(cz); colOf.push(col); layer++;
          }
          first = false;
          y = fy - 0.02;
        }
      }
    }
    this.colStart[cols * rows] = xs.length;
    this.count = xs.length;
    this.x = Float32Array.from(xs); this.y = Float32Array.from(ys); this.z = Float32Array.from(zs); this.colOf = Int32Array.from(colOf);
    this.adj = new Int32Array(this.count * 8).fill(-1);
    this.walk = new Uint8Array(this.count).fill(1);
    this.area = new Uint8Array(this.count);
    this.blocked = new Int16Array(this.count);
  }

  /** The highest rise allowed between two nodes `dist` metres apart: a step, or what the steepest walkable slope gives over that distance. */
  #climb(dist) { return Math.max(this.stepHeight, tan(this.maxSlope * 0.017453292519943295) * dist * 0.5 + this.stepHeight * 0.25); }

  #link(world) {
    const { cols, rows, cellSize, count } = this;
    const hit = { t: 0, index: 0, nx: 0, ny: 0, nz: 0 };
    const knee = this.stepHeight + 0.05;
    const gapCells = Math.round(this.maxGap / this.cellSize);
    for (let n = 0; n < count; n++) {
      const col = this.colOf[n], ix = col % cols, iz = (col - ix) / cols;
      for (let d = 0; d < 8; d++) {
        const jx = ix + DX[d], jz = iz + DZ[d];
        if (jx < 0 || jz < 0 || jx >= cols || jz >= rows) continue;
        const dist = DIST[d] * cellSize, up = this.#climb(dist);
        let best = -1, bestDy = Infinity;
        for (let m = this.colStart[jz * cols + jx], e = this.colStart[jz * cols + jx + 1]; m < e; m++) {
          const dy = this.y[m] - this.y[n];
          if (dy > up || dy < -this.maxDrop) continue;
          if (Math.abs(dy) < Math.abs(bestDy)) { bestDy = dy; best = m; }
        }
        let reach = 1;
        if (best < 0 && (d & 1) === 0 && gapCells > 0) { // a crack too narrow to matter: look across it, straight ahead
          for (reach = 2; reach <= gapCells + 1 && best < 0; reach++) {
            const kx = ix + DX[d] * reach, kz = iz + DZ[d] * reach;
            if (kx < 0 || kz < 0 || kx >= cols || kz >= rows) break;
            const dd = dist * reach, upReach = Math.max(this.stepHeight, this.#climb(dd));
            for (let m = this.colStart[kz * cols + kx], e = this.colStart[kz * cols + kx + 1]; m < e; m++) {
              const dy = this.y[m] - this.y[n];
              if (dy <= Math.min(upReach, this.stepHeight) && dy >= -this.maxDrop && Math.abs(dy) < Math.abs(bestDy)) { bestDy = dy; best = m; }
            }
          }
        }
        if (best < 0) continue;
        // nothing solid across the way at knee height (a thin wall between two cells that both have floor)
        const ox = this.x[n], oy = this.y[n] + knee, oz = this.z[n], tx = this.x[best] - ox, tz = this.z[best] - oz, ty = Math.max(this.y[best], this.y[n]) + knee - oy;
        if (world.raycast(ox, oy, oz, tx, ty, tz, 1, hit)) continue;
        this.adj[n * 8 + d] = best;
      }
    }
    // a diagonal needs both straight moves beside it, so agents do not cut wall corners
    for (let n = 0; n < count; n++) {
      for (let d = 1; d < 8; d += 2) {
        const m = this.adj[n * 8 + d];
        if (m < 0) continue;
        if (this.adj[n * 8 + ((d + 7) & 7)] < 0 || this.adj[n * 8 + ((d + 1) & 7)] < 0) this.adj[n * 8 + d] = -1;
      }
    }
  }

  /** Remove the nodes closer to a wall or ledge than the agent's radius. */
  #erode() {
    const { count, adj } = this;
    const depth = new Int32Array(count).fill(-1);
    const queue = new Int32Array(count);
    let head = 0, tail = 0;
    const level = (n, d) => { // somewhere to go that way: a level link with a way back, or a drop (which has none, and is not an edge: an agent can step off it)
      const m = adj[n * 8 + d];
      if (m < 0) return false;
      const dy = this.y[m] - this.y[n];
      return dy < -this.stepHeight || (adj[m * 8 + ((d + 4) & 7)] === n && Math.abs(dy) <= this.#climb(DIST[d] * this.cellSize));
    };
    for (let n = 0; n < count; n++) {
      let edge = false;
      for (let d = 0; d < 8 && !edge; d += 2) if (!level(n, d)) edge = true; // (only the straight directions: a corner cell is not an edge by itself)
      if (edge) { depth[n] = 0; queue[tail++] = n; }
    }
    const limit = this.agentRadius / this.cellSize - 0.5; // nodes nearer than this (in cells) to an edge are too close for the agent
    while (head < tail) {
      const n = queue[head++];
      if (depth[n] >= limit) continue;
      for (let d = 0; d < 8; d += 2) { const m = adj[n * 8 + d]; if (m >= 0 && depth[m] < 0) { depth[m] = depth[n] + 1; queue[tail++] = m; } }
    }
    for (let n = 0; n < count; n++) if (depth[n] >= 0 && depth[n] < limit) this.walk[n] = 0;
    for (let n = 0; n < count; n++) if (this.walk[n] === 0) for (let d = 0; d < 8; d++) this.adj[n * 8 + d] = -1;
    for (let n = 0; n < count; n++) for (let d = 0; d < 8; d++) { const m = this.adj[n * 8 + d]; if (m >= 0 && this.walk[m] === 0) this.adj[n * 8 + d] = -1; }
  }

  /** After erosion: from every walkable node, a straight way off a ledge that has no neighbour that way, down onto the nearest walkable node within a few cells (a one-way link). */
  #drops(world) {
    if (this.maxDrop <= 0) return;
    const { cols, rows, cellSize } = this;
    const hit = { t: 0, index: 0, nx: 0, ny: 0, nz: 0 }, knee = this.stepHeight + 0.05;
    for (let n = 0; n < this.count; n++) {
      if (!this.walk[n]) continue;
      const col = this.colOf[n], ix = col % cols, iz = (col - ix) / cols;
      for (let d = 0; d < 8; d += 2) {
        if (this.adj[n * 8 + d] >= 0) continue;
        let best = -1;
        for (let reach = 1; reach <= 3 && best < 0; reach++) {
          const jx = ix + DX[d] * reach, jz = iz + DZ[d] * reach;
          if (jx < 0 || jz < 0 || jx >= cols || jz >= rows) break;
          let bestDy = Infinity;
          for (let m = this.colStart[jz * cols + jx], e = this.colStart[jz * cols + jx + 1]; m < e; m++) {
            const dy = this.y[m] - this.y[n];
            if (!this.walk[m] || dy > -this.stepHeight || dy < -this.maxDrop) continue;
            if (-dy < bestDy) { bestDy = -dy; best = m; }
          }
        }
        if (best < 0) continue;
        const ox = this.x[n], oy = this.y[n] + knee, oz = this.z[n];
        if (world.raycast(ox, oy, oz, this.x[best] - ox, 0, this.z[best] - oz, 1, hit)) continue; // nothing in the way as it steps out
        this.adj[n * 8 + d] = best;
      }
    }
  }

  // ---------------------------------------------------------------- queries
  /** Number of nodes an agent can stand on. */
  get walkableCount() { let k = 0; for (let n = 0; n < this.count; n++) k += this.walk[n]; return k; }

  /** The cell column holding a world position, or -1 outside the grid. */
  columnAt(x, z) {
    const ix = Math.floor((x - this.minX) / this.cellSize), iz = Math.floor((z - this.minZ) / this.cellSize);
    return ix < 0 || iz < 0 || ix >= this.cols || iz >= this.rows ? -1 : iz * this.cols + ix;
  }

  /**
   * The walkable node nearest a point: the best floor in its column (preferring one at about the same height), else the nearest
   * cell in rings around it, up to `maxCells` away.
   * @returns {number} node index, or -1
   */
  nearest(x, y, z, maxCells = 6) {
    const cs = this.cellSize, ix0 = Math.floor((x - this.minX) / cs), iz0 = Math.floor((z - this.minZ) / cs);
    let best = -1, bestScore = Infinity;
    for (let r = 0; r <= maxCells; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const ix = ix0 + dx, iz = iz0 + dz;
          if (ix < 0 || iz < 0 || ix >= this.cols || iz >= this.rows) continue;
          const col = iz * this.cols + ix;
          for (let n = this.colStart[col], e = this.colStart[col + 1]; n < e; n++) {
            if (!this.walk[n] || this.blocked[n] > 0) continue;
            const ddx = this.x[n] - x, ddy = (this.y[n] - y) * 1.5, ddz = this.z[n] - z, s = ddx * ddx + ddy * ddy + ddz * ddz;
            if (s < bestScore) { bestScore = s; best = n; }
          }
        }
      }
      if (best >= 0 && (r * cs) * (r * cs) >= bestScore) break; // nothing in a farther ring can be closer
    }
    return best;
  }

  /** Set the kind of ground inside a box (e.g. water, mud) and give each kind a cost multiplier with `areaCost[kind] = 3`. */
  setArea(minX, minY, minZ, maxX, maxY, maxZ, kind) {
    for (let n = 0; n < this.count; n++) {
      if (this.x[n] >= minX && this.x[n] <= maxX && this.y[n] >= minY && this.y[n] <= maxY && this.z[n] >= minZ && this.z[n] <= maxZ) this.area[n] = kind;
    }
    this.version++;
  }

  /**
   * Keep agents out of a box (a closed door, a barricade, a spreading fire). Nodes within `margin` of it become impassable until
   * `unblock`. Returns a handle.
   */
  block(minX, minY, minZ, maxX, maxY, maxZ, margin = this.agentRadius) {
    const id = this.nextObstacle++, nodes = [];
    for (let n = 0; n < this.count; n++) {
      if (this.x[n] >= minX - margin && this.x[n] <= maxX + margin && this.z[n] >= minZ - margin && this.z[n] <= maxZ + margin && this.y[n] + this.agentHeight >= minY && this.y[n] <= maxY) { this.blocked[n]++; nodes.push(n); }
    }
    this.obstacles.set(id, nodes);
    this.version++;
    return id;
  }
  unblock(id) {
    const nodes = this.obstacles.get(id);
    if (!nodes) return;
    for (const n of nodes) this.blocked[n]--;
    this.obstacles.delete(id);
    this.version++;
  }

  /** Connect two nodes by something that is not walking: a jump, a ladder, a teleporter. `cost` is in metres of walking it is worth. */
  addLink(from, to, { cost = null, bidirectional = true } = {}) {
    const dx = this.x[to] - this.x[from], dy = this.y[to] - this.y[from], dz = this.z[to] - this.z[from];
    const c = cost ?? Math.sqrt(dx * dx + dy * dy + dz * dz) * 1.5;
    const push = (a, b) => { let l = this.links.get(a); if (!l) this.links.set(a, l = []); l.push(b, c); };
    push(from, to);
    if (bidirectional) push(to, from);
    this.version++;
  }

  /**
   * Can an agent walk in a straight line between two nodes along the grid (every step of the line is a real connection)?
   * Used to smooth paths and to test "can I just go there". `costLimit`: refuse to walk through ground costlier than this (a swamp).
   */
  lineOfWalk(a, b, costLimit = Infinity) {
    if (a === b) return true;
    const cols = this.cols;
    let ca = this.colOf[a], cb = this.colOf[b];
    let x0 = ca % cols, z0 = (ca - x0) / cols;
    const x1 = cb % cols, z1 = (cb - x1) / cols;
    const dx = Math.abs(x1 - x0), dz = Math.abs(z1 - z0), sx = x0 < x1 ? 1 : -1, sz = z0 < z1 ? 1 : -1;
    let err = dx - dz, n = a;
    while (x0 !== x1 || z0 !== z1) {
      const e2 = 2 * err;
      let mx = 0, mz = 0;
      if (e2 > -dz) { err -= dz; mx = sx; }
      if (e2 < dx) { err += dx; mz = sz; }
      let d = 0;
      for (; d < 8; d++) if (DX[d] === mx && DZ[d] === mz) break;
      const m = this.adj[n * 8 + d];
      if (m < 0 || this.blocked[m] > 0 || this.areaCost[this.area[m]] > costLimit) return false;
      const cm = this.colOf[m], mxc = cm % cols, mzc = (cm - mxc) / cols;
      if (mxc !== x0 + mx || mzc !== z0 + mz) return false; // a link across a gap: not part of a straight walk
      n = m; x0 += mx; z0 += mz;
    }
    return n === b || (this.colOf[n] === this.colOf[b] && Math.abs(this.y[n] - this.y[b]) < this.stepHeight);
  }
}
