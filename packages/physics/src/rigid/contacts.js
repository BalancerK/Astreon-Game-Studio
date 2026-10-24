// Contact generation between pairs of shapes. Every function fills a `Manifold` with a normal pointing from body A toward body B and up to
// four contact points with their penetration depth (the overlap along the normal, in metres). Only + - * / and sqrt.
import { boxBox, boxTriangle, closestSegments } from './sat.js';
import { closestPointOnTriangle } from '../sweep3d.js';

/**
 * The result of testing two shapes: a normal from body A towards body B and up to four contact points with their penetration
 * depth.
 */
export class Manifold {
  constructor() {
    this.n = 0;
    this.nx = 0; this.ny = 1; this.nz = 0;
    this.px = new Float64Array(4); this.py = new Float64Array(4); this.pz = new Float64Array(4); this.depth = new Float64Array(4);
  }
  clear() { this.n = 0; }
  setNormal(x, y, z) { this.nx = x; this.ny = y; this.nz = z; }
  add(x, y, z, depth) {
    if (this.n >= 4) return;
    const i = this.n++;
    this.px[i] = x; this.py[i] = y; this.pz[i] = z; this.depth[i] = depth;
  }
}

const RANK = { sphere: 0, capsule: 1, box: 2 };
const c = { nx: 0, ny: 0, nz: 0, px: 0, py: 0, pz: 0, depth: 0 }; // scratch contact
const cs = [0, 1, 2].map(() => ({ nx: 0, ny: 0, nz: 0, px: 0, py: 0, pz: 0, depth: 0, ok: false })); // up to three sphere tests per capsule

/** The capsule's two end-cap centres in world coordinates: out = [x0, y0, z0, x1, y1, z1]. */
export function capsuleEnds(b, out) {
  const r = b.r, h = b.shape.halfHeight, ax = r[1] * h, ay = r[4] * h, az = r[7] * h;
  out[0] = b.x - ax; out[1] = b.y - ay; out[2] = b.z - az; out[3] = b.x + ax; out[4] = b.y + ay; out[5] = b.z + az;
  return out;
}

/** A sphere against a box. The normal written into `out` points from the box to the sphere. @returns {boolean} */
function sphereBox(sx, sy, sz, sr, b, out) {
  const r = b.r, s = b.shape;
  const dx = sx - b.x, dy = sy - b.y, dz = sz - b.z;
  const lx = r[0] * dx + r[3] * dy + r[6] * dz, ly = r[1] * dx + r[4] * dy + r[7] * dz, lz = r[2] * dx + r[5] * dy + r[8] * dz;
  const qx = lx < -s.hx ? -s.hx : lx > s.hx ? s.hx : lx, qy = ly < -s.hy ? -s.hy : ly > s.hy ? s.hy : ly, qz = lz < -s.hz ? -s.hz : lz > s.hz ? s.hz : lz;
  const ex = lx - qx, ey = ly - qy, ez = lz - qz;
  const d2 = ex * ex + ey * ey + ez * ez;
  let nlx, nly, nlz, depth, cx = qx, cy = qy, cz = qz;
  if (d2 > 1e-18) {
    if (d2 >= sr * sr) return false;
    const d = Math.sqrt(d2);
    nlx = ex / d; nly = ey / d; nlz = ez / d; depth = sr - d;
  } else { // the centre is inside the box: leave by the nearest face
    const px = s.hx - Math.abs(lx), py = s.hy - Math.abs(ly), pz = s.hz - Math.abs(lz);
    nlx = 0; nly = 0; nlz = 0;
    if (px <= py && px <= pz) { nlx = lx < 0 ? -1 : 1; depth = px + sr; cx = nlx * s.hx; }
    else if (py <= pz) { nly = ly < 0 ? -1 : 1; depth = py + sr; cy = nly * s.hy; }
    else { nlz = lz < 0 ? -1 : 1; depth = pz + sr; cz = nlz * s.hz; }
  }
  out.nx = r[0] * nlx + r[1] * nly + r[2] * nlz; out.ny = r[3] * nlx + r[4] * nly + r[5] * nlz; out.nz = r[6] * nlx + r[7] * nly + r[8] * nlz;
  out.px = b.x + r[0] * cx + r[1] * cy + r[2] * cz; out.py = b.y + r[3] * cx + r[4] * cy + r[5] * cz; out.pz = b.z + r[6] * cx + r[7] * cy + r[8] * cz;
  out.depth = depth;
  return true;
}

