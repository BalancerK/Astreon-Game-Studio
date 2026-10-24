import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Ui, Button, Toggle, Slider, createRecordingPainter, menuScreen, confirmDialog, settingsScreen, bindingRows, roomBrowser, menuActions, createMenuPump, Label } from '../src/index.js';
import { InputCore } from '../../input/src/index.js';

const make = () => new Ui({ painter: createRecordingPainter(), width: 1000, height: 800 });
const buttons = (w) => { const out = []; w.walk((x) => { if (x instanceof Button) out.push(x); }); return out; };
const byText = (w, t) => buttons(w).find((b) => b.text === t);
const click = (ui, w) => { ui.pointerDown(w.x + w.w / 2, w.y + w.h / 2); ui.pointerUp(w.x + w.w / 2, w.y + w.h / 2); };

test('menuScreen builds a titled column of buttons that work by click and by keyboard', () => {
  const ui = make();
  const log = [];
  const menu = menuScreen(ui, { title: 'Paused', items: [{ text: 'Resume', variant: 'primary', onClick: () => log.push('resume') }, { text: 'Quit', variant: 'danger', onClick: () => log.push('quit') }, { text: 'Disabled', onClick: () => log.push('x'), enabled: false }] });
  ui.push(menu);
  ui.draw();
  assert.ok(ui.painter.texts().includes('Paused'));
  assert.equal(ui.focus, byText(menu, 'Resume'));
  ui.key('Enter');
  ui.key('ArrowDown'); ui.key('Enter');
  ui.key('ArrowDown'); ui.key('Enter'); // disabled buttons are skipped, so this stays on Quit
  click(ui, byText(menu, 'Disabled'));
  assert.deepEqual(log, ['resume', 'quit', 'quit']);
});

test('confirmDialog answers true or false and closes; focus starts on Cancel so Enter is the safe answer', () => {
  const ui = make();
  const answers = [];
  const d = confirmDialog(ui, { title: 'Quit?', message: 'You will lose progress.', confirm: 'Quit', danger: true, onAnswer: (v) => answers.push(v) });
  ui.push(d);
  assert.equal(ui.focus.text, 'Cancel');
  ui.key('Enter');
  assert.deepEqual(answers, [false]);
  assert.equal(ui.isOpen, false);
  ui.push(confirmDialog(ui, { onAnswer: (v) => answers.push(v) }));
  click(ui, byText(ui.screens[0].widget, 'OK'));
  assert.deepEqual(answers, [false, true]);
});

const actions = () => ({
  jump: { type: 'button', bindings: [{ type: 'key', code: 'Space' }, { type: 'gamepadButton', button: 'south' }] },
  fire: { type: 'button', bindings: [{ type: 'key', code: 'KeyF' }, { type: 'gamepadButton', button: 'rightTrigger' }] },
  crouch: { type: 'button', bindings: [{ type: 'key', code: 'KeyC' }] },
});

test('binding rows show the current controls and rebind from the next key press', () => {
  const ui = make(), input = new InputCore({ actions: actions() });
  const status = new Label('');
  let changes = 0;
  const set = bindingRows(ui, { input, actions: [{ action: 'jump', label: 'Jump' }, { action: 'fire', label: 'Fire' }, { action: 'crouch', label: 'Crouch' }], status, onChange: () => changes++ });
  const shown = set.rows.map((r) => r.children.filter((c) => c instanceof Button).map((b) => b.text));
  assert.ok(shown.every((r) => r.length === 2), 'one keyboard and one gamepad button per row');
  assert.equal(shown[0][0], 'Space');
  assert.equal(shown[2][1], '-', 'no gamepad control yet');
  const jumpKey = set.rows[0].children[1];
  jumpKey.onClick(jumpKey);
  assert.equal(jumpKey.text, 'Press a control...');
  assert.equal(ui.captureKeys, true);
  assert.equal(ui.key('KeyJ'), false, 'while waiting, the UI does not take keys');
  input.keyDown('KeyJ');
  assert.equal(ui.captureKeys, false);
  assert.deepEqual(input.bindings('jump')[0], { type: 'key', code: 'KeyJ' });
  assert.equal(jumpKey.text, 'J');
  assert.equal(changes, 1);
  assert.equal(status.text, '');
});

