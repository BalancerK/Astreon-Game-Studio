import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as U from '../app/paint/ui-model.js';
import { placeOf, layoutUi, uiHit } from '../../packages/arcade/src/ui.js';

const screen = () => U.STARTERS.menu();
const SIZE = { width: 480, height: 320 };

test('every starter screen is clean by the kit\'s check and fits the screen', () => {
  for (const [name, make] of Object.entries(U.STARTERS)) {
    const s = make();
    assert.deepEqual(U.uiProblems(s, SIZE), [], name);
    assert.ok(s.widgets.length >= 3);
    assert.deepEqual(U.cleanUi(s), s, `${name}: already clean`);
  }
});

test('the menu starter has buttons that can be hit where they are drawn', () => {
  const s = U.STARTERS.menu();
  for (const w of s.widgets.filter((x) => x.type === 'button')) {
    const b = placeOf(w, SIZE);
    assert.equal(uiHit(s, b.x + b.w / 2, b.y + b.h / 2, {}, { size: SIZE }), w.id);
  }
});

test('a UI file is saved and read back exactly, cleaned on reading, and a damaged one is explained', () => {
  const screens = { hud: U.STARTERS.hud(), menu: U.setSize(U.STARTERS.menu(), 800, 450) };
  const text = U.serializeUi(screens);
  assert.match(text, /^\/\/ Made with the studio/);
  assert.deepEqual(U.parseUi(text), screens);
  assert.throws(() => U.parseUi('x'), /not a set of screens/);
  assert.throws(() => U.parseUi('export default { nope };'), /plain JSON/);
  assert.throws(() => U.parseUi('export default { "a b": { "widgets": [] } };'), /not usable/);
  assert.throws(() => U.parseUi('export default { "a": {} };'), /not usable/);
  const loose = U.parseUi('export default { "a": { "widgets": [{ "type": "label", "x": 1e12 }, { "type": "bogus" }] } };');
  assert.equal(loose.a.widgets.length, 1);
  assert.equal(loose.a.widgets[0].x, 2000);
});

test('widgets are added in the middle with their own id, changed within range, copied, ordered and removed', () => {
  let s = U.STARTERS.hud();
  let made = U.addWidget(s, 'button');
  s = made.screen;
  assert.equal(s.widgets[made.index].id, 'button');
  assert.equal(s.widgets[made.index].anchor, 'center');
  made = U.addWidget(s, 'button');
  assert.equal(made.screen.widgets[made.index].id, 'button2');
  s = made.screen;
  s = U.updateWidget(s, made.index, { w: 99999, text: 'Go', color: 'nope' });
  assert.equal(s.widgets[made.index].w, 2000);
  assert.equal(s.widgets[made.index].color, '#ffffff');
  assert.equal(s.widgets[made.index].text, 'Go');
  const dup = U.duplicateWidget(s, made.index);
  assert.equal(dup.screen.widgets[dup.index].id, 'button3');
  assert.equal(dup.screen.widgets[dup.index].x, s.widgets[made.index].x + 12);
  const ordered = U.moveWidgetOrder(dup.screen, dup.index, -1);
  assert.equal(ordered.index, dup.index - 1);
  assert.equal(U.moveWidgetOrder(s, 0, -1).screen, s, 'cannot go below the bottom');
  const n = s.widgets.length;
  assert.equal(U.removeWidget(s, 0).widgets.length, n - 1);
  let full = { widgets: [] };
  for (let i = 0; i < 60; i++) full = U.addWidget(full, 'label').screen;
  assert.throws(() => U.addWidget(full, 'label'), /At most 60/);
});

test('dragging puts the top-left corner where you drop it, whatever the widget is pinned to, with a grid if asked', () => {
  for (const anchor of U.ANCHORS) {
    let s = { widgets: [U.cleanWidget({ type: 'panel', id: 'p', anchor, w: 100, h: 40 })] };
    s = U.moveWidgetTo(s, 0, 123, 77);
    const b = placeOf(s.widgets[0], SIZE);
    assert.deepEqual([b.x, b.y], [123, 77], anchor);
  }
  let s = { widgets: [U.cleanWidget({ type: 'panel', id: 'p', anchor: 'bottom-right', w: 100, h: 40 })] };
  s = U.moveWidgetTo(s, 0, 123, 77, 10);
  const b = placeOf(s.widgets[0], SIZE);
  assert.deepEqual([b.x, b.y], [120, 80], 'snapped to a grid of 10');
  s = U.moveWidgetTo(s, 0, 7, 7, 8);
  assert.deepEqual([placeOf(s.widgets[0], SIZE).x, placeOf(s.widgets[0], SIZE).y], [8, 8]);
});

