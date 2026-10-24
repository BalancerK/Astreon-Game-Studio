import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Ui, Widget, Panel, Label, Button, Toggle, Choice, Slider, TextInput, ScrollList, ProgressBar, Spacer, createRecordingPainter, naturalSize, rgba, hex, mix, withAlpha, unpack } from '../src/index.js';

const make = (o = {}) => new Ui({ painter: createRecordingPainter(), width: 800, height: 600, ...o });
const near = (a, b, eps = 0.51) => assert.ok(Math.abs(a - b) <= eps, `${a} is not within ${eps} of ${b}`);

test('colours pack like the renderer tints and convert back', () => {
  assert.equal(rgba(255, 0, 0), 0xff0000ff);
  assert.deepEqual(unpack(hex('#336699cc')), [0x33, 0x66, 0x99, 0xcc]);
  assert.deepEqual(unpack(hex('#fa0')), [0xff, 0xaa, 0x00, 255]);
  assert.deepEqual(unpack(withAlpha(hex('#ffffff'), 0.5)), [255, 255, 255, 128]);
  assert.deepEqual(unpack(mix(rgba(0, 0, 0), rgba(200, 100, 50), 0.5)), [100, 50, 25, 255]);
  assert.throws(() => hex('red'), /not a colour/);
});

test('layout: a column stacks children with gaps and padding; stretch fills the width', () => {
  const ui = make();
  const col = new Widget({ gap: 10, padding: 20, width: 300 });
  const a = new Widget({ height: 40 }), b = new Widget({ height: 60 });
  col.add(a, b);
  const layer = ui.push(col, { modal: false });
  near(col.w, 300); near(col.h, 20 + 40 + 10 + 60 + 20);
  near(a.x, col.x + 20); near(a.w, 260); near(b.y, a.y + 40 + 10);
  layer.close();
});

test('layout: rows share free space by grow, and justify places the rest', () => {
  const ui = make();
  const row = new Widget({ direction: 'row', gap: 10, width: 500, height: 50 });
  const fixed = new Widget({ width: 100 }), grow1 = new Widget({ grow: 1 }), grow3 = new Widget({ grow: 3 });
  row.add(fixed, grow1, grow3);
  ui.push(row, { modal: false });
  const free = 500 - 100 - 20; // two gaps
  near(grow1.w, free / 4); near(grow3.w, (free * 3) / 4);
  near(grow3.x + grow3.w, row.x + 500);
  const r2 = new Widget({ direction: 'row', width: 400, height: 30, justify: 'between' });
  const [p, q, s] = [new Widget({ width: 50 }), new Widget({ width: 50 }), new Widget({ width: 50 })];
  r2.add(p, q, s); ui.push(r2, { modal: false });
  near(p.x, r2.x); near(s.x + 50, r2.x + 400); near(q.x, r2.x + 175);
  const r3 = new Widget({ direction: 'row', width: 400, height: 30, justify: 'center' });
  const c = new Widget({ width: 100 }); r3.add(c); ui.push(r3, { modal: false });
  near(c.x, r3.x + 150);
});

test('layout: align centres on the cross axis; fill beats natural size; a hidden child takes no room', () => {
  const ui = make();
  const row = new Widget({ direction: 'row', align: 'center', width: 400, height: 100 });
  const a = new Widget({ width: 50, height: 20 }), hidden = new Widget({ width: 999, height: 999 }), b = new Widget({ width: 'fill', height: 40 });
  hidden.visible = false;
  row.add(a, hidden, b);
  ui.push(row, { modal: false });
  near(a.y, row.y + 40); near(b.y, row.y + 30); near(b.w, 350);
  assert.equal(hidden.w, 0);
});

test('layout: stack anchors children', () => {
  const ui = make();
  const root = ui.hud;
  const tl = new Widget({ width: 100, height: 40, anchor: 'top-left', offsetX: 5, offsetY: 6 });
  const br = new Widget({ width: 100, height: 40, anchor: 'bottom-right' });
  const mid = new Widget({ width: 100, height: 40, anchor: 'center' });
  const full = new Widget({});
  root.add(tl, br, mid, full);
  ui.update(0);
  near(tl.x, 5); near(tl.y, 6); near(br.x, 700); near(br.y, 560); near(mid.x, 350); near(mid.y, 280);
  near(full.w, 800); near(full.h, 600);
  assert.throws(() => { root.add(new Widget({ anchor: 'nowhere', width: 1, height: 1 })); ui.update(0); }, /unknown anchor/);
});

