# @engine/input

Input for games that run on a keyboard and mouse, a gamepad or a touch screen, without the game knowing which. You describe what the player can **do** (actions: jump, fire, move, look) and which controls do it (bindings); the game reads actions once per frame. Rebinding, saving, menus over the game and on-screen touch controls are built in. Zero dependencies.

```js
import { createInput, shooterTouchLayout } from '@engine/input';

const { input } = createInput({
  element: canvas,
  pointerLock: true, requireLock: true,           // mouse look while the pointer is captured
  touch: shooterTouchLayout,                      // on-screen controls (omit for desktop only)
  actions: {
    move: { type: 'vector2', bindings: [
      { type: 'keys2d', up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD' },
      { type: 'gamepadStick', stick: 'left' }, { type: 'touchStick', id: 'move' } ] },
    look: { type: 'vector2', bindings: [
      { type: 'mouseDelta', sensitivity: 0.0025 }, { type: 'gamepadStick', stick: 'right', sensitivity: 2.8 }, { type: 'touchLook', id: 'look', sensitivity: 0.005 } ] },
    jump: { type: 'button', bindings: [{ type: 'key', code: 'Space' }, { type: 'gamepadButton', button: 'south' }, { type: 'touchButton', id: 'jump' }] },
  },
});

// once per frame (or per fixed tick):
input.update(dt);
const { x, y } = input.vector('move');          // right and forward are +; a unit vector, however it was made
const turn = input.vector('look');              // radians turned this frame: right and up are +
if (input.pressed('jump')) player.jump();       // also: held('jump'), released('jump'), value('trigger')
```

## Actions and bindings

| Action type | Reads | Bindings it accepts |
|---|---|---|
| `button` | `held`, `pressed`, `released`, `value` (0..1: analog triggers) | `key`, `mouseButton`, `wheel` (a notch), `gamepadButton`, `gamepadAxis` (a stick direction as a button), `touchButton` |
| `axis` | `value` -1..1 | `keys1d` (two keys), `gamepadAxis`, `wheel` |
| `vector2` | `x`, `y` | `keys2d` (four keys, diagonals normalised), `gamepadStick`, `touchStick`, `mouseDelta`, `touchLook` |

- **Edges are never lost.** `pressed` and `released` are tracked from the raw events, so a tap shorter than a frame still registers. A second control joining one that is already held is not a new press; auto-repeat is ignored.
- **Sticks** get a radial dead zone with the usable range stretched back to 0..1 (`deadzone`, default 0.15) and an optional response `curve` (2 = finer control near the centre). Pushing a stick away from you is +y, like keys and touch. A stick with `sensitivity` is a **rate** (radians per second at full tilt, multiplied by `dt`), so a look stick turns at the same speed at any frame rate; the mouse and touch drags are per-frame turns (radians per pixel). `invertY` flips the vertical part.
- **Several controls per action**, and several gamepads at once (the pad with the most deflection counts). Gamepad buttons have names for the standard layout (`south`, `east`, `rightTrigger`, `dpadUp`, ...) or indices; `vibrate(ms, strong, weak)` rumbles.
- **Gamepads** are polled (`navigator.getGamepads`) in `update()`; disconnected pads are ignored.

## Contexts

Actions live in a context (`gameplay` by default). `pushContext('menu')` / `popContext()` switch which actions are active: a **blocking** context (declare it with `contexts: { menu: { blocking: true } }`) hides everything below it, so a menu over the game does not also jump when you press Space. Inactive actions read neutral, and a key still held when you come back is not a fresh press.

## Rebinding and saving

- `rebind(action, index, binding)`, `addBinding`, `removeBinding`, `setBindings`, `resetBindings(action?)`; every change is validated against what the action accepts (a button cannot take a stick), with a clear error.
- `findConflicts(binding, exceptAction)` lists other actions in the same context already using a control, so a settings screen can warn before stealing it.
- `listen(callback, { devices })` is the "press a key to bind" step: the next key, mouse button, pad button or stick push is handed back as a binding (Escape gives `null`), and nothing fires in the game meanwhile.
- `serialize()` / `load(data)` give plain JSON to keep in `localStorage` or on a server. Loading skips unknown actions and invalid bindings and reports them instead of failing, so a game update that renames an action does not lose the player's other settings.
- `describeBinding(b)` and `promptFor(action)` give readable labels ("W A S D", "Left Click", "Gamepad A", "Touch stick") for on-screen prompts, using the device the player used last (`input.lastDevice`, `onDeviceChange`).

