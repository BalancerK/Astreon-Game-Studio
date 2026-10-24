/**
 * The text layout engine behind `Font`, `FontStack`, `BitmapFont` and `RichText`: styled text in, positioned glyph sprites out. It does what a per-glyph renderer cannot do alone:
 *
 * - **Clusters**: a letter with its accents, an emoji with its skin tone or a joined family, a Hangul syllable are one unit (`Intl.Segmenter` where the platform has it).
 * - **Shaping**: words of scripts whose letters change shape with their neighbours (Arabic joins, Hebrew carries points, Indic and Southeast Asian scripts reorder and stack) are drawn *as words*
 *   by the browser's own text engine (`typeface.run`), which shapes them correctly with the real font; everything else is drawn glyph by glyph.
 * - **Direction**: the paragraph is resolved by the bidirectional algorithm (`bidi.js`) once, then each wrapped line is reordered for drawing.
 * - **Wrapping**: at spaces, and between East Asian characters (with the usual rule that some punctuation may not start or end a line).
 * - **Mixed styles**: every character carries a style (typeface, size, colour, shadow, outline, underline, link, effect); lines are as tall as their tallest item and items sit on a common baseline.
 * - **Inline pictures**: a sprite in the line, sized in world units, sitting on the baseline or centred on the text.
 *
 * A *typeface* is anything with `glyph(cp)` (`{sprite, advance, ox, oy}` in raster pixels), optionally `run(text, rtl)` (a shaped word, same shape), `kern(a, b)`, and the metrics
 * `ascent`, `descent`, `size`, `worldPerPx`, `pad`, `scale`, `sdf`. A `FontStack` additionally has `fontFor(cp)` to pick a typeface per character.
 */
import { resolveBidi, reorder, mirrored, bidiClass } from './bidi.js';

const SEGMENTER = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;

/** Split text into user-perceived characters (a base letter with its accents, an emoji sequence, a Hangul syllable...). @param {string} text @returns {string[]} */
export function graphemes(text) {
  if (SEGMENTER) { const out = []; for (const s of SEGMENTER.segment(text)) out.push(s.segment); return out; }
  const out = [];
  for (const ch of text) { if (out.length && /^[\p{M}‍️]$/u.test(ch)) out[out.length - 1] += ch; else if (out.length && out[out.length - 1].endsWith('‍')) out[out.length - 1] += ch; else out.push(ch); }
  return out;
}

// Scripts whose letters change shape or position with their neighbours: drawn as whole words by the browser's text engine.
const SHAPED = /[֐-ࣿऀ-෿฀-໿ༀ-࿿က-႟ក-៿᠀-᢯ᄀ-ᇿꥠ-꥿ힰ-퟿יִ-﷿ﹰ-﻿]/u;
/** Does this character belong to a script that must be shaped as a word? @param {number} cp */
export const isShaped = (cp) => cp >= 0x590 && SHAPED.test(String.fromCodePoint(cp));
/** Does a string need the engine (right-to-left, shaping, or clusters of more than one character)? Plain Latin text does not. @param {string} text */
export function needsEngine(text) { return /[^\u0000-˿ -⯿　-鿿＀-￯]|[̀-ͯ]/u.test(text) || /[‍️]/.test(text); }

const CJK = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}　-〿＀-￯]$/u;
const NO_START = new Set([...'、。，．：；！？）］｝」』】〉》ーぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮ々〜…‥,.!?:;)]}']);
const NO_END = new Set([...'（［｛「『【〈《([{']);

const mulChannel = (a, b) => Math.round((a * b) / 255);
/** Multiply two packed tints channel by channel (a colour in markup times the tint you draw with). */
export function mulTint(a, b) {
  return ((mulChannel(a >>> 24, b >>> 24) << 24) | (mulChannel((a >>> 16) & 255, (b >>> 16) & 255) << 16) | (mulChannel((a >>> 8) & 255, (b >>> 8) & 255) << 8) | mulChannel(a & 255, b & 255)) >>> 0;
}

