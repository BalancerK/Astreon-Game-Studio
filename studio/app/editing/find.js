// Find and replace, as pure functions on text. A search that is plain text can never be slow or wrong; a pattern (regular expression) can be both, so it
// is checked first (an invalid one gives a message, not an exception) and the number of matches is capped so a pattern like "a*" cannot freeze the page.

export const MAX_MATCHES = 5000;

/**
 * @typedef {Object} FindOptions
 * @property {boolean} [caseSensitive]
 * @property {boolean} [wholeWord]
 * @property {boolean} [regex] treat the query as a regular expression
 */

/** Turn the query into a pattern to run. @returns {{re: RegExp} | {error: string}} */
export function compile(query, { caseSensitive = false, wholeWord = false, regex = false } = {}) {
  if (!query) return { error: '' };
  let source = regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (wholeWord) source = `\\b(?:${source})\\b`;
  try {
    return { re: new RegExp(source, `g${caseSensitive ? '' : 'i'}m`) };
  } catch (error) {
    return { error: String(error.message).replace(/^Invalid regular expression: /, '').replace(/^\/.*\/[a-z]*: /, '') };
  }
}

/**
 * Every match of a query in a text.
 * @returns {{matches: {from: number, to: number}[], error?: string, capped?: boolean}} `capped`: there are more than MAX_MATCHES
 */
export function findAll(text, query, options = {}) {
  const c = compile(query, options);
  if (c.error !== undefined) return { matches: [], error: c.error };
  const matches = [];
  let capped = false;
  for (const m of text.matchAll(c.re)) {
    if (m[0] === '') continue;                                                // an empty match (from a pattern like "a*") is not worth showing
    if (matches.length >= MAX_MATCHES) { capped = true; break; }
    matches.push({ from: m.index, to: m.index + m[0].length });
  }
  return { matches, capped };
}

/** The index of the first match at or after a position, wrapping round to the start; -1 when there are none. */
export function nextIndex(matches, pos, direction = 1) {
  if (!matches.length) return -1;
  if (direction > 0) {
    const i = matches.findIndex((m) => m.from >= pos);
    return i < 0 ? 0 : i;
  }
  for (let i = matches.length - 1; i >= 0; i--) if (matches[i].to <= pos) return i;
  return matches.length - 1;
}

/** The text a replacement makes for one match (`$1` and friends work in a regular expression; plain text is literal). */
export function replacementFor(text, match, query, replacement, options = {}) {
  if (!options.regex) return replacement;
  const c = compile(query, options);
  if (c.error !== undefined) return replacement;
  const again = new RegExp(c.re.source, c.re.flags.replace('g', ''));
  return text.slice(match.from, match.to).replace(again, replacement);
}

/**
 * Replace every match.
 * @returns {{text: string, count: number}}
 */
export function replaceAll(text, query, replacement, options = {}) {
  const { matches } = findAll(text, query, options);
  let out = '';
  let at = 0;
  for (const m of matches) {
    out += text.slice(at, m.from) + replacementFor(text, m, query, replacement, options);
    at = m.to;
  }
  return { text: out + text.slice(at), count: matches.length };
}

/** Which line (0-based) and column each offset is at, for drawing matches on lines. */
export function toLineRanges(text, matches) {
  const starts = [0];
  for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) starts.push(i + 1);
  const out = [];
  for (const m of matches) {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= m.from) lo = mid; else hi = mid - 1;
    }
    for (let line = lo; line < starts.length && starts[line] < m.to; line++) {
      const lineEnd = line + 1 < starts.length ? starts[line + 1] - 1 : text.length;
      out.push({ line, from: Math.max(m.from, starts[line]) - starts[line], to: Math.min(m.to, lineEnd) - starts[line] });
    }
  }
  return out;
}
