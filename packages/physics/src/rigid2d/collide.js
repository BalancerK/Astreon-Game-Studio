// Narrow phase: where two shapes touch. Every function fills a Manifold2D with up to two contact points and a normal that points from the first body toward the second.
// Each point has an id naming the features that made it (which edges, which end), so the solver can keep a contact's accumulated impulse from one step to the next.

/** Where two shapes touch: up to two points (`px`, `py`, `sep` negative when overlapping, `id`) and the normal (`nx`, `ny`) from the first shape toward the second. */
export class Manifold2D {
  constructor() {
    this.count = 0;
    this.nx = 0; this.ny = 0;
    this.px = [0, 0]; this.py = [0, 0];
    this.sep = [0, 0];        // negative when overlapping
    this.id = [0, 0];
  }
  clear() { this.count = 0; return this; }
  add(px, py, sep, id) { const k = this.count++; this.px[k] = px; this.py[k] = py; this.sep[k] = sep; this.id[k] = id; }
}

function circleCircle(m, a, b, margin) {
  const dx = b.x - a.x, dy = b.y - a.y, r = a.shape.radius + b.shape.radius, d2 = dx * dx + dy * dy;
  if (d2 > (r + margin) * (r + margin)) return;
  const d = Math.sqrt(d2);
  if (d > 1e-9) { m.nx = dx / d; m.ny = dy / d; } else { m.nx = 0; m.ny = 1; }
  const sep = d - r;
  m.add(a.x + m.nx * (a.shape.radius + sep / 2), a.y + m.ny * (a.shape.radius + sep / 2), sep, 0);
}

/** A polygon (p) against a circle (c): normal points from the polygon to the circle. */
function polygonCircle(m, p, c, margin) {
  const n = p.shape.count, rc = c.shape.radius;
  let best = -Infinity, edge = 0;
  for (let i = 0; i < n; i++) {
    const s = p.wnx[i] * (c.x - p.wx[i]) + p.wny[i] * (c.y - p.wy[i]);
    if (s > best) { best = s; edge = i; }
  }
  if (best > rc + margin) return false;
  const j = edge + 1 === n ? 0 : edge + 1, x1 = p.wx[edge], y1 = p.wy[edge], x2 = p.wx[j], y2 = p.wy[j];
  const ex = x2 - x1, ey = y2 - y1;
  const u1 = (c.x - x1) * ex + (c.y - y1) * ey, u2 = (c.x - x2) * -ex + (c.y - y2) * -ey;
  if (u1 <= 0 || u2 <= 0) {                                              // nearest to a corner
    const vx = u1 <= 0 ? x1 : x2, vy = u1 <= 0 ? y1 : y2, id = u1 <= 0 ? edge : j;
    const dx = c.x - vx, dy = c.y - vy, d2 = dx * dx + dy * dy;
    if (d2 > (rc + margin) * (rc + margin)) return false;
    const d = Math.sqrt(d2);
    if (d > 1e-9) { m.nx = dx / d; m.ny = dy / d; } else { m.nx = p.wnx[edge]; m.ny = p.wny[edge]; }
    const sep = d - rc;
    m.add(c.x - m.nx * (rc + sep / 2), c.y - m.ny * (rc + sep / 2), sep, id + 1);
    return true;
  }
  m.nx = p.wnx[edge]; m.ny = p.wny[edge];
  const sep = best - rc;
  m.add(c.x - m.nx * (best + rc) / 2, c.y - m.ny * (best + rc) / 2, sep, 0);
  return true;
}

// how far the polygon b lies in front of the face of a that it is most behind
const sepResult = { sep: 0, edge: 0 };
function maxSeparation(a, b) {
  let best = -Infinity, edge = 0;
  const na = a.shape.count, nb = b.shape.count;
  for (let i = 0; i < na; i++) {
    const nx = a.wnx[i], ny = a.wny[i], vx = a.wx[i], vy = a.wy[i];
    let min = Infinity;
    for (let k = 0; k < nb; k++) { const s = nx * (b.wx[k] - vx) + ny * (b.wy[k] - vy); if (s < min) min = s; }
    if (min > best) { best = min; edge = i; }
  }
  sepResult.sep = best; sepResult.edge = edge;
  return sepResult;
}

const clipA = [0, 0, 0, 0, 0, 0], clipB = [0, 0, 0, 0, 0, 0];   // up to two points, each x, y, tag

