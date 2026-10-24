import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenizeLine, tokensToHtml, highlightLine, insideTextOrComment, lineStates, STATE } from '../app/editing/tokenize.js';
import { decorateTokens, decoratedToHtml, byLine } from '../app/editing/decorate.js';
import {
  applyEdit, onEnter, onType, onBackspace, toggleComment, indentLines, moveLines, duplicateLines, deleteLines, wordAt, matchBracket, lineStart, lineEnd,
} from '../app/editing/ops.js';

/** Put the caret in a text written with | for the caret, or « and » around a selection; apply a function; show the result the same way. */
function run(source, fn) {
  let anchor; let head; let text;
  const open = source.indexOf('«');
  if (open >= 0) { const close = source.indexOf('»'); text = source.slice(0, open) + source.slice(open + 1, close) + source.slice(close + 1); anchor = open; head = close - 1; }
  else { head = source.indexOf('|'); anchor = head; text = source.replace('|', ''); }
  const e = fn(text, Math.min(anchor, head), Math.max(anchor, head));
  if (!e) return null;
  const r = applyEdit(text, e);
  const lo = Math.min(r.anchor, r.head); const hi = Math.max(r.anchor, r.head);
  return lo === hi ? `${r.text.slice(0, lo)}|${r.text.slice(lo)}` : `${r.text.slice(0, lo)}«${r.text.slice(lo, hi)}»${r.text.slice(hi)}`;
}

// ---------- tokens ----------
test('the tokenizer cuts a line into pieces that always add up to the line, whatever it contains', () => {
  const lines = ['const x = 5; // note', "return f('a\\'b', `t${1}`);", 'export class Ship extends Base {', '/* open', ' still */ x', '`open', 'close` + 1', '"unterminated', "a'b", '\\', '', '    ', '1.5e3 0xFF .5', '€ ünï ☃'];
  let state = 0;
  for (const line of lines) {
    const r = tokenizeLine(line, state); state = r.state;
    assert.equal(r.tokens.map((t) => t.text).join(''), line, `lost characters in: ${line}`);
  }
  const noise = Array.from({ length: 200 }, (_, i) => String.fromCharCode(32 + ((i * 37) % 95))).join(''); assert.equal(tokenizeLine(noise).tokens.map((t) => t.text).join(''), noise);
});

test('the tokenizer names keywords, strings, numbers, comments, calls and Capitalised names, and carries block comments and templates across lines', () => {
  const cls = (line, state = 0) => tokenizeLine(line, state).tokens.filter((t) => t.cls).map((t) => `${t.cls}:${t.text}`).join(' ');
  assert.equal(cls('const x = 5;'), 'k:const n:5'); assert.equal(cls("return f('a');"), "k:return f:f s:'a'"); assert.equal(cls('new Ship(1)'), 'k:new t:Ship n:1', 'a Capitalised name before ( is a class');
  assert.equal(cls('x // hi'), 'c:// hi'); assert.equal(cls('true && undefined'), 'k:true k:undefined'); assert.equal(cls('MAX_SPEED'), '', 'ALL_CAPS is a constant, not a class');
  assert.equal(tokenizeLine('a /* b').state, STATE.comment); assert.equal(tokenizeLine('c */ d', STATE.comment).state, STATE.code); assert.equal(cls('c */ d', STATE.comment), 'c:c */');
  assert.equal(tokenizeLine('x = `a').state, STATE.template); assert.equal(tokenizeLine('b` + 1', STATE.template).state, STATE.code); assert.equal(tokenizeLine('"a`b"').state, STATE.code);
  assert.equal(highlightLine('a < b && c').html, 'a &lt; b &amp;&amp; c'); assert.equal(tokensToHtml([{ text: '<b>', cls: 's' }]), '<span class="s">&lt;b&gt;</span>');
  assert.deepEqual(lineStates(['/*', 'x', '*/', 'y']), [0, 1, 1, 0, 0]);
});

