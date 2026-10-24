import { Font } from './text.js';
import { LayoutTypeface, layoutParagraph, drawParagraph, linkBoxes, graphemes } from './textlayout.js';
import { packTint } from './batch.js';

/**
 * Rich text: a small BBCode-style markup for colours, sizes, bold and italic, shadows, outlines, links, inline pictures and animated effects, laid out with wrapping, alignment, mixed
 * left-to-right and right-to-left text, and typewriter reveals. `FontStack` falls back from one font to the next for characters a font does not have; `FontFamily` makes the bold and italic
 * variants of a font on demand.
 *
 * ```
 * [b]bold[/b] [i]italic[/i] [u]underline[/u] [s]strike[/s]
 * [color=red]named[/color] [color=#ff8800]hex[/color] [size=28]size in world units[/size] [size=+6]relative[/size]
 * [shadow]drop shadow[/shadow] [shadow=2,2,#000000a0] [outline=1.5,#202020]outline[/outline]
 * [url=quest:12]a link[/url]   [img=coin w=18 h=18 valign=middle]   [font=mono]another font[/font]
 * [wave]wave[/wave] [shake]shake[/shake] [rainbow]rainbow[/rainbow] [fade]fade in[/fade]   [center]aligned[/center] [right]...[/right]
 * [[ is a literal bracket (so is \[ )
 * ```
 */

const COLORS = {
  white: '#ffffff', black: '#000000', red: '#ff4040', green: '#40d060', blue: '#4080ff', yellow: '#ffe040', orange: '#ff9020', purple: '#a060ff', cyan: '#40e0ff', magenta: '#ff40d0', gray: '#a0a0a0', grey: '#a0a0a0',
  pink: '#ff90c0', brown: '#a06030', lime: '#a0ff30', teal: '#20b0a0', gold: '#ffc820', silver: '#d0d0d8', navy: '#203080',
};

/** Parse `#rgb`, `#rrggbb`, `#rrggbbaa` or a colour name into a packed tint (see `packTint`), or null. @param {string} text */
export function parseColor(text) {
  let h = COLORS[String(text).trim().toLowerCase()] ?? String(text).trim();
  const m = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(h);
  if (!m) return null;
  h = m[1]; if (h.length <= 4) h = [...h].map((c) => c + c).join('');
  const n = (i) => parseInt(h.slice(i, i + 2), 16);
  return packTint(n(0), n(2), n(4), h.length === 8 ? n(6) : 255);
}

const TAGS = new Set(['b', 'i', 'u', 's', 'color', 'size', 'shadow', 'outline', 'url', 'link', 'font', 'wave', 'shake', 'rainbow', 'fade', 'center', 'left', 'right', 'img']);

/**
 * Read the markup into a list of styled stretches. An unknown tag is kept as text, a closing tag that matches nothing is dropped, and tags still open at the end are closed.
 * @param {string} source
 * @returns {{text: string, style: object, image?: {name: string, w?: number, h?: number, valign?: string, dy?: number}}[]} In reading order; `style` is a fresh object for each stretch.
 */
