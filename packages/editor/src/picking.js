// Rays and what they hit.
import { mat4 } from '../../math/src/index.js';

export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const length = (a) => Math.hypot(a[0], a[1], a[2]);
export const normalize = (a) => { const l = length(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

/** The ray through a pixel. @returns {{origin: number[], dir: number[]}} */
export function rayFromScreen(camera, sx, sy) {
  const origin = [0, 0, 0], dir = [0, 0, 0];
  camera.screenToRay(sx, sy, origin, dir);
  return { origin, dir: normalize(dir) };
}

/** Distance along a ray to a box (slab test), or null. */
export function rayAabb(origin, dir, min, max) {
  let t0 = 0, t1 = Infinity;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(dir[i]) < 1e-12) { if (origin[i] < min[i] || origin[i] > max[i]) return null; continue; }
    let a = (min[i] - origin[i]) / dir[i], b = (max[i] - origin[i]) / dir[i];
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a); t1 = Math.min(t1, b);
    if (t0 > t1) return null;
  }
  return t0;
}

/** Distance along a ray to a box that is moved, turned and scaled by `matrix`, or null. */
export function rayOrientedBox(origin, dir, matrix, halfExtents) {
  const inv = new Float64Array(16);
  if (!mat4.invert(inv, matrix)) return null;
  const o = mat4.transformPoint([0, 0, 0], inv, origin), d = mat4.transformDirection([0, 0, 0], inv, dir);
  const t = rayAabb(o, d, [-halfExtents[0], -halfExtents[1], -halfExtents[2]], halfExtents);
  return t; // the local ray keeps the same parameter because the direction was transformed without renormalising
}

/** Where a ray meets a plane (point and normal), or null if parallel or behind. @returns {{t: number, point: number[]} | null} */
export function rayPlane(origin, dir, point, normal) {
  const denom = dot(dir, normal);
  if (Math.abs(denom) < 1e-9) return null;
  const t = dot(sub(point, origin), normal) / denom;
  if (t < 0) return null;
  return { t, point: add(origin, scale(dir, t)) };
}

/**
 * The closest approach of a ray to an infinite line: parameters along each and their distance.
 * @returns {{s: number, t: number, distance: number} | null} `s` along the ray, `t` along the line (in units of `lineDir`, which should be unit length)
 */
export function rayLine(origin, dir, linePoint, lineDir) {
  const w = sub(origin, linePoint);
  const a = dot(dir, dir), b = dot(dir, lineDir), c = dot(lineDir, lineDir), d = dot(dir, w), e = dot(lineDir, w);
  const den = a * c - b * b;
  if (Math.abs(den) < 1e-9) return null;
  const s = (b * e - c * d) / den, t = (a * e - b * d) / den;
  const p1 = add(origin, scale(dir, s)), p2 = add(linePoint, scale(lineDir, t));
  return { s, t, distance: length(sub(p1, p2)) };
}

/** The nearest hit among items with `matrix` and `half` (half extents of the local box). @returns {{item: any, t: number} | null} */
export function pick(ray, items) {
  let best = null;
  for (const item of items) {
    const t = rayOrientedBox(ray.origin, ray.dir, item.matrix, item.half);
    if (t !== null && t > 0 && (!best || t < best.t)) best = { item, t };
  }
  return best;
}

/** Entities whose parts' screen-space bounds fall inside a rectangle (for box selection). */
export function inRect(camera, items, x0, y0, x1, y1) {
  const lo = [Math.min(x0, x1), Math.min(y0, y1)], hi = [Math.max(x0, x1), Math.max(y0, y1)];
  const out = new Set(), p = { x: 0, y: 0, depth: 0, visible: false };
  for (const it of items) {
    const c = [it.matrix[12], it.matrix[13], it.matrix[14]];
    camera.worldToScreen(c[0], c[1], c[2], p);
    if (p.visible && p.x >= lo[0] && p.x <= hi[0] && p.y >= lo[1] && p.y <= hi[1]) out.add(it.id);
  }
  return [...out];
}
