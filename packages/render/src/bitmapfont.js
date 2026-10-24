import { LayoutTypeface } from './textlayout.js';

/**
 * Bitmap fonts: letters drawn by an artist (or exported from a font tool) into a picture, which is how pixel-art games and games with a hand-made look do text. Two ways in:
 *
 * - **BMFont** (the AngelCode format that BMFont, Hiero, Littera, ShoeBox, Glyph Designer and msdf-bmfont write, as text, XML or JSON): `BitmapFont.fromDescriptor(atlas, fnt, images)` takes the
 *   descriptor and the page picture(s). Per-glyph offsets and advances and **kerning pairs** are honoured.
 * - **A grid of cells** (the classic "font sheet": the characters in order, each in a box of the same size): `BitmapFont.fromGrid(atlas, image, { cellWidth, cellHeight, chars })`.
 *
 * It has the same `draw`, `measure`, `wrap` and `width` as `Font`, and works inside `RichText`. Glyphs are cut out of the picture into the shared atlas the first time they are used, and
 * positions are snapped to whole pixels, so pixel fonts stay crisp (draw them at whole-number sizes).
 */

const attrs = (line) => {
  const out = {};
  for (const m of line.matchAll(/(\w+)=(?:"([^"]*)"|(\S+))/g)) out[m[1]] = m[2] ?? m[3];
  return out;
};
const num = (o, ...keys) => { for (const k of keys) if (o[k] !== undefined && o[k] !== '') return Number(o[k]); return 0; };

/**
 * Read a BMFont descriptor in any of its three forms.
 * @param {string | object} source The `.fnt` text, its XML, or JSON text / an object.
 * @returns {{info: {face: string, size: number}, common: {lineHeight: number, base: number, scaleW: number, scaleH: number}, pages: string[], chars: Map<number, {x: number, y: number, width: number, height: number, xoffset: number, yoffset: number, xadvance: number, page: number}>, kernings: Map<number, number>}}
 */
export function parseBmfont(source) {
  const out = { info: { face: '', size: 0 }, common: { lineHeight: 0, base: 0, scaleW: 0, scaleH: 0 }, pages: [], chars: new Map(), kernings: new Map() };
  const addChar = (o) => { out.chars.set(num(o, 'id'), { x: num(o, 'x'), y: num(o, 'y'), width: num(o, 'width'), height: num(o, 'height'), xoffset: num(o, 'xoffset'), yoffset: num(o, 'yoffset'), xadvance: num(o, 'xadvance'), page: num(o, 'page') }); };
  const addKern = (o) => out.kernings.set(num(o, 'first') * 0x200000 + num(o, 'second'), num(o, 'amount'));
  let obj = null;
  if (typeof source === 'object' && source) obj = source;
  else if (/^\s*[{[]/.test(source)) obj = JSON.parse(source);
  if (obj) {
    out.info = { face: obj.info?.face ?? '', size: Math.abs(obj.info?.size ?? 0) };
    out.common = { lineHeight: obj.common?.lineHeight ?? 0, base: obj.common?.base ?? 0, scaleW: obj.common?.scaleW ?? 0, scaleH: obj.common?.scaleH ?? 0 };
    out.pages = (obj.pages ?? []).map((p) => (typeof p === 'string' ? p : p.file));
    for (const c of obj.chars ?? []) addChar(c);
    for (const k of obj.kernings ?? []) addKern(k);
  } else {
    const isXml = /^\s*<\?xml|^\s*<font/i.test(source);
    for (const raw of source.split(isXml ? /(?=<)/ : /\r?\n/)) {
      const line = raw.trim();
      const tag = isXml ? /^<(\w+)/.exec(line)?.[1] : /^(\w+)/.exec(line)?.[1];
      if (!tag) continue;
      const a = attrs(line);
      if (tag === 'info') out.info = { face: a.face ?? '', size: Math.abs(num(a, 'size')) };
      else if (tag === 'common') out.common = { lineHeight: num(a, 'lineHeight'), base: num(a, 'base'), scaleW: num(a, 'scaleW'), scaleH: num(a, 'scaleH') };
      else if (tag === 'page') out.pages[num(a, 'id')] = a.file;
      else if (tag === 'char') addChar(a);
      else if (tag === 'kerning') addKern(a);
    }
  }
  if (out.chars.size === 0) throw new Error('no characters in the font descriptor');
  if (!(out.common.lineHeight > 0)) throw new Error('the font descriptor has no line height');
  return out;
}

/** A font drawn from a picture: BMFont files or a font sheet (see the notes at the top of this file). Same `draw`, `measure`, `wrap` and `width` as `Font`. */
export class BitmapFont extends LayoutTypeface {
  /**
   * @param {import('./atlas.js').Atlas} atlas @param {ReturnType<typeof parseBmfont>} data @param {any[]} images The page pictures (anything `drawImage` takes), by page number.
   * @param {{name?: string, size?: number}} [o] `name` keeps its glyphs apart from another font's in the atlas; `size` is the size in world units the font draws at (default: its line height in pixels).
   */
  constructor(atlas, data, images, { name = data.info.face || 'bitmapfont', size } = {}) {
    super();
    this.atlas = atlas; this.data = data; this.images = images; this.name = name;
    this.id = `bitmap|${name}`;
    /** Pixels from the top of a line to the baseline, and from the baseline to the bottom. */
    this.ascent = data.common.base; this.descent = Math.max(0, data.common.lineHeight - data.common.base);
    this.size = size ?? data.common.lineHeight; this.worldPerPx = this.size / data.common.lineHeight;
    this.pad = 0; this.scale = 1; this.sdf = false;
    /** @type {Map<number, {sprite: object | null, advance: number, ox: number, oy: number}>} */ this.glyphs = new Map();
    /** True once the atlas ran out of room. */ this.atlasFull = false;
  }

  /** Load a BMFont. @param {import('./atlas.js').Atlas} atlas @param {string | object} descriptor @param {any | any[]} images One picture per page (a single picture for a one-page font). @param {{name?: string, size?: number}} [o] */
  static fromDescriptor(atlas, descriptor, images, o) {
    const data = parseBmfont(descriptor), list = Array.isArray(images) ? images : [images];
    return new BitmapFont(atlas, data, list, o);
  }

  /**
   * A font from a sheet of equal cells. `chars` lists the characters in reading order (left to right, top to bottom); cells with no character are skipped. Every glyph advances by
   * `advance` (default the cell width: a fixed-width font), or give `advances` as a map to make a proportional one.
   * @param {import('./atlas.js').Atlas} atlas @param {any} image
   * @param {{cellWidth: number, cellHeight: number, chars: string, columns?: number, margin?: number, spacing?: number, advance?: number, advances?: Record<string, number>, baseline?: number, imageWidth?: number, name?: string, size?: number}} o
   */
  static fromGrid(atlas, image, { cellWidth, cellHeight, chars, columns, margin = 0, spacing = 0, advance, advances = {}, baseline, imageWidth, name = 'grid', size }) {
    const cols = columns ?? Math.floor(((imageWidth ?? image.width) - margin * 2 + spacing) / (cellWidth + spacing));
    if (!(cols >= 1)) throw new Error('the picture is narrower than one cell: give columns or imageWidth');
    const data = { info: { face: name, size: cellHeight }, common: { lineHeight: cellHeight, base: baseline ?? Math.round(cellHeight * 0.8), scaleW: imageWidth ?? image.width ?? 0, scaleH: image.height ?? 0 }, pages: [name], chars: new Map(), kernings: new Map() };
    let i = 0;
    for (const ch of chars) {
      const col = i % cols, row = Math.floor(i / cols);
      data.chars.set(ch.codePointAt(0), { x: margin + col * (cellWidth + spacing), y: margin + row * (cellHeight + spacing), width: cellWidth, height: cellHeight, xoffset: 0, yoffset: 0, xadvance: advances[ch] ?? advance ?? cellWidth, page: 0 });
      i++;
    }
    return new BitmapFont(atlas, data, [image], { name, size });
  }

  /** The glyph of a character: `{ sprite, advance, ox, oy }` in pixels; a character the font does not have draws as `?` (or nothing). */
  glyph(cp) {
    let g = this.glyphs.get(cp);
    if (g) return g;
    let c = this.data.chars.get(cp);
    if (!c && cp !== 0x3f && this.data.chars.has(0x3f)) { g = this.glyph(0x3f); this.glyphs.set(cp, g); return g; }      // a character the font lacks draws as '?' if it has one
    g = { sprite: null, advance: c ? c.xadvance : this.data.common.lineHeight / 2, ox: c?.xoffset ?? 0, oy: c?.yoffset ?? 0 };
    this.glyphs.set(cp, g);
    if (c && c.width > 0 && c.height > 0) {
      const image = this.images[c.page] ?? this.images[0], name = `${this.id}|${cp}`;
      try {
        g.sprite = this.atlas.sprites.get(name) ?? this.atlas.add(name, c.width, c.height, (ctx, x, y) => ctx.drawImage(image, c.x, c.y, c.width, c.height, x, y, c.width, c.height));
      } catch (e) { if (!/atlas full/.test(e.message)) throw e; this.atlasFull = true; }
    }
    return g;
  }

  /** Forget the glyphs cut into the atlas, after `Atlas.clear()`: they are cut again as they are needed. */
  reset() { this.glyphs.clear(); this.atlasFull = false; }

  /** Kerning between two characters in pixels (usually negative or 0). */
  kern(a, b) { return this.data.kernings.get(a * 0x200000 + b) ?? 0; }
  /** Does the font have this character? */
  has(cp) { return this.data.chars.has(cp); }
}
