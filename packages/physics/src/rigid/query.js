// Ray casts against bodies: sphere, box and capsule. Only + - * / and sqrt.

/**
 * The first hit of a ray (origin o, unit direction d) on a body within `maxT`, or -1. Writes the surface normal into n.
 * @param {import('./body.js').RigidBody} b
 * @param {number[]} n 3 numbers
 * @returns {number} distance along the ray, or -1
 */
export function rayBody(b, ox, oy, oz, dx, dy, dz, maxT, n) {
  const s = b.shape;
  if (s.type === 'sphere') return raySphere(ox, oy, oz, dx, dy, dz, b.x, b.y, b.z, s.radius, maxT, n);
  const r = b.r;
  // into the body's own frame
  const px = ox - b.x, py = oy - b.y, pz = oz - b.z;
  const lox = r[0] * px + r[3] * py + r[6] * pz, loy = r[1] * px + r[4] * py + r[7] * pz, loz = r[2] * px + r[5] * py + r[8] * pz;
  const ldx = r[0] * dx + r[3] * dy + r[6] * dz, ldy = r[1] * dx + r[4] * dy + r[7] * dz, ldz = r[2] * dx + r[5] * dy + r[8] * dz;
  let t = -1, nx = 0, ny = 0, nz = 0;
  if (s.type === 'box') {
    let tmin = 0, tmax = maxT, axis = -1, sign = 1;
    const h = [s.hx, s.hy, s.hz], o = [lox, loy, loz], d = [ldx, ldy, ldz];
    for (let i = 0; i < 3; i++) {
      if (Math.abs(d[i]) < 1e-12) { if (o[i] < -h[i] || o[i] > h[i]) return -1; continue; }
      let t1 = (-h[i] - o[i]) / d[i], t2 = (h[i] - o[i]) / d[i], sg = -1;
      if (t1 > t2) { const q = t1; t1 = t2; t2 = q; sg = 1; }
      if (t1 > tmin) { tmin = t1; axis = i; sign = sg; }
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return -1;
    }
    if (axis < 0) return -1; // started inside
    t = tmin;
    if (axis === 0) nx = sign; else if (axis === 1) ny = sign; else nz = sign;
  } else { // a capsule along local y: the side of the cylinder, then the two caps
    const ln = [0, 0, 0];
    const hh = s.halfHeight, rad = s.radius;
    let best = -1;
    const a = ldx * ldx + ldz * ldz, bq = lox * ldx + loz * ldz, c = lox * lox + loz * loz - rad * rad;
    if (a > 1e-12) {
      const disc = bq * bq - a * c;
      if (disc >= 0) {
        const tt = (-bq - Math.sqrt(disc)) / a, yy = loy + ldy * tt;
        if (tt >= 0 && tt <= maxT && yy >= -hh && yy <= hh) { best = tt; nx = lox + ldx * tt; ny = 0; nz = loz + ldz * tt; const l = Math.sqrt(nx * nx + nz * nz) || 1; nx /= l; nz /= l; }
      }
    }
    for (const cy of [-hh, hh]) {
      const tt = raySphere(lox, loy, loz, ldx, ldy, ldz, 0, cy, 0, rad, best >= 0 ? best : maxT, ln);
      if (tt >= 0 && (best < 0 || tt < best)) { best = tt; nx = ln[0]; ny = ln[1]; nz = ln[2]; }
    }
    t = best;
  }
  if (t < 0 || t > maxT) return -1;
  n[0] = r[0] * nx + r[1] * ny + r[2] * nz; n[1] = r[3] * nx + r[4] * ny + r[5] * nz; n[2] = r[6] * nx + r[7] * ny + r[8] * nz;
  return t;
}

function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, rad, maxT, n) {
  const mx = ox - cx, my = oy - cy, mz = oz - cz;
  const b = mx * dx + my * dy + mz * dz, c = mx * mx + my * my + mz * mz - rad * rad;
  if (c > 0 && b > 0) return -1;
  const disc = b * b - c;
  if (disc < 0) return -1;
  const t = -b - Math.sqrt(disc);
  if (t < 0 || t > maxT) return -1; // (a ray that starts inside hits nothing)
  const hx = ox + dx * t - cx, hy = oy + dy * t - cy, hz = oz + dz * t - cz, l = Math.sqrt(hx * hx + hy * hy + hz * hz) || 1;
  n[0] = hx / l; n[1] = hy / l; n[2] = hz / l;
  return t;
}
