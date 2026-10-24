// 2D shapes for rigid bodies: circles and convex polygons (boxes are polygons). Plain data, only + - * / and sqrt, so the same numbers come out everywhere.

const PI = 3.141592653589793;
/** The most points a polygon shape can have. */
export const MAX_POLYGON_VERTICES = 16;

/** @typedef {{type: 'circle', radius: number, area: number, inertia: number}} Circle */
/** @typedef {{type: 'polygon', count: number, xs: number[], ys: number[], nxs: number[], nys: number[], area: number, inertia: number, radius: number}} Polygon */

/** A circle with its centre at the body's position. Units are metres: keep a 1 x 1 crate near 1 unit and scale when you draw. */
export function circleShape(radius) {
  if (!(radius > 0)) throw new Error(`a circle needs a radius above 0 (got ${radius})`);
  return { type: 'circle', radius, area: PI * radius * radius, inertia: 0.5 * PI * radius * radius * radius * radius };
}

/**
 * A convex polygon from points given in order (either way round). The body's position is moved to the polygon's centre of mass: the points you give are
 * taken relative to the body's origin and re-centred, so `body.x, body.y` is where its middle is. At most 16 points.
 * @param {number[][]} points [[x, y], ...]
 * @returns {Polygon}
 */
export function polygonShape(points) {
  const n = points.length;
  if (n < 3 || n > MAX_POLYGON_VERTICES) throw new Error(`a polygon needs 3 to ${MAX_POLYGON_VERTICES} points (got ${n})`);
  let pts = points.map((p) => [p[0], p[1]]);
  let area2 = 0;
  for (let i = 0; i < n; i++) { const a = pts[i], b = pts[(i + 1) % n]; area2 += a[0] * b[1] - b[0] * a[1]; }
  if (area2 === 0) throw new Error('the polygon has no area (its points are in a line)');
  if (area2 < 0) pts = pts.reverse();
  // centroid
  let cx = 0, cy = 0, a2 = 0;
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n], cr = a[0] * b[1] - b[0] * a[1];
    cx += (a[0] + b[0]) * cr; cy += (a[1] + b[1]) * cr; a2 += cr;
  }
  cx /= 3 * a2; cy /= 3 * a2;
  const xs = [], ys = [], nxs = [], nys = [];
  for (const p of pts) { xs.push(p[0] - cx); ys.push(p[1] - cy); }
  let inertia = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n, ex = xs[j] - xs[i], ey = ys[j] - ys[i], len = Math.sqrt(ex * ex + ey * ey);
    if (len < 1e-9) throw new Error('the polygon has two points on top of each other');
    nxs.push(ey / len); nys.push(-ex / len);
    inertia += (xs[i] * ys[j] - xs[j] * ys[i]) * (xs[i] * xs[i] + ys[i] * ys[i] + xs[i] * xs[j] + ys[i] * ys[j] + xs[j] * xs[j] + ys[j] * ys[j]) / 12;
  }
  for (let i = 0; i < n; i++) {                                         // convex: every vertex lies behind every edge
    for (let j = 0; j < n; j++) {
      if (j === i || j === (i + 1) % n) continue;
      if (nxs[i] * (xs[j] - xs[i]) + nys[i] * (ys[j] - ys[i]) > 1e-9) throw new Error('the polygon is not convex; split it into convex pieces (one body each, joined with a weld)');
    }
  }
  return { type: 'polygon', count: n, xs, ys, nxs, nys, area: a2 / 2, inertia, radius: 0 };
}

/** A box from its half width and half height (a 1 x 1 crate is `boxShape(0.5, 0.5)`). */
export function boxShape(hx, hy) {
  if (!(hx > 0 && hy > 0)) throw new Error(`a box needs half sizes above 0 (got ${hx}, ${hy})`);
  return polygonShape([[-hx, -hy], [hx, -hy], [hx, hy], [-hx, hy]]);
}

/** Radius of the circle around the shape's centre that holds all of it. */
export function shapeRadius(s) {
  if (s.type === 'circle') return s.radius;
  let r = 0;
  for (let i = 0; i < s.count; i++) { const d = s.xs[i] * s.xs[i] + s.ys[i] * s.ys[i]; if (d > r) r = d; }
  return Math.sqrt(r);
}

/** Sine and cosine from + - * / only (a series after bringing the angle near zero), the same in every browser and on the server. */
export function sinCos(angle) {
  const TWO_PI = 6.283185307179586;
  let a = angle - TWO_PI * Math.floor(angle / TWO_PI + 0.5);              // -pi .. pi
  // fold into -pi/2 .. pi/2 where the series is short: sin(pi - a) = sin a, cos(pi - a) = -cos a
  let flip = 1;
  if (a > PI / 2) { a = PI - a; flip = -1; } else if (a < -PI / 2) { a = -PI - a; flip = -1; }
  const a2 = a * a;
  let s = a, c = 1, ts = a, tc = 1;
  for (let k = 1; k <= 9; k++) {
    ts = -ts * a2 / ((2 * k) * (2 * k + 1)); s += ts;
    tc = -tc * a2 / ((2 * k - 1) * (2 * k)); c += tc;
  }
  return [s, c * flip];
}
