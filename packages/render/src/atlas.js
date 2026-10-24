/**
 * Shelf packer: rectangles go left to right in rows ("shelves"); a new shelf
 * opens when a rectangle does not fit the current row. Simple, predictable, and
 * good enough for sprite sheets. Pure logic, no canvas.
 */
export class ShelfPacker {
  /**
   * @param {number} width
   * @param {number} height
   * @param {number} [padding] Gap around each rectangle (stops texture filtering from bleeding).
   */
  constructor(width, height, padding = 1) {
    this.width = width;
    this.height = height;
    this.padding = padding;
    this.x = 0;
    this.y = 0;
    this.shelfHeight = 0;
  }

  /** @returns {{x: number, y: number} | null} Top-left of the placed rectangle, or null if it does not fit. */
  pack(w, h) {
    const p = this.padding;
    const pw = w + p * 2, ph = h + p * 2;
    if (pw > this.width || ph > this.height) return null;
    if (this.x + pw > this.width) {
      this.y += this.shelfHeight;
      this.x = 0;
      this.shelfHeight = 0;
    }
    if (this.y + ph > this.height) return null;
    const pos = { x: this.x + p, y: this.y + p };
    this.x += pw;
    if (ph > this.shelfHeight) this.shelfHeight = ph;
    return pos;
  }
}

/**
 * @typedef {Object} Sprite
 * @property {number} u0 @property {number} v0 @property {number} u1 @property {number} v1 Normalised rectangle within its page.
 * @property {number} w @property {number} h Size in atlas pixels.
 * @property {number} x @property {number} y Position in atlas pixels.
 * @property {number} page Which page (texture layer) the sprite lives on.
 * @property {boolean} sdf True for signed-distance-field sprites (text): drawn with an edge threshold instead of as plain colour.
 * @property {boolean} unlit True for sprites that ignore 2D lighting (a HUD picture, a glow, a particle): they always draw at full brightness.
 */

/**
 * @typedef {Object} AtlasPage
 * @property {any} canvas @property {any} ctx
 * @property {ShelfPacker} packer
 * @property {number} version Bumps whenever this page changes, so renderers re-upload only the pages that did.
 * @property {{canvas: any, ctx: any, version: number} | null} normals This page's normal-map twin (same size, same rectangles), once the atlas has any normal maps.
 */

/**
 * Sprite storage backed by 2D canvases, in one or more same-sized pages. Sprites are drawn into it by name; when a page
 * fills up the next page is started automatically (up to `maxPages`), so a game never has to size the atlas exactly.
 * All pages are drawn in one draw call: renderers keep them as layers of one texture array.
 */
export class Atlas {
  /**
   * @param {object} [o]
   * @param {number} [o.size] Width and height of every page in pixels.
   * @param {number} [o.maxPages] Most pages the atlas may grow to (texture array layers; keep at or below 64).
   * @param {(w: number, h: number) => any} [o.createCanvas] Defaults to OffscreenCanvas / a DOM canvas.
   */
  constructor({ size = 1024, maxPages = 8, createCanvas = defaultCreateCanvas } = {}) {
    if (maxPages < 1 || maxPages > 255) throw new Error('maxPages must be 1 to 255');
    this.size = size;
    this.maxPages = maxPages;
    this.createCanvas = createCanvas;
    /** @type {AtlasPage[]} */
    this.pages = [];
    /** @type {Map<string, Sprite>} */
    this.sprites = new Map();
    /** Bumps on every change to any page. */
    this.version = 0;
    /** True once any sprite has a normal map: every page then has a normal-map twin (flat where nothing was painted). */
    this.hasNormals = false;
    this.#addPage();
  }

