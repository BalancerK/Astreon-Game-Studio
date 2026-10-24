/**
 * Textures for the 3D renderers: a `TextureSet` holds up to `maxLayers` square images of one size (so they can live in one GPU
 * texture array), with mipmaps already computed, and an instance picks one by its layer number (`DrawList3D.setMaterial`).
 * Pixels are 8-bit RGBA, stored as they are (no sRGB conversion), multiplied by the instance colour in the shader like any other colour. A set can instead hold
 * pictures already compressed for the graphics card (BC1, BC3, BC7, ETC2, ASTC 4x4, read from KTX2 files by `parseKtx2`), which take a quarter to an eighth of the memory.
 *
 * The set is plain data, so it works in Node (tests, tools) as well as in the browser; a renderer uploads what is new when you
 * give it the set with `renderer.setTextures(set)`.
 */

import { TEXTURE_FORMATS } from './ktx2.js';

/** @typedef {{width: number, height: number, data: ArrayLike<number>}} ImageLike RGBA bytes, row 0 at the top (an `ImageData` fits) */

/**
 * Square images of one size for the 3D renderers, kept together so they live in one GPU texture array, with mipmaps already
 * computed. `add(image, name)` returns the layer number an instance picks with `setMaterial`. Plain data: it works in Node as well
 * as the browser.
 */
export class TextureSet {
  /**
   * @param {object} [o]
   * @param {number} [o.size] Width and height of every layer: a power of two from 16 to 2048 (default 256)
   * @param {number} [o.maxLayers] How many images the set can hold (default 16)
   * @param {'rgba8' | 'bc1' | 'bc3' | 'bc7' | 'etc2' | 'astc4x4'} [o.format] How the pictures are stored (default 'rgba8', plain pixels). A set of a compressed format holds pictures compressed for the graphics card, added with `addKtx2`; it needs a card that reads that format (the renderer says if not).
   */
  constructor({ size = 256, maxLayers = 16, format = 'rgba8' } = {}) {
    if (!TEXTURE_FORMATS.includes(format)) throw new Error(`texture format must be one of ${TEXTURE_FORMATS.join(', ')} (got ${format})`);
    if (!Number.isInteger(size) || size < 16 || size > 2048 || (size & (size - 1)) !== 0) throw new Error(`texture size must be a power of two from 16 to 2048 (got ${size})`);
    if (!Number.isInteger(maxLayers) || maxLayers < 1 || maxLayers > 256) throw new Error(`maxLayers must be 1..256 (got ${maxLayers})`);
    this.size = size;
    this.format = format;
    this.maxLayers = maxLayers;
    /** Number of mip levels (size down to 1 x 1). */
    this.levels = Math.log2(size) + 1;
    /** @type {{name: string, mips: Uint8Array[], version: number}[]} */
    this.layers = [];
    /** Increases whenever a layer is added; renderers upload what they have not seen. (A layer changed by `update` bumps its own `version` instead.) */
    this.version = 0;
  }

  /**
   * Add an image and get its layer number. An image of another size is resampled to the set's size.
   * @param {ImageLike} image
   * @param {string} [name]
   * @returns {number} the layer
   */
  add(image, name = `layer${this.layers.length}`) {
    if (this.layers.length >= this.maxLayers) throw new Error(`the texture set is full (${this.maxLayers} layers)`);
    if (this.format !== 'rgba8') throw new Error(`this texture set holds ${this.format} pictures: add them from a KTX2 file with addKtx2`);
    if (!image || !(image.width >= 1) || !(image.height >= 1) || !image.data) throw new Error('an image needs width, height and RGBA data');
    if (image.data.length !== image.width * image.height * 4) throw new Error(`image data has ${image.data.length} bytes, expected ${image.width * image.height * 4} for ${image.width} x ${image.height} RGBA`);
    const base = image.width === this.size && image.height === this.size ? Uint8Array.from(image.data) : resample(image, this.size);
    const mips = [base];
    for (let level = 1, s = this.size >> 1; s >= 1; level++, s >>= 1) mips.push(halve(mips[level - 1], s * 2));
    this.layers.push({ name, mips, version: 1 });
    this.version++;
    return this.layers.length - 1;
  }