export function parseMarkup(source) {
  const spans = [], stack = [], base = {};
  let cur = base, text = '';
  const flush = () => { if (text) { spans.push({ text, style: cur }); text = ''; } };
  const open = (name, update) => { flush(); stack.push({ name, style: cur }); cur = { ...cur, ...update }; };
  const s = String(source);
  for (let i = 0; i < s.length;) {
    const c = s[i];
    if (c === '\\' && (s[i + 1] === '[' || s[i + 1] === '\\')) { text += s[i + 1]; i += 2; continue; }
    if (c === '[' && s[i + 1] === '[') { text += '['; i += 2; continue; }
    if (c !== '[') { text += c; i++; continue; }
    const end = s.indexOf(']', i);
    const raw = end < 0 ? null : s.slice(i + 1, end);
    const m = raw === null ? null : /^(\/)?([a-z]+)(?:=([^\s\]]*))?((?:\s+\w+=(?:"[^"]*"|[^\s\]]+))*)\s*$/i.exec(raw);
    const name = m?.[2]?.toLowerCase();
    if (!m || !TAGS.has(name)) { text += c; i++; continue; }
    i = end + 1;
    const [, closing, , value, rest] = m;
    if (closing) {
      for (let k = stack.length - 1; k >= 0; k--) if (stack[k].name === name || (name === 'link' && stack[k].name === 'url')) { flush(); cur = stack[k].style; stack.length = k; break; }
      continue;
    }
    const opts = {}; for (const a of rest.matchAll(/(\w+)=(?:"([^"]*)"|(\S+))/g)) opts[a[1].toLowerCase()] = a[2] ?? a[3];
    switch (name) {
      case 'b': open(name, { bold: true }); break;
      case 'i': open(name, { italic: true }); break;
      case 'u': open(name, { underline: true }); break;
      case 's': open(name, { strike: true }); break;
      case 'color': { const t = parseColor(value ?? ''); if (t === null) { text += `[${raw}]`; break; } open(name, { color: t }); break; }
      case 'size': { const v = Number(value); if (!Number.isFinite(v) || value === '') { text += `[${raw}]`; break; } open(name, /^[+-]/.test(value) ? { sizeDelta: (cur.sizeDelta ?? 0) + v } : { size: v, sizeDelta: 0 }); break; }
      case 'shadow': { const [dx, dy, col] = (value ?? '').split(','); open(name, { shadow: { dx: dx ? Number(dx) : 1, dy: dy ? Number(dy) : 1, tint: col ? parseColor(col) ?? 0x80000000 : 0x80000000 } }); break; }
      case 'outline': { const [w, col] = (value ?? '').split(','); open(name, { outline: { width: w ? Number(w) : 1, tint: col ? parseColor(col) ?? 0xff000000 : 0xff000000 } }); break; }
      case 'url': case 'link': open(name, { link: value ?? '' }); break;
      case 'font': open(name, { font: value ?? null }); break;
      case 'wave': open(name, { effect: { type: 'wave', amp: opts.amp ? Number(opts.amp) : 3, speed: opts.speed ? Number(opts.speed) : 6, spread: opts.spread ? Number(opts.spread) : 0.6 } }); break;
      case 'shake': open(name, { effect: { type: 'shake', amp: opts.amp ? Number(opts.amp) : 1.5 } }); break;
      case 'rainbow': open(name, { effect: { type: 'rainbow', speed: opts.speed ? Number(opts.speed) : 0.5 } }); break;
      case 'fade': open(name, { effect: { type: 'fade', delay: opts.delay ? Number(opts.delay) : 0.03, duration: opts.duration ? Number(opts.duration) : 0.3 } }); break;
      case 'center': case 'left': case 'right': open(name, { align: name }); break;
      case 'img': {
        flush();
        const image = { name: value ?? '', w: opts.w ? Number(opts.w) : undefined, h: opts.h ? Number(opts.h) : undefined, valign: opts.valign ?? 'baseline', dy: opts.dy ? Number(opts.dy) : 0 };
        spans.push({ text: '￼', style: cur, image });
        break;
      }
      default: break;
    }
  }
  flush();
  return spans;
}

/** The text with the markup taken out. @param {string} source */
export function stripMarkup(source) { return parseMarkup(source).map((s) => (s.image ? '' : s.text)).join(''); }

/** Fonts that make their bold and italic forms on demand, all sharing one atlas. */
export class FontFamily {
  /** @param {import('./atlas.js').Atlas} atlas @param {ConstructorParameters<typeof Font>[1]} [options] What every variant is made with (`family`, `size`, `sdf`, `scale`...). */
  constructor(atlas, options = {}) { this.atlas = atlas; this.options = options; this.variants = new Map(); }
  /** The font for a weight and slant (made the first time it is asked for). @param {{bold?: boolean, italic?: boolean}} [v] @returns {Font} */
  get({ bold = false, italic = false } = {}) {
    const key = `${bold ? 'b' : ''}${italic ? 'i' : ''}`;
    let f = this.variants.get(key);
    if (!f) { f = new Font(this.atlas, { ...this.options, weight: bold ? 'bold' : (this.options.weight ?? 'normal'), style: italic ? 'italic' : (this.options.style ?? 'normal') }); this.variants.set(key, f); }
    return f;
  }
}

/**
 * Fonts in order of preference: each character is drawn with the first font that has it. A font has a character if the browser really draws it from that font, not from some
 * substitute: this is found out once per character by measuring it against two different fallback fonts (if both give the same width, the font has it). Or say so yourself with
 * `ranges` (`[{ font, ranges: [[0x600, 0x6ff]] }]`) and nothing is measured. The last font takes whatever is left, so something always draws.
 */
export class FontStack extends LayoutTypeface {
  /** @param {(Font | {font: Font, ranges?: [number, number][], detect?: boolean})[]} fonts */
  constructor(fonts) {
    super();
    if (!fonts.length) throw new Error('a FontStack needs at least one font');
    this.entries = fonts.map((f) => (f instanceof LayoutTypeface || typeof f.glyph === 'function' ? { font: f, ranges: null, detect: true } : { font: f.font, ranges: f.ranges ?? null, detect: f.detect ?? !f.ranges }));
    this.primary = this.entries[0].font;
    this.covers = new Map();
    for (const k of ['ascent', 'descent', 'size', 'worldPerPx', 'pad', 'scale', 'sdf']) Object.defineProperty(this, k, { get: () => this.primary[k] });
  }
  #has(entry, cp) {
    const { font } = entry;
    if (entry.ranges && !entry.ranges.some(([a, b]) => cp >= a && cp <= b)) return false;
    if (!entry.detect) return true;
    if (typeof font.has === 'function') return font.has(cp);                         // a bitmap font knows
    if (cp < 0x20 || cp === 0x20 || cp === 0xa0) return true;
    const key = `${font.id}|${cp}`;
    let v = this.covers.get(key);
    if (v === undefined) {
      const ctx = font.atlas?.ctx, ch = String.fromCodePoint(cp);
      if (!ctx || !font.family) v = true;
      else {
        ctx.save();
        const px = font.rasterPx ?? 16, style = font.css.split(`${px}px`)[0];
        const w = (tail) => { ctx.font = `${style}${px}px ${font.family}, ${tail}`; return ctx.measureText(ch).width; };
        const a = w('monospace'), b = w('serif'), c = w('sans-serif');
        const bare = (tail) => { ctx.font = `${style}${px}px ${tail}`; return ctx.measureText(ch).width; };
        const same = a === b && b === c && !(a === bare('monospace') && b === bare('serif') && c === bare('sans-serif'));
        ctx.restore();
        v = same;                              // the same width whatever the substitute, and not just what the substitute alone gives: it comes from this font
      }
      this.covers.set(key, v);
    }
    return v;
  }
  /** The font that draws this character. @param {number} cp */
  fontFor(cp) {
    for (let i = 0; i < this.entries.length - 1; i++) if (this.#has(this.entries[i], cp)) return this.entries[i].font;
    return this.entries[this.entries.length - 1].font;
  }
  glyph(cp) { return this.fontFor(cp).glyph(cp); }
  /** Reset every font in the stack (see `Atlas.clear`). */
  reset() { this.covers.clear(); for (const e of this.entries) e.font.reset?.(); }
}

/**
 * Rich text over a set of fonts. Give it the fonts by name (`regular` is needed; `bold`, `italic`, `boldItalic` are used for the `[b]` and `[i]` tags when present, and a `FontFamily` can make
 * them: pass `family`), more by name for `[font=name]`, and the atlas for `[img=name]` pictures.
 *
 * ```js
 * const rich = new RichText({ family: new FontFamily(atlas, { family: 'system-ui', size: 18 }), atlas, fonts: { mono: new Font(atlas, { family: 'monospace', size: 16 }) } });
 * const layout = rich.layout('[b]Quest:[/b] bring [color=gold]3 coins[/color] [img=coin w=16 h=16 valign=middle]', { maxWidth: 320 });
 * rich.draw(batch, layout, 20, 20);                          // each frame
 * const link = rich.linkAt(layout, mouseX - 20, mouseY - 20);   // 'quest:12' or null
 * ```
 */
export class RichText {
  /**
   * @param {object} o
   * @param {FontFamily} [o.family] Makes the regular, bold and italic fonts. @param {Record<string, any>} [o.fonts] Typefaces by name: `regular`, `bold`, `italic`, `boldItalic`, and any others for `[font=name]` (a `Font`, `BitmapFont` or `FontStack`).
   * @param {import('./atlas.js').Atlas} [o.atlas] Where `[img=name]` finds its pictures (and the white sprite for underlines is made). @param {{color?: number, size?: number}} [o.defaults] The base colour (packed tint) and size (world units).
   */
  constructor({ family, fonts = {}, atlas, defaults = {} } = {}) {
    this.family = family ?? null; this.fonts = fonts;
    this.atlas = atlas ?? family?.atlas ?? fonts.regular?.atlas ?? null;
    this.regular = fonts.regular ?? family?.get();
    if (!this.regular) throw new Error('RichText needs a regular font (`fonts.regular`) or a `family`');
    this.defaults = { color: 0xffffffff, size: this.regular.size, ...defaults };
    this.white = null;
    this.cache = new Map();
  }

  #typeface(style) {
    if (style.font && this.fonts[style.font]) return this.fonts[style.font];
    const bold = !!style.bold, italic = !!style.italic;
    if (bold && italic && this.fonts.boldItalic) return this.fonts.boldItalic;
    if (bold && !italic && this.fonts.bold) return this.fonts.bold;
    if (italic && !bold && this.fonts.italic) return this.fonts.italic;
    if ((bold || italic) && this.family) return this.family.get({ bold, italic });
    return this.regular;
  }

  /**
   * Parse markup and lay it out.
   * @param {string} markup @param {{maxWidth?: number, align?: 'left' | 'center' | 'right', direction?: 'auto' | 'ltr' | 'rtl', lineSpacing?: number, paragraphSpacing?: number, markup?: boolean}} [o]
   * `markup: false` takes the text literally (a player's chat line). @returns {RichLayout}
   */
  layout(markup, { maxWidth = Infinity, align, direction = 'auto', lineSpacing = 1, paragraphSpacing = 0, markup: parse = true } = {}) {
    const key = `${maxWidth}|${align}|${direction}|${lineSpacing}|${paragraphSpacing}|${parse}|${markup}`;
    const hit = this.cache.get(key);
    if (hit) return hit;
    const spans = parse ? parseMarkup(markup) : [{ text: String(markup), style: {} }];
    const atoms = [];
    for (const sp of spans) {
      const typeface = this.#typeface(sp.style), size = (sp.style.size ?? this.defaults.size) + (sp.style.sizeDelta ?? 0);
      const style = { typeface, scale: size / typeface.size, tint: sp.style.color ?? this.defaults.color, shadow: sp.style.shadow ?? null, outline: sp.style.outline ?? null, underline: !!sp.style.underline, strike: !!sp.style.strike, link: sp.style.link ?? null, effect: sp.style.effect ?? null, align: sp.style.align };
      if (sp.image) {
        const sprite = this.atlas?.sprites.get(sp.image.name);
        if (sprite) { const h = sp.image.h ?? size, w = sp.image.w ?? (sprite.w / sprite.h) * h; atoms.push({ text: '￼', style, image: { sprite, w, h, valign: sp.image.valign, dy: sp.image.dy } }); continue; }
        atoms.push({ text: '?', style }); continue;
      }
      for (const g of graphemes(sp.text)) atoms.push({ text: g, style });
    }
    // paragraphs at line breaks
    const paragraphs = []; let current = [];
    for (const a of atoms) { if (!a.image && a.text === '\n') { paragraphs.push(current); current = []; } else current.push(a); }
    paragraphs.push(current);
    const out = { paragraphs: [], width: 0, height: 0, atomCount: atoms.length, source: markup };
    let top = 0, offset = 0;
    for (const p of paragraphs) {
      const layout = layoutParagraph(p, { maxWidth, direction, align, lineSpacing });
      const empty = p.length === 0, h = empty ? this.regular.lineHeight * ((this.defaults.size) / this.regular.size) : layout.height;
      out.paragraphs.push({ layout, top, offset }); out.width = Math.max(out.width, layout.width); top += h + paragraphSpacing; offset += p.length + 1;
    }
    out.height = Math.max(0, top - paragraphSpacing);
    if (this.cache.size > 64) this.cache.clear();
    this.cache.set(key, out);
    return out;
  }

  #whiteSprite() {
    if (this.white || !this.atlas) return this.white;
    this.white = this.atlas.sprites.get('richtext|white') ?? this.atlas.add('richtext|white', 4, 4, (ctx, x, y, w, h) => { ctx.fillStyle = '#fff'; ctx.fillRect(x, y, w, h); });
    return this.white;
  }

  /**
   * Draw a layout (or markup, laid out for you) into a batch with its top left at (x, y).
   * @param {import('./batch.js').SpriteBatch} batch @param {RichLayout | string} layout @param {number} x @param {number} y
   * @param {{tint?: number, key?: number, visible?: number, time?: number}} [o] `visible`: how many characters to show (a typewriter reveal: `Math.floor(seconds * 30)`), `time`: seconds, for the `[wave]`, `[shake]`, `[rainbow]` and `[fade]` effects.
   */
  draw(batch, layout, x, y, o = {}) {
    if (typeof layout === 'string') layout = this.layout(layout);
    const white = this.#whiteSprite();
    for (const p of layout.paragraphs) drawParagraph(batch, p.layout, x, y + p.top, { ...o, white, atomOffset: p.offset });
    return layout;
  }

  /** The `link` of the `[url]` under a point (world units from the layout's top left), or null. @param {RichLayout} layout @param {number} px @param {number} py */
  linkAt(layout, px, py) {
    for (const p of layout.paragraphs) for (const b of linkBoxes(p.layout)) if (px >= b.x && px < b.x + b.w && py >= p.top + b.y && py < p.top + b.y + b.h) return b.link;
    return null;
  }

  /** How many characters a typewriter reveal has to show to be complete. @param {RichLayout} layout */
  characters(layout) { return layout.atomCount; }

  /** Forget cached layouts and the underline sprite, after `Atlas.clear()` (reset the fonts yourself). */
  reset() { this.white = null; this.cache.clear(); }

  /** The text of a layout as drawn, line by line (markup removed). @param {RichLayout} layout */
  lines(layout) { return layout.paragraphs.flatMap((p) => (p.layout.lines.length ? p.layout.lines.map((l) => l.text) : [''])); }
}

/**
 * @typedef {object} RichLayout
 * @property {{layout: ReturnType<typeof layoutParagraph>, top: number, offset: number}[]} paragraphs @property {number} width @property {number} height @property {number} atomCount @property {string} source
 */