test('is the caret inside a string or a comment? (autocomplete and brackets stay quiet there)', () => {
  const lines = ["const a = 'hello';", '// a comment', 'const b = `multi', 'line`;', 'f(x)'];
  assert.equal(insideTextOrComment(lines, 0, 12), 's'); assert.equal(insideTextOrComment(lines, 0, 5), null); assert.equal(insideTextOrComment(lines, 1, 6), 'c');
  assert.equal(insideTextOrComment(lines, 3, 2), 's', 'inside a template that continues from the line before'); assert.equal(insideTextOrComment(lines, 4, 2), null);
  assert.equal(insideTextOrComment(lines, 0, 17), null, 'right after the closing quote is outside'); assert.equal(insideTextOrComment(lines, 0, 11), 's', 'before the closing quote is inside');
});

// ---------- decorations ----------
test('decorations split the coloured pieces where a mark starts and ends, and never lose or duplicate text', () => {
  const tokens = tokenizeLine('const speed = 120;').tokens;
  const pieces = decorateTokens(tokens, [{ from: 6, to: 11, cls: 'err', title: 'oops' }]);
  assert.equal(pieces.map((p) => p.text).join(''), 'const speed = 120;');
  assert.deepEqual(pieces.filter((p) => p.marks.length).map((p) => [p.text, p.marks[0].cls, p.marks[0].title]), [['speed', 'err', 'oops']]);
  const html = decoratedToHtml(pieces); assert.match(html, /<span class="err" data-tip="oops">speed<\/span>/); assert.match(html, /<span class="k">const<\/span>/);
  const across = decorateTokens(tokenizeLine("a('xyz')").tokens, [{ from: 2, to: 6, cls: 'm' }]);
  assert.equal(across.map((p) => p.text).join(''), "a('xyz')"); assert.deepEqual(across.filter((p) => p.marks.length).map((p) => p.text).join(''), "'xyz");
  const two = decorateTokens(tokenizeLine('abcdef').tokens, [{ from: 0, to: 4, cls: 'a' }, { from: 2, to: 6, cls: 'b' }]);
  assert.deepEqual(two.map((p) => [p.text, p.marks.map((m) => m.cls).join('')]), [['ab', 'a'], ['cd', 'ab'], ['ef', 'b']], 'overlapping marks stack');
  const past = decorateTokens(tokenizeLine('ab').tokens, [{ from: 2, to: 2, cls: 'err' }]); assert.deepEqual(past.map((p) => p.text), ['ab', ' '], 'a mark at the end of a line is one visible space');
  assert.equal(decorateTokens([], []).length, 0); assert.match(decoratedToHtml([{ text: 'x', cls: '', marks: [{ cls: 'e"vil', title: '<script>' }] }]), /class="e&quot;vil" data-tip="&lt;script&gt;"/, 'text from outside is escaped');
  const map = byLine([{ line: 2, from: 0, to: 1, cls: 'a' }, { line: 2, from: 1, to: 2, cls: 'b' }, { line: 5, from: 0, to: 1, cls: 'c' }]); assert.equal(map.get(2).length, 2); assert.equal(map.get(5).length, 1); assert.equal(map.get(1), undefined);
});

// ---------- typing helpers ----------
test('Enter keeps the indentation, adds a step after an opening bracket, and opens a block between a pair of brackets', () => {
  const enter = (s) => run(s, (t, a, b) => onEnter(t, a, b, 2));
  assert.equal(enter('  foo(|'), '  foo(\n    |'); assert.equal(enter('abc|'), 'abc\n|'); assert.equal(enter('  abc|'), '  abc\n  |'); assert.equal(enter('    abc  |'), '    abc  \n    |');
  assert.equal(enter('if (x) {|}'), 'if (x) {\n  |\n}'); assert.equal(enter('  if (x) {|}'), '  if (x) {\n    |\n  }');
  assert.equal(enter('x = [|]'), 'x = [\n  |\n]'); assert.equal(enter('a[b|]'), 'a[b\n|]', 'between other characters it is just a new line');
  assert.equal(enter('  ab|cd'), '  ab\n  |cd', 'splitting a line keeps the indentation for the rest'); assert.equal(enter('  [foo]|'), '  [foo]\n  |'); assert.equal(enter('  {|'), '  {\n    |');
  assert.equal(enter('   |x'), '   \n   |x'); assert.equal(enter('a\n  b|'), 'a\n  b\n  |'); assert.equal(enter('abc«xyz»def'), 'abc\n|def', 'a selection is replaced');
});

