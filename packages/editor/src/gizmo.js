// The move / rotate / scale handles: where they are, what a ray hits, and what a drag does. All in world space and independent of the DOM,
// so the maths is testable. The handle ids: 'x' 'y' 'z' (axes), 'xy' 'xz' 'yz' (planes), 'rx' 'ry' 'rz' (rings), 'u' (uniform scale).
import { quat } from '../../math/src/index.js';
import { add, sub, scale as mul, dot, cross, normalize, length, rayPlane, rayLine } from './picking.js';

const AXIS = { x: 0, y: 1, z: 2 };
const PLANES = { xy: [0, 1, 2], xz: [0, 2, 1], yz: [1, 2, 0] };

/** Round `v` to the nearest multiple of `step` (`step` of 0 or less leaves it as it is). */
export const snapTo = (v, step) => (step > 0 ? Math.round(v / step) * step : v);

/**
 * The move / rotate / scale handles of the scene editor, as maths: where the handles are for the camera, which one a ray hits, and
 * what a drag does (`begin` / `update`), with snapping and world or local space. Draws nothing and knows no DOM.
 */
export class Gizmo {
  /**
   * @param {{mode?: 'translate' | 'rotate' | 'scale', space?: 'world' | 'local', snap?: {move?: number, rotate?: number, scale?: number}, screenSize?: number}} [o]
   * `snap`: grid step in metres, degrees, and scale factor (0 = off). `screenSize`: handle length as a fraction of the distance to the camera.
   */
  constructor({ mode = 'translate', space = 'world', snap = {}, screenSize = 0.16 } = {}) {
    this.mode = mode; this.space = space; this.snap = { move: 0, rotate: 0, scale: 0, ...snap }; this.screenSize = screenSize;
    /** @type {string | null} */ this.hover = null;
  }

