// 4x4 matrices as plain arrays or Float32Array/Float64Array of 16, COLUMN-major (element [column * 4 + row]), the layout both
// WebGPU and WebGL expect, so a matrix can be uploaded as it is. Output-first and allocation-free, like vec3 and quat.
// Right-handed, +y up, the camera looks down -z. `perspective` and `orthographic` give clip-space depth in [0, 1] (WebGPU's
// convention; the WebGL2 renderer remaps it in the vertex shader).
// Deterministic: only + - * / and sqrt, plus this package's own sin, cos and tan.
import { tan } from './trig.js';
import * as quat from './quat.js';

/** A new identity matrix (16 numbers, column-major). */
export const create = () => identity(new Float64Array(16));

/** Set `out` to the identity matrix. Returns `out`. */
export function identity(out) {
  out.fill(0);
  out[0] = 1; out[5] = 1; out[10] = 1; out[15] = 1;
  return out;
}

/** out = a. Returns `out`. */
export function copy(out, a) {
  for (let i = 0; i < 16; i++) out[i] = a[i];
  return out;
}

/** out = a * b: the transform that applies `b` first, then `a`. `out` may be `a` or `b`. */
export function multiply(out, a, b) {
  const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3], a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
  const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11], a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
  for (let c = 0; c < 4; c++) {
    const b0 = b[c * 4], b1 = b[c * 4 + 1], b2 = b[c * 4 + 2], b3 = b[c * 4 + 3];
    out[c * 4] = a00 * b0 + a10 * b1 + a20 * b2 + a30 * b3;
    out[c * 4 + 1] = a01 * b0 + a11 * b1 + a21 * b2 + a31 * b3;
    out[c * 4 + 2] = a02 * b0 + a12 * b1 + a22 * b2 + a32 * b3;
    out[c * 4 + 3] = a03 * b0 + a13 * b1 + a23 * b2 + a33 * b3;
  }
  return out;
}

/** Set `out` to a move by (x, y, z). Returns `out`. */
export function translation(out, x, y, z) {
  identity(out);
  out[12] = x; out[13] = y; out[14] = z;
  return out;
}

/** Set `out` to a scale by (x, y, z). Returns `out`. */
export function scaling(out, x, y, z) {
  identity(out);
  out[0] = x; out[5] = y; out[10] = z;
  return out;
}

/** The rotation matrix of a unit quaternion [x, y, z, w]. */
export function fromQuat(out, q) {
  const x = q[0], y = q[1], z = q[2], w = q[3];
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2, wx = w * x2, wy = w * y2, wz = w * z2;
  out[0] = 1 - (yy + zz); out[1] = xy + wz; out[2] = xz - wy; out[3] = 0;
  out[4] = xy - wz; out[5] = 1 - (xx + zz); out[6] = yz + wx; out[7] = 0;
  out[8] = xz + wy; out[9] = yz - wx; out[10] = 1 - (xx + yy); out[11] = 0;
  out[12] = 0; out[13] = 0; out[14] = 0; out[15] = 1;
  return out;
}

/** A model matrix from a position, a rotation quaternion and a scale (the usual translate * rotate * scale). */
export function compose(out, px, py, pz, q, sx, sy, sz) {
  fromQuat(out, q);
  out[0] *= sx; out[1] *= sx; out[2] *= sx;
  out[4] *= sy; out[5] *= sy; out[6] *= sy;
  out[8] *= sz; out[9] *= sz; out[10] *= sz;
  out[12] = px; out[13] = py; out[14] = pz;
  return out;
}

/**
 * Perspective projection (right-handed, looking down -z; clip depth 0 at `near` and 1 at `far`).
 * @param {number} fovY Vertical field of view in radians
 * @param {number} aspect Width / height
 */
export function perspective(out, fovY, aspect, near, far) {
  const f = 1 / tan(fovY * 0.5);
  out.fill(0);
  out[0] = f / aspect;
  out[5] = f;
  out[10] = far / (near - far);
  out[11] = -1;
  out[14] = (near * far) / (near - far);
  return out;
}

