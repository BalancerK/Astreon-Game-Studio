// A navigation mesh: the walkable surface of a level as triangles joined along shared edges. Agents walk anywhere on it, not only between grid cells, and a path is the
// shortest line through the corridor of triangles (the "funnel" algorithm), held off the corners of walls by the agent's radius. Built from the level's triangles in a
// moment (so it can be rebuilt at run time), with obstacles that can be added and taken away while the game runs.
//
// Where the grid (navgrid.js) suits platformers, stairs and tight levels, the mesh suits open worlds: terrain, big rooms, caves.
// Deterministic like the rest of the package: only + - * / and sqrt, with a fixed order everywhere, so a server and its clients find the same paths.

import { cos } from '../../math/src/index.js';

const EPS = 1e-9;
const DEG = 0.017453292519943295;

/** A small binary min-heap of (key, polygon) pairs. Ties are broken by insertion order, so the result never depends on anything but the input. */
class Heap {
  constructor() { this.keys = new Float64Array(256); this.items = new Int32Array(256); this.order = new Float64Array(256); this.size = 0; this.counter = 0; }
  clear() { this.size = 0; this.counter = 0; }
  less(a, b) { return this.keys[a] < this.keys[b] || (this.keys[a] === this.keys[b] && this.order[a] < this.order[b]); }
  swap(a, b) {
    const k = this.keys[a], i = this.items[a], o = this.order[a];
    this.keys[a] = this.keys[b]; this.items[a] = this.items[b]; this.order[a] = this.order[b];
    this.keys[b] = k; this.items[b] = i; this.order[b] = o;
  }
  push(key, item) {
    if (this.size === this.keys.length) {
      const n = this.size * 2, k = new Float64Array(n), it = new Int32Array(n), o = new Float64Array(n);
      k.set(this.keys); it.set(this.items); o.set(this.order);
      this.keys = k; this.items = it; this.order = o;
    }
    let i = this.size++;
    this.keys[i] = key; this.items[i] = item; this.order[i] = this.counter++;
    while (i > 0) { const p = (i - 1) >> 1; if (!this.less(i, p)) break; this.swap(i, p); i = p; }
  }
  pop() {
    const top = this.items[0];
    this.size--;
    if (this.size > 0) {
      this.keys[0] = this.keys[this.size]; this.items[0] = this.items[this.size]; this.order[0] = this.order[this.size];
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < this.size && this.less(l, m)) m = l;
        if (r < this.size && this.less(r, m)) m = r;
        if (m === i) break;
        this.swap(i, m); i = m;
      }
    }
    return top;
  }
}

const cross2 = (ax, az, bx, bz) => ax * bz - az * bx;
/** Length of a vector of two or three parts (Math.hypot is not guaranteed to give the same bits everywhere; a square root is). */
function hyp(a, b, c = 0) { return Math.sqrt(a * a + b * b + c * c); }

/**
 * @typedef {object} NavMeshOptions
 * @property {number} [maxSlope] Steepest slope walked, in degrees (45); steeper triangles, and ceilings, are not part of the mesh.
 * @property {number} [maxEdge] Cut triangles with a side longer than this into smaller ones (default: leave them). Obstacles and ground kinds work on whole triangles, so smaller triangles
 *   mean finer shapes; a few metres is usually right for big flat areas.
 * @property {number} [agentRadius] The default distance paths keep from the corners of walls and obstacles (0.4); `findPath` can ask for another.
 * @property {number} [weld] Vertices closer than this are joined (0.0001).
 *
 * @typedef {object} NavPath
 * @property {boolean} found A route to the goal was found.
 * @property {boolean} partial No route to the goal exists; `points` lead to the nearest place that can be reached (only with `partial: true`).
 * @property {number[]} points The way, as x, y, z, x, y, z, ...: the start, the corners to turn at, and the end.
 * @property {number[]} polys The triangles crossed.
 * @property {number} length Metres.
 */

/**
 * The walkable surface of a level as a mesh of triangles. Make it with `NavMesh.build(vertices, indices, options)`.
 */
export class NavMesh {
  /**
   * Make a navigation mesh from triangles (the level's collision triangles will do: it keeps the ones an agent can stand on).
   * @param {ArrayLike<number>} vertices x, y, z for each vertex
   * @param {ArrayLike<number>} indices three vertex numbers for each triangle
   * @param {NavMeshOptions} [options]
   */
  static build(vertices, indices, options = {}) { return new NavMesh(vertices, indices, options); }