test('layout: text wraps to the width it is given, so a narrow label is taller', () => {
  const ui = make();
  const wide = new Label('the quick brown fox jumps over the lazy dog'), narrow = new Label('the quick brown fox jumps over the lazy dog');
  const a = naturalSize(ui, wide, 1000), b = naturalSize(ui, narrow, 150);
  assert.ok(b.h > a.h * 2, `${b.h} vs ${a.h}`);
  assert.ok(b.w <= 150);
});

test('layout: when content does not fit, fills give way first and the layout stays inside its box', () => {
  const ui = make();
  const row = new Widget({ direction: 'row', width: 300, height: 30, gap: 0 });
  const a = new Widget({ width: 200 }), b = new Widget({ width: 'fill', minWidth: 20 });
  row.add(a, b);
  ui.push(row, { modal: false });
  near(a.w, 200); near(b.w, 100);
  row.style.width = 150; row.invalidate(); ui.update(0);
  near(a.w, 200); near(b.w, 20);
});

test('a button is clicked by pressing and releasing on it, not by releasing elsewhere', () => {
  const ui = make();
  let clicks = 0;
  const b = new Button('Go', { onClick: () => clicks++, width: 100, height: 40 });
  const panel = new Widget({ padding: 0 }); panel.add(b);
  ui.push(panel, { modal: false });
  const cx = b.x + 50, cy = b.y + 20;
  ui.pointerMove(cx, cy);
  assert.ok(b.hovered);
  assert.equal(ui.pointerDown(cx, cy), true);
  assert.ok(b.pressed);
  assert.equal(ui.pointerUp(cx, cy), true);
  assert.equal(clicks, 1);
  ui.pointerDown(cx, cy); ui.pointerMove(cx + 300, cy + 300); ui.pointerUp(cx + 300, cy + 300);
  assert.equal(clicks, 1, 'released outside: no click');
  ui.pointerDown(cx, cy); ui.pointerCancel();
  assert.equal(clicks, 1, 'a cancelled touch: no click');
  b.enabled = false;
  ui.pointerDown(cx, cy); ui.pointerUp(cx, cy);
  assert.equal(clicks, 1, 'disabled');
});

test('pointer events the UI does not use are left to the game; a modal screen takes everything', () => {
  const ui = make();
  const b = new Button('x', { width: 100, height: 40, anchor: 'top-left' });
  ui.hud.add(b);
  ui.update(0);
  assert.equal(ui.pointerDown(400, 300), false, 'empty HUD space belongs to the game');
  assert.equal(ui.wantsPointer(400, 300), false);
  assert.equal(ui.wantsPointer(50, 20), true);
  const menu = new Panel({ width: 200 }); menu.add(new Button('ok'));
  ui.push(menu);
  assert.equal(ui.pointerDown(400, 300, 1), true);
  ui.pointerUp(400, 300, 1);
  assert.equal(ui.wantsPointer(750, 550), true, 'the dimmed backdrop swallows clicks');
});

test('screens: push, close, focus returns, onActiveChange fires on the first and last', () => {
  const ui = make();
  const log = [];
  ui.onActiveChange = (a) => log.push(a);
  const b0 = new Button('hud'); ui.hud.add(b0); ui.update(0); ui.setFocus(b0);
  const s1 = ui.push(new Panel({}).add(new Button('one')), { onClose: () => log.push('closed1') });
  const s2 = ui.push(new Panel({}).add(new Button('two')));
  assert.deepEqual(log, [true]);
  assert.equal(ui.screens.length, 2);
  s2.close();
  assert.equal(ui.isOpen, true);
  s1.close();
  assert.deepEqual(log, [true, 'closed1', false]);
  assert.equal(ui.focus, b0, 'focus goes back to what had it');
});

test('screens: Escape closes a dismissable screen unless onCancel refuses; a non-dismissable one stays', () => {
  const ui = make();
  let allow = false;
  ui.push(new Panel({}).add(new Button('a')), { onCancel: () => allow });
  assert.equal(ui.key('Escape'), true);
  assert.equal(ui.isOpen, true);
  allow = true;
  ui.key('Escape');
  assert.equal(ui.isOpen, false);
  ui.push(new Panel({}).add(new Button('a')), { dismissable: false });
  ui.key('Escape'); ui.cancel();
  assert.equal(ui.isOpen, true);
  assert.equal(ui.key('KeyW'), true, 'while a modal screen is open the UI keeps the keys');
  ui.closeAll();
  assert.equal(ui.key('KeyW'), false, 'and gives them back when it closes');
});