/** Orthographic projection of the box [l, r] x [b, t] x [-near, -far] to clip space (depth 0..1). */
export function orthographic(out, l, r, b, t, near, far) {
  out.fill(0);
  out[0] = 2 / (r - l);
  out[5] = 2 / (t - b);
  out[10] = 1 / (near - far);
  out[12] = -(r + l) / (r - l);
  out[13] = -(t + b) / (t - b);
  out[14] = near / (near - far);
  out[15] = 1;
  return out;
}

/** The view matrix of a camera at `eye` looking at `target`; `up` is usually [0, 1, 0]. */
export function lookAt(out, eye, target, up) {
  let zx = eye[0] - target[0], zy = eye[1] - target[1], zz = eye[2] - target[2];
  const zl = Math.sqrt(zx * zx + zy * zy + zz * zz) || 1;
  zx /= zl; zy /= zl; zz /= zl;
  let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
  const xl = Math.sqrt(xx * xx + xy * xy + xz * xz) || 1;
  xx /= xl; xy /= xl; xz /= xl;
  const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
  out[0] = xx; out[1] = yx; out[2] = zx; out[3] = 0;
  out[4] = xy; out[5] = yy; out[6] = zy; out[7] = 0;
  out[8] = xz; out[9] = yz; out[10] = zz; out[11] = 0;
  out[12] = -(xx * eye[0] + xy * eye[1] + xz * eye[2]);
  out[13] = -(yx * eye[0] + yy * eye[1] + yz * eye[2]);
  out[14] = -(zx * eye[0] + zy * eye[1] + zz * eye[2]);
  out[15] = 1;
  return out;
}

const qInv = [0, 0, 0, 1], qLook = [0, 0, 0, 1];

/**
 * The view matrix of a first-person camera: at (x, y, z) with the orientation of yaw/pitch/roll (see quat.fromYawPitchRoll;
 * `vec3.forward(yaw, pitch)` is the direction it looks).
 */
export function viewFromYawPitch(out, x, y, z, yaw, pitch, roll = 0) {
  quat.fromYawPitchRoll(qLook, yaw, pitch, roll);
  quat.conjugate(qInv, qLook);
  fromQuat(out, qInv);
  out[12] = -(out[0] * x + out[4] * y + out[8] * z);
  out[13] = -(out[1] * x + out[5] * y + out[9] * z);
  out[14] = -(out[2] * x + out[6] * y + out[10] * z);
  return out;
}

/** out = a^-1, or the identity if `a` is singular. Returns false when it was singular. `out` may be `a`. */
export function invert(out, a) {
  const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3], a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
  const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11], a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
  const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10;
  const b03 = a01 * a12 - a02 * a11, b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30, b08 = a20 * a33 - a23 * a30;
  const b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
  let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (det === 0) { identity(out); return false; }
  det = 1 / det;
  out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
  out[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
  out[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
  out[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
  out[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
  out[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
  out[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
  out[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
  out[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
  out[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
  out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
  out[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
  out[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
  out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
  out[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
  out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
  return true;
}

/** Transform the point p by m (with the perspective divide). `out` may be `p`. */
export function transformPoint(out, m, p) {
  const x = p[0], y = p[1], z = p[2];
  const w = m[3] * x + m[7] * y + m[11] * z + m[15];
  const iw = w === 0 ? 1 : 1 / w;
  out[0] = (m[0] * x + m[4] * y + m[8] * z + m[12]) * iw;
  out[1] = (m[1] * x + m[5] * y + m[9] * z + m[13]) * iw;
  out[2] = (m[2] * x + m[6] * y + m[10] * z + m[14]) * iw;
  return out;
}

/** Transform the direction d by the upper 3x3 of m (no translation, no divide). `out` may be `d`. */
export function transformDirection(out, m, d) {
  const x = d[0], y = d[1], z = d[2];
  out[0] = m[0] * x + m[4] * y + m[8] * z;
  out[1] = m[1] * x + m[5] * y + m[9] * z;
  out[2] = m[2] * x + m[6] * y + m[10] * z;
  return out;
}