/**
 * @typedef {object} Atom One character of styled text.
 * @property {string} text The character (a whole cluster).
 * @property {{typeface: any, scale?: number, tint?: number, shadow?: {dx?: number, dy?: number, tint?: number} | null, outline?: {width: number, tint?: number} | null, underline?: boolean, strike?: boolean, link?: string | null, effect?: {type: string} | null, align?: string}} style Atoms of one styled stretch share one style object (shadow and outline sizes are in world units).
 * @property {{sprite: any, w: number, h: number, valign?: 'baseline' | 'middle' | 'top', dy?: number}} [image] An inline picture (the `text` is then a placeholder).
 */

/**
 * @typedef {object} LayoutItem One positioned thing: a glyph (or shaped word) or a picture.
 * @property {number} x Left edge of the advance, world units from the layout's left edge. @property {number} y Baseline, world units from the top of the layout.
 * @property {any} glyph `{sprite, advance, ox, oy}` @property {any} style @property {number} u World units per raster pixel for this item. @property {number} atom Index of its first atom in the paragraph (for typewriter reveals and effects). @property {number} count Atoms it covers.
 * @property {number} width World units. @property {boolean} space @property {number} line @property {any} [image]
 */

/**
 * Lay out a list of atoms (one paragraph: no line breaks).
 * @param {Atom[]} atoms @param {{maxWidth?: number, direction?: 'auto' | 'ltr' | 'rtl', align?: 'left' | 'center' | 'right', lineSpacing?: number, indent?: number}} [o]
 * @returns {{items: LayoutItem[], lines: {start: number, end: number, width: number, height: number, ascent: number, y: number, x: number}[], width: number, height: number, paragraphRtl: boolean}}
 */
