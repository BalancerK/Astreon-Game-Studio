// A* over a NavGrid, resumable (spend a few hundred expansions per frame on each of many agents), with path smoothing.
// Only + - * / and sqrt; ties are broken by node number, so the same query always gives the same path.

const DX = [1, 1, 0, -1, -1, -1, 0, 1];
const DZ = [0, 1, 1, 1, 0, -1, -1, -1];

/** A binary min-heap of node numbers keyed by a float, in typed arrays that grow. */
class Heap {
  constructor(n) { this.keys = new Float64Array(n); this.items = new Int32Array(n); this.size = 0; }
  clear() { this.size = 0; }
  push(item, key) {
    if (this.size === this.keys.length) { const k = new Float64Array(this.size * 2), it = new Int32Array(this.size * 2); k.set(this.keys); it.set(this.items); this.keys = k; this.items = it; }
    let i = this.size++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.keys[p] < key || (this.keys[p] === key && this.items[p] <= item)) break;
      this.keys[i] = this.keys[p]; this.items[i] = this.items[p]; i = p;
    }
    this.keys[i] = key; this.items[i] = item;
  }
  pop() {
    const top = this.items[0], key = this.keys[--this.size], item = this.items[this.size];
    let i = 0;
    for (;;) {
      let c = 2 * i + 1;
      if (c >= this.size) break;
      if (c + 1 < this.size && (this.keys[c + 1] < this.keys[c] || (this.keys[c + 1] === this.keys[c] && this.items[c + 1] < this.items[c]))) c++;
      if (key < this.keys[c] || (key === this.keys[c] && item <= this.items[c])) break;
      this.keys[i] = this.keys[c]; this.items[i] = this.items[c]; i = c;
    }
    this.keys[i] = key; this.items[i] = item;
    return top;
  }
}

/** Search arrays (the size of the grid) are lent to a query while it runs, then taken back: many queries in flight each hold one, none allocate after warm-up. */
const pools = new WeakMap();
function acquire(nav) {
  let free = pools.get(nav);
  if (!free) pools.set(nav, free = []);
  while (free.length > 0) { const s = free.pop(); if (s.g.length >= nav.count) return s; }
  return { g: new Float32Array(nav.count), parent: new Int32Array(nav.count), stamp: new Uint32Array(nav.count), closed: new Uint32Array(nav.count), heap: new Heap(256), id: 0 };
}
function release(nav, s) { pools.get(nav)?.push(s); }

/**
 * @typedef {object} PathOptions
 * @property {number} [maxExpansions] Give up after expanding this many nodes (default 20000); the result is then the best partial path.
 * @property {boolean} [smooth] Pull the path straight where agents can walk in a line (default true).
 * @property {boolean} [partial] If the goal cannot be reached, return the path to the closest reachable node (default true).
 * @property {number} [searchRadius] Nearest-node search range in cells for the start and goal (6).
 */

/** One path request: `step(n)` expands up to n nodes, `status` is 'running', 'found', 'partial' or 'none'. */
export class PathQuery {
  /**
   * @param {import('./navgrid.js').NavGrid} nav
   * @param {{x: number, y: number, z: number}} from @param {{x: number, y: number, z: number}} to
   * @param {PathOptions} [o]
   */
  constructor(nav, from, to, o = {}) {
    this.nav = nav;
    this.from = { x: from.x, y: from.y, z: from.z }; this.to = { x: to.x, y: to.y, z: to.z };
    this.maxExpansions = o.maxExpansions ?? 20000;
    this.smooth = o.smooth ?? true; this.allowPartial = o.partial ?? true;
    this.expanded = 0;
    /** @type {'running' | 'found' | 'partial' | 'none'} */ this.status = 'running';
    /** The path as points from start to goal (once `status` is not 'running'). @type {{x: number, y: number, z: number}[]} */ this.path = [];
    /** Length of the path in metres. */ this.length = 0;
    this.version = nav.version;
    const radius = o.searchRadius ?? 6;
    this.start = nav.nearest(from.x, from.y, from.z, radius);
    this.goal = nav.nearest(to.x, to.y, to.z, radius);
    if (this.start < 0 || this.goal < 0) { this.status = 'none'; return; }
    const s = this.s = acquire(nav);
    this.stamp = ++s.id;
    s.heap.clear();
    s.g[this.start] = 0; s.parent[this.start] = -1; s.stamp[this.start] = this.stamp;
    s.heap.push(this.start, this.#h(this.start));
    this.best = this.start; this.bestH = this.#h(this.start);
    if (this.start === this.goal) this.#finish(true);
  }

  #h(n) { // octile distance on the ground, plus the climb
    const nav = this.nav, dx = Math.abs(nav.x[n] - nav.x[this.goal]), dz = Math.abs(nav.z[n] - nav.z[this.goal]), dy = Math.abs(nav.y[n] - nav.y[this.goal]);
    const a = dx > dz ? dx : dz, b = dx > dz ? dz : dx;
    return a + (Math.SQRT2 - 1) * b + dy * 0.5;
  }

