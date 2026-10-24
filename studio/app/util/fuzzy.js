// Fuzzy matching for the studio's search (Ctrl+K): "pl" finds "Play game", "gsc" finds "Go to scene". The best way to line the letters up is found by
// dynamic programming (the method of the `fzy` finder): letters that start a word or follow the last matched letter score high, gaps cost a little.
// Pure functions, no DOM, so they are tested in Node.

const SCORE_GAP_LEADING = -0.005;
const SCORE_GAP_TRAILING = -0.005;
const SCORE_GAP_INNER = -0.01;
const SCORE_CONSECUTIVE = 1.0;
const BONUS_SLASH = 0.9;
const BONUS_WORD = 0.8;
const BONUS_CAPITAL = 0.7;
const BONUS_DOT = 0.6;
const MAX_LENGTH = 200;                       // longer text is not worth aligning

const isLower = (c) => c >= 'a' && c <= 'z';
const isUpper = (c) => c >= 'A' && c <= 'Z';

/** How much a match at position `i` of `text` is worth because of what comes just before it. */
function bonusAt(text, i) {
  if (i === 0) return BONUS_SLASH;
  const prev = text[i - 1];
  if (prev === '/' || prev === '\\') return BONUS_SLASH;
  if (prev === '-' || prev === '_' || prev === ' ') return BONUS_WORD;
  if (prev === '.') return BONUS_DOT;
  if (isLower(prev) && isUpper(text[i])) return BONUS_CAPITAL;
  return 0;
}

/**
 * Does `query` match `text`, and how well? Every letter of the query must appear in the text, in order (not necessarily together). Case is ignored.
 * @param {string} query
 * @param {string} text
 * @returns {null | {score: number, indices: number[]}} null when it does not match; `indices` are the matched positions (for highlighting)
 */
export function fuzzyMatch(query, text) {
  const n = query.length;
  const m = text.length;
  if (n === 0) return { score: 0, indices: [] };
  if (m > MAX_LENGTH || n > m) return null;
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  // a quick refusal: the letters must appear in order
  let at = 0;
  for (let i = 0; i < n; i++) {
    at = t.indexOf(q[i], at);
    if (at < 0) return null;
    at++;
  }
  if (n === m) return t === q ? { score: n + 1.5, indices: [...Array(n).keys()] } : null;     // a whole-text match is just above any prefix match

  const bonus = Array.from({ length: m }, (_, i) => bonusAt(text, i));
  // D[i][j]: the best score matching q[0..i] with q[i] placed exactly at t[j]; M[i][j]: the best with q[i] placed anywhere up to j
  const D = Array.from({ length: n }, () => new Float64Array(m).fill(-Infinity));
  const M = Array.from({ length: n }, () => new Float64Array(m).fill(-Infinity));
  const viaConsecutive = Array.from({ length: n }, () => new Uint8Array(m));
  for (let i = 0; i < n; i++) {
    let previousInGap = -Infinity;
    const gap = i === n - 1 ? SCORE_GAP_TRAILING : SCORE_GAP_INNER;
    for (let j = 0; j < m; j++) {
      if (q[i] === t[j]) {
        let score = -Infinity;
        if (i === 0) {
          score = j * SCORE_GAP_LEADING + bonus[j];
        } else if (j > 0) {
          const jump = M[i - 1][j - 1] + bonus[j];
          const next = D[i - 1][j - 1] + SCORE_CONSECUTIVE;
          score = Math.max(jump, next);
          if (next > jump) viaConsecutive[i][j] = 1;
        }
        D[i][j] = score;
        previousInGap = Math.max(score, previousInGap + gap);
      } else {
        previousInGap += gap;
      }
      M[i][j] = previousInGap;
    }
  }
  const score = M[n - 1][m - 1];
  if (score === -Infinity) return null;

  // walk back to find which letters were used
  const indices = new Array(n);
  let matchRequired = false;
  for (let i = n - 1, j = m - 1; i >= 0; i--) {
    for (; j >= 0; j--) {
      if (D[i][j] !== -Infinity && (matchRequired || D[i][j] === M[i][j])) {
        matchRequired = i > 0 && viaConsecutive[i][j] === 1;
        indices[i] = j--;
        break;
      }
    }
  }
  return { score, indices };
}

/**
 * Rank items against a query. Better matches come first; equal scores keep the caller's order (or the recent order), so results do not jump around
 * while a person types.
 * @template T
 * @param {T[]} items
 * @param {string} query
 * @param {{text: (item: T) => string | string[], recent?: string[], id?: (item: T) => string, limit?: number}} o
 *   `text` gives one text or several (the first is the title; later ones, such as keywords, count for less); `recent` lists ids, most recent first
 * @returns {{item: T, score: number, indices: number[]}[]} best first; `indices` refer to the title
 */
export function rank(items, query, { text, recent = [], id = (x) => String(x), limit = Infinity } = {}) {
  const recency = new Map(recent.map((r, i) => [r, i]));
  const out = [];
  items.forEach((item, order) => {
    const texts = [].concat(text(item));
    let best = null;
    texts.forEach((t, k) => {
      const m = fuzzyMatch(query, t ?? '');
      if (!m) return;
      const weighted = m.score * (k === 0 ? 1 : 0.6);
      if (!best || weighted > best.score) best = { score: weighted, indices: k === 0 ? m.indices : [] };
    });
    if (best) out.push({ item, score: best.score, indices: best.indices, order, recent: recency.get(id(item)) ?? Infinity });
  });
  out.sort((a, b) => (b.score - a.score) || (a.recent - b.recent) || (a.order - b.order));
  return out.slice(0, limit).map(({ item, score, indices }) => ({ item, score, indices }));
}
