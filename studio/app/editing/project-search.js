// Find and replace across every text file of a project. Built on the one-file search (find.js), so a plain search is safe, a bad pattern gives a message, and
// the number of matches is capped. Pure functions on `{path: text}`: no page needed, tested in Node.
import { findAll, replaceAll } from './find.js';

export const MAX_RESULTS = 1000;

/**
 * @typedef {Object} Hit
 * @property {number} index where the match starts in the file
 * @property {number} length
 * @property {number} line 1-based
 * @property {number} column 1-based
 * @property {string} text the line it is on, cut to a readable size
 * @property {number} start where the match starts within `text` (for marking it)
 */

/**
 * Search every file.
 * @param {Record<string, string>} files
 * @param {string} query
 * @param {import('./find.js').FindOptions} [options]
 * @returns {{results: {path: string, hits: Hit[]}[], total: number, capped: boolean, error?: string}}
 */
export function searchProject(files, query, options = {}) {
  const results = [];
  let total = 0;
  let capped = false;
  if (!query) return { results, total, capped };
  for (const path of Object.keys(files).sort()) {
    const text = files[path];
    if (typeof text !== 'string') continue;
    const found = findAll(text, query, options);
    if (found.error !== undefined) return { results: [], total: 0, capped: false, error: found.error };
    if (!found.matches.length) continue;
    const starts = [0];
    for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) starts.push(i + 1);
    const hits = [];
    let line = 0;
    for (const m of found.matches) {
      if (total >= MAX_RESULTS) { capped = true; break; }
      while (line + 1 < starts.length && starts[line + 1] <= m.from) line++;
      const lineText = text.slice(starts[line], line + 1 < starts.length ? starts[line + 1] - 1 : text.length);
      const lead = lineText.length - lineText.trimStart().length;
      const trimmed = lineText.trim();
      const cut = Math.max(0, m.from - starts[line] - lead - 40);                                // keep the match visible on a long line
      const shown = (cut ? '…' : '') + trimmed.slice(cut, cut + 160);
      const start = m.from - starts[line] - lead - cut + (cut ? 1 : 0);
      hits.push({ index: m.from, length: m.to - m.from, line: line + 1, column: m.from - starts[line] + 1, text: shown, start });
      total++;
    }
    results.push({ path, hits });
    if (capped || found.capped) { capped = true; break; }
  }
  return { results, total, capped };
}

/**
 * Replace in every file (or only the listed ones). Nothing is written: the new texts come back.
 * @returns {{changes: Record<string, string>, count: number, error?: string}}
 */
export function replaceProject(files, query, replacement, options = {}, only = null) {
  const changes = {};
  let count = 0;
  for (const path of Object.keys(files)) {
    const text = files[path];
    if (typeof text !== 'string' || (only && !only.includes(path))) continue;
    const found = findAll(text, query, options);
    if (found.error !== undefined) return { changes: {}, count: 0, error: found.error };
    if (!found.matches.length) continue;
    const out = replaceAll(text, query, replacement, options);
    if (out.text !== text) { changes[path] = out.text; count += out.count; }
  }
  return { changes, count };
}
