// Cutting JavaScript into coloured pieces, one line at a time. A line starts inside nothing (state 0), a block comment (1) or a template string (2), and
// the state it ends in is the next line's start, so only the lines that can be seen need colouring. Pure functions: no page needed, tested in Node.
// It is a highlighter, not a parser: it must never throw and never lose a character, whatever the text is.

export const KEYWORDS = new Set((
  'import export from const let var function return if else for while do switch case break continue new class extends static async await of in '
  + 'typeof instanceof throw try catch finally default this null undefined true false yield void delete get set super'
).split(' '));

export const STATE = { code: 0, comment: 1, template: 2 };

const IDENT_START = /[A-Za-z_$]/;
const IDENT_PART = /[\w$]/;
const NUMBER_PART = /[0-9._a-fA-FxXeE]/;

/**
 * Cut one line into pieces.
 * @param {string} line
 * @param {number} state what the line starts inside (STATE)
 * @returns {{tokens: {text: string, cls: string}[], state: number}} `cls` is '' for plain text, else k (keyword), s (string), n (number), c (comment),
 *   f (a call), t (a Capitalised name, usually a class)
 */
export function tokenizeLine(line, state = STATE.code) {
  const tokens = [];
  const push = (text, cls = '') => {
    if (!text) return;
    const last = tokens[tokens.length - 1];
    if (last && last.cls === cls && cls === '') last.text += text;           // plain text merges, so a line is a few tokens, not one per character
    else tokens.push({ text, cls });
  };
  let i = 0;
  const n = line.length;
  while (i < n) {
    if (state === STATE.comment) {
      const end = line.indexOf('*/', i);
      if (end < 0) { push(line.slice(i), 'c'); return { tokens, state }; }
      push(line.slice(i, end + 2), 'c');
      i = end + 2;
      state = STATE.code;
      continue;
    }
    if (state === STATE.template) {
      let j = i;
      while (j < n && line[j] !== '`') j += line[j] === '\\' ? 2 : 1;
      if (j >= n) { push(line.slice(i), 's'); return { tokens, state }; }
      push(line.slice(i, j + 1), 's');
      i = j + 1;
      state = STATE.code;
      continue;
    }
    const ch = line[i];
    if (ch === '/' && line[i + 1] === '/') { push(line.slice(i), 'c'); return { tokens, state }; }
    if (ch === '/' && line[i + 1] === '*') { state = STATE.comment; push('/*', 'c'); i += 2; continue; }
    if (ch === '`') { state = STATE.template; push('`', 's'); i++; continue; }
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < n && line[j] !== ch) j += line[j] === '\\' ? 2 : 1;
      push(line.slice(i, j + 1), 's');
      i = j + 1;
      continue;
    }
    if (ch >= '0' && ch <= '9') {
      let j = i + 1;
      while (j < n && NUMBER_PART.test(line[j])) j++;
      push(line.slice(i, j), 'n');
      i = j;
      continue;
    }
    if (IDENT_START.test(ch)) {
      let j = i + 1;
      while (j < n && IDENT_PART.test(line[j])) j++;
      const word = line.slice(i, j);
      if (KEYWORDS.has(word)) push(word, 'k');
      else if (/^[A-Z]/.test(word) && /[a-z]/.test(word)) push(word, 't');
      else if (line[j] === '(') push(word, 'f');
      else push(word);
      i = j;
      continue;
    }
    push(ch);
    i++;
  }
  return { tokens, state };
}

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Tokens as HTML (every piece escaped: text can never become markup). */
export function tokensToHtml(tokens) {
  return tokens.map((t) => (t.cls ? `<span class="${t.cls}">${esc(t.text)}</span>` : esc(t.text))).join('');
}

/** One line as coloured HTML, and the state the next line starts in. */
export function highlightLine(line, state = STATE.code) {
  const { tokens, state: next } = tokenizeLine(line, state);
  return { html: tokensToHtml(tokens), state: next };
}

/** The state every line starts in, for a whole text (used to find what a position is inside). */
export function lineStates(lines) {
  const states = [STATE.code];
  for (let i = 0; i < lines.length; i++) states.push(tokenizeLine(lines[i], states[i]).state);
  return states;
}

/** Is this position inside a string or a comment? (Autocomplete and auto-closing brackets stay quiet there.) */
export function insideTextOrComment(lines, line, column) {
  const states = lineStates(lines.slice(0, line + 1));
  const { tokens } = tokenizeLine(lines[line] ?? '', states[line]);
  let at = 0;
  for (const t of tokens) {
    if (column > at && column <= at + t.text.length && (t.cls === 's' || t.cls === 'c')) {
      // right after the closing quote or at the very start of a comment line is still outside
      const closed = t.cls === 's' && column === at + t.text.length && /^(["'`]).*\1$/.test(t.text) && t.text.length > 1;
      if (!closed) return t.cls;
    }
    at += t.text.length;
  }
  return null;
}
