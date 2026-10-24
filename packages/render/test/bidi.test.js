import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bidiClass, resolveBidi, reorder, visualRuns, mirrored, needsBidi } from '../src/index.js';

const A = 'אבג', B = 'דהו'; // Hebrew letters
const visual = (text, dir) => visualRuns(text, dir).map((r) => r.text).join('');   // what is drawn from left to right, brackets mirrored
const levels = (text, dir) => Array.from(resolveBidi(text, dir).levels);

test('characters are classed: Latin L, Hebrew R, Arabic AL, digits EN or AN, punctuation and spaces neutral or weak', () => {
  const c = (s) => bidiClass(s.codePointAt(0));
  assert.deepEqual(['a', 'Z', 'é', 'я', '中', 'ひ'].map(c), ['L', 'L', 'L', 'L', 'L', 'L']);
  assert.deepEqual(['א', 'ת', 'ש'].map(c), ['R', 'R', 'R']); assert.deepEqual(['ا', 'ب', 'ܐ', 'ހ'].map(c), ['AL', 'AL', 'AL', 'AL']);
  assert.deepEqual(['5', '٣', '۴'].map(c), ['EN', 'AN', 'EN']); assert.deepEqual(['+', '-', ',', '.', ':', '$', '%'].map(c), ['ES', 'ES', 'CS', 'CS', 'CS', 'ET', 'ET']);
  assert.deepEqual([' ', ' '.length, '(', '!', '—'].map((x) => (typeof x === 'string' ? c(x) : 'n')), ['WS', 'n', 'ON', 'ON', 'ON']);
  assert.deepEqual(['\t', '\n', '́', '‎', '‏', '‮', '⁧', '⁩'].map(c), ['S', 'B', 'NSM', 'L', 'R', 'RLO', 'RLI', 'PDI']);
  assert.equal(c('​'), 'BN'); assert.equal(c('😀'), 'ON');
  assert.equal(needsBidi('hello'), false); assert.equal(needsBidi('שלום'), true); assert.equal(needsBidi('مرحبا'), true); assert.equal(needsBidi('a‮b'), true); assert.equal(needsBidi('日本語'), false);
});

test('plain left-to-right text is untouched', () => {
  const r = resolveBidi('Hello, world 123!');
  assert.equal(r.paragraphLevel, 0); assert.deepEqual(r.order, [...Array(17).keys()]); assert.ok(Array.from(r.levels).every((l) => l === 0));
  assert.equal(visual(''), ''); assert.deepEqual(resolveBidi('').order, []);
});

test('a right-to-left paragraph reads from the right, and mixed text keeps each part in its own direction', () => {
  assert.equal(resolveBidi(A).paragraphLevel, 1); assert.equal(visual(A), 'גבא', 'the letters are reversed for drawing from the left');
  assert.deepEqual(levels(`abc ${A}`), [0, 0, 0, 0, 1, 1, 1]); assert.equal(visual(`abc ${A}`), 'abc גבא', 'English first: the Hebrew part is reversed in place');
  assert.deepEqual(levels(`${A} abc`), [1, 1, 1, 1, 2, 2, 2]); assert.equal(visual(`${A} abc`), 'abc גבא', 'Hebrew first: the paragraph is right to left, so English comes to the left');
  assert.equal(visual(`${A} abc ${B}`), 'והד abc גבא', 'two Hebrew words around English: the second reads to the left of the first');
  assert.equal(visual('Hello world', 'rtl'), 'Hello world', 'an English phrase in a right-to-left paragraph is one left-to-right run and reads as usual');
  assert.equal(visual(`abc ${A} def`, 'rtl'), `def ${'גבא'} abc`, 'but English phrases separated by Hebrew swap sides');
  assert.equal(visual(`abc ${A}`, 'rtl'), 'גבא abc'); assert.equal(visual(A, 'ltr'), 'גבא', 'a lone Hebrew word is reversed in either paragraph direction');
});

test('numbers keep their order inside right-to-left text', () => {
  assert.deepEqual(levels(`${A} 123`), [1, 1, 1, 1, 2, 2, 2]); assert.equal(visual(`${A} 123`), '123 גבא');
  assert.equal(visual(`${A} 12,345.6 ${B}`), 'והד 12,345.6 גבא', 'separators between digits stay part of the number');
  assert.equal(visual('אב -5%'), '5%- בא', 'a percent sign sticks to its number; the minus before it does not');
  assert.equal(visual('ا ١٢٣'), '١٢٣ ا', 'Arabic-Indic digits are numbers too');
  assert.equal(visual('1+2=3 abc'), '1+2=3 abc');
  assert.equal(visual('abc 123 def'), 'abc 123 def');
  assert.deepEqual(levels('a1'), [0, 0]); assert.deepEqual(levels('א1'), [1, 2]);
});

test('neutrals take the direction of what is around them, or the paragraph direction when it is mixed', () => {
  assert.deepEqual(levels(`${A} - ${B}`), [1, 1, 1, 1, 1, 1, 1, 1, 1], 'between two Hebrew words the dash is Hebrew too');
  assert.deepEqual(levels(`a - b`), [0, 0, 0, 0, 0]);
  assert.deepEqual(levels(`a ${A}`), [0, 0, 1, 1, 1], 'a space between English and Hebrew follows the paragraph (left to right)');
  assert.deepEqual(levels(`${A} a`.replace(' a', ' !')), [1, 1, 1, 1, 1], 'trailing punctuation joins the Hebrew');
  assert.deepEqual(levels(`${A}   `), [1, 1, 1, 1, 1, 1], 'trailing spaces take the paragraph level (L1)');
  assert.deepEqual(levels(`abc   `), [0, 0, 0, 0, 0, 0]);
});