test('arrow-key nudges move a widget on screen in the direction pressed, even when it is pinned to the right or bottom', () => {
  for (const anchor of ['top-left', 'bottom-right', 'center']) {
    let s = { widgets: [U.cleanWidget({ type: 'panel', id: 'p', anchor, x: 20, y: 20, w: 100, h: 40 })] };
    const before = placeOf(s.widgets[0], SIZE);
    s = U.nudgeWidget(s, 0, 5, -3);
    const after = placeOf(s.widgets[0], SIZE);
    assert.deepEqual([after.x - before.x, after.y - before.y], [5, -3], anchor);
  }
});

test('resizing by the corner keeps the top-left corner still on screen, whatever the anchor, and never makes a widget smaller than 4', () => {
  for (const anchor of U.ANCHORS) {
    let s = { widgets: [U.cleanWidget({ type: 'panel', id: 'p', anchor, x: 10, y: 10, w: 100, h: 40 })] };
    const before = placeOf(s.widgets[0], SIZE);
    s = U.resizeWidgetTo(s, 0, before.x + 150, before.y + 70);
    const after = placeOf(s.widgets[0], SIZE);
    assert.deepEqual([after.x, after.y, after.w, after.h], [before.x, before.y, 150, 70], anchor);
  }
  let s = { widgets: [U.cleanWidget({ type: 'panel', id: 'p', w: 100, h: 40 })] };
  s = U.resizeWidgetTo(s, 0, -50, -50);
  assert.deepEqual([s.widgets[0].w, s.widgets[0].h], [4, 4]);
});

test('changing the anchor does not make a widget jump; changing the screen size keeps pinned widgets pinned', () => {
  let s = { widgets: [U.cleanWidget({ type: 'label', id: 't', anchor: 'top-left', x: 30, y: 14, w: 100, h: 24 })] };
  const before = placeOf(s.widgets[0], SIZE);
  for (const a of U.ANCHORS) {
    const moved = U.setAnchor(s, 0, a);
    const after = placeOf(moved.widgets[0], SIZE);
    assert.ok(Math.abs(after.x - before.x) <= 1 && Math.abs(after.y - before.y) <= 1, a);
    assert.equal(moved.widgets[0].anchor, a);
  }
  s = U.setAnchor(s, 0, 'top-right');
  const big = U.setSize(s, 800, 450);
  assert.deepEqual(big.size, [800, 450]);
  const r = placeOf(big.widgets[0], U.sizeOf(big));
  assert.equal(r.x + r.w, 800 - (480 - (before.x + before.w)), 'still the same distance from the right edge');
});

test('the numbers a screen shows are found, and a pretend game gives each one a value that can be overridden', () => {
  const hud = U.STARTERS.hud();
  assert.deepEqual(U.pathsOf(hud).sort(), ['hp', 'lives', 'score']);
  const game = U.sampleGame(hud);
  assert.equal(game.score, 120);
  assert.equal(game.hp, 7);
  assert.equal(game.lives, 7);
  assert.equal(U.sampleGame(hud, { score: 5 }).score, 5);
  const s = { widgets: [
    U.cleanWidget({ type: 'bar', id: 'b', value: 'player.hp', max: 'player.maxHp' }),
    U.cleanWidget({ type: 'label', id: 'l', text: 'Hi {a.b.c}', showIf: '!paused' }), U.cleanWidget({ type: 'label', id: 'k', text: '@start' }),
  ] };
  assert.deepEqual(U.pathsOf(s).sort(), ['a.b.c', 'paused', 'player.hp', 'player.maxHp']);
  const nested = U.sampleGame(s);
  assert.equal(nested.player.maxHp, 10);
  assert.equal(nested.a.b.c, 120);
  assert.equal(layoutUi(s, nested, { size: SIZE }).length, 3);
});

test('names and ids: free ones are found, bad ones explained', () => {
  assert.equal(U.freeName({ hud: 1 }, 'hud'), 'hud2');
  assert.match(U.nameProblem('1x', () => false), /Use letters/);
  assert.match(U.nameProblem('hud', (n) => n === 'hud'), /already/);
  assert.equal(U.freeId({ widgets: [{ id: 'a' }, { id: 'a2' }] }, 'a'), 'a3');
});
