/**
 * Positional audio maths: how loud and how far left or right a sound at a point in the world is for a listener. Pure functions
 * (no Web Audio), so they are easy to test and to reuse (for example to pick which sounds are worth starting at all).
 * Conventions match the rest of the engine: right-handed, +y up, a camera at yaw 0 and pitch 0 looks down -z, positive yaw turns left.
 */

/** Where the listener is and which way it faces. Create with `createListener()`. */
export function createListener() {
  return { x: 0, y: 0, z: 0, fx: 0, fy: 0, fz: -1, ux: 0, uy: 1, uz: 0 };
}

/**
 * Put a listener at a position, facing the way a camera with this yaw and pitch looks.
 * @returns {ReturnType<typeof createListener>} the same listener
 */
export function setListenerFromYawPitch(listener, x, y, z, yaw, pitch = 0) {
  const cp = Math.cos(pitch);
  listener.x = x; listener.y = y; listener.z = z;
  listener.fx = -Math.sin(yaw) * cp; listener.fy = Math.sin(pitch); listener.fz = -Math.cos(yaw) * cp;
  listener.ux = 0; listener.uy = 1; listener.uz = 0;
  return listener;
}

/**
 * @typedef {Object} DistanceOptions
 * @property {'inverse' | 'linear' | 'exponential'} [model] How loudness falls with distance (default 'inverse', like real sound)
 * @property {number} [refDistance] Closer than this a sound is at full volume (default 1 m)
 * @property {number} [maxDistance] Beyond this a sound is silent and not worth playing (default 50 m)
 * @property {number} [rolloff] How fast it falls (default 1)
 */

const smoothstep = (a, b, v) => { const t = Math.max(0, Math.min(1, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

/**
 * Loudness of a source at a distance: the chosen model between `refDistance` and `maxDistance`, then a smooth fade to zero over
 * the last fifth of that range so nothing pops out of existence.
 * @param {number} distance
 * @param {DistanceOptions} [o]
 */
export function distanceGain(distance, { model = 'inverse', refDistance = 1, maxDistance = 50, rolloff = 1 } = {}) {
  const ref = Math.max(refDistance, 1e-6), max = Math.max(maxDistance, ref * 1.0001);
  const d = Math.max(ref, Math.min(distance, max));
  let g;
  switch (model) {
    case 'linear': g = 1 - (rolloff * (d - ref)) / (max - ref); break;
    case 'exponential': g = Math.pow(d / ref, -rolloff); break;
    case 'inverse': g = ref / (ref + rolloff * (d - ref)); break;
    default: throw new Error(`unknown distance model "${model}"`);
  }
  g = Math.max(0, Math.min(1, g));
  return g * (1 - smoothstep(max * 0.8, max, distance));
}

/**
 * How a source at (x, y, z) sounds to a listener.
 * @param {ReturnType<typeof createListener>} listener
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @param {DistanceOptions} [o]
 * @param {{gain: number, pan: number, distance: number}} [out]
 * @returns {{gain: number, pan: number, distance: number}} gain 0..1; pan -1 (full left) .. 1 (full right); distance in metres
 */
export function spatialize(listener, x, y, z, o = {}, out = { gain: 0, pan: 0, distance: 0 }) {
  const dx = x - listener.x, dy = y - listener.y, dz = z - listener.z;
  const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
  out.distance = distance;
  out.gain = distanceGain(distance, o);
  // right = forward x up
  let rx = listener.fy * listener.uz - listener.fz * listener.uy, ry = listener.fz * listener.ux - listener.fx * listener.uz, rz = listener.fx * listener.uy - listener.fy * listener.ux;
  const rl = Math.sqrt(rx * rx + ry * ry + rz * rz) || 1;
  rx /= rl; ry /= rl; rz /= rl;
  const ref = o.refDistance ?? 1;
  // a source right on top of the listener has no direction: ease the pan to the centre as it gets within a quarter of the reference distance
  const near = smoothstep(0, ref * 0.5, distance);
  out.pan = distance < 1e-6 ? 0 : Math.max(-1, Math.min(1, ((dx * rx + dy * ry + dz * rz) / distance) * near));
  return out;
}