/** A sphere against one triangle (two-sided). The normal in `out` points from the triangle to the sphere. */
function sphereTriangle(sx, sy, sz, sr, v, o, hint, out) {
  const cp = { x: 0, y: 0, z: 0 };
  const d2 = closestPointOnTriangle(sx, sy, sz, v[o], v[o + 1], v[o + 2], v[o + 3], v[o + 4], v[o + 5], v[o + 6], v[o + 7], v[o + 8], cp);
  if (d2 >= sr * sr) return false;
  let nx, ny, nz, depth;
  if (d2 > 1e-18) { const d = Math.sqrt(d2); nx = (sx - cp.x) / d; ny = (sy - cp.y) / d; nz = (sz - cp.z) / d; depth = sr - d; }
  else { // the centre is on the triangle: use its face normal, on the side the body came from
    const ux = v[o + 3] - v[o], uy = v[o + 4] - v[o + 1], uz = v[o + 5] - v[o + 2], wx = v[o + 6] - v[o], wy = v[o + 7] - v[o + 1], wz = v[o + 8] - v[o + 2];
    nx = uy * wz - uz * wy; ny = uz * wx - ux * wz; nz = ux * wy - uy * wx;
    const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1; nx /= l; ny /= l; nz /= l;
    if (nx * hint[0] + ny * hint[1] + nz * hint[2] > 0) { nx = -nx; ny = -ny; nz = -nz; }
    depth = sr;
  }
  out.nx = nx; out.ny = ny; out.nz = nz; out.px = cp.x; out.py = cp.y; out.pz = cp.z; out.depth = depth;
  return true;
}

const ends = [0, 0, 0, 0, 0, 0];
const ends2 = [0, 0, 0, 0, 0, 0];

/** Sphere against sphere, given as centres and radii; the normal points from the first to the second. */
function spheres(m, ax, ay, az, ra, bx, by, bz, rb) {
  const dx = bx - ax, dy = by - ay, dz = bz - az, d2 = dx * dx + dy * dy + dz * dz, rr = ra + rb;
  if (d2 >= rr * rr) return;
  let nx = 0, ny = 1, nz = 0, d = 0;
  if (d2 > 1e-18) { d = Math.sqrt(d2); nx = dx / d; ny = dy / d; nz = dz / d; }
  m.setNormal(nx, ny, nz);
  const depth = rr - d;
  m.add(ax + nx * (ra - depth * 0.5), ay + ny * (ra - depth * 0.5), az + nz * (ra - depth * 0.5), depth);
}

/** Merge up to three single contacts (from the end caps and the closest point of a capsule) that share a normal into the manifold. */
function gather(m, list, n, flip) {
  let best = -1, bd = 0;
  for (let i = 0; i < n; i++) if (list[i].ok && list[i].depth > bd) { bd = list[i].depth; best = i; }
  if (best < 0) return;
  const p = list[best], s = flip ? -1 : 1;
  m.setNormal(p.nx * s, p.ny * s, p.nz * s);
  for (let i = 0; i < n; i++) {
    const q = list[i];
    if (!q.ok || (i !== best && q.nx * p.nx + q.ny * p.ny + q.nz * p.nz < 0.9)) continue;
    if (i !== best && m.n > 0) { // skip a point that is practically the same as one already there
      let dup = false;
      for (let k = 0; k < m.n; k++) if (Math.abs(m.px[k] - q.px) + Math.abs(m.py[k] - q.py) + Math.abs(m.pz[k] - q.pz) < 0.02) dup = true;
      if (dup) continue;
    }
    m.add(q.px, q.py, q.pz, q.depth);
  }
}

/** The point of a segment closest to a box, found by alternating projections (the box and the segment are convex, so it converges). */
function segmentPointNearBox(e, b, out) {
  const r = b.r, s = b.shape;
  let t = 0.5;
  for (let it = 0; it < 6; it++) {
    const px = e[0] + (e[3] - e[0]) * t, py = e[1] + (e[4] - e[1]) * t, pz = e[2] + (e[5] - e[2]) * t;
    const dx = px - b.x, dy = py - b.y, dz = pz - b.z;
    let lx = r[0] * dx + r[3] * dy + r[6] * dz, ly = r[1] * dx + r[4] * dy + r[7] * dz, lz = r[2] * dx + r[5] * dy + r[8] * dz;
    lx = lx < -s.hx ? -s.hx : lx > s.hx ? s.hx : lx; ly = ly < -s.hy ? -s.hy : ly > s.hy ? s.hy : ly; lz = lz < -s.hz ? -s.hz : lz > s.hz ? s.hz : lz;
    const qx = b.x + r[0] * lx + r[1] * ly + r[2] * lz, qy = b.y + r[3] * lx + r[4] * ly + r[5] * lz, qz = b.z + r[6] * lx + r[7] * ly + r[8] * lz;
    const ux = e[3] - e[0], uy = e[4] - e[1], uz = e[5] - e[2], l2 = ux * ux + uy * uy + uz * uz;
    t = l2 > 1e-18 ? Math.min(1, Math.max(0, ((qx - e[0]) * ux + (qy - e[1]) * uy + (qz - e[2]) * uz) / l2)) : 0;
  }
  out[0] = e[0] + (e[3] - e[0]) * t; out[1] = e[1] + (e[4] - e[1]) * t; out[2] = e[2] + (e[5] - e[2]) * t;
}
const mid = [0, 0, 0];