  constructor(vertices, indices, { maxSlope = 45, maxEdge = Infinity, agentRadius = 0.4, weld = 0.0001 } = {}) {
    if (vertices.length % 3 !== 0 || indices.length % 3 !== 0) throw new Error('a navigation mesh needs x, y, z for each vertex and three vertex numbers for each triangle');
    this.maxSlope = maxSlope; this.agentRadius = agentRadius;
    const minNormalY = cos(maxSlope * DEG);
    // 1. the triangles that can be walked on, cut small if asked
    let tris = [];
    for (let t = 0; t < indices.length; t += 3) {
      const a = indices[t] * 3, b = indices[t + 1] * 3, c = indices[t + 2] * 3;
      if (!(a >= 0 && b >= 0 && c >= 0 && a < vertices.length && b < vertices.length && c < vertices.length)) throw new Error(`triangle ${t / 3} uses a vertex that does not exist`);
      tris.push([vertices[a], vertices[a + 1], vertices[a + 2], vertices[b], vertices[b + 1], vertices[b + 2], vertices[c], vertices[c + 1], vertices[c + 2]]);
    }
    if (maxEdge < Infinity) tris = subdivide(tris, maxEdge);
    // 2. weld the corners, keep the walkable triangles and wind them all the same way round (seen from above)
    const quant = 1 / weld, vmap = new Map(), vx = [], vy = [], vz = [], tri = [];
    const vertexOf = (x, y, z) => {
      const key = `${Math.round(x * quant)},${Math.round(y * quant)},${Math.round(z * quant)}`;
      let i = vmap.get(key);
      if (i === undefined) { i = vx.length; vmap.set(key, i); vx.push(x); vy.push(y); vz.push(z); }
      return i;
    };
    for (const t of tris) {
      const e1x = t[3] - t[0], e1y = t[4] - t[1], e1z = t[5] - t[2], e2x = t[6] - t[0], e2y = t[7] - t[1], e2z = t[8] - t[2];
      const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x, len = Math.sqrt(nx * nx + ny * ny + nz * nz);
      if (len < EPS) continue;
      if (ny / len < minNormalY) continue;                              // too steep, a wall, or a ceiling (facing down)
      const a = vertexOf(t[0], t[1], t[2]);
      let b = vertexOf(t[3], t[4], t[5]), c = vertexOf(t[6], t[7], t[8]);
      if (a === b || b === c || a === c) continue;
      if (cross2(vx[b] - vx[a], vz[b] - vz[a], vx[c] - vx[a], vz[c] - vz[a]) < 0) { const s = b; b = c; c = s; }
      tri.push(a, b, c);
    }
    const n = tri.length / 3;
    this.count = n;
    this.vx = Float64Array.from(vx); this.vy = Float64Array.from(vy); this.vz = Float64Array.from(vz);
    this.tri = Int32Array.from(tri);
    // 3. neighbours: triangles that share an edge
    this.nbr = new Int32Array(n * 3).fill(-1);
    const edges = new Map();
    for (let p = 0; p < n; p++) {
      for (let e = 0; e < 3; e++) {
        const a = this.tri[p * 3 + e], b = this.tri[p * 3 + (e + 1) % 3];
        const key = a < b ? a * 4294967296 + b : b * 4294967296 + a;
        const other = edges.get(key);
        if (other === undefined) edges.set(key, p * 3 + e);
        else if (this.nbr[other] < 0) { this.nbr[other] = p; this.nbr[p * 3 + e] = Math.floor(other / 3); edges.delete(key); }
      }
    }
    // 4. a grid over the triangles, to find the one under a point quickly
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity, edgeSum = 0;
    for (let i = 0; i < this.vx.length; i++) {
      if (this.vx[i] < minX) minX = this.vx[i]; if (this.vx[i] > maxX) maxX = this.vx[i];
      if (this.vz[i] < minZ) minZ = this.vz[i]; if (this.vz[i] > maxZ) maxZ = this.vz[i];
    }
    for (let p = 0; p < n; p++) for (let e = 0; e < 3; e++) { const a = this.tri[p * 3 + e], b = this.tri[p * 3 + (e + 1) % 3]; edgeSum += hyp(this.vx[a] - this.vx[b], this.vz[a] - this.vz[b]); }
    this.minX = n ? minX : 0; this.minZ = n ? minZ : 0; this.maxX = n ? maxX : 0; this.maxZ = n ? maxZ : 0;
    this.cell = n ? Math.max(edgeSum / (3 * n) * 2, 1e-3, Math.max(maxX - minX, maxZ - minZ) / 512) : 1;
    this.cols = n ? Math.floor((maxX - minX) / this.cell) + 1 : 1; this.rows = n ? Math.floor((maxZ - minZ) / this.cell) + 1 : 1;
    const cells = new Array(this.cols * this.rows);
    for (let p = 0; p < n; p++) {
      const [x0, z0, x1, z1] = this.#bounds(p);
      const c0 = Math.floor((x0 - this.minX) / this.cell), c1 = Math.floor((x1 - this.minX) / this.cell), r0 = Math.floor((z0 - this.minZ) / this.cell), r1 = Math.floor((z1 - this.minZ) / this.cell);
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) (cells[r * this.cols + c] ??= []).push(p);
    }
    this.cells = cells;
    // 5. what can change while the game runs
    /** Number of obstacles covering each triangle; above zero it cannot be entered. */
    this.blocked = new Int16Array(n);
    /** The kind of ground of each triangle (0 = normal); each kind costs `areaCost[kind]` times as much to cross. */
    this.area = new Uint8Array(n);
    this.areaCost = new Float32Array(32).fill(1);
    this.version = 0;
    this.obstacles = new Map(); this.nextObstacle = 1;
    this.areas = [];
    /** For each vertex, whether a wall (an edge with nothing walkable beyond it) touches it: paths keep the agent's radius away from these. */
    this.corner = new Uint8Array(this.vx.length);
    this.awayX = new Float64Array(this.vx.length); this.awayZ = new Float64Array(this.vx.length);
    this.#updateCorners();
    this.heap = new Heap();
    this.g = new Float64Array(n); this.parent = new Int32Array(n); this.state = new Int32Array(n); this.stamp = 0;
    this.ex = new Float64Array(n); this.ey = new Float64Array(n); this.ez = new Float64Array(n);
  }

  // ---------------------------------------------------------------- geometry
  #bounds(p) {
    const a = this.tri[p * 3], b = this.tri[p * 3 + 1], c = this.tri[p * 3 + 2];
    return [Math.min(this.vx[a], this.vx[b], this.vx[c]), Math.min(this.vz[a], this.vz[b], this.vz[c]), Math.max(this.vx[a], this.vx[b], this.vx[c]), Math.max(this.vz[a], this.vz[b], this.vz[c])];
  }

  /** The corners of a triangle's edge `e` (the edge from corner e to corner e + 1, both vertex numbers). */
  edge(p, e) { return [this.tri[p * 3 + e], this.tri[p * 3 + (e + 1) % 3]]; }

  /** Whether (x, z) is over triangle p. */
  contains(p, x, z) {
    const t = this.tri, vx = this.vx, vz = this.vz;
    for (let e = 0; e < 3; e++) {
      const a = t[p * 3 + e], b = t[p * 3 + (e + 1) % 3];
      if (cross2(vx[b] - vx[a], vz[b] - vz[a], x - vx[a], z - vz[a]) < -1e-9) return false;
    }
    return true;
  }

  /** The height of triangle p at (x, z). */
  heightAt(p, x, z) {
    const t = this.tri, a = t[p * 3], b = t[p * 3 + 1], c = t[p * 3 + 2], vx = this.vx, vy = this.vy, vz = this.vz;
    const d = cross2(vx[b] - vx[a], vz[b] - vz[a], vx[c] - vx[a], vz[c] - vz[a]);
    if (Math.abs(d) < EPS) return vy[a];
    const u = cross2(x - vx[a], z - vz[a], vx[c] - vx[a], vz[c] - vz[a]) / d, v = cross2(vx[b] - vx[a], vz[b] - vz[a], x - vx[a], z - vz[a]) / d;
    return vy[a] + u * (vy[b] - vy[a]) + v * (vy[c] - vy[a]);
  }

  /** The point of triangle p nearest to (x, z), as [x, z]. */
  #closestInTriangle(p, x, z) {
    if (this.contains(p, x, z)) return [x, z];
    let best = null, bd = Infinity;
    for (let e = 0; e < 3; e++) {
      const a = this.tri[p * 3 + e], b = this.tri[p * 3 + (e + 1) % 3];
      const ax = this.vx[a], az = this.vz[a], dx = this.vx[b] - ax, dz = this.vz[b] - az, l2 = dx * dx + dz * dz;
      const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)) : 0;
      const px = ax + dx * t, pz = az + dz * t, d = (x - px) * (x - px) + (z - pz) * (z - pz);
      if (d < bd) { bd = d; best = [px, pz]; }
    }
    return best;
  }

  /**
   * The triangle under a point: the one whose surface at (x, z) is nearest to height y, within `maxDy` (so a bridge and the ground under it are told apart). -1 if there is none.
   * @param {number} [maxDy]
   */
  polyAt(x, y, z, maxDy = Infinity) {
    const c = Math.floor((x - this.minX) / this.cell), r = Math.floor((z - this.minZ) / this.cell);
    if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) return -1;
    const list = this.cells[r * this.cols + c];
    let best = -1, bd = maxDy;
    if (list) for (const p of list) {
      if (!this.contains(p, x, z)) continue;
      const d = Math.abs(this.heightAt(p, x, z) - y);
      if (d <= bd) { bd = d; best = p; }
    }
    return best;
  }

  /**
   * The nearest place on the mesh to a point (not counting blocked triangles unless `blocked`), looking up to `radius` away.
   * @returns {{poly: number, x: number, y: number, z: number, distance: number} | null}
   */
  nearest(x, y, z, radius = 2, blocked = false) {
    const c0 = Math.max(0, Math.floor((x - radius - this.minX) / this.cell)), c1 = Math.min(this.cols - 1, Math.floor((x + radius - this.minX) / this.cell));
    const r0 = Math.max(0, Math.floor((z - radius - this.minZ) / this.cell)), r1 = Math.min(this.rows - 1, Math.floor((z + radius - this.minZ) / this.cell));
    let best = null, bd = radius * radius;
    const seen = new Set();
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
      const list = this.cells[r * this.cols + c];
      if (!list) continue;
      for (const p of list) {
        if (seen.has(p) || (!blocked && this.blocked[p] > 0)) continue;
        seen.add(p);
        const [px, pz] = this.#closestInTriangle(p, x, z), py = this.heightAt(p, px, pz);
        const d = (px - x) * (px - x) + (pz - z) * (pz - z) + (py - y) * (py - y);
        if (d < bd || (d === bd && best && p < best.poly)) { bd = d; best = { poly: p, x: px, y: py, z: pz, distance: Math.sqrt(d) }; }
      }
    }
    return best;
  }

  /** A point on the mesh chosen with `random()` (a function giving numbers from 0 up to 1; pass your game's seeded generator) from a triangle that is not blocked, or null. */
  randomPoint(random) {
    let total = 0;
    const areas = new Float64Array(this.count);
    for (let p = 0; p < this.count; p++) {
      if (this.blocked[p] > 0) continue;
      const a = this.tri[p * 3], b = this.tri[p * 3 + 1], c = this.tri[p * 3 + 2];
      total += 0.5 * Math.abs(cross2(this.vx[b] - this.vx[a], this.vz[b] - this.vz[a], this.vx[c] - this.vx[a], this.vz[c] - this.vz[a]));
      areas[p] = total;
    }
    if (total <= 0) return null;
    const pick = random() * total;
    let lo = 0, hi = this.count - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (areas[mid] > pick) hi = mid; else lo = mid + 1; }
    const p = lo, a = this.tri[p * 3], b = this.tri[p * 3 + 1], c = this.tri[p * 3 + 2];
    let u = random(), v = random();
    if (u + v > 1) { u = 1 - u; v = 1 - v; }
    const x = this.vx[a] + u * (this.vx[b] - this.vx[a]) + v * (this.vx[c] - this.vx[a]), z = this.vz[a] + u * (this.vz[b] - this.vz[a]) + v * (this.vz[c] - this.vz[a]);
    return { poly: p, x, y: this.heightAt(p, x, z), z };
  }

  // ---------------------------------------------------------------- obstacles and kinds of ground
  /** Which triangles a shape touches: a box {minX, maxX, minZ, maxZ} or a circle {x, z, radius} on the ground, within the heights minY..maxY. */
  #touching(shape) {
    const out = [];
    for (let p = 0; p < this.count; p++) {
      const a = this.tri[p * 3], b = this.tri[p * 3 + 1], c = this.tri[p * 3 + 2];
      const lo = Math.min(this.vy[a], this.vy[b], this.vy[c]), hi = Math.max(this.vy[a], this.vy[b], this.vy[c]);
      if (hi < shape.minY || lo > shape.maxY) continue;
      const hit = shape.radius !== undefined ? triangleTouchesCircle(this, p, shape.x, shape.z, shape.radius) : triangleTouchesBox(this, p, shape.minX, shape.minZ, shape.maxX, shape.maxZ);
      if (hit) out.push(p);
    }
    return out;
  }

  #updateCorners() {
    this.corner.fill(0); this.awayX.fill(0); this.awayZ.fill(0);
    for (let p = 0; p < this.count; p++) {
      for (let e = 0; e < 3; e++) {
        const n = this.nbr[p * 3 + e];
        if (this.blocked[p] === 0 && (n < 0 || this.blocked[n] > 0)) {
          const a = this.tri[p * 3 + e], b = this.tri[p * 3 + (e + 1) % 3];
          const dx = this.vx[b] - this.vx[a], dz = this.vz[b] - this.vz[a], l = hyp(dx, dz) || 1;
          const nx = -dz / l, nz = dx / l;                                // into the triangle (the mesh is wound so that the inside is to the left of a -> b)
          for (const v of [a, b]) { this.corner[v] = 1; this.awayX[v] += nx; this.awayZ[v] += nz; }
        }
      }
    }
  }

  #change() { this.#updateCorners(); this.version++; }

  /**
   * Block everything inside a box (a crate, a barricade, a closed door) so paths go round. Triangles the box touches cannot be entered, so cut big triangles smaller with `maxEdge`
   * when you build the mesh to keep the blocked patch close to the shape. Returns a number for `unblock`.
   * @param {number} margin Make the box this much bigger on every side
   */
  block(minX, minY, minZ, maxX, maxY, maxZ, margin = 0) {
    const shape = { minX: minX - margin, minY, minZ: minZ - margin, maxX: maxX + margin, maxY, maxZ: maxZ + margin };
    return this.#addObstacle(shape);
  }

  /** Block a circle on the ground (a pillar, a stopped vehicle) between two heights. Returns a number for `unblock`. */
  blockCircle(x, z, radius, minY = -Infinity, maxY = Infinity) { return this.#addObstacle({ x, z, radius, minY, maxY }); }

  #addObstacle(shape) {
    const id = this.nextObstacle++, polys = this.#touching(shape);
    for (const p of polys) this.blocked[p]++;
    this.obstacles.set(id, polys);
    this.#change();
    return id;
  }

  /** Take an obstacle away. */
  unblock(id) {
    const polys = this.obstacles.get(id);
    if (!polys) return;
    for (const p of polys) this.blocked[p]--;
    this.obstacles.delete(id);
    this.#change();
  }

  /** Mark the ground inside a box as a kind (0 normal; give a kind a cost with `areaCost[kind] = 3` for mud, water, a road to keep to). */
  setArea(minX, minY, minZ, maxX, maxY, maxZ, kind) {
    for (const p of this.#touching({ minX, minY, minZ, maxX, maxY, maxZ })) this.area[p] = kind;
    this.version++;
  }

  // ---------------------------------------------------------------- paths
  #cost(p) { return this.areaCost[this.area[p]]; }

  /** The triangles from `start` to `goal`, found with A* (edge midpoints are the waypoints). */
  #corridor(startPoly, sx, sy, sz, goalPoly, gx, gy, gz, partial, maxNodes) {
    const { heap, g, parent, state, ex, ey, ez, tri, nbr, vx, vy, vz } = this;
    const stamp = ++this.stamp;
    heap.clear();
    state.fill(0);
    g[startPoly] = 0; parent[startPoly] = -1; state[startPoly] = 1; ex[startPoly] = sx; ey[startPoly] = sy; ez[startPoly] = sz;
    heap.push(hyp(gx - sx, gy - sy, gz - sz), startPoly);
    let best = startPoly, bestD = hyp(gx - sx, gy - sy, gz - sz), nodes = 0;
    void stamp;
    while (heap.size > 0) {
      const p = heap.pop();
      if (state[p] === 2) continue;
      state[p] = 2;
      if (p === goalPoly) return this.#unwind(p);
      if (++nodes > maxNodes) break;
      const dh = hyp(gx - ex[p], gy - ey[p], gz - ez[p]);
      if (dh < bestD) { bestD = dh; best = p; }
      for (let e = 0; e < 3; e++) {
        const n = nbr[p * 3 + e];
        if (n < 0 || this.blocked[n] > 0 || state[n] === 2) continue;
        const a = tri[p * 3 + e], b = tri[p * 3 + (e + 1) % 3];
        // where to cross the edge: on the straight line from the way in to the goal if that meets the edge, else at the nearer end (this keeps corridors close to the true shortest route)
        const ax = vx[a], az = vz[a], bx = vx[b], bz = vz[b], dx = bx - ax, dz = bz - az;
        const lx = gx - ex[p], lz = gz - ez[p], den = cross2(dx, dz, lx, lz);
        let t = 0.5;
        if (Math.abs(den) > 1e-12) { const tt = cross2(ex[p] - ax, ez[p] - az, lx, lz) / den; t = tt < 0 ? 0 : tt > 1 ? 1 : tt; }
        else t = (ex[p] - ax) * dx + (ez[p] - az) * dz > 0 ? 1 : 0;
        if (t === 0 || t === 1) {                                         // no crossing on the edge: the end that makes the shorter trip
          const da = hyp(ax - ex[p], az - ez[p]) + hyp(gx - ax, gz - az), db = hyp(bx - ex[p], bz - ez[p]) + hyp(gx - bx, gz - bz);
          t = da <= db ? 0 : 1;
        }
        const mx = ax + dx * t, my = vy[a] + (vy[b] - vy[a]) * t, mz = az + dz * t;
        const cost = g[p] + hyp(mx - ex[p], my - ey[p], mz - ez[p]) * this.#cost(p);
        if (state[n] === 1 && cost >= g[n]) continue;
        g[n] = cost; parent[n] = p; state[n] = 1; ex[n] = mx; ey[n] = my; ez[n] = mz;
        heap.push(cost + hyp(gx - mx, gy - my, gz - mz) * 0.999, n);
      }
    }
    if (partial && best !== startPoly) return this.#unwind(best, true);
    if (partial) return { polys: [startPoly], partial: true };
    return null;
  }

  #unwind(last, partial = false) {
    const polys = [];
    for (let p = last; p >= 0; p = this.parent[p]) polys.push(p);
    polys.reverse();
    return { polys, partial };
  }

  /**
   * The shortest walk from one place to another, held off the corners of walls by the agent's radius.
   * @param {{x: number, y: number, z: number}} from
   * @param {{x: number, y: number, z: number}} to
   * @param {object} [o]
   * @param {number} [o.radius] Distance to keep from corners (default: the mesh's `agentRadius`).
   * @param {boolean} [o.partial] When the goal cannot be reached, go as near as possible instead of failing.
   * @param {number} [o.snap] How far from the mesh the start and goal may be and still count (2 metres).
   * @param {number} [o.maxNodes] Give up after looking at this many triangles (100000).
   * @param {boolean} [o.smooth] Cut out corners that a straight walk the width of the agent can skip (default true): the corridor search is close to the shortest route but not exact.
   * @returns {NavPath}
   */
  findPath(from, to, { radius = this.agentRadius, partial = false, snap = 2, maxNodes = 100000, smooth = true } = {}) {
    const none = { found: false, partial: false, points: [], polys: [], length: 0 };
    const s = this.nearest(from.x, from.y, from.z, snap), e = this.nearest(to.x, to.y, to.z, snap, true);
    if (!s || !e) return none;
    const goalBlocked = this.blocked[e.poly] > 0;
    let end = e;
    if (goalBlocked) { const alt = this.nearest(to.x, to.y, to.z, snap); if (!alt) return none; end = alt; }
    const result = s.poly === end.poly ? { polys: [s.poly], partial: false } : this.#corridor(s.poly, s.x, s.y, s.z, end.poly, end.x, end.y, end.z, partial, maxNodes);
    if (!result) return none;
    const polys = result.polys;
    const last = polys[polys.length - 1];
    const goal = result.partial || goalBlocked ? (() => { const [cx, cz] = this.#closestInTriangle(last, end.x, end.z); return { x: cx, y: this.heightAt(last, cx, cz), z: cz }; })() : end;
    let points = this.#funnel(polys, s, goal, radius);
    if (smooth && points.length > 6) points = this.#shorten(points, radius);
    let length = 0;
    for (let i = 3; i < points.length; i += 3) length += hyp(points[i] - points[i - 3], points[i + 1] - points[i - 2], points[i + 2] - points[i - 1]);
    return { found: !(result.partial || goalBlocked), partial: !!(result.partial || goalBlocked), points, polys, length };
  }

  /** String pulling: the shortest line through a corridor of triangles, as x, y, z corners. */
  #funnel(polys, start, goal, radius) {
    const portals = [];                                                  // each: [leftX, leftY, leftZ, rightX, rightY, rightZ]
    portals.push([start.x, start.y, start.z, start.x, start.y, start.z, -1, -1]);
    for (let i = 0; i + 1 < polys.length; i++) {
      const p = polys[i], q = polys[i + 1];
      let e = 0;
      while (e < 3 && this.nbr[p * 3 + e] !== q) e++;
      const ra = this.tri[p * 3 + e], la = this.tri[p * 3 + (e + 1) % 3];  // the edge runs right -> left as seen walking out of p
      portals.push([this.vx[la], this.vy[la], this.vz[la], this.vx[ra], this.vy[ra], this.vz[ra], la, ra]);
    }
    portals.push([goal.x, goal.y, goal.z, goal.x, goal.y, goal.z, -1, -1]);
    const out = [start.x, start.y, start.z], ids = [-1];
    const add = (q, id) => { const n = out.length; if (out[n - 3] !== q[0] || out[n - 2] !== q[1] || out[n - 1] !== q[2]) { out.push(q[0], q[1], q[2]); ids.push(id); } };   // (a corner can be met twice)
    let apex = [start.x, start.y, start.z], left = [start.x, start.y, start.z], right = [start.x, start.y, start.z];
    let apexIndex = 0, leftIndex = 0, rightIndex = 0;
    for (let i = 1; i < portals.length; i++) {
      const pl = [portals[i][0], portals[i][1], portals[i][2]], pr = [portals[i][3], portals[i][4], portals[i][5]];
      // move the right side in
      if (cross2(right[0] - apex[0], right[2] - apex[2], pr[0] - apex[0], pr[2] - apex[2]) >= 0) {
        if (same(apex, right) || cross2(left[0] - apex[0], left[2] - apex[2], pr[0] - apex[0], pr[2] - apex[2]) < 0) { right = pr; rightIndex = i; }
        else {                                                           // the right side has crossed the left: the left corner becomes a turn
          add(left, portals[leftIndex][6]);
          apex = left; apexIndex = leftIndex; left = apex; right = apex; leftIndex = rightIndex = apexIndex;
          i = apexIndex;
          continue;
        }
      }
      // move the left side in
      if (cross2(left[0] - apex[0], left[2] - apex[2], pl[0] - apex[0], pl[2] - apex[2]) <= 0) {
        if (same(apex, left) || cross2(right[0] - apex[0], right[2] - apex[2], pl[0] - apex[0], pl[2] - apex[2]) > 0) { left = pl; leftIndex = i; }
        else {
          add(right, portals[rightIndex][7]);
          apex = right; apexIndex = rightIndex; left = apex; right = apex; leftIndex = rightIndex = apexIndex;
          i = apexIndex;
          continue;
        }
      }
    }
    if (out[out.length - 3] !== goal.x || out[out.length - 2] !== goal.y || out[out.length - 1] !== goal.z) { out.push(goal.x, goal.y, goal.z); ids.push(-1); }
    return this.#offsetCorners(out, ids, radius);
  }

  /** Whether an agent `radius` wide can walk straight from one point to another: three straight walks, down the middle and a radius to each side, all stay on the mesh. */
  #fatVisible(ax, ay, az, bx, bz, radius) {
    const dx = bx - ax, dz = bz - az, len = hyp(dx, dz);
    if (len < 1e-9) return true;
    const nx = -dz / len, nz = dx / len;
    for (const off of radius > 0 ? [0, radius, -radius] : [0]) {
      const sx = ax + nx * off, sz = az + nz * off, tx = bx + nx * off, tz = bz + nz * off;
      const poly = this.polyAt(sx, ay, sz, 1);
      if (poly < 0 || this.blocked[poly] > 0) return false;
      const r = this.move(poly, sx, sz, tx, tz);
      if (r.hit || Math.abs(r.x - tx) > 1e-6 || Math.abs(r.z - tz) > 1e-6) return false;
    }
    return true;
  }

  /** Whether an agent `radius` wide standing at (x, y, z) can walk straight to (tx, tz) without a wall in the way (see `isVisible` for a point-sized one). */
  canWalk(x, y, z, tx, tz, radius = this.agentRadius) { return this.#fatVisible(x, y, z, tx, tz, radius); }

  /** Drop the corners of a path that the agent can walk straight past. */
  #shorten(points, radius) {
    const n = points.length / 3, out = [points[0], points[1], points[2]];
    let i = 0;
    while (i < n - 1) {
      let j = n - 1;
      while (j > i + 1 && !this.#fatVisible(points[i * 3], points[i * 3 + 1], points[i * 3 + 2], points[j * 3], points[j * 3 + 2], radius)) j--;
      out.push(points[j * 3], points[j * 3 + 1], points[j * 3 + 2]);
      i = j;
    }
    return out;
  }

  /**
   * Move each corner of a path that is the corner of a wall away from it, along the way the wall faces, until both straight stretches beside it pass at least `radius` away.
   * A few passes, since moving one corner changes the line to the next.
   */
  #offsetCorners(points, ids, radius) {
    if (!(radius > 0)) return points;
    const count = ids.length, raw = points.slice();
    for (let pass = 0; pass < 4; pass++) {
      for (let k = 1; k + 1 < count; k++) {
        const v = ids[k];
        if (v < 0 || this.corner[v] === 0) continue;
        let ux = this.awayX[v], uz = this.awayZ[v];
        const ul = hyp(ux, uz);
        if (ul < 1e-9) continue;
        ux /= ul; uz /= ul;
        const x = raw[k * 3], z = raw[k * 3 + 2];
        let d = radius;
        for (const q of [k - 1, k + 1]) {
          // the line from this corner (where it is now) to its neighbour, and how far the wall's corner is from it
          const cx = points[k * 3], cz = points[k * 3 + 2], tx = points[q * 3] - cx, tz = points[q * 3 + 2] - cz, tl = hyp(tx, tz);
          if (tl < 1e-9) continue;
          const c = Math.abs(cross2(tx / tl, tz / tl, ux, uz));
          d = Math.max(d, c > 0.2 ? radius / c : radius * 5);
        }
        d = Math.min(d * 1.01, radius * 5);
        for (; d > 1e-3; d *= 0.7) {                                    // the nearest spot on the mesh if that one is not
          const px = x + ux * d, pz = z + uz * d, poly = this.polyAt(px, raw[k * 3 + 1], pz, 1);
          if (poly >= 0 && this.blocked[poly] === 0) { points[k * 3] = px; points[k * 3 + 2] = pz; points[k * 3 + 1] = this.heightAt(poly, px, pz); break; }
        }
      }
    }
    return points;
  }

  // ---------------------------------------------------------------- moving over the mesh
  /**
   * Move along the surface from a place in triangle `poly` toward (tx, tz): the walk passes from triangle to triangle and slides along a wall it meets instead of passing through.
   * @returns {{poly: number, x: number, y: number, z: number, hit: boolean}} where it ended up; `hit` says a wall stopped it
   */
  move(poly, x, z, tx, tz) {
    let p = poly, cx = x, cz = z, hit = false, slid = false;
    for (let guard = 0; guard < 64; guard++) {
      const dx = tx - cx, dz = tz - cz;
      if (dx * dx + dz * dz < 1e-18) break;
      // the first edge of p that the line from (cx, cz) to (tx, tz) leaves through
      let exit = -1, exitT = 1;
      for (let e = 0; e < 3; e++) {
        const a = this.tri[p * 3 + e], b = this.tri[p * 3 + (e + 1) % 3];
        const ax = this.vx[a], az = this.vz[a], ex = this.vx[b] - ax, ez = this.vz[b] - az;
        const sCur = cross2(ex, ez, cx - ax, cz - az), sTar = cross2(ex, ez, tx - ax, tz - az);   // positive is inside
        if (sTar >= -1e-12 || sCur < sTar) continue;                    // the target is on the inside of this edge
        const t = sCur / (sCur - sTar);
        if (t < exitT || exit < 0) { exitT = Math.max(0, t); exit = e; }
      }
      if (exit < 0) { cx = tx; cz = tz; break; }                         // the target is inside p
      const n = this.nbr[p * 3 + exit];
      cx += dx * exitT; cz += dz * exitT;
      if (n >= 0 && this.blocked[n] === 0) { p = n; continue; }
      hit = true;                                                        // a wall: slide along the edge
      if (slid) break;
      slid = true;
      const a = this.tri[p * 3 + exit], b = this.tri[p * 3 + (exit + 1) % 3];
      let ex = this.vx[b] - this.vx[a], ez = this.vz[b] - this.vz[a];
      const el = hyp(ex, ez) || 1; ex /= el; ez /= el;
      const rest = (tx - cx) * ex + (tz - cz) * ez;
      tx = cx + ex * rest; tz = cz + ez * rest;
    }
    if (!this.contains(p, cx, cz)) { const [px, pz] = this.#closestInTriangle(p, cx, cz); cx = px; cz = pz; }
    return { poly: p, x: cx, y: this.heightAt(p, cx, cz), z: cz, hit };
  }

  /**
   * Walk a straight line over the mesh from a point to another and report where a wall stops it, if one does.
   * @returns {{hit: boolean, t: number, x: number, y: number, z: number, poly: number}} `t` is how far along the line (0 to 1) it got
   */
  raycast(from, to) {
    const s = this.nearest(from.x, from.y, from.z, 1);
    if (!s) return { hit: true, t: 0, x: from.x, y: from.y, z: from.z, poly: -1 };
    const r = this.move(s.poly, s.x, s.z, to.x, to.z);
    const total = hyp(to.x - s.x, to.z - s.z), got = hyp(r.x - s.x, r.z - s.z);
    const reached = total < 1e-12 || (Math.abs(r.x - to.x) < 1e-7 && Math.abs(r.z - to.z) < 1e-7);
    return { hit: !reached, t: reached ? 1 : got / total, x: r.x, y: r.y, z: r.z, poly: r.poly };
  }

  /** Whether a straight walk between two points is free of walls (the path can be shortened to it). */
  isVisible(from, to) { return !this.raycast(from, to).hit; }
}

