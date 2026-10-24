import { sweepSphereVsTriangle, closestPointOnTriangle, CONTACT_FACE } from './sweep3d.js';

/** Gap kept between a mover and the surface it hit, as a fraction of its radius (in ellipsoid space). */
export const VERY_CLOSE = 5e-3;
const MAX_PLANES = 5;

/**
 * @typedef {Object} Slide3Result
 * @property {number} x Final centre
 * @property {number} y
 * @property {number} z
 * @property {boolean} hit True if anything blocked the motion.
 * @property {number} count Number of contacts recorded (at most 5).
 * @property {Float64Array} normals World-space contact normals, 3 per contact (the direction the surface pushes the mover).
 * @property {Int32Array} tri Triangle index of each contact.
 * @property {Uint8Array} kind CONTACT_FACE, CONTACT_EDGE or CONTACT_VERTEX of each contact.
 * @property {Float64Array} faceNormals World-space normal of the triangle itself for each contact (facing the mover).
 */

/**
 * A reusable result object for `slideEllipsoid` and the character controller (so moving things does not allocate).
 *
 * @returns {Slide3Result} Reusable result object.
 */
export const createSlide3Result = () => ({
  x: 0, y: 0, z: 0, hit: false, count: 0,
  normals: new Float64Array(3 * MAX_PLANES), tri: new Int32Array(MAX_PLANES), kind: new Uint8Array(MAX_PLANES), faceNormals: new Float64Array(3 * MAX_PLANES),
});

let candidates = new Int32Array(4096);
const hit = { t: 0, x: 0, y: 0, z: 0, kind: 0 };
const planes = new Float64Array(3 * MAX_PLANES);

/** Candidate triangles for a box, growing the shared buffer if the box touches more than it holds. */
function gather(world, minX, minY, minZ, maxX, maxY, maxZ) {
  for (;;) {
    const n = world.queryAabb(minX, minY, minZ, maxX, maxY, maxZ, candidates);
    if (n < candidates.length) return n;
    candidates = new Int32Array(candidates.length * 2);
  }
}

/**
 * Move an ellipsoid (a character body) through static triangle geometry and slide along what it hits. The motion is a
 * continuous sweep, so no speed can carry it through a surface (even a single zero-thickness triangle), and the result is
 * the same bits on every engine. Works in "ellipsoid space": every coordinate divided by the radii makes the body a unit
 * sphere, which is what the narrow phase sweeps.
 *
 * Up to 5 contacts are processed; when the motion is jammed between two surfaces it slides along their crease, and between
 * three it stops.
 *
 * @param {import('./tri-world.js').TriWorld} world A built world.
 * @param {number} px Centre
 * @param {number} py
 * @param {number} pz
 * @param {number} vx Motion over the whole step
 * @param {number} vy
 * @param {number} vz
 * @param {number} rx Radii
 * @param {number} ry
 * @param {number} rz
 * @param {Slide3Result} out
 * @param {number} [wallBelowY] Contacts whose world normal has 0 <= y < this are treated as vertical walls: sliding along them
 *   never lifts the body (a surface too steep to walk on cannot be climbed by pushing against it). Default 0 = off.
 * @param {boolean} [stopAtContact] Stop at the first contact instead of sliding (a ground probe must not slide down slopes).
 * @returns {Slide3Result} `out`
 */
