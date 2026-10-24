// Smooth drawing between fixed physics steps. Physics runs at a fixed rate (say 60 Hz) and the screen at whatever it likes (144 Hz, or 50 Hz with a
// hiccup), so drawing a body where the last step left it makes it stutter. This keeps the pose before each step and blends toward the pose after it.
// It only reads bodies and is for drawing: nothing here feeds back into the simulation, so it cannot change a replay or a network game.

/**
 * Blends each body between where it was before the last physics step and where it is now, so drawing at any frame rate looks smooth.
 * Works with `World2D` (bodies with `x, y, c, s`) and `PhysicsWorld` (bodies with `x, y, z` and a quaternion); rotations are blended the short way round.
 *
 * ```js
 * const view = new PoseInterpolator(world);
 * // in the fixed update:   view.snapshot(); world.step(dt);
 * // in the render, with the loop's alpha:   const p = view.pose(body, alpha, pose);   draw at p.x, p.y, p.angle
 * ```
 */
export class PoseInterpolator {
  /** @param {{ bodies: any[] }} world A `World2D` or `PhysicsWorld`. */
  constructor(world) {
    this.world = world;
    /** @type {Map<any, Float64Array>} */ this.before = new Map();
  }

  /** Remember every body's pose. Call it once right before each `world.step`. Bodies that have left the world are forgotten. */
  snapshot() {
    const bodies = this.world.bodies, before = this.before;
    if (before.size > bodies.length + 64) {           // many bodies came and went: drop the ones that are gone
      const live = new Set(bodies);
      for (const b of before.keys()) if (!live.has(b)) before.delete(b);
    }
    for (const b of bodies) {
      let p = before.get(b);
      if (!p) { p = new Float64Array(7); before.set(b, p); }
      if ('qw' in b) { p[0] = b.x; p[1] = b.y; p[2] = b.z; p[3] = b.qx; p[4] = b.qy; p[5] = b.qz; p[6] = b.qw; }
      else { p[0] = b.x; p[1] = b.y; p[3] = b.c; p[4] = b.s; }
    }
  }

  /** Forget where a body was, so it is drawn where it is now (after moving it with `setPosition`, say, when no step has run yet). */
  reset(body) { this.before.delete(body); }

  /**
   * The pose to draw a body at, `alpha` (0..1) of the way from its pose before the last step to its pose now. A body with no snapshot yet (just added) is
   * drawn where it is. 2D fills `x, y, c, s, angle`; 3D fills `x, y, z, qx, qy, qz, qw`.
   * @param {any} body @param {number} alpha @param {object} [out] Reused if given, so drawing allocates nothing.
   */
  pose(body, alpha, out = {}) {
    const p = this.before.get(body);
    if (!(alpha > 0) || !p) alpha = p ? 0 : 1;
    else if (alpha > 1) alpha = 1;
    const a = p ? alpha : 1, x0 = p ? p[0] : body.x, y0 = p ? p[1] : body.y;
    out.x = x0 + (body.x - x0) * a; out.y = y0 + (body.y - y0) * a;
    if ('qw' in body) {
      const z0 = p ? p[2] : body.z;
      out.z = z0 + (body.z - z0) * a;
      let x = p ? p[3] : body.qx, y = p ? p[4] : body.qy, z = p ? p[5] : body.qz, w = p ? p[6] : body.qw;
      const flip = x * body.qx + y * body.qy + z * body.qz + w * body.qw < 0 ? -1 : 1;     // take the short way round
      x += (flip * body.qx - x) * a; y += (flip * body.qy - y) * a; z += (flip * body.qz - z) * a; w += (flip * body.qw - w) * a;
      const len = Math.sqrt(x * x + y * y + z * z + w * w) || 1;
      out.qx = x / len; out.qy = y / len; out.qz = z / len; out.qw = w / len;
    } else {
      const c0 = p ? p[3] : body.c, s0 = p ? p[4] : body.s;
      let c = c0 + (body.c - c0) * a, s = s0 + (body.s - s0) * a;
      const len = Math.sqrt(c * c + s * s);
      if (len > 1e-9) { c /= len; s /= len; } else { c = body.c; s = body.s; }            // turned exactly half way round: no blend, take the new one
      out.c = c; out.s = s;
      out.angle = Math.atan2(s, c); // determinism-ok: for drawing only, never fed back into the simulation
    }
    return out;
  }
}