export function layoutParagraph(atoms, { maxWidth = Infinity, direction = 'auto', align, lineSpacing = 1, indent = 0 } = {}) {
  if (atoms.length === 0) return { items: [], lines: [], width: 0, height: 0, paragraphRtl: direction === 'rtl' };
  // bidirectional levels, on the first character of each atom
  const kept = atoms.map((a, i) => i).filter((i) => !['LRE', 'RLE', 'LRO', 'RLO', 'PDF', 'BN'].includes(bidiClass(atoms[i].text.codePointAt(0))) || atoms[i].image);
  const firstCps = kept.map((i) => (atoms[i].image ? 0xfffc : atoms[i].text.codePointAt(0)));
  const bidi = resolveBidi(String.fromCodePoint(...firstCps), direction);
  const levelOf = new Map(kept.map((i, k) => [i, bidi.levels[k]]));
  const paragraphLevel = bidi.paragraphLevel;
  const live = kept.map((i) => atoms[i]);
  const lv = Array.from(bidi.levels);

  // units, in logical order
  /** @type {any[]} */ const units = [];
  const typefaceFor = (a, cp) => { const t = a.style.typeface; return t.fontFor ? t.fontFor(cp) : t; };
  for (let k = 0; k < live.length;) {
    const a = live[k], level = lv[k], rtl = level % 2 === 1, style = a.style;
    if (a.image) { units.push({ image: a.image, style, atom: k, count: 1, level, rtl, space: false, breakAfter: true, breakBefore: true }); k++; continue; }
    let cp = a.text.codePointAt(0);
    const type = bidi.types[k], t = typefaceFor(a, cp), scale = style.scale ?? 1;
    if (type === 'WS' || type === 'S') {
      const g = t.glyph(cp);
      units.push({ glyph: g, typeface: t, style, scale, atom: k, count: 1, level, rtl, space: true, breakAfter: true, text: a.text });
      k++; continue;
    }
    let text = a.text, count = 1;
    if (t.run && (isShaped(cp) || a.text.length > String.fromCodePoint(cp).length)) {          // gather the rest of a shaped word: same style, same level, same typeface
      let j = k + 1;
      while (isShaped(cp) && j < live.length && !live[j].image && live[j].style === style && lv[j] === level && bidi.types[j] !== 'WS' && bidi.types[j] !== 'S' && (isShaped(live[j].text.codePointAt(0)) || /^\p{M}/u.test(live[j].text)) && typefaceFor(live[j], live[j].text.codePointAt(0)) === t) { text += live[j].text; count++; j++; }
      units.push({ glyph: t.run(text, rtl), typeface: t, style, scale, atom: k, count, level, rtl, space: false, text, breakAfter: false });
      k += count; continue;
    }
    if (rtl && !t.run) { const m = mirrored(cp); if (m !== cp) { text = String.fromCodePoint(m); cp = m; } }
    else if (rtl) { const m = mirrored(cp); if (m !== cp && text.length === String.fromCodePoint(cp).length) { text = String.fromCodePoint(m); cp = m; } }
    units.push({ glyph: t.glyph(cp), typeface: t, style, scale, atom: k, count: 1, level, rtl, space: false, text, cp, breakAfter: false });
    k++;
  }
  // line breaking opportunities between units
  for (let i = 0; i < units.length - 1; i++) {
    const a = units[i], b = units[i + 1];
    if (a.space) a.breakAfter = true;
    else if (a.image || b.image) a.breakAfter = true;
    else if (a.text && b.text && CJK.test(a.text[0]) && CJK.test(b.text[0]) && !NO_START.has(b.text[0]) && !NO_END.has(a.text[a.text.length - 1])) a.breakAfter = true;
  }
  // widths in world units (with kerning between neighbouring glyphs of one typeface)
  for (let i = 0; i < units.length; i++) {
    const u = units[i];
    if (u.image) { u.width = u.image.w; u.wpp = 1; continue; }
    const t = u.typeface; u.wpp = (u.scale ?? 1) * t.worldPerPx;
    let adv = u.glyph.advance;
    const next = units[i + 1];
    if (t.kern && next && !next.image && next.typeface === t && u.cp !== undefined && next.cp !== undefined) adv += t.kern(u.cp, next.cp);
    u.width = adv * u.wpp;
  }

  // wrapping (logical): greedy, at the last opportunity
  const lineStart = [];
  for (let start = 0; start < units.length;) {
    let w = lineStart.length === 0 ? indent : 0, lastBreak = -1, i = start;
    for (; i < units.length; i++) {
      const u = units[i];
      if (!u.space && w + u.width > maxWidth + 1e-6 && i > start) break;
      w += u.width;
      if (u.breakAfter) lastBreak = i;
    }
    if (i >= units.length) { lineStart.push([start, units.length]); break; }
    const cut = lastBreak >= start ? lastBreak + 1 : i;               // at the last place a line may break, or before the unit that does not fit
    lineStart.push([start, cut]); start = cut;
  }

  // per line: trailing spaces to the paragraph level (L1), reorder, measure, place
  const items = [], lines = [];
  let y = 0, maxW = 0;
  lineStart.forEach(([s, e], li) => {
    const line = units.slice(s, e);
    let end = line.length; while (end > 0 && line[end - 1].space) end--;
    const levels = line.map((u, k) => (k >= end ? paragraphLevel : u.level));
    const order = reorder(levels);
    let ascent = 0, descent = 0, width = 0;
    for (let k = 0; k < end; k++) {
      const u = line[k];
      if (u.image) { const dy = u.image.dy ?? 0, h = u.image.h, va = u.image.valign ?? 'baseline'; const up = va === 'middle' ? h * 0.6 : va === 'top' ? h : h; ascent = Math.max(ascent, up + dy); descent = Math.max(descent, va === 'middle' ? h * 0.4 - dy : 0); }
      else { ascent = Math.max(ascent, u.typeface.ascent * u.wpp); descent = Math.max(descent, u.typeface.descent * u.wpp); }
      width += u.width;
    }
    for (let k = end; k < line.length; k++) { const u = line[k]; if (!u.image) { ascent = Math.max(ascent, u.typeface.ascent * u.wpp); descent = Math.max(descent, u.typeface.descent * u.wpp); } }
    const height = (ascent + descent) * lineSpacing;
    const lineAlign = align ?? line[0]?.style.align ?? (paragraphLevel ? 'right' : 'left');
    const free = Number.isFinite(maxWidth) ? maxWidth - width - (li === 0 ? indent : 0) : 0;
    let x = (li === 0 ? indent : 0) + (lineAlign === 'center' ? free / 2 : lineAlign === 'right' ? free : 0);
    const startX = x, baseline = y + (height - (ascent + descent)) / 2 + ascent;
    const vOrder = order.filter((k) => k < end);
    for (const k of vOrder) {
      const u = line[k];
      items.push({ x, y: baseline, glyph: u.glyph, style: u.style, u: u.wpp, atom: u.atom, count: u.count, width: u.width, space: u.space, line: li, image: u.image, typeface: u.typeface, rtl: u.rtl });
      x += u.width;
    }
    // trailing spaces are placed after the text (before it, in a right-to-left paragraph) but take no part in alignment
    lines.push({ start: s, end: e, width, height, ascent, y, x: startX, text: line.map((u) => u.text ?? '').join('').trimEnd() });
    maxW = Math.max(maxW, width + (li === 0 ? indent : 0));
    y += height;
  });
  return { items, lines, width: Number.isFinite(maxWidth) ? Math.max(maxW, 0) : maxW, height: y, paragraphRtl: paragraphLevel === 1 };
}