  /** Expand up to `budget` nodes. Returns the status. */
  step(budget = 500) {
    if (this.status !== 'running') return this.status;
    const { nav, s } = this;
    const { heap, g, parent, stamp, closed } = s;
    let done = 0;
    while (heap.size > 0 && done < budget) {
      const n = heap.pop();
      if (closed[n] === this.stamp) continue;
      closed[n] = this.stamp;
      done++; this.expanded++;
      if (n === this.goal) { this.#finish(true); return this.status; }
      const h = this.#h(n);
      if (h < this.bestH) { this.bestH = h; this.best = n; }
      const gn = g[n];
      for (let d = 0; d < 8; d++) {
        const m = nav.adj[n * 8 + d];
        if (m < 0 || nav.blocked[m] > 0 || closed[m] === this.stamp) continue;
        const dy = nav.y[m] - nav.y[n], hx = nav.x[m] - nav.x[n], hz = nav.z[m] - nav.z[n];
        const horizontal = Math.sqrt(hx * hx + hz * hz);
        const step = Math.sqrt(horizontal * horizontal + dy * dy) * nav.areaCost[nav.area[m]] + (dy < -0.3 ? 0.3 : 0); // stepping off a ledge is a bit worse than walking
        this.#relax(n, m, gn + step);
      }
      const extra = nav.links.get(n);
      if (extra) for (let k = 0; k < extra.length; k += 2) { const m = extra[k]; if (nav.blocked[m] === 0 && closed[m] !== this.stamp) this.#relax(n, m, gn + extra[k + 1]); }
      if (this.expanded >= this.maxExpansions) break;
    }
    if (this.status === 'running' && (heap.size === 0 || this.expanded >= this.maxExpansions)) this.#finish(false);
    return this.status;
  }

  #relax(n, m, cost) {
    const { heap, g, parent, stamp } = this.s;
    if (stamp[m] === this.stamp && cost >= g[m]) return;
    stamp[m] = this.stamp; g[m] = cost; parent[m] = n;
    heap.push(m, cost + this.#h(m));
  }

  /** Give up on a running query (its search memory goes back to the pool). */
  cancel() { if (this.status === 'running') { this.status = 'none'; if (this.s) release(this.nav, this.s); } }

  #finish(reached) {
    const { nav, s } = this;
    let end = this.goal;
    if (!reached) {
      if (!this.allowPartial || this.best === this.start) { this.status = 'none'; release(nav, s); return; }
      end = this.best;
    }
    const nodes = [];
    for (let n = end; n >= 0; n = s.parent[n]) { nodes.push(n); if (n === this.start) break; }
    nodes.reverse();
    let pts = nodes;
    if (this.smooth && nodes.length > 2) pts = smoothNodes(nav, nodes);
    this.path = pts.map((n) => ({ x: nav.x[n], y: nav.y[n], z: nav.z[n] }));
    const first = this.path[0], f = this.from; // begin where the agent stands and (if reached) end exactly where asked, when that is within a cell of the node
    if (Math.abs(f.x - first.x) <= nav.cellSize && Math.abs(f.z - first.z) <= nav.cellSize) { first.x = f.x; first.z = f.z; }
    if (reached) {
      const last = this.path[this.path.length - 1], t = this.to;
      if (Math.abs(t.x - last.x) <= nav.cellSize && Math.abs(t.z - last.z) <= nav.cellSize) { last.x = t.x; last.z = t.z; }
    }
    this.length = 0;
    for (let i = 1; i < this.path.length; i++) { const a = this.path[i - 1], b = this.path[i]; this.length += Math.sqrt((b.x - a.x) * (b.x - a.x) + (b.y - a.y) * (b.y - a.y) + (b.z - a.z) * (b.z - a.z)); }
    this.status = reached ? 'found' : 'partial';
    release(nav, s);
  }
}

/** Drop the nodes of a path that a straight walk can skip: from each point, jump to the farthest one it can walk to in a line. */
export function smoothNodes(nav, nodes) {
  const out = [nodes[0]];
  let i = 0;
  while (i < nodes.length - 1) {
    let j = nodes.length - 1;
    // links that are not walking (jumps, teleports) must stay as they are
    const limit = Math.max(nav.areaCost[nav.area[nodes[i]]], nav.areaCost[nav.area[nodes[j]]]);
    while (j > i + 1 && !(nav.lineOfWalk(nodes[i], nodes[j], Math.max(limit, nav.areaCost[nav.area[nodes[i + 1]]])) && !hasSpecial(nav, nodes, i, j))) j--;
    out.push(nodes[j]);
    i = j;
  }
  return out;
}
function hasSpecial(nav, nodes, i, j) {
  if (nav.links.size === 0) return false;
  for (let k = i; k < j; k++) if (nav.links.has(nodes[k]) && !isNeighbour(nav, nodes[k], nodes[k + 1])) return true;
  return false;
}
function isNeighbour(nav, a, b) { for (let d = 0; d < 8; d++) if (nav.adj[a * 8 + d] === b) return true; return false; }

/**
 * Find a path, all at once.
 * @param {import('./navgrid.js').NavGrid} nav
 * @param {PathOptions} [o]
 * @returns {PathQuery} With `status`, `path` (points) and `length`.
 */
export function findPath(nav, from, to, o = {}) {
  const q = new PathQuery(nav, from, to, o);
  while (q.status === 'running') q.step(1000);
  return q;
}

/** Whether a path still looks valid: every node of it is still walkable and unblocked (after `nav.version` changed). */
export function pathIsClear(nav, path, from = 0) {
  for (let i = from; i < path.length; i++) {
    const n = nav.nearest(path[i].x, path[i].y, path[i].z, 1);
    if (n < 0) return false;
  }
  return true;
}

export const NEIGHBOURS = Object.freeze({ dx: DX, dz: DZ });