## Pen and gestures

**A pen** (stylus on a tablet or touch screen): `createInput({ pen: true })` (or `attachPen(input, element)`) feeds pressure, tilt, twist, the side button and the eraser end to the action system, so they are bound like any other control: `penPressure` (an axis, 0 to 1), `penTilt` (a vector, each way -1 to 1 for -90 to 90 degrees; y is up), and the buttons `penContact` (the tip touches), `penBarrel` and `penEraser`. A pen still also counts as the mouse's left button, so menus work with it. For drawing, `StrokeRecorder` turns the stream into strokes of samples (position, pressure, tilt, time), thins out samples that barely moved, optionally smooths hand jitter, keeps the extra high-rate samples a pen reports between frames, and calls `onStart` / `onPoints` / `onEnd`; `penWidth(pressure, min, max, curve)` makes a brush width; `attachPenStrokes(element, recorder)` connects a page.

```js
const strokes = new StrokeRecorder({ smoothing: 0.3, onPoints: (stroke, samples) => paint(stroke, samples) });
attachPenStrokes(canvas, strokes);                          // pen only; add pointerTypes: ['pen', 'touch'] for fingers too
```

**Gestures:** `GestureRecognizer` finds `tap` (with `count: 2` for a double tap), `longpress`, `swipe` (`direction`, `distance`, `speed`), `pan` (one or two fingers, with `phase`, movement, total and velocity), `pinch` (`scale` and the change since the last event) and `rotate` (`angle`) from plain pointer numbers (an id, a position, a time in milliseconds), so a touch screen, a pen, a mouse, a test and a replay all feed it alike. All the distances and times are options (`tapMs`, `tapSlop`, `longPressMs`, `swipeMinSpeed`, ...). `attachGestures(element, recognizer)` connects a page, sets `touch-action: none` and runs the long-press timer.

```js
const gestures = new GestureRecognizer({ onGesture: (g) => { if (g.type === 'pinch') camera.zoom *= g.delta; if (g.type === 'tap' && g.count === 2) resetView(); } });
attachGestures(canvas, gestures);
```

A second finger cancels a tap in progress, a long press is not also a tap, and a cancelled pointer (a call, the page losing focus) ends what was going on without a tap or a swipe. Not done: a pen's hover distance and azimuth/altitude (tilt covers the lean), palm rejection, and handwriting recognition.

## Touch controls

`attachTouch` (or `touch: layout` in `createInput`) turns pointer events from fingers into a virtual **stick** (floating, starting wherever the finger lands, or fixed), **look areas** (drag to turn) and **buttons**, tracking each finger separately so you can walk, look and fire at once. A layout is a function of the screen size, so it follows rotation and resizing; buttons win over sticks, which win over look areas where they overlap. `shooterTouchLayout` is ready for a first-person game; the controls are drawn with plain DOM elements (`overlay: false` to draw your own from `controller.visuals()`). Only touch and pen pointers drive them, not the mouse.

## In the browser

`createInput` attaches the keyboard (keys the game uses do not scroll the page; typing in a text field is left alone; losing focus lets go of everything so no key sticks), the mouse (buttons, wheel, movement, pointer lock with `lock()` which tells you if the browser granted it) and the gamepads. The core (`InputCore`) knows nothing about the browser, so tests and bots feed it directly (`keyDown`, `mouseMove`, `touchStick`, a `gamepadProvider`).

## Tests

- `npm test`: 19 tests covering every action type, edges, dead zones and rates, contexts, rebinding, capture, saving, prompts, validation, the touch controller (floating and fixed sticks, finger tracking, overlap, resize) and the browser adapters with stand-in events.
- `node tools/arena3d-test.js` drives the real 3D arena page in Chrome from a faked gamepad (stick, half push, look stick, A, trigger), from real touch events (a finger drag walks, a drag looks, FIRE and JUMP buttons) and with a real mouse click.

Not done (yet): a ready-made settings screen for rebinding (it comes with the UI toolkit), gamepad axis calibration, haptics beyond `vibrate`, text input and IME handling, gesture recognition (pinch, swipe).