/**
 * Put a laid-out paragraph into a sprite batch.
 * @param {import('./batch.js').SpriteBatch} batch @param {ReturnType<typeof layoutParagraph>} layout @param {number} x @param {number} y Top-left of the layout.
 * @param {{tint?: number, key?: number, visible?: number, time?: number, white?: any, snap?: boolean, atomOffset?: number}} [o] `visible`: only this many atoms are drawn (a typewriter reveal), `time`: seconds, for animated effects, `white`: an all-white sprite for underlines.
 */
export function drawParagraph(batch, layout, x, y, { tint = 0xffffffff, key = 0, visible = Infinity, time = 0, white = null, atomOffset = 0 } = {}) {
  const passes = [];
  const lineBoxes = new Map();
  for (const it of layout.items) {
    if (it.atom + atomOffset >= visible) continue;
    const st = it.style;
    let dx = 0, dy = 0, color = st.tint ?? 0xffffffff, alpha = 1;
    const fx = st.effect;
    if (fx) {
      const i = it.atom;
      if (fx.type === 'wave') dy = Math.sin(time * (fx.speed ?? 6) + i * (fx.spread ?? 0.6)) * (fx.amp ?? 3);
      else if (fx.type === 'shake') { const s = Math.sin(time * 40 + i * 12.9898) * 43758.5453, r = s - Math.floor(s), s2 = Math.sin(time * 37 + i * 78.233) * 24634.6345, r2 = s2 - Math.floor(s2); dx = (r - 0.5) * 2 * (fx.amp ?? 1.5); dy = (r2 - 0.5) * 2 * (fx.amp ?? 1.5); }
      else if (fx.type === 'rainbow') { const h = ((time * (fx.speed ?? 0.5) + i * 0.08) % 1 + 1) % 1; color = mulTint(color, hsv(h)); }
      else if (fx.type === 'fade') { const born = (it.atom + atomOffset) * (fx.delay ?? 0.03); alpha = Math.min(1, Math.max(0, (time - born) / (fx.duration ?? 0.3))); if (alpha <= 0) continue; }
    }
    const t = mulTint(tint, color), tt = alpha < 1 ? mulTint(t, (Math.round(alpha * 255) << 24) | 0x00ffffff) : t;
    if (it.image) {
      const im = it.image, va = im.valign ?? 'baseline', top = va === 'middle' ? it.y - im.h * 0.6 : va === 'top' ? it.y - im.h : it.y - im.h;
      passes.push({ s: im.sprite, left: x + it.x + dx, top: y + top - (im.dy ?? 0) + dy, w: im.w, h: im.h, tint: tt, main: true });      // in the same pass as the glyphs, so reading order is drawing order
      continue;
    }
    const g = it.glyph, T = it.typeface;
    if (g.sprite) {
      const u = it.u, s = g.sprite, lineTop = it.y - T.ascent * u;
      const snap = !T.sdf && T.scale ? (v) => Math.round(v * T.scale) / T.scale : (v) => v;
      const left = snap(x + it.x + dx + (g.ox ?? -T.pad) * u), top = snap(y + lineTop + dy + (g.oy ?? -T.pad) * u);
      if (st.shadow) passes.push({ s, u, left: left + (st.shadow.dx ?? 1), top: top + (st.shadow.dy ?? 1), tint: mulTint(st.shadow.tint ?? 0x80000000, alpha < 1 ? (Math.round(alpha * 255) << 24) | 0x00ffffff : 0xffffffff), w: s.w * u, h: s.h * u });
      if (st.outline) for (let a = 0; a < 8; a++) { const ox = Math.cos((a * Math.PI) / 4) * st.outline.width, oy = Math.sin((a * Math.PI) / 4) * st.outline.width; passes.push({ s, u, left: left + ox, top: top + oy, tint: mulTint(st.outline.tint ?? 0xff000000, alpha < 1 ? (Math.round(alpha * 255) << 24) | 0x00ffffff : 0xffffffff), w: s.w * u, h: s.h * u }); }
      passes.push({ s, u, left, top, tint: tt, w: s.w * u, h: s.h * u, main: true });
    }
    if ((st.underline || st.strike) && white) { const th = Math.max(1, it.u * 2), yy = st.underline ? it.y + T.descent * it.u * 0.35 : it.y - T.ascent * it.u * 0.32; lineBoxes.set(it, { x: x + it.x + dx, y: y + yy + dy, w: it.width, h: th, tint: tt }); }
  }
  // shadows and outlines first (under), then the glyphs
  for (const p of passes) if (!p.main) batch.push(p.left + p.w / 2, p.top + p.h / 2, p.w, p.h, 0, p.s, p.tint, key);
  for (const p of passes) if (p.main) batch.push(p.left + p.w / 2, p.top + p.h / 2, p.w, p.h, 0, p.s, p.tint, key);
  if (white) for (const b of lineBoxes.values()) batch.push(b.x + b.w / 2, b.y + b.h / 2, b.w, b.h, 0, white, b.tint, key);
}

