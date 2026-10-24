/**
 * Video (or any moving picture) as a texture. A `VideoTexture` keeps one layer of a 3D `TextureSet` up to date with the current frame of a `<video>` element,
 * a canvas, an `ImageBitmap` or a `VideoFrame`; a `VideoSprite` does the same for a rectangle of the 2D `Atlas`. Call `update()` once per frame: it does nothing
 * (and costs nothing) while a video is paused or has no new picture yet. The renderers upload the changed layer the next time they draw.
 *
 * The video element is yours: make it, set `src`, `muted`, `loop`, `playsInline`, call `play()` (browsers only start a video after the player has touched the page,
 * and only muted ones without that), and give it to this. Nothing here plays sound or decides when to play.
 *
 * Cost: a frame is drawn into a canvas the size of the texture, read back, given mip levels and uploaded, so a 256 x 256 layer costs about 0.3 ms and a 1024 x 1024 one
 * a few ms on a typical machine. Use the smallest size that looks right for the screen it is on, and a `TextureSet` of its own if the others are large.
 */

/** @typedef {'cover' | 'contain' | 'stretch'} VideoFit */

/** The size of a picture source in pixels (0 x 0 until a video knows its size). */
export function sourceSize(source) {
  const w = source.videoWidth ?? source.displayWidth ?? source.naturalWidth ?? source.width ?? 0;
  const h = source.videoHeight ?? source.displayHeight ?? source.naturalHeight ?? source.height ?? 0;
  return [w, h];
}

/**
 * How to place a `srcW` x `srcH` picture in a `w` x `h` box: `cover` fills the box and crops the picture, `contain` shows all of the picture with bars, `stretch`
 * squeezes it to fit. Returns the part of the source and the part of the box to draw with `drawImage`.
 * @param {number} srcW @param {number} srcH @param {number} w @param {number} h @param {VideoFit} [fit]
 */
export function fitRect(srcW, srcH, w, h, fit = 'cover') {
  if (!(srcW > 0 && srcH > 0) || fit === 'stretch') return { sx: 0, sy: 0, sw: srcW, sh: srcH, dx: 0, dy: 0, dw: w, dh: h };
  const scale = fit === 'contain' ? Math.min(w / srcW, h / srcH) : Math.max(w / srcW, h / srcH);
  if (fit === 'contain') {
    const dw = srcW * scale, dh = srcH * scale;
    return { sx: 0, sy: 0, sw: srcW, sh: srcH, dx: (w - dw) / 2, dy: (h - dh) / 2, dw, dh };
  }
  const sw = w / scale, sh = h / scale;
  return { sx: (srcW - sw) / 2, sy: (srcH - sh) / 2, sw, sh, dx: 0, dy: 0, dw: w, dh: h };
}

/** Draw a source into the box (x, y, w, h) of a 2D context, over a background colour. */
export function drawFitted(ctx, source, x, y, w, h, fit = 'cover', background = '#000') {
  ctx.fillStyle = background;
  ctx.fillRect(x, y, w, h);
  const [sw, sh] = sourceSize(source);
  if (!(sw > 0 && sh > 0)) return;
  const r = fitRect(sw, sh, w, h, fit);
  ctx.drawImage(source, r.sx, r.sy, r.sw, r.sh, x + r.dx, y + r.dy, r.dw, r.dh);
}

/**
 * Does a source have a picture it has not shown yet? A video that can say when it presents a frame (`requestVideoFrameCallback`, in every current browser) is asked;
 * an older one is judged by its clock moving; anything else (a canvas, a bitmap) counts as always new.
 */
export class FrameWatcher {
  constructor(source) {
    this.source = source; this.last = NaN; this.fresh = true; this.handle = 0; this.stopped = false;
    if (typeof source.requestVideoFrameCallback === 'function') {
      this.callback = () => { this.fresh = true; if (!this.stopped) this.handle = source.requestVideoFrameCallback(this.callback); };
      this.handle = source.requestVideoFrameCallback(this.callback);
    }
  }

