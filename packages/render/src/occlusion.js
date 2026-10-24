/**
 * Occlusion culling: do not draw what a wall hides. An `OcclusionBuffer` is a small depth image (128 x 72 by default) drawn on the CPU from the big solid things in the
 * scene (the occluders: walls, buildings, terrain, a hill), and `DrawList3D.setOcclusion` asks it about every instance's bounding sphere before adding it.
 * No GPU queries are used, so there is no wait for an answer and no flicker, and it works the same on WebGPU, WebGL2 and Canvas2D.
 *
 * It is conservative: an instance is dropped only when every pixel of its (slightly enlarged) bounding box on screen is covered by an occluder that is nearer than
 * the nearest point of its bounding sphere. A thing that might be seen is drawn. The price of a wrong answer is never a missing thing that should be visible,
 * only a few things drawn that did not need to be.
 */

/** Occluders closer than this to the camera's near plane are skipped, rather than clipped (a triangle with a vertex behind the camera cannot be projected). */
const EPS = 1.01;

/** A small depth image of the scene's big solid things, drawn on the CPU each frame, that says whether a bounding sphere is hidden behind them. */
export class OcclusionBuffer {
  /**
   * @param {number} [width] Pixels across (default 128). @param {number} [height] Pixels down (default 72). A bigger buffer hides more (finer gaps) and costs more to fill.
   */
  constructor(width = 128, height = 72) {
    if (!(width >= 8 && height >= 8 && width <= 1024 && height <= 1024)) throw new Error('an occlusion buffer is between 8 and 1024 pixels each way');
    this.width = width | 0; this.height = height | 0;
    /** 1 / distance of the nearest occluder at each pixel's centre (0 = nothing there). Interpolates linearly across the screen, which distance itself does not. */
    this.invDepth = new Float32Array(this.width * this.height);
    this.camera = null;
    /** Triangles drawn into the buffer this frame. */
    this.triangles = 0;
    /** Instances it reported hidden this frame. */
    this.hidden = 0;
  }

  /** Start a frame: clear the buffer and look through this camera (as of its last `update()`). A camera with an orthographic view is not supported: nothing is hidden. */
  begin(camera) {
    this.camera = camera;
    this.invDepth.fill(0);
    this.triangles = 0; this.hidden = 0;
    return this;
  }

  /** Project a world point: returns false if it is behind (or too near) the camera. Writes screen x, y and distance to `out`. */
  _project(x, y, z, out) {
    const m = this.camera.viewProj;
    const w = m[3] * x + m[7] * y + m[11] * z + m[15];
    if (w < this.camera.near * EPS) return false;
    out[0] = ((m[0] * x + m[4] * y + m[8] * z + m[12]) / w * 0.5 + 0.5) * this.width;
    out[1] = (0.5 - (m[1] * x + m[5] * y + m[9] * z + m[13]) / w * 0.5) * this.height;
    out[2] = w;
    return true;
  }

  /**
   * Draw a solid thing into the buffer. Use closed, solid shapes and keep them simple (a box for a building, not its windows): triangles with a corner behind the camera
   * are skipped, which only makes the buffer hide less. `model` places the mesh (column-major 4x4); the mesh's own vertices are 6 floats each (`stride`).
   * @param {Float32Array} vertices @param {ArrayLike<number>} indices @param {ArrayLike<number> | null} [model] @param {number} [stride]
   */
  addTriangles(vertices, indices, model = null, stride = 6) {
    if (!this.camera || this.camera.ortho > 0) return this;
    const p = [0, 0, 0], sx = [0, 0, 0], sy = [0, 0, 0], sw = [0, 0, 0];
    for (let t = 0; t < indices.length; t += 3) {
      let ok = true;
      for (let k = 0; k < 3 && ok; k++) {
        const o = indices[t + k] * stride;
        let x = vertices[o], y = vertices[o + 1], z = vertices[o + 2];
        if (model) { const mx = model[0] * x + model[4] * y + model[8] * z + model[12], my = model[1] * x + model[5] * y + model[9] * z + model[13], mz = model[2] * x + model[6] * y + model[10] * z + model[14]; x = mx; y = my; z = mz; }
        ok = this._project(x, y, z, p);
        sx[k] = p[0]; sy[k] = p[1]; sw[k] = 1 / p[2];
      }
      if (ok) this._fill(sx, sy, sw);
    }
    return this;
  }