/**
 * Contacts between two bodies. The normal points from `a` to `b`.
 * @param {import('./body.js').RigidBody} a
 * @param {import('./body.js').RigidBody} b
 * @param {Manifold} m
 */
export function collide(a, b, m) {
  m.clear();
  const ta = a.shape.type, tb = b.shape.type;
  if (RANK[ta] > RANK[tb]) { collide(b, a, m); m.setNormal(-m.nx, -m.ny, -m.nz); return; }
  if (ta === 'sphere') {
    if (tb === 'sphere') spheres(m, a.x, a.y, a.z, a.shape.radius, b.x, b.y, b.z, b.shape.radius);
    else if (tb === 'capsule') {
      capsuleEnds(b, ends);
      closestSegments(a.x, a.y, a.z, a.x, a.y, a.z, ends[0], ends[1], ends[2], ends[3], ends[4], ends[5], ends2);
      spheres(m, a.x, a.y, a.z, a.shape.radius, ends2[3], ends2[4], ends2[5], b.shape.radius);
    } else if (sphereBox(a.x, a.y, a.z, a.shape.radius, b, c)) { m.setNormal(-c.nx, -c.ny, -c.nz); m.add(c.px, c.py, c.pz, c.depth); }
  } else if (ta === 'capsule') {
    capsuleEnds(a, ends);
    if (tb === 'capsule') {
      capsuleEnds(b, ends2);
      const out = [0, 0, 0, 0, 0, 0];
      closestSegments(ends[0], ends[1], ends[2], ends[3], ends[4], ends[5], ends2[0], ends2[1], ends2[2], ends2[3], ends2[4], ends2[5], out);
      spheres(m, out[0], out[1], out[2], a.shape.radius, out[3], out[4], out[5], b.shape.radius);
    } else { // against a box: spheres at both ends and at the closest point of the axis
      const r = a.shape.radius;
      segmentPointNearBox(ends, b, mid);
      cs[0].ok = sphereBox(ends[0], ends[1], ends[2], r, b, cs[0]);
      cs[1].ok = sphereBox(ends[3], ends[4], ends[5], r, b, cs[1]);
      cs[2].ok = sphereBox(mid[0], mid[1], mid[2], r, b, cs[2]);
      gather(m, cs, 3, true); // those normals point from the box to the capsule; we want capsule to box
    }
  } else if (tb === 'box') boxBox(a, b, m);
}

const tmp = [0, 0, 0];
/**
 * Contacts between a body and one triangle of the static world, given as the 9 numbers at `verts[o..o+8]`. The normal points from
 * the body to the triangle (so the triangle plays the part of body B).
 */
export function collideTriangle(a, verts, o, m) {
  m.clear();
  const t = a.shape.type;
  tmp[0] = a.vx; tmp[1] = a.vy; tmp[2] = a.vz; // a body moving into a triangle came from the side it faces
  if (t === 'sphere') {
    if (sphereTriangle(a.x, a.y, a.z, a.shape.radius, verts, o, tmp, c)) { m.setNormal(-c.nx, -c.ny, -c.nz); m.add(c.px, c.py, c.pz, c.depth); }
  } else if (t === 'capsule') {
    capsuleEnds(a, ends);
    const r = a.shape.radius;
    // the point of the axis closest to the triangle: alternate between the nearest triangle point and its nearest axis point
    const cp = { x: 0, y: 0, z: 0 };
    let u = 0.5;
    for (let it = 0; it < 6; it++) {
      const px = ends[0] + (ends[3] - ends[0]) * u, py = ends[1] + (ends[4] - ends[1]) * u, pz = ends[2] + (ends[5] - ends[2]) * u;
      closestPointOnTriangle(px, py, pz, verts[o], verts[o + 1], verts[o + 2], verts[o + 3], verts[o + 4], verts[o + 5], verts[o + 6], verts[o + 7], verts[o + 8], cp);
      const ux = ends[3] - ends[0], uy = ends[4] - ends[1], uz = ends[5] - ends[2], l2 = ux * ux + uy * uy + uz * uz;
      u = l2 > 1e-18 ? Math.min(1, Math.max(0, ((cp.x - ends[0]) * ux + (cp.y - ends[1]) * uy + (cp.z - ends[2]) * uz) / l2)) : 0;
    }
    mid[0] = ends[0] + (ends[3] - ends[0]) * u; mid[1] = ends[1] + (ends[4] - ends[1]) * u; mid[2] = ends[2] + (ends[5] - ends[2]) * u;
    cs[0].ok = sphereTriangle(ends[0], ends[1], ends[2], r, verts, o, tmp, cs[0]);
    cs[1].ok = sphereTriangle(ends[3], ends[4], ends[5], r, verts, o, tmp, cs[1]);
    cs[2].ok = sphereTriangle(mid[0], mid[1], mid[2], r, verts, o, tmp, cs[2]);
    gather(m, cs, 3, true);
  } else boxTriangle(a, verts, o, m);
}
