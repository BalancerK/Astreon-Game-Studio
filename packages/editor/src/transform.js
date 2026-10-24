// Poses in scene files (`at`: x y z, yaw or a rotation quaternion, a uniform scale) as matrices, and back. The editor is a tool, not part of
// the shared simulation, so it uses the ordinary Math functions.
import { mat4, quat } from '../../math/src/index.js';

const DEG = 180 / Math.PI;
const RAD = Math.PI / 180;

/** The rotation of an `at` as a quaternion [x, y, z, w]. */
export function atRotation(at = {}) {
  if (at.rotation) { const q = [...at.rotation]; return quat.normalize(q, q); }
  if (at.yaw) return [0, Math.sin(at.yaw / 2), 0, Math.cos(at.yaw / 2)];
  return [0, 0, 0, 1];
}

/** `at` (or a local pose) as a matrix. */
export function atMatrix(at = {}, out = new Float64Array(16)) {
  const s = at.scale ?? 1;
  return mat4.compose(out, at.x ?? 0, at.y ?? 0, at.z ?? 0, atRotation(at), s, s, s);
}

/** Position, rotation (quaternion) and uniform scale of a matrix. */
export function decompose(m) {
  const sx = Math.hypot(m[0], m[1], m[2]);
  const s = sx || 1;
  // rotation matrix columns are the first three columns divided by scale
  const r00 = m[0] / s, r10 = m[1] / s, r20 = m[2] / s, r01 = m[4] / s, r11 = m[5] / s, r21 = m[6] / s, r02 = m[8] / s, r12 = m[9] / s, r22 = m[10] / s;
  const trace = r00 + r11 + r22;
  let q;
  if (trace > 0) { const k = Math.sqrt(trace + 1) * 2; q = [(r21 - r12) / k, (r02 - r20) / k, (r10 - r01) / k, 0.25 * k]; }
  else if (r00 > r11 && r00 > r22) { const k = Math.sqrt(1 + r00 - r11 - r22) * 2; q = [0.25 * k, (r01 + r10) / k, (r02 + r20) / k, (r21 - r12) / k]; }
  else if (r11 > r22) { const k = Math.sqrt(1 + r11 - r00 - r22) * 2; q = [(r01 + r10) / k, 0.25 * k, (r12 + r21) / k, (r02 - r20) / k]; }
  else { const k = Math.sqrt(1 + r22 - r00 - r11) * 2; q = [(r02 + r20) / k, (r12 + r21) / k, 0.25 * k, (r10 - r01) / k]; }
  return { position: [m[12], m[13], m[14]], rotation: quat.normalize(q, q), scale: sx };
}

/** Euler angles in degrees (rotate about x, then y, then z in the world's frame: R = Rz·Ry·Rx) from a quaternion. */
export function eulerFromQuat(q) {
  const m = mat4.fromQuat(new Float64Array(16), q);
  const r20 = m[2], r21 = m[6], r22 = m[10], r10 = m[1], r00 = m[0];
  const y = Math.asin(Math.max(-1, Math.min(1, -r20)));
  if (Math.abs(r20) > 0.999999) return [Math.atan2(-m[9], m[5]) * DEG, y * DEG, 0];
  return [Math.atan2(r21, r22) * DEG, y * DEG, Math.atan2(r10, r00) * DEG];
}

/** The quaternion for Euler degrees (inverse of `eulerFromQuat`). */
export function quatFromEuler(deg) {
  const [a, b, c] = deg.map((d) => d * RAD / 2);
  const qx = [Math.sin(a), 0, 0, Math.cos(a)], qy = [0, Math.sin(b), 0, Math.cos(b)], qz = [0, 0, Math.sin(c), Math.cos(c)];
  const t = quat.multiply([0, 0, 0, 1], qy, qx);
  return quat.multiply([0, 0, 0, 1], qz, t);
}

const round = (v, n = 6) => Math.round(v * 10 ** n) / 10 ** n;

/**
 * The `at` that puts something at a world pose when its parent has the given world matrix (null: no parent).
 * Keeps `yaw` if the old `at` used yaw and the new rotation is still about the vertical axis; otherwise writes a `rotation` quaternion.
 */
export function worldToLocalAt(parentWorld, position, rotation, scale, previous = {}) {
  const world = mat4.compose(new Float64Array(16), position[0], position[1], position[2], rotation, scale, scale, scale);
  let local = world;
  if (parentWorld) { const inv = new Float64Array(16); mat4.invert(inv, parentWorld); local = mat4.multiply(new Float64Array(16), inv, world); }
  const d = decompose(local);
  const at = { x: round(d.position[0]), y: round(d.position[1]), z: round(d.position[2]) };
  const q = d.rotation;
  const identity = Math.abs(q[0]) + Math.abs(q[1]) + Math.abs(q[2]) < 1e-6;
  const aboutY = Math.abs(q[0]) < 1e-6 && Math.abs(q[2]) < 1e-6;
  if (identity) { /* no rotation field at all */ }
  else if (aboutY && previous.yaw !== undefined) at.yaw = round(2 * Math.atan2(q[1], q[3]));
  else at.rotation = q.map((v) => round(v, 7));
  if (Math.abs(d.scale - 1) > 1e-6) at.scale = round(d.scale);
  return at;
}

/** Remove the keys of `at` that a patch should clear (`yaw`, `rotation`, `scale` not in the new at) as `null`s for `SceneDocument.update`. */
export function atPatch(oldAt, newAt) {
  const patch = { at: {} };
  for (const k of ['x', 'y', 'z', 'yaw', 'rotation', 'scale']) {
    if (newAt[k] !== undefined) patch.at[k] = newAt[k];
    else if (oldAt?.[k] !== undefined) patch.at[k] = null;
  }
  return patch;
}
