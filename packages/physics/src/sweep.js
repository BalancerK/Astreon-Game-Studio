/** Gap left between a mover and the surface it hit, so it never rests exactly in contact. */
export const SKIN = 1e-4;

/**
 * @typedef {Object} Hit
 * @property {number} t Fraction (0..1) of the motion travelled before contact.
 * @property {number} nx Surface normal x (axis-aligned: -1, 0 or 1).
 * @property {number} ny Surface normal y.
 * @property {number} index Item hit (set by SpatialHash.sweep).
 */

/**
 * Sweep a moving box against a static box (Minkowski sum + slab test):
 * the box centre becomes a ray against the target grown by the mover's half extents.
 * If they already overlap, reports t = 0 with the normal of least penetration.
 * Touching without overlap while moving apart or along the surface is not a hit.
 *
 * @param {number} cx Mover centre x
 * @param {number} cy
 * @param {number} hw Mover half width
 * @param {number} hh
 * @param {number} dx Motion over the whole step
 * @param {number} dy
 * @param {number} bx Target centre x
 * @param {number} by
 * @param {number} bhw Target half width
 * @param {number} bhh
 * @param {Hit} out Written only when true is returned.
 * @returns {boolean}
 */
export function sweepAabbVsAabb(cx, cy, hw, hh, dx, dy, bx, by, bhw, bhh, out) {
  const ex = bhw + hw;
  const ey = bhh + hh;
  const rx = cx - bx;
  const ry = cy - by;
  let txMin, txMax, tyMin, tyMax;
  if (dx === 0) {
    if (rx <= -ex || rx >= ex) return false;
    txMin = -Infinity; txMax = Infinity;
  } else {
    const a = (-ex - rx) / dx;
    const b = (ex - rx) / dx;
    if (a < b) { txMin = a; txMax = b; } else { txMin = b; txMax = a; }
  }
  if (dy === 0) {
    if (ry <= -ey || ry >= ey) return false;
    tyMin = -Infinity; tyMax = Infinity;
  } else {
    const a = (-ey - ry) / dy;
    const b = (ey - ry) / dy;
    if (a < b) { tyMin = a; tyMax = b; } else { tyMin = b; tyMax = a; }
  }
  const enter = txMin > tyMin ? txMin : tyMin;
  const exit = txMax < tyMax ? txMax : tyMax;
  if (enter > exit || exit <= 0 || enter > 1) return false;
  if (enter < 0) {
    const px = ex - Math.abs(rx);
    const py = ey - Math.abs(ry);
    out.t = 0;
    if (px < py) { out.nx = rx < 0 ? -1 : 1; out.ny = 0; } else { out.nx = 0; out.ny = ry < 0 ? -1 : 1; }
    return true;
  }
  out.t = enter;
  if (txMin > tyMin) { out.nx = dx > 0 ? -1 : 1; out.ny = 0; } else { out.nx = 0; out.ny = dy > 0 ? -1 : 1; }
  return true;
}