test('binding rows: a control used elsewhere is taken over and the screen says who lost it; Escape cancels; a pad button is added when there was none', () => {
  const ui = make(), input = new InputCore({ actions: actions() });
  const status = new Label('');
  const set = bindingRows(ui, { input, actions: [{ action: 'jump', label: 'Jump' }, { action: 'fire', label: 'Fire' }, { action: 'crouch', label: 'Crouch' }], status });
  const jumpKey = set.rows[0].children[1];
  jumpKey.onClick(jumpKey);
  input.keyDown('KeyF'); // fire's key
  assert.deepEqual(input.bindings('jump')[0], { type: 'key', code: 'KeyF' });
  assert.deepEqual(input.bindings('fire').map((b) => b.type), ['gamepadButton'], 'fire lost its key');
  assert.match(status.text, /Fire no longer uses that control/);
  const fireKey = set.rows[1].children[1];
  assert.equal(fireKey.text, '-');
  fireKey.onClick(fireKey);
  input.keyDown('Escape');
  assert.equal(fireKey.text, '-');
  assert.equal(ui.captureKeys, false);
  const crouchPad = set.rows[2].children[2];
  crouchPad.onClick(crouchPad);
  input.gamepadProvider = null;
  input.capture('gamepad', { type: 'gamepadButton', button: 'east' }); // what pressing B would do
  assert.deepEqual(input.bindings('crouch').map((b) => b.type), ['key', 'gamepadButton']);
  assert.equal(crouchPad.text, 'Gamepad B');
  set.reset();
  assert.deepEqual(input.bindings('jump')[0], { type: 'key', code: 'Space' });
  assert.deepEqual(input.bindings('fire')[0], { type: 'key', code: 'KeyF' });
});

test('a mouse click while waiting for a control cancels the wait but still clicks what it hit', () => {
  const ui = make(), input = new InputCore({ actions: actions() });
  const status = new Label('');
  const set = bindingRows(ui, { input, actions: [{ action: 'jump', label: 'Jump' }], status });
  const panel = menuScreen(ui, { items: [{ text: 'x', onClick() {} }] });
  panel.add(...set.rows);
  ui.push(panel);
  const k = set.rows[0].children[1];
  click(ui, k);
  assert.equal(ui.captureKeys, true);
  const other = byText(panel, 'x');
  click(ui, other);
  assert.equal(ui.captureKeys, false);
  assert.equal(k.text, 'Space');
  assert.equal(input.capture, null, 'the input layer stopped listening');
});

test('settings screen: tabs, sliders, toggles, choices; values are read from the game and written back', () => {
  const ui = make(), input = new InputCore({ actions: actions() });
  const state = { master: 0.8, shadows: true, quality: 'high', name: 'Ann', saved: 0 };
  const closed = [];
  const s = settingsScreen(ui, {
    title: 'Settings', onClose: () => closed.push(true),
    tabs: [
      { title: 'Audio', rows: [{ type: 'slider', label: 'Master', get: () => state.master, set: (v) => { state.master = v; } }, { type: 'toggle', label: 'Muted', get: () => false, set() {} }] },
      { title: 'Graphics', rows: [{ type: 'toggle', label: 'Shadows', get: () => state.shadows, set: (v) => { state.shadows = v; } }, { type: 'choice', label: 'Quality', options: ['low', 'medium', 'high'], get: () => state.quality, set: (v) => { state.quality = v; } }, { type: 'text', label: 'Name', get: () => state.name, set: (v) => { state.name = v; }, maxLength: 8 }] },
      { title: 'Controls', rows: [{ type: 'bindings', input, actions: [{ action: 'jump', label: 'Jump' }], onChange: () => { state.saved++; } }, { type: 'label', text: 'Escape cancels.' }] },
    ],
  });
  ui.push(s);
  assert.equal(s.tab, 0);
  const slider = (() => { let f; s.walk((w) => { if (w instanceof Slider) f = w; }); return f; })();
  assert.equal(slider.value, 0.8);
  slider.set(0.3);
  assert.equal(state.master, 0.3);
  const h0 = s.h;
  s.nextTab();
  ui.update(0);
  assert.equal(s.tab, 1);
  assert.equal(s.h, h0, 'the panel keeps one size across tabs');
  let toggle; s.walk((w) => { if (w instanceof Toggle && w.label === 'Shadows') toggle = w; });
  assert.equal(toggle.value, true);
  click(ui, toggle);
  assert.equal(state.shadows, false);
  const quality = (() => { let f; s.walk((w) => { if (w.label === 'Quality') f = w; }); return f; })();
  assert.equal(quality.value, 'high');
  quality.select(0);
  assert.equal(state.quality, 'low');
  ui.setFocus(null);
  const field = (() => { let f; s.walk((w) => { if (w.isText) f = w; }); return f; })();
  click(ui, field);
  assert.equal(ui.focus, field);
  field.select(0, 3);
  ui.insertText('Bob');
  assert.equal(state.name, 'Bob');
  s.nextTab();
  ui.update(0);
  const keyBtn = buttons(s).find((b) => b.text === 'Space');
  keyBtn.onClick(keyBtn);
  input.keyDown('KeyZ');
  assert.equal(state.saved, 1);
  s.nextTab(); // wraps to Audio
  assert.equal(s.tab, 0);
  s.prevTab();
  assert.equal(s.tab, 2);
  click(ui, byText(s, 'Back'));
  assert.equal(ui.isOpen, false);
  assert.deepEqual(closed, [true]);
});

