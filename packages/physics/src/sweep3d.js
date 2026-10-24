// Narrow phase for 3D: a unit sphere swept against a triangle, the closest point on a triangle, and ray vs triangle.
// Pure scalar maths (no allocation, no objects except the caller's output record) using only + - * / and sqrt, so server
// and client compute identical bits. The character controller collides an *ellipsoid* by dividing every coordinate by
// its radii, which turns it into a unit sphere (Fauerby, "Improved Collision detection and Response").

/** Contact kinds reported by `sweepSphereVsTriangle`. */
export const CONTACT_FACE = 0, CONTACT_EDGE = 1, CONTACT_VERTEX = 2;

/**
 * @typedef {Object} SphereHit
 * @property {number} t Fraction (0..1) of the motion travelled before contact.
 * @property {number} x Contact point on the triangle.
 * @property {number} y
 * @property {number} z
 * @property {number} kind CONTACT_FACE, CONTACT_EDGE or CONTACT_VERTEX.
 */

const BARY_EPS = 1e-9;
const closest = { x: 0, y: 0, z: 0 }; // scratch for the overlap test

/**
 * Closest point on triangle (a, b, c) to point p (Ericson, Real-Time Collision Detection).
 * @param {number} px
 * @param {number} py
 * @param {number} pz
 * @param {{x: number, y: number, z: number}} out
 * @returns {number} Squared distance from p to the triangle.
 */
export function closestPointOnTriangle(px, py, pz, ax, ay, az, bx, by, bz, cx, cy, cz, out) {
  const abx = bx - ax, aby = by - ay, abz = bz - az, acx = cx - ax, acy = cy - ay, acz = cz - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
  let x, y, z;
  if (d1 <= 0 && d2 <= 0) { x = ax; y = ay; z = az; } else {
    const bpx = px - bx, bpy = py - by, bpz = pz - bz;
    const d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
    if (d3 >= 0 && d4 <= d3) { x = bx; y = by; z = bz; } else {
      const vc = d1 * d4 - d3 * d2;
      if (vc <= 0 && d1 >= 0 && d3 <= 0) {
        const v = d1 / (d1 - d3);
        x = ax + v * abx; y = ay + v * aby; z = az + v * abz;
      } else {
        const cpx = px - cx, cpy = py - cy, cpz = pz - cz;
        const d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
        if (d6 >= 0 && d5 <= d6) { x = cx; y = cy; z = cz; } else {
          const vb = d5 * d2 - d1 * d6;
          if (vb <= 0 && d2 >= 0 && d6 <= 0) {
            const w = d2 / (d2 - d6);
            x = ax + w * acx; y = ay + w * acy; z = az + w * acz;
          } else {
            const va = d3 * d6 - d5 * d4;
            if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
              const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
              x = bx + w * (cx - bx); y = by + w * (cy - by); z = bz + w * (cz - bz);
            } else {
              const denom = 1 / (va + vb + vc);
              const v = vb * denom, w = vc * denom;
              x = ax + abx * v + acx * w; y = ay + aby * v + acy * w; z = az + abz * v + acz * w;
            }
          }
        }
      }
    }
  }
  out.x = x; out.y = y; out.z = z;
  const dx = px - x, dy = py - y, dz = pz - z;
  return dx * dx + dy * dy + dz * dz;
}

/**
 * The time a moving sphere ENTERS a contact region: the smaller root of a t^2 + b t + c = 0, if it lies in [0, max]; else
 * Infinity. (The larger root is the time it leaves again. A sphere already inside the region at t = 0 has a negative smaller
 * root and reports nothing here: that is the overlap case, decided separately by whether it is moving into the triangle.
 * Taking the larger root instead, as is often done, makes a sphere that merely touches a vertex or edge while moving away
 * report a bogus contact at t = 0 and get stuck.)
 */
function lowestRoot(a, b, c, max) {
  const disc = b * b - 4 * a * c;
  if (disc <= 0) return Infinity; // no contact, or only a tangential graze (a double root): not a hit
  const s = Math.sqrt(disc);
  const inv = 1 / (2 * a);
  let r1 = (-b - s) * inv, r2 = (-b + s) * inv;
  if (r1 > r2) { const t = r1; r1 = r2; r2 = t; }
  return r1 >= 0 && r1 <= max ? r1 : Infinity;
}