  /**
   * Replace the pixels of a layer that is already in the set (a video frame, a painted-on screen, a decal that gets damaged) and rebuild its mip levels in place,
   * allocating nothing. Renderers upload the layer again the next time they draw. Plain-pixel sets only; an image of another size is resampled.
   * @param {number} layer @param {ImageLike} image
   */
  update(layer, image) {
    const l = this.layers[layer];
    if (!l) throw new Error(`no layer ${layer} in the texture set`);
    if (this.format !== 'rgba8') throw new Error(`this texture set holds ${this.format} pictures, which cannot be changed pixel by pixel`);
    if (!image || !(image.width >= 1) || !(image.height >= 1) || !image.data) throw new Error('an image needs width, height and RGBA data');
    if (image.data.length !== image.width * image.height * 4) throw new Error(`image data has ${image.data.length} bytes, expected ${image.width * image.height * 4} for ${image.width} x ${image.height} RGBA`);
    if (image.width === this.size && image.height === this.size) l.mips[0].set(image.data);
    else l.mips[0].set(resample(image, this.size));
    for (let level = 1, s = this.size >> 1; s >= 1; level++, s >>= 1) halve(l.mips[level - 1], s * 2, l.mips[level]);
    l.version++;
  }

  /**
   * Add a picture read from a KTX2 file (see `parseKtx2`). In a set of plain pixels, an RGBA8 picture is added like any image; in a compressed set the picture must be in the set's format,
   * exactly `size` x `size`, with all its mip levels (they cannot be made from compressed data).
   * @param {Awaited<ReturnType<typeof parseKtx2>>} ktx
   * @param {string} [name]
   * @returns {number} the layer
   */
  addKtx2(ktx, name = `layer${this.layers.length}`) {
    if (this.layers.length >= this.maxLayers) throw new Error(`the texture set is full (${this.maxLayers} layers)`);
    if (this.format === 'rgba8') {
      if (ktx.format !== 'rgba8') throw new Error(`this texture set holds plain pixels but the picture is ${ktx.format}: make the set with { format: '${ktx.format}' }`);
      return this.add({ width: ktx.width, height: ktx.height, data: ktx.levels[0] }, name);
    }
    if (ktx.format !== this.format) throw new Error(`this texture set holds ${this.format} pictures but the picture is ${ktx.format}`);
    if (ktx.width !== this.size || ktx.height !== this.size) throw new Error(`a compressed picture must be exactly ${this.size} x ${this.size} like the set (it is ${ktx.width} x ${ktx.height}); it cannot be resized`);
    if (ktx.levels.length !== this.levels) throw new Error(`a compressed picture needs all ${this.levels} mip levels (down to 1 x 1) and this one has ${ktx.levels.length}`);
    this.layers.push({ name, mips: ktx.levels, version: 1 });
    this.version++;
    return this.layers.length - 1;
  }

  /** The layer number of a named image, or -1. */
  find(name) { return this.layers.findIndex((l) => l.name === name); }
}

/** Average 2 x 2 blocks: the next mip level of a `size` x `size` image. */
function halve(src, size, out = new Uint8Array((size >> 1) * (size >> 1) * 4)) {
  const n = size >> 1;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    for (let c = 0; c < 4; c++) {
      const i = ((y * 2) * size + x * 2) * 4 + c;
      out[(y * n + x) * 4 + c] = (src[i] + src[i + 4] + src[i + size * 4] + src[i + size * 4 + 4] + 2) >> 2;
    }
  }
  return out;
}

/** Bilinear resample of any image to size x size. */
function resample(img, size) {
  const out = new Uint8Array(size * size * 4), { width: w, height: h, data } = img;
  for (let y = 0; y < size; y++) {
    const fy = Math.max(0, ((y + 0.5) * h) / size - 0.5), y0 = Math.min(h - 1, Math.floor(fy)), y1 = Math.min(h - 1, y0 + 1), ty = fy - y0;
    for (let x = 0; x < size; x++) {
      const fx = Math.max(0, ((x + 0.5) * w) / size - 0.5), x0 = Math.min(w - 1, Math.floor(fx)), x1 = Math.min(w - 1, x0 + 1), tx = fx - x0;
      for (let c = 0; c < 4; c++) {
        const top = data[(y0 * w + x0) * 4 + c] * (1 - tx) + data[(y0 * w + x1) * 4 + c] * tx;
        const bottom = data[(y1 * w + x0) * 4 + c] * (1 - tx) + data[(y1 * w + x1) * 4 + c] * tx;
        out[(y * size + x) * 4 + c] = Math.round(top * (1 - ty) + bottom * ty);
      }
    }
  }
  return out;
}

// ---------- procedural textures: tileable, deterministic, no image files needed ----------

function rng(seed) { let s = seed >>> 0 || 1; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }

/** Smooth value noise that repeats every `cells` cells (so the image tiles): a function of (x, y) in 0..1. */
function periodicNoise(cells, seed) {
  const r = rng(seed), grid = new Float64Array(cells * cells);
  for (let i = 0; i < grid.length; i++) grid[i] = r();
  const smooth = (t) => t * t * (3 - 2 * t);
  return (x, y) => {
    const fx = x * cells, fy = y * cells, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = smooth(fx - x0), ty = smooth(fy - y0);
    const at = (i, j) => grid[(((j % cells) + cells) % cells) * cells + (((i % cells) + cells) % cells)];
    return (at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx) * (1 - ty) + (at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx) * ty;
  };
}

