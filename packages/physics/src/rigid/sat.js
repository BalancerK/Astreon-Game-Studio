// Box against box and box against triangle with the separating axis test, then face clipping to get a stable set of contact points
// (a box lying on a surface gets up to four, spread over the touching area, so it neither rocks nor sinks in).
// Only + - * / and sqrt.

const MAX = 16;
const bufA = new Float64Array(MAX * 3), bufB = new Float64Array(MAX * 3);
const kept = new Float64Array(MAX * 4); // x y z depth of the clipped points

/** Keep the vertices on the inner side of a plane (dot(p, n) - d <= 0 is inside): Sutherland-Hodgman. @returns {number} vertex count written to dst */
function clip(src, n, nx, ny, nz, d, dst) {
  let out = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ax = src[i * 3], ay = src[i * 3 + 1], az = src[i * 3 + 2], bx = src[j * 3], by = src[j * 3 + 1], bz = src[j * 3 + 2];
    const da = ax * nx + ay * ny + az * nz - d, db = bx * nx + by * ny + bz * nz - d;
    if (da <= 0) { if (out < MAX) { dst[out * 3] = ax; dst[out * 3 + 1] = ay; dst[out * 3 + 2] = az; out++; } }
    if ((da < 0 && db > 0) || (da > 0 && db < 0)) {
      const t = da / (da - db);
      if (out < MAX) { dst[out * 3] = ax + (bx - ax) * t; dst[out * 3 + 1] = ay + (by - ay) * t; dst[out * 3 + 2] = az + (bz - az) * t; out++; }
    }
  }
  return out;
}

/** Closest points between segments p1-q1 and p2-q2: out = [ax, ay, az, bx, by, bz]. */
export function closestSegments(p1x, p1y, p1z, q1x, q1y, q1z, p2x, p2y, p2z, q2x, q2y, q2z, out) {
  const d1x = q1x - p1x, d1y = q1y - p1y, d1z = q1z - p1z, d2x = q2x - p2x, d2y = q2y - p2y, d2z = q2z - p2z;
  const rx = p1x - p2x, ry = p1y - p2y, rz = p1z - p2z;
  const a = d1x * d1x + d1y * d1y + d1z * d1z, e = d2x * d2x + d2y * d2y + d2z * d2z, f = d2x * rx + d2y * ry + d2z * rz;
  let s, t;
  if (a <= 1e-12 && e <= 1e-12) { s = 0; t = 0; }
  else if (a <= 1e-12) { s = 0; t = Math.min(1, Math.max(0, f / e)); }
  else {
    const cc = d1x * rx + d1y * ry + d1z * rz;
    if (e <= 1e-12) { t = 0; s = Math.min(1, Math.max(0, -cc / a)); }
    else {
      const b = d1x * d2x + d1y * d2y + d1z * d2z, denom = a * e - b * b;
      s = denom > 1e-12 ? Math.min(1, Math.max(0, (b * f - cc * e) / denom)) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = Math.min(1, Math.max(0, -cc / a)); } else if (t > 1) { t = 1; s = Math.min(1, Math.max(0, (b - cc) / a)); }
    }
  }
  out[0] = p1x + d1x * s; out[1] = p1y + d1y * s; out[2] = p1z + d1z * s; out[3] = p2x + d2x * t; out[4] = p2y + d2y * t; out[5] = p2z + d2z * t;
}

