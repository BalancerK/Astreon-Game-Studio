import { INSTANCE_WORDS, WHITE, META_SDF } from './batch.js';
import { planFilters, runFilters, toPremultiplied, fromPremultiplied } from './filters.js';

/**
 * Last-resort backend: draws each sprite with drawImage. Slowest, but works
 * everywhere and is handy as a reference when debugging the GPU backends.
 * Tints are applied by multiplying cached copies of the sprite, matching the shaders.
 */
export class Canvas2DRenderer {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {import('./atlas.js').Atlas} atlas
   * @param {{transparent?: boolean}} [o] `transparent`: the canvas has an alpha channel, so it can be stacked over another canvas (a HUD over a 3D view).
   */
  constructor(canvas, atlas, { transparent = false, filter = 'linear' } = {}) {
    const ctx = canvas.getContext('2d', { alpha: transparent });
    if (!ctx) throw new Error('Canvas2D unavailable');
    this.kind = 'canvas2d';
    this.transparent = transparent;
    /** How sprites are sampled when scaled: `'linear'` (smooth) or `'nearest'` (hard pixels, for pixel art). Change with `setFilter`. */
    this.filter = filter === 'nearest' ? 'nearest' : 'linear';
    this.canvas = canvas;
    this.ctx = ctx;
    this.atlas = atlas;
    this.dpr = 1;
    /** 2D lighting (`render({ lighting })`) needs WebGPU or WebGL2: this backend draws everything unlit. */
    this.lightingSupported = false;
    this.lost = false;
    this.onLost = null;
    this.tinted = new Map();
    this.tintedVersion = -1;
  }

  resize(cssW, cssH, dpr = 1) {
    this.dpr = dpr;
    const w = Math.max(1, Math.round(cssW * dpr)), h = Math.max(1, Math.round(cssH * dpr));
    if (this.canvas.width !== w) this.canvas.width = w;                      // (setting a canvas's size, even to what it is, empties it, and a 3D renderer makes its picture buffers again)
    if (this.canvas.height !== h) this.canvas.height = h;
    if (this.canvas.style) { const sw = `${cssW}px`, sh = `${cssH}px`; if (this.canvas.style.width !== sw) this.canvas.style.width = sw; if (this.canvas.style.height !== sh) this.canvas.style.height = sh; }
  }