function polygonPolygon(m, a, b, margin) {
  const sa = maxSeparation(a, b), sepA = sa.sep, edgeA = sa.edge;
  if (sepA > margin) return;
  const sb = maxSeparation(b, a), sepB = sb.sep, edgeB = sb.edge;
  if (sepB > margin) return;
  const flip = sepB > sepA + 0.0005;
  const ref = flip ? b : a, inc = flip ? a : b, refEdge = flip ? edgeB : edgeA;
  const nx = ref.wnx[refEdge], ny = ref.wny[refEdge];
  // the incident face: the one of the other polygon that faces most nearly against the reference normal
  let incEdge = 0, min = Infinity;
  for (let i = 0; i < inc.shape.count; i++) { const d = nx * inc.wnx[i] + ny * inc.wny[i]; if (d < min) { min = d; incEdge = i; } }
  const ni = inc.shape.count, i2 = incEdge + 1 === ni ? 0 : incEdge + 1;
  const r1 = refEdge, r2 = refEdge + 1 === ref.shape.count ? 0 : refEdge + 1;
  const x1 = ref.wx[r1], y1 = ref.wy[r1], x2 = ref.wx[r2], y2 = ref.wy[r2];
  let tx = x2 - x1, ty = y2 - y1;
  const tl = Math.sqrt(tx * tx + ty * ty); tx /= tl; ty /= tl;
  // clip the incident edge to the sides of the reference face
  clipA[0] = inc.wx[incEdge]; clipA[1] = inc.wy[incEdge]; clipA[2] = 0;
  clipA[3] = inc.wx[i2]; clipA[4] = inc.wy[i2]; clipA[5] = 1;
  let n1 = clip(clipB, clipA, tx, ty, tx * x1 + ty * y1, 2);
  if (n1 < 2) return;
  const n2 = clip(clipA, clipB, -tx, -ty, -(tx * x2 + ty * y2), 3);
  if (n2 < 2) return;
  m.nx = flip ? -nx : nx; m.ny = flip ? -ny : ny;
  const base = (flip ? 1 : 0) | (refEdge << 1) | (incEdge << 6);
  for (let k = 0; k < 2; k++) {
    const px = clipA[k * 3], py = clipA[k * 3 + 1], sep = nx * (px - x1) + ny * (py - y1);
    if (sep <= margin) m.add(px - nx * sep / 2, py - ny * sep / 2, sep, base | (clipA[k * 3 + 2] << 11));
  }
  void n1;
}

/** Keep the part of the segment `from` (two points) where dot(point, (tx, ty)) >= offset; returns how many points are left (0, 1 or 2). */
function clip(out, from, tx, ty, offset, tag) {
  let n = 0;
  const d0 = tx * from[0] + ty * from[1] - offset, d1 = tx * from[3] + ty * from[4] - offset;
  if (d0 >= 0) { out[0] = from[0]; out[1] = from[1]; out[2] = from[2]; n = 1; }
  if (d1 >= 0) { out[n * 3] = from[3]; out[n * 3 + 1] = from[4]; out[n * 3 + 2] = from[5]; n++; }
  if (d0 * d1 < 0 && n < 2) {
    const t = d0 / (d0 - d1);
    out[n * 3] = from[0] + t * (from[3] - from[0]); out[n * 3 + 1] = from[1] + t * (from[4] - from[1]); out[n * 3 + 2] = tag;
    n++;
  }
  return n;
}

/**
 * Find where bodies `a` and `b` touch. `margin` lets contacts that are not quite touching through (so a resting body keeps its contact between steps).
 * @param {Manifold2D} m
 * @returns {Manifold2D} the same manifold, with `count` 0 when they do not touch
 */
export function collide2D(m, a, b, margin = 0.02) {
  m.count = 0;
  const ta = a.shape.type, tb = b.shape.type;
  if (ta === 'circle' && tb === 'circle') circleCircle(m, a, b, margin);
  else if (ta === 'polygon' && tb === 'polygon') polygonPolygon(m, a, b, margin);
  else if (ta === 'polygon') polygonCircle(m, a, b, margin);
  else if (polygonCircle(m, b, a, margin)) { m.nx = -m.nx; m.ny = -m.ny; }     // the circle is first: turn the normal round
  return m;
}