const same = (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

/** Cut every triangle with a side longer than `maxEdge` into four by its edge midpoints, again and again until all are short. */
function subdivide(tris, maxEdge) {
  const out = [], stack = [...tris].reverse();
  while (stack.length > 0) {
    const t = stack.pop();
    const l = [hyp(t[3] - t[0], t[4] - t[1], t[5] - t[2]), hyp(t[6] - t[3], t[7] - t[4], t[8] - t[5]), hyp(t[0] - t[6], t[1] - t[7], t[2] - t[8])];
    if (Math.max(l[0], l[1], l[2]) <= maxEdge || stack.length > 4000000) { out.push(t); continue; }
    const m = (i, j) => [(t[i] + t[j]) / 2, (t[i + 1] + t[j + 1]) / 2, (t[i + 2] + t[j + 2]) / 2];
    const ab = m(0, 3), bc = m(3, 6), ca = m(6, 0);
    const A = [t[0], t[1], t[2]], B = [t[3], t[4], t[5]], C = [t[6], t[7], t[8]];
    stack.push([...ca, ...bc, ...C], [...ab, ...B, ...bc], [...A, ...ab, ...ca], [...ab, ...bc, ...ca]);
  }
  return out;
}

function triangleTouchesCircle(m, p, cx, cz, r) {
  if (m.contains(p, cx, cz)) return true;
  for (let e = 0; e < 3; e++) {
    const a = m.tri[p * 3 + e], b = m.tri[p * 3 + (e + 1) % 3];
    const ax = m.vx[a], az = m.vz[a], dx = m.vx[b] - ax, dz = m.vz[b] - az, l2 = dx * dx + dz * dz;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((cx - ax) * dx + (cz - az) * dz) / l2)) : 0;
    const px = ax + dx * t - cx, pz = az + dz * t - cz;
    if (px * px + pz * pz <= r * r) return true;
  }
  return false;
}