test('keyboard focus: Tab cycles, arrows move spatially, Enter and Space activate', () => {
  const ui = make();
  const hits = [];
  const grid = new Widget({ gap: 10, padding: 10 });
  const top = new Widget({ direction: 'row', gap: 10 }), bottom = new Widget({ direction: 'row', gap: 10 });
  const mk = (n) => new Button(n, { width: 100, height: 30, onClick: () => hits.push(n) });
  const [a, b, c, d] = ['a', 'b', 'c', 'd'].map(mk);
  top.add(a, b); bottom.add(c, d); grid.add(top, bottom);
  ui.push(grid);
  assert.equal(ui.focus, a);
  ui.key('Tab'); assert.equal(ui.focus, b);
  ui.key('Tab', { shift: true }); assert.equal(ui.focus, a);
  ui.key('ArrowRight'); assert.equal(ui.focus, b);
  ui.key('ArrowDown'); assert.equal(ui.focus, d);
  ui.key('ArrowLeft'); assert.equal(ui.focus, c);
  ui.key('ArrowUp'); assert.equal(ui.focus, a);
  ui.key('Enter'); ui.key('Space');
  assert.deepEqual(hits, ['a', 'a']);
  assert.equal(ui.focusVisible, true, 'keys show the focus ring');
  ui.pointerDown(d.x + 5, d.y + 5); ui.pointerUp(d.x + 5, d.y + 5);
  assert.equal(ui.focusVisible, false, 'the mouse hides it');
  assert.equal(ui.focus, d);
});

test('focus skips disabled and hidden widgets', () => {
  const ui = make();
  const col = new Widget({});
  const a = new Button('a'), b = new Button('b'), c = new Button('c');
  b.enabled = false;
  col.add(a, b, c);
  ui.push(col);
  ui.key('Tab'); assert.equal(ui.focus, c);
  c.setVisible(false); ui.update(0);
  ui.key('Tab'); assert.equal(ui.focus, a);
});

test('toggle and choice respond to click, keys and arrows', () => {
  const ui = make();
  const seen = [];
  const t = new Toggle('Shadows', false, (v) => seen.push(`t${v}`));
  const ch = new Choice('Quality', ['Low', 'Medium', 'High'], 1, (v, i) => seen.push(`c${v}${i}`));
  const col = new Widget({ width: 400 }); col.add(t, ch);
  ui.push(col);
  ui.pointerDown(t.x + 100, t.y + 10); ui.pointerUp(t.x + 100, t.y + 10);
  ui.key('ArrowRight'); // the toggle (focused) takes right = on, already on: no change
  ui.key('ArrowLeft');  // off
  assert.deepEqual(seen, ['ttrue', 'tfalse']);
  seen.length = 0;
  ui.setFocus(ch);
  ui.key('ArrowRight'); ui.key('ArrowRight'); ui.key('ArrowLeft');
  assert.deepEqual(seen, ['cHigh2', 'cLow0', 'cHigh2']);
  seen.length = 0;
  const a = ch.area();
  ui.pointerDown(a.x + 5, a.y + 10); ui.pointerUp(a.x + 5, a.y + 10);
  assert.deepEqual(seen, ['cMedium1'], 'the left arrow goes back');
  assert.equal(ch.value, 'Medium');
});

test('slider: drag sets the value snapped to the step; arrows and the wheel step; formatting', () => {
  const ui = make();
  const seen = [];
  const s = new Slider('Volume', { min: 0, max: 1, step: 0.1, value: 0.5, onChange: (v) => seen.push(v) });
  const col = new Widget({ width: 500 }); col.add(s);
  ui.push(col);
  const t = s.track();
  ui.pointerDown(t.x + t.w * 0.73, t.cy);
  assert.equal(s.value, 0.7);
  ui.pointerMove(t.x + t.w * 2, t.cy);
  assert.equal(s.value, 1, 'dragging past the end clamps');
  ui.pointerMove(t.x - 50, t.cy);
  assert.equal(s.value, 0);
  ui.pointerUp(t.x, t.cy);
  s.set(0.5, false);
  ui.key('ArrowRight'); ui.key('ArrowRight'); ui.key('ArrowLeft');
  assert.equal(s.value, 0.6);
  ui.wheel(t.x + 10, t.cy, -100); // wheel up raises
  assert.equal(s.value, 0.7);
  assert.equal(s.format(0.7), '70%');
  const n = new Slider('Count', { min: 1, max: 10, step: 1, value: 3 });
  assert.equal(n.format(3), '3');
  s.value = 0.25; // assigning does not notify
  const before = seen.length;
  s.value = 0.35;
  assert.equal(seen.length, before);
});