/** Push the clipped polygon's points that are below the reference plane into the manifold, at most four, spread out. */
function emit(m, poly, count, cx, cy, cz, nx, ny, nz) {
  let k = 0;
  for (let i = 0; i < count; i++) {
    const px = poly[i * 3], py = poly[i * 3 + 1], pz = poly[i * 3 + 2];
    const s = (px - cx) * nx + (py - cy) * ny + (pz - cz) * nz; // signed distance above the reference face (outward normal n)
    if (s > 0.002) continue; // a hair of tolerance keeps resting contacts alive between steps
    const depth = -s;
    kept[k * 4] = px + nx * depth * 0.5; kept[k * 4 + 1] = py + ny * depth * 0.5; kept[k * 4 + 2] = pz + nz * depth * 0.5; kept[k * 4 + 3] = depth;
    k++;
  }
  if (k <= 4) { for (let i = 0; i < k; i++) m.add(kept[i * 4], kept[i * 4 + 1], kept[i * 4 + 2], kept[i * 4 + 3]); return; }
  // more than four: the deepest, the one farthest from it, then the two that enclose the most area on either side
  const pick = [0, 0, 0, 0];
  for (let i = 1; i < k; i++) if (kept[i * 4 + 3] > kept[pick[0] * 4 + 3]) pick[0] = i;
  const d2 = (i, j) => { const x = kept[i * 4] - kept[j * 4], y = kept[i * 4 + 1] - kept[j * 4 + 1], z = kept[i * 4 + 2] - kept[j * 4 + 2]; return x * x + y * y + z * z; };
  pick[1] = pick[0] === 0 ? 1 : 0;
  for (let i = 0; i < k; i++) if (i !== pick[0] && d2(i, pick[0]) > d2(pick[1], pick[0])) pick[1] = i;
  const area = (i) => { // signed area of (p0, p1, i) projected on the reference normal
    const ax = kept[pick[1] * 4] - kept[pick[0] * 4], ay = kept[pick[1] * 4 + 1] - kept[pick[0] * 4 + 1], az = kept[pick[1] * 4 + 2] - kept[pick[0] * 4 + 2];
    const bx = kept[i * 4] - kept[pick[0] * 4], by = kept[i * 4 + 1] - kept[pick[0] * 4 + 1], bz = kept[i * 4 + 2] - kept[pick[0] * 4 + 2];
    return (ay * bz - az * by) * nx + (az * bx - ax * bz) * ny + (ax * by - ay * bx) * nz;
  };
  let pos = -1, neg = -1, ap = 0, an = 0;
  for (let i = 0; i < k; i++) {
    if (i === pick[0] || i === pick[1]) continue;
    const a = area(i);
    if (a > ap) { ap = a; pos = i; } else if (a < an) { an = a; neg = i; }
  }
  for (const i of [pick[0], pick[1], pos, neg]) if (i >= 0) m.add(kept[i * 4], kept[i * 4 + 1], kept[i * 4 + 2], kept[i * 4 + 3]);
}

const L = [0, 0, 0];
const ea = [0, 0, 0, 0, 0, 0];

/** The four corners of the face of box b whose outward normal is `sign` times its axis `axis`, into buf. */
function faceCorners(b, axis, sign, buf) {
  const r = b.r, s = b.shape, h = [s.hx, s.hy, s.hz];
  const k = (axis + 1) % 3, l = (axis + 2) % 3;
  const cx = b.x + r[axis] * sign * h[axis], cy = b.y + r[3 + axis] * sign * h[axis], cz = b.z + r[6 + axis] * sign * h[axis];
  const kx = r[k] * h[k], ky = r[3 + k] * h[k], kz = r[6 + k] * h[k], lx = r[l] * h[l], ly = r[3 + l] * h[l], lz = r[6 + l] * h[l];
  buf[0] = cx - kx - lx; buf[1] = cy - ky - ly; buf[2] = cz - kz - lz;
  buf[3] = cx + kx - lx; buf[4] = cy + ky - ly; buf[5] = cz + kz - lz;
  buf[6] = cx + kx + lx; buf[7] = cy + ky + ly; buf[8] = cz + kz + lz;
  buf[9] = cx - kx + lx; buf[10] = cy - ky + ly; buf[11] = cz - kz + lz;
}

/** Clip a polygon to the side planes of box b's face along `axis` (the polygon lives in bufA, n vertices); returns the count, result in bufA. */
function clipToFaceSides(b, axis, n) {
  const r = b.r, s = b.shape, h = [s.hx, s.hy, s.hz];
  let src = bufA, dst = bufB;
  for (const side of [(axis + 1) % 3, (axis + 2) % 3]) {
    const ux = r[side], uy = r[3 + side], uz = r[6 + side], c = b.x * ux + b.y * uy + b.z * uz;
    for (const sg of [1, -1]) {
      n = clip(src, n, ux * sg, uy * sg, uz * sg, c * sg + h[side], dst);
      [src, dst] = [dst, src];
      if (n === 0) return 0;
    }
  }
  if (src !== bufA) bufA.set(src.subarray(0, n * 3));
  return n;
}

/**
 * Two boxes. The manifold's normal points from a to b.
 * @param {import('./body.js').RigidBody} a
 * @param {import('./body.js').RigidBody} b
 * @param {import('./contacts.js').Manifold} m
 */