export function moveEllipsoid(world, px, py, pz, vx, vy, vz, rx, ry, rz, out, wallBelowY = 0, stopAtContact = false) {
  out.hit = false; out.count = 0;
  const v = world.verts;
  let x = px / rx, y = py / ry, z = pz / rz;
  let dx = vx / rx, dy = vy / ry, dz = vz / rz;
  let nPlanes = 0;
  for (let iter = 0; iter < MAX_PLANES; iter++) {
    const len2 = dx * dx + dy * dy + dz * dz;
    if (len2 < 1e-24) break;
    const len = Math.sqrt(len2);
    const ex = x + dx, ey = y + dy, ez = z + dz;
    const n = gather(world, (x < ex ? x : ex) * rx - rx * 1.05, (y < ey ? y : ey) * ry - ry * 1.05, (z < ez ? z : ez) * rz - rz * 1.05,
      (x > ex ? x : ex) * rx + rx * 1.05, (y > ey ? y : ey) * ry + ry * 1.05, (z > ez ? z : ez) * rz + rz * 1.05);
    let best = 1, bestTri = -1, bx = 0, by = 0, bz = 0, bkind = 0;
    for (let k = 0; k < n; k++) {
      const i = candidates[k], o = i * 9;
      if (sweepSphereVsTriangle(x, y, z, dx, dy, dz,
        v[o] / rx, v[o + 1] / ry, v[o + 2] / rz, v[o + 3] / rx, v[o + 4] / ry, v[o + 5] / rz, v[o + 6] / rx, v[o + 7] / ry, v[o + 8] / rz, best, hit)) {
        best = hit.t; bestTri = i; bx = hit.x; by = hit.y; bz = hit.z; bkind = hit.kind;
      }
    }
    if (bestTri < 0) { x += dx; y += dy; z += dz; dx = dy = dz = 0; break; }

    // the contact normal in ellipsoid space: from the contact point to the centre AT THE MOMENT OF CONTACT (exactly unit length;
    // measuring from the backed-off centre below would tilt it)
    let nx = x + dx * best - bx, ny = y + dy * best - by, nz = z + dz * best - bz;
    // advance to just before the contact
    const travel = best * len;
    const move = travel > VERY_CLOSE ? travel - VERY_CLOSE : 0;
    const inv = move / len;
    x += dx * inv; y += dy * inv; z += dz * inv;
    const nl = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (nl > 0) { nx /= nl; ny /= nl; nz /= nl; } else { nx = 0; ny = 1; nz = 0; }
    // a surface too steep to walk on acts like a vertical wall: remove its vertical part so it cannot be climbed
    if (wallBelowY > 0) {
      let wx = nx / rx, wy = ny / ry, wz = nz / rz;
      const wl = Math.sqrt(wx * wx + wy * wy + wz * wz);
      wy /= wl;
      if (wy >= 0 && wy < wallBelowY) {
        wx /= wl; wz /= wl;
        const hl = Math.sqrt(wx * wx + wz * wz);
        if (hl > 1e-9) { nx = (wx / hl) * rx; ny = 0; nz = (wz / hl) * rz; const el = Math.sqrt(nx * nx + nz * nz); nx /= el; nz /= el; }
      }
    }
    // the motion that was left over
    const left = stopAtContact ? 0 : (len - travel) / len;
    let rdx = dx * left, rdy = dy * left, rdz = dz * left;

    out.hit = true;
    if (out.count < MAX_PLANES) {
      const c = out.count++;
      let wx = nx / rx, wy = ny / ry, wz = nz / rz;
      const wl = Math.sqrt(wx * wx + wy * wy + wz * wz);
      out.normals[c * 3] = wx / wl; out.normals[c * 3 + 1] = wy / wl; out.normals[c * 3 + 2] = wz / wl;
      out.tri[c] = bestTri; out.kind[c] = bkind;
      // the triangle's own normal, flipped to face the mover
      let fx = world.nx[bestTri], fy = world.ny[bestTri], fz = world.nz[bestTri];
      if (fx * out.normals[c * 3] + fy * out.normals[c * 3 + 1] + fz * out.normals[c * 3 + 2] < 0) { fx = -fx; fy = -fy; fz = -fz; }
      out.faceNormals[c * 3] = fx; out.faceNormals[c * 3 + 1] = fy; out.faceNormals[c * 3 + 2] = fz;
    }

    // clip what is left against this plane and every earlier one (Quake-style): slide, follow a crease, or stop in a corner
    planes[nPlanes * 3] = nx; planes[nPlanes * 3 + 1] = ny; planes[nPlanes * 3 + 2] = nz;
    nPlanes++;
    let cx = rdx, cy = rdy, cz = rdz, ok = false;
    for (let i = 0; i < nPlanes && !ok; i++) {
      const ix = planes[i * 3], iy = planes[i * 3 + 1], iz = planes[i * 3 + 2];
      const into = rdx * ix + rdy * iy + rdz * iz;
      cx = rdx; cy = rdy; cz = rdz;
      if (into < 0) { cx -= into * ix; cy -= into * iy; cz -= into * iz; }
      ok = true;
      for (let j = 0; j < nPlanes; j++) {
        if (j === i) continue;
        if (cx * planes[j * 3] + cy * planes[j * 3 + 1] + cz * planes[j * 3 + 2] < -1e-12) { ok = false; break; }
      }
    }
    if (!ok) {
      if (nPlanes === 2) { // wedged between two planes: slide along their crease
        const ax = planes[0], ay = planes[1], az = planes[2], bx2 = planes[3], by2 = planes[4], bz2 = planes[5];
        let cxp = ay * bz2 - az * by2, cyp = az * bx2 - ax * bz2, czp = ax * by2 - ay * bx2;
        const cl = Math.sqrt(cxp * cxp + cyp * cyp + czp * czp);
        if (cl > 1e-12) {
          cxp /= cl; cyp /= cl; czp /= cl;
          const along = rdx * cxp + rdy * cyp + rdz * czp;
          cx = cxp * along; cy = cyp * along; cz = czp * along;
        } else { cx = cy = cz = 0; }
      } else { cx = cy = cz = 0; } // three or more planes: the corner holds it
    }
    dx = cx; dy = cy; dz = cz;
  }
  out.x = x * rx; out.y = y * ry; out.z = z * rz;
  return out;
}

