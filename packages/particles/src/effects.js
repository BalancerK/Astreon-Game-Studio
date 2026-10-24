// Ready-made effects, as plain data: copy one and change what you like (`{ ...effects.sparks, count: 30 }`).
// Sizes are world units (metres), so they suit a human-scale game; pass `scale` to `burst` for bigger or smaller.

const smoke = { count: [3, 5], life: [0.7, 1.3], speed: [0.2, 0.8], spread: 0.6, size: [0.12, 0.2], sizeEnd: [2.5, 3.5], color: [0.55, 0.55, 0.55, 0.32], colorEnd: [0.35, 0.35, 0.35, 0], drag: 1.5, gravity: -0.05, spin: [-1.5, 1.5], fadeIn: 0.1 };

/**
 * Ready-made effects as plain data (`muzzleFlash`, `impact`, `sparks`, `dust`, `explosion`, `bulletHole`, …). Copy one and change
 * what you like: `{ ...effects.sparks, count: 30 }`.
 */
export const effects = {
  /** A gun's muzzle: a bright flash and a puff of smoke, along `dir`. */
  muzzleFlash: [
    { count: 1, life: 0.06, size: [0.2, 0.28], sizeEnd: 0.4, color: [1, 0.85, 0.45, 1], colorEnd: [1, 0.5, 0.1, 0], additive: 1, hold: 0.3, spin: [-4, 4] },
    { count: 4, life: [0.05, 0.1], speed: [4, 9], spread: 0.25, size: 0.012, color: [1, 0.9, 0.55, 1], colorEnd: [1, 0.5, 0.1, 0], additive: 1, orient: 'stretch', stretch: 0.05, hardness: 0.5 },
    { ...smoke, count: 2, size: [0.06, 0.1], speed: [0.5, 1.5], spread: 0.35, color: [0.7, 0.7, 0.7, 0.22] },
  ],
  /** A bullet hitting a surface, along its normal: sparks, dust and a flash. */
  impact: [
    { count: [6, 10], life: [0.25, 0.55], speed: [3, 8], spread: 1.0, size: 0.018, color: [1, 0.7, 0.28, 1], colorEnd: [1, 0.3, 0.05, 0], additive: 1, orient: 'stretch', stretch: 0.017, gravity: 1, bounce: 0.35, hardness: 0.5, hold: 0.4 },
    { count: [3, 5], life: [0.4, 0.8], speed: [0.5, 2], spread: 1.2, size: [0.06, 0.1], sizeEnd: [2, 3], color: [0.72, 0.66, 0.55, 0.6], colorEnd: [0.6, 0.55, 0.45, 0], drag: 2.2, gravity: 0.1, fadeIn: 0.1, spin: [-2, 2] },
    { count: 1, life: 0.07, size: 0.16, sizeEnd: 0.5, color: [1, 0.9, 0.6, 0.9], colorEnd: [1, 0.6, 0.2, 0], additive: 1 },
  ],
  /** A mark on a surface (pass the surface normal as `dir`). Lies flat, stays a while, then fades. */
  bulletHole: { count: 1, life: 20, size: 0.055, color: [0.04, 0.04, 0.05, 0.9], colorEnd: [0.04, 0.04, 0.05, 0], orient: 'flat', hardness: 1, hold: 0.8 },
  /** A hit on a player: a red-orange burst that falls. */
  hit: [
    { count: [8, 12], life: [0.3, 0.6], speed: [1.5, 4], spread: 1.3, size: [0.03, 0.06], sizeEnd: 0.5, color: [0.9, 0.12, 0.08, 1], colorEnd: [0.5, 0.03, 0.02, 0], gravity: 1.2, drag: 0.8, hardness: 0.6, hold: 0.4 },
    { count: 1, life: 0.12, size: 0.22, sizeEnd: 0.6, color: [1, 0.3, 0.2, 0.6], colorEnd: [1, 0.2, 0.1, 0], additive: 0.6 },
  ],
  /** Dust kicked up by feet, a jump or a landing (at ground level). */
  dust: { count: [3, 5], life: [0.35, 0.7], speed: [0.4, 1.4], spread: 1.4, size: [0.05, 0.09], sizeEnd: [2, 3], color: [0.7, 0.64, 0.52, 0.28], colorEnd: [0.6, 0.55, 0.45, 0], drag: 3, gravity: -0.1, fadeIn: 0.15, spin: [-2, 2] },
  /** A harder landing. */
  landDust: { count: [8, 12], life: [0.4, 0.8], speed: [1, 2.8], spread: 1.57, dir: [0, 1, 0], size: [0.07, 0.12], sizeEnd: [2.5, 3.5], color: [0.7, 0.64, 0.52, 0.32], colorEnd: [0.6, 0.55, 0.45, 0], drag: 3.5, fadeIn: 0.1, spin: [-2, 2] },
  /** A puff of smoke. */
  smoke,
  /** A fiery explosion: flash, fireball, sparks, smoke. Pass `scale` to size it. */
  explosion: [
    { count: 1, life: 0.15, size: 1.2, sizeEnd: 0.6, color: [1, 0.9, 0.6, 1], colorEnd: [1, 0.5, 0.1, 0], additive: 1, hold: 0.2 },
    { count: [10, 16], life: [0.35, 0.7], speed: [1, 4], spread: Math.PI, size: [0.3, 0.5], sizeEnd: [1.5, 2.2], color: [1, 0.6, 0.2, 0.9], colorEnd: [0.3, 0.05, 0.0, 0], additive: 0.7, drag: 2.5, spin: [-2, 2], hold: 0.2 },
    { count: [18, 28], life: [0.5, 1.1], speed: [5, 14], spread: Math.PI, size: 0.03, color: [1, 0.8, 0.4, 1], colorEnd: [1, 0.3, 0.05, 0], additive: 1, orient: 'stretch', stretch: 0.02, gravity: 1, bounce: 0.3, hardness: 0.5, hold: 0.4 },
    { count: [8, 12], life: [1.2, 2.2], speed: [0.5, 2.5], spread: Math.PI, size: [0.4, 0.7], sizeEnd: [2.5, 4], color: [0.2, 0.2, 0.2, 0.55], colorEnd: [0.1, 0.1, 0.1, 0], drag: 1.2, gravity: -0.08, spin: [-1, 1], fadeIn: 0.1 },
  ],
  /** A glow for a moving bullet; use with `system.line` or an emitter. */
  tracerGlow: { count: 1, life: [0.08, 0.16], size: 0.05, sizeEnd: 0.3, color: [1, 0.9, 0.5, 0.7], colorEnd: [1, 0.5, 0.1, 0], additive: 1, hardness: 0.2 },
  /** A steady halo around a lamp (a long-lived, additive, soft sprite; make one per lamp). */
  lampHalo: { count: 1, life: 1e9, size: 0.45, color: [1, 0.8, 0.45, 0.35], colorEnd: [1, 0.8, 0.45, 0.35], additive: 1 },
};
