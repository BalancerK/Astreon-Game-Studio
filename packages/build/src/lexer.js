// Just enough JavaScript lexing to tell code from comments, strings, template text and regular expressions. The bundler uses it to find
// real import / export statements, the minifier to drop comments without touching what is inside a string.

const REGEX_AFTER_WORD = new Set(['return', 'typeof', 'case', 'in', 'of', 'delete', 'void', 'throw', 'new', 'else', 'do', 'yield', 'await', 'instanceof']);
const isIdent = (c) => (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95 || c === 36 || c > 127;

/**
 * Split source text into the parts that are not code.
 * @param {string} src
 * @returns {Array<{start: number, end: number, type: 'comment' | 'string' | 'template' | 'regex'}>} in order, end exclusive. `${...}` inside a template is code.
 */
export function scan(src) {
  const out = [];
  const n = src.length;
  let i = 0;
  let prev = ''; // the last significant character of code
  let word = ''; // the last identifier/keyword if the last token was one
  const braces = []; // for templates: brace depth at which a `${` was opened
  let depth = 0;
  const regexAllowed = () => prev === '' || (/[(,=:\[!&|?{};+\-*%<>~^]/.test(prev)) || (word !== '' && REGEX_AFTER_WORD.has(word));

  const template = (from) => { // src[from] is the character after the opening backtick or after a closing `}` of a `${`
    let j = from;
    while (j < n) {
      const c = src[j];
      if (c === '\\') { j += 2; continue; }
      if (c === '`') { out.push({ start: from - 1, end: j + 1, type: 'template' }); return j + 1; }
      if (c === '$' && src[j + 1] === '{') { out.push({ start: from - 1, end: j + 2, type: 'template' }); braces.push(depth); depth++; return j + 2; }
      j++;
    }
    throw new SyntaxError('unterminated template literal');
  };

  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '/') { let j = i + 2; while (j < n && src[j] !== '\n') j++; out.push({ start: i, end: j, type: 'comment' }); i = j; continue; }
    if (c === '/' && d === '*') { const j = src.indexOf('*/', i + 2); if (j < 0) throw new SyntaxError('unterminated comment'); out.push({ start: i, end: j + 2, type: 'comment' }); i = j + 2; continue; }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && src[j] !== c) { if (src[j] === '\\') j++; else if (src[j] === '\n') throw new SyntaxError(`unterminated string at offset ${i}`); j++; }
      out.push({ start: i, end: j + 1, type: 'string' }); i = j + 1; prev = '"'; word = ''; continue;
    }
    if (c === '`') { i = template(i + 1); prev = '`'; word = ''; continue; }
    if (c === '/' && regexAllowed()) {
      let j = i + 1, inClass = false;
      while (j < n) {
        const e = src[j];
        if (e === '\\') { j += 2; continue; }
        if (e === '\n') throw new SyntaxError(`unterminated regular expression at offset ${i}`);
        if (e === '[') inClass = true; else if (e === ']') inClass = false; else if (e === '/' && !inClass) break;
        j++;
      }
      j++; while (j < n && isIdent(src.charCodeAt(j))) j++; // flags
      out.push({ start: i, end: j, type: 'regex' }); i = j; prev = '/'; word = ''; continue;
    }
    if (c === '{') { depth++; prev = c; word = ''; i++; continue; }
    if (c === '}') {
      depth--;
      if (braces.length && braces[braces.length - 1] === depth) { braces.pop(); i = template(i + 1); prev = '`'; word = ''; continue; } // back into the template text
      prev = c; word = ''; i++; continue;
    }
    const code = src.charCodeAt(i);
    if (isIdent(code)) { let j = i; while (j < n && isIdent(src.charCodeAt(j))) j++; word = prev === '.' ? '' : src.slice(i, j); prev = 'a'; i = j; continue; }          // (a name after a dot is a property, even `e.in` or `x.of`: a slash after it divides)
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue; }
    prev = c; word = ''; i++;
  }
  return out;
}

/** A function that says whether an offset is code (not inside a comment, string, regular expression or the text of a template). */
export function codeTest(segments) {
  return (pos) => {
    let lo = 0, hi = segments.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1, s = segments[mid];
      if (pos < s.start) hi = mid - 1; else if (pos >= s.end) lo = mid + 1; else return false;
    }
    return true;
  };
}