test('leaving a tab while waiting for a control stops the wait', () => {
  const ui = make(), input = new InputCore({ actions: actions() });
  const s = settingsScreen(ui, { tabs: [{ title: 'Controls', rows: [{ type: 'bindings', input, actions: [{ action: 'jump', label: 'Jump' }] }] }, { title: 'Other', rows: [{ type: 'label', text: 'hi' }] }] });
  ui.push(s);
  const k = buttons(s).find((b) => b.text === 'Space');
  k.onClick(k);
  assert.equal(ui.captureKeys, true);
  s.nextTab();
  assert.equal(ui.captureKeys, false);
  assert.equal(input.capture, null);
});

test('an unknown settings row type is a clear error', () => {
  assert.throws(() => settingsScreen(make(), { tabs: [{ title: 't', rows: [{ type: 'dial' }] }] }), /unknown settings row type "dial"/);
});

test('room browser: lists rooms, joins the selected one or a typed name, validates names, reports failures', async () => {
  const ui = make();
  let rooms = [{ name: 'alpha', players: 3, max: 32 }, { name: 'beta', players: 0, max: 32 }];
  const joined = [], names = [];
  const rb = roomBrowser(ui, { name: 'Ann', fetchRooms: async () => rooms, onJoin: (r, n) => joined.push([r, n]), onName: (n) => names.push(n) });
  ui.push(rb);
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(rb.list.items.length, 2);
  assert.equal(rb.list.items[0].detail, '3 / 32 players');
  const join = byText(rb, 'Join alpha');
  assert.ok(join, 'the button names the selected room');
  click(ui, join);
  assert.deepEqual(joined, [['alpha', 'Ann']]);
  assert.equal(ui.isOpen, false);

  ui.push(rb);
  rb.roomInput.set('Bad Room!', false); // the filter drops the space and the bang
  assert.equal(rb.roomInput.value, 'BadRoom');
  rb.roomInput.onChange('BadRoom');
  assert.ok(byText(rb, 'Join badroom'), 'room names are lower case');
  rb.roomInput.set('x'.repeat(24), true);
  assert.equal(byText(rb, 'Join ' + 'x'.repeat(24)).enabled, true);
  rb.roomInput.set('a'.repeat(30), true); // the field keeps 24 characters
  assert.equal(rb.roomInput.value.length, 24);
  rb.nameInput.set('Zed', true);
  assert.deepEqual(names, ['Zed']);
  rb.roomInput.set('gamma', true);
  ui.setFocus(rb.roomInput);
  ui.key('Enter');
  assert.deepEqual(joined.at(-1), ['gamma', 'Zed']);

  rooms = null; // the fetch fails
  ui.push(rb);
  await rb.refresh();
  ui.draw();
  assert.ok(ui.painter.texts().some((t) => /Could not load rooms/.test(t)));
});

test('room browser: an empty server says how to start a room', async () => {
  const ui = make();
  const rb = roomBrowser(ui, { fetchRooms: async () => [], onJoin() {} });
  ui.push(rb);
  await new Promise((r) => setTimeout(r, 5));
  ui.draw();
  assert.ok(ui.painter.texts().some((t) => /No rooms yet/.test(t)));
  assert.equal(byText(rb, 'Join').enabled, false);
});

test('gamepad menus: d-pad and stick navigate with repeat, A activates, B cancels', () => {
  const ui = make();
  const pads = [];
  const input = new InputCore({ actions: menuActions('menu'), contexts: { menu: { blocking: true } }, gamepadProvider: () => pads });
  input.setContext('menu');
  const log = [];
  const menu = menuScreen(ui, { items: ['a', 'b', 'c'].map((t) => ({ text: t, onClick: () => log.push(t) })) });
  ui.push(menu);
  const pump = createMenuPump(ui, input, { repeatDelay: 0.4, repeatRate: 0.1 });
  const pad = { connected: true, mapping: 'standard', index: 0, buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })), axes: [0, 0, 0, 0] };
  pads.push(pad);
  const frame = (dt = 1 / 60) => { input.update(dt); pump.update(dt); };
  frame();
  pad.buttons[13] = { pressed: true, value: 1 }; // d-pad down
  frame();
  assert.equal(ui.focus.text, 'b');
  for (let i = 0; i < 20; i++) frame(); // 0.33 s: still before the repeat delay
  assert.equal(ui.focus.text, 'b');
  for (let i = 0; i < 20; i++) frame(); // past 0.4 s: repeating moves on, stops at the end
  assert.equal(ui.focus.text, 'c');
  pad.buttons[13] = { pressed: false, value: 0 };
  frame();
  pad.buttons[0] = { pressed: true, value: 1 }; frame(); pad.buttons[0] = { pressed: false, value: 0 }; frame();
  assert.deepEqual(log, ['c']);
  pad.axes[1] = -1; frame(); pad.axes[1] = 0; frame();   // stick up
  assert.equal(ui.focus.text, 'b');
  assert.equal(ui.focusVisible, true);
  pad.buttons[1] = { pressed: true, value: 1 }; frame();
  assert.equal(ui.isOpen, false, 'B closes the menu');
});
