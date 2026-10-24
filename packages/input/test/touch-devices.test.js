import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InputCore, TouchController, shooterTouchLayout, attachKeyboard, attachMouse, attachGamepads, attachTouch, createInput } from '../src/index.js';

const near = (a, b, tol = 1e-9, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} ${a} vs ${b}`);

const layout = (w, h) => [
  { type: 'look', id: 'look', region: { x: w / 2, y: 0, w: w / 2, h } },
  { type: 'stick', id: 'move', region: { x: 0, y: 0, w: w / 2, h }, radius: 100, mode: 'floating' },
  { type: 'button', id: 'fire', cx: w - 80, cy: h - 80, r: 50 },
  { type: 'button', id: 'jump', cx: w - 200, cy: h - 80, r: 50 },
];
const touchGame = () => {
  const core = new InputCore({ actions: {
    move: { type: 'vector2', bindings: [{ type: 'touchStick', id: 'move' }] },
    look: { type: 'vector2', bindings: [{ type: 'touchLook', id: 'look', sensitivity: 0.01 }] },
    fire: { type: 'button', bindings: [{ type: 'touchButton', id: 'fire' }] },
    jump: { type: 'button', bindings: [{ type: 'touchButton', id: 'jump' }] },
  } });
  const touch = new TouchController(core, layout);
  touch.resize(1000, 600);
  return { core, touch };
};

test('a floating stick starts wherever the finger lands, y is up, the throw is capped at the radius, and lifting stops it', () => {
  const { core, touch } = touchGame();
  assert.ok(touch.pointerDown(1, 200, 400));
  core.update();
  assert.deepEqual(core.vector('move'), { x: 0, y: 0 }, 'no movement at the touch point');
  touch.pointerMove(1, 250, 300); // 50 right, 100 up
  core.update();
  const v = core.vector('move');
  assert.ok(v.x > 0 && v.y > 0, 'right and up');
  near(Math.hypot(v.x, v.y), 1, 0.02, 'capped at the radius');
  touch.pointerMove(1, 200, 450); // 50 down: half throw
  core.update();
  assert.ok(core.vector('move').y < 0 && Math.abs(core.vector('move').y) < 0.6);
  touch.pointerUp(1);
  core.update();
  assert.deepEqual(core.vector('move'), { x: 0, y: 0 });
  const fixed = new TouchController(core, () => [{ type: 'stick', id: 'move', region: { x: 0, y: 400, w: 200, h: 200 }, radius: 100, mode: 'fixed' }]);
  fixed.resize(1000, 600);
  fixed.pointerDown(7, 100, 400); // 100 above the centre of a fixed stick: already full throw
  core.update();
  near(core.vector('move').y, 1, 0.01, 'a fixed stick measures from its centre');
});

test('look areas turn the view by how far a finger drags; buttons are held while touched; one finger per stick', () => {
  const { core, touch } = touchGame();
  touch.pointerDown(1, 700, 100);
  touch.pointerMove(1, 750, 80);
  core.update();
  near(core.vector('look').x, 0.5); near(core.vector('look').y, 0.2, 1e-9, 'dragging up looks up');
  core.update();
  assert.deepEqual(core.vector('look'), { x: 0, y: 0 }, 'only movement counts, not a finger resting');
  touch.pointerDown(2, 920, 520); // the fire button, on top of the look area
  core.update();
  assert.ok(core.held('fire') && core.pressed('fire'));
  touch.pointerDown(3, 800, 520); // jump while still firing and looking
  core.update();
  assert.ok(core.held('fire') && core.held('jump'), 'several fingers at once');
  touch.pointerUp(2);
  core.update();
  assert.ok(!core.held('fire') && core.held('jump') && core.released('fire'));
  assert.equal(touch.pointerDown(4, 710, 120), false, 'the look area already has a finger');
  assert.equal(touch.pointerDown(5, 100, 100), true);
  assert.equal(touch.pointerDown(6, 120, 120), false, 'and so does the stick');
  assert.equal(touch.pointerDown(8, 990, 5), false, 'the look area is taken (finger 1 is still on it)');
  assert.equal(new TouchController(core, () => []).pointerDown(1, 5, 5), false, 'nothing there');
});

test('buttons beat sticks beat look areas where they overlap; resizing re-lays the controls out; cancelAll lets go', () => {
  const { core, touch } = touchGame();
  touch.pointerDown(1, 920, 520);
  assert.equal(touch.fingers.get(1).control.id, 'fire', 'a button over the look area');
  touch.cancelAll(); core.update();
  assert.ok(!core.held('fire') && core.released('fire'));
  touch.resize(500, 300);
  assert.equal(touch.controls.find((c) => c.id === 'fire').cx, 420);
  touch.pointerDown(2, 420, 220); core.update();
  assert.ok(core.held('fire'), 'the button moved with the screen');
  const v = touch.visuals();
  assert.ok(v.find((c) => c.id === 'fire').down); assert.equal(v.find((c) => c.id === 'jump').down, false);
  touch.setLayout(shooterTouchLayout);
  assert.deepEqual(touch.controls.map((c) => c.id).sort(), ['fire', 'jump', 'look', 'move', 'run']);
  const stickVisual = touch.visuals().find((c) => c.id === 'move');
  assert.equal(stickVisual.visible, false, 'a floating stick is drawn only while in use');
});

// ---------- browser adapters, with stand-in events ----------

const keyEvent = (type, code, { target = {}, ...extra } = {}) => {
  const e = Object.assign(new Event(type, { cancelable: true }), { code, repeat: false, ...extra });
  Object.defineProperty(e, 'target', { value: target }); // Event.target is read-only: shadow it with the element the key was typed into
  return e;
};

test('keyboard adapter: keys reach the core once (not on auto-repeat), the game\'s keys are kept from the page, text fields are left alone', () => {
  const target = new EventTarget();
  const core = new InputCore({ actions: { jump: { type: 'button', bindings: [{ type: 'key', code: 'Space' }] }, move: { type: 'vector2', bindings: [{ type: 'keys2d', up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD' }] } } });
  const detach = attachKeyboard(core, target);
  const space = keyEvent('keydown', 'Space');
  target.dispatchEvent(space);
  core.update(); assert.ok(core.pressed('jump')); assert.ok(space.defaultPrevented, 'Space would scroll the page: prevented');
  const other = keyEvent('keydown', 'F5');
  target.dispatchEvent(other);
  assert.ok(!other.defaultPrevented, 'keys the game does not use are left to the browser');
  target.dispatchEvent(keyEvent('keydown', 'Space', { repeat: true }));
  core.update(); assert.ok(core.held('jump') && !core.pressed('jump'), 'auto-repeat is not a new press');
  target.dispatchEvent(keyEvent('keyup', 'Space'));
  core.update(); assert.ok(core.released('jump'));
  const typed = keyEvent('keydown', 'KeyW', { target: { tagName: 'INPUT' } });
  target.dispatchEvent(typed);
  core.update(); assert.deepEqual(core.vector('move'), { x: 0, y: 0 }, 'typing in a text field does not move you'); assert.ok(!typed.defaultPrevented);
  detach();
  target.dispatchEvent(keyEvent('keydown', 'Space'));
  core.update(); assert.ok(!core.pressed('jump'), 'detached');
});

test('mouse adapter: buttons, wheel and look; with pointer lock the view turns only while locked', () => {
  const element = Object.assign(new EventTarget(), { requestPointerLock() { this.locked = true; globalThis.document.pointerLockElement = this; } });
  const fakeDoc = Object.assign(new EventTarget(), { pointerLockElement: null });
  const realDoc = globalThis.document;
  globalThis.document = fakeDoc;
  try {
    const core = new InputCore({ actions: {
      fire: { type: 'button', bindings: [{ type: 'mouseButton', button: 0 }] },
      look: { type: 'vector2', bindings: [{ type: 'mouseDelta', sensitivity: 1 }] },
      next: { type: 'button', bindings: [{ type: 'wheel', direction: 'down' }] },
    } });
    const m = attachMouse(core, element, { pointerLock: true, requireLock: true });
    const ev = (type, props) => Object.assign(new Event(type, { cancelable: true }), props);
    element.dispatchEvent(ev('pointerdown', { button: 0, pointerType: 'mouse' }));
    core.update(); assert.ok(!core.held('fire'), 'the click that asks for the lock is not a shot');
    element.dispatchEvent(ev('mousemove', { movementX: 9, movementY: 9, clientX: 5, clientY: 6 }));
    core.update(); assert.deepEqual(core.vector('look'), { x: 0, y: 0 }, 'a free pointer does not turn the view'); assert.deepEqual([core.mouse.x, core.mouse.y], [5, 6], 'but its position is tracked');
    m.lock(); assert.ok(m.locked);
    element.dispatchEvent(ev('mousemove', { movementX: 4, movementY: -2, clientX: 5, clientY: 6 }));
    core.update(); assert.deepEqual(core.vector('look'), { x: 4, y: 2 });
    element.dispatchEvent(ev('pointerdown', { button: 0, pointerType: 'mouse' }));
    core.update(); assert.ok(core.held('fire'));
    element.dispatchEvent(ev('pointerdown', { button: 0, pointerType: 'touch' }));
    const wheel = ev('wheel', { deltaY: 100 }); element.dispatchEvent(wheel);
    core.update(); assert.ok(core.pressed('next') && wheel.defaultPrevented, 'the wheel does not scroll the page');
    fakeDoc.pointerLockElement = null; fakeDoc.dispatchEvent(new Event('pointerlockchange'));
    core.update(); assert.ok(!core.held('fire'), 'losing the lock lets go of the buttons');
    m.detach();
  } finally { globalThis.document = realDoc; }
});

test('gamepad and touch adapters: the browser list is polled; touch pointers (not the mouse) drive the controls and everything detaches', () => {
  const core = new InputCore({ actions: { jump: { type: 'button', bindings: [{ type: 'gamepadButton', button: 'south' }, { type: 'touchButton', id: 'fire' }] } } });
  const pads = [{ index: 0, connected: true, buttons: [{ pressed: true, value: 1 }], axes: [] }];
  const detachPads = attachGamepads(core, { getGamepads: () => pads });
  core.update(); assert.ok(core.held('jump'));
  detachPads(); assert.equal(core.gamepadProvider, null);
  core.update(); assert.ok(!core.held('jump'));

  const element = Object.assign(new EventTarget(), {
    style: {}, getBoundingClientRect: () => ({ left: 10, top: 20, width: 1000, height: 600 }), setPointerCapture() {},
  });
  const t = attachTouch(core, element, layout, { overlay: false });
  assert.equal(element.style.touchAction, 'none');
  const ev = (type, props) => Object.assign(new Event(type, { cancelable: true }), props);
  element.dispatchEvent(ev('pointerdown', { pointerId: 5, pointerType: 'mouse', clientX: 930, clientY: 540 }));
  core.update(); assert.ok(!core.held('jump'), 'a mouse is not a finger');
  element.dispatchEvent(ev('pointerdown', { pointerId: 6, pointerType: 'touch', clientX: 930, clientY: 540 })); // 920, 520 in element space: the fire button
  core.update(); assert.ok(core.held('jump'), 'positions are relative to the element');
  element.dispatchEvent(ev('pointerup', { pointerId: 6, pointerType: 'touch', clientX: 930, clientY: 540 }));
  core.update(); assert.ok(!core.held('jump'));
  t.detach();
  assert.ok(!element.style.touchAction, 'the style is put back');
  element.dispatchEvent(ev('pointerdown', { pointerId: 7, pointerType: 'touch', clientX: 930, clientY: 540 }));
  core.update(); assert.ok(!core.held('jump'), 'detached');
});

test('createInput wires the keyboard, mouse and gamepads in one call', () => {
  const realAdd = globalThis.addEventListener, realRemove = globalThis.removeEventListener, realNav = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const listeners = [];
  globalThis.addEventListener = (t, fn) => listeners.push([t, fn]);
  globalThis.removeEventListener = (t, fn) => { const i = listeners.findIndex((l) => l[0] === t && l[1] === fn); if (i >= 0) listeners.splice(i, 1); };
  try {
    const element = new EventTarget();
    const { input, detach, touch } = createInput({ element, actions: { jump: { type: 'button', bindings: [{ type: 'key', code: 'Space' }] } } });
    assert.equal(touch, null);
    assert.ok(input instanceof InputCore);
    assert.ok(listeners.length > 0, 'window-level listeners added');
    detach();
    assert.equal(listeners.length, 0, 'and all removed');
  } finally {
    globalThis.addEventListener = realAdd; globalThis.removeEventListener = realRemove;
    if (realNav) Object.defineProperty(globalThis, 'navigator', realNav);
  }
});