  poll() {
    const s = this.source;
    if (!('currentTime' in s && 'readyState' in s)) return true;
    if (s.readyState < 2 || !(s.videoWidth > 0)) return false;
    if (this.callback) { const f = this.fresh; this.fresh = false; return f; }
    const changed = s.currentTime !== this.last;
    this.last = s.currentTime;
    return changed;
  }

  /** Stop listening to the video. */
  destroy() { this.stopped = true; if (this.handle) this.source.cancelVideoFrameCallback?.(this.handle); this.handle = 0; }
}

function defaultCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

/** One layer of a 3D `TextureSet` showing a moving picture. Give `layer` to `DrawList3D.setMaterial` like any other texture. */
export class VideoTexture {
  /**
   * @param {import('./textures.js').TextureSet} set A plain-pixel set with room for one more layer.
   * @param {any} source A `<video>`, canvas, `ImageBitmap` or `VideoFrame`.
   * @param {object} [o]
   * @param {string} [o.name] Name of the layer in the set. @param {VideoFit} [o.fit] How the picture meets the square layer (`cover`).
   * @param {string} [o.background] Colour behind a `contain` picture (black). @param {(w: number, h: number) => any} [o.createCanvas]
   */
  constructor(set, source, { name = 'video', fit = 'cover', background = '#000', createCanvas = defaultCanvas } = {}) {
    this.set = set; this.source = source; this.fit = fit; this.background = background;
    this.canvas = createCanvas(set.size, set.size);
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    this.watch = new FrameWatcher(source);
    const black = new Uint8Array(set.size * set.size * 4);
    for (let i = 3; i < black.length; i += 4) black[i] = 255;
    /** The layer number in the set: what `DrawList3D.setMaterial` picks. */
    this.layer = set.add({ width: set.size, height: set.size, data: black }, name);
    /** How many frames have been uploaded. */
    this.frames = 0;
  }

  /** Stop watching the video (it keeps playing; the layer keeps its last picture). */
  destroy() { this.watch.destroy(); }

  /** Copy the current picture into the layer if there is a new one. Returns true if it did. */
  update() {
    if (!this.watch.poll()) return false;
    drawFitted(this.ctx, this.source, 0, 0, this.set.size, this.set.size, this.fit, this.background);
    const image = this.ctx.getImageData(0, 0, this.set.size, this.set.size);
    this.set.update(this.layer, image);
    this.frames++;
    return true;
  }
}

/** A rectangle of the 2D `Atlas` showing a moving picture; draw it like any sprite (`batch.push(sprite, ...)`). */
export class VideoSprite {
  /**
   * @param {import('./atlas.js').Atlas} atlas
   * @param {any} source A `<video>`, canvas, `ImageBitmap` or `VideoFrame`.
   * @param {object} o
   * @param {string} o.name Sprite name. @param {number} o.width @param {number} o.height Size in atlas pixels.
   * @param {VideoFit} [o.fit] (`cover`) @param {string} [o.background] Colour behind a `contain` picture (black).
   */
  constructor(atlas, source, { name, width, height, fit = 'cover', background = '#000' }) {
    if (!name || !(width > 0) || !(height > 0)) throw new Error('a video sprite needs a name, a width and a height');
    this.atlas = atlas; this.source = source; this.name = name; this.fit = fit; this.background = background;
    this.watch = new FrameWatcher(source);
    /** @type {import('./atlas.js').Sprite} */
    this.sprite = atlas.add(name, width, height, (ctx, x, y, w, h) => { ctx.fillStyle = background; ctx.fillRect(x, y, w, h); });
    this.frames = 0;
  }

  /** Stop watching the video (it keeps playing; the sprite keeps its last picture). */
  destroy() { this.watch.destroy(); }

  /** Draw the current picture into the atlas if there is a new one. Returns true if it did. Note the whole atlas page is uploaded again, so keep video on a page of its own (a small `Atlas`) when the others are big. */
  update() {
    if (!this.watch.poll()) return false;
    this.atlas.redraw(this.name, (ctx, x, y, w, h) => drawFitted(ctx, this.source, x, y, w, h, this.fit, this.background));
    this.frames++;
    return true;
  }
}