/** Fractal noise from `octaves` periodic layers, 0..1. */
function fbm(baseCells, octaves, seed) {
  const layers = Array.from({ length: octaves }, (_, o) => periodicNoise(baseCells << o, seed + o * 101));
  return (x, y) => { let sum = 0, amp = 1, norm = 0; for (let o = 0; o < octaves; o++) { sum += layers[o](x, y) * amp; norm += amp; amp *= 0.5; } return sum / norm; };
}

function paint(size, pixel) {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const c = pixel(x / size, y / size, x, y);
    const o = (y * size + x) * 4;
    data[o] = Math.max(0, Math.min(255, Math.round(c[0] * 255))); data[o + 1] = Math.max(0, Math.min(255, Math.round(c[1] * 255)));
    data[o + 2] = Math.max(0, Math.min(255, Math.round(c[2] * 255))); data[o + 3] = c[3] === undefined ? 255 : Math.round(c[3] * 255);
  }
  return { width: size, height: size, data };
}

/**
 * Make one of the built-in tileable textures. They are bright and fairly neutral, meant to be tinted by the instance colour.
 * @param {'grass' | 'brick' | 'concrete' | 'plates' | 'checker' | 'solid'} kind
 * @param {number} size
 * @param {object} [o]
 * @param {number} [o.seed]
 * @param {number} [o.cells] checker: squares per side (default 8)
 * @param {number[]} [o.colors] checker: two RGB colours 0..1, solid: [r, g, b, a] (defaults: white and mid grey / white)
 * @returns {ImageLike}
 */
export function proceduralTexture(kind, size = 256, { seed = 1, cells = 8, colors } = {}) {
  switch (kind) {
    case 'grass': {
      const broad = fbm(4, 3, seed), blades = fbm(32, 2, seed + 7);
      return paint(size, (u, v) => {
        const b = 0.8 + 0.2 * broad(u, v) + 0.15 * (blades(u, v) - 0.5);
        return [b * 0.9, b, b * 0.82];
      });
    }
    case 'concrete': {
      const mottle = fbm(8, 4, seed), grain = fbm(64, 1, seed + 3);
      return paint(size, (u, v) => { const b = 0.74 + 0.2 * mottle(u, v) + 0.07 * (grain(u, v) - 0.5); return [b, b, b * 1.02]; });
    }
    case 'brick': {
      const rows = 8, perRow = 4, mortar = 0.06, tone = fbm(16, 2, seed), grain = fbm(64, 1, seed + 5), r = rng(seed);
      const rowShade = Array.from({ length: rows * perRow * 2 }, () => 0.88 + r() * 0.12); // each brick a slightly different shade
      return paint(size, (u, v) => {
        const row = Math.floor(v * rows), vy = v * rows - row, shift = (row % 2) * 0.5, bx = u * perRow + shift, col = Math.floor(bx), vx = bx - col;
        const edge = Math.min(vx, 1 - vx, vy, 1 - vy);
        if (edge < mortar / 2 * 1) return [0.62, 0.6, 0.57];
        const shade = rowShade[(row * perRow + (((col % perRow) + perRow) % perRow)) % rowShade.length] * (0.88 + 0.12 * tone(u, v)) * (0.95 + 0.05 * grain(u, v));
        return [shade, shade * 0.9, shade * 0.84];
      });
    }
    case 'plates': { // metal panels with a bevelled seam and four rivets each
      const per = 4, scuff = fbm(32, 3, seed);
      return paint(size, (u, v) => {
        const px = u * per - Math.floor(u * per), py = v * per - Math.floor(v * per);
        const seam = Math.min(px, 1 - px, py, 1 - py);
        let b = 0.8 + 0.12 * scuff(u, v);
        if (seam < 0.025) b *= 0.55; else if (seam < 0.05) b *= 1.12;
        for (const [cx, cy] of [[0.14, 0.14], [0.86, 0.14], [0.14, 0.86], [0.86, 0.86]]) if (Math.hypot(px - cx, py - cy) < 0.035) b *= 1.18;
        return [b * 0.92, b * 0.96, b];
      });
    }
    case 'checker': {
      const [a, b] = [colors?.slice(0, 3) ?? [1, 1, 1], colors?.slice(3, 6).length === 3 ? colors.slice(3, 6) : [0.55, 0.55, 0.55]];
      return paint(size, (u, v) => ((Math.floor(u * cells) + Math.floor(v * cells)) & 1 ? b : a));
    }
    case 'solid': return paint(size, () => colors?.length >= 3 ? colors : [1, 1, 1, 1]);
    default: throw new Error(`unknown procedural texture "${kind}"`);
  }
}
