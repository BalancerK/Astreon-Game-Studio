// What the editor does for you while you type, as pure functions on text: keep the indentation on a new line, close a bracket you opened, comment lines
// out, indent a block, move or copy lines, find the bracket that matches. Each returns an *edit* (replace the text from `from` to `to` with `insert`, then
// select `anchor`..`head` in the new text) or null when the keystroke should just be typed normally. The page applies an edit with the browser's own
// editing command, so undo and redo keep working as everywhere else.
import { tokenizeLine, STATE } from './tokenize.js';

/**
 * @typedef {Object} Edit
 * @property {number} from start of the text to replace
 * @property {number} to end of the text to replace
 * @property {string} insert what goes there
 * @property {number} anchor where the selection starts afterwards (in the new text)
 * @property {number} head where it ends (the caret is here)
 */

const OPEN = { '(': ')', '[': ']', '{': '}' };
const CLOSE = new Set(Object.values(OPEN));
const QUOTES = new Set(['"', "'", '`']);

export const lineStart = (text, pos) => text.lastIndexOf('\n', pos - 1) + 1;
export const lineEnd = (text, pos) => { const i = text.indexOf('\n', pos); return i < 0 ? text.length : i; };
export const indentOf = (line) => /^[ \t]*/.exec(line)[0];
const isWord = (c) => c !== undefined && /[\w$]/.test(c);

/** Make an edit from a replaced range and the selection wanted in the NEW text. */
const edit = (from, to, insert, anchor, head = anchor) => ({ from, to, insert, anchor, head });

/** Apply an edit to a text. Returns the new text and selection. (The page does the same with the browser's editing command.) */
export function applyEdit(text, e) {
  return { text: text.slice(0, e.from) + e.insert + text.slice(e.to), anchor: e.anchor, head: e.head };
}

/** Enter: start the new line at the same indentation; after an opening bracket indent one more, and between a pair of brackets open up the block. */
export function onEnter(text, start, end, tabSize = 2) {
  const ls = lineStart(text, start);
  const before = text.slice(ls, start);
  const indent = indentOf(before).slice(0, Math.min(indentOf(before).length, start - ls));
  const prev = before.trimEnd().slice(-1);
  const next = text[end];
  const unit = ' '.repeat(tabSize);
  if (OPEN[prev] && next === OPEN[prev]) {
    const insert = `\n${indent}${unit}\n${indent}`;
    return edit(start, end, insert, start + 1 + indent.length + unit.length);
  }
  const extra = OPEN[prev] ? unit : '';
  const insert = `\n${indent}${extra}`;
  return edit(start, end, insert, start + insert.length);
}

/**
 * A typed character: close the bracket or quote just opened, type over a closing one that is already there, or wrap the selection.
 * @param {string} text @param {number} start @param {number} end @param {string} ch
 * @param {{inString?: boolean}} [o] `inString`: the caret is inside a string or comment (no automatic closing there)
 */
export function onType(text, start, end, ch, { inString = false } = {}) {
  const next = text[end];
  const prev = text[start - 1];
  if (start !== end) {                                                    // something is selected: wrap it
    if (OPEN[ch]) return edit(start, end, ch + text.slice(start, end) + OPEN[ch], start + 1, end + 1);
    if (QUOTES.has(ch)) return edit(start, end, ch + text.slice(start, end) + ch, start + 1, end + 1);
    return null;
  }
  if ((CLOSE.has(ch) || QUOTES.has(ch)) && next === ch) return edit(start, start, '', start + 1);       // type over what is already there
  if (inString) return null;
  if (OPEN[ch]) {
    const calm = next === undefined || /\s/.test(next) || CLOSE.has(next) || next === ',' || next === ';';
    return calm ? edit(start, start, ch + OPEN[ch], start + 1) : null;
  }
  if (QUOTES.has(ch)) {
    const calm = next === undefined || /\s/.test(next) || CLOSE.has(next) || next === ',' || next === ';';
    const quiet = calm && !isWord(prev) && prev !== '\\' && !QUOTES.has(prev);
    return quiet ? edit(start, start, ch + ch, start + 1) : null;
  }
  return null;
}

/** Backspace between a pair that was closed automatically removes both. */
export function onBackspace(text, start, end) {
  if (start !== end || start === 0) return null;
  const a = text[start - 1];
  const b = text[start];
  if ((OPEN[a] === b && b !== undefined) || (QUOTES.has(a) && a === b)) return edit(start - 1, start + 1, '', start - 1);
  return null;
}

/** The lines a selection touches, as the range from the start of the first to the end of the last (a selection ending at a line's very start excludes it). */
function lineRange(text, start, end) {
  const from = lineStart(text, start);
  const effectiveEnd = end > start && text[end - 1] === '\n' ? end - 1 : end;
  const to = lineEnd(text, effectiveEnd);
  return { from, to, lines: text.slice(from, to).split('\n') };
}

