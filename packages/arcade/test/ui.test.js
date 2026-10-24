import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  drawUi, uiHit, uiNext, uiButtons, layoutUi, placeOf, textOf, cleanUi, cleanWidget, uiProblems, visible, offsetsFor, WIDGET_TYPES, ANCHORS,
} from '../src/ui.js';
import { text } from '../src/text.js';

const SIZE = { width: 480, height: 320 };
const w = (extra) => cleanWidget({ type: 'label', id: 'a', ...extra });

/** A canvas that records what is drawn, so drawing can be checked without a page. */
function recorder() {
  const log = [];
  const g = new Proxy({}, {
    get: (_, name) => {
      if (name === 'log') return log;
      return (...args) => { log.push([String(name), ...args]); };
    },
    set: (_, name, value) => { log.push([`set:${String(name)}`, value]); return true; },
  });
  return g;
}

test('every widget type has a starting form that is already clean', () => {
  for (const [type, kind] of Object.entries(WIDGET_TYPES)) {
    const made = cleanWidget({ ...kind.make(), id: 'x' });
    assert.equal(made.type, type);
    assert.deepEqual(cleanWidget(made), made, `${type}: cleaning twice changes nothing`);
    assert.ok(kind.label);
  }
});

test('widgets are made safe: unknown types dropped, numbers in range, colors checked, anchors from the list, paths that look like paths', () => {
  assert.equal(cleanWidget({ type: 'carousel' }), null);
  assert.equal(cleanWidget(null), null);
  const c = cleanWidget({ type: 'button', id: 'bad id!', anchor: 'middle', x: 1e9, w: -5, h: 'tall', text: 'x'.repeat(500), size: 1, color: 'red', showIf: 'a b', junk: 1 });
  assert.equal(c.id, '');
  assert.equal(c.anchor, 'top-left');
  assert.equal(c.x, 2000);
  assert.equal(c.w, 1);
  assert.equal(c.h, 36);
  assert.equal(c.text.length, 120);
  assert.equal(c.size, 6);
  assert.equal(c.color, '#ffffff');
  assert.ok(!('showIf' in c) && !('junk' in c));
  const bar = cleanWidget({ type: 'bar', value: 'player.hp', max: 'player.maxHp', showIf: '!dead' });
  assert.deepEqual([bar.value, bar.max, bar.showIf], ['player.hp', 'player.maxHp', '!dead']);
  assert.equal(cleanWidget({ type: 'bar', value: 'a;b' }).value, 'hp');
  assert.equal(cleanWidget({ type: 'panel', border: '' }).border, '', 'no border is allowed');
  const ui = cleanUi({ size: [800, 450], widgets: Array.from({ length: 100 }, () => ({ type: 'label' })) });
  assert.equal(ui.widgets.length, 60);
  assert.deepEqual(ui.size, [800, 450]);
  assert.ok(!('size' in cleanUi({ size: [1, 1], widgets: [] })));
  assert.deepEqual(cleanUi(undefined), { widgets: [] });
});

test('anchors pin a widget to a corner, an edge or the middle, pushed inward by x and y, at any screen size', () => {
  const at = (anchor, x = 0, y = 0, size = SIZE) => placeOf({ anchor, x, y, w: 100, h: 20 }, size);
  assert.deepEqual(at('top-left', 10, 5), { x: 10, y: 5, w: 100, h: 20 });
  assert.deepEqual(at('top-right', 10, 5), { x: 370, y: 5, w: 100, h: 20 });
  assert.deepEqual(at('bottom-left', 10, 5), { x: 10, y: 295, w: 100, h: 20 });
  assert.deepEqual(at('bottom-right', 10, 5), { x: 370, y: 295, w: 100, h: 20 });
  assert.deepEqual(at('center'), { x: 190, y: 150, w: 100, h: 20 });
  assert.deepEqual(at('top'), { x: 190, y: 0, w: 100, h: 20 });
  assert.deepEqual(at('left', 0, 0), { x: 0, y: 150, w: 100, h: 20 });
  assert.deepEqual(at('center', 7, -3), { x: 197, y: 147, w: 100, h: 20 });
  assert.deepEqual(at('top-right', 10, 5, { width: 800, height: 450 }), { x: 690, y: 5, w: 100, h: 20 }, 'a bigger screen: still 10 from the right edge');
  for (const a of ANCHORS) assert.ok(Number.isFinite(at(a).x));
});

