import { WHITE, packTint } from './batch.js';
import { computeSdf } from './sdf.js';
import { layoutParagraph, drawParagraph, graphemes, needsEngine } from './textlayout.js';

const PAD = 2; // transparent border around each glyph (antialiasing, italic and bold overhang)

/**
 * Text as ordinary sprites. Each glyph is drawn once, in white, into the shared atlas by the browser's own text
 * engine (any installed or web font, emoji, accents, CJK), then drawn like any other sprite and coloured by the tint.
 * So text costs no extra draw call, works identically in all three backends, and sorts with everything else.
 *
 * Glyphs are rasterised at `size * scale` pixels and drawn at `size` world units, so for crisp text pass
 * `scale: devicePixelRatio` and draw it with a screen-space camera (`Camera.setScreenSpace`), where one world
 * unit is one CSS pixel. Text in a zoomed world camera gets blurry or blocky; make a Font at the size you need.
 *
 * Pass `sdf: true` (or `{ size, spread }`) for **scalable text**: glyphs are stored as signed distance fields and the
 * shader draws a sharp anti-aliased edge at any size, rotation or camera zoom (stored once at about 48 px, drawn from 8 to
 * several hundred world units). It costs a one-off distance transform per glyph and is a little softer than hinted
 * raster text at small sizes (under about 14 px), so use plain `Font` for small UI text and `sdf` for the rest.
 *
 * Plain Latin, Cyrillic, Greek and CJK text is laid out glyph by glyph (per-glyph advances, no kerning), with `\n` line breaks and optional word wrap. Text that needs more goes through the
 * layout engine (see textlayout.js) without your doing anything: right-to-left and mixed-direction text is reordered (`bidi.js`), words in Arabic, Hebrew, Indic and Southeast Asian scripts
 * are shaped by the browser as whole words, and an emoji with its skin tone or a letter with accents is one unit.
 */
export class Font {
  /**
   * @param {import('./atlas.js').Atlas} atlas Shared with the renderer; glyphs are added lazily as they are first used.
   * @param {object} [o]
   * @param {string} [o.family] CSS font family list, e.g. `'ui-monospace, Consolas, monospace'`.
   * @param {number} [o.size] Pixel height of the font in world units (for `sdf` fonts: the nominal size; draw at any size with `draw(..., { size })`).
   * @param {string} [o.weight] CSS weight: `'normal'`, `'bold'`, `'600'`.
   * @param {string} [o.style] `'normal'` or `'italic'`.
   * @param {number} [o.scale] Raster scale (use `devicePixelRatio`). Ignored for `sdf` fonts.
   * @param {boolean | {size?: number, spread?: number}} [o.sdf] Store glyphs as signed distance fields: `size` is the raster pixel size (default 48), `spread` the distance range in pixels (default size / 6).
   * @param {string} [o.preload] Characters drawn into the atlas up front (default: printable ASCII).
   * @param {boolean} [o.kerning] Pull letter pairs together the way the font says ("AV", "To"); measured with the browser once per pair. Off by default, which keeps plain text on the fast path.
   */
  constructor(atlas, { family = 'system-ui, sans-serif', size = 16, weight = 'normal', style = 'normal', scale = 1, preload = ASCII, sdf = false, kerning = false } = {}) {
    this.atlas = atlas;
    this.kerning = kerning;
    this.kerns = new Map();
    this.family = family;
    this.size = size;
    const sdfOpts = sdf ? { size: 48, ...(sdf === true ? {} : sdf) } : null;
    if (sdfOpts) sdfOpts.spread ??= Math.max(2, Math.round(sdfOpts.size / 6));
    this.sdf = sdfOpts;
    this.scale = sdfOpts ? 1 : scale;
    /** Pixel size the glyphs are rasterised at. */
    this.rasterPx = sdfOpts ? sdfOpts.size : Math.round(size * scale);
    /** Transparent border around each glyph in atlas pixels (for sdf: the distance range, which must fit). */
    this.pad = sdfOpts ? sdfOpts.spread : PAD;
    /** World units per raster pixel at the nominal size. */
    this.worldPerPx = sdfOpts ? size / sdfOpts.size : 1 / scale;
    this.css = `${style} ${weight} ${this.rasterPx}px ${family}`;
    this.id = sdfOpts ? `font|sdf${sdfOpts.spread}|${this.css}` : `font|${this.css}`;
    this.scratch = null; // sdf rasterisation canvas
    /** @type {Map<number, {sprite: object | null, advance: number}>} */
    this.glyphs = new Map();
    /** @type {Map<string, {sprite: object | null, advance: number, ox: number, oy: number}>} Whole words (and clusters) drawn as one sprite. */
    this.runs = new Map();
    /** True once the atlas ran out of room: new characters then draw as `?` (or nothing). `Atlas.clear()` then `reset()` starts over. */
    this.atlasFull = false;
    const m = this.#measure('Mg');
    this.ascent = Math.ceil(m.ascent);
    this.descent = Math.ceil(m.descent);
    /** Height of one line in world units. */
    this.lineHeight = (this.ascent + this.descent) * this.worldPerPx;
    for (const ch of preload) this.#glyph(ch.codePointAt(0));
  }

