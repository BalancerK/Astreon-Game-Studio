// Making code and data smaller without changing what it does: JavaScript loses its comments and indentation (every line break stays, so
// no statement can run together), JSON loses its spaces, CSS loses comments and whitespace. Names are not shortened.
import { scan } from './lexer.js';

/**
 * Makes JavaScript smaller without changing what it does: removes comments and indentation (keeping every line break, and anything
 * inside strings, templates and regular expressions exactly). Names are not shortened.
 *
 * @param {string} src
 * @param {{keepLicense?: boolean}} [o] Keep comments that begin with `/*!` (default true).
 */
export function minifyJs(src, { keepLicense = true } = {}) {
  const segs = scan(src);
  let out = '';
  let pos = 0;
  let atLineStart = true; // only whitespace so far on this output line
  const pushCode = (text) => {
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (c === '\r') continue;
      if (c === '\n') { if (!atLineStart) { if (out.endsWith(' ')) out = out.slice(0, -1); out += '\n'; atLineStart = true; } continue; }
      if (c === ' ' || c === '\t') { if (!atLineStart && out[out.length - 1] !== ' ') out += ' '; continue; }
      out += c; atLineStart = false;
    }
  };
  const trimEnd = () => { while (out.endsWith(' ')) out = out.slice(0, -1); };
  for (const s of segs) {
    pushCode(src.slice(pos, s.start));
    const text = src.slice(s.start, s.end);
    if (s.type === 'comment') {
      if (keepLicense && text.startsWith('/*!')) { if (!atLineStart) out += '\n'; out += `${text}\n`; atLineStart = true; }
      else if (text.startsWith('/*') && text.includes('\n')) { trimEnd(); if (!atLineStart) { out += '\n'; atLineStart = true; } } // a block comment spanning lines was a line break
      else if (text.startsWith('/*')) { if (!atLineStart && out[out.length - 1] !== ' ') out += ' '; } // a one-line block comment separates tokens
      else trimEnd();
    } else { out += text; atLineStart = false; } // strings, templates and regular expressions are copied exactly
    pos = s.end;
  }
  pushCode(src.slice(pos));
  return out.trim() + '\n';
}

/** JSON without whitespace (throws on invalid JSON with the position). */
export function minifyJson(text) {
  try { return JSON.stringify(JSON.parse(text)); } catch (e) { throw new Error(`invalid JSON: ${e.message}`); }
}

/** CSS without comments and with the whitespace that does not matter removed. */
export function minifyCss(src) {
  let out = '', i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '*') { const j = src.indexOf('*/', i + 2); i = j < 0 ? n : j + 2; continue; }
    if (c === '"' || c === "'") { let j = i + 1; while (j < n && src[j] !== c) { if (src[j] === '\\') j++; j++; } out += src.slice(i, j + 1); i = j + 1; continue; }
    if (/\s/.test(c)) { while (i < n && /\s/.test(src[i])) i++; const last = out[out.length - 1]; if (out && !/[{};:,>]/.test(last ?? '') && !/[{};:,>)]/.test(src[i] ?? '')) out += ' '; continue; }
    if (c === ';') { let k = i + 1; while (k < n && /\s/.test(src[k])) k++; if (src[k] === '}') { i++; continue; } }
    out += c; i++;
  }
  return out.trim();
}
