// Where, on the screen, a place in the world is from the middle of the view: for the arrows that point to whoever just hit you, to an objective that is off the screen, to a sound. Pure.

/**
 * Which way, on the screen, a place is from the crosshair: the angle of the arrow that points to it (0 is to the right, a quarter turn is down), and how far in front of the view it is (1 straight
 * ahead, -1 straight behind). It is worked out in the camera's own directions (right, up, forward), so it is true whatever the camera's pitch: looking up at the sky, a place below and in front points
 * down, and one behind you points up (the shortest way to face it is over the top), each to the side it really is on. The camera's convention is the one of this engine's renderer: yaw 0 looks along -z, and a positive pitch looks up.
 * @param {number[]} eye where the view is from @param {number[]} target the place @param {number} yaw the camera's yaw @param {number} pitch the camera's pitch (up is positive)
 * @returns {{angle: number, front: number, off: number} | null} `off` is how far from the middle of the view it is, in radians; null if it is on top of the eye
 */
export function screenDirection(eye, target, yaw, pitch) {
  const dx = target[0] - eye[0], dy = target[1] - eye[1], dz = target[2] - eye[2], len = Math.hypot(dx, dy, dz);
  if (len < 1e-6) return null;
  const cp = Math.cos(pitch), sp = Math.sin(pitch), fx = -Math.sin(yaw) * cp, fy = sp, fz = -Math.cos(yaw) * cp;       // forward
  const rx = Math.cos(yaw), rz = -Math.sin(yaw);                                                                         // right (level)
  const ux = -rz * fy, uy = rz * fx - rx * fz, uz = rx * fy;                                                              // up = right x forward
  const nx = dx / len, ny = dy / len, nz = dz / len;
  const front = nx * fx + ny * fy + nz * fz, sx = nx * rx + nz * rz, sy = nx * ux + ny * uy + nz * uz;
  return { angle: Math.atan2(-sy, sx), front, off: Math.acos(Math.max(-1, Math.min(1, front))) };
}
