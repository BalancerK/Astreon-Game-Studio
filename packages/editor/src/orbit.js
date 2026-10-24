// The editor's camera: orbit around a target, pan, zoom, fly, and frame a box.
// The camera sits at target + distance * (sin(yaw)cos(pitch), sin(pitch), cos(yaw)cos(pitch)) and looks at the target.

const VIEWS = {
  front: [0, 0], back: [Math.PI, 0], right: [Math.PI / 2, 0], left: [-Math.PI / 2, 0], top: [0, 1.5], bottom: [0, -1.5],
};

const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/**
 * The editor camera: orbits around a target, pans, zooms, flies and frames a box, and `apply` puts a `Camera3D` where it says.
 */
export class OrbitController {
  constructor({ target = [0, 1, 0], yaw = 0.6, pitch = 0.45, distance = 20, minDistance = 0.5, maxDistance = 500 } = {}) {
    this.target = [...target]; this.yaw = yaw; this.pitch = pitch; this.distance = distance; this.minDistance = minDistance; this.maxDistance = maxDistance;
    /** Orthographic (things keep their size at any distance), as for a front, side or top view. */
    this.ortho = false;
    /** True when the orthographic view came from picking a front, side or top view: turning the view by hand goes back to perspective, as in Blender. */
    this.autoOrtho = false;
  }

  /**
   * Look from the front, back, right, left, top or bottom, in an orthographic view.
   * @param {'front' | 'back' | 'right' | 'left' | 'top' | 'bottom'} name
   */
  setView(name) {
    const v = VIEWS[name];
    if (!v) return false;
    this.yaw = v[0]; this.pitch = v[1]; this.ortho = true; this.autoOrtho = true;
    return true;
  }

  /** The name of the view when it is exactly one of the six, else null. */
  get viewName() {
    for (const [name, [yaw, pitch]] of Object.entries(VIEWS)) {
      if (Math.abs(((this.yaw - yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI) < 1e-6 && Math.abs(this.pitch - pitch) < 1e-6) return name;
    }
    return null;
  }

  /** Switch between perspective and orthographic (number pad 5). */
  toggleOrtho() { this.ortho = !this.ortho; this.autoOrtho = false; return this.ortho; }

  /** Half the height of the view in an orthographic view, so switching does not change how big things look at the target. */
  orthoHeight(fovY) { return this.distance * Math.tan(fovY / 2); }
  /** The direction the camera looks (from the camera towards the target). */
  forward() { const cp = Math.cos(this.pitch); return [-Math.sin(this.yaw) * cp, -Math.sin(this.pitch), -Math.cos(this.yaw) * cp]; }
  /** The camera's right and up directions. */
  axes() {
    const right = [Math.cos(this.yaw), 0, -Math.sin(this.yaw)];
    return { right, up: cross(right, this.forward()) };
  }
  /** Drag in pixels. */
  orbit(dx, dy) {
    if (this.autoOrtho) { this.ortho = false; this.autoOrtho = false; }                // turning by hand leaves a front, side or top view
    this.yaw -= dx * 0.006; this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch + dy * 0.005)); }
  /** Slide the view with a drag in pixels: what you grab follows the pointer. */
  pan(dx, dy, fovY, viewH) {
    const k = (2 * Math.tan(fovY / 2) * this.distance) / viewH;
    const { right, up } = this.axes();
    for (let i = 0; i < 3; i++) this.target[i] += (-dx * right[i] + dy * up[i]) * k;
  }
  /** Mouse wheel: each notch changes the distance by 10 %. */
  zoom(deltaY) { this.distance = Math.max(this.minDistance, Math.min(this.maxDistance, this.distance * (1 + Math.sign(deltaY) * 0.1))); }
  /** Fly: `move` = [right, up, forward], each -1..1; faster when further out. */
  fly(move, dt) {
    const f = this.forward(), { right } = this.axes();
    const speed = Math.max(2, this.distance * 0.8) * dt;
    for (let i = 0; i < 3; i++) this.target[i] += (right[i] * move[0] + f[i] * move[2]) * speed;
    this.target[1] += move[1] * speed;
  }
  /** Frame a world-space box so it fills the view (the narrower side of the view decides, so it fits in a tall, narrow viewport too). */
  focus(min, max, fovY = 1, aspect = 1) {
    this.target = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
    const r = Math.max(0.5, Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2);
    const half = Math.atan(Math.tan(fovY / 2) * Math.min(1, aspect));                 // the smaller of the vertical and horizontal half angles
    this.distance = Math.max(this.minDistance, Math.min(this.maxDistance, (r / Math.sin(half)) * 1.1));
  }
  /** Put a `Camera3D` where this controller says (call `camera.update()` after). */
  apply(camera) {
    const cp = Math.cos(this.pitch);
    camera.x = this.target[0] + Math.sin(this.yaw) * cp * this.distance;
    camera.y = this.target[1] + Math.sin(this.pitch) * this.distance;
    camera.z = this.target[2] + Math.cos(this.yaw) * cp * this.distance;
    camera.yaw = this.yaw; camera.pitch = -this.pitch;
    return camera;
  }
}