  #addPage() {
    const canvas = this.createCanvas(this.size, this.size);
    const page = { canvas, ctx: canvas.getContext('2d', { willReadFrequently: false }), packer: new ShelfPacker(this.size, this.size, 1), version: 0, normals: null };
    this.pages.push(page);
    if (this.hasNormals) this.#addNormals(page);
  }

  #addNormals(page) {
    const canvas = this.createCanvas(this.size, this.size), ctx = canvas.getContext('2d', { willReadFrequently: false });
    ctx.fillStyle = 'rgb(128,128,255)';                 // a flat surface: the normal points straight at the viewer
    ctx.fillRect(0, 0, this.size, this.size);
    page.normals = { canvas, ctx, version: 0 };
  }

  /** The first page's canvas (what a single-page atlas used to expose). */
  get canvas() { return this.pages[0].canvas; }
  /** The first page's 2D context: handy for measuring text. */
  get ctx() { return this.pages[0].ctx; }
  get packer() { return this.pages[this.pages.length - 1].packer; }

  /**
   * Allocate a rectangle and let `draw(ctx, x, y, w, h)` paint into it.
   * @param {string} name
   * @param {number} w
   * @param {number} h
   * @param {(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) => void} draw
   * @param {{sdf?: boolean, unlit?: boolean, normal?: (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) => void}} [o] `sdf`: the pixels are a distance field in the alpha channel (see sdf.js).
   * `unlit`: the sprite ignores 2D lighting. `normal`: paints the sprite's normal map (see `setNormal`).
   * @returns {Sprite}
   */
  add(name, w, h, draw, { sdf = false, unlit = false, normal } = {}) {
    if (this.sprites.has(name)) throw new Error(`atlas already has "${name}"`);
    let page = this.pages.length - 1;
    let pos = this.pages[page].packer.pack(w, h);
    if (!pos && w + 2 <= this.size && h + 2 <= this.size && this.pages.length < this.maxPages) { // this page is full: start another
      this.#addPage();
      page++;
      pos = this.pages[page].packer.pack(w, h);
    }
    if (!pos) throw new Error(`atlas full: cannot fit "${name}" (${w}x${h}) in ${this.pages.length} page(s) of ${this.size}x${this.size}`);
    const { ctx } = this.pages[page];
    ctx.save();
    ctx.beginPath();
    ctx.rect(pos.x, pos.y, w, h);
    ctx.clip();
    draw(ctx, pos.x, pos.y, w, h);
    ctx.restore();
    const s = this.size;
    const sprite = { u0: pos.x / s, v0: pos.y / s, u1: (pos.x + w) / s, v1: (pos.y + h) / s, w, h, x: pos.x, y: pos.y, page, sdf, unlit };
    this.sprites.set(name, sprite);
    this.pages[page].version++;
    this.version++;
    if (normal) this.setNormal(name, normal);
    return sprite;
  }

  /**
   * Give a sprite a normal map for 2D lighting: `draw(ctx, x, y, w, h)` paints it into the same rectangle on the page's normal-map twin. The usual convention: red is how far the surface
   * leans right, green how far it leans up the picture, blue straight out (so `rgb(128, 128, 255)` is flat). Paint it opaque. Sprites without one are flat.
   * @param {string} name @param {(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) => void} draw
   */
  setNormal(name, draw) {
    const sprite = this.get(name);
    if (!this.hasNormals) { this.hasNormals = true; for (const p of this.pages) this.#addNormals(p); }
    const page = this.pages[sprite.page], { ctx } = page.normals;
    ctx.save();
    ctx.beginPath();
    ctx.rect(sprite.x, sprite.y, sprite.w, sprite.h);
    ctx.clip();
    ctx.fillStyle = 'rgb(128,128,255)';
    ctx.fillRect(sprite.x, sprite.y, sprite.w, sprite.h);
    draw(ctx, sprite.x, sprite.y, sprite.w, sprite.h);
    ctx.restore();
    page.normals.version++;
    this.version++;
  }

  /**
   * Paint a sprite's rectangle again (a video frame, a minimap, a health bar): clears it, then `draw(ctx, x, y, w, h)` paints. The page is uploaded again by the renderers,
   * so keep sprites that change every frame on a page of their own (a small atlas) when the other pages are big.
   * @param {string} name @param {(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) => void} draw
   */
  redraw(name, draw) {
    const sprite = this.get(name), page = this.pages[sprite.page], { ctx } = page;
    ctx.save();
    ctx.beginPath();
    ctx.rect(sprite.x, sprite.y, sprite.w, sprite.h);
    ctx.clip();
    ctx.clearRect(sprite.x, sprite.y, sprite.w, sprite.h);
    draw(ctx, sprite.x, sprite.y, sprite.w, sprite.h);
    ctx.restore();
    page.version++;
    this.version++;
  }

  /**
   * Empty the atlas: every sprite is forgotten and every page is blank again, so a long-running game can start afresh when text has filled it up (see `Font.atlasFull`). Do it between frames,
   * and give text an atlas of its own, because everything in it goes (anything else must be added again, and every `Font` or `BitmapFont` using it needs `reset()`).
   */
  clear() {
    for (const page of this.pages) {
      page.ctx.clearRect(0, 0, this.size, this.size);
      page.packer = new ShelfPacker(this.size, this.size, 1);
      page.version++;
      if (page.normals) { page.normals.ctx.fillStyle = 'rgb(128,128,255)'; page.normals.ctx.fillRect(0, 0, this.size, this.size); page.normals.version++; }
    }
    this.sprites.clear();
    this.version++;
  }

  /** @param {string} name @returns {Sprite} */
  get(name) {
    const s = this.sprites.get(name);
    if (!s) throw new Error(`no sprite "${name}" in atlas`);
    return s;
  }
}

function defaultCreateCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}
