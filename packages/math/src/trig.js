// Deterministic trigonometry: sin, cos, tan, atan, atan2, asin, acos built ONLY from + - * / and comparisons (plus
// Math.floor / Math.sqrt / Math.abs, which every engine computes exactly). The language leaves Math.sin and friends
// implementation-defined, and V8, SpiderMonkey and JavaScriptCore really do return different last bits; shared
// simulation code (anything the server and the predicting client must agree on bit for bit) therefore must not call them.
//
// The algorithms are the classic fdlibm kernels (the reference many libms descend from): argument reduction by
// Cody-Waite subtraction of pi/2 split into three parts, then a polynomial on [-pi/4, pi/4]. Results are within about
// one unit in the last place of the true value, verified against Math.* in the tests, and BIT-IDENTICAL across engines,
// verified by `node tools/determinism.js` (Node, Chrome, Firefox).
//
// Large arguments: reduction is exact for |x| up to about 1.6e6 radians. Beyond that it falls back to reducing by
// whole turns, which loses precision (but stays deterministic). Wrap angles to (-pi, pi] (see angle.js) before using them.

/** π. */
export const PI = 3.141592653589793;
/** 2π. */
export const TWO_PI = 6.283185307179586;
/** π / 2. */
export const HALF_PI = 1.5707963267948966;
/** π / 4. */
export const QUARTER_PI = 0.7853981633974483;

// fdlibm __kernel_sin and __kernel_cos coefficients
const S1 = -1.66666666666666324348e-01;
const S2 = 8.33333333332248946124e-03;
const S3 = -1.98412698298579493134e-04;
const S4 = 2.75573137070700676789e-06;
const S5 = -2.50507602534068634195e-08;
const S6 = 1.58969099521155010221e-10;
const C1 = 4.16666666666666019037e-02;
const C2 = -1.38888888888741095749e-03;
const C3 = 2.48015872894767294178e-05;
const C4 = -2.75573143513906633035e-07;
const C5 = 2.08757232129817482790e-09;
const C6 = -1.13596475577881948265e-11;

// pi/2 split into pieces of 33 bits so n * piece is exact for n < 2^20 (fdlibm __ieee754_rem_pio2)
const INV_PIO2 = 6.36619772367581382433e-01;
const PIO2_1 = 1.57079632673412561417e+00;
const PIO2_2 = 6.07710050630396597660e-11;
const PIO2_2T = 2.02226624879595063154e-21;
const PIO2_3 = 2.02226624871116645580e-21;
const PIO2_3T = 8.47842766036889956997e-32;

const TINY_ARG = 7.450580596923828e-9; // 2^-27: sin(x) = x and cos(x) = 1 to double precision
const MAX_REDUCIBLE = 1.6e6;

/** sin on [-pi/4, pi/4] for x = a + b where b is the tiny correction left by the reduction. */
function kernelSin(a, b) {
  if (a < 0 ? -a < TINY_ARG : a < TINY_ARG) return a;
  const z = a * a, v = z * a;
  const r = S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)));
  return a - ((z * (0.5 * b - v * r) - b) - v * S1);
}

/** cos on [-pi/4, pi/4] for x = a + b. */
function kernelCos(a, b) {
  const z = a * a;
  if ((a < 0 ? -a : a) < TINY_ARG) return 1;
  const r = z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))));
  return 1 - (0.5 * z - (z * r - a * b));
}

// result of the last reduction (module scratch: single-threaded, and every use reads it immediately)
let redN = 0, redY0 = 0, redY1 = 0;

