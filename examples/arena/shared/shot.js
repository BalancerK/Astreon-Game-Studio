// The hitscan weapon's geometry, shared by the server (authoritative) and the client (prediction of your own shots).
// Same inputs give the same answer on both sides, because it is the same code. Keep it deterministic:
// only + - * / and sqrt.
import { GROUP_WALL } from './game.js';

/**
 * Distance along a ray to a circle, or -1 for a miss.
 * @param {number} ox Ray origin
 * @param {number} oy
 * @param {number} dx Unit direction
 * @param {number} dy
 * @param {number} cx Circle centre
 * @param {number} cy
 * @param {number} r
 * @param {number} maxDistance
 */
export function rayCircle(ox, oy, dx, dy, cx, cy, r, maxDistance) {
  const fx = ox - cx, fy = oy - cy;
  const b = fx * dx + fy * dy;
  const c = fx * fx + fy * fy - r * r;
  if (c > 0 && b > 0) return -1; // outside and pointing away
  const disc = b * b - c;
  if (disc < 0) return -1;
  const t = c <= 0 ? 0 : -b - Math.sqrt(disc); // inside the circle: hit at the origin
  return t >= 0 && t <= maxDistance ? t : -1;
}

const wallHit = { t: 0, nx: 0, ny: 0, index: -1 };

/**
 * Follow a shot from (ox, oy) along the unit direction (dx, dy): walls stop it, and the nearest circle in front of
 * the wall (within `range`) is the victim.
 *
 * @param {import('../../../packages/physics/src/index.js').SpatialHash} walls
 * @param {number} ox
 * @param {number} oy
 * @param {number} dx Unit direction
 * @param {number} dy
 * @param {number} range
 * @param {number} n How many candidate targets follow
 * @param {ArrayLike<number>} ids Target entity ids
 * @param {ArrayLike<number>} xs Target positions (where the shooter saw them)
 * @param {ArrayLike<number>} ys
 * @param {ArrayLike<number>} rs Target radii
 * @param {{victim: number, reach: number}} out `victim` is -1 for a miss; `reach` is how far the shot travelled.
 * @returns {{victim: number, reach: number}} `out`
 */
export function traceShot(walls, ox, oy, dx, dy, range, n, ids, xs, ys, rs, out) {
  const hit = walls.sweep(ox, oy, 0, 0, dx * range, dy * range, GROUP_WALL, -1, wallHit);
  let reach = hit ? wallHit.t * range : range; // walls stop shots
  let victim = -1;
  for (let k = 0; k < n; k++) {
    const t = rayCircle(ox, oy, dx, dy, xs[k], ys[k], rs[k], reach);
    if (t >= 0) { reach = t; victim = ids[k]; }
  }
  out.victim = victim;
  out.reach = reach;
  return out;
}
