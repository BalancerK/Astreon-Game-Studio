// Quaternions as plain arrays [x, y, z, w] (unit length for rotations); output-first and allocation-free.
// Deterministic: sin, cos and atan2 come from this package, never Math.*.
import { sincos, atan2 } from './trig.js';

const sc = [0, 0];

/** Set `out` to the identity rotation [0, 0, 0, 1]. Returns `out`. */
export const identity = (out) => { out[0] = 0; out[1] = 0; out[2] = 0; out[3] = 1; return out; };
/** out = a. Returns `out`. */
export const copy = (out, a) => { out[0] = a[0]; out[1] = a[1]; out[2] = a[2]; out[3] = a[3]; return out; };
/** out = the conjugate of `a` (the inverse rotation, for a unit quaternion). Returns `out`. */
export const conjugate = (out, a) => { out[0] = -a[0]; out[1] = -a[1]; out[2] = -a[2]; out[3] = a[3]; return out; };
/** The dot product of two quaternions (1 means the same rotation, for unit quaternions). */
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];

/** Rotation of `angle` radians around the (unit) `axis`. */
export function fromAxisAngle(out, axis, angle) {
  sincos(angle * 0.5, sc);
  out[0] = axis[0] * sc[0]; out[1] = axis[1] * sc[0]; out[2] = axis[2] * sc[0]; out[3] = sc[1];
  return out;
}

/** Hamilton product: the rotation that applies `b` first, then `a`. `out` may be `a` or `b`. */
export function multiply(out, a, b) {
  const ax = a[0], ay = a[1], az = a[2], aw = a[3], bx = b[0], by = b[1], bz = b[2], bw = b[3];
  out[0] = aw * bx + ax * bw + ay * bz - az * by;
  out[1] = aw * by - ax * bz + ay * bw + az * bx;
  out[2] = aw * bz + ax * by - ay * bx + az * bw;
  out[3] = aw * bw - ax * bx - ay * by - az * bz;
  return out;
}

/** Scale to unit length; a zero quaternion becomes the identity. */
export function normalize(out, a) {
  const len = Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2] + a[3] * a[3]);
  if (len === 0) return identity(out);
  const inv = 1 / len;
  out[0] = a[0] * inv; out[1] = a[1] * inv; out[2] = a[2] * inv; out[3] = a[3] * inv;
  return out;
}

/**
 * First-person camera orientation: yaw around +y, then pitch around the new +x, then roll around the new +z
 * (the "YXZ" order). Rotating (0, 0, -1) by the result gives `forward(yaw, pitch)` from vec3.js.
 */
export function fromYawPitchRoll(out, yaw, pitch, roll = 0) {
  sincos(yaw * 0.5, sc); const sy = sc[0], cy = sc[1];
  sincos(pitch * 0.5, sc); const sp = sc[0], cp = sc[1];
  sincos(roll * 0.5, sc); const sr = sc[0], cr = sc[1];
  out[0] = cy * sp * cr + sy * cp * sr;
  out[1] = sy * cp * cr - cy * sp * sr;
  out[2] = cy * cp * sr - sy * sp * cr;
  out[3] = cy * cp * cr + sy * sp * sr;
  return out;
}

/** Rotate the vector `v` by the unit quaternion `q`. `out` may be `v`. */
export function rotate(out, q, v) {
  const qx = q[0], qy = q[1], qz = q[2], qw = q[3], vx = v[0], vy = v[1], vz = v[2];
  // t = 2 * (q.xyz x v); v' = v + w * t + q.xyz x t
  const tx = 2 * (qy * vz - qz * vy), ty = 2 * (qz * vx - qx * vz), tz = 2 * (qx * vy - qy * vx);
  out[0] = vx + qw * tx + (qy * tz - qz * ty);
  out[1] = vy + qw * ty + (qz * tx - qx * tz);
  out[2] = vz + qw * tz + (qx * ty - qy * tx);
  return out;
}

/** Normalised linear interpolation: cheap, and good for small steps. */
export function nlerp(out, a, b, t) {
  const flip = dot(a, b) < 0 ? -1 : 1;
  out[0] = a[0] + (b[0] * flip - a[0]) * t;
  out[1] = a[1] + (b[1] * flip - a[1]) * t;
  out[2] = a[2] + (b[2] * flip - a[2]) * t;
  out[3] = a[3] + (b[3] * flip - a[3]) * t;
  return normalize(out, out);
}

/** Spherical interpolation along the shortest arc at constant angular speed. */
export function slerp(out, a, b, t) {
  let d = dot(a, b);
  const flip = d < 0 ? -1 : 1;
  d *= flip;
  if (d > 0.9995) return nlerp(out, a, b, t); // nearly parallel: the arc is a straight line to within rounding
  const sinTheta = Math.sqrt(1 - d * d);
  const theta = atan2(sinTheta, d);
  sincos((1 - t) * theta, sc); const wa = sc[0] / sinTheta;
  sincos(t * theta, sc); const wb = sc[0] / sinTheta;
  out[0] = a[0] * wa + b[0] * flip * wb;
  out[1] = a[1] * wa + b[1] * flip * wb;
  out[2] = a[2] * wa + b[2] * flip * wb;
  out[3] = a[3] * wa + b[3] * flip * wb;
  return out;
}