/** Triangle against an axis-aligned box on the ground (separating axes: the box's two and the triangle's three edges' normals). */
function triangleTouchesBox(m, p, x0, z0, x1, z1) {
  const px = [], pz = [];
  for (let k = 0; k < 3; k++) { px.push(m.vx[m.tri[p * 3 + k]]); pz.push(m.vz[m.tri[p * 3 + k]]); }
  if (Math.max(...px) <= x0 + 1e-9 || Math.min(...px) >= x1 - 1e-9 || Math.max(...pz) <= z0 + 1e-9 || Math.min(...pz) >= z1 - 1e-9) return false;   // touching along an edge is not covering
  const bx = [x0, x1, x1, x0], bz = [z0, z0, z1, z1];
  for (let e = 0; e < 3; e++) {
    const nx = -(pz[(e + 1) % 3] - pz[e]), nz = px[(e + 1) % 3] - px[e];
    let tmin = Infinity, tmax = -Infinity, bmin = Infinity, bmax = -Infinity;
    for (let k = 0; k < 3; k++) { const d = nx * px[k] + nz * pz[k]; tmin = Math.min(tmin, d); tmax = Math.max(tmax, d); }
    for (let k = 0; k < 4; k++) { const d = nx * bx[k] + nz * bz[k]; bmin = Math.min(bmin, d); bmax = Math.max(bmax, d); }
    if (tmax <= bmin + 1e-9 || bmax <= tmin + 1e-9) return false;
  }
  return true;
}