export function boxBox(a, b, m) {
  const ra = a.r, rb = b.r, sa = a.shape, sb = b.shape;
  const ha = [sa.hx, sa.hy, sa.hz], hb = [sb.hx, sb.hy, sb.hz];
  const tx = b.x - a.x, ty = b.y - a.y, tz = b.z - a.z;
  let bestFace = Infinity, faceIndex = -1, faceSign = 1;
  let bestEdge = Infinity, edgeI = -1, edgeJ = -1, edgeSign = 1;
  const test = (lx, ly, lz) => { // returns the overlap (negative: separated) and the signed distance between centres along L
    const rA = ha[0] * Math.abs(ra[0] * lx + ra[3] * ly + ra[6] * lz) + ha[1] * Math.abs(ra[1] * lx + ra[4] * ly + ra[7] * lz) + ha[2] * Math.abs(ra[2] * lx + ra[5] * ly + ra[8] * lz);
    const rB = hb[0] * Math.abs(rb[0] * lx + rb[3] * ly + rb[6] * lz) + hb[1] * Math.abs(rb[1] * lx + rb[4] * ly + rb[7] * lz) + hb[2] * Math.abs(rb[2] * lx + rb[5] * ly + rb[8] * lz);
    const d = tx * lx + ty * ly + tz * lz;
    L[0] = rA + rB - Math.abs(d); L[1] = d;
  };
  for (let i = 0; i < 3; i++) {
    test(ra[i], ra[3 + i], ra[6 + i]);
    if (L[0] < 0) return;
    if (L[0] < bestFace) { bestFace = L[0]; faceIndex = i; faceSign = L[1] < 0 ? -1 : 1; }
  }
  for (let j = 0; j < 3; j++) {
    test(rb[j], rb[3 + j], rb[6 + j]);
    if (L[0] < 0) return;
    if (L[0] < bestFace) { bestFace = L[0]; faceIndex = 3 + j; faceSign = L[1] < 0 ? -1 : 1; }
  }
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      let cx = ra[3 + i] * rb[6 + j] - ra[6 + i] * rb[3 + j], cy = ra[6 + i] * rb[j] - ra[i] * rb[6 + j], cz = ra[i] * rb[3 + j] - ra[3 + i] * rb[j];
      const len = Math.sqrt(cx * cx + cy * cy + cz * cz);
      if (len < 1e-6) continue;
      cx /= len; cy /= len; cz /= len;
      test(cx, cy, cz);
      if (L[0] < 0) return;
      if (L[0] < bestEdge) { bestEdge = L[0]; edgeI = i; edgeJ = j; edgeSign = L[1] < 0 ? -1 : 1; }
    }
  }
  if (faceIndex < 0) return;
  if (bestEdge < bestFace * 0.9 - 1e-4) { // two edges are the closest feature: one contact point between them
    let cx = ra[3 + edgeI] * rb[6 + edgeJ] - ra[6 + edgeI] * rb[3 + edgeJ], cy = ra[6 + edgeI] * rb[edgeJ] - ra[edgeI] * rb[6 + edgeJ], cz = ra[edgeI] * rb[3 + edgeJ] - ra[3 + edgeI] * rb[edgeJ];
    const len = Math.sqrt(cx * cx + cy * cy + cz * cz); cx = cx / len * edgeSign; cy = cy / len * edgeSign; cz = cz / len * edgeSign;
    // the edge of a that faces b, and the edge of b that faces a
    let ax = a.x, ay = a.y, az = a.z, bx = b.x, by = b.y, bz = b.z;
    for (let k = 0; k < 3; k++) {
      if (k !== edgeI) { const sg = (ra[k] * cx + ra[3 + k] * cy + ra[6 + k] * cz) > 0 ? 1 : -1; ax += ra[k] * ha[k] * sg; ay += ra[3 + k] * ha[k] * sg; az += ra[6 + k] * ha[k] * sg; }
      if (k !== edgeJ) { const sg = (rb[k] * cx + rb[3 + k] * cy + rb[6 + k] * cz) > 0 ? -1 : 1; bx += rb[k] * hb[k] * sg; by += rb[3 + k] * hb[k] * sg; bz += rb[6 + k] * hb[k] * sg; }
    }
    const ux = ra[edgeI] * ha[edgeI], uy = ra[3 + edgeI] * ha[edgeI], uz = ra[6 + edgeI] * ha[edgeI], vx = rb[edgeJ] * hb[edgeJ], vy = rb[3 + edgeJ] * hb[edgeJ], vz = rb[6 + edgeJ] * hb[edgeJ];
    closestSegments(ax - ux, ay - uy, az - uz, ax + ux, ay + uy, az + uz, bx - vx, by - vy, bz - vz, bx + vx, by + vy, bz + vz, ea);
    m.setNormal(cx, cy, cz);
    m.add((ea[0] + ea[3]) * 0.5, (ea[1] + ea[4]) * 0.5, (ea[2] + ea[5]) * 0.5, bestEdge);
    return;
  }
  // a face of one box is the reference; the other box's most opposite face is clipped to it
  const refIsA = faceIndex < 3, ref = refIsA ? a : b, inc = refIsA ? b : a, refAxis = refIsA ? faceIndex : faceIndex - 3;
  const rr = ref.r, ri = inc.r;
  const sign = refIsA ? faceSign : -faceSign; // outward normal of the reference face, as sign * axis
  const nx = rr[refAxis] * sign, ny = rr[3 + refAxis] * sign, nz = rr[6 + refAxis] * sign;
  let incAxis = 0, bestDot = 0;
  for (let k = 0; k < 3; k++) { const d = ri[k] * nx + ri[3 + k] * ny + ri[6 + k] * nz; if (Math.abs(d) > Math.abs(bestDot)) { bestDot = d; incAxis = k; } }
  faceCorners(inc, incAxis, bestDot > 0 ? -1 : 1, bufA);
  const n = clipToFaceSides(ref, refAxis, 4);
  const hr = [ref.shape.hx, ref.shape.hy, ref.shape.hz][refAxis];
  m.setNormal(refIsA ? nx : -nx, refIsA ? ny : -ny, refIsA ? nz : -nz);
  emit(m, bufA, n, ref.x + nx * hr, ref.y + ny * hr, ref.z + nz * hr, nx, ny, nz);
}

