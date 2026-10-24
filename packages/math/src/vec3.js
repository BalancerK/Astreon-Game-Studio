// 3D vectors as plain arrays [x, y, z] (or Float64Array(3)): no function here allocates; the first argument is the
// output (and may be one of the inputs). Right-handed, +x right, +y up, the camera looks down -z.
// Deterministic: only + - * / and sqrt, plus this package's own sin and cos.
import { sincos } from './trig.js';

/** A new vector [x, y, z]. */
export const create = (x = 0, y = 0, z = 0) => [x, y, z];
/** Set `out` to (x, y, z). Returns `out`. */
export const set = (out, x, y, z) => { out[0] = x; out[1] = y; out[2] = z; return out; };
/** out = a. Returns `out`. */
export const copy = (out, a) => { out[0] = a[0]; out[1] = a[1]; out[2] = a[2]; return out; };
/** out = a + b. Returns `out`. */
export const add = (out, a, b) => { out[0] = a[0] + b[0]; out[1] = a[1] + b[1]; out[2] = a[2] + b[2]; return out; };
/** out = a - b. Returns `out`. */
export const sub = (out, a, b) => { out[0] = a[0] - b[0]; out[1] = a[1] - b[1]; out[2] = a[2] - b[2]; return out; };
/** out = a * s. Returns `out`. */
export const scale = (out, a, s) => { out[0] = a[0] * s; out[1] = a[1] * s; out[2] = a[2] * s; return out; };
/** out = a + b * s */
export const addScaled = (out, a, b, s) => { out[0] = a[0] + b[0] * s; out[1] = a[1] + b[1] * s; out[2] = a[2] + b[2] * s; return out; };
/** The dot product of `a` and `b`. */
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
/** The squared length of `a` (no square root: cheaper for comparisons). */
export const lengthSq = (a) => a[0] * a[0] + a[1] * a[1] + a[2] * a[2];
/** The length of `a`. */
export const length = (a) => Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]);
/** The distance between points `a` and `b`. */
export const distance = (a, b) => { const x = a[0] - b[0], y = a[1] - b[1], z = a[2] - b[2]; return Math.sqrt(x * x + y * y + z * z); };
/** out = a + (b - a) * t. Returns `out`. */
export const lerp = (out, a, b, t) => { out[0] = a[0] + (b[0] - a[0]) * t; out[1] = a[1] + (b[1] - a[1]) * t; out[2] = a[2] + (b[2] - a[2]) * t; return out; };
/** out = -a. Returns `out`. */
export const negate = (out, a) => { out[0] = -a[0]; out[1] = -a[1]; out[2] = -a[2]; return out; };

/** out = a x b (right-handed). */
export function cross(out, a, b) {
  const x = a[1] * b[2] - a[2] * b[1], y = a[2] * b[0] - a[0] * b[2], z = a[0] * b[1] - a[1] * b[0];
  out[0] = x; out[1] = y; out[2] = z;
  return out;
}

/** Unit vector in the direction of `a`; the zero vector stays zero (never NaN). */
export function normalize(out, a) {
  const len = Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]);
  if (len === 0) { out[0] = 0; out[1] = 0; out[2] = 0; return out; }
  const inv = 1 / len;
  out[0] = a[0] * inv; out[1] = a[1] * inv; out[2] = a[2] * inv;
  return out;
}

const sy = [0, 0], sp = [0, 0];

/**
 * The direction a camera or player looks for the given angles. Yaw 0 looks down -z; positive yaw turns left
 * (counter-clockwise seen from above); positive pitch looks up.
 * @param {number[]} out
 * @param {number} yaw Radians
 * @param {number} pitch Radians
 */
export function forward(out, yaw, pitch) {
  sincos(yaw, sy); sincos(pitch, sp);
  out[0] = -sy[0] * sp[1];
  out[1] = sp[0];
  out[2] = -sy[1] * sp[1];
  return out;
}

/** The unit vector to the right of a yaw (always horizontal). */
export function right(out, yaw) {
  sincos(yaw, sy);
  out[0] = sy[1]; out[1] = 0; out[2] = -sy[0];
  return out;
}