function hsv(h) {
  const i = Math.floor(h * 6), f = h * 6 - i, q = 1 - f, c = [[1, f, 0], [q, 1, 0], [0, 1, f], [0, q, 1], [f, 0, 1], [1, 0, q]][i % 6];
  return ((255 << 24) | (Math.round(c[2] * 255) << 16) | (Math.round(c[1] * 255) << 8) | Math.round(c[0] * 255)) >>> 0;
}

/**
 * The boxes of the parts of a layout with a `link` style: `[{ link, x, y, w, h }]`, one per line a link covers (world units from the layout's top left), for hit testing.
 * @param {ReturnType<typeof layoutParagraph>} layout
 */
export function linkBoxes(layout) {
  const out = [];
  for (const it of layout.items) {
    const link = it.style.link;
    if (!link) continue;
    const line = layout.lines[it.line], last = out[out.length - 1];
    if (last && last.link === link && last.line === it.line && Math.abs(last.x + last.w - it.x) < 1e-6) last.w += it.width;
    else out.push({ link, line: it.line, x: it.x, y: line.y, w: it.width, h: line.height });
  }
  return out.map(({ link, x, y, w, h }) => ({ link, x, y, w, h }));
}

/**
 * The text API (`width`, `wrap`, `measure`, `draw`) for any typeface that gives `glyph(cp)` and the metrics, built on the layout engine: extend it, or use `BitmapFont` and `FontStack`,
 * which do. The same calls as `Font`'s: `size` is the font size in world units (or `unit`, a multiplier), `maxWidth` wraps, `align` is the anchor (`'left'`, `'center'`, `'right'`).
 */