/** Reduce x (any finite number) to n quarter turns plus a remainder y0 + y1 in [-pi/4, pi/4]. */
function reduce(x) {
  const t = x < 0 ? -x : x;
  if (t <= QUARTER_PI) { redN = 0; redY0 = x; redY1 = 0; return; }
  let u = t;
  if (u > MAX_REDUCIBLE) u -= TWO_PI * Math.floor(u / TWO_PI); // beyond the exact range: whole turns first (precision is lost, determinism is not)
  const fn = Math.floor(u * INV_PIO2 + 0.5);
  let r = u - fn * PIO2_1;
  let w = fn * PIO2_2;
  let s = r;
  r = s - w;
  w = fn * PIO2_2T - ((s - r) - w);
  s = r;
  w = fn * PIO2_3;
  r = s - w;
  w = fn * PIO2_3T - ((s - r) - w);
  const y0 = r - w;
  const y1 = (r - y0) - w;
  const n = fn % 4;
  if (x < 0) { redN = -n; redY0 = -y0; redY1 = -y1; } else { redN = n; redY0 = y0; redY1 = y1; }
}

/**
 * Sine of `x` (radians), computed with + - * / only, so the result is the same bits in every engine (unlike `Math.sin`).
 *
 * @param {number} x Radians.
 */
export function sin(x) {
  if (x !== x || x === Infinity || x === -Infinity) return NaN;
  reduce(x);
  switch (redN & 3) {
    case 0: return kernelSin(redY0, redY1);
    case 1: return kernelCos(redY0, redY1);
    case 2: return -kernelSin(redY0, redY1);
    default: return -kernelCos(redY0, redY1);
  }
}

/**
 * Cosine of `x` (radians), computed with + - * / only, so the result is the same bits in every engine (unlike `Math.cos`).
 *
 * @param {number} x Radians.
 */
export function cos(x) {
  if (x !== x || x === Infinity || x === -Infinity) return NaN;
  reduce(x);
  switch (redN & 3) {
    case 0: return kernelCos(redY0, redY1);
    case 1: return -kernelSin(redY0, redY1);
    case 2: return -kernelCos(redY0, redY1);
    default: return kernelSin(redY0, redY1);
  }
}

/**
 * Both at once with a single argument reduction: the right call for rotations.
 * @param {number} x Radians.
 * @param {number[] | Float64Array} out Receives [sin, cos].
 */
export function sincos(x, out) {
  if (x !== x || x === Infinity || x === -Infinity) { out[0] = NaN; out[1] = NaN; return out; }
  reduce(x);
  const s = kernelSin(redY0, redY1), c = kernelCos(redY0, redY1);
  switch (redN & 3) {
    case 0: out[0] = s; out[1] = c; break;
    case 1: out[0] = c; out[1] = -s; break;
    case 2: out[0] = -s; out[1] = -c; break;
    default: out[0] = -c; out[1] = s; break;
  }
  return out;
}

/**
 * Tangent of `x` (radians), computed with + - * / only, so the result is the same bits in every engine.
 *
 * @param {number} x Radians. Near odd multiples of pi/2 the result is huge, as it should be.
 */
export function tan(x) {
  const s = sin(x), c = cos(x);
  return s / c;
}

const ATAN_HI = [4.63647609000806093515e-01, 7.85398163397448278999e-01, 9.82793723247329054082e-01, 1.57079632679489655800e+00];
const ATAN_LO = [2.26987774529616870924e-17, 3.06161699786838301793e-17, 1.39033110312309984516e-17, 6.12323399573676603587e-17];
const AT0 = 3.33333333333329318027e-01, AT1 = -1.99999999998764832476e-01, AT2 = 1.42857142725034663711e-01, AT3 = -1.11111104054623557880e-01;
const AT4 = 9.09088713343650656196e-02, AT5 = -7.69187620504482999495e-02, AT6 = 6.66107313738753120669e-02, AT7 = -5.83357013379057348645e-02;
const AT8 = 4.97687799461593236017e-02, AT9 = -3.65315727442169155270e-02, AT10 = 1.62858201153657823623e-02;

/**
 * Arc tangent of `x` in radians (-π/2 to π/2), computed with + - * / only, so the result is the same bits in every engine.
 *
 * @param {number} x
 * @returns {number} Radians in [-pi/2, pi/2].
 */
