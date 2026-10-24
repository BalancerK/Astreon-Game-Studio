import { PI, TWO_PI } from './trig.js';

/** Wrap an angle (radians) into [-pi, pi]. Exact for angles that are already inside. */
export function wrapAngle(a) {
  if (a >= -PI && a <= PI) return a;
  return a - TWO_PI * Math.round(a / TWO_PI);
}

/** The shortest signed turn from angle `from` to angle `to`, in [-pi, pi]. */
export function deltaAngle(from, to) {
  return wrapAngle(to - from);
}

/** Interpolate between two angles the short way round. */
export function lerpAngle(from, to, t) {
  return from + deltaAngle(from, to) * t;
}

/** Multiply degrees by this to get radians. */
export const DEG_TO_RAD = 0.017453292519943295;
/** Multiply radians by this to get degrees. */
export const RAD_TO_DEG = 57.29577951308232;