const tri = new Float64Array(9);
const ax3 = [0, 0, 0];

/**
 * A box against one triangle (two-sided), the triangle being body B: the manifold's normal points from the box to the triangle.
 * @param {import('./body.js').RigidBody} a
 * @param {ArrayLike<number>} v Vertex data; the triangle starts at `o`.
 */
export function boxTriangle(a, v, o, m) {
  const r = a.r, s = a.shape, h = [s.hx, s.hy, s.hz];
  for (let i = 0; i < 9; i++) tri[i] = v[o + i];
  const e = [tri[3] - tri[0], tri[4] - tri[1], tri[5] - tri[2], tri[6] - tri[3], tri[7] - tri[4], tri[8] - tri[5], tri[0] - tri[6], tri[1] - tri[7], tri[2] - tri[8]];
  let nx = e[1] * -e[8] - e[2] * -e[7], ny = e[2] * -e[6] - e[0] * -e[8], nz = e[0] * -e[7] - e[1] * -e[6]; // (t1 - t0) x (t2 - t0)
  const nl = Math.sqrt(nx * nx + ny * ny + nz * nz);
  if (nl < 1e-12) return;
  nx /= nl; ny /= nl; nz /= nl;
  let best = Infinity, kind = 0, axisI = -1, edgeJ = -1, bsx = 0, bsy = 0, bsz = 0, sgn = 1;
  let bestFace = Infinity, fKind = 0, fAxis = -1, fsgn = 1;
  const probe = (lx, ly, lz) => { // overlap along L and which side the triangle is on (+1: triangle at larger L than the box)
    const rb = h[0] * Math.abs(r[0] * lx + r[3] * ly + r[6] * lz) + h[1] * Math.abs(r[1] * lx + r[4] * ly + r[7] * lz) + h[2] * Math.abs(r[2] * lx + r[5] * ly + r[8] * lz);
    const c = a.x * lx + a.y * ly + a.z * lz;
    const t0 = tri[0] * lx + tri[1] * ly + tri[2] * lz, t1 = tri[3] * lx + tri[4] * ly + tri[5] * lz, t2 = tri[6] * lx + tri[7] * ly + tri[8] * lz;
    const tmin = Math.min(t0, t1, t2), tmax = Math.max(t0, t1, t2);
    const up = c + rb - tmin, down = tmax - (c - rb); // the box passes the triangle's low end by `up`; the triangle passes the box's low end by `down`
    ax3[0] = Math.min(up, down); ax3[1] = up < down ? 1 : -1;
  };
  probe(nx, ny, nz);
  if (ax3[0] <= 0) return;
  bestFace = ax3[0]; fKind = 1; fsgn = ax3[1];
  for (let i = 0; i < 3; i++) {
    probe(r[i], r[3 + i], r[6 + i]);
    if (ax3[0] <= 0) return;
    if (ax3[0] < bestFace) { bestFace = ax3[0]; fKind = 2; fAxis = i; fsgn = ax3[1]; }
  }
  let bestEdge = Infinity, eI = -1, eJ = -1, eSgn = 1, ex = 0, ey = 0, ez = 0;
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      const bx = r[i], by = r[3 + i], bz = r[6 + i], dx = e[j * 3], dy = e[j * 3 + 1], dz = e[j * 3 + 2];
      let cx = by * dz - bz * dy, cy = bz * dx - bx * dz, cz = bx * dy - by * dx;
      const l = Math.sqrt(cx * cx + cy * cy + cz * cz);
      if (l < 1e-6 * Math.sqrt(dx * dx + dy * dy + dz * dz)) continue;
      cx /= l; cy /= l; cz /= l;
      probe(cx, cy, cz);
      if (ax3[0] <= 0) return;
      if (ax3[0] < bestEdge) { bestEdge = ax3[0]; eI = i; eJ = j; eSgn = ax3[1]; ex = cx; ey = cy; ez = cz; }
    }
  }
  if (bestEdge < bestFace * 0.9 - 1e-4) { // edge against edge
    const px = ex * eSgn, py = ey * eSgn, pz = ez * eSgn; // from the box toward the triangle
    let cx = a.x, cy = a.y, cz = a.z;
    for (let k = 0; k < 3; k++) if (k !== eI) { const sg = (r[k] * px + r[3 + k] * py + r[6 + k] * pz) > 0 ? 1 : -1; cx += r[k] * h[k] * sg; cy += r[3 + k] * h[k] * sg; cz += r[6 + k] * h[k] * sg; }
    const ux = r[eI] * h[eI], uy = r[3 + eI] * h[eI], uz = r[6 + eI] * h[eI];
    const j2 = (eJ + 1) % 3;
    closestSegments(cx - ux, cy - uy, cz - uz, cx + ux, cy + uy, cz + uz, tri[eJ * 3], tri[eJ * 3 + 1], tri[eJ * 3 + 2], tri[j2 * 3], tri[j2 * 3 + 1], tri[j2 * 3 + 2], ea);
    m.setNormal(px, py, pz);
    m.add((ea[0] + ea[3]) * 0.5, (ea[1] + ea[4]) * 0.5, (ea[2] + ea[5]) * 0.5, bestEdge);
    return;
  }
  if (fKind === 1) { // the triangle is the reference face: clip the box's lowest face to it
    const tx = nx * -fsgn, ty = ny * -fsgn, tz = nz * -fsgn; // from the triangle toward the box (outward normal of the reference)
    let incAxis = 0, bestDot = 0;
    for (let k = 0; k < 3; k++) { const d = r[k] * tx + r[3 + k] * ty + r[6 + k] * tz; if (Math.abs(d) > Math.abs(bestDot)) { bestDot = d; incAxis = k; } }
    faceCorners(a, incAxis, bestDot > 0 ? -1 : 1, bufA);
    let n = 4, src = bufA, dst = bufB;
    for (let j = 0; j < 3; j++) { // keep what is on the inner side of each triangle edge
      const dx = e[j * 3], dy = e[j * 3 + 1], dz = e[j * 3 + 2];
      let ix = ny * dz - nz * dy, iy = nz * dx - nx * dz, iz = nx * dy - ny * dx; // inward (left of the edge, seen from the winding normal)
      const il = Math.sqrt(ix * ix + iy * iy + iz * iz); ix /= il; iy /= il; iz /= il;
      const c = tri[j * 3] * ix + tri[j * 3 + 1] * iy + tri[j * 3 + 2] * iz;
      n = clip(src, n, -ix, -iy, -iz, -c, dst);
      [src, dst] = [dst, src];
      if (n === 0) return;
    }
    if (src !== bufA) bufA.set(src.subarray(0, n * 3));
    m.setNormal(-tx, -ty, -tz);
    emit(m, bufA, n, tri[0], tri[1], tri[2], tx, ty, tz);
    return;
  }
  // a face of the box is the reference: clip the triangle to its sides
  const refAxis = fAxis, sg = fsgn; // sg = +1: the triangle is at larger L than the box, so the box face points along +axis
  const bx = r[refAxis] * sg, by = r[3 + refAxis] * sg, bz = r[6 + refAxis] * sg;
  for (let i = 0; i < 9; i++) bufA[i] = tri[i];
  const n = clipToFaceSides(a, refAxis, 3);
  if (n === 0) return;
  m.setNormal(bx, by, bz);
  emit(m, bufA, n, a.x + bx * h[refAxis], a.y + by * h[refAxis], a.z + bz * h[refAxis], bx, by, bz);
}
