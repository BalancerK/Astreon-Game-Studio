# @engine/input

Actions and bindings over keyboard, mouse, gamepad and on-screen touch controls; contexts, rebinding, saving, prompts.

```
npm install @engine/input
```

Version 0.1.0. The package's own README ([packages/input](../../packages/input/README.md)) explains how the pieces fit together; this page lists every export.

## Contents (25 of 25 documented)

| Name | Kind | Summary |
|---|---|---|
| [`ACCEPTS`](#accepts) | constant | Which binding types each kind of action accepts. |
| [`GAMEPAD_AXES`](#gamepad_axes) | constant | Axis numbers of the standard gamepad layout: `leftX`, `leftY`, `rightX`, `rightY`. |
| [`GAMEPAD_BUTTONS`](#gamepad_buttons) | constant | Standard-mapping gamepad button names (the W3C layout used by Xbox, PlayStation and most pads). |
| [`GestureRecognizer`](#class-gesturerecognizer) | class | Gestures from raw pointers: tap, double tap, long press, swipe, one- and two-finger pan, pinch and rotate. |
| [`InputCore`](#class-inputcore) | class | Device-independent input. |
| [`StrokeRecorder`](#class-strokerecorder) | class | Records strokes. |
| [`TouchController`](#class-touchcontroller) | class | Tracks fingers against a layout and reports to an InputCore (`touchStick`, `touchButton`, `touchLook`). |
| [`applyDeadzone1d`](#applydeadzone1d) | function | The one-axis version of `applyDeadzone2d`. |
| [`applyDeadzone2d`](#applydeadzone2d) | function | Radial dead zone with the remaining range stretched back to 0..1, then an optional response curve (exponent 2 = finer control near the centre). |
| [`attachGamepads`](#attachgamepads) | function | Gamepads: nothing to listen to, the browser is polled once per `core.update()`. |
| [`attachGestures`](#attachgestures) | function | Feed a page's pointer events to a recognizer (touch, pen and, with `includeMouse`, mouse), keep the browser from scrolling or zooming the element (`touch-action: none`), and run its long-press timer. |
| [`attachKeyboard`](#attachkeyboard) | function | Keyboard. |
| [`attachMouse`](#attachmouse) | function | Mouse: buttons, wheel and movement. |
| [`attachPen`](#attachpen) | function | A pen (stylus) on a touch screen or a tablet: pressure, tilt, twist, the side button and the eraser end go to `core.penUpdate`, where `penPressure`, `penTilt`, `penContact`, `penBarrel` and `penEraser` bindings read them. |
| [`attachPenStrokes`](#attachpenstrokes) | function | Feed a page's pointer events to a stroke recorder (pen, and `touch` / `mouse` if asked for), including the extra samples a pen reports between frames. |
| [`attachTouch`](#attachtouch) | function | On-screen touch controls. |
| [`createInput`](#createinput) | function | Everything in one call for a browser game: an `InputCore` with keyboard, mouse, gamepads and (optionally) on-screen touch controls attached. |
| [`createTouchOverlay`](#createtouchoverlay) | function | Draw the controls with plain DOM elements over a container (so it needs no renderer). |
| [`describeBinding`](#describebinding) | function | What to show the player for a binding ("W", "Left Click", "Gamepad A", "Left stick"). |
| [`deviceOf`](#deviceof) | function | Which device a binding belongs to. |
| [`keyLabel`](#keylabel) | function | A short readable name for a key code: 'KeyW' is 'W', 'Digit1' is '1', 'ArrowUp' is 'Up'. |
| [`penWidth`](#penwidth) | function | The width of a brush at a pressure: `min` at 0 to `max` at 1, with `curve` above 1 making a light touch lighter (a pen that feels harder) and below 1 making it heavier. |
| [`sameControl`](#samecontrol) | function | Two bindings that read the same control (for finding clashes when rebinding). |
| [`shooterTouchLayout`](#shootertouchlayout) | function | A ready-made layout for a first-person game: a floating stick on the left, drag-to-look on the right, buttons fire / jump / run. |
| [`validateBinding`](#validatebinding) | function | Check a binding for an action type. |

## Functions

### `applyDeadzone1d`

```js
function applyDeadzone1d(v, deadzone = 0.15, curve = 1)
```

The one-axis version of `applyDeadzone2d`.

<sub>src/core.js:13</sub>

### `applyDeadzone2d`

```js
function applyDeadzone2d(x, y, deadzone = 0.15, curve = 1, out = { x: 0, y: 0 })
```

Radial dead zone with the remaining range stretched back to 0..1, then an optional response curve (exponent 2 = finer control near the centre).

<sub>src/core.js:4</sub>

### `attachGamepads`

```js
function attachGamepads(core, nav = globalThis.navigator)
```

Gamepads: nothing to listen to, the browser is polled once per `core.update()`.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `core` | `import('./core.js').InputCore` |  |
| `nav` (optional) | `{getGamepads?: () => ArrayLike<any>}` |  |

<sub>src/devices.js:124</sub>

### `attachGestures`

```js
function attachGestures(element, recognizer, { includeMouse = false, preventDefault = true } = {})
```

Feed a page's pointer events to a recognizer (touch, pen and, with `includeMouse`, mouse), keep the browser from scrolling or zooming the element (`touch-action: none`), and run its
long-press timer. Returns `{detach}`.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `element` | `HTMLElement` |  |
| `recognizer` | `GestureRecognizer` |  |
| `o` (optional) | `{includeMouse?: boolean, preventDefault?: boolean}` |  |

<sub>src/gestures.js:159</sub>

### `attachKeyboard`

```js
function attachKeyboard(core, target = globalThis)
```

Keyboard. Keys the game uses are kept from scrolling the page or triggering browser shortcuts (Space, arrows, Tab...), except
while the player is typing in a text field. Losing focus lets go of everything, so no key stays stuck.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `core` | `import('./core.js').InputCore` |  |
| `target` (optional) | `EventTarget` |  |

<sub>src/devices.js:14</sub>

### `attachMouse`

```js
function attachMouse(core, element, { pointerLock = false, requireLock = false } = {})
```

Mouse: buttons, wheel and movement. With `pointerLock`, movement counts only while the pointer is locked (an endless turn: what a
first-person game wants); `lock()` asks for the lock, which browsers only grant in answer to a click.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `core` | `import('./core.js').InputCore` |  |
| `element` | `HTMLElement` |  |
| `o` (optional) | `{pointerLock?: boolean, requireLock?: boolean}` | `requireLock`: ignore buttons and wheel until the pointer is locked (so the click that locks it does not also fire). |

**Returns** `{detach: () => void, lock: () => Promise<boolean>, options: {pointerLock: boolean, requireLock: boolean}, readonly locked: boolean}`

<sub>src/devices.js:45</sub>

### `attachPen`

```js
function attachPen(core, element)
```

A pen (stylus) on a touch screen or a tablet: pressure, tilt, twist, the side button and the eraser end go to `core.penUpdate`, where `penPressure`, `penTilt`, `penContact`, `penBarrel` and
`penEraser` bindings read them. A pen also still counts as the mouse's left button, so menus and clicks work with it. Only pen pointers are used.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `core` | `import('./core.js').InputCore` |  |
| `element` | `HTMLElement` |  |

<sub>src/devices.js:98</sub>

### `attachPenStrokes`

```js
function attachPenStrokes(element, recorder, { pointerTypes = ['pen'], preventDefault = true } = {})
```

Feed a page's pointer events to a stroke recorder (pen, and `touch` / `mouse` if asked for), including the extra samples a pen reports between frames. Sets `touch-action: none` on the element.
The positions are relative to the element.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `element` | `HTMLElement` |  |
| `recorder` | `StrokeRecorder` |  |
| `o` (optional) | `{pointerTypes?: string[], preventDefault?: boolean}` | `pointerTypes` defaults to `['pen']`. |

<sub>src/pen.js:84</sub>

### `attachTouch`

```js
function attachTouch(core, element, layout, { overlay = true, includeMouse = false } = {})
```

On-screen touch controls. Only touch and pen pointers drive them (a mouse does not), unless `includeMouse` is set (for trying a
layout on a desktop).

**Parameters**

| Name | Type | Description |
|---|---|---|
| `core` | `import('./core.js').InputCore` |  |
| `element` | `HTMLElement` | The area the controls live in (usually the game's container) |
| `layout` (optional) | `(w: number, h: number) => import('./touch.js').TouchControl[]` |  |
| `o` (optional) | `{overlay?: boolean, includeMouse?: boolean}` | `overlay`: draw the controls (default true) |

**Returns** `{controller: TouchController, detach: () => void}`

<sub>src/devices.js:138</sub>

### `createInput`

```js
function createInput({ actions, element, contexts, pointerLock = false, requireLock = false, touch = false, touchOverlay = true, pen = false, deadzone } = {})
```

Everything in one call for a browser game: an `InputCore` with keyboard, mouse, gamepads and (optionally) on-screen touch controls attached.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `o` | `object` |  |
| `o.actions` | `Record<string, import('./core.js').ActionDefinition>` |  |
| `o.element` | `HTMLElement` | The game's element (mouse and touch listen here) |
| `o.contexts` (optional) | `Record<string, {blocking?: boolean}>` |  |
| `o.pointerLock` (optional) | `boolean` | Mouse look uses a locked pointer: the view turns only while it is locked |
| `o.requireLock` (optional) | `boolean` | Mouse buttons and wheel count only while it is locked (so the click that locks it is not also a shot) |
| `o.touch` (optional) | `((w: number, h: number) => import('./touch.js').TouchControl[]) \| false` | A touch layout, or false for none (default: none) |
| `o.touchOverlay` (optional) | `boolean` | Draw the touch controls (default true) |
| `o.pen` (optional) | `boolean` | Read a pen's pressure, tilt and buttons (default false): see `penPressure` and the other `pen...` bindings |
| `o.deadzone` (optional) | `number` |  |

**Returns** `{input: InputCore, mouse: ReturnType<typeof attachMouse>, touch: ReturnType<typeof attachTouch> \| null, detach: () => void}`

<sub>src/index.js:25</sub>

### `createTouchOverlay`

```js
function createTouchOverlay(container, controller)
```

Draw the controls with plain DOM elements over a container (so it needs no renderer). Returns an object with `update()` (called
automatically on changes) and `destroy()`.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `container` | `HTMLElement` | Positioned element the controls are placed in (their coordinates are relative to it) |
| `controller` | `TouchController` |  |

<sub>src/touch.js:148</sub>

### `describeBinding`

```js
function describeBinding(b)
```

What to show the player for a binding ("W", "Left Click", "Gamepad A", "Left stick").

<sub>src/bindings.js:128</sub>

### `deviceOf`

```js
function deviceOf(b)
```

Which device a binding belongs to.

<sub>src/bindings.js:96</sub>

### `keyLabel`

```js
function keyLabel(code)
```

A short readable name for a key code: 'KeyW' is 'W', 'Digit1' is '1', 'ArrowUp' is 'Up'.

<sub>src/bindings.js:113</sub>

### `penWidth`

```js
function penWidth(pressure, min, max, curve = 1)
```

The width of a brush at a pressure: `min` at 0 to `max` at 1, with `curve` above 1 making a light touch lighter (a pen that feels harder) and below 1 making it heavier.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `pressure` | `number` | 0..1 |
| `min` | `number` |  |
| `max` | `number` |  |
| `curve` (optional) | `number` |  |

<sub>src/pen.js:12</sub>

### `sameControl`

```js
function sameControl(a, b)
```

Two bindings that read the same control (for finding clashes when rebinding).

<sub>src/bindings.js:77</sub>

### `shooterTouchLayout`

```js
function shooterTouchLayout(w, h)
```

A ready-made layout for a first-person game: a floating stick on the left, drag-to-look on the right, buttons fire / jump / run.

<sub>src/touch.js:25</sub>

### `validateBinding`

```js
function validateBinding(actionType, b)
```

Check a binding for an action type.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `actionType` | `'button' \| 'axis' \| 'vector2'` |  |
| `b` | `any` |  |

**Returns** `string \| null` — what is wrong, or null

<sub>src/bindings.js:49</sub>

## Classes

### `class GestureRecognizer`

```js
class GestureRecognizer
```

Gestures from raw pointers: tap, double tap, long press, swipe, one- and two-finger pan, pinch and rotate. It works on plain numbers (an id, a position, a time in milliseconds), so a touch
screen, a pen, a mouse, a test and a replay all feed it the same way; `attachGestures` connects a page.

One pointer: a short press without moving is a `tap` (a second one close in time and place is a tap with `count: 2`); held still it becomes a `longpress`; dragged it is a `pan`, and a
quick, long enough flick that ends the pan is also a `swipe`. Two pointers: a `pan` of their centre, a `pinch` (the scale of the distance between them) and a `rotate` (the turn of the line
between them). Putting a second finger down cancels a tap in progress.

Gesture objects: `{type, x, y, ...}` where x and y are where it happened (the centre, for two fingers). `pan`, `pinch` and `rotate` carry a `phase` of `'start'`, `'move'` or `'end'`.

#### `GestureRecognizer.constructor`

```js
constructor({ tapMs = 250, tapSlop = 10, doubleTapMs = 300, doubleTapSlop = 30, longPressMs = 500, swipeMinDistance = 40, swipeMaxMs = 500, swipeMinSpeed = 250, pinchSlop = 8, rotateSlop = 0.12, onGesture = null } = {})
```

| Name | Type | Description |
|---|---|---|
| `o` (optional) | `object` |  |
| `o.tapMs` (optional) | `number` | A press shorter than this, without moving, is a tap (250). |
| `o.tapSlop` (optional) | `number` | How far (pixels) a finger may wander and still be a tap or a long press (10). |
| `o.doubleTapMs` (optional) | `number` | Longest gap between the two taps of a double tap (300). |
| `o.doubleTapSlop` (optional) | `number` | How far apart they may be (30). |
| `o.longPressMs` (optional) | `number` | How long a finger held still becomes a long press (500). |
| `o.swipeMinDistance` (optional) | `number` | A flick shorter than this (pixels) is not a swipe (40). |
| `o.swipeMaxMs` (optional) | `number` | A flick slower than this in total is not a swipe (500). |
| `o.swipeMinSpeed` (optional) | `number` | Pixels per second at the end (250). |
| `o.pinchSlop` (optional) | `number` | How far the distance between two fingers must change (pixels) before a pinch starts (8). |
| `o.rotateSlop` (optional) | `number` | How far the line between them must turn (radians) before a rotation starts (0.12). |
| `o.onGesture` (optional) | `(g: Gesture) => void` | Called for each gesture. |

#### `GestureRecognizer.on`

```js
on(type, fn)
```

Listen for one kind of gesture (`'tap'`, `'swipe'`, ...), or `'*'` for all. Returns a function that stops listening.

#### `GestureRecognizer.pointerDown`

```js
pointerDown(id, x, y, t, type = 'touch')
```

A pointer went down. `type` is `'touch'`, `'pen'` or `'mouse'`.

#### `GestureRecognizer.pointerMove`

```js
pointerMove(id, x, y, t)
```

A pointer moved.

#### `GestureRecognizer.pointerUp`

```js
pointerUp(id, x, y, t)
```

A pointer lifted.

#### `GestureRecognizer.pointerCancel`

```js
pointerCancel(id)
```

The pointer was taken away (a call, the page lost focus): whatever was in progress ends without a tap or a swipe.

#### `GestureRecognizer.update`

```js
update(t)
```

Call with the current time (milliseconds) now and then (each frame, or from a timer): a finger held still for `longPressMs` becomes a long press. Returns the earliest time it needs calling again, or Infinity.

<sub>src/gestures.js:12</sub>

### `class InputCore`

```js
class InputCore
```

Device-independent input. You describe what the player can DO (actions: jump, fire, move, look) and what controls do it
(bindings: a key, a button, a stick, an on-screen control); the game reads actions once per frame. The core knows nothing
about the browser: adapters (see devices.js) feed it raw events, and tests can feed it directly.

Reading: call `update(dt)` once per frame, then `held('fire')`, `pressed('jump')`, `released(...)`, `value('zoom')`, `vector('move')`.
Vectors from a pointing device or a stick-as-look are per-frame turns in radians (right and up are +); vectors from keys or
sticks are unit vectors (length at most 1).

#### `InputCore.constructor`

```js
constructor({ actions = {}, contexts = {}, deadzone = 0.15, gamepadProvider = null } = {})
```

| Name | Type | Description |
|---|---|---|
| `o` (optional) | `object` |  |
| `o.actions` (optional) | `Record<string, ActionDefinition>` |  |
| `o.contexts` (optional) | `Record<string, {blocking?: boolean}>` | A blocking context hides the ones below it while it is on top (a menu over the game) |
| `o.deadzone` (optional) | `number` | Default dead zone (default 0.15) |
| `o.gamepadProvider` (optional) | `() => ArrayLike<any>` | Returns the connected gamepads (`navigator.getGamepads` in a browser) |

#### `InputCore.defineAction`

```js
defineAction(name, def)
```

Add an action.

| Name | Type | Description |
|---|---|---|
| `name` | `string` |  |
| `def` | `ActionDefinition` |  |

#### `InputCore.action`

```js
action(name)
```

The reading of an action (live object).

#### `InputCore.held`

```js
held(name)
```

#### `InputCore.pressed`

```js
pressed(name)
```

#### `InputCore.released`

```js
released(name)
```

#### `InputCore.value`

```js
value(name)
```

#### `InputCore.vector`

```js
vector(name, out = { x: 0, y: 0 })
```

A vector action as `out` (default: a new object): {x, y}.

#### `InputCore.sample`

```js
sample()
```

Every action's current reading as plain numbers (a button is 0 or 1 or an analog value, an axis a number, a vector [x, y]): handy for sending to a server.

#### `InputCore.defineContext`

```js
defineContext(name, { blocking = false } = {})
```

#### `InputCore.pushContext`

```js
pushContext(name)
```

#### `InputCore.popContext`

```js
popContext()
```

#### `InputCore.setContext`

```js
setContext(name)
```

Replace the whole stack with one context.

#### `InputCore.context`

```js
get context
```

#### `InputCore.keyDown`

```js
keyDown(code)
```

#### `InputCore.keyUp`

```js
keyUp(code)
```

#### `InputCore.mouseButtonDown`

```js
mouseButtonDown(button)
```

#### `InputCore.mouseButtonUp`

```js
mouseButtonUp(button)
```

#### `InputCore.mouseMove`

```js
mouseMove(dx, dy, x = this.mouse.x, y = this.mouse.y)
```

Mouse moved by (dx, dy) pixels (use the pointer-lock movement for a look action) to the position (x, y).

#### `InputCore.mouseWheel`

```js
mouseWheel(dy)
```

Wheel scrolled: negative `dy` is up (away from you).

#### `InputCore.penUpdate`

```js
penUpdate({ x, y, pressure, tiltX, tiltY, twist, inContact, hovering, barrel, eraser } = {})
```

A pen moved, pressed or lifted. `pressure` 0..1, `tiltX` and `tiltY` in degrees (-90..90), `twist` in degrees, `inContact` whether the tip touches, `hovering` whether it is near the screen,
`barrel` the side button, `eraser` the eraser end. Everything not given keeps its last value.

#### `InputCore.touchStick`

```js
touchStick(id, x, y, active)
```

Drive an on-screen stick: x and y in -1..1, y up.

#### `InputCore.touchButton`

```js
touchButton(id, down)
```

#### `InputCore.touchLook`

```js
touchLook(id, dx, dy)
```

Dragging on a look area: (dx, dy) pixels moved, dy down is +.

#### `InputCore.releaseAll`

```js
releaseAll()
```

Let go of everything (the window lost focus, a menu opened): no key stays stuck down.

#### `InputCore.vibrate`

```js
vibrate(durationMs = 100, strong = 0.5, weak = 0.5)
```

Rumble the first pad that can (a hit, an explosion). Strengths 0..1.

#### `InputCore.update`

```js
update(dt = 1 / 60)
```

Work out every action from the raw state. Call once per frame, before the game reads input.

| Name | Type | Description |
|---|---|---|
| `dt` (optional) | `number` | Seconds since the last update (for stick-driven look rates) |

#### `InputCore.bindings`

```js
bindings(action)
```

A copy of an action's bindings.

#### `InputCore.setBindings`

```js
setBindings(action, list)
```

Replace the bindings of an action (validated).

#### `InputCore.rebind`

```js
rebind(action, index, binding)
```

Replace one binding.

| Name | Type | Description |
|---|---|---|
| `index` | `number` |  |

#### `InputCore.addBinding`

```js
addBinding(action, binding)
```

#### `InputCore.removeBinding`

```js
removeBinding(action, index)
```

#### `InputCore.resetBindings`

```js
resetBindings(action)
```

Back to the bindings the action was defined with (one action, or all).

#### `InputCore.findConflicts`

```js
findConflicts(binding, exceptAction)
```

Other actions in the same context that already use a control: for warning before a rebind steals it.

**Returns** `{action: string, index: number}[]`

#### `InputCore.listen`

```js
listen(callback, { devices = ['keyboard', 'mouse', 'gamepad'], cancelKey = 'Escape' } = {})
```

Wait for the player to press something and hand it back as a binding: the "press a key to bind" step of a settings screen.
While listening, no action fires. Escape cancels (the callback gets null).

| Name | Type | Description |
|---|---|---|
| `callback` | `(binding: object \| null) => void` |  |
| `o` (optional) | `{devices?: ('keyboard' \| 'mouse' \| 'gamepad')[], cancelKey?: string}` |  |

**Returns** `() => void` — cancel

#### `InputCore.promptFor`

```js
promptFor(action, device = this.lastDevice)
```

What to show the player for an action: the label of its first binding on `device` (default: the device used last).

#### `InputCore.describe`

```js
describe(action)
```

Labels of every binding of an action.

#### `InputCore.serialize`

```js
serialize()
```

The player's bindings as plain data (save it in localStorage or on a server).

#### `InputCore.load`

```js
load(data)
```

Restore saved bindings. Unknown actions and invalid bindings are skipped, not fatal (a game update may rename things).

**Returns** `{loaded: string[], problems: string[]}`

<sub>src/core.js:50</sub>

### `class StrokeRecorder`

```js
class StrokeRecorder
```

Records strokes.

#### `StrokeRecorder.constructor`

```js
constructor({ minDistance = 0.75, smoothing = 0, keep = true, maxStrokes = 1000, onStart = null, onPoints = null, onEnd = null } = {})
```

| Name | Type | Description |
|---|---|---|
| `o` (optional) | `object` |  |
| `o.minDistance` (optional) | `number` | Samples closer than this (pixels) to the last kept one are dropped, except the last of a stroke (0.75). |
| `o.smoothing` (optional) | `number` | 0 keeps positions exactly; toward 1 each sample is pulled toward the last kept one, rounding off hand jitter (0). Pressure is smoothed the same way. |
| `o.keep` (optional) | `boolean` | Keep finished strokes in `strokes` (default true). |
| `o.maxStrokes` (optional) | `number` | Oldest are dropped past this many (1000). |
| `o.onStart` (optional) | `(stroke: Stroke) => void` |  |
| `o.onPoints` (optional) | `(stroke: Stroke, samples: StrokeSample[]) => void` | Called with the samples just added. |
| `o.onEnd` (optional) | `(stroke: Stroke) => void` |  |

#### `StrokeRecorder.down`

```js
down(id, x, y, { pressure = 0.5, tiltX = 0, tiltY = 0, t = 0, pointerType = 'pen', eraser = false } = {})
```

The pointer touched down. `pointerType` is `'pen'`, `'touch'` or `'mouse'`; `eraser` marks a stroke made with the eraser end.

**Returns** `Stroke`

#### `StrokeRecorder.move`

```js
move(id, x, y, { pressure, tiltX, tiltY, t = 0 } = {}, more = [])
```

The pointer moved while down. `more` holds the extra samples the device reported since the last event (`getCoalescedEvents`), oldest first, each `{x, y, pressure, tiltX, tiltY, t}`.

#### `StrokeRecorder.up`

```js
up(id, x, y, { pressure, t = 0 } = {})
```

The pointer lifted: the stroke is finished (and kept, if `keep`). A stroke that never moved is a dot (one sample).

**Returns** `Stroke \| null`

#### `StrokeRecorder.cancel`

```js
cancel(id)
```

The pointer was cancelled: the stroke is dropped.

#### `StrokeRecorder.clear`

```js
clear()
```

<sub>src/pen.js:18</sub>

### `class TouchController`

```js
class TouchController
```

Tracks fingers against a layout and reports to an InputCore (`touchStick`, `touchButton`, `touchLook`).

#### `TouchController.constructor`

```js
constructor(core, layout = shooterTouchLayout)
```

| Name | Type | Description |
|---|---|---|
| `core` | `import('./core.js').InputCore` |  |
| `layout` | `(w: number, h: number) => TouchControl[]` |  |

#### `TouchController.resize`

```js
resize(w, h)
```

Lay the controls out for a screen size (call on resize and rotation). Fingers already down keep their control.

#### `TouchController.setLayout`

```js
setLayout(layout)
```

#### `TouchController.pointerDown`

```js
pointerDown(id, x, y)
```

A finger touched the screen at (x, y) (pixels from the top left).

**Returns** `boolean` — whether it landed on a control

#### `TouchController.pointerMove`

```js
pointerMove(id, x, y)
```

#### `TouchController.pointerUp`

```js
pointerUp(id)
```

#### `TouchController.cancelAll`

```js
cancelAll()
```

Lift every finger (the page lost focus).

#### `TouchController.visuals`

```js
visuals()
```

What to draw: for each control its geometry and state.

<sub>src/touch.js:39</sub>

## Constants

### `ACCEPTS`

```js
const ACCEPTS
```

Which binding types each kind of action accepts.

Value: `Object.freeze({`

<sub>src/bindings.js:32</sub>

### `GAMEPAD_AXES`

```js
const GAMEPAD_AXES
```

Axis numbers of the standard gamepad layout: `leftX`, `leftY`, `rightX`, `rightY`.

Value: `Object.freeze({ leftX: 0, leftY: 1, rightX: 2, rightY: 3 })`

<sub>src/bindings.js:26</sub>

### `GAMEPAD_BUTTONS`

```js
const GAMEPAD_BUTTONS
```

Standard-mapping gamepad button names (the W3C layout used by Xbox, PlayStation and most pads).

Value: `Object.freeze({`

<sub>src/bindings.js:21</sub>

## Types

### `ActionDefinition`

Type: `Object`

| Name | Type | Description |
|---|---|---|
| `type` | `'button' \| 'axis' \| 'vector2'` |  |
| `bindings` | `object[]` | See bindings.js |
| `context` (optional) | `string` | Which context the action lives in (default 'gameplay') |
| `invertY` (optional) | `boolean` | Flip the vertical part of a vector (look controls) |
| `deadzone` (optional) | `number` | Dead zone for sticks and analog axes (default: the core's) |
| `curve` (optional) | `number` | Response exponent for sticks (default 1: linear) |
| `held` | `boolean` | Button: down right now |
| `pressed` | `boolean` | Button: went down since the last update (a tap shorter than a frame still counts) |
| `released` | `boolean` | Button: went up since the last update |
| `value` | `number` | Button: 0..1 (analog triggers); axis: -1..1 |
| `x` | `number` | Vector: right is + |
| `y` | `number` | Vector: up or forward is + |

### `ActionState`

The current frame's reading of an action (a live object: read it, do not keep it)

Type: `Object`

| Name | Type | Description |
|---|---|---|
| `type` | `'button' \| 'axis' \| 'vector2'` |  |
| `bindings` | `object[]` | See bindings.js |
| `context` (optional) | `string` | Which context the action lives in (default 'gameplay') |
| `invertY` (optional) | `boolean` | Flip the vertical part of a vector (look controls) |
| `deadzone` (optional) | `number` | Dead zone for sticks and analog axes (default: the core's) |
| `curve` (optional) | `number` | Response exponent for sticks (default 1: linear) |
| `held` | `boolean` | Button: down right now |
| `pressed` | `boolean` | Button: went down since the last update (a tap shorter than a frame still counts) |
| `released` | `boolean` | Button: went up since the last update |
| `value` | `number` | Button: 0..1 (analog triggers); axis: -1..1 |
| `x` | `number` | Vector: right is + |
| `y` | `number` | Vector: up or forward is + |

### `Gesture`

Gestures from raw pointers: tap, double tap, long press, swipe, one- and two-finger pan, pinch and rotate. It works on plain numbers (an id, a position, a time in milliseconds), so a touch
screen, a pen, a mouse, a test and a replay all feed it the same way; `attachGestures` connects a page.

One pointer: a short press without moving is a `tap` (a second one close in time and place is a tap with `count: 2`); held still it becomes a `longpress`; dragged it is a `pan`, and a
quick, long enough flick that ends the pan is also a `swipe`. Two pointers: a `pan` of their centre, a `pinch` (the scale of the distance between them) and a `rotate` (the turn of the line
between them). Putting a second finger down cancels a tap in progress.

Gesture objects: `{type, x, y, ...}` where x and y are where it happened (the centre, for two fingers). `pan`, `pinch` and `rotate` carry a `phase` of `'start'`, `'move'` or `'end'`.

Type: `{type: 'tap', x: number, y: number, count: number, pointerType: string} \| {type: 'longpress', x: number, y: number, pointerType: string} \| {type: 'swipe', x: number, y: number, direction: 'left' \| 'right' \| 'up' \| 'down', dx: number, dy: number, distance: number, speed: number} \| {type: 'pan', phase: string, x: number, y: number, dx: number, dy: number, totalX: number, totalY: number, velocityX: number, velocityY: number, pointers: number} \| {type: 'pinch', phase: string, x: number, y: number, scale: number, delta: number} \| {type: 'rotate', phase: string, x: number, y: number, angle: number, delta: number}`

### `Stroke`

Type: `{id: number, pointerType: string, eraser: boolean, samples: StrokeSample[], done: boolean, length: number}`

### `StrokeSample`

A stroke as a pen (or finger, or mouse) draws it: a list of samples with position, pressure, tilt and time. `StrokeRecorder` turns a stream of pointer positions into strokes (thinning out
samples that barely moved, smoothing jitter, keeping the high-rate samples a pen reports between frames), and `penWidth` turns pressure into a brush width. The pieces take plain numbers, so
a test or a replay can draw too; `attachPenStrokes` connects a page.

Type: `{x: number, y: number, pressure: number, tiltX: number, tiltY: number, t: number}`

### `TouchControl`

Type: `{type: 'stick', id: string, region: {x: number, y: number, w: number, h: number}, radius?: number, mode?: 'floating' \| 'fixed', label?: string}   \| {type: 'look', id: string, region: {x: number, y: number, w: number, h: number}}   \| {type: 'button', id: string, cx: number, cy: number, r: number, label?: string}`