test('typing an opening bracket or quote closes it; typing the closing one types over it; a selection is wrapped; strings and words are left alone', () => {
  const type = (s, ch, o) => run(s, (t, a, b) => onType(t, a, b, ch, o));
  assert.equal(type('f|', '('), 'f(|)'); assert.equal(type('|', '['), '[|]'); assert.equal(type('x = |', '{'), 'x = {|}'); assert.equal(type('a|b', '('), null, 'before a letter: just type it');
  assert.equal(type('f(|)', ')'), 'f()|', 'typing the closer steps over it'); assert.equal(type("x = '|'", "'"), "x = ''|"); assert.equal(type('[a|]', ']'), '[a]|');
  assert.equal(type('x = |', '"'), 'x = "|"'); assert.equal(type('it|', "'"), null, 'an apostrophe after a word is just an apostrophe'); assert.equal(type('x = |', '`'), 'x = `|`');
  assert.equal(type('f([a]|)', ')'), 'f([a])|'); assert.equal(type('|;', '('), '(|);'); assert.equal(type('|)', '('), '(|))');
  assert.equal(type('x = «sel»', '('), 'x = («sel»)', 'a selection is wrapped and stays selected'); assert.equal(type('a «bc» d', '"'), 'a "«bc»" d');
  assert.equal(type("'a|b'", '(', { inString: true }), null, 'inside a string no pair is made'); assert.equal(type("'a|'", "'", { inString: true }), "'a'|", 'but the closing quote is still stepped over');
  assert.equal(type('a|', 'x'), null); assert.equal(type('«ab»', 'x'), null, 'a selection is replaced by plain typing');
});

test('Backspace between an automatic pair removes both', () => {
  const back = (s) => run(s, (t, a, b) => onBackspace(t, a, b));
  assert.equal(back('f(|)'), 'f|'); assert.equal(back("x = '|'"), 'x = |'); assert.equal(back('[|]'), '|'); assert.equal(back('f(a|)'), null); assert.equal(back('|x'), null);
  assert.equal(back('a\n(|)'), 'a\n|'); assert.equal(back('«ab»'), null);
});

test('Ctrl+/ comments lines out and back, keeping the indentation and the caret in place', () => {
  const tog = (s) => run(s, (t, a, b) => toggleComment(t, a, b));
  assert.equal(tog('  x = 1|'), '  // x = 1|'); assert.equal(tog('  // x = 1|'), '  x = 1|'); assert.equal(tog('a|bc'), '// a|bc'); assert.equal(tog('//abc|'), 'abc|', 'with no space after the slashes');
  assert.equal(tog('«a\n  b\n\n  c»'), '«// a\n//   b\n\n//   c»', 'the comment goes at the smallest indentation, and blank lines stay blank');
  assert.equal(tog('«// a\n//   b\n\n//   c»'), '«a\n  b\n\n  c»'); assert.equal(tog('«// a\nb»'), '«// // a\n// b»', 'a mixed block is commented as a whole');
  assert.equal(tog('|'), '// |'); assert.equal(tog('x\n|'), 'x\n// |', 'an empty line gets a comment when it is the only one');
  assert.equal(tog('«x\ny\n»'), '«// x\n// y»\n', 'a selection that ends at the start of a line does not include that line');
});