test('text input: typing, caret movement, selection, delete, word moves, limits and filters', () => {
  const ui = make();
  const changes = [];
  const submitted = [];
  const t = new TextInput({ onChange: (v) => changes.push(v), onSubmit: (v) => submitted.push(v), maxLength: 12 });
  const col = new Widget({ width: 300 }); col.add(t);
  ui.push(col);
  ui.setFocus(t);
  assert.equal(ui.insertText('hello world'), true);
  assert.equal(t.value, 'hello world');
  ui.key('Home'); ui.key('Delete');
  assert.equal(t.value, 'ello world');
  ui.key('End'); ui.key('Backspace');
  assert.equal(t.value, 'ello worl');
  ui.key('ArrowLeft', { ctrl: true }); // word left
  assert.equal(t.caret, 5);
  ui.key('ArrowRight', { shift: true }); ui.key('ArrowRight', { shift: true });
  assert.equal(t.selection, 'wo');
  ui.insertText('XY');
  assert.equal(t.value, 'ello XYrl');
  ui.key('KeyA', { ctrl: true });
  assert.equal(t.selection, 'ello XYrl');
  ui.insertText('abc');
  assert.equal(t.value, 'abc');
  ui.insertText('1234567890123');
  assert.equal(t.value.length, 12, 'maxLength');
  ui.key('Enter');
  assert.deepEqual(submitted, [t.value]);
  assert.ok(changes.length >= 6);
  const digits = new TextInput({ filter: /[0-9]/ });
  digits.insert('a1b2c3'); assert.equal(digits.value, '123');
  const one = new TextInput({}); one.insert('line one\nline two'); assert.equal(one.value, 'line one line two', 'new lines become spaces');
});

test('text input: Space types a space (it is not a button press), Escape leaves the field, then closes the screen', () => {
  const ui = make();
  const t = new TextInput({}), b = new Button('b');
  const col = new Widget({ width: 300 }); col.add(t, b);
  ui.push(col);
  ui.setFocus(t);
  assert.equal(ui.key('Space'), true);
  assert.equal(t.value, '', 'the typed space arrives through text(), not key()');
  ui.insertText(' ');
  assert.equal(t.value, ' ');
  ui.key('Escape');
  assert.equal(ui.focus, null);
  assert.equal(ui.isOpen, true);
  ui.key('Escape');
  assert.equal(ui.isOpen, false);
});

test('text input: clicking puts the caret between letters and dragging selects; onTextTarget follows focus', () => {
  const ui = make();
  const targets = [];
  ui.onTextTarget = (w) => targets.push(w);
  const t = new TextInput({ value: 'abcdef', width: 300 }), b = new Button('b');
  const col = new Widget({ width: 300 }); col.add(t, b);
  ui.push(col, { focus: b });
  const left = t.x + t.pad.l, ch = 9; // the recording painter: 15 px * 0.6 per character
  ui.pointerDown(left + ch * 2 + 1, t.y + 10);
  assert.equal(t.caret, 2);
  ui.pointerMove(left + ch * 5 + 1, t.y + 10);
  assert.equal(t.selection, 'cde');
  ui.pointerUp(left, t.y);
  assert.deepEqual(targets, [t]);
  ui.pointerDown(b.x + 5, b.y + 5); ui.pointerUp(b.x + 5, b.y + 5);
  assert.deepEqual(targets, [t, null]);
});

test('text input scrolls its view so the caret stays visible, and draws only what fits', () => {
  const ui = make();
  const t = new TextInput({ value: 'x'.repeat(100), width: 150 });
  const col = new Widget({ width: 150 }); col.add(t);
  ui.push(col); ui.setFocus(t);
  const p = ui.painter;
  ui.draw();
  const drawn = p.commands.filter((c) => c.kind === 'text').map((c) => c.text).join('');
  assert.ok(drawn.length > 5 && drawn.length < 20, `drew ${drawn.length} characters`);
  t.select(0, 0); t.first = 0;
  ui.draw();
  assert.ok(p.commands.some((c) => c.kind === 'text' && c.text.startsWith('xxx')));
  const pw = new TextInput({ value: 'secret', password: true });
  col.add(pw); ui.update(0); ui.draw();
  assert.ok(p.texts().includes('•'.repeat(6)) && !p.texts().includes('secret'));
});

