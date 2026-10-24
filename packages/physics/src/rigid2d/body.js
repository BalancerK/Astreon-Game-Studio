import { shapeRadius, sinCos } from './shapes.js';

let nextId = 1;
/** Start body numbers again from 1 (a new world, or a test that wants stable numbers). */
export function resetBodyIds2D() { nextId = 1; }

/**
 * A 2D simulated object: a circle or convex polygon with mass, friction, bounciness and damping, of type `dynamic` (simulated), `kinematic` (moved only by the
 * velocity you give it, pushes others) or `static` (never moves). Coordinates are metres with +y down, like the 2D renderer; angles are in radians, positive turning
 * clockwise on screen. The rotation is kept as a cosine and sine so the simulation never needs a trigonometric function.
 */
export class Body2D {
  /**
   * @param {object} o
   * @param {import('./shapes.js').Circle | import('./shapes.js').Polygon} o.shape
   * @param {'dynamic' | 'kinematic' | 'static'} [o.type]
   * @param {number} [o.x] @param {number} [o.y] Position of the shape's centre.
   * @param {number} [o.angle] Radians.
   * @param {number} [o.density] kg per square metre (default 1); `mass` overrides it.
   * @param {number} [o.mass]
   * @param {number} [o.friction] Coulomb friction (0.4); two bodies use the geometric mean.
   * @param {number} [o.restitution] Bounciness 0..1 (0); two bodies use the larger.
   * @param {number} [o.linearDamping] Speed lost per second, as a rate (0). @param {number} [o.angularDamping] (0.05)
   * @param {number} [o.gravityScale] 1 normal, 0 floating.
   * @param {boolean} [o.sensor] A trigger: reports who overlaps it but never pushes anything.
   * @param {boolean} [o.fixedRotation] Never turns (a platformer hero).
   * @param {boolean} [o.canSleep] false keeps it awake (default true).
   * @param {number} [o.group] Collision category bits (1). @param {number} [o.mask] Which categories it collides with (all).
   * @param {any} [o.userData] Anything you want to find again.
   */
  constructor({ shape, type = 'dynamic', x = 0, y = 0, angle = 0, density = 1, mass, friction = 0.4, restitution = 0, linearDamping = 0, angularDamping = 0.05, gravityScale = 1,
    sensor = false, fixedRotation = false, canSleep = true, group = 1, mask = 0xffff, userData = null }) {
    if (!shape || (shape.type !== 'circle' && shape.type !== 'polygon')) throw new Error('a body needs a shape: circleShape(r), boxShape(hx, hy) or polygonShape(points)');
    if (type !== 'dynamic' && type !== 'kinematic' && type !== 'static') throw new Error(`body type must be dynamic, kinematic or static (got ${type})`);
    this.id = nextId++;
    this.shape = shape; this.type = type;
    this.x = x; this.y = y;
    [this.s, this.c] = sinCos(angle);
    this.vx = 0; this.vy = 0; this.w = 0;
    this.fx = 0; this.fy = 0; this.torque = 0;
    this.friction = friction; this.restitution = restitution; this.linearDamping = linearDamping; this.angularDamping = angularDamping; this.gravityScale = gravityScale;
    this.sensor = sensor; this.fixedRotation = fixedRotation; this.canSleep = canSleep; this.group = group; this.mask = mask; this.userData = userData;
    this.mass = 0; this.invMass = 0; this.inertia = 0; this.invInertia = 0;
    if (type === 'dynamic') {
      this.mass = mass ?? density * shape.area;
      if (!(this.mass > 0)) throw new Error('a dynamic body needs a mass above 0');
      this.invMass = 1 / this.mass;
      this.inertia = fixedRotation ? 0 : this.mass * (shape.inertia / shape.area);
      this.invInertia = this.inertia > 0 ? 1 / this.inertia : 0;
    }
    this.sleeping = false; this.sleepTimer = 0;
    this.radius = shapeRadius(shape);
    const n = shape.type === 'polygon' ? shape.count : 0;
    this.wx = new Array(n).fill(0); this.wy = new Array(n).fill(0); this.wnx = new Array(n).fill(0); this.wny = new Array(n).fill(0);
    this.minX = 0; this.minY = 0; this.maxX = 0; this.maxY = 0;
    this.index = -1;
    this.refresh();
  }

  /** The angle in radians (for drawing; the simulation itself never uses it). */
  get angle() { return Math.atan2(this.s, this.c); } // determinism-ok: read-only, for rendering

  /** Turn the body to an angle (radians). */
  setAngle(a) { [this.s, this.c] = sinCos(a); this.refresh(); this.wake(); }

  /** Put the body somewhere (and wake it). */
  setPosition(x, y) { this.x = x; this.y = y; this.refresh(); this.wake(); }

  /** Recompute the corner points and bounding box from the pose. Called for you after every move. */
  refresh() {
    const sh = this.shape, c = this.c, s = this.s;
    if (sh.type === 'circle') {
      this.minX = this.x - sh.radius; this.maxX = this.x + sh.radius; this.minY = this.y - sh.radius; this.maxY = this.y + sh.radius;
      return;
    }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < sh.count; i++) {
      const px = this.x + c * sh.xs[i] - s * sh.ys[i], py = this.y + s * sh.xs[i] + c * sh.ys[i];
      this.wx[i] = px; this.wy[i] = py;
      this.wnx[i] = c * sh.nxs[i] - s * sh.nys[i]; this.wny[i] = s * sh.nxs[i] + c * sh.nys[i];
      if (px < minX) minX = px; if (px > maxX) maxX = px; if (py < minY) minY = py; if (py > maxY) maxY = py;
    }
    this.minX = minX; this.minY = minY; this.maxX = maxX; this.maxY = maxY;
  }

  /** Push with a force (newtons) through the centre; it lasts for the next step only. */
  applyForce(fx, fy) { this.fx += fx; this.fy += fy; this.wake(); }
  /** Push with a force at a world point (it also turns the body). */
  applyForceAt(fx, fy, px, py) { this.fx += fx; this.fy += fy; this.torque += (px - this.x) * fy - (py - this.y) * fx; this.wake(); }
  /** Change the speed at once by an impulse (newton-seconds), through the centre. */
  applyImpulse(ix, iy) { this.vx += ix * this.invMass; this.vy += iy * this.invMass; this.wake(); }
  /** An impulse at a world point. */
  applyImpulseAt(ix, iy, px, py) { this.vx += ix * this.invMass; this.vy += iy * this.invMass; this.w += ((px - this.x) * iy - (py - this.y) * ix) * this.invInertia; this.wake(); }
  /** Set the velocity (a kinematic platform moves this way). */
  setVelocity(vx, vy, w = this.w) { this.vx = vx; this.vy = vy; this.w = w; this.wake(); }

  /** Wake a sleeping body. */
  wake() { this.sleeping = false; this.sleepTimer = 0; }

  /** World position of a point given relative to the body (turned with it). */
  localToWorld(lx, ly) { return [this.x + this.c * lx - this.s * ly, this.y + this.s * lx + this.c * ly]; }
  /** The point of the body at a world position, relative to the body's own axes. */
  worldToLocal(px, py) { const dx = px - this.x, dy = py - this.y; return [this.c * dx + this.s * dy, -this.s * dx + this.c * dy]; }
  /** Velocity of the body at a world point. */
  velocityAt(px, py) { return [this.vx - this.w * (py - this.y), this.vy + this.w * (px - this.x)]; }
}
