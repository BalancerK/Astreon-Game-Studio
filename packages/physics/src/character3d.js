import { moveEllipsoid, pushOutEllipsoid, findGround, createSlide3Result } from './slide3d.js';

const A = createSlide3Result(), B = createSlide3Result(), C = createSlide3Result(), D = createSlide3Result();
const G = { nx: 0, ny: 1, nz: 0, tri: -1, y: 0 };

/**
 * A first- or third-person character body: walks on slopes, climbs steps, falls, jumps, stands still without jitter and
 * slides down surfaces that are too steep. Collision is an ellipsoid swept through a `TriWorld`, so nothing tunnels at any
 * speed. One `update` is one tick: the same function runs on the server (authoritative) and in the client (prediction),
 * and uses only + - * / and sqrt, so both get the same bits on every engine.
 *
 * Coordinates: +y up. `x, y, z` is the centre of the body; the feet are at `y - halfHeight`.
 */
export class CharacterController {
  /**
   * @param {object} [o]
   * @param {number} [o.x] @param {number} [o.y] @param {number} [o.z] Starting centre.
   * @param {number} [o.radius] Horizontal radius.
   * @param {number} [o.halfHeight] Half the body's height.
   * @param {number} [o.stepHeight] Highest ledge it walks up without jumping.
   * @param {number} [o.minGroundNormalY] A surface counts as ground (walkable) when its normal's y is at least this: 0.7 is about 45 degrees, 0.5 is 60.
   * @param {number} [o.gravity] Units per second squared.
   * @param {number} [o.jumpSpeed] Initial upward speed of a jump.
   * @param {number} [o.maxFallSpeed]
   * @param {number} [o.snapDistance] How far it follows the ground down (slopes, small drops) instead of leaving it.
   */
  constructor({ x = 0, y = 0, z = 0, radius = 0.4, halfHeight = 0.9, stepHeight = 0.45, minGroundNormalY = 0.7, gravity = 25, jumpSpeed = 8, maxFallSpeed = 60, snapDistance } = {}) {
    this.x = x; this.y = y; this.z = z;
    this.radius = radius;
    this.halfHeight = halfHeight;
    this.stepHeight = stepHeight;
    this.minGroundNormalY = minGroundNormalY;
    this.gravity = gravity;
    this.jumpSpeed = jumpSpeed;
    this.maxFallSpeed = maxFallSpeed;
    this.snapDistance = snapDistance ?? stepHeight + 0.05;
    /** Vertical velocity. */
    this.vy = 0;
    this.grounded = false;
    /** Normal of the ground it stands on (valid while `grounded`). */
    this.groundNx = 0; this.groundNy = 1; this.groundNz = 0;
    /** True if the last update was blocked by a wall or a surface too steep to walk on. */
    this.blocked = false;
  }

  /** The y of the soles of the feet. */
  get feetY() { return this.y - this.halfHeight; }

  /**
   * Advance one tick.
   * @param {import('./tri-world.js').TriWorld} world
   * @param {number} wishX Desired horizontal velocity (units per second), x
   * @param {number} wishZ Desired horizontal velocity, z
   * @param {boolean} jump Jump button held (it jumps only from the ground)
   * @param {number} dt Seconds per tick
   */
  update(world, wishX, wishZ, jump, dt) {
    const r = this.radius, hh = this.halfHeight;
    // 0. squeeze out of anything it is embedded in (spawns, teleports)
    A.x = this.x; A.y = this.y; A.z = this.z;
    if (pushOutEllipsoid(world, A, r, hh, r)) { this.x = A.x; this.y = A.y; this.z = A.z; }

    // 1. vertical velocity
    if (this.grounded && jump) { this.vy = this.jumpSpeed; this.grounded = false; }
    else if (!this.grounded) { this.vy -= this.gravity * dt; if (this.vy < -this.maxFallSpeed) this.vy = -this.maxFallSpeed; }
    else this.vy = 0;

    // 2. walk (follow the ground plane when standing on it so slopes keep their pace and never bounce)
    const hx = wishX * dt, hz = wishZ * dt;
    let hy = 0;
    if (this.grounded && this.groundNy > 1e-6) hy = -(this.groundNx * hx + this.groundNz * hz) / this.groundNy;
    this.blocked = false;
    if (hx !== 0 || hz !== 0) this.#walk(world, hx, hy, hz);

    // 3. fall / rise, and stay glued to the ground
    this.#vertical(world, dt);
  }