/**
 * Push an ellipsoid out of any geometry it overlaps (a few iterations along the direction away from the closest point).
 * Use before a move when the start may be slightly embedded (teleports, spawns, moving geometry).
 * @returns {boolean} True if the position changed.
 */
export function pushOutEllipsoid(world, out, rx, ry, rz, iterations = 4) {
  let moved = false;
  const v = world.verts;
  const q = { x: 0, y: 0, z: 0 };
  for (let iter = 0; iter < iterations; iter++) {
    const x = out.x / rx, y = out.y / ry, z = out.z / rz;
    const n = gather(world, out.x - rx * 1.05, out.y - ry * 1.05, out.z - rz * 1.05, out.x + rx * 1.05, out.y + ry * 1.05, out.z + rz * 1.05);
    let px = 0, py = 0, pz = 0, any = false;
    for (let k = 0; k < n; k++) {
      const o = candidates[k] * 9;
      const d2 = closestPointOnTriangle(x, y, z, v[o] / rx, v[o + 1] / ry, v[o + 2] / rz, v[o + 3] / rx, v[o + 4] / ry, v[o + 5] / rz, v[o + 6] / rx, v[o + 7] / ry, v[o + 8] / rz, q);
      if (d2 < 1 - 1e-9) {
        const d = Math.sqrt(d2);
        let nx, ny, nz;
        if (d > 1e-9) { nx = (x - q.x) / d; ny = (y - q.y) / d; nz = (z - q.z) / d; } else { // centre exactly on the surface: use the triangle's normal
          nx = world.nx[candidates[k]]; ny = world.ny[candidates[k]]; nz = world.nz[candidates[k]];
        }
        const push = 1 - d + 1e-4;
        if (push * Math.abs(nx) > Math.abs(px)) px = push * nx;
        if (push * Math.abs(ny) > Math.abs(py)) py = push * ny;
        if (push * Math.abs(nz) > Math.abs(pz)) pz = push * nz;
        any = true;
      }
    }
    if (!any) break;
    out.x += px * rx; out.y += py * ry; out.z += pz * rz;
    moved = true;
  }
  return moved;
}

/**
 * Is the ellipsoid standing on something? Looks at every triangle it is touching (within about 1% of its radius) whose
 * touch point is in the lower part of the body, and reports the most horizontal of their face normals (pointing up).
 * Using the triangle's own normal rather than the ellipsoid's contact normal matters at ledges and stair edges: the body
 * rests on an edge there, the contact direction is tilted, yet the surface it stands on is a flat tread.
 *
 * @param {{nx: number, ny: number, nz: number, tri: number, y: number}} out Written: the best support's normal, triangle and the height (world y) of the point it touches (ny = -1 when none).
 * @returns {boolean} True if anything supports it.
 */
export function findGround(world, x, y, z, rx, ry, rz, out) {
  const v = world.verts;
  const q = { x: 0, y: 0, z: 0 };
  const cx = x / rx, cy = y / ry, cz = z / rz;
  const n = gather(world, x - rx * 1.05, y - ry * 1.05, z - rz * 1.05, x + rx * 1.05, y + ry * 1.05, z + rz * 1.05);
  out.ny = -1; out.nx = 0; out.nz = 0; out.tri = -1; out.y = 0;
  for (let k = 0; k < n; k++) {
    const i = candidates[k], o = i * 9;
    const d2 = closestPointOnTriangle(cx, cy, cz, v[o] / rx, v[o + 1] / ry, v[o + 2] / rz, v[o + 3] / rx, v[o + 4] / ry, v[o + 5] / rz, v[o + 6] / rx, v[o + 7] / ry, v[o + 8] / rz, q);
    if (d2 > 1.0201 || q.y - cy > -0.39) continue; // not touching, or touching too near the rim (the lowest part of the body is what stands)
    let nx = world.nx[i], ny = world.ny[i], nz = world.nz[i];
    if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; } // two-sided: take the upward-facing side
    if (ny > out.ny) { out.ny = ny; out.nx = nx; out.nz = nz; out.tri = i; out.y = q.y * ry; }
  }
  return out.tri >= 0;
}

export { CONTACT_FACE };
