// The camera's kick: a landing drops the view and tips it down, a heavy blow throws it away from where the blow came from, and it swings back with one small overshoot (a spring a little under critical
// damping), the way the camera of a modern action game takes a hit. Presentation only: nothing here touches the game. Pure steps of a small state, so they can be tested.
//
//   const k = createKick();
//   kick(k, { pitch: -12, dip: 9 });                        // a push: the speeds given to each part
//   stepKick(k, dt);                                        // every frame
//   camera.pitch = aim + k.pitch; camera.roll = k.roll; camera.y -= k.dip * bodySize;

/** How stiff the spring is (per second squared) and how much of its speed it loses (per second): a damping ratio of 0.58, so it overshoots once and settles in about half a second. */
export const STIFFNESS = 90;
/** How much of its speed the spring loses each second (see `STIFFNESS`). */
export const DAMPING = 11;
/** The most the view can be turned or rolled by, in radians. */
export const MAX_ANGLE = 0.12;
/** The most the view can dip, in body sizes (a game multiplies `dip` by the size of what the camera is on). */
export const MAX_DIP = 0.9;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * A resting camera: pitch, yaw and roll (radians) and dip (in body sizes, downward), each with its speed.
 * @param {{stiffness?: number, damping?: number, maxAngle?: number, maxDip?: number}} [spring] another spring than the default
 */
export function createKick(spring = {}) {
  return { pitch: 0, pitchV: 0, yaw: 0, yawV: 0, roll: 0, rollV: 0, dip: 0, dipV: 0, spring: { stiffness: STIFFNESS, damping: DAMPING, maxAngle: MAX_ANGLE, maxDip: MAX_DIP, ...spring } };
}

/**
 * Push the camera: `pitch` (positive tips the view up), `yaw` (positive turns it right), `roll` and `dip` are the speeds given to each (about 14 times the most it will swing).
 * @param {ReturnType<typeof createKick>} k @param {{pitch?: number, yaw?: number, roll?: number, dip?: number}} push @returns {ReturnType<typeof createKick>}
 */
export function kick(k, { pitch = 0, yaw = 0, roll = 0, dip = 0 }) {
  k.pitchV += pitch; k.yawV += yaw; k.rollV += roll; k.dipV += dip;
  return k;
}

/** One step of `dt` seconds (in small slices, so a slow frame does not make it unstable). Returns `k`. @param {ReturnType<typeof createKick>} k @param {number} dt */
export function stepKick(k, dt) {
  const { stiffness, damping, maxAngle, maxDip } = k.spring;
  const n = Math.max(1, Math.ceil(dt / (1 / 120))), h = Math.min(dt, 0.1) / n;
  for (let i = 0; i < n; i++) {
    for (const [x, v] of [['pitch', 'pitchV'], ['yaw', 'yawV'], ['roll', 'rollV'], ['dip', 'dipV']]) {
      k[v] += (-stiffness * k[x] - damping * k[v]) * h;
      k[x] += k[v] * h;
    }
  }
  k.pitch = clamp(k.pitch, -maxAngle, maxAngle); k.yaw = clamp(k.yaw, -maxAngle, maxAngle); k.roll = clamp(k.roll, -maxAngle, maxAngle); k.dip = clamp(k.dip, -maxDip, maxDip);
  return k;
}