test('a scroll list selects rows, scrolls by whole rows, activates on a second click or Enter, and drags like a touch list', () => {
  const ui = make();
  const picked = [], activated = [];
  const items = Array.from({ length: 12 }, (_, i) => ({ text: `room ${i}`, value: i }));
  const list = new ScrollList({ items, rows: 4, width: 300, onSelect: (it) => picked.push(it.value), onActivate: (it) => activated.push(it.value) });
  const col = new Widget({}); col.add(list);
  ui.push(col);
  const rh = list.rowHeight(ui);
  ui.pointerDown(list.x + 20, list.y + rh * 2 + 5); ui.pointerUp(list.x + 20, list.y + rh * 2 + 5);
  assert.deepEqual(picked, [2]);
  ui.update(0.1);
  ui.pointerDown(list.x + 20, list.y + rh * 2 + 5); ui.pointerUp(list.x + 20, list.y + rh * 2 + 5);
  assert.deepEqual(activated, [2], 'a quick second click opens');
  ui.setFocus(list);
  for (let i = 0; i < 6; i++) ui.key('ArrowDown');
  assert.equal(list.selected, 8);
  assert.ok(list.top > 0 && list.selected < list.top + 4, 'the selection scrolled into view');
  ui.key('Enter');
  assert.deepEqual(activated, [2, 8]);
  ui.wheel(list.x + 5, list.y + 5, 100); // one row down
  const top = list.top;
  ui.wheel(list.x + 5, list.y + 5, -100);
  assert.equal(list.top, top - 1);
  const t0 = list.top;
  ui.pointerDown(list.x + 20, list.y + 3 * rh, 7, 'touch');
  ui.pointerMove(list.x + 20, list.y + 1 * rh, 7);
  ui.pointerUp(list.x + 20, list.y + 1 * rh, 7);
  assert.equal(list.top, t0 + 2, 'dragging up scrolls down, and is not a click');
  assert.equal(list.selected, 8);
  list.setItems([]);
  assert.equal(list.selectedItem, null);
  ui.draw();
  assert.ok(ui.painter.texts().includes('Nothing here yet'));
});

test('touch: one finger at a time; a touch release clears hover', () => {
  const ui = make();
  let clicks = 0;
  const a = new Button('a', { width: 100, height: 40, onClick: () => clicks++ }), b = new Button('b', { width: 100, height: 40, onClick: () => clicks += 10 });
  const col = new Widget({}); col.add(a, b);
  ui.push(col);
  ui.pointerDown(a.x + 5, a.y + 5, 1, 'touch');
  ui.pointerDown(b.x + 5, b.y + 5, 2, 'touch'); // second finger: ignored
  ui.pointerUp(b.x + 5, b.y + 5, 2);
  assert.equal(clicks, 0);
  ui.pointerUp(a.x + 5, a.y + 5, 1);
  assert.equal(clicks, 1);
  assert.equal(a.hovered, false);
});

test('scale: sizes are logical, the painter gets screen pixels, pointers are divided by the scale', () => {
  const ui = make({ scale: 2, width: 800, height: 600 });
  assert.equal(ui.logicalWidth, 400);
  let clicks = 0;
  const b = new Button('Go', { width: 100, height: 40, anchor: 'top-left', onClick: () => clicks++ });
  ui.hud.add(b); ui.update(0); ui.draw();
  const r = ui.painter.commands.find((c) => c.kind === 'rect' && c.w === 200);
  assert.ok(r && r.h === 80, 'the 100x40 button is drawn at 200x80 pixels');
  const t = ui.painter.commands.find((c) => c.kind === 'text');
  assert.equal(t.size, 30, 'text is doubled too');
  ui.pointerDown(150, 50); ui.pointerUp(150, 50);
  assert.equal(clicks, 1, '(150, 50) pixels is (75, 25) logical, inside the button');
  ui.pointerDown(250, 50); ui.pointerUp(250, 50);
  assert.equal(clicks, 1);
});

test('safe-area insets keep the layout away from notches', () => {
  const ui = make();
  ui.setViewport(800, 600, 1, { top: 30, left: 40 });
  const b = new Widget({ width: 100, height: 50, anchor: 'top-left' });
  ui.hud.add(b); ui.update(0);
  near(b.x, 40); near(b.y, 30);
});