  /**
   * A copy of one atlas rectangle with the tint multiplied in. Signed-distance-field sprites (text) are first turned into
   * plain coverage at their stored resolution (Canvas2D cannot threshold per pixel while drawing), so this fallback shows
   * text at the quality of that stored size scaled: fine as a last resort, not for huge text.
   */
  #tintedSprite(page, sx, sy, sw, sh, tint, sdf) {
    const key = `${page}|${sx}|${sy}|${sw}|${sh}|${tint & 0xffffff}|${sdf ? 1 : 0}`;
    let c = this.tinted.get(key);
    if (c) return c;
    if (this.tinted.size > 1000) this.tinted.clear();
    c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(sw, sh) : Object.assign(document.createElement('canvas'), { width: sw, height: sh });
    const g = c.getContext('2d');
    const src = this.atlas.pages[page].canvas;
    g.drawImage(src, sx, sy, sw, sh, 0, 0, sw, sh);
    if (sdf) {
      const img = g.getImageData(0, 0, sw, sh), d = img.data;
      for (let i = 0; i < d.length; i += 4) {
        const t = Math.min(1, Math.max(0, (d[i + 3] / 255 - 0.46) / 0.08)); // edge at 0.5, about one stored pixel wide, so the edge stays as sharp as the stored size allows
        d[i] = d[i + 1] = d[i + 2] = 255;
        d[i + 3] = Math.round(255 * t * t * (3 - 2 * t));
      }
      g.putImageData(img, 0, 0);
    }
    const coverage = sdf ? this.#copy(c) : null; // the shape, kept apart from the colour fill below
    g.globalCompositeOperation = 'multiply';
    g.fillStyle = `rgb(${tint & 255},${(tint >>> 8) & 255},${(tint >>> 16) & 255})`;
    g.fillRect(0, 0, sw, sh);
    g.globalCompositeOperation = 'destination-in';
    if (sdf) g.drawImage(coverage, 0, 0); else g.drawImage(src, sx, sy, sw, sh, 0, 0, sw, sh);
    this.tinted.set(key, c);
    return c;
  }

  #copy(canvas) {
    const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(canvas.width, canvas.height) : Object.assign(document.createElement('canvas'), { width: canvas.width, height: canvas.height });
    c.getContext('2d').drawImage(canvas, 0, 0);
    return c;
  }

  /**
   * @param {{camera: import('./camera.js').Camera, batch: import('./batch.js').SpriteBatch, clear?: number[] | null, filters?: object[]}} frame `clear: null` keeps the previous contents (draw an overlay pass).
   * `filters` (see `Filter`) run over this batch alone, on the CPU here: exact, but slow on a large canvas.
   */
  render({ camera, batch, clear = this.transparent ? [0, 0, 0, 0] : [0.05, 0.05, 0.08, 1], filters, meshes }) {
    const { ctx } = this;
    if (this.tintedVersion !== this.atlas.version) { this.tinted.clear(); this.tintedVersion = this.atlas.version; }
    batch.sort();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    if (clear) { // `clear: null` draws on top of what is already there (HUD / overlay pass)
      if (clear[3] === 0) ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      else {
        ctx.fillStyle = `rgba(${clear[0] * 255 | 0},${clear[1] * 255 | 0},${clear[2] * 255 | 0},${clear[3] ?? 1})`;
        ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
      }
    }
    const hasMeshes = !!meshes && meshes.indexCount > 0;
    if (!filters?.length || (batch.count === 0 && !hasMeshes)) { this.#drawBatch(ctx, camera, batch); if (hasMeshes) this.#drawMeshes(ctx, camera, meshes); return; }
    const { width: w, height: h } = this.canvas;
    const layer = this.#scratch(w, h), g = layer.getContext('2d', { willReadFrequently: true });
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, w, h);
    this.#drawBatch(g, camera, batch);
    if (hasMeshes) this.#drawMeshes(g, camera, meshes);
    const image = g.getImageData(0, 0, w, h);
    const done = runFilters(planFilters(filters, { scale: this.dpr }), toPremultiplied(image.data), w, h);
    image.data.set(fromPremultiplied(done));
    g.putImageData(image, 0, 0);
    ctx.drawImage(layer, 0, 0);
  }

  /**
   * Several batches in order, each with its own filters (and camera): a world, then a glowing boss, then the HUD.
   * @param {{camera: import('./camera.js').Camera, clear?: number[] | null, layers: {batch: import('./batch.js').SpriteBatch, filters?: object[], camera?: import('./camera.js').Camera, meshes?: import('./meshbatch.js').MeshBatch2D}[]}} frame
   */
  renderLayers({ camera, clear, layers }) {
    layers.forEach((l, i) => this.render({ camera: l.camera ?? camera, batch: l.batch, filters: l.filters, meshes: l.meshes, ...(i === 0 ? (clear === undefined ? {} : { clear }) : { clear: null }) }));
  }

  /**
   * Meshes with Canvas2D: each triangle is drawn by clipping to it and mapping the atlas through the matrix that carries its three atlas points onto its three screen points. Slow, and only the
   * alpha of a tint is used (no colour), but it shows the right shapes.
   */
  #drawMeshes(ctx, camera, meshes) {
    const { dpr, atlas } = this, f = meshes.f32, u = meshes.u32, idx = meshes.indices, size = atlas.size, z = camera.zoom * dpr;
    const cx = camera.renderX, cy = camera.renderY, hw = camera.viewW / 2, hh = camera.viewH / 2;
    const sx = (x) => ((x - cx) * camera.zoom + hw) * dpr, sy = (y) => ((y - cy) * camera.zoom + hh) * dpr;
    void z;
    ctx.imageSmoothingEnabled = this.filter !== 'nearest';
    for (let t = 0; t + 2 < meshes.indexCount; t += 3) {
      const a = idx[t] * 6, b = idx[t + 1] * 6, c = idx[t + 2] * 6;
      const meta = u[a + 5], page = meta & 255, additive = (meta & 1024) !== 0;
      const x0 = sx(f[a]), y0 = sy(f[a + 1]), x1 = sx(f[b]), y1 = sy(f[b + 1]), x2 = sx(f[c]), y2 = sy(f[c + 1]);
      const u0 = f[a + 2] * size, v0 = f[a + 3] * size, u1 = f[b + 2] * size, v1 = f[b + 3] * size, u2 = f[c + 2] * size, v2 = f[c + 3] * size;
      const det = (u1 - u0) * (v2 - v0) - (u2 - u0) * (v1 - v0);
      if (Math.abs(det) < 1e-9) continue;
      // the affine map from atlas pixels to screen pixels: dest = M * src + t
      const m11 = ((x1 - x0) * (v2 - v0) - (x2 - x0) * (v1 - v0)) / det, m12 = ((x2 - x0) * (u1 - u0) - (x1 - x0) * (u2 - u0)) / det;
      const m21 = ((y1 - y0) * (v2 - v0) - (y2 - y0) * (v1 - v0)) / det, m22 = ((y2 - y0) * (u1 - u0) - (y1 - y0) * (u2 - u0)) / det;
      const e = x0 - m11 * u0 - m12 * v0, g = y0 - m21 * u0 - m22 * v0;
      const minU = Math.max(0, Math.floor(Math.min(u0, u1, u2))), minV = Math.max(0, Math.floor(Math.min(v0, v1, v2))), maxU = Math.min(size, Math.ceil(Math.max(u0, u1, u2))), maxV = Math.min(size, Math.ceil(Math.max(v0, v1, v2)));
      if (maxU <= minU || maxV <= minV) continue;
      // the clip is pushed out by half a pixel along each edge, so the seam between two triangles of one mesh does not show through
      const grow = (px, py, qx, qy, rx, ry) => {                  // the corner (px, py) between edges to q and to r, moved out
        const unit = (ax, ay) => { const l = Math.hypot(ax, ay) || 1; return [ax / l, ay / l]; };
        const orient = Math.sign((x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0)) || 1;
        const n1 = unit((qy - py) * orient, (qx - px) * -orient), n2 = unit((py - ry) * orient, (px - rx) * -orient);   // outward normals of the two edges (the edge to q, and the edge from r)
        const k = 0.5 / Math.max(0.25, 1 + n1[0] * n2[0] + n1[1] * n2[1]);
        return [px + (n1[0] + n2[0]) * k, py + (n1[1] + n2[1]) * k];
      };
      const p0 = grow(x0, y0, x1, y1, x2, y2), p1 = grow(x1, y1, x2, y2, x0, y0), p2 = grow(x2, y2, x0, y0, x1, y1);
      ctx.save();
      ctx.beginPath(); ctx.moveTo(p0[0], p0[1]); ctx.lineTo(p1[0], p1[1]); ctx.lineTo(p2[0], p2[1]); ctx.closePath(); ctx.clip();
      ctx.globalAlpha = (u[a + 4] >>> 24) / 255;
      if (additive) ctx.globalCompositeOperation = 'lighter';
      ctx.setTransform(m11, m21, m12, m22, e, g);
      ctx.drawImage(atlas.pages[page].canvas, minU, minV, maxU - minU, maxV - minV, minU, minV, maxU - minU, maxV - minV);
      ctx.restore();
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
  }

  #scratch(w, h) {
    if (!this.layer || this.layer.width !== w || this.layer.height !== h) {
      this.layer = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
    }
    return this.layer;
  }

  #drawBatch(ctx, camera, batch) {
    const { dpr } = this;
    ctx.imageSmoothingEnabled = this.filter !== 'nearest';

    const f = batch.f32, u = batch.u32, size = this.atlas.size;
    const z = camera.zoom * dpr;
    const cx = camera.renderX, cy = camera.renderY, hw = camera.viewW / 2, hh = camera.viewH / 2;
    const pages = this.atlas.pages;
    for (let i = 0; i < batch.count; i++) {
      const o = i * INSTANCE_WORDS;
      const mirror = f[o + 2] < 0, w = Math.abs(f[o + 2]), h = f[o + 3], rot = f[o + 4];   // a negative width mirrors the sprite left to right (as the GPU backends do)
      const sx = Math.round(f[o + 5] * size), sy = Math.round(f[o + 6] * size);
      const sw = Math.round((f[o + 7] - f[o + 5]) * size), sh = Math.round((f[o + 8] - f[o + 6]) * size);
      const tint = u[o + 9], meta = u[o + 10], page = meta & 255, sdf = (meta & META_SDF) !== 0;
      const src = pages[page].canvas;
      const c = Math.cos(rot) * z, s = Math.sin(rot) * z;
      ctx.setTransform(mirror ? -c : c, mirror ? -s : s, -s, c, ((f[o] - cx) * camera.zoom + hw) * dpr, ((f[o + 1] - cy) * camera.zoom + hh) * dpr);
      ctx.globalAlpha = (tint >>> 24) / 255;
      const img = !sdf && (tint & 0xffffff) === (WHITE & 0xffffff) ? src : this.#tintedSprite(page, sx, sy, sw, sh, tint, sdf);
      if (img === src) ctx.drawImage(src, sx, sy, sw, sh, -w / 2, -h / 2, w, h);
      else ctx.drawImage(img, 0, 0, sw, sh, -w / 2, -h / 2, w, h);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
  }

  /** Switch between smooth (`'linear'`) and hard-pixel (`'nearest'`) sampling. @param {'linear' | 'nearest'} mode */
  setFilter(mode) { this.filter = mode === 'nearest' ? 'nearest' : 'linear'; }

  destroy() { this.tinted.clear(); }
}