/**
 * Sweep the unit sphere centred at p along v (the whole step) against triangle (a, b, c); two-sided. Reports the earliest
 * contact earlier than `tLimit`. A sphere that already overlaps the triangle is a hit at t = 0 only if it is moving
 * toward it (moving away or sliding along is not a hit, so a resting sphere is never stuck).
 *
 * @param {number} tLimit Only hits with t < tLimit count (pass 1 for a full step, or the best hit so far).
 * @param {SphereHit} out Written only when true is returned.
 * @returns {boolean}
 */
export function sweepSphereVsTriangle(px, py, pz, vx, vy, vz, ax, ay, az, bx, by, bz, cx, cy, cz, tLimit, out) {
  const e1x = bx - ax, e1y = by - ay, e1z = bz - az, e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
  let nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
  const nlen = Math.sqrt(nx * nx + ny * ny + nz * nz);
  if (nlen === 0) return false; // degenerate triangle
  nx /= nlen; ny /= nlen; nz /= nlen;
  const dist = nx * (px - ax) + ny * (py - ay) + nz * (pz - az); // signed distance of the sphere centre from the plane
  const nv = nx * vx + ny * vy + nz * vz;
  const adist = dist < 0 ? -dist : dist;
  // On the far side of the plane (a full radius or more away) and not approaching it: nothing to hit. This is what makes
  // a body resting exactly on a surface free to move away from it or along it.
  if ((dist >= 1 && nv >= 0) || (dist <= -1 && nv <= 0)) return false;

  // Already touching or overlapping at the start? Then only "moving toward it" counts.
  if (adist < 1) {
    const q = closest;
    const d2 = closestPointOnTriangle(px, py, pz, ax, ay, az, bx, by, bz, cx, cy, cz, q);
    if (d2 < 1) {
      const toX = px - q.x, toY = py - q.y, toZ = pz - q.z; // from the contact toward the sphere centre
      if (toX * vx + toY * vy + toZ * vz < -1e-12 * Math.sqrt(vx * vx + vy * vy + vz * vz) && 0 < tLimit) {
        out.t = 0; out.x = q.x; out.y = q.y; out.z = q.z;
        // the closest point is the plane's foot (a face contact) exactly when its distance equals the plane distance
        out.kind = d2 - dist * dist < 1e-12 ? CONTACT_FACE : CONTACT_EDGE;
        return true;
      }
      return false;
    }
  }

  // A sphere whose centre is within a radius of the plane (straddling it) did not arrive through the face: it can only touch
  // the triangle's edges and vertices. Only a sphere outside the slab arrives at the face, at the time it comes one radius away.
  let t0, t1, embedded = false;
  if (adist < 1) {
    embedded = true; t0 = 0; t1 = 1;
  } else {
    t0 = (-1 - dist) / nv; t1 = (1 - dist) / nv;
    if (t0 > t1) { const t = t0; t0 = t1; t1 = t; }
    if (t0 > 1 || t1 < 0) return false;
    if (t0 < 0) t0 = 0;
    if (t1 > 1) t1 = 1;
  }

  let best = tLimit, found = false, kind = CONTACT_FACE, hx = 0, hy = 0, hz = 0;

  if (!embedded && t0 < best) {
    // where the sphere first touches the plane: its centre moved to the front side, one radius off the plane
    const side = dist >= 0 ? 1 : -1;
    const ix = px - side * nx + t0 * vx, iy = py - side * ny + t0 * vy, iz = pz - side * nz + t0 * vz;
    const v0x = e2x, v0y = e2y, v0z = e2z, v1x = e1x, v1y = e1y, v1z = e1z, v2x = ix - ax, v2y = iy - ay, v2z = iz - az;
    const d00 = v0x * v0x + v0y * v0y + v0z * v0z, d01 = v0x * v1x + v0y * v1y + v0z * v1z, d11 = v1x * v1x + v1y * v1y + v1z * v1z;
    const d20 = v2x * v0x + v2y * v0y + v2z * v0z, d21 = v2x * v1x + v2y * v1y + v2z * v1z;
    const denom = d00 * d11 - d01 * d01;
    if (denom !== 0) {
      const u = (d11 * d20 - d01 * d21) / denom, w = (d00 * d21 - d01 * d20) / denom;
      if (u >= -BARY_EPS && w >= -BARY_EPS && u + w <= 1 + BARY_EPS) { found = true; best = t0; hx = ix; hy = iy; hz = iz; kind = CONTACT_FACE; }
    }
  }

  if (!found) {
    const a2 = vx * vx + vy * vy + vz * vz;
    if (a2 > 0) {
      // vertices: |p + t v - vertex|^2 = 1
      for (let k = 0; k < 3; k++) {
        const qx = k === 0 ? ax : k === 1 ? bx : cx, qy = k === 0 ? ay : k === 1 ? by : cy, qz = k === 0 ? az : k === 1 ? bz : cz;
        const dx = px - qx, dy = py - qy, dz = pz - qz;
        const t = lowestRoot(a2, 2 * (vx * dx + vy * dy + vz * dz), dx * dx + dy * dy + dz * dz - 1, best);
        if (t < best) { best = t; found = true; hx = qx; hy = qy; hz = qz; kind = CONTACT_VERTEX; }
      }
      // edges
      for (let k = 0; k < 3; k++) {
        const qx = k === 0 ? ax : k === 1 ? bx : cx, qy = k === 0 ? ay : k === 1 ? by : cy, qz = k === 0 ? az : k === 1 ? bz : cz;
        const rx = k === 0 ? bx : k === 1 ? cx : ax, ry = k === 0 ? by : k === 1 ? cy : ay, rz = k === 0 ? bz : k === 1 ? cz : az;
        const ex = rx - qx, ey = ry - qy, ez = rz - qz;
        const bvx = qx - px, bvy = qy - py, bvz = qz - pz; // sphere centre to edge start
        const sq = ex * ex + ey * ey + ez * ez;
        const edv = ex * vx + ey * vy + ez * vz, edb = ex * bvx + ey * bvy + ez * bvz;
        const a = sq * -a2 + edv * edv;
        const b = sq * 2 * (vx * bvx + vy * bvy + vz * bvz) - 2 * edv * edb;
        const c = sq * (1 - (bvx * bvx + bvy * bvy + bvz * bvz)) + edb * edb;
        if (a === 0) continue; // moving parallel to the edge: its end vertices cover the contact
        const t = lowestRoot(a, b, c, best);
        if (t < best) {
          const f = (edv * t - edb) / sq;
          if (f >= 0 && f <= 1) { best = t; found = true; hx = qx + f * ex; hy = qy + f * ey; hz = qz + f * ez; kind = CONTACT_EDGE; }
        }
      }
    }
  }
  if (!found) return false;
  out.t = best; out.x = hx; out.y = hy; out.z = hz; out.kind = kind;
  return true;
}

/**
 * Ray against a triangle (Moeller-Trumbore), two-sided.
 * @returns {number} Distance along the (unit or not) direction as a multiple of it, or -1 for a miss. Only hits in (0, maxT] count.
 */
export function rayTriangle(ox, oy, oz, dx, dy, dz, ax, ay, az, bx, by, bz, cx, cy, cz, maxT) {
  const e1x = bx - ax, e1y = by - ay, e1z = bz - az, e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
  const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
  const det = e1x * px + e1y * py + e1z * pz;
  if (det === 0) return -1; // parallel to the triangle
  const inv = 1 / det;
  const tx = ox - ax, ty = oy - ay, tz = oz - az;
  const u = (tx * px + ty * py + tz * pz) * inv;
  if (u < -BARY_EPS || u > 1 + BARY_EPS) return -1;
  const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
  const v = (dx * qx + dy * qy + dz * qz) * inv;
  if (v < -BARY_EPS || u + v > 1 + BARY_EPS) return -1;
  const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
  return t > 0 && t <= maxT ? t : -1;
}