export function atan(x) {
  if (x !== x) return NaN;
  const neg = x < 0;
  let t = neg ? -x : x;
  if (t >= 7.378697629483821e19) return neg ? -(ATAN_HI[3] + ATAN_LO[3]) : ATAN_HI[3] + ATAN_LO[3]; // |x| >= 2^66
  let id = -1;
  if (t < 0.4375) {
    if (t < 1.862645149230957e-9) return x; // 2^-29
  } else if (t < 1.1875) {
    if (t < 0.6875) { id = 0; t = (2.0 * t - 1.0) / (2.0 + t); } else { id = 1; t = (t - 1.0) / (t + 1.0); }
  } else if (t < 2.4375) {
    id = 2; t = (t - 1.5) / (1.0 + 1.5 * t);
  } else {
    id = 3; t = -1.0 / t;
  }
  const z = t * t, w = z * z;
  const s1 = z * (AT0 + w * (AT2 + w * (AT4 + w * (AT6 + w * (AT8 + w * AT10)))));
  const s2 = w * (AT1 + w * (AT3 + w * (AT5 + w * (AT7 + w * AT9))));
  if (id < 0) return neg ? -(t - t * (s1 + s2)) : t - t * (s1 + s2);
  const r = ATAN_HI[id] - ((t * (s1 + s2) - ATAN_LO[id]) - t);
  return neg ? -r : r;
}

const PI_LO = 1.2246467991473531772e-16;
const TWO_POW_60 = 1.152921504606847e18, TWO_POW_M60 = 8.673617379884035e-19;

/** Angle of the point (x, y) from the +x axis, in (-pi, pi]; same special cases as Math.atan2. */
export function atan2(y, x) {
  if (x !== x || y !== y) return NaN;
  const yNeg = y < 0 || (y === 0 && 1 / y < 0), xNeg = x < 0 || (x === 0 && 1 / x < 0);
  const ay = yNeg ? -y : y, ax = xNeg ? -x : x;
  if (y === 0) return xNeg ? (yNeg ? -PI : PI) : y; // +-0 keeps its sign when x is positive
  if (x === 0) return yNeg ? -HALF_PI : HALF_PI;
  if (ax === Infinity) {
    if (ay === Infinity) { const q = 0.7853981633974483 * (xNeg ? 3 : 1); return yNeg ? -q : q; }
    if (!xNeg) return yNeg ? -0 : 0;
    return yNeg ? -PI : PI;
  }
  if (ay === Infinity) return yNeg ? -HALF_PI : HALF_PI;
  let z;
  if (ay > ax * TWO_POW_60) z = HALF_PI + 0.5 * PI_LO;
  else if (xNeg && ay < ax * TWO_POW_M60) z = 0;
  else z = atan(ay / ax);
  if (!xNeg) return yNeg ? -z : z;
  return yNeg ? (z - PI_LO) - PI : PI - (z - PI_LO);
}

/**
 * Arc sine of `x` in radians (-π/2 to π/2), computed with + - * / and sqrt only, so the result is the same bits in every engine.
 *
 * @param {number} x In [-1, 1]; NaN outside.
 * @returns {number} Radians in [-pi/2, pi/2].
 */
export function asin(x) {
  if (!(x >= -1 && x <= 1)) return NaN;
  return atan2(x, Math.sqrt((1 - x) * (1 + x)));
}

/**
 * Arc cosine of `x` in radians (0 to π), computed with + - * / and sqrt only, so the result is the same bits in every engine.
 *
 * @param {number} x In [-1, 1]; NaN outside.
 * @returns {number} Radians in [0, pi].
 */
export function acos(x) {
  if (!(x >= -1 && x <= 1)) return NaN;
  return atan2(Math.sqrt((1 - x) * (1 + x)), x);
}
