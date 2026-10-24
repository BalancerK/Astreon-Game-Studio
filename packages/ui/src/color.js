// Colours are packed 32-bit integers in the same layout as the renderer's `packTint` (r | g << 8 | b << 16 | a << 24), so they can be
// handed straight to a sprite batch. These helpers build and change them.

/** Pack red, green, blue and alpha (0..255 each). */
export const rgba = (r, g, b, a = 255) => (((a & 255) << 24) | ((b & 255) << 16) | ((g & 255) << 8) | (r & 255)) >>> 0;

/** Parse `#rgb`, `#rrggbb` or `#rrggbbaa`. */
export function hex(s) {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(s);
  if (!m) throw new Error(`not a colour: ${s}`);
  let h = m[1];
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  const n = (i) => parseInt(h.slice(i, i + 2), 16);
  return rgba(n(0), n(2), n(4), h.length === 8 ? n(6) : 255);
}

/** [r, g, b, a] of a packed colour. */
export const unpack = (c) => [c & 255, (c >>> 8) & 255, (c >>> 16) & 255, c >>> 24];

/** The same colour with another alpha (0..1 or, when above 1, 0..255). */
export function withAlpha(c, a) {
  const [r, g, b] = unpack(c);
  return rgba(r, g, b, Math.round(a <= 1 ? a * 255 : a));
}

/** Blend two colours: `t` 0 gives `a`, 1 gives `b`. */
export function mix(a, b, t) {
  const p = unpack(a), q = unpack(b);
  return rgba(...p.map((v, i) => Math.round(v + (q[i] - v) * t)));
}

/** The colour with its alpha scaled (fading a whole widget). */
export const fade = (c, k) => (k >= 1 ? c : rgba(...unpack(c).slice(0, 3), Math.round((c >>> 24) * k)));

/** A CSS colour string (for canvas painters and the DOM). */
export function css(c) { const [r, g, b, a] = unpack(c); return `rgba(${r},${g},${b},${(a / 255).toFixed(3)})`; }

/** The relative luminance of a colour, 0 (black) to 1 (white), as the accessibility guidelines (WCAG 2) define it. Alpha is ignored. */
export function luminance(c) {
  const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const [r, g, b] = unpack(c);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/**
 * The contrast ratio between two colours, 1 (none) to 21 (black on white). Text needs 4.5 to read comfortably (3 for large text, and for the edges and focus rings of controls). A colour
 * with some transparency is first laid over `behind` (default: the other colour).
 */
export function contrastRatio(a, b, behind = null) {
  const flat = (c, under) => { const al = (c >>> 24) / 255; return al >= 1 ? c : mix(under, c | 0xff000000, al) | 0; };
  const A = flat(a >>> 0, behind ?? b), B = flat(b >>> 0, behind ?? a);
  const la = luminance(A), lb = luminance(B);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