  #measure(text) {
    const g = this.atlas.ctx;
    g.save();
    g.font = this.css;
    const m = g.measureText(text);
    g.restore();
    const size = this.rasterPx;
    return {
      width: m.width,
      ascent: m.fontBoundingBoxAscent ?? m.actualBoundingBoxAscent ?? size * 0.8,
      descent: m.fontBoundingBoxDescent ?? m.actualBoundingBoxDescent ?? size * 0.2,
    };
  }

  #glyph(cp) {
    let g = this.glyphs.get(cp);
    if (g) return g;
    const ch = String.fromCodePoint(cp);
    const advance = this.#measure(ch).width;
    g = { sprite: null, advance, ox: -this.pad, oy: -this.pad };
    this.glyphs.set(cp, g);
    if (ch.trim() === '' || cp < 32) return g; // whitespace and controls: advance only
    const name = `${this.id}|${cp}`;
    const pad = this.pad;
    const w = Math.ceil(advance) + pad * 2, h = this.ascent + this.descent + pad * 2;
    try {
      if (this.sdf) {
        g.sprite = this.atlas.sprites.get(name) ?? this.atlas.add(name, w, h, (ctx, x, y) => ctx.putImageData(this.#rasterSdf(ch, w, h), x, y), { sdf: true });
      } else {
        g.sprite = this.atlas.sprites.get(name) ?? this.atlas.add(name, w, h, (ctx, x, y) => {
          ctx.font = this.css;
          ctx.fillStyle = '#fff';
          ctx.textBaseline = 'alphabetic';
          ctx.fillText(ch, x + pad, y + pad + this.ascent);
        });
      }
    } catch (e) {
      if (!/atlas full/.test(e.message)) throw e;
      this.atlasFull = true; // fall back to '?' if we have it
      const q = cp === 63 ? null : this.glyphs.get(63);
      if (q?.sprite) g.sprite = q.sprite;
    }
    return g;
  }

  /** Draw the glyph on a scratch canvas, turn its coverage into a distance field, and return it as an image (distance in alpha, colour white). */
  #rasterSdf(ch, w, h, rtl = false) {
    if (!this.scratch || this.scratch.canvas.width < w || this.scratch.canvas.height < h) {
      const canvas = this.atlas.createCanvas(Math.max(w, this.scratch?.canvas.width ?? 0, 64), Math.max(h, this.scratch?.canvas.height ?? 0, 64));
      this.scratch = { canvas, ctx: canvas.getContext('2d', { willReadFrequently: true }) };
    }
    const { ctx } = this.scratch;
    ctx.clearRect(0, 0, w, h);
    ctx.font = this.css;
    ctx.fillStyle = '#fff';
    ctx.textBaseline = 'alphabetic'; ctx.direction = rtl ? 'rtl' : 'ltr'; ctx.textAlign = 'left';
    ctx.fillText(ch, this.pad, this.pad + this.ascent);
    const src = ctx.getImageData(0, 0, w, h).data;
    const cov = new Uint8Array(w * h);
    for (let i = 0; i < cov.length; i++) cov[i] = src[i * 4 + 3];
    const dist = computeSdf(cov, w, h, this.sdf.spread);
    const img = ctx.createImageData(w, h);
    for (let i = 0; i < dist.length; i++) { img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = 255; img.data[i * 4 + 3] = dist[i]; }
    return img;
  }

  /** The glyph of a character: `{ sprite, advance, ox, oy }` in raster pixels (the layout engine's view of a font). */
  glyph(cp) { return this.#glyph(cp); }

  #engineFor(text) { return this.kerning || needsEngine(text); }

  /** How much closer (negative) or further apart two characters sit than their separate advances say, in raster pixels; 0 unless the font was made with `kerning: true`. */
  kern(a, b) {
    if (!this.kerning) return 0;
    const key = a * 0x200000 + b;
    let k = this.kerns.get(key);
    if (k === undefined) { const A = String.fromCodePoint(a), B = String.fromCodePoint(b); k = this.#measure(A + B).width - this.#measure(A).width - this.#measure(B).width; if (Math.abs(k) < 0.01) k = 0; this.kerns.set(key, k); }
    return k;
  }

  /** Forget every glyph that was drawn into the atlas, after `Atlas.clear()`: the font draws them again as they are needed. */
  reset() { this.glyphs.clear(); this.runs.clear(); this.atlasFull = false; }

  /**
   * A whole word (or cluster) drawn as one sprite by the browser's text engine, which shapes it: Arabic letters join, Hebrew points sit on their letters, Indic and Thai clusters form.
   * `rtl` says the word is in a right-to-left run (so the engine lays its letters out right to left). Cached in the atlas.
   * @param {string} text @param {boolean} [rtl] @returns {{sprite: object | null, advance: number, ox: number, oy: number}}
   */
  run(text, rtl = false) {
    const key = `${rtl ? 'r' : 'l'}|${text}`;
    let g = this.runs.get(key);
    if (g) return g;
    const m = this.#measureRun(text, rtl), advance = m.width, pad = this.pad;
    g = { sprite: null, advance, ox: -pad, oy: -pad };
    this.runs.set(key, g);
    if (text.trim() === '') return g;
    const w = Math.ceil(advance) + pad * 2, h = this.ascent + this.descent + pad * 2, name = `${this.id}|run|${key}`;
    try {
      if (this.sdf) g.sprite = this.atlas.sprites.get(name) ?? this.atlas.add(name, w, h, (ctx, x, y) => ctx.putImageData(this.#rasterSdf(text, w, h, rtl), x, y), { sdf: true });
      else g.sprite = this.atlas.sprites.get(name) ?? this.atlas.add(name, w, h, (ctx, x, y) => {
        ctx.font = this.css; ctx.fillStyle = '#fff'; ctx.textBaseline = 'alphabetic'; ctx.direction = rtl ? 'rtl' : 'ltr'; ctx.textAlign = 'left';
        ctx.fillText(text, x + pad, y + pad + this.ascent);
      });
    } catch (e) {
      if (!/atlas full/.test(e.message)) throw e;
      this.atlasFull = true;
    }
    return g;
  }

  #measureRun(text, rtl) {
    const g = this.atlas.ctx;
    g.save(); g.font = this.css; g.direction = rtl ? 'rtl' : 'ltr';
    const m = g.measureText(text);
    g.restore();
    return { width: m.width };
  }

  /** The `unit` (size multiplier) for a draw or measure call: `size` is the font size in world units, `unit` a plain multiplier. */
  #unit(o) { return o.size !== undefined ? o.size / this.size : (o.unit ?? 1); }

  /** Advance width of a string in world units, ignoring line breaks. */
  width(text, unit = 1) {
    if (this.#engineFor(text)) return this.#engine(text, { unit }).width;
    let w = 0;
    for (const ch of text) w += this.#glyph(ch.codePointAt(0)).advance;
    return w * this.worldPerPx * unit;
  }

  /**
   * Break text into lines no wider than `maxWidth` (world units). Breaks at spaces; a word wider than the limit
   * is split between characters. `\n` always breaks. Without `maxWidth`, only `\n` breaks.
   * @returns {string[]}
   */
  wrap(text, maxWidth = Infinity, unit = 1) {
    if (this.#engineFor(text)) return this.#engineLines(text, maxWidth, unit);
    const lines = [];
    const emit = (line) => { // one finished line; split it between characters if it is still too wide (a single long word)
      const t = line.trimEnd();
      if (this.width(t, unit) <= maxWidth) { lines.push(t); return; }
      let cur = '';
      for (const ch of t) {
        if (cur !== '' && this.width(cur + ch, unit) > maxWidth) { lines.push(cur); cur = ch; } else cur += ch;
      }
      lines.push(cur);
    };
    for (const para of text.replace(/\t/g, '    ').split('\n')) {
      if (maxWidth === Infinity) { lines.push(para); continue; }
      let line = '';
      for (const word of para.split(/(?<= )/)) { // each word keeps its trailing space
        if (line === '' || this.width((line + word).trimEnd(), unit) <= maxWidth) line += word;
        else { emit(line); line = word; }
      }
      emit(line);
    }
    return lines;
  }

  /**
   * Size of the text box.
   * @param {string} text
   * @param {{maxWidth?: number, unit?: number, size?: number}} [o] `size` is the font size in world units (alternative to `unit`).
   * @returns {{width: number, height: number, lines: string[]}}
   */
  measure(text, o = {}) {
    const maxWidth = o.maxWidth ?? Infinity, unit = this.#unit(o);
    const lines = this.wrap(text, maxWidth, unit);
    let width = 0;
    for (const l of lines) width = Math.max(width, this.width(l, unit));
    return { width, height: lines.length * this.lineHeight * unit, lines };
  }

  /**
   * Append the text to a batch. `x` is the left edge (or centre / right edge, per `align`) and `y` the top of the first line.
   * @param {import('./batch.js').SpriteBatch} batch
   * @param {string} text
   * @param {number} x
   * @param {number} y
   * @param {object} [o]
   * @param {number} [o.tint] See packTint (default white).
   * @param {'left' | 'center' | 'right'} [o.align]
   * @param {number} [o.maxWidth] Word-wrap at this width (world units).
   * @param {number} [o.unit] Size multiplier (2 = twice as big; the glyphs are scaled, not re-rasterised).
   * @param {number} [o.size] Font size in world units, instead of `unit` (for `sdf` fonts any size stays sharp).
   * @param {number} [o.key] Sort key (see `sortKey`); all glyphs share it, so text stays together.
   * @param {boolean} [o.snap] Round glyph positions to device pixels (default true for plain fonts, off for sdf): crisp text, shimmers when moving smoothly.
   * @param {{dx?: number, dy?: number, tint?: number}} [o.shadow] Draw a shadow first (default offset 1, 1; black at half opacity).
   * @returns {{width: number, height: number, lines: string[]}}
   */
  draw(batch, text, x, y, o = {}) {
    const { tint = WHITE, align = 'left', maxWidth = Infinity, key = 0, snap = !this.sdf, shadow } = o;
    const unit = this.#unit(o);
    if (this.#engineFor(text)) return this.#drawEngine(batch, text, x, y, { tint, align, maxWidth, key, shadow, unit, direction: o.direction ?? 'auto' });
    const box = this.measure(text, { maxWidth, unit });
    const passes = shadow ? [{ dx: shadow.dx ?? 1, dy: shadow.dy ?? 1, tint: shadow.tint ?? packTint(0, 0, 0, 128) }, { dx: 0, dy: 0, tint }] : [{ dx: 0, dy: 0, tint }];
    const u = unit * this.worldPerPx; // world units per raster pixel
    const grid = 1 / this.scale;
    const pad = this.pad;
    const q = snap ? (v) => Math.round(v / grid) * grid : (v) => v;
    for (const pass of passes) {
      let top = y + pass.dy * unit;
      for (const line of box.lines) {
        const lw = this.width(line, unit);
        let pen = x + pass.dx * unit + (align === 'center' ? -lw / 2 : align === 'right' ? -lw : 0);
        for (const ch of line) {
          const g = this.#glyph(ch.codePointAt(0));
          if (g.sprite) {
            const s = g.sprite;
            const left = q(pen - pad * u), t = q(top - pad * u);
            batch.push(left + (s.w * u) / 2, t + (s.h * u) / 2, s.w * u, s.h * u, 0, s, pass.tint, key);
          }
          pen += g.advance * u;
        }
        top += this.lineHeight * unit;
      }
    }
    return box;
  }

  /** Lay text out with the engine, paragraph by paragraph. */
  #engine(text, { unit = 1, maxWidth = Infinity, direction = 'auto', align = 'left' } = {}) {
    const style = { typeface: this, scale: unit };
    const paragraphs = [];
    let width = 0, height = 0;
    for (const para of text.replace(/\t/g, '    ').split('\n')) {
      const atoms = graphemes(para).map((ch) => ({ text: ch, style }));
      const layout = layoutParagraph(atoms, { maxWidth, direction, align });
      paragraphs.push({ layout, top: height });
      width = Math.max(width, layout.width);
      height += atoms.length === 0 ? this.lineHeight * unit : layout.height;
    }
    return { paragraphs, width, height };
  }

  #engineLines(text, maxWidth, unit) {
    const out = [];
    for (const p of this.#engine(text, { unit, maxWidth }).paragraphs) { if (p.layout.lines.length === 0) out.push(''); for (const l of p.layout.lines) out.push(l.text); }
    return out;
  }

  #drawEngine(batch, text, x, y, { tint, align, maxWidth, key, shadow, unit, direction }) {
    const { paragraphs, width, height } = this.#engine(text, { unit, maxWidth, direction });
    const lines = [];
    for (const { layout, top } of paragraphs) {
      for (const it of layout.items) {
        const line = layout.lines[it.line], shift = align === 'center' ? -line.width / 2 - line.x : align === 'right' ? -line.width - line.x : -line.x;
        it.x += shift; it.y += top;
      }
      for (const l of layout.lines) lines.push(l.text);
      if (shadow) for (const it of layout.items) it.style = { ...it.style, shadow: { dx: shadow.dx ?? 1, dy: shadow.dy ?? 1, tint: shadow.tint ?? packTint(0, 0, 0, 128) } };
      drawParagraph(batch, layout, x, y, { tint, key });
    }
    return { width, height, lines };
  }
}

const ASCII = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)).join('');