/** Comment the selected lines out, or remove the comments if they are all commented already. */
export function toggleComment(text, start, end) {
  const { from, to, lines } = lineRange(text, start, end);
  const real = lines.filter((l) => l.trim() !== '');
  const allCommented = real.length > 0 && real.every((l) => l.trimStart().startsWith('//'));
  const margin = real.length ? Math.min(...real.map((l) => indentOf(l).length)) : 0;
  const out = lines.map((l) => {
    if (allCommented) return l.replace(/^(\s*)\/\/ ?/, '$1');
    return l.trim() === '' && real.length ? l : `${l.slice(0, margin)}// ${l.slice(margin)}`;      // blank lines stay blank, unless all of them are
  });
  const insert = out.join('\n');
  if (start !== end) return edit(from, to, insert, from, from + insert.length);
  const delta = out[0].length - lines[0].length;                  // the caret keeps its place in the text it was in
  const moves = allCommented || start - from >= margin;
  return edit(from, to, insert, moves ? Math.max(from, start + delta) : start);
}

/** Tab and Shift+Tab: with nothing selected, Tab types spaces up to the next tab stop; otherwise whole lines move in or out. */
export function indentLines(text, start, end, direction, tabSize = 2) {
  const unit = ' '.repeat(tabSize);
  if (start === end && direction > 0) {
    const col = start - lineStart(text, start);
    const spaces = tabSize - (col % tabSize);
    return edit(start, end, ' '.repeat(spaces), start + spaces);
  }
  const { from, to, lines } = lineRange(text, start, end);
  const out = lines.map((l) => {
    if (direction > 0) return l.trim() === '' ? l : unit + l;
    if (l.startsWith('\t')) return l.slice(1);
    const lead = Math.min(indentOf(l).length, tabSize);
    return l.slice(lead);
  });
  const insert = out.join('\n');
  if (start === end) {                                          // Shift+Tab on a single line: the caret stays with its text
    const removed = lines[0].length - out[0].length;
    const caret = Math.max(from, start - removed);
    return edit(from, to, insert, caret);
  }
  return edit(from, to, insert, from, from + insert.length);
}

/** Move the selected lines up (-1) or down (+1) past their neighbour. Null at the top or bottom. */
export function moveLines(text, start, end, direction) {
  const { from, to } = lineRange(text, start, end);
  if (direction < 0) {
    if (from === 0) return null;
    const prevFrom = lineStart(text, from - 1);
    const block = text.slice(from, to);
    const above = text.slice(prevFrom, from - 1);
    const insert = `${block}\n${above}`;
    const delta = prevFrom - from;
    return edit(prevFrom, to, insert, start + delta, end + delta);
  }
  if (to >= text.length) return null;
  const nextTo = lineEnd(text, to + 1);
  const block = text.slice(from, to);
  const below = text.slice(to + 1, nextTo);
  const insert = `${below}\n${block}`;
  const delta = below.length + 1;
  return edit(from, nextTo, insert, start + delta, end + delta);
}

/** Copy the selected lines below (+1) or above (-1) themselves; the selection moves to the copy for +1. */
export function duplicateLines(text, start, end, direction = 1) {
  const { from, to } = lineRange(text, start, end);
  const block = text.slice(from, to);
  if (direction > 0) return edit(to, to, `\n${block}`, start + block.length + 1, end + block.length + 1);
  return edit(from, from, `${block}\n`, start, end);
}

/** The whole line(s) removed. */
export function deleteLines(text, start, end) {
  const { from, to } = lineRange(text, start, end);
  const removeTo = to < text.length ? to + 1 : to;
  const removeFrom = removeTo === to && from > 0 ? from - 1 : from;
  return edit(removeFrom, removeTo, '', removeFrom);
}

/** The word (letters, digits, _ and $) at or just before a position. */
export function wordAt(text, pos) {
  let a = pos;
  let b = pos;
  while (a > 0 && isWord(text[a - 1])) a--;
  while (b < text.length && isWord(text[b])) b++;
  return a === b ? null : { from: a, to: b, word: text.slice(a, b) };
}

/** Which characters are inside strings or comments (so brackets there do not count). */
function quietMask(text) {
  const mask = new Uint8Array(text.length);
  let state = STATE.code;
  let offset = 0;
  for (const line of text.split('\n')) {
    const { tokens, state: next } = tokenizeLine(line, state);
    let at = offset;
    for (const t of tokens) {
      if (t.cls === 's' || t.cls === 'c') mask.fill(1, at, at + t.text.length);
      at += t.text.length;
    }
    state = next;
    offset += line.length + 1;
  }
  return mask;
}

/**
 * The bracket that pairs with the one next to the caret (the one before it, else the one after it).
 * @returns {{a: number, b: number} | null} the two offsets, or null when there is none (or the text is too big to scan quickly)
 */
export function matchBracket(text, pos) {
  if (text.length > 200_000) return null;
  const candidates = [pos - 1, pos];
  const mask = quietMask(text);
  for (const i of candidates) {
    const c = text[i];
    if (c === undefined || mask[i] || !(OPEN[c] || CLOSE.has(c))) continue;
    const forward = !!OPEN[c];
    const want = forward ? OPEN[c] : Object.keys(OPEN).find((k) => OPEN[k] === c);
    let depth = 0;
    for (let j = i; forward ? j < text.length : j >= 0; j += forward ? 1 : -1) {
      if (mask[j]) continue;
      if (text[j] === c) depth++;
      else if (text[j] === want && --depth === 0) return { a: i, b: j };
    }
  }
  return null;
}
