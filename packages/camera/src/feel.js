// The small things that make a view feel physical: the shake of an explosion, a wider view at speed, and the stop of a heavy blow (hit-stop) with the punch of the view that goes with it. Pure.

/**
 * The camera shake of a given trauma (0 to 1), as offsets to add to the camera's position and roll. Trauma squared, so a light one is a tremor and a big one is felt.
 * @param {number} trauma 0 to 1 @param {number} clock seconds (any steadily growing time) @param {number} [strength] how much the player allows (0 to 1), and how hard the game shakes at all
 * @returns {{x: number, y: number, z: number, roll: number}} metres, and radians of roll
 */
export function traumaShake(trauma, clock, strength = 1) {
  const t = Math.min(1, Math.max(0, trauma)), a = t * t * 2.2 * strength;
  if (a === 0) return { x: 0, y: 0, z: 0, roll: 0 };
  return { x: Math.sin(clock * 91) * a, y: Math.sin(clock * 77 + 1) * a, z: Math.sin(clock * 83 + 2) * a, roll: Math.sin(clock * 67 + 3) * t * t * 0.03 * strength };
}

/**
 * A wider field of view the faster you go: the factor to multiply the field of view by, 1 up to `from` times top speed, then up to `1 + widen` at `from + over` times it.
 * @param {number} speed how fast now @param {number} topSpeed the speed that is "usual" fast @param {{widen?: number, from?: number, over?: number}} [o] by default 0.32 wider, from 1.2 times top speed over 2.2 more
 */
export function rushFov(speed, topSpeed, { widen = 0.32, from = 1.2, over = 2.2 } = {}) {
  const rush = speed / Math.max(1e-6, topSpeed);
  return 1 + widen * Math.max(0, Math.min(1, (rush - from) / over));
}

/**
 * Hit-stop and punch. A heavy blow freezes the game for a few ticks (`freeze`) and pulls the view in for a moment (`punch`, which fades). In the game loop, for each fixed tick ask `skip()`: while it
 * says true, do not step the simulation (and draw without moving things).
 * @param {{decay?: number}} [o] `decay` how much punch is lost each second (0.5)
 */
export function createHitStop({ decay = 0.5 } = {}) {
  let ticks = 0, punch = 0;
  return {
    /** Freeze for at least this many ticks (a longer one already going on is kept). @param {number} n */
    freeze(n) { ticks = Math.max(ticks, Math.round(n)); },
    /** Pull the view in at least this much (a bigger one already going on is kept; the amount is a fraction of the field of view). @param {number} amount */
    punch(amount) { punch = Math.max(punch, amount); },
    /** True if this tick is frozen (and uses one up); call once for each fixed tick. */
    skip() { if (ticks > 0) { ticks--; return true; } return false; },
    /** Whether a freeze is going on. */
    get frozen() { return ticks > 0; },
    /** How much the view is pulled in now. */
    get amount() { return punch; },
    /** Let the punch fade over `dt` seconds (once a frame). @param {number} dt */
    fade(dt) { punch = Math.max(0, punch - dt * decay); },
    /** Stop everything (a new match, a menu). */
    reset() { ticks = 0; punch = 0; },
  };
}
