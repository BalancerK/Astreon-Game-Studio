import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMarkup, stripMarkup, layoutMarkup, drawMarkup } from '../src/index.js';

/** A pretend canvas: every letter is 10 pixels wide (12 when bold), and what is drawn is written down. */
function pretend() {
  const drawn = [];
  const g = { font: '', fillStyle: '', measureText(t) { return { width: t.length * (this.font.includes('bold') ? 12 : 10) }; },
    fillText(t, x, y) { drawn.push({ t, x, y, font: this.font, color: this.fillStyle }); } };
  return { g, drawn };
}

test('tags are not letters, and each letter knows its colour, bold and lean', () => {
  const chars = parseMarkup('a[b]b[i]c[/b]d[/i][color=#FF0000]e[/color]f');
  assert.equal(chars.map((x) => x.c).join(''), 'abcdef');
  assert.deepEqual(chars.map((x) => [x.bold, x.italic, x.color]), [
    [false, false, null], [true, false, null], [true, true, null], [false, true, null], [false, false, '#ff0000'], [false, false, null]]);
});

test('anything that is not a good tag stays as text: unknown tags, closing a tag that was never opened, a colour with no colour', () => {
  for (const s of ['[x]hi', '[/b]hi', '[color]hi', '[color=red]hi', '[/color]hi', '[b hi', 'list[0]']) assert.equal(stripMarkup(s), s, s);
  assert.equal(stripMarkup('[b]open'), 'open', 'a tag left open ends with the line');
  assert.equal(stripMarkup(null), '');
});

test('words are wrapped to the width with their looks kept, and a new line starts at a line break', () => {
  const { g } = pretend();
  const lines = layoutMarkup(g, 'one two [color=#00ff00]three four[/color]', 100, '16px x');
  assert.deepEqual(lines.map((l) => l.map((r) => r.text).join('')), ['one two', 'three four']);
  assert.equal(lines[1][0].color, '#00ff00');
  assert.deepEqual(layoutMarkup(g, 'a\nb', 100, 'f').map((l) => l[0].text), ['a', 'b']);
  assert.deepEqual(layoutMarkup(g, 'x'.repeat(30), 100, 'f').length, 1, 'a word longer than the line stays whole');
});

test('bold words are measured wider, so they wrap sooner', () => {
  const { g } = pretend();
  assert.equal(layoutMarkup(g, 'aaaa bbbb', 90, 'f').length, 1);
  assert.equal(layoutMarkup(g, '[b]aaaa bbbb[/b]', 90, 'f').length, 2);
});

test('drawing shows only the first letters asked for, in the right colours and fonts', () => {
  const { g, drawn } = pretend();
  const lines = layoutMarkup(g, 'ab [color=#ff0000]cd[/color] [b]ef[/b]', 1000, '16px x');
  assert.equal(drawMarkup(g, lines, 5, 20, 18, { font: '16px x', shown: 4 }), 4);
  assert.deepEqual(drawn.map((d) => [d.t, d.color]), [['ab ', '#ffffff'], ['c', '#ff0000']]);
  drawn.length = 0;
  assert.equal(drawMarkup(g, lines, 5, 20, 18, { font: '16px x' }), 'ab cd ef'.length);
  assert.ok(drawn.at(-1).font.startsWith('bold'));
  assert.equal(drawn[1].x, 5 + 30, 'each run starts where the last one ended');
});
