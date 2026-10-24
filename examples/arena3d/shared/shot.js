// The hitscan weapon's geometry, shared by the server (authoritative) and the client (prediction of your own shots): the same
// inputs give the same answer on both sides because it is the same code. Deterministic: only + - * / and sqrt.

/**
 * Distance along a ray to an ellipsoid (a player's body), or -1 for a miss. The ray starts inside it: hit at 0.
 * Scaling every coordinate by the radii turns the ellipsoid into the unit sphere; the ray parameter is unchanged.
 */
export function rayEllipsoid(ox, oy, oz, dx, dy, dz, cx, cy, cz, rx, ry, rz, maxDistance) {
  const px = (ox - cx) / rx, py = (oy - cy) / ry, pz = (oz - cz) / rz;
  const vx = dx / rx, vy = dy / ry, vz = dz / rz;
  const a = vx * vx + vy * vy + vz * vz;
  const b = px * vx + py * vy + pz * vz;
  const c = px * px + py * py + pz * pz - 1;
  if (c <= 0) return 0; // the origin is inside the body
  if (b >= 0) return -1; // pointing away
  const disc = b * b - a * c;
  if (disc < 0) return -1;
  const t = (-b - Math.sqrt(disc)) / a;
  return t >= 0 && t <= maxDistance ? t : -1;
}

const wallHit = { t: 0, index: -1, nx: 0, ny: 0, nz: 0 };

/**
 * Follow a shot from (ox, oy, oz) along the unit direction (dx, dy, dz): the level's walls stop it, and the nearest body in
 * front of the wall (within `range`) is the victim.
 *
 * @param {import('../../../packages/physics/src/index.js').TriWorld} world
 * @param {number} n How many candidate bodies follow
 * @param {ArrayLike<number>} ids Body entity ids
 * @param {ArrayLike<number>} xs Body centres (where the shooter saw them)
 * @param {ArrayLike<number>} ys
 * @param {ArrayLike<number>} zs
 * @param {number} rx Body radii
 * @param {number} ry
 * @param {number} rz
 * @param {{victim: number, reach: number}} out `victim` is -1 for a miss; `reach` is how far the shot travelled.
 */
export function traceShot(world, ox, oy, oz, dx, dy, dz, range, n, ids, xs, ys, zs, rx, ry, rz, out) {
  let reach = world.raycast(ox, oy, oz, dx, dy, dz, range, wallHit) ? wallHit.t : range; // walls stop shots
  let victim = -1;
  for (let k = 0; k < n; k++) {
    const t = rayEllipsoid(ox, oy, oz, dx, dy, dz, xs[k], ys[k], zs[k], rx, ry, rz, reach);
    if (t >= 0) { reach = t; victim = ids[k]; }
  }
  out.victim = victim;
  out.reach = reach;
  return out;
}
