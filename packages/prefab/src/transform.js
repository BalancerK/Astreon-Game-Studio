// Parent-child transforms: a child's world position, rotation and scale from its parent's world transform and its own local one.
// Deterministic maths only (+ - * / and sqrt).
import { Transform, Parent, LocalTransform } from './components.js';

/** parent (world) composed with local, into `out` ({x, y, z, qx.., sx..}). `pw` is the Transform component's data and `pi` the parent's slot. */
export function composeTransform(out, pw, pi, l) {
  const pqx = pw.qx[pi], pqy = pw.qy[pi], pqz = pw.qz[pi], pqw = pw.qw[pi];
  // rotate the local position (scaled by the parent's scale) by the parent's rotation: v' = v + 2w(q x v) + 2 q x (q x v)
  const vx = l.x * pw.sx[pi], vy = l.y * pw.sy[pi], vz = l.z * pw.sz[pi];
  const tx = 2 * (pqy * vz - pqz * vy), ty = 2 * (pqz * vx - pqx * vz), tz = 2 * (pqx * vy - pqy * vx);
  out.x = pw.x[pi] + vx + pqw * tx + (pqy * tz - pqz * ty);
  out.y = pw.y[pi] + vy + pqw * ty + (pqz * tx - pqx * tz);
  out.z = pw.z[pi] + vz + pqw * tz + (pqx * ty - pqy * tx);
  out.qx = pqw * l.qx + pqx * l.qw + pqy * l.qz - pqz * l.qy;
  out.qy = pqw * l.qy - pqx * l.qz + pqy * l.qw + pqz * l.qx;
  out.qz = pqw * l.qz + pqx * l.qy - pqy * l.qx + pqz * l.qw;
  out.qw = pqw * l.qw - pqx * l.qx - pqy * l.qy - pqz * l.qz;
  out.sx = pw.sx[pi] * l.sx; out.sy = pw.sy[pi] * l.sy; out.sz = pw.sz[pi] * l.sz;
  return out;
}

/** Keeps world `Transform`s of attached entities up to date from their `LocalTransform`s, parents before children. Call `update(world)` once per tick. */
export class TransformSystem {
  /** @param {number} [maxDepth] Deepest nesting looked at (a loop of parents stops there instead of hanging). */
  constructor(maxDepth = 32) {
    this.maxDepth = maxDepth;
    this.ids = new Uint32Array(0);
    this.depth = new Uint8Array(0);
    this.order = [];
    this.tmp = { x: 0, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1, sx: 1, sy: 1, sz: 1 };
    this.local = { x: 0, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1, sx: 1, sy: 1, sz: 1 };
  }

  /** @param {import('../../core/src/index.js').World} world @returns {number} how many entities were updated */
  update(world) {
    if (this.ids.length < world.capacity) { this.ids = new Uint32Array(world.capacity); this.depth = new Uint8Array(world.capacity); }
    const n = world.query(this.ids, [Parent, LocalTransform, Transform]);
    if (n === 0) return 0;
    const par = world.data(Parent).id, loc = world.data(LocalTransform), tr = world.data(Transform), depth = this.depth;
    for (let k = 0; k < n; k++) { // how deep each one is (how many parents above it)
      let d = 0, cur = this.ids[k];
      while (d < this.maxDepth && world.isAlive(par[cur & 0xfffff]) && world.has(cur, Parent)) { cur = par[cur & 0xfffff]; d++; }
      depth[this.ids[k] & 0xfffff] = d;
    }
    const order = this.order; order.length = 0;
    for (let k = 0; k < n; k++) order.push(this.ids[k]);
    order.sort((a, b) => depth[a & 0xfffff] - depth[b & 0xfffff] || (a & 0xfffff) - (b & 0xfffff));
    const t = this.tmp, l = this.local;
    for (const id of order) {
      const i = id & 0xfffff, p = par[i];
      if (!world.isAlive(p) || !world.has(p, Transform)) continue;
      l.x = loc.x[i]; l.y = loc.y[i]; l.z = loc.z[i]; l.qx = loc.qx[i]; l.qy = loc.qy[i]; l.qz = loc.qz[i]; l.qw = loc.qw[i]; l.sx = loc.sx[i]; l.sy = loc.sy[i]; l.sz = loc.sz[i];
      composeTransform(t, tr, p & 0xfffff, l);
      tr.x[i] = t.x; tr.y[i] = t.y; tr.z[i] = t.z; tr.qx[i] = t.qx; tr.qy[i] = t.qy; tr.qz[i] = t.qz; tr.qw[i] = t.qw; tr.sx[i] = t.sx; tr.sy[i] = t.sy; tr.sz[i] = t.sz;
    }
    return n;
  }
}