  /** Draw a mesh placed by `model` (see `addTriangles`). */
  addMesh(mesh, model = null) { return this.addTriangles(mesh.vertices, mesh.indices, model); }

  /** Draw an axis-aligned box from its corners (a wall, a building). */
  addBox(minX, minY, minZ, maxX, maxY, maxZ) {
    const v = [], x = [minX, maxX], y = [minY, maxY], z = [minZ, maxZ];
    for (let i = 0; i < 8; i++) v.push(x[i & 1], y[(i >> 1) & 1], z[(i >> 2) & 1], 0, 0, 0);
    const q = [[0, 1, 3, 2], [4, 6, 7, 5], [0, 4, 5, 1], [2, 3, 7, 6], [0, 2, 6, 4], [1, 5, 7, 3]], idx = [];
    for (const [a, b, c, d] of q) idx.push(a, b, c, a, c, d);
    return this.addTriangles(Float32Array.from(v), idx);
  }

  /** Fill the pixels whose centres are inside a screen-space triangle with the nearest 1/distance. */
  _fill(sx, sy, iw) {
    const W = this.width, H = this.height, buf = this.invDepth;
    const x0 = Math.max(0, Math.floor(Math.min(sx[0], sx[1], sx[2]))), x1 = Math.min(W - 1, Math.ceil(Math.max(sx[0], sx[1], sx[2])));
    const y0 = Math.max(0, Math.floor(Math.min(sy[0], sy[1], sy[2]))), y1 = Math.min(H - 1, Math.ceil(Math.max(sy[0], sy[1], sy[2])));
    if (x1 < x0 || y1 < y0) return;
    const area = (sx[1] - sx[0]) * (sy[2] - sy[0]) - (sx[2] - sx[0]) * (sy[1] - sy[0]);
    if (area === 0) return;
    this.triangles++;
    const ia = 1 / area;
    for (let y = y0; y <= y1; y++) {
      const py = y + 0.5;
      for (let x = x0; x <= x1; x++) {
        const px = x + 0.5;
        const w0 = ((sx[1] - px) * (sy[2] - py) - (sx[2] - px) * (sy[1] - py)) * ia;
        const w1 = ((sx[2] - px) * (sy[0] - py) - (sx[0] - px) * (sy[2] - py)) * ia;
        const w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        const d = w0 * iw[0] + w1 * iw[1] + w2 * iw[2];
        const i = y * W + x;
        if (d > buf[i]) buf[i] = d;
      }
    }
  }

  /**
   * Is a sphere certainly hidden behind what has been drawn into the buffer? False when in doubt: when it is near the camera, partly behind it, or any pixel of its
   * enlarged outline is not covered by a nearer occluder.
   */
  sphereHidden(x, y, z, radius) {
    const cam = this.camera;
    if (!cam || cam.ortho > 0 || this.triangles === 0) return false;
    const m = cam.viewProj, W = this.width, H = this.height;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, nearest = 0;
    for (let i = 0; i < 8; i++) {            // the sphere's bounding cube: its projection holds the sphere's
      const cx = x + (i & 1 ? radius : -radius), cy = y + (i & 2 ? radius : -radius), cz = z + (i & 4 ? radius : -radius);
      const w = m[3] * cx + m[7] * cy + m[11] * cz + m[15];
      if (w < cam.near * EPS) return false;
      const sx = ((m[0] * cx + m[4] * cy + m[8] * cz + m[12]) / w * 0.5 + 0.5) * W, sy = (0.5 - (m[1] * cx + m[5] * cy + m[9] * cz + m[13]) / w * 0.5) * H;
      if (sx < minX) minX = sx; if (sx > maxX) maxX = sx; if (sy < minY) minY = sy; if (sy > maxY) maxY = sy;
      const inv = 1 / w;
      if (inv > nearest) nearest = inv;
    }
    // the cube's near face is a little nearer than the sphere: that is the safe side. A margin for the slope of the occluder within a pixel.
    const need = nearest * 1.02;
    const x0 = Math.max(0, Math.floor(minX) - 1), x1 = Math.min(W - 1, Math.ceil(maxX) + 1), y0 = Math.max(0, Math.floor(minY) - 1), y1 = Math.min(H - 1, Math.ceil(maxY) + 1);
    if (x1 < x0 || y1 < y0) return false;
    const buf = this.invDepth;
    for (let py = y0; py <= y1; py++) for (let px = x0, i = py * W + x0; px <= x1; px++, i++) if (!(buf[i] > need)) return false;
    this.hidden++;
    return true;
  }
}