  #walk(world, hx, hy, hz) {
    const r = this.radius, hh = this.halfHeight;
    const x0 = this.x, y0 = this.y, z0 = this.z;
    moveEllipsoid(world, x0, y0, z0, hx, hy, hz, r, hh, r, A, this.minGroundNormalY);
    let fx = A.x, fy = A.y, fz = A.z;
    const wanted = Math.sqrt(hx * hx + hz * hz);
    const got = Math.sqrt((A.x - x0) * (A.x - x0) + (A.z - z0) * (A.z - z0));
    let wall = false;
    for (let i = 0; i < A.count; i++) if (A.normals[i * 3 + 1] < this.minGroundNormalY) wall = true;
    if (wall && got < wanted - 1e-6) this.blocked = true;

    if (this.blocked && this.grounded && this.stepHeight > 0) {
      // try to step up onto what is in the way: up, forward, down; keep it only if it gets further and lands on walkable ground
      moveEllipsoid(world, x0, y0, z0, 0, this.stepHeight, 0, r, hh, r, B);
      const up = B.y - y0;
      if (up > 1e-6) {
        moveEllipsoid(world, B.x, B.y, B.z, hx, 0, hz, r, hh, r, C, this.minGroundNormalY);
        const advanced = Math.sqrt((C.x - x0) * (C.x - x0) + (C.z - z0) * (C.z - z0));
        if (advanced > got + 1e-4) {
          moveEllipsoid(world, C.x, C.y, C.z, 0, -(up + this.snapDistance), 0, r, hh, r, D, 0, true); // a probe: stop on the ground, do not slide
          // the surface it lands on may be at most one step height above where the feet started (judged by the height of the touched
          // point, not of the body: an ellipsoid's rounded bottom would otherwise ride onto the rim of a ledge higher than a step)
          if (D.hit && findGround(world, D.x, D.y, D.z, r, hh, r, G) && G.ny >= this.minGroundNormalY && G.y - (y0 - hh) <= this.stepHeight + 2e-3) { fx = D.x; fy = D.y; fz = D.z; this.blocked = false; }
        }
      }
    }
    this.x = fx; this.y = fy; this.z = fz;
  }

  #vertical(world, dt) {
    const r = this.radius, hh = this.halfHeight;
    const wasGrounded = this.grounded;
    if (wasGrounded) {
      // standing: probe down a little so slopes and small drops keep the feet on the floor; stop on contact (never slide down
      // the slope it is standing on)
      moveEllipsoid(world, this.x, this.y, this.z, 0, -this.snapDistance, 0, r, hh, r, A, 0, true);
      this.x = A.x; this.y = A.y; this.z = A.z;
      this.#settle(world);
      return;
    }
    const dy = this.vy * dt;
    if (dy > 0) { // rising: slide normally; a ceiling cancels the rise
      moveEllipsoid(world, this.x, this.y, this.z, 0, dy, 0, r, hh, r, A);
      this.x = A.x; this.y = A.y; this.z = A.z;
      for (let i = 0; i < A.count; i++) if (A.normals[i * 3 + 1] < -0.5) { this.vy = 0; break; }
      return;
    }
    // falling: stop at the first contact; if it is ground we have landed, otherwise (too steep) slide down it
    const y0 = this.y;
    moveEllipsoid(world, this.x, this.y, this.z, 0, dy, 0, r, hh, r, A, 0, true);
    this.x = A.x; this.y = A.y; this.z = A.z;
    if (A.hit && !this.#settle(world)) {
      const remaining = dy - (A.y - y0); // what is left of the fall (negative)
      moveEllipsoid(world, this.x, this.y, this.z, 0, remaining < 0 ? remaining : 0, 0, r, hh, r, B);
      this.x = B.x; this.y = B.y; this.z = B.z;
      this.blocked = true;
    }
  }

  /** Decide from what the body touches whether it stands on walkable ground. @returns {boolean} */
  #settle(world) {
    if (findGround(world, this.x, this.y, this.z, this.radius, this.halfHeight, this.radius, G) && G.ny >= this.minGroundNormalY) {
      this.grounded = true;
      this.vy = 0;
      this.groundNx = G.nx; this.groundNy = G.ny; this.groundNz = G.nz;
      return true;
    }
    this.grounded = false;
    return false;
  }
}
