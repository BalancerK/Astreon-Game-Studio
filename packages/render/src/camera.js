/**
 * 2D camera. World units have +x right and +y down (screen-style). `zoom` is
 * screen pixels per world unit. Viewport size is in CSS pixels.
 */
export class Camera {
  constructor({ x = 0, y = 0, zoom = 1, viewW = 800, viewH = 600 } = {}) {
    this.x = x;
    this.y = y;
    this.zoom = zoom;
    this.viewW = viewW;
    this.viewH = viewH;
    this.shakeAmount = 0;
    this.shakeTime = 0;
    this.shakeDuration = 0;
    this.offsetX = 0;
    this.offsetY = 0;
  }

  setViewport(w, h) { this.viewW = w; this.viewH = h; }

  /**
   * Make world units equal screen pixels with (0, 0) at the top-left: the camera for HUDs, menus and text overlays.
   * Call again when the window is resized.
   */
  setScreenSpace(w, h) {
    this.viewW = w; this.viewH = h;
    this.x = w / 2; this.y = h / 2; this.zoom = 1;
    this.offsetX = this.offsetY = 0;
    this.shakeTime = 0;
    return this;
  }

  /** @returns {Camera} A new screen-space camera (see setScreenSpace). */
  static screen(w, h) { return new Camera().setScreenSpace(w, h); }

  /**
   * Ease toward a target, frame-rate independent. `smoothing` is the fraction of the
   * distance left after one second (0 = snap, 0.001 = very quick, 0.5 = slow).
   */
  follow(tx, ty, dt, smoothing = 0.001) {
    const k = 1 - smoothing ** dt;
    this.x += (tx - this.x) * k;
    this.y += (ty - this.y) * k;
  }

  /** Screen shake in world units, decaying over `duration` seconds. */
  shake(amount, duration) {
    this.shakeAmount = amount;
    this.shakeTime = this.shakeDuration = duration;
  }

  /** Advance shake; call once per frame. Rendering only, so it may use Math.random. */
  update(dt) {
    if (this.shakeTime > 0) {
      this.shakeTime = Math.max(0, this.shakeTime - dt);
      const a = this.shakeAmount * (this.shakeTime / this.shakeDuration);
      this.offsetX = (Math.random() * 2 - 1) * a;
      this.offsetY = (Math.random() * 2 - 1) * a;
    } else {
      this.offsetX = this.offsetY = 0;
    }
  }

  get renderX() { return this.x + this.offsetX; }
  get renderY() { return this.y + this.offsetY; }

  /** @param {Float32Array | number[]} [out] 4 values consumed by the shaders: [cx, cy, 2z/vw, -2z/vh]. */
  uniforms(out = new Float32Array(4)) {
    out[0] = this.renderX;
    out[1] = this.renderY;
    out[2] = (2 * this.zoom) / this.viewW;
    out[3] = (-2 * this.zoom) / this.viewH;
    return out;
  }

  /** @returns {{x: number, y: number}} CSS pixels relative to the canvas. */
  worldToScreen(wx, wy, out = { x: 0, y: 0 }) {
    out.x = (wx - this.renderX) * this.zoom + this.viewW / 2;
    out.y = (wy - this.renderY) * this.zoom + this.viewH / 2;
    return out;
  }

  /** @returns {{x: number, y: number}} */
  screenToWorld(sx, sy, out = { x: 0, y: 0 }) {
    out.x = (sx - this.viewW / 2) / this.zoom + this.renderX;
    out.y = (sy - this.viewH / 2) / this.zoom + this.renderY;
    return out;
  }
}