test('changing the anchor keeps the widget where it is on screen', () => {
  for (const from of ANCHORS) {
    const widget = { anchor: from, x: 13, y: 7, w: 90, h: 30 };
    const before = placeOf(widget, SIZE);
    for (const to of ANCHORS) {
      const moved = { ...widget, anchor: to, ...offsetsFor(widget, to, SIZE) };
      const after = placeOf(moved, SIZE);
      assert.ok(Math.abs(after.x - before.x) <= 1 && Math.abs(after.y - before.y) <= 1, `${from} -> ${to}`);
    }
  }
});

test('text shows numbers of the game, nested ones, and leaves what it cannot find; @key uses the language table', () => {
  const game = { score: 120, player: { hp: 3.14159, name: 'Sam' } };
  assert.equal(textOf({ text: 'Score: {score}' }, game), 'Score: 120');
  assert.equal(textOf({ text: '{player.name} has {player.hp} hp' }, game), 'Sam has 3.14 hp');
  assert.equal(textOf({ text: 'Lives: {lives}' }, game), 'Lives: {lives}');
  assert.equal(textOf({ text: 'plain' }, undefined), 'plain');
  text({ en: { start: 'Start', hello: 'Hello, {score}!' }, fr: { start: 'Commencer' } }, 'fr');
  assert.equal(textOf({ text: '@start' }, game), 'Commencer');
  assert.equal(textOf({ text: '@hello' }, game), 'Hello, 120!', 'the game fills places in the words too');
  assert.equal(textOf({ text: '@nothing' }, game), '⟦nothing⟧');
  text({}, 'en');
});

test('a widget can show only when something is set (or not set)', () => {
  assert.ok(visible({}, {}));
  assert.ok(visible({ showIf: 'lives' }, { lives: 2 }) && !visible({ showIf: 'lives' }, { lives: 0 }) && !visible({ showIf: 'lives' }, {}));
  assert.ok(visible({ showIf: '!paused' }, {}) && !visible({ showIf: '!paused' }, { paused: true }));
  assert.ok(visible({ showIf: 'a.b' }, { a: { b: 1 } }) && !visible({ showIf: 'a.b' }, { a: null }));
  const ui = { widgets: [w({ id: 'x', showIf: 'on' }), w({ id: 'y' })] };
  assert.deepEqual(layoutUi(ui, { on: false }, { size: SIZE }).map((l) => l.widget.id), ['y']);
});

test('buttons: the top one under a point is hit, hidden ones are not, and keyboard focus goes round', () => {
  const ui = cleanUi({ widgets: [
    { type: 'button', id: 'play', anchor: 'center', x: 0, y: -30, w: 140, h: 36 },
    { type: 'button', id: 'quit', anchor: 'center', x: 0, y: 30, w: 140, h: 36 },
    { type: 'button', id: 'secret', anchor: 'center', x: 0, y: 100, w: 140, h: 36, showIf: 'unlocked' },
    { type: 'panel', id: 'frame', anchor: 'center', w: 400, h: 300 },
  ] });
  const opts = { size: SIZE };
  assert.equal(uiHit(ui, 240, 130, {}, opts), 'play');
  assert.equal(uiHit(ui, 240, 190, {}, opts), 'quit');
  assert.equal(uiHit(ui, 240, 260, {}, opts), null, 'the hidden button is not there');
  assert.equal(uiHit(ui, 240, 260, { unlocked: true }, opts), 'secret');
  assert.equal(uiHit(ui, 5, 5, {}, opts), null);
  assert.deepEqual(uiButtons(ui, {}), ['play', 'quit']);
  assert.equal(uiNext(ui, null, 1, {}), 'play');
  assert.equal(uiNext(ui, null, -1, {}), 'quit');
  assert.equal(uiNext(ui, 'play', 1, {}), 'quit');
  assert.equal(uiNext(ui, 'quit', 1, {}), 'play', 'round to the start');
  assert.equal(uiNext(ui, 'play', -1, {}), 'quit');
  assert.equal(uiNext({ widgets: [] }, null, 1), null);
});