test('Tab types spaces to the next tab stop, a selection indents its lines, Shift+Tab takes a step back', () => {
  const tab = (s, dir, size = 2) => run(s, (t, a, b) => indentLines(t, a, b, dir, size));
  assert.equal(tab('|', 1), '  |'); assert.equal(tab('a|', 1), 'a |'); assert.equal(tab('ab|', 1), 'ab  |'); assert.equal(tab('abc|', 1, 4), 'abc |');
  assert.equal(tab('«a\nb»', 1), '«  a\n  b»'); assert.equal(tab('«a\n\nb»', 1), '«  a\n\n  b»', 'empty lines stay empty'); assert.equal(tab('x«a»y', 1), '«  xay»', 'a selection inside a line indents the whole line');
  assert.equal(tab('«    a\n  b»', -1), '«  a\nb»'); assert.equal(tab('  x|', -1), 'x|'); assert.equal(tab(' x|', -1), 'x|'); assert.equal(tab('x|', -1), 'x|'); assert.equal(tab('\tx|', -1), 'x|');
  assert.equal(tab('a|b', -1), 'a|b', 'nothing to remove');
});

test('Alt+Up and Alt+Down move lines, Shift+Alt+Down copies them, and Ctrl+Shift+K deletes them', () => {
  const move = (s, d) => run(s, (t, a, b) => moveLines(t, a, b, d));
  assert.equal(move('a\nb|\nc', -1), 'b|\na\nc'); assert.equal(move('a\nb|\nc', 1), 'a\nc\nb|'); assert.equal(move('a|\nb', -1), null); assert.equal(move('a\nb|', 1), null);
  assert.equal(move('a\n«b\nc»\nd', 1), 'a\nd\n«b\nc»'); assert.equal(move('a\n«b\nc»\nd', -1), '«b\nc»\na\nd');
  const dup = (s, d) => run(s, (t, a, b) => duplicateLines(t, a, b, d));
  assert.equal(dup('a|b', 1), 'ab\na|b'); assert.equal(dup('x\nab|', -1), 'x\nab|\nab'); assert.equal(dup('«a\nb»', 1), 'a\nb\n«a\nb»');
  const del = (s) => run(s, (t, a, b) => deleteLines(t, a, b));
  assert.equal(del('a\nb|\nc'), 'a\n|c'); assert.equal(del('a\nb|'), 'a|'); assert.equal(del('only|'), '|'); assert.equal(del('«a\nb»\nc'), '|c');
});

test('words and matching brackets', () => {
  assert.deepEqual(wordAt('let speed = 5', 6), { from: 4, to: 9, word: 'speed' }); assert.deepEqual(wordAt('let speed', 9), { from: 4, to: 9, word: 'speed' }, 'at the end of a word'); assert.equal(wordAt('a  b', 2), null); assert.equal(wordAt('$x_1', 2).word, '$x_1');
  assert.deepEqual(matchBracket('f(a, [b])', 2), { a: 1, b: 8 }, 'caret just after the ('); assert.deepEqual(matchBracket('f(a, [b])', 8), { a: 7, b: 5 }, 'caret just after the ]');
  assert.deepEqual(matchBracket('{ a { b } }', 0), { a: 0, b: 10 }, 'caret before the {'); assert.deepEqual(matchBracket('{ a { b } }', 11), { a: 10, b: 0 }, 'caret after the last }');
  assert.deepEqual(matchBracket("f('(' + a)", 2), { a: 1, b: 9 }, 'a bracket inside a string does not count'); assert.deepEqual(matchBracket('f(a) // )', 2), { a: 1, b: 3 });
  assert.equal(matchBracket('f(a', 2), null, 'no match: nothing'); assert.equal(matchBracket('abc', 1), null); assert.equal(matchBracket('x'.repeat(250_000), 5), null, 'a huge text is not scanned');
  assert.equal(lineStart('ab\ncd', 4), 3); assert.equal(lineEnd('ab\ncd', 0), 2); assert.equal(lineEnd('ab\ncd', 4), 5);
});