  /** The three axis directions (the object's own when `space` is local). */
  basis(rotation) {
    if (this.space !== 'local') return [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    return [[1, 0, 0], [0, 1, 0], [0, 0, 1]].map((v) => quat.rotate([0, 0, 0], rotation, v));
  }
  /** World length of the handles so they look the same size at any distance. */
  size(origin, cameraPos) { return Math.max(1e-3, length(sub(origin, cameraPos)) * this.screenSize); }

  /** What to draw: `lines` ({id, from, to}) and `rings` ({id, points}). */
  geometry(origin, rotation, cameraPos) {
    const s = this.size(origin, cameraPos), b = this.basis(rotation);
    const lines = [], rings = [];
    if (this.mode === 'translate' || this.mode === 'scale') {
      for (const [id, i] of Object.entries(AXIS)) lines.push({ id, from: origin, to: add(origin, mul(b[i], s)) });
    }
    if (this.mode === 'translate') {
      for (const [id, [i, j]] of Object.entries(PLANES)) {
        const a = add(origin, mul(b[i], s * 0.3)), c = add(origin, mul(b[j], s * 0.3)), d = add(a, mul(b[j], s * 0.3));
        lines.push({ id, from: a, to: d }, { id, from: c, to: d });
      }
    }
    if (this.mode === 'rotate') {
      for (const [axis, i] of Object.entries(AXIS)) {
        const u = b[(i + 1) % 3], v = b[(i + 2) % 3], pts = [];
        for (let k = 0; k <= 48; k++) { const a = (k / 48) * Math.PI * 2; pts.push(add(origin, add(mul(u, Math.cos(a) * s), mul(v, Math.sin(a) * s)))); }
        rings.push({ id: `r${axis}`, points: pts });
      }
    }
    return { lines, rings, size: s };
  }

  /** The handle under a ray, or null. */
  hit(ray, origin, rotation, cameraPos) {
    const s = this.size(origin, cameraPos), b = this.basis(rotation);
    const tol = s * 0.09;
    let best = null;
    const offer = (id, t) => { if (!best || t < best.t) best = { id, t }; };
    if (this.mode === 'translate' || this.mode === 'scale') {
      if (this.mode === 'scale') { // a small sphere at the centre scales all three together
        const toCentre = sub(origin, ray.origin), along = dot(toCentre, ray.dir);
        if (along > 0 && length(cross(ray.dir, toCentre)) < s * 0.12) offer('u', along - 1e6); // (wins over the axes it overlaps)
      }
      for (const [id, i] of Object.entries(AXIS)) {
        const c = rayLine(ray.origin, ray.dir, origin, b[i]);
        if (c && c.s > 0 && c.t > -tol && c.t < s * 1.1 && c.distance < tol) offer(id, c.s);
      }
    }
    if (this.mode === 'translate') {
      for (const [id, [i, j, k]] of Object.entries(PLANES)) {
        const p = rayPlane(ray.origin, ray.dir, origin, b[k]);
        if (!p) continue;
        const d = sub(p.point, origin), u = dot(d, b[i]), v = dot(d, b[j]);
        if (u > 0 && u < s * 0.3 && v > 0 && v < s * 0.3) offer(id, p.t - 1e-3); // a hair in front of the axes it overlaps
      }
    }
    if (this.mode === 'rotate') {
      for (const [axis, i] of Object.entries(AXIS)) {
        const p = rayPlane(ray.origin, ray.dir, origin, b[i]);
        if (p && Math.abs(length(sub(p.point, origin)) - s) < tol) offer(`r${axis}`, p.t);
      }
    }
    return best ? best.id : null;
  }

  /** Start dragging a handle. @returns {object | null} state for `update` */
  begin(handle, ray, origin, rotation, scaleNow = 1, cameraPos = [0, 0, 0]) {
    const b = this.basis(rotation);
    const st = { handle, origin: [...origin], rotation: [...rotation], scale: scaleNow, b, cameraPos };
    if (handle in AXIS) { const c = rayLine(ray.origin, ray.dir, origin, b[AXIS[handle]]); if (!c) return null; st.t0 = c.t; st.axis = b[AXIS[handle]]; }
    else if (handle in PLANES) { const [, , k] = PLANES[handle]; const p = rayPlane(ray.origin, ray.dir, origin, b[k]); if (!p) return null; st.p0 = p.point; st.normal = b[k]; st.dirs = [b[PLANES[handle][0]], b[PLANES[handle][1]]]; }
    else if (handle[0] === 'r') { const axis = b[AXIS[handle[1]]]; const p = rayPlane(ray.origin, ray.dir, origin, axis); if (!p) return null; st.axis = axis; st.v0 = sub(p.point, origin); }
    else if (handle === 'u') { const n = normalize(sub(cameraPos, origin)); const p = rayPlane(ray.origin, ray.dir, origin, n); if (!p) return null; st.normal = n; st.d0 = Math.max(1e-3, length(sub(p.point, origin))); }
    else return null;
    // scale along an axis: remember the start distance on that axis
    if (this.mode === 'scale' && handle in AXIS) st.d0 = Math.max(1e-3, Math.abs(st.t0));
    return st;
  }

  /** The new pose for the current ray: `{position}`, `{rotation}` or `{scale}` (only the one the drag changes). */
  update(st, ray) {
    const { handle } = st;
    if (this.mode === 'translate') {
      if (handle in AXIS) {
        const c = rayLine(ray.origin, ray.dir, st.origin, st.axis); if (!c) return {};
        const d = snapTo(c.t - st.t0, this.snap.move);
        return { position: add(st.origin, mul(st.axis, d)) };
      }
      const p = rayPlane(ray.origin, ray.dir, st.origin, st.normal); if (!p) return {};
      const delta = sub(p.point, st.p0);
      const du = snapTo(dot(delta, st.dirs[0]), this.snap.move), dv = snapTo(dot(delta, st.dirs[1]), this.snap.move);
      return { position: add(st.origin, add(mul(st.dirs[0], du), mul(st.dirs[1], dv))) };
    }
    if (this.mode === 'rotate') {
      const p = rayPlane(ray.origin, ray.dir, st.origin, st.axis); if (!p) return {};
      const v1 = sub(p.point, st.origin);
      let angle = Math.atan2(dot(cross(st.v0, v1), st.axis), dot(st.v0, v1));
      if (this.snap.rotate > 0) { const step = (this.snap.rotate * Math.PI) / 180; angle = Math.round(angle / step) * step; }
      const dq = quat.fromAxisAngle([0, 0, 0, 1], st.axis, angle);
      return { rotation: quat.normalize([0, 0, 0, 1], quat.multiply([0, 0, 0, 1], dq, st.rotation)), angle };
    }
    // scale
    let factor;
    if (handle === 'u') { const p = rayPlane(ray.origin, ray.dir, st.origin, st.normal); if (!p) return {}; factor = length(sub(p.point, st.origin)) / st.d0; }
    else { const c = rayLine(ray.origin, ray.dir, st.origin, st.axis); if (!c) return {}; factor = Math.abs(c.t) / st.d0; }
    factor = Math.max(0.01, factor);
    if (this.snap.scale > 0) factor = Math.max(this.snap.scale, snapTo(factor, this.snap.scale));
    return { scale: st.scale * factor };
  }
}
