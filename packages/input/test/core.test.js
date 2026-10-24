import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InputCore, applyDeadzone1d, applyDeadzone2d, validateBinding, sameControl, describeBinding, keyLabel, deviceOf } from '../src/index.js';

const near = (a, b, tol = 1e-9, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} ${a} vs ${b}`);

const WASD = { type: 'keys2d', up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD' };
const game = (extra = {}) => new InputCore({
  actions: {
    jump: { type: 'button', bindings: [{ type: 'key', code: 'Space' }, { type: 'gamepadButton', button: 'south' }, { type: 'touchButton', id: 'jump' }] },
    fire: { type: 'button', bindings: [{ type: 'mouseButton', button: 0 }, { type: 'gamepadButton', button: 'rightTrigger' }] },
    move: { type: 'vector2', bindings: [WASD, { type: 'gamepadStick', stick: 'left' }, { type: 'touchStick', id: 'move' }] },
    look: { type: 'vector2', bindings: [{ type: 'mouseDelta', sensitivity: 0.01 }, { type: 'gamepadStick', stick: 'right', sensitivity: 3 }, { type: 'touchLook', id: 'look', sensitivity: 0.02 }] },
    lean: { type: 'axis', bindings: [{ type: 'keys1d', negative: 'KeyQ', positive: 'KeyE' }, { type: 'gamepadAxis', axis: 'rightX', direction: 0 }] },
    zoom: { type: 'axis', bindings: [{ type: 'wheel' }] },
    menuOk: { type: 'button', context: 'menu', bindings: [{ type: 'key', code: 'Enter' }] },
  },
  contexts: { menu: { blocking: true } },
  ...extra,
});
const pad = (buttons = {}, axes = [0, 0, 0, 0]) => ({ index: 0, connected: true, buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: (buttons[i] ?? 0) > 0.5, value: buttons[i] ?? 0 })), axes });

test('buttons: held, pressed and released edges, a tap shorter than a frame, and several controls for one action', () => {
  const g = game();
  g.update();
  assert.deepEqual([g.held('jump'), g.pressed('jump'), g.released('jump')], [false, false, false]);
  g.keyDown('Space'); g.update();
  assert.deepEqual([g.held('jump'), g.pressed('jump'), g.released('jump')], [true, true, false]);
  g.update();
  assert.deepEqual([g.held('jump'), g.pressed('jump'), g.released('jump')], [true, false, false], 'held, but no longer "just pressed"');
  g.keyUp('Space'); g.update();
  assert.deepEqual([g.held('jump'), g.pressed('jump'), g.released('jump')], [false, false, true]);
  g.keyDown('Space'); g.keyUp('Space'); g.update(); // down and up between two updates
  assert.deepEqual([g.held('jump'), g.pressed('jump'), g.released('jump')], [false, true, true], 'a quick tap is not lost');
  g.mouseButtonDown(0); g.update();
  assert.ok(g.held('fire') && g.pressed('fire'));
  g.touchButton('jump', true); g.keyDown('Space'); g.update();
  assert.ok(g.held('jump'), 'either control holds it');
  g.keyUp('Space'); g.update();
  assert.ok(g.held('jump') && !g.released('jump'), 'still held by the other control');
  g.mouseWheel(-100);
  const w = new InputCore({ actions: { next: { type: 'button', bindings: [{ type: 'wheel', direction: 'up' }] } } });
  w.mouseWheel(-100); w.update();
  assert.ok(w.pressed('next') && w.released('next'), 'a wheel notch is a tap');
  w.update();
  assert.ok(!w.held('next'));
  assert.throws(() => g.held('nothing'), /no action named "nothing"/);
});

test('vectors from keys: diagonals are unit length, opposite keys cancel, y is up', () => {
  const g = game();
  g.keyDown('KeyW'); g.update();
  assert.deepEqual(g.vector('move'), { x: 0, y: 1 });
  g.keyDown('KeyD'); g.update();
  const v = g.vector('move');
  near(v.x, Math.SQRT1_2, 1e-9); near(v.y, Math.SQRT1_2, 1e-9);
  g.keyDown('KeyS'); g.update();
  assert.deepEqual(g.vector('move'), { x: 1, y: 0 }, 'W and S cancel');
  g.keyUp('KeyD'); g.keyUp('KeyW'); g.keyUp('KeyS'); g.update();
  assert.deepEqual(g.vector('move'), { x: 0, y: 0 });
  assert.ok(!g.held('move') || g.released('move'));
});

test('sticks: radial dead zone, rescaled range, y is up, the stronger of two pads wins, and the look stick turns at a rate', () => {
  const g = game({ gamepadProvider: () => [pad({}, [0.1, 0.1, 0, 0])] });
  g.update();
  assert.deepEqual(g.vector('move'), { x: 0, y: 0 }, 'inside the dead zone');
  g.gamepadProvider = () => [pad({}, [0, -1, 0, 0])]; // pushed away from you: axis y is -1
  g.update();
  assert.deepEqual(g.vector('move'), { x: 0, y: 1 }, 'pushing forward is +y');
  g.gamepadProvider = () => [pad({}, [0.575, 0, 0, 0])]; // halfway between the 0.15 dead zone and full
  g.update();
  near(g.vector('move').x, 0.5, 1e-9, 'the usable range is stretched');
  g.gamepadProvider = () => [pad({}, [0.2, 0, 0, 0]), { ...pad({}, [0, 0, 0, 0]), index: 1 }, { ...pad({}, [0.9, 0, 0, 0]), index: 2 }];
  g.update();
  assert.ok(g.vector('move').x > 0.8, 'the pad with the most deflection counts');
  g.gamepadProvider = () => [pad({}, [0, 0, 1, 0])]; // right stick fully right
  g.update(1 / 60);
  near(g.vector('look').x, 3 / 60, 1e-9, 'a rate: 3 rad/s at full tilt, for one frame');
  g.update(1 / 30);
  near(g.vector('look').x, 3 / 30, 1e-9, 'twice the time, twice the turn');
  const curved = new InputCore({ actions: { a: { type: 'vector2', curve: 2, bindings: [{ type: 'gamepadStick', stick: 'left' }] } }, gamepadProvider: () => [pad({}, [0.575, 0, 0, 0])] });
  curved.update();
  near(curved.vector('a').x, 0.25, 1e-9, 'a response curve flattens the middle');
  near(applyDeadzone1d(-0.575, 0.15), -0.5, 1e-9);
  assert.deepEqual(applyDeadzone2d(0.05, 0.05, 0.15), { x: 0, y: 0 });
});

test('mouse and touch look: per-frame turns that do not carry over, scaled by sensitivity, with optional inversion', () => {
  const g = game();
  g.mouseMove(10, -20); g.mouseMove(5, 0); g.update();
  near(g.vector('look').x, 0.15, 1e-9); near(g.vector('look').y, 0.2, 1e-9, 'moving the mouse up looks up');
  g.update();
  assert.deepEqual(g.vector('look'), { x: 0, y: 0 }, 'nothing carries into the next frame');
  g.touchLook('look', 50, -25); g.update();
  near(g.vector('look').x, 1, 1e-9); near(g.vector('look').y, 0.5, 1e-9, 'dragging up looks up');
  const inv = new InputCore({ actions: { look: { type: 'vector2', invertY: true, bindings: [{ type: 'mouseDelta', sensitivity: 1 }] } } });
  inv.mouseMove(0, -3); inv.update();
  assert.equal(inv.vector('look').y, -3, 'inverted');
  g.touchStick('move', 0.5, 0.5, true); g.update();
  near(g.vector('move').x, 0.5, 0.05, 'an on-screen stick');
  g.touchStick('move', 0, 0, false); g.update();
  assert.deepEqual(g.vector('move'), { x: 0, y: 0 });
});

test('axes: keys, signed gamepad axes with a dead zone, and the wheel', () => {
  const g = game();
  g.keyDown('KeyE'); g.update();
  assert.equal(g.value('lean'), 1);
  g.keyDown('KeyQ'); g.update();
  assert.equal(g.value('lean'), 0, 'both cancel');
  g.keyUp('KeyE'); g.keyUp('KeyQ');
  g.gamepadProvider = () => [pad({}, [0, 0, -0.575, 0])];
  g.update();
  near(g.value('lean'), -0.5, 1e-9);
  g.gamepadProvider = null; g.mouseWheel(50); g.update();
  near(g.value('zoom'), 0.5, 1e-9);
});

test('gamepad buttons: names, analog triggers, a stick direction as a button, disconnected pads ignored, rumble', () => {
  const g = game({ gamepadProvider: () => [pad({ 0: 1 })] });
  g.update();
  assert.ok(g.pressed('jump') && g.held('jump'), 'south is the A button');
  g.gamepadProvider = () => [pad({ 7: 0.3 })];
  g.update();
  assert.ok(!g.held('fire'), 'a light squeeze of the trigger is not a press');
  g.gamepadProvider = () => [pad({ 7: 0.8 })];
  g.update();
  assert.ok(g.held('fire')); near(g.value('fire'), 0.8, 1e-9, 'the analog value is kept');
  g.gamepadProvider = () => [{ ...pad({ 0: 1 }), connected: false }];
  g.update();
  assert.ok(!g.held('jump'));
  const dir = new InputCore({ actions: { right: { type: 'button', bindings: [{ type: 'gamepadAxis', axis: 'leftX', direction: 1 }] } }, gamepadProvider: () => [pad({}, [0.9, 0, 0, 0])] });
  dir.update();
  assert.ok(dir.held('right'));
  const effects = [];
  const rumble = new InputCore({ gamepadProvider: () => [{ ...pad(), vibrationActuator: { playEffect: async (type, o) => { effects.push([type, o.duration, o.strongMagnitude]); } } }] });
  rumble.update();
  assert.ok(rumble.vibrate(200, 0.9, 0.1));
  assert.deepEqual(effects, [['dual-rumble', 200, 0.9]]);
  assert.equal(new InputCore().vibrate(), false, 'no pad, no rumble');
});

test('contexts: a blocking menu hides the game, popping brings it back, and an inactive action is neutral', () => {
  const g = game();
  g.keyDown('Space'); g.keyDown('Enter'); g.update();
  assert.ok(g.held('jump')); assert.ok(!g.held('menuOk'), 'the menu action is not in the active context');
  g.pushContext('menu'); g.update();
  assert.ok(!g.held('jump'), 'the menu blocks the game'); assert.ok(g.held('menuOk'));
  assert.equal(g.context, 'menu');
  g.popContext(); g.update();
  assert.ok(g.held('jump') && !g.pressed('jump'), 'back in the game, and the held key is not a fresh press');
  g.popContext(); assert.equal(g.context, 'gameplay', 'the base context stays');
  g.defineContext('chat', { blocking: false });
  g.pushContext('chat'); g.update();
  assert.ok(g.held('jump'), 'a non-blocking context lets the one below stay active');
  g.setContext('menu');
  assert.deepEqual(g.contextStack, ['menu']);
  assert.throws(() => g.pushContext('nope'), /no context/);
});

test('rebinding: edit, add, remove and reset bindings; mistakes are refused; clashes are found', () => {
  const g = game();
  g.rebind('jump', 0, { type: 'key', code: 'KeyJ' });
  g.keyDown('Space'); g.update(); assert.ok(!g.held('jump'), 'the old key no longer works');
  g.keyDown('KeyJ'); g.update(); assert.ok(g.held('jump'));
  assert.throws(() => g.rebind('jump', 0, { type: 'keys2d', up: 'a', down: 'b', left: 'c', right: 'd' }), /cannot use a "keys2d"/);
  assert.throws(() => g.rebind('jump', 9, { type: 'key', code: 'KeyX' }), /no binding number 9/);
  assert.throws(() => g.addBinding('jump', { type: 'key' }), /needs a code/);
  g.addBinding('jump', { type: 'key', code: 'KeyK' });
  assert.equal(g.bindings('jump').length, 4);
  g.removeBinding('jump', 3); assert.equal(g.bindings('jump').length, 3);
  assert.deepEqual(g.findConflicts({ type: 'key', code: 'KeyJ' }), [{ action: 'jump', index: 0 }]);
  assert.deepEqual(g.findConflicts({ type: 'key', code: 'KeyJ' }, 'jump'), [], 'an action does not clash with itself');
  assert.deepEqual(g.findConflicts({ type: 'key', code: 'Enter' }, 'jump'), [], 'other contexts do not clash');
  g.setBindings('fire', [{ type: 'key', code: 'KeyF' }]);
  assert.equal(g.bindings('fire').length, 1);
  g.resetBindings('jump');
  assert.deepEqual(g.bindings('jump')[0], { type: 'key', code: 'Space' });
  g.resetBindings();
  assert.equal(g.bindings('fire').length, 2);
  assert.throws(() => new InputCore({ actions: { x: { type: 'button', bindings: [{ type: 'gamepadStick', stick: 'left' }] } } }), /cannot use a "gamepadStick"/);
  assert.throws(() => new InputCore({ actions: { x: { type: 'dial', bindings: [] } } }), /button, axis or vector2/);
  const copy = g.bindings('jump'); copy[0].code = 'Hacked';
  assert.equal(g.bindings('jump')[0].code, 'Space', 'bindings() hands out copies');
});

test('listening for the next press: keys, mouse and pad, filters, cancel, and nothing fires meanwhile', () => {
  const g = game({ gamepadProvider: () => [] });
  let got;
  g.listen((b) => { got = b; });
  g.keyDown('KeyZ');
  assert.deepEqual(got, { type: 'key', code: 'KeyZ' });
  g.update(); assert.ok(!g.held('jump'), 'the capturing press did nothing in the game'); assert.equal(g.capture, null);
  g.listen((b) => { got = b; });
  g.mouseButtonDown(2); assert.deepEqual(got, { type: 'mouseButton', button: 2 });
  g.listen((b) => { got = b; }, { devices: ['keyboard'] });
  g.mouseButtonDown(0); assert.deepEqual(got, { type: 'mouseButton', button: 2 }, 'a filtered-out device is ignored');
  g.keyDown('KeyY'); assert.equal(got.code, 'KeyY');
  g.listen((b) => { got = b; });
  g.keyDown('Escape'); assert.equal(got, null, 'Escape cancels');
  g.gamepadProvider = () => [pad()]; g.update();
  g.listen((b) => { got = b; });
  g.gamepadProvider = () => [pad({ 3: 1 })]; g.update();
  assert.deepEqual(got, { type: 'gamepadButton', button: 'north' });
  g.listen((b) => { got = b; });
  g.gamepadProvider = () => [pad({}, [0, 0, 0.95, 0])]; g.update();
  assert.deepEqual(got, { type: 'gamepadAxis', axis: 'rightX', direction: 1 });
  g.listen(() => {});
  g.keyDown('Space'); g.keyUp('Space');
  g.update();
  assert.ok(!g.pressed('jump'));
  const cancel = g.listen(() => assert.fail('cancelled'));
  cancel(); g.keyDown('KeyQ');
  assert.equal(g.capture, null);
});

test('saving and loading bindings: round trip, and bad data is skipped with a report instead of failing', () => {
  const g = game();
  g.rebind('jump', 0, { type: 'key', code: 'KeyJ' });
  const saved = JSON.parse(JSON.stringify(g.serialize()));
  const h = game();
  const r = h.load(saved);
  assert.ok(r.loaded.includes('jump') && r.problems.length === 0);
  assert.deepEqual(h.bindings('jump'), g.bindings('jump'));
  const messy = { version: 1, bindings: { jump: [{ type: 'key', code: 'KeyP' }, { type: 'key' }, { type: 'keys2d' }], ghost: [], fire: 'nope' } };
  const r2 = game().load(messy);
  assert.ok(r2.problems.some((p) => /unknown action "ghost"/.test(p)) && r2.problems.some((p) => /must be a list/.test(p)) && r2.problems.length >= 4);
  const k = game(); k.load(messy);
  assert.deepEqual(k.bindings('jump'), [{ type: 'key', code: 'KeyP' }], 'the valid binding survived');
  assert.deepEqual(game().load({ version: 99, bindings: {} }).loaded, []);
  assert.deepEqual(game().load(null).loaded, []);
});

test('the device in use, prompts for it, labels, sample() and releaseAll()', () => {
  const g = game();
  const seen = [];
  g.onDeviceChange = (d) => seen.push(d);
  assert.equal(g.lastDevice, 'keyboard');
  g.mouseMove(1, 1); g.keyDown('KeyW'); g.touchButton('jump', true); g.update();
  g.gamepadProvider = () => [pad({ 0: 1 })]; g.update();
  assert.deepEqual(seen, ['mouse', 'keyboard', 'touch', 'gamepad']);
  assert.equal(g.promptFor('jump'), 'Gamepad A');
  assert.equal(g.promptFor('jump', 'keyboard'), 'Space');
  assert.equal(g.promptFor('lean', 'touch'), 'Q / E', 'falls back to the first binding when the device has none');
  assert.deepEqual(g.describe('fire'), ['Left Click', 'Gamepad RT']);
  assert.equal(describeBinding({ type: 'keys2d', up: 'KeyW', left: 'KeyA', down: 'KeyS', right: 'KeyD' }), 'W A S D');
  assert.equal([keyLabel('KeyW'), keyLabel('Digit3'), keyLabel('ArrowUp'), keyLabel('ShiftLeft'), keyLabel('F5')].join(), 'W,3,Up,Left Shift,F5');
  const s = game(); s.keyDown('KeyW'); s.keyDown('Space'); s.mouseMove(3, 0); s.update();
  const sample = s.sample();
  assert.deepEqual(sample.move, [0, 1]); assert.equal(sample.jump, 1); assert.equal(sample.fire, 0); assert.ok(sample.look[0] > 0);
  s.releaseAll(); s.update();
  assert.ok(!s.held('jump'), 'releaseAll lets go of everything (the window lost focus)');
  assert.deepEqual(s.vector('move'), { x: 0, y: 0 });
});

test('binding validation covers every type, and controls are compared by what they read', () => {
  const ok = (type, b) => assert.equal(validateBinding(type, b), null, JSON.stringify(b));
  const bad = (type, b, re) => assert.match(validateBinding(type, b) ?? 'valid', re, JSON.stringify(b));
  ok('button', { type: 'key', code: 'KeyA' }); ok('button', { type: 'mouseButton', button: 4 }); ok('button', { type: 'gamepadButton', button: 'dpadUp' }); ok('button', { type: 'gamepadButton', button: 3 });
  ok('button', { type: 'gamepadAxis', axis: 'leftY', direction: -1 }); ok('button', { type: 'wheel', direction: 'down' }); ok('button', { type: 'touchButton', id: 'x' });
  ok('axis', { type: 'gamepadAxis', axis: 2 }); ok('axis', { type: 'wheel' }); ok('vector2', { type: 'touchLook', id: 'l', sensitivity: 0.1 }); ok('vector2', { type: 'gamepadStick', stick: 'right', sensitivity: 2 });
  bad('button', null, /object/); bad('button', { type: 'mouseButton', button: 9 }, /0\.\.4/); bad('button', { type: 'gamepadButton', button: 'nope' }, /unknown gamepad button/);
  bad('button', { type: 'gamepadAxis', axis: 'leftX' }, /direction 1 or -1/); bad('axis', { type: 'gamepadAxis', axis: 'zzz' }, /unknown gamepad axis/);
  bad('button', { type: 'wheel' }, /direction/); bad('vector2', { type: 'mouseDelta', sensitivity: -1 }, /positive/); bad('vector2', { type: 'gamepadStick', stick: 'middle' }, /stick/);
  bad('vector2', { type: 'touchStick' }, /id/); bad('button', { type: 'key', code: 'x'.repeat(40) }, /code/); bad('vector2', { type: 'keys2d', up: 'KeyW' }, /up, down, left and right/);
  bad('wobble', { type: 'key', code: 'A' }, /unknown action type/); bad('button', { type: 'teleport' }, /cannot use/);
  assert.ok(sameControl({ type: 'key', code: 'A' }, { type: 'key', code: 'A' })); assert.ok(!sameControl({ type: 'key', code: 'A' }, { type: 'key', code: 'B' }));
  assert.ok(sameControl({ type: 'gamepadButton', button: 'south' }, { type: 'gamepadButton', button: 0 }), 'a name and its index are the same button');
  assert.ok(!sameControl({ type: 'gamepadAxis', axis: 'leftX', direction: 1 }, { type: 'gamepadAxis', axis: 0, direction: -1 }));
  assert.ok(!sameControl({ type: 'key', code: 'A' }, { type: 'mouseButton', button: 0 }));
  assert.deepEqual(['key', 'mouseDelta', 'gamepadStick', 'touchLook'].map((type) => deviceOf({ type })), ['keyboard', 'mouse', 'gamepad', 'touch']);
});
