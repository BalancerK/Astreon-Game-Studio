// The free pack's pictures are drawn by code, so each one is small, exact and easy to change: a tiny drawing surface (pixels, boxes, discs, lines, an outline) that
// ends as a sprite in the studio's sprite format (rows of letters, a palette of colours, frames and named animations). Every picture here was made for this project
// and is given away under CC0 (see pack.js), so there is nothing to credit and nothing to buy.
import { LETTERS } from '../paint/sprite-model.js';

/** A drawing surface of letters ('.' is see-through) with a palette that fills itself as colours are used. */
export class Art {
  constructor(w = 16, h = 16, palette = {}) {
    this.w = w;
    this.h = h;
    this.colors = new Map(Object.entries(palette).map(([k, v]) => [v.toLowerCase(), k]));
    this.rows = Array.from({ length: h }, () => Array(w).fill('.'));
  }

  /** The letter for a colour (a new one when this colour has not been used yet). */
  c(hex) {
    const key = hex.toLowerCase();
    if (!this.colors.has(key)) {
      const letter = [...LETTERS].find((l) => ![...this.colors.values()].includes(l));
      if (!letter) throw new Error('too many colours for one picture');
      this.colors.set(key, letter);
    }
    return this.colors.get(key);
  }

  /** One pixel (off the edge is ignored). `hex` null clears it. */
  px(x, y, hex) {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return this;
    this.rows[y][x] = hex === null ? '.' : this.c(hex);
    return this;
  }

  get(x, y) { return this.rows[y]?.[x] ?? '.'; }

  rect(x, y, w, h, hex) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.px(x + i, y + j, hex);
    return this;
  }

  /** A filled disc; `rx` and `ry` make it an ellipse. */
  disc(cx, cy, rx, hex, ry = rx) {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1.0001) this.px(x, y, hex);
      }
    }
    return this;
  }

  line(x0, y0, x1, y1, hex) {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let i = 0; i <= n; i++) this.px(x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n, hex);
    return this;
  }

  /** A filled triangle. */
  tri(a, b, c, hex) {
    const minX = Math.floor(Math.min(a[0], b[0], c[0]));
    const maxX = Math.ceil(Math.max(a[0], b[0], c[0]));
    const minY = Math.floor(Math.min(a[1], b[1], c[1]));
    const maxY = Math.ceil(Math.max(a[1], b[1], c[1]));
    const edge = (p, q, x, y) => (q[0] - p[0]) * (y - p[1]) - (q[1] - p[1]) * (x - p[0]);
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const e1 = edge(a, b, x + 0.5, y + 0.5);
        const e2 = edge(b, c, x + 0.5, y + 0.5);
        const e3 = edge(c, a, x + 0.5, y + 0.5);
        if ((e1 >= 0 && e2 >= 0 && e3 >= 0) || (e1 <= 0 && e2 <= 0 && e3 <= 0)) this.px(x, y, hex);
      }
    }
    return this;
  }

  /** Put a one-pixel outline round everything drawn so far (not on the edge of the picture). */
  outline(hex = '#1b1f2e') {
    const keep = this.rows.map((r) => [...r]);
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        if (keep[y][x] !== '.') continue;
        const next = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => (keep[y + dy]?.[x + dx] ?? '.') !== '.');
        if (next) this.rows[y][x] = this.c(hex);
      }
    }
    return this;
  }

  /** Copy of the picture as it is now (a frame). */
  frame() { return this.rows.map((r) => r.join('')); }

  /** The sprite so far, with these frames (or the picture itself) and animations. */
  sprite(frames = [this.frame()], animations = {}) {
    const palette = {};
    for (const [hex, letter] of this.colors) palette[letter] = hex;
    return { w: this.w, h: this.h, palette, frames, animations };
  }
}

/** A small random generator that gives the same numbers for the same seed, so a tile looks the same every time. */
export function seeded(seed) {
  let s = seed >>> 0 || 1;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

/** Several pictures that share one palette, drawn with the same function, one per frame. */
export function frames(w, h, count, draw, palette = {}) {
  const art = new Art(w, h, palette);
  const list = [];
  for (let i = 0; i < count; i++) {
    art.rows = Array.from({ length: h }, () => Array(w).fill('.'));
    draw(art, i);
    list.push(art.frame());
  }
  return art.sprite(list);
}
