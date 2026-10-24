import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gamepadCodes, GamepadReader, PAD, createMouseControls } from '../runner/controls.js';

const pad = (pressed = [], axes = [0, 0]) => ({ buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.includes(i) })), axes });

test('a controller means keys: buttons, the d-pad and the left stick, with a dead zone', () => {
  assert.deepEqual([...gamepadCodes(pad([0]))], ['Space']);
  assert.deepEqual([...gamepadCodes(pad([2]))], ['KeyX']);
  assert.deepEqual([...gamepadCodes(pad([14, 12]))].sort(), ['ArrowLeft', 'ArrowUp']);
  assert.deepEqual([...gamepadCodes(pad([], [-0.9, 0.1]))], ['ArrowLeft']);
  assert.deepEqual([...gamepadCodes(pad([], [0.9, -0.9]))].sort(), ['ArrowRight', 'ArrowUp']);
  assert.deepEqual([...gamepadCodes(pad([], [PAD.deadzone - 0.01, 0.2]))], [], 'a resting stick is not a press');
  assert.deepEqual([...gamepadCodes(pad([16, 8]))], [], 'buttons with no meaning are ignored');
  assert.deepEqual([...gamepadCodes(null)], []); assert.deepEqual([...gamepadCodes({})], []);
});

test('the reader reports presses and releases once, across several controllers, and lets go when one is unplugged', () => {
  const events = [];
  let pads = [pad([0])];
  const r = new GamepadReader({ press: (c) => events.push(`+${c}`), release: (c) => events.push(`-${c}`), getPads: () => pads });
  assert.equal(r.poll(), true); r.poll(); r.poll();
  assert.deepEqual(events, ['+Space'], 'held: reported once');
  pads = [pad([0, 15]), null, pad([], [-1, 0])];
  r.poll();
  assert.deepEqual(events, ['+Space', '+ArrowRight', '+ArrowLeft']);
  pads = [pad([15])];
  r.poll();
  assert.deepEqual(events.slice(3).sort(), ['-ArrowLeft', '-Space']);
  pads = [];
  assert.equal(r.poll(), false);
  assert.equal(events.at(-1), '-ArrowRight');
  pads = [pad([0])]; r.poll(); r.releaseAll();
  assert.equal(events.at(-1), '-Space'); assert.equal(r.held.size, 0);
});

/** A page that is just enough for the mouse controls: a body, listeners, a canvas that can take the mouse. */
function fakePage() {
  const listeners = {};
  const canvas = { requestPointerLock() { doc.pointerLockElement = canvas; doc.fire('pointerlockchange'); return Promise.resolve(); } };
  const doc = {
    pointerLockElement: null, exitPointerLock() { doc.pointerLockElement = null; doc.fire('pointerlockchange'); },
    createElement: () => ({ style: {}, setAttribute() {} }), body: { append() {} },
    addEventListener: (type, fn) => { (listeners[type] ??= []).push(fn); },
    fire: (type, e = {}) => (listeners[type] ?? []).forEach((fn) => fn({ preventDefault() {}, ...e })),
  };
  return { doc, canvas };
}

test('the mouse: nothing is taken until a game asks; then a click holds the mouse, its movement is one held key, and Esc lets go', async () => {
  globalThis.requestAnimationFrame = (fn) => { queueMicrotask(fn); return 1; };
  const { doc, canvas } = fakePage();
  const held = new Set();
  const locks = [];
  const mouse = createMouseControls(doc, () => canvas, { press: (c) => held.add(c), release: (c) => held.delete(c), onLock: (l) => locks.push(l) });
  doc.fire('mousedown', { target: canvas, button: 0 });
  assert.equal(doc.pointerLockElement, null, 'a game that never asked keeps its pointer');
  assert.ok(held.has('Mouse0'), 'but the button is a key');
  doc.fire('mouseup', { button: 0 });
  assert.ok(!held.has('Mouse0'));
  mouse.want(true);
  doc.fire('mousedown', { target: { not: 'the canvas' }, button: 0 });
  assert.equal(doc.pointerLockElement, null, 'a click somewhere else does nothing');
  doc.fire('mousedown', { target: canvas, button: 0 });
  assert.equal(doc.pointerLockElement, canvas);
  assert.deepEqual(locks, [true]);
  doc.fire('mousemove', { movementX: 5, movementY: -2 });
  doc.fire('mousemove', { movementX: 3, movementY: 1 });
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual([...held].filter((c) => c.startsWith('Mouse:')), ['Mouse:8:-1'], 'the whole distance so far, one key at a time');
  doc.fire('mousemove', { movementX: 2, movementY: 0 });
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual([...held].filter((c) => c.startsWith('Mouse:')), ['Mouse:10:-1'], 'the old one is let go');
  mouse.move(99999, 0);
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual([...held].filter((c) => c.startsWith('Mouse:')), ['Mouse:510:-1'], 'one huge jump is limited');
  doc.exitPointerLock();
  assert.deepEqual(locks, [true, false]);
  doc.fire('mousemove', { movementX: 50, movementY: 0 });
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual([...held].filter((c) => c.startsWith('Mouse:')), ['Mouse:510:-1'], 'moving the pointer while not held changes nothing');
  delete globalThis.requestAnimationFrame;
});
