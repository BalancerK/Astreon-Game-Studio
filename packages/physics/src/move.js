import { SKIN } from './sweep.js';

const hit = { t: 0, nx: 0, ny: 0, index: -1 };

/**
 * @typedef {Object} MoveResult
 * @property {number} x Final centre x
 * @property {number} y
 * @property {boolean} hit True if anything blocked the motion.
 * @property {number} nx Normal of the last surface hit.
 * @property {number} ny
 * @property {number} index Index of the last item hit, or -1.
 */

/**
 * A reusable result object for `moveBox` (so moving things does not allocate).
 *
 * @returns {MoveResult} Reusable result object.
 */
export const createMoveResult = () => ({ x: 0, y: 0, hit: false, nx: 0, ny: 0, index: -1 });

/**
 * Move a box by (dx, dy), stopping at the first obstacle and sliding along it
 * with the remaining motion (up to `maxIter` contacts, so corners work).
 * Motion is swept, so speed can never tunnel through thin geometry.
 * Does not push out of existing deep overlap beyond a `SKIN` nudge.
 *
 * @param {import('./spatial-hash.js').SpatialHash} hash
 * @param {number} cx
 * @param {number} cy
 * @param {number} hw
 * @param {number} hh
 * @param {number} dx
 * @param {number} dy
 * @param {number} mask Groups to collide with.
 * @param {number} ignore Index of the mover itself, or -1.
 * @param {MoveResult} out
 * @param {number} [maxIter]
 * @returns {MoveResult} `out`
 */
export function moveAndSlide(hash, cx, cy, hw, hh, dx, dy, mask, ignore, out, maxIter = 4) {
  out.hit = false; out.nx = 0; out.ny = 0; out.index = -1;
  for (let iter = 0; iter < maxIter && (dx !== 0 || dy !== 0); iter++) {
    if (!hash.sweep(cx, cy, hw, hh, dx, dy, mask, ignore, hit)) {
      cx += dx; cy += dy; dx = 0; dy = 0;
      break;
    }
    out.hit = true; out.nx = hit.nx; out.ny = hit.ny; out.index = hit.index;
    const t = hit.t;
    cx += dx * t + hit.nx * SKIN;
    cy += dy * t + hit.ny * SKIN;
    let rx = dx * (1 - t), ry = dy * (1 - t);
    const dot = rx * hit.nx + ry * hit.ny;
    if (dot < 0) { rx -= dot * hit.nx; ry -= dot * hit.ny; }
    dx = rx; dy = ry;
  }
  out.x = cx; out.y = cy;
  return out;
}

/**
 * How many substeps a caller should split a tick into so no mover travels more
 * than half its smallest extent per substep. Useful when movers interact with
 * each other (rebuild the hash between substeps); static geometry is already
 * covered by swept movement.
 *
 * @param {number} speed Units per second
 * @param {number} dt Seconds per tick
 * @param {number} minExtent Smallest collider size involved
 * @param {number} [maxSteps]
 */
export function substepCount(speed, dt, minExtent, maxSteps = 8) {
  const n = Math.ceil((speed * dt) / (0.5 * minExtent));
  return n < 1 ? 1 : n > maxSteps ? maxSteps : n;
}