test('progress bars, labels and spacers draw; a themed colour reaches the painter', () => {
  const ui = make();
  const col = new Panel({ width: 300 });
  const lbl = new Label('Health');
  col.add(lbl, new ProgressBar(0.5, { label: '50' }), new Spacer(10));
  ui.push(col, { modal: false });
  lbl.text = 'Health!';
  ui.update(0); ui.draw();
  assert.ok(ui.painter.texts().includes('Health!') && ui.painter.texts().includes('50'));
  assert.equal(ui.painter.commands.filter((c) => c.kind === 'rect' && c.color === ui.theme.colors.good).length, 0, 'half full is between red and green, not green');
});

test('changing label text re-lays out the tree', () => {
  const ui = make();
  const col = new Widget({}); const l = new Label('a', { wrap: false }); col.add(l);
  ui.push(col, { modal: false });
  const w0 = l.w;
  l.text = 'a much longer piece of text';
  ui.update(0);
  assert.ok(l.w > w0 * 5);
});

test("layout: children that fill share the room equally, whatever their content", () => {
  const ui = make();
  const row = new Widget({ direction: 'row', width: 400, height: 30, gap: 10 });
  const a = new Button('a short one', { width: 'fill' }), b = new Button('a much much longer caption', { width: 'fill' }), c = new Widget({ width: 100 });
  row.add(c, a, b);
  ui.push(row, { modal: false });
  near(a.w, 140); near(b.w, 140);
  near(b.x + b.w, row.x + 400);
});

import { createSpritePainter, createCanvasPainter } from '../src/index.js';

test('the sprite painter draws rectangles as non-overlapping pieces of a solid sprite, and text through the font', () => {
  const pushed = [], drawn = [];
  const batch = { push: (...a) => pushed.push(a) };
  const dot = { u0: 0, v0: 0, u1: 8, v1: 8, page: 2 };
  const font = { draw: (b, text, x, y, o) => drawn.push({ text, x, y, ...o }), measure: (text, o) => ({ width: text.length * 7, height: 18 }) };
  const p = createSpritePainter({ batch, dot, font });
  p.rect(10, 20, 100, 40, 0xffffffff, 0);
  assert.equal(pushed.length, 1);
  assert.deepEqual(pushed[0].slice(0, 4), [60, 40, 100, 40]);
  assert.equal(pushed[0][5].u0, 4); assert.equal(pushed[0][5].u1, 4); assert.equal(pushed[0][5].page, 2, 'every sample reads the centre texel of the same page');
  pushed.length = 0;
  p.rect(0, 0, 100, 40, 0x80ffffff, 3);
  const area = pushed.reduce((s, a) => s + a[2] * a[3], 0);
  assert.equal(area, 100 * 40 - 4 * 2 * 2, 'a rounded rectangle is the box minus its four corners, nothing drawn twice');
  p.text('hi', 5, 6, { size: 15, color: 7, align: 'center', maxWidth: 50, shadow: true });
  assert.equal(drawn[0].text, 'hi'); assert.equal(drawn[0].tint, 7); assert.deepEqual(drawn[0].shadow, { dx: 1, dy: 1 });
  assert.deepEqual(p.measure('abc', { size: 15 }), { width: 21, height: 18 });
  assert.throws(() => createSpritePainter({ batch, dot }), /font/);
});

test('the canvas painter fills, wraps and draws text on a 2D context', () => {
  const calls = [];
  const ctx = new Proxy({ font: '', measureText: (t) => ({ width: t.length * 8 }), fillRect: (...a) => calls.push(['fillRect', ...a]), fillText: (...a) => calls.push(['fillText', ...a]), beginPath() {}, fill() {}, roundRect: (...a) => calls.push(['roundRect', ...a]) }, { set: (o, k, v) => { o[k] = v; return true; } });
  const p = createCanvasPainter(ctx);
  p.rect(1, 2, 3, 4, 0xff0000ff, 0);
  assert.equal(calls[0][0], 'fillRect'); assert.equal(ctx.fillStyle, 'rgba(255,0,0,1.000)');
  p.rect(1, 2, 30, 40, 0xff0000ff, 3);
  assert.equal(calls[1][0], 'roundRect');
  p.text('one two three four', 0, 0, { size: 10, color: 0xffffffff, maxWidth: 80 });
  assert.deepEqual(calls.filter((c) => c[0] === 'fillText').map((c) => c[1]), ['one two', 'three four']);
  const m = p.measure('one two three four', { size: 10, maxWidth: 80 });
  assert.equal(m.height, 2 * 13);
});