export class LayoutTypeface {
  /** Height of one line in world units at the nominal size. */
  get lineHeight() { return (this.ascent + this.descent) * this.worldPerPx; }

  #unitOf(o) { return o.size !== undefined ? o.size / this.size : (o.unit ?? 1); }

  #lay(text, { unit = 1, maxWidth = Infinity, direction = 'auto' } = {}) {
    const style = { typeface: this, scale: unit };
    const paragraphs = []; let width = 0, height = 0;
    for (const para of text.replace(/\t/g, '    ').split('\n')) {
      const atoms = graphemes(para).map((ch) => ({ text: ch, style }));
      const layout = layoutParagraph(atoms, { maxWidth, direction, align: 'left' });
      paragraphs.push({ layout, top: height }); width = Math.max(width, layout.width);
      height += atoms.length === 0 ? this.lineHeight * unit : layout.height;
    }
    return { paragraphs, width, height };
  }

  /** Advance width of a string in world units, ignoring line breaks. */
  width(text, unit = 1) { return this.#lay(text, { unit }).width; }
  /** Break text into lines no wider than `maxWidth` (world units). @returns {string[]} */
  wrap(text, maxWidth = Infinity, unit = 1) { const out = []; for (const p of this.#lay(text, { unit, maxWidth }).paragraphs) { if (p.layout.lines.length === 0) out.push(''); for (const l of p.layout.lines) out.push(l.text); } return out; }
  /** Size of the text box. @returns {{width: number, height: number, lines: string[]}} */
  measure(text, o = {}) { const unit = this.#unitOf(o), r = this.#lay(text, { unit, maxWidth: o.maxWidth ?? Infinity }); const lines = []; for (const p of r.paragraphs) { if (!p.layout.lines.length) lines.push(''); for (const l of p.layout.lines) lines.push(l.text); } return { width: r.width, height: r.height, lines }; }
  /**
   * Append the text to a batch. `x` is the left edge (or centre / right edge, per `align`) and `y` the top of the first line.
   * @param {import('./batch.js').SpriteBatch} batch @param {string} text @param {number} x @param {number} y
   * @param {{tint?: number, align?: 'left' | 'center' | 'right', maxWidth?: number, unit?: number, size?: number, key?: number, direction?: 'auto' | 'ltr' | 'rtl', shadow?: {dx?: number, dy?: number, tint?: number}}} [o]
   */
  draw(batch, text, x, y, o = {}) {
    const { tint = 0xffffffff, align = 'left', maxWidth = Infinity, key = 0, shadow, direction = 'auto' } = o, unit = this.#unitOf(o);
    const { paragraphs, width, height } = this.#lay(text, { unit, maxWidth, direction });
    const lines = [];
    for (const { layout, top } of paragraphs) {
      for (const it of layout.items) { const line = layout.lines[it.line]; it.x += align === 'center' ? -line.width / 2 - line.x : align === 'right' ? -line.width - line.x : -line.x; it.y += top; if (shadow) it.style = { ...it.style, shadow: { dx: shadow.dx ?? 1, dy: shadow.dy ?? 1, tint: shadow.tint ?? 0x80000000 } }; }
      for (const l of layout.lines) lines.push(l.text);
      drawParagraph(batch, layout, x, y, { tint, key });
    }
    return { width, height, lines };
  }
}