test('drawing: panels, labels, buttons (lit when focused) and bars (low color near empty) all draw, in order, and nothing breaks without a game', () => {
  const ui = cleanUi({ widgets: [
    { type: 'panel', id: 'bg', w: 200, h: 100 },
    { type: 'label', id: 'score', text: 'Score: {score}', x: 8, y: 8 },
    { type: 'button', id: 'go', text: 'Go', x: 8, y: 40, w: 80, h: 30 },
    { type: 'bar', id: 'hp', value: 'hp', max: 10, x: 8, y: 80, w: 100, h: 12 },
  ] });
  const g = recorder();
  drawUi(g, ui, { score: 5, hp: 2 }, { focus: 'go', size: SIZE });
  const fills = g.log.filter((e) => e[0] === 'set:fillStyle').map((e) => e[1]);
  assert.ok(fills.includes('#6c63ff'), 'the focused button is lit');
  assert.ok(fills.includes('#e84a5f'), 'a nearly empty bar uses the low color');
  assert.ok(g.log.some((e) => e[0] === 'fillText' && e[1] === 'Score: 5'));
  assert.ok(g.log.some((e) => e[0] === 'fillText' && e[1] === 'Go'));
  const plain = recorder();
  drawUi(plain, ui, { score: 5, hp: 9 }, { size: SIZE });
  const plainFills = plain.log.filter((e) => e[0] === 'set:fillStyle').map((e) => e[1]);
  assert.ok(!plainFills.includes('#6c63ff') && plainFills.includes('#4ade80'), 'no focus: not lit; a healthy bar is green');
  assert.doesNotThrow(() => drawUi(recorder(), ui, undefined, { size: SIZE }));
  assert.doesNotThrow(() => drawUi(recorder(), undefined, {}, { size: SIZE }));
  assert.doesNotThrow(() => drawUi(recorder(), cleanUi({ widgets: [{ type: 'image', sprite: 'nope' }] }), {}, { size: SIZE, art: {} }));
});

test('the check finds duplicate ids, buttons with no id, widgets off the screen, words that will not fit and bars with nothing to show', () => {
  assert.deepEqual(uiProblems(cleanUi({ widgets: [w({ id: 'a', text: 'Hi', w: 80 })] }), SIZE), []);
  const bad = cleanUi({ widgets: [
    { type: 'label', id: 'a', text: 'Hi', w: 80 }, { type: 'label', id: 'a', text: 'Hi', w: 80 },
    { type: 'button', text: 'Play' },
    { type: 'label', id: 'far', x: 470, w: 100 },
    { type: 'label', id: 'long', text: 'A very long sentence indeed', size: 20, w: 100 },
  ] });
  bad.widgets.push({ type: 'bar', id: 'b', value: '', x: 0, y: 0, w: 10, h: 10, anchor: 'top-left' });
  const kinds = uiProblems(bad, SIZE).map((p) => p.kind).sort();
  assert.deepEqual(kinds, ['bar', 'button', 'fit', 'id', 'off']);
  assert.ok(uiProblems(bad, SIZE).every((p) => p.message.length > 15));
  assert.ok(uiProblems(cleanUi({ widgets: [w({ id: 'k', text: 'Score: {score} and more words', size: 30, w: 100 })] }), SIZE).every((p) => p.kind !== 'fit'), 'words with places are not guessed at');
});
