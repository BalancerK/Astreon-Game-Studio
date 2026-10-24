// Putting marks on top of coloured code: an error underline, a search match, a bracket that pairs with the one at the caret. A decoration is a range on one
// line with a class; this splits the line's coloured pieces wherever a range starts or ends, and adds the class to the pieces inside it. Pure.

/**
 * @typedef {Object} Decoration
 * @property {number} line 0-based line
 * @property {number} from column where it starts (0-based)
 * @property {number} to column where it ends (exclusive); a range of no length is shown as one character wide
 * @property {string} cls the class to add (for example "err" or "match")
 * @property {string} [title] a message shown on hover
 */

/**
 * Split pieces at the boundaries of ranges and tag them.
 * @param {{text: string, cls: string}[]} tokens one line's pieces
 * @param {{from: number, to: number, cls: string, title?: string}[]} ranges this line's decorations
 * @returns {{text: string, cls: string, marks: {cls: string, title?: string}[]}[]}
 */
export function decorateTokens(tokens, ranges) {
  if (!ranges.length) return tokens.map((t) => ({ ...t, marks: [] }));
  const length = tokens.reduce((n, t) => n + t.text.length, 0);
  const rs = ranges.map((r) => ({ ...r, to: Math.min(Math.max(r.to, r.from + 1), Math.max(length, r.from + 1)) }));
  const cuts = new Set();
  for (const r of rs) { cuts.add(r.from); cuts.add(r.to); }
  const out = [];
  let at = 0;
  for (const t of tokens) {
    const end = at + t.text.length;
    const points = [at, ...[...cuts].filter((c) => c > at && c < end).sort((a, b) => a - b), end];
    for (let k = 0; k + 1 < points.length; k++) {
      const a = points[k];
      const b = points[k + 1];
      if (b <= a) continue;
      const marksHere = rs.filter((r) => r.from <= a && r.to >= b).map((r) => ({ cls: r.cls, title: r.title }));
      out.push({ text: t.text.slice(a - at, b - at), cls: t.cls, marks: marksHere });
    }
    at = end;
  }
  // a mark on empty space past the end of the line (an error at the very end of a line) gets one visible space
  for (const r of rs) if (r.from >= length) out.push({ text: ' ', cls: '', marks: [{ cls: r.cls, title: r.title }] });
  return out;
}

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Decorated pieces as HTML: marks become nested spans with their classes (and a title for hover). */
export function decoratedToHtml(pieces) {
  return pieces.map((p) => {
    let html = esc(p.text);
    if (p.cls) html = `<span class="${p.cls}">${html}</span>`;
    for (const m of p.marks) html = `<span class="${esc(m.cls)}"${m.title ? ` data-tip="${esc(m.title)}"` : ''}>${html}</span>`;
    return html;
  }).join('');
}

/** Group decorations by line, for fast lookup while drawing. @param {Decoration[]} list @returns {Map<number, Decoration[]>} */
export function byLine(list) {
  const map = new Map();
  for (const d of list) {
    if (!map.has(d.line)) map.set(d.line, []);
    map.get(d.line).push(d);
  }
  return map;
}
