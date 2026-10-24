// "Time every function": the studio can rewrite a project's own files, only for the copy it runs while the Profiler is looking, so that each function reports how
// long it takes. A function `update(dt) { ... }` becomes `update(dt) { return globalThis.__pf('main:update', () => { ... }); }`: the same text on the same
// lines (nothing moves, so error messages and the Time Machine still point at the right place), `this`, `arguments` and the returned value are as before, and the
// code you see in the editor and the code you ship are never changed. Functions that are `async`, generators, getters and setters and constructors are left
// alone (wrapping them would change what they mean), and so are anonymous callbacks (a name is what the table shows). Pure text in, text out: tested in Node.
import { maskText } from '../editing/code-index.js';
import { KEYWORDS } from '../editing/tokenize.js';

const CLOSER = { '(': ')', '[': ']', '{': '}' };
const OPENER = { ')': '(', ']': '[', '}': '{' };
const ID = /[A-Za-z_$][\w$]*/;
const MAX_WRAPS = 400;

function matchClose(m, open) {
  const want = CLOSER[m[open]];
  let depth = 0;
  for (let i = open; i < m.length; i++) {
    if (m[i] === m[open]) depth++;
    else if (m[i] === want && --depth === 0) return i;
  }
  return -1;
}

function matchOpen(m, close) {
  const want = OPENER[m[close]];
  let depth = 0;
  for (let i = close; i >= 0; i--) {
    if (m[i] === m[close]) depth++;
    else if (m[i] === want && --depth === 0) return i;
  }
  return -1;
}

const prevSig = (m, i) => { let k = i - 1; while (k >= 0 && /\s/.test(m[k])) k--; return k; };
const nextSig = (m, i) => { let k = i; while (k < m.length && /\s/.test(m[k])) k++; return k; };

/** The word that ends at index `end` (inclusive), or ''. */
function wordEndingAt(m, end) {
  let k = end;
  while (k >= 0 && /[\w$]/.test(m[k])) k--;
  return m.slice(k + 1, end + 1);
}

/** The name an arrow function or function expression is given by the code around it: `const f = …`, `this.f = …`, `f: …`; '' if none. */
function givenName(m, before) {
  let k = prevSig(m, before);
  if (k < 0 || (m[k] !== '=' && m[k] !== ':')) return '';
  if (m[k] === '=' && (m[k - 1] === '=' || m[k - 1] === '!' || m[k - 1] === '<' || m[k - 1] === '>' || m[k + 1] === '=')) return '';
  k = prevSig(m, k);
  const word = wordEndingAt(m, k);
  return ID.test(word) && !KEYWORDS.has(word) ? word : '';
}

/** Is the word before position `index` (skipping spaces) `async`? */
const asyncBefore = (m, index) => wordEndingAt(m, prevSig(m, index)) === 'async';

/**
 * Work out where to put the timing: each function worth timing as `{name, open, close}` (the positions of its `{` and `}`).
 * @param {string} text
 */
export function findFunctions(text) {
  const m = maskText(text);
  const found = new Map();                                  // index of `{` -> {name, open, close}
  const add = (name, open) => {
    if (!name || m[open] !== '{' || found.has(open)) return;
    const close = matchClose(m, open);
    if (close > open) found.set(open, { name, open, close });
  };
  // function declarations and expressions
  for (const hit of m.matchAll(/\bfunction\b(\s*\*)?\s*([A-Za-z_$][\w$]*)?\s*\(/g)) {
    if (hit[1] || asyncBefore(m, hit.index)) continue;
    const paren = hit.index + hit[0].length - 1;
    const end = matchClose(m, paren);
    if (end < 0) continue;
    const open = nextSig(m, end + 1);
    add(hit[2] || givenName(m, hit.index), open);
  }
  // arrow functions with a block body
  for (const hit of m.matchAll(/=>\s*\{/g)) {
    const open = hit.index + hit[0].length - 1;
    const k = prevSig(m, hit.index);
    let start;
    if (m[k] === ')') { start = matchOpen(m, k); if (start < 0 || asyncBefore(m, start)) continue; } else {
      const word = wordEndingAt(m, k);
      if (!ID.test(word)) continue;
      start = k - word.length + 1;
      if (asyncBefore(m, start)) continue;
    }
    add(givenName(m, start), open);
  }
  // methods of classes and objects: `name(params) {` after `{`, `}`, `,`, `;` or `static`
  for (const hit of m.matchAll(/(^|[{},;]|\bstatic\b)[ \t\r\n]*([A-Za-z_$][\w$]*)[ \t]*\(/g)) {
    const name = hit[2];
    if (KEYWORDS.has(name) || name === 'constructor' || name === 'get' || name === 'set' || name === 'async') continue;
    const paren = hit.index + hit[0].length - 1;
    const end = matchClose(m, paren);
    if (end < 0) continue;
    const open = nextSig(m, end + 1);
    if (m[open] === '{') add(name, open);
  }
  return [...found.values()].sort((a, b) => a.open - b.open).slice(0, MAX_WRAPS);
}

/**
 * Rewrite a file so that every function reports its time to `globalThis.__pf(name, fn)`.
 * @param {string} text the file's source
 * @param {string} file its path, for the names (`src/enemies.js` -> `enemies:update`)
 * @returns {{text: string, count: number}}
 */
export function instrumentSource(text, file = '') {
  const stem = file.replace(/^.*\//, '').replace(/\.m?js$/, '').slice(0, 14);
  const list = findFunctions(text);
  const edits = [];
  for (const f of list) {
    const name = JSON.stringify(`${stem}:${f.name}`.slice(0, 40));
    edits.push({ at: f.open, put: `{ return globalThis.__pf(${name}, () => {`, skip: 1 });
    edits.push({ at: f.close, put: '}); }', skip: 1 });
  }
  edits.sort((a, b) => b.at - a.at);
  let out = text;
  for (const e of edits) out = out.slice(0, e.at) + e.put + out.slice(e.at + e.skip);
  return { text: out, count: list.length };
}

/** Rewrite the project's own code files (not its scenes or data). @param {Record<string, any>} files @returns {{files: Record<string, any>, count: number}} */
export function instrumentFiles(files) {
  const out = {};
  let count = 0;
  for (const [path, content] of Object.entries(files)) {
    if (typeof content === 'string' && /^src\/.*\.m?js$/.test(path)) {
      const r = instrumentSource(content, path);
      out[path] = r.text;
      count += r.count;
    } else out[path] = content;
  }
  return { files: out, count };
}