test('brackets face the way of the text they hold, and mirror in right-to-left runs', () => {
  assert.equal(visual(`(${A})`), '(גבא)', 'logical ( first, drawn mirrored on the right: the shapes still enclose the word');
  assert.equal(visualRuns(`(${A})`)[0].text, '(גבא)'); assert.equal(resolveBidi(`(${A})`).codePoints.map((c) => String.fromCodePoint(c)).join(''), `(${A})`, 'the logical text is kept as it was'); assert.equal(mirrored(0x28), 0x29); assert.equal(mirrored(0x29), 0x28); assert.equal(mirrored(0xab), 0xbb); assert.equal(mirrored(0x61), 0x61);
  assert.deepEqual(levels(`a(${A})b`), [0, 0, 1, 1, 1, 0, 0], 'a bracket pair holding Hebrew inside English text stays English (N0)');
  assert.deepEqual(levels(`${A}(abc)${B}`), [1, 1, 1, 1, 2, 2, 2, 1, 1, 1, 1], 'English in brackets inside Hebrew: the brackets belong to the Hebrew');
  assert.equal(visual(`${A} (abc)`), '(abc) גבא');
});

test('explicit embeddings, overrides and isolates', () => {
  assert.equal(visual('‫ab‬'), 'ab', 'RLE: English in a right-to-left embedding reads as before and the control is gone');
  assert.equal(visual('x‫ab cd‬y'), 'xab cdy', 'an English phrase inside a right-to-left embedding is still one run');
  assert.equal(visual(`x‫ab ${A} cd‬y`), `xcd ${'גבא'} aby`, 'but with Hebrew between them the two phrases swap sides inside the embedding');
  assert.equal(visual('‮abc‬'), 'cba', 'RLO forces right to left on everything');
  assert.equal(visual(`‭${A}‬`), A, 'LRO forces left to right');
  assert.equal(visual(`a ⁧${A}⁩ c`), `a ${'גבא'} c`, 'an isolate keeps its Hebrew from reordering what is around it');
  assert.equal(visual(`${A} ⁦abc⁩ ${B}`), 'והד abc גבא');
  assert.equal(visual(`⁨${A}⁩ x`), 'גבא x', 'a first-strong isolate holding Hebrew reads right to left inside, and does not move what is around it');
  assert.equal(resolveBidi('a​b').codePoints.length, 2, 'zero-width and control characters are consumed');
  assert.equal(resolveBidi('‏abc').paragraphLevel, 1, 'a right-to-left mark sets the paragraph direction'); assert.deepEqual(levels('‏abc'), [1, 2, 2, 2]);
  const deep = '‫'.repeat(80) + 'x' + '‬'.repeat(80); assert.doesNotThrow(() => resolveBidi(deep)); assert.ok(Math.max(...resolveBidi(deep).levels) <= 126, 'embedding depth is capped');
});

test('reorder reverses from the deepest level up to the lowest odd one', () => {
  assert.deepEqual(reorder([0, 0, 0]), [0, 1, 2]); assert.deepEqual(reorder([1, 1, 1]), [2, 1, 0]);
  assert.deepEqual(reorder([0, 1, 1, 0]), [0, 2, 1, 3]); assert.deepEqual(reorder([1, 1, 2, 2, 1]), [4, 2, 3, 1, 0]);
  assert.deepEqual(reorder([0, 2, 2, 0]), [0, 1, 2, 3], 'level 2 alone reverses twice');
  assert.deepEqual(reorder([]), []); assert.deepEqual(reorder([1]), [0]);
});

test('on thousands of random strings the result is a permutation, deterministic, sane in its levels, and pure left-to-right text never moves', () => {
  const alphabet = ['a', 'b', 'c', 'x', ' ', ' ', '1', '2', '.', ',', '-', '(', ')', '!', 'א', 'ב', 'ג', 'ד', 'ا', 'ب', 'ج', '٣', '́', '⁧', '⁩', '‫', '‬', '‏', '%'];
  let s = 12345; const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < 4000; i++) {
    const text = Array.from({ length: 1 + Math.floor(rnd() * 14) }, () => alphabet[Math.floor(rnd() * alphabet.length)]).join('');
    for (const dir of ['auto', 'ltr', 'rtl']) {
      const r = resolveBidi(text, dir), again = resolveBidi(text, dir), n = r.codePoints.length;
      assert.deepEqual(Array.from(r.levels), Array.from(again.levels)); assert.deepEqual(r.order, again.order);
      assert.deepEqual([...r.order].sort((a, b) => a - b), [...Array(n).keys()], `permutation of ${JSON.stringify(text)}`);
      for (const l of r.levels) assert.ok(l >= 0 && l <= 126);
      if (dir === 'ltr' && !/[֐-ࣿ‎‏‪-‮⁦-⁩]/.test(text)) assert.deepEqual(r.order, [...Array(n).keys()], 'pure LTR');
    }
  }
});
