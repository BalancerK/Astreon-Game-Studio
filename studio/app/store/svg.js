// SVG pictures. A game's pictures are drawn in a worker, which cannot draw SVG, so the studio keeps an SVG as two files: the drawing itself in `art/` (text, still
// editable) and a PNG made from it in `assets/` at the size you choose (what the game uses). This file is the checking and the sizing; the drawing of the PNG
// happens in the page (core/import-svg.js). An SVG is a program of sorts (it can hold scripts and ask for other files), so one that tries is refused outright
// even though a browser would not run it inside a picture. Pure functions, tested in Node.

export const SVG_LIMITS = { bytes: 1_000_000, raster: 1024 };

const HEAD = /^\s*(?:<\?xml[^>]*\?>\s*)?(?:<!--[\s\S]*?-->\s*)*(?:<!DOCTYPE[^>[]*(?:\[[\s\S]*?\])?>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg[\s>]/i;
const UNSAFE = [
  [/<\s*script/i, 'it contains a script'],
  [/<\s*foreignObject/i, 'it contains a foreignObject (a web page inside the picture)'],
  [/<\s*(iframe|embed|object|audio|video)\b/i, 'it embeds another page or media'],
  [/\son[a-z]+\s*=/i, 'it has an event handler (onclick, onload...)'],
  [/javascript\s*:/i, 'it has a javascript: link'],
  [/(?:xlink:)?href\s*=\s*["']\s*(?!#|data:image\/)[^"']/i, 'it points at another file or address'],
  [/@import|url\(\s*["']?\s*(?!#|data:)/i, 'it loads something from outside'],
  [/<!ENTITY/i, 'it defines entities'],
];

/** What is wrong with an SVG (as text), or null when it is safe and really is one. */
export function svgProblem(text) {
  if (typeof text !== 'string' || !HEAD.test(text.replace(/^﻿/, ''))) return 'it is not an SVG picture (it does not start with <svg>)';
  if (text.length > SVG_LIMITS.bytes) return `it is bigger than ${SVG_LIMITS.bytes / 1e6} MB`;
  for (const [pattern, reason] of UNSAFE) if (pattern.test(text)) return reason;
  return null;
}

const length = (value) => {
  const m = /^\s*([0-9]*\.?[0-9]+)\s*(px)?\s*$/i.exec(value ?? '');
  return m ? Number(m[1]) : null;
};

/** The size an SVG says it is (width and height, else its viewBox), or null when it does not say. */
export function svgSize(text) {
  const tag = /<svg\b[^>]*>/i.exec(text)?.[0] ?? '';
  const attr = (name) => new RegExp(`\\s${name}\\s*=\\s*["']([^"']*)["']`, 'i').exec(tag)?.[1];
  const w = length(attr('width'));
  const h = length(attr('height'));
  const box = attr('viewBox')?.trim().split(/[\s,]+/).map(Number);
  const vb = box && box.length === 4 && box.every(Number.isFinite) && box[2] > 0 && box[3] > 0 ? { w: box[2], h: box[3] } : null;
  if (w && h) return { w, h };
  if (vb && w) return { w, h: (w * vb.h) / vb.w };
  if (vb && h) return { w: (h * vb.w) / vb.h, h };
  return vb;
}

/** The size of the PNG to make: the SVG's own size times `scale`, or a chosen `width`, never above 1024 on a side, never below 1. */
export function rasterSize(size, { scale = 1, width = null } = {}) {
  const base = size ?? { w: 64, h: 64 };
  let w = width ? Number(width) : base.w * scale;
  let h = (w * base.h) / base.w;
  const biggest = Math.max(w, h);
  if (biggest > SVG_LIMITS.raster) {
    w = (w * SVG_LIMITS.raster) / biggest;
    h = (h * SVG_LIMITS.raster) / biggest;
  }
  return { w: Math.max(1, Math.round(w)), h: Math.max(1, Math.round(h)) };
}

/** A file name for the pieces made from an SVG: the stem of its name, letters and digits only. */
export function svgStem(name) {
  const stem = String(name).split(/[\\/]/).pop().replace(/\.svg$/i, '').normalize('NFKD').replace(/[^\w -]+/g, '')
    .replace(/\s+/g, ' ').trim().slice(0, 50);
  return stem || 'drawing';
}
