import { mat4, vec3 } from '../../math/src/index.js';

/**
 * A perspective camera for first- and third-person views. Right-handed, +y up, looking down -z at yaw 0 and pitch 0
 * (the conventions of `@engine/math`: `vec3.forward(yaw, pitch)` is the direction it looks).
 */
export class Camera3D {
  /**
   * @param {object} [o]
   * @param {number} [o.x] @param {number} [o.y] @param {number} [o.z] Position.
   * @param {number} [o.yaw] Radians; positive turns left.
   * @param {number} [o.pitch] Radians; positive looks up.
   * @param {number} [o.roll]
   * @param {number} [o.fovY] Vertical field of view in radians.
   * @param {number} [o.near]
   * @param {number} [o.far]
   * @param {number} [o.viewW] Viewport size in CSS pixels (sets the aspect ratio).
   * @param {number} [o.viewH]
   */
  constructor({ x = 0, y = 0, z = 0, yaw = 0, pitch = 0, roll = 0, fovY = 1.1, near = 0.1, far = 1000, viewW = 800, viewH = 600 } = {}) {
    this.x = x; this.y = y; this.z = z;
    this.yaw = yaw; this.pitch = pitch; this.roll = roll;
    this.fovY = fovY; this.near = near; this.far = far;
    /** Half the height of the view, in world units, for an orthographic view (things keep their size at any distance); 0 is the usual perspective. */
    this.ortho = 0;
    this.viewW = viewW; this.viewH = viewH;
    this.view = new Float64Array(16);
    this.proj = new Float64Array(16);
    this.viewProj = new Float64Array(16);
    this.inv = new Float64Array(16);
    /** The six frustum planes (left, right, bottom, top, near, far) as unit normals pointing inward: a, b, c, d each; a point is inside when a*x + b*y + c*z + d >= 0 for all six. Set by `update()`. */
    this.planes = new Float64Array(24);
  }

  setViewport(w, h) { this.viewW = w; this.viewH = h; }
  get aspect() { return this.viewW / this.viewH; }

  /** Recompute the matrices from the current fields; call once per frame after moving the camera. */
  update() {
    mat4.viewFromYawPitch(this.view, this.x, this.y, this.z, this.yaw, this.pitch, this.roll);
    if (this.ortho > 0) {                                           // orthographic: the view box also reaches behind the camera, so nothing is cut at its own position
      const h = this.ortho, w = h * this.aspect;
      mat4.orthographic(this.proj, -w, w, -h, h, -this.far * 0.5, this.far * 0.5);
    } else mat4.perspective(this.proj, this.fovY, this.aspect, this.near, this.far);
    mat4.multiply(this.viewProj, this.proj, this.view);
    this.#extractPlanes();
    return this;
  }

  #extractPlanes() {
    const m = this.viewProj, p = this.planes;
    // rows of the clip matrix; the view volume is -w <= x <= w, -w <= y <= w, 0 <= z <= w (WebGPU depth range)
    const row = (r, k) => m[k * 4 + r];
    const set = (i, a, b, c, d) => {
      const len = Math.sqrt(a * a + b * b + c * c) || 1;
      p[i * 4] = a / len; p[i * 4 + 1] = b / len; p[i * 4 + 2] = c / len; p[i * 4 + 3] = d / len;
    };
    for (let i = 0; i < 6; i++) {
      const sign = i % 2 === 0 ? 1 : -1, axis = i >> 1; // left/right use x, bottom/top y, near/far z
      if (axis < 2) set(i, row(3, 0) + sign * row(axis, 0), row(3, 1) + sign * row(axis, 1), row(3, 2) + sign * row(axis, 2), row(3, 3) + sign * row(axis, 3));
      else if (i === 4) set(i, row(2, 0), row(2, 1), row(2, 2), row(2, 3)); // near: z >= 0
      else set(i, row(3, 0) - row(2, 0), row(3, 1) - row(2, 1), row(3, 2) - row(2, 2), row(3, 3) - row(2, 3)); // far: z <= w
    }
  }

  /**
   * Could any part of a sphere be on screen? Conservative: never false for a sphere that touches the view volume (it may be
   * true for one just outside a corner). Uses the planes of the last `update()`.
   */
  sphereVisible(x, y, z, radius) {
    const p = this.planes;
    for (let i = 0; i < 24; i += 4) if (p[i] * x + p[i + 1] * y + p[i + 2] * z + p[i + 3] < -radius) return false;
    return true;
  }

  /**
   * Could a sphere that slides along the vector (dx, dy, dz) touch the view at any point of its path? Conservative, like
   * `sphereVisible`: used to keep objects whose shadow may fall into view.
   */
  sweptSphereVisible(x, y, z, radius, dx, dy, dz) {
    const p = this.planes;
    for (let i = 0; i < 24; i += 4) {
      const d0 = p[i] * x + p[i + 1] * y + p[i + 2] * z + p[i + 3];
      if (d0 < -radius && d0 + p[i] * dx + p[i + 1] * dy + p[i + 2] * dz < -radius) return false; // both ends of the path are outside the same plane
    }
    return true;
  }

  /** The unit direction the camera looks. */
  forward(out = [0, 0, 0]) { return vec3.forward(out, this.yaw, this.pitch); }

  /**
   * The world-space ray through a pixel (CSS pixels from the top-left of the canvas): for picking and aiming.
   * @param {number[]} origin Receives the ray start (on the near plane)
   * @param {number[]} dir Receives the unit direction
   */
  screenToRay(sx, sy, origin = [0, 0, 0], dir = [0, 0, 0]) {
    mat4.invert(this.inv, this.viewProj);
    const nx = (2 * sx) / this.viewW - 1, ny = 1 - (2 * sy) / this.viewH;
    const far = [nx, ny, 1];
    mat4.transformPoint(origin, this.inv, [nx, ny, 0]);
    mat4.transformPoint(far, this.inv, far);
    vec3.normalize(dir, vec3.sub(dir, far, origin));
    return { origin, dir };
  }

  /**
   * Project a world point to CSS pixels. `depth` is the distance in front of the camera (negative: behind it, so `visible`
   * is false and x, y are meaningless).
   */
  worldToScreen(wx, wy, wz, out = { x: 0, y: 0, depth: 0, visible: false }) {
    const m = this.viewProj;
    const w = m[3] * wx + m[7] * wy + m[11] * wz + m[15];
    out.depth = this.ortho > 0 ? -(this.view[2] * wx + this.view[6] * wy + this.view[10] * wz + this.view[14]) : w;
    out.visible = w > 0;
    if (w <= 0) { out.x = 0; out.y = 0; return out; }
    const cx = (m[0] * wx + m[4] * wy + m[8] * wz + m[12]) / w, cy = (m[1] * wx + m[5] * wy + m[9] * wz + m[13]) / w;
    out.x = (cx * 0.5 + 0.5) * this.viewW;
    out.y = (0.5 - cy * 0.5) * this.viewH;
    return out;
  }
}
