# @engine/ui

Menus and HUDs on the 2D renderer: flexbox-style layout, buttons, sliders, switches, text fields, lists, themes, keyboard / gamepad / mouse / touch navigation, and ready-made pause, settings (key rebinding) and room-browser screens.

```
npm install @engine/ui
```

Version 0.1.0. The package's own README ([packages/ui](../../packages/ui/README.md)) explains how the pieces fit together; this page lists every export.

## Contents (47 of 47 documented)

| Name | Kind | Summary |
|---|---|---|
| [`Button`](#class-button) | class | A clickable button. |
| [`Choice`](#class-choice) | class | Pick one of several options with the arrow keys, a stick, or by clicking the arrows. |
| [`Control`](#class-control) | class | Shared look of a labelled row: the label on the left, the control in the rest. |
| [`Label`](#class-label) | class | Static text. |
| [`Panel`](#class-panel) | class | A container that draws a panel behind its children. |
| [`ProgressBar`](#class-progressbar) | class | A bar for health, loading, cooldowns. |
| [`ScrollList`](#class-scrolllist) | class | A list of rows to pick from (rooms, saves, servers). |
| [`Separator`](#class-separator) | class | A thin dividing line. |
| [`Slider`](#class-slider) | class | A value between `min` and `max`: drag it, or use left / right. |
| [`Spacer`](#class-spacer) | class | Empty space that takes the remaining room (or a fixed size). |
| [`TextInput`](#class-textinput) | class | A single line of editable text with a caret and selection. |
| [`Toggle`](#class-toggle) | class | An on / off switch. |
| [`Ui`](#class-ui) | class | Immediate-feeling, retained-mode UI: build a tree of widgets once, change their state when something happens, and call `update(dt)` and `draw()` every frame. |
| [`Widget`](#class-widget) | class | A node in the UI tree. |
| [`accessibilityTree`](#accessibilitytree) | function | Everything on screen as a screen reader should see it: the open screens (each a `dialog`, named by its first heading; only the top modal one and what is above it while a modal screen is open, since what is below is blocked) and the permanent HUD. |
| [`arrange`](#arrange) | function | Place a widget in the box (x, y, w, h) and lay its children out inside it. |
| [`attachAccessibility`](#attachaccessibility) | function | Mirror the UI in the page for assistive technology. |
| [`attachDom`](#attachdom) | function | Connect a `Ui` to a page: pointer, touch, wheel and keyboard events go to the UI, and what the UI uses is kept from the game (so a click on a menu button is not also a shot). |
| [`auditTheme`](#audittheme) | function | Check a theme against the contrast the accessibility guidelines (WCAG 2.1 AA) ask for: text and what it sits on (4.5 to 1), the focus ring against the panel and the controls (3 to 1), and the filled part of a slider against its track (3 to 1). |
| [`bindingRows`](#bindingrows) | function | Rows that rebind button actions: the action's name, its keyboard / mouse control and its gamepad control. |
| [`confirmDialog`](#confirmdialog) | function | A question with two answers. |
| [`contrastRatio`](#contrastratio) | function | The contrast ratio between two colours, 1 (none) to 21 (black on white). |
| [`createCanvasPainter`](#createcanvaspainter) | function | Draw with a 2D canvas context (`CanvasRenderingContext2D`): for a UI over a plain canvas, or an overlay on a game that has no sprite renderer. |
| [`createMenuPump`](#createmenupump) | function | Call `pump.update(dt)` every frame after `input.update(dt)`. |
| [`createRecordingPainter`](#createrecordingpainter) | function | A painter that records what it was asked to draw, with a fixed-width fake font. |
| [`createSpritePainter`](#createspritepainter) | function | Draw into a sprite batch (the engine's 2D renderer), so the UI costs no extra draw calls and works in all three backends. |
| [`createTheme`](#createtheme) | function | A theme from the dark one with your overrides on top (`colors` and `text` merge key by key). |
| [`css`](#css) | function | A CSS colour string (for canvas painters and the DOM). |
| [`darkTheme`](#darktheme) | constant | Everything a widget needs to look like part of one game: colours (packed, see color.js), text sizes and spacing, in logical pixels. |
| [`fade`](#fade) | function | The colour with its alpha scaled (fading a whole widget). |
| [`hex`](#hex) | function | Parse `#rgb`, `#rrggbb` or `#rrggbbaa`. |
| [`highContrastTheme`](#highcontrasttheme) | constant | A theme for players who need strong contrast: white on black, yellow accents, thick borders and focus rings, a taller row. |
| [`lightTheme`](#lighttheme) | constant | A lighter variant, mostly to show that a theme is only data. |
| [`luminance`](#luminance) | function | The relative luminance of a colour, 0 (black) to 1 (white), as the accessibility guidelines (WCAG 2) define it. |
| [`menuActions`](#menuactions) | function | Actions to add to `InputCore` / `createInput({ actions })`. |
| [`menuScreen`](#menuscreen) | function | A vertical menu: a title and a column of buttons. |
| [`mix`](#mix) | function | Blend two colours: `t` 0 gives `a`, 1 gives `b`. |
| [`nameOf`](#nameof) | function | What a widget is called: its `a11y.label`, else its text or label, else (for a text field) its placeholder. |
| [`naturalSize`](#naturalsize) | function | The size a widget would like, given that it may be at most `maxWidth` wide (so wrapped text gets taller as it gets narrower). |
| [`readSafeAreaInsets`](#readsafeareainsets) | function | Safe-area insets (notches, rounded corners, home bars) in CSS pixels, read from `env(safe-area-inset-*)`. |
| [`rgba`](#rgba) | function | Pack red, green, blue and alpha (0..255 each). |
| [`roleOf`](#roleof) | function | The role a widget plays for assistive technology. |
| [`roomBrowser`](#roombrowser) | function | Pick a room (or make one) and a name. |
| [`settingsScreen`](#settingsscreen) | function | A settings screen: tabs of rows. |
| [`speak`](#speak) | function | A sentence for a node, the way a screen reader would say it ("Music volume, slider, 50%"): for text-to-speech without a browser, and for tests. |
| [`unpack`](#unpack) | function | [r, g, b, a] of a packed colour. |
| [`withAlpha`](#withalpha) | function | The same colour with another alpha (0..1 or, when above 1, 0..255). |

## Functions

### `accessibilityTree`

```js
function accessibilityTree(ui)
```

Everything on screen as a screen reader should see it: the open screens (each a `dialog`, named by its first heading; only the top modal one and what is above it while a modal screen is
open, since what is below is blocked) and the permanent HUD. Plain data apart from each node's `widget`.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `ui` | `import('./ui.js').Ui` |  |

**Returns** `{dialogs: A11yNode[], hud: A11yNode[], focused: A11yNode \| null}`

<sub>src/a11y.js:111</sub>

### `arrange`

```js
function arrange(ui, wd, x, y, w, h)
```

Place a widget in the box (x, y, w, h) and lay its children out inside it.

<sub>src/layout.js:42</sub>

### `attachAccessibility`

```js
function attachAccessibility(ui, { document: doc = globalThis.document, host = null, label = 'Game menu', field = null } = {})
```

Mirror the UI in the page for assistive technology. The canvas is invisible to a screen reader; this builds a hidden, always up to date set of real elements with the right ARIA roles
(buttons, switches, sliders, text fields, lists, headings, dialogs) that it can read and operate: activating one clicks the widget, the arrow keys on a slider go through the same key handling
as for everyone else, and moving the screen reader's cursor onto a control moves the UI's focus there. Announcements (`ui.announce`) go to live regions; opening a screen announces its name.
Also sets `ui.reducedMotion` from the system's reduced-motion setting. Call the returned `update()` once a frame (it only touches what changed).

**Parameters**

| Name | Type | Description |
|---|---|---|
| `ui` | `import('./ui.js').Ui` |  |
| `o` (optional) | `object` |  |
| `o.document` (optional) | `Document` |  |
| `o.host` (optional) | `HTMLElement` | Where the mirror is put (default the end of the body). |
| `o.label` (optional) | `string` | What the whole region is called ("Game menu"). |
| `o.field` (optional) | `() => HTMLElement \| null` | The page's hidden text field, if you use `attachDom` (`() => dom.input`), so it can be labelled with the widget it is editing. |

**Returns** `{update: () => void, detach: () => void, element: HTMLElement}`

<sub>src/a11y.js:158</sub>

### `attachDom`

```js
function attachDom(ui, element, { scale = 1, safeArea = true, window: win = globalThis.window } = {})
```

Connect a `Ui` to a page: pointer, touch, wheel and keyboard events go to the UI, and what the UI uses is kept from the game
(so a click on a menu button is not also a shot). Typing goes through a hidden `<input>` so soft keyboards, paste, IME and accents work.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `ui` | `import('./ui.js').Ui` |  |
| `element` | `HTMLElement` | The element the UI covers (events are taken from it; its size is the viewport). |
| `o` (optional) | `object` |  |
| `o.scale` (optional) | `number \| ((width: number, height: number) => number)` | UI zoom, fixed or from the viewport size (bigger on touch screens). |
| `o.safeArea` (optional) | `boolean` | Keep the UI inside notches and home bars (default true). |
| `o.window` (optional) | `Window` |  |

**Returns** `{detach: () => void, resize: () => void, sync: () => void, input: HTMLInputElement \| null}`

<sub>src/dom.js:30</sub>

### `auditTheme`

```js
function auditTheme(theme, { boundaries = false } = {})
```

Check a theme against the contrast the accessibility guidelines (WCAG 2.1 AA) ask for: text and what it sits on (4.5 to 1), the focus ring against the panel and the controls (3 to 1), and the
filled part of a slider against its track (3 to 1). With `boundaries: true` also the border against the panel (3 to 1), for a look that relies on outlines. Disabled text is exempt.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `theme` | `typeof darkTheme` |  |
| `o` (optional) | `{boundaries?: boolean}` |  |

**Returns** `{passes: boolean, checks: {name: string, ratio: number, need: number, ok: boolean}[], failures: {name: string, ratio: number, need: number, ok: boolean}[]}`

<sub>src/theme.js:80</sub>

### `bindingRows`

```js
function bindingRows(ui, { input, actions, status, onChange, slots = [{ id: 'keyboard', title: 'Keyboard / mouse', devices: ['keyboard'] }, { id: 'gamepad', title: 'Gamepad', devices: ['gamepad'] }] })
```

Rows that rebind button actions: the action's name, its keyboard / mouse control and its gamepad control. Click a control, press the
new one (Escape cancels). A control already used by another action is taken from it, and the screen says so.
Only `button` actions are listed (a movement vector is four keys and is set up by the game).

**Parameters**

| Name | Type | Description |
|---|---|---|
| `ui` | `import('./ui.js').Ui` |  |
| `o` | `object` |  |
| `o.input` | `import('../../input/src/core.js').InputCore` |  |
| `o.actions` | `{action: string, label: string}[]` |  |
| `o.status` | `Label` | A label to report conflicts and errors in. |
| `o.onChange` (optional) | `() => void` | Called after any change (save the bindings here). |
| `o.slots` (optional) | `{id: string, title: string, devices: string[]}[]` |  |

<sub>src/screens.js:53</sub>

### `confirmDialog`

```js
function confirmDialog(ui, { title = 'Are you sure?', message = '', confirm = 'OK', cancel = 'Cancel', danger = false, onAnswer })
```

A question with two answers. `onAnswer(true | false)` is called after the dialog closes.

<sub>src/screens.js:29</sub>

### `contrastRatio`

```js
function contrastRatio(a, b, behind = null)
```

The contrast ratio between two colours, 1 (none) to 21 (black on white). Text needs 4.5 to read comfortably (3 for large text, and for the edges and focus rings of controls). A colour
with some transparency is first laid over `behind` (default: the other colour).

<sub>src/color.js:49</sub>

### `createCanvasPainter`

```js
function createCanvasPainter(ctx, { family = 'system-ui, sans-serif', weight = 'normal' } = {})
```

Draw with a 2D canvas context (`CanvasRenderingContext2D`): for a UI over a plain canvas, or an overlay on a game that has no
sprite renderer.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `ctx` | `CanvasRenderingContext2D` |  |
| `o` (optional) | `{family?: string, weight?: string}` |  |

<sub>src/painter.js:79</sub>

### `createMenuPump`

```js
function createMenuPump(ui, input, { repeatDelay = 0.4, repeatRate = 0.11, onPrev, onNext } = {})
```

Call `pump.update(dt)` every frame after `input.update(dt)`. Presses become `ui.navigate / activate / cancel`; a held direction repeats.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `ui` | `import('./ui.js').Ui` |  |
| `input` | `{pressed(a: string): boolean, held(a: string): boolean}` | An `InputCore`. |
| `o` (optional) | `{repeatDelay?: number, repeatRate?: number, onPrev?: () => void, onNext?: () => void}` |  |

<sub>src/input-bridge.js:31</sub>

### `createRecordingPainter`

```js
function createRecordingPainter({ charWidth = 0.6 } = {})
```

A painter that records what it was asked to draw, with a fixed-width fake font. For tests and bots: lay out a screen, press
buttons, and check the commands, without a browser.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `o` (optional) | `{charWidth?: number}` | Width of a character as a fraction of the font size. |

<sub>src/painter.js:45</sub>

### `createSpritePainter`

```js
function createSpritePainter({ batch, dot, font, fontFor })
```

Draw into a sprite batch (the engine's 2D renderer), so the UI costs no extra draw calls and works in all three backends.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `o` | `object` |  |
| `o.batch` | `import('../../render/src/batch.js').SpriteBatch` |  |
| `o.dot` | `object` | An atlas sprite that is plain white (any size; it is stretched). |
| `o.font` (optional) | `import('../../render/src/text.js').Font` | The font; text is scaled to the requested size. |
| `o.fontFor` (optional) | `(size: number) => import('../../render/src/text.js').Font` | Or a font per size (crisper than scaling one font). The batch is not cleared here: clear it yourself at the start of the frame, draw the game's own HUD into it, then call `ui.draw()`. |

**Returns** `import('./ui.js').Painter & {batch: object}`

<sub>src/painter.js:13</sub>

### `createTheme`

```js
function createTheme(overrides = {})
```

A theme from the dark one with your overrides on top (`colors` and `text` merge key by key).

**Parameters**

| Name | Type | Description |
|---|---|---|
| `overrides` (optional) | `object` | same shape as `darkTheme`; `colors` and `text` merge key by key. |

<sub>src/theme.js:33</sub>

### `css`

```js
function css(c)
```

A CSS colour string (for canvas painters and the DOM).

<sub>src/color.js:36</sub>

### `fade`

```js
function fade(c, k)
```

The colour with its alpha scaled (fading a whole widget).

<sub>src/color.js:33</sub>

### `hex`

```js
function hex(s)
```

Parse `#rgb`, `#rrggbb` or `#rrggbbaa`.

<sub>src/color.js:8</sub>

### `luminance`

```js
function luminance(c)
```

The relative luminance of a colour, 0 (black) to 1 (white), as the accessibility guidelines (WCAG 2) define it. Alpha is ignored.

<sub>src/color.js:39</sub>

### `menuActions`

```js
function menuActions(context = 'menu')
```

Actions to add to `InputCore` / `createInput({ actions })`. They live in the `menu` context (declare it with `contexts: { menu: { blocking: true } }`
and push it while a screen is open).

**Parameters**

| Name | Type | Description |
|---|---|---|
| `context` (optional) | `string` |  |

<sub>src/input-bridge.js:10</sub>

### `menuScreen`

```js
function menuScreen(ui, { title = '', subtitle = '', items, width = 320 })
```

A vertical menu: a title and a column of buttons.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `ui` | `import('./ui.js').Ui` |  |
| `o` | `{title?: string, items: {text: string, onClick: () => void, variant?: string, enabled?: boolean}[], width?: number, subtitle?: string}` |  |

<sub>src/screens.js:15</sub>

### `mix`

```js
function mix(a, b, t)
```

Blend two colours: `t` 0 gives `a`, 1 gives `b`.

<sub>src/color.js:27</sub>

### `nameOf`

```js
function nameOf(w, fromSibling = '')
```

What a widget is called: its `a11y.label`, else its text or label, else (for a text field) its placeholder.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `w` | `Widget` |  |
| `fromSibling` (optional) | `string` | The text of the label next to it, if any. |

<sub>src/a11y.js:50</sub>

### `naturalSize`

```js
function naturalSize(ui, wd, maxWidth = Infinity)
```

The size a widget would like, given that it may be at most `maxWidth` wide (so wrapped text gets taller as it gets narrower).

**Returns** `{w: number, h: number}`

<sub>src/layout.js:11</sub>

### `readSafeAreaInsets`

```js
function readSafeAreaInsets(doc = globalThis.document)
```

Safe-area insets (notches, rounded corners, home bars) in CSS pixels, read from `env(safe-area-inset-*)`.
Needs `<meta name="viewport" content="..., viewport-fit=cover">` to be non-zero.

<sub>src/dom.js:7</sub>

### `rgba`

```js
function rgba(r, g, b, a = 255)
```

Pack red, green, blue and alpha (0..255 each).

<sub>src/color.js:5</sub>

### `roleOf`

```js
function roleOf(w)
```

The role a widget plays for assistive technology.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `w` | `Widget` |  |

<sub>src/a11y.js:33</sub>

### `roomBrowser`

```js
function roomBrowser(ui, { fetchRooms, onJoin, title = 'Play online', name = '', roomPattern = /^[a-z0-9_-]{1,24}$/, onName, onClose })
```

Pick a room (or make one) and a name. `fetchRooms()` returns `[{name, players, max?}]`; `onJoin(room, name)` is called with the choice.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `ui` | `import('./ui.js').Ui` |  |
| `o` | `object` |  |
| `o.fetchRooms` | `() => Promise<{name: string, players?: number, max?: number}[]>` |  |
| `o.onJoin` | `(room: string, name: string) => void` |  |
| `o.title` (optional) | `string` |  |
| `o.name` (optional) | `string \| null` | Starting player name; `null` hides the name field (a game without names). |
| `o.roomPattern` (optional) | `RegExp` | What a room name may look like. |
| `o.onName` (optional) | `(name: string) => void` | Called when the name changes (save it). |
| `o.onClose` (optional) | `() => void` |  |

<sub>src/screens.js:195</sub>

### `settingsScreen`

```js
function settingsScreen(ui, { title = 'Settings', tabs, onClose, closeText = 'Back', width = 560 })
```

A settings screen: tabs of rows. A row is one of
`{type: 'slider', label, min, max, step, get, set, format}`, `{type: 'toggle', label, get, set}`, `{type: 'choice', label, options, get, set}`,
`{type: 'text', label, get, set, placeholder, maxLength}`, `{type: 'button', text, onClick}`, `{type: 'label', text}`, `{type: 'separator'}`,
or `{type: 'bindings', input, actions: [{action, label}], onChange}` (see `bindingRows`).

**Parameters**

| Name | Type | Description |
|---|---|---|
| `ui` | `import('./ui.js').Ui` |  |
| `o` | `{title?: string, tabs: {title: string, rows: object[]}[], onClose?: () => void, closeText?: string, width?: number}` |  |

**Returns** `Panel & {showTab(i: number): void, nextTab(): void, prevTab(): void, tab: number}`

<sub>src/screens.js:115</sub>

### `speak`

```js
function speak(n)
```

A sentence for a node, the way a screen reader would say it ("Music volume, slider, 50%"): for text-to-speech without a browser, and for tests.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `n` | `A11yNode` |  |

<sub>src/a11y.js:129</sub>

### `unpack`

```js
function unpack(c)
```

[r, g, b, a] of a packed colour.

<sub>src/color.js:18</sub>

### `withAlpha`

```js
function withAlpha(c, a)
```

The same colour with another alpha (0..1 or, when above 1, 0..255).

<sub>src/color.js:21</sub>

## Classes

### `class Button`

```js
class Button extends Widget
```

A clickable button. Variants: 'normal', 'primary' (the main choice), 'danger'.

#### `Button.constructor`

```js
constructor(text = '', { onClick = null, variant = 'normal', ...style } = {})
```

| Name | Type | Description |
|---|---|---|
| `text` | `string` |  |
| `o` (optional) | `{onClick?: (b: Button) => void, variant?: string} & object` | style keys work too |

#### `Button.text`

```js
get text
```

#### `Button.text`

```js
set text(t)
```

#### `Button.measure`

```js
measure(ui, maxWidth)
```

#### `Button.paint`

```js
paint(ui)
```

#### `Button.pointerUp`

```js
pointerUp(ui, x, y, inside)
```

#### `Button.activate`

```js
activate(ui)
```

<sub>src/widgets.js:24</sub>

### `class Choice`

```js
class Choice extends Control
```

Pick one of several options with the arrow keys, a stick, or by clicking the arrows.

#### `Choice.constructor`

```js
constructor(label, options, index = 0, onChange = null, style = {})
```

| Name | Type | Description |
|---|---|---|
| `label` | `string` |  |
| `options` | `(string \| {value: any, label: string})[]` |  |
| `index` | `number` |  |
| `onChange` (optional) | `(value: any, index: number, c: Choice) => void` |  |

#### `Choice.value`

```js
get value
```

#### `Choice.select`

```js
select(i)
```

#### `Choice.paint`

```js
paint(ui)
```

#### `Choice.zoneAt`

```js
zoneAt(x)
```

#### `Choice.pointerMove`

```js
pointerMove(ui, x)
```

#### `Choice.pointerDown`

```js
pointerDown(ui, x)
```

#### `Choice.pointerUp`

```js
pointerUp(ui, x, y, inside)
```

#### `Choice.navigate`

```js
navigate(ui, dir)
```

#### `Choice.activate`

```js
activate()
```

<sub>src/widgets.js:98</sub>

### `class Control`

```js
class Control extends Widget
```

Shared look of a labelled row: the label on the left, the control in the rest.

#### `Control.constructor`

```js
constructor(label, style = {})
```

#### `Control.label`

```js
get label
```

#### `Control.label`

```js
set label(t)
```

#### `Control.labelWidth`

```js
labelWidth()
```

Width of the label column.

#### `Control.measure`

```js
measure(ui, maxWidth)
```

#### `Control.paintLabel`

```js
paintLabel(ui)
```

#### `Control.area`

```js
area()
```

The box the control itself (not the label) occupies.

<sub>src/widgets.js:56</sub>

### `class Label`

```js
class Label extends Widget
```

Static text. Wraps to the width it is given unless `wrap: false`. Style: `size`, `color`, `align` ('left' | 'center' | 'right').

#### `Label.constructor`

```js
constructor(text = '', style = {})
```

| Name | Type | Description |
|---|---|---|
| `text` | `string` |  |
| `style` (optional) | `object` |  |

#### `Label.text`

```js
get text
```

#### `Label.text`

```js
set text(t)
```

#### `Label.measure`

```js
measure(ui, maxWidth)
```

#### `Label.paint`

```js
paint(ui)
```

<sub>src/widgets.js:7</sub>

### `class Panel`

```js
class Panel extends Widget
```

A container that draws a panel behind its children.

#### `Panel.constructor`

```js
constructor(style = {})
```

| Name | Type | Description |
|---|---|---|
| `style` (optional) | `object` | `background` defaults to the theme's panel colour, `border` to its border colour. |

<sub>src/widget.js:131</sub>

### `class ProgressBar`

```js
class ProgressBar extends Widget
```

A bar for health, loading, cooldowns. `value` is 0..1.

#### `ProgressBar.constructor`

```js
constructor(value = 0, { label = '', color = null, ...style } = {})
```

#### `ProgressBar.measure`

```js
measure()
```

#### `ProgressBar.paint`

```js
paint(ui)
```

<sub>src/widgets.js:135</sub>

### `class ScrollList`

```js
class ScrollList extends Widget
```

A list of rows to pick from (rooms, saves, servers). Scrolls by whole rows, so nothing is ever cut in half.

#### `ScrollList.constructor`

```js
constructor({ items = [], rows = 6, rowHeight = 0, empty = 'Nothing here yet', onSelect = null, onActivate = null, ...style } = {})
```

| Name | Type | Description |
|---|---|---|
| `o` (optional) | `{items?: {text: string, detail?: string, value?: any}[], rows?: number, rowHeight?: number, empty?: string, onSelect?: (item: object, index: number) => void, onActivate?: (item: object, index: number) => void}` |  |

#### `ScrollList.rowHeight`

```js
rowHeight(ui)
```

#### `ScrollList.setItems`

```js
setItems(items, keepSelection = true)
```

#### `ScrollList.selectedItem`

```js
get selectedItem
```

#### `ScrollList.measure`

```js
measure(ui, maxWidth)
```

#### `ScrollList.reveal`

```js
reveal()
```

#### `ScrollList.select`

```js
select(i, notify = true)
```

#### `ScrollList.scrollBy`

```js
scrollBy(rows)
```

#### `ScrollList.paint`

```js
paint(ui)
```

#### `ScrollList.rowAt`

```js
rowAt(ui, y)
```

#### `ScrollList.pointerDown`

```js
pointerDown(ui, x, y)
```

#### `ScrollList.pointerMove`

```js
pointerMove(ui, x, y)
```

#### `ScrollList.pointerUp`

```js
pointerUp(ui, x, y, inside)
```

#### `ScrollList.wheel`

```js
wheel(ui, dy)
```

#### `ScrollList.navigate`

```js
navigate(ui, dir)
```

#### `ScrollList.activate`

```js
activate()
```

<sub>src/controls.js:164</sub>

### `class Separator`

```js
class Separator extends Widget
```

A thin dividing line.

#### `Separator.constructor`

```js
constructor(style = {})
```

#### `Separator.paint`

```js
paint(ui)
```

<sub>src/widgets.js:147</sub>

### `class Slider`

```js
class Slider extends Control
```

A value between `min` and `max`: drag it, or use left / right.

#### `Slider.constructor`

```js
constructor(label, { min = 0, max = 1, step = 0.05, value = min, format = null, onChange = null, ...style } = {})
```

| Name | Type | Description |
|---|---|---|
| `label` | `string` |  |
| `o` (optional) | `{min?: number, max?: number, step?: number, value?: number, format?: (v: number) => string, onChange?: (v: number, s: Slider) => void}` |  |

#### `Slider.value`

```js
get value
```

#### `Slider.value`

```js
set value(v)
```

#### `Slider.set`

```js
set(v, notify = true)
```

Set the value (snapped to `step`); `notify` false changes it without calling `onChange`.

#### `Slider.track`

```js
track()
```

Where the track and its value text are.

#### `Slider.paint`

```js
paint(ui)
```

#### `Slider.fromPointer`

```js
fromPointer(x)
```

#### `Slider.pointerDown`

```js
pointerDown(ui, x)
```

#### `Slider.pointerMove`

```js
pointerMove(ui, x)
```

#### `Slider.pointerUp`

```js
pointerUp()
```

#### `Slider.wheel`

```js
wheel(ui, dy)
```

#### `Slider.navigate`

```js
navigate(ui, dir)
```

<sub>src/controls.js:7</sub>

### `class Spacer`

```js
class Spacer extends Widget
```

Empty space that takes the remaining room (or a fixed size).

#### `Spacer.constructor`

```js
constructor(sizeOrStyle = {})
```

<sub>src/widget.js:139</sub>

### `class TextInput`

```js
class TextInput extends Widget
```

A single line of editable text with a caret and selection. In a browser the page's own text field does the typing (so mobile
keyboards, IME, paste and accents work; see `attachDom`); the widget just shows the state and also accepts `ui.text()` / `ui.key()`
from tests and bots.

#### `TextInput.constructor`

```js
constructor({ value = '', placeholder = '', maxLength = 200, filter = null, password = false, onChange = null, onSubmit = null, ...style } = {})
```

| Name | Type | Description |
|---|---|---|
| `o` (optional) | `{value?: string, placeholder?: string, maxLength?: number, filter?: RegExp, password?: boolean, onChange?: (v: string) => void, onSubmit?: (v: string) => void}` |  |

#### `TextInput.value`

```js
get value
```

#### `TextInput.value`

```js
set value(v)
```

#### `TextInput.set`

```js
set(v, notify = true, caret = null, anchor = null)
```

Replace the text (and put the caret at the end, or at `caret`).

#### `TextInput.select`

```js
select(anchor, caret = anchor)
```

Select a range (anchor and caret are character positions).

#### `TextInput.selection`

```js
get selection
```

#### `TextInput.insert`

```js
insert(str)
```

Type text at the caret, replacing the selection.

#### `TextInput.measure`

```js
measure(ui)
```

#### `TextInput.shown_`

```js
shown_(ui)
```

#### `TextInput.window`

```js
window(ui)
```

First and last visible character so the caret stays inside the box.

#### `TextInput.paint`

```js
paint(ui)
```

#### `TextInput.indexAt`

```js
indexAt(ui, x)
```

Character position nearest to x.

#### `TextInput.pointerDown`

```js
pointerDown(ui, x)
```

#### `TextInput.pointerMove`

```js
pointerMove(ui, x)
```

#### `TextInput.pointerUp`

```js
pointerUp()
```

#### `TextInput.onFocus`

```js
onFocus(ui, focused)
```

#### `TextInput.key`

```js
key(ui, code, mods = {})
```

<sub>src/controls.js:63</sub>

### `class Toggle`

```js
class Toggle extends Control
```

An on / off switch.

#### `Toggle.constructor`

```js
constructor(label, value = false, onChange = null, style = {})
```

| Name | Type | Description |
|---|---|---|
| `label` | `string` |  |
| `value` | `boolean` |  |
| `onChange` (optional) | `(value: boolean, t: Toggle) => void` |  |

#### `Toggle.set`

```js
set(v)
```

#### `Toggle.paint`

```js
paint(ui)
```

#### `Toggle.pointerUp`

```js
pointerUp(ui, x, y, inside)
```

#### `Toggle.activate`

```js
activate()
```

#### `Toggle.navigate`

```js
navigate(ui, dir)
```

<sub>src/widgets.js:78</sub>

### `class Ui`

```js
class Ui
```

Immediate-feeling, retained-mode UI: build a tree of widgets once, change their state when something happens, and call
`update(dt)` and `draw()` every frame. Screens (menus, dialogs) stack on top of the game; a `hud` layer holds permanent widgets.

Input comes from `pointerDown/Move/Up`, `wheel`, `key`, `text` and the gamepad-style `navigate / activate / cancel`; every one
returns whether the UI used it, so the game can ignore what the UI took. `attachDom` wires all this to a page.

#### `Ui.constructor`

```js
constructor({ painter, theme = darkTheme, width = 1280, height = 720, scale = 1 } = {})
```

| Name | Type | Description |
|---|---|---|
| `o` | `object` |  |
| `o.painter` | `Painter` |  |
| `o.theme` (optional) | `import('./theme.js').Theme` |  |
| `o.width` (optional) | `number` | Viewport in CSS pixels. |
| `o.height` (optional) | `number` |  |
| `o.scale` (optional) | `number` | UI zoom: 1.25 makes everything a quarter bigger (touch screens). |

#### `Ui.setTextScale`

```js
setTextScale(k)
```

Draw all text this much bigger (and lay the screens out again to fit it). 1 is normal; 1.25, 1.5 and 2 are common choices.

#### `Ui.announce`

```js
announce(text, { assertive = false } = {})
```

Say something to players who cannot see the screen (a screen reader, or whatever `onAnnounce` speaks with). `assertive` interrupts what is being said (use it for danger, not for news).

#### `Ui.setViewport`

```js
setViewport(width, height, scale = this.scale, insets = this.insets)
```

| Name | Type | Description |
|---|---|---|
| `width` | `number` | CSS pixels |
| `height` | `number` |  |
| `scale` (optional) | `number` |  |
| `insets` (optional) | `{top?: number, right?: number, bottom?: number, left?: number}` | safe area (notches) |

#### `Ui.logicalWidth`

```js
get logicalWidth
```

#### `Ui.logicalHeight`

```js
get logicalHeight
```

#### `Ui.isOpen`

```js
get isOpen
```

True while any screen is open.

#### `Ui.isModal`

```js
get isModal
```

True while a modal screen is open: the game should not react to input.

#### `Ui.push`

```js
push(widget, { modal = true, dim = modal, dismissable = true, dismissOnBackdrop = false, onCancel, onClose, focus } = {})
```

Open a screen on top of everything.

| Name | Type | Description |
|---|---|---|
| `widget` | `Widget` | Its `anchor` style places it ('center' by default). |
| `o` (optional) | `object` |  |
| `o.modal` (optional) | `boolean` | Blocks input to everything below (default true). |
| `o.dim` (optional) | `boolean` | Darken what is behind (default true when modal). |
| `o.dismissable` (optional) | `boolean` | Escape / B / cancel closes it (default true). |
| `o.dismissOnBackdrop` (optional) | `boolean` | A click outside the screen closes it. |
| `o.onCancel` (optional) | `() => (boolean \| void)` | Called before a dismissal; return false to keep the screen open. |
| `o.onClose` (optional) | `() => void` |  |
| `o.focus` (optional) | `Widget` | Initially focused widget (default: the first focusable one). |

**Returns** `{close: () => void, widget: Widget}`

#### `Ui.close`

```js
close(widget)
```

Close the top screen (or the one holding `widget`).

#### `Ui.closeAll`

```js
closeAll()
```

#### `Ui.update`

```js
update(dt)
```

Advance time and lay out whatever changed.

#### `Ui.layout`

```js
layout()
```

#### `Ui.draw`

```js
draw()
```

Draw everything into the painter.

#### `Ui.fill`

```js
fill(x, y, w, h, color, radius = 0)
```

#### `Ui.stroke`

```js
stroke(x, y, w, h, color, thickness = 1)
```

An outline drawn inside the box.

#### `Ui.text`

```js
text(str, x, y, { size = this.theme.text.size, color = this.theme.colors.text, align = 'left', maxWidth, shadow = false } = {})
```

Text with its top-left (or top-centre / top-right, per `align`) at (x, y).

#### `Ui.textCentered`

```js
textCentered(str, cx, cy, o = {})
```

Text vertically centred on `cy`; horizontally centred on `cx` unless `align` says `cx` is the left or right edge.

#### `Ui.measureText`

```js
measureText(str, { size = this.theme.text.size, maxWidth = Infinity } = {})
```

#### `Ui.lineHeight`

```js
lineHeight(size = this.theme.text.size)
```

#### `Ui.focusRing`

```js
focusRing(w)
```

#### `Ui.setFocus`

```js
setFocus(w)
```

#### `Ui.noteDevice`

```js
noteDevice(device)
```

Tell the UI which kind of device the player is using: keyboard and gamepad show the focus ring.

#### `Ui.textTarget`

```js
get textTarget
```

#### `Ui.moveFocus`

```js
moveFocus(step)
```

#### `Ui.navigate`

```js
navigate(dir)
```

Move focus (or adjust the focused widget) in a direction: 'up' | 'down' | 'left' | 'right'. Returns true if anything happened.

#### `Ui.activate`

```js
activate()
```

Enter / Space / gamepad A on the focused widget.

#### `Ui.cancel`

```js
cancel()
```

Escape / gamepad B: close the top screen, if it may be dismissed.

#### `Ui.key`

```js
key(code, mods = {})
```

A key press (a `KeyboardEvent.code`). Returns true if the UI used it. While a modal screen is open the UI keeps all keys.

| Name | Type | Description |
|---|---|---|
| `code` | `string` |  |
| `mods` (optional) | `{shift?: boolean, ctrl?: boolean, alt?: boolean}` |  |

#### `Ui.insertText`

```js
insertText(str)
```

Typed text for the focused text field.

#### `Ui.wantsPointer`

```js
wantsPointer(x, y)
```

Would a pointer at this CSS-pixel position land on the UI (so the game should leave it alone)?

#### `Ui.pointerDown`

```js
pointerDown(x, y, id = 0, type = 'mouse')
```

**Returns** `boolean` — true if the UI used it

#### `Ui.pointerMove`

```js
pointerMove(x, y, id = 0)
```

#### `Ui.pointerUp`

```js
pointerUp(x, y, id = 0)
```

#### `Ui.pointerCancel`

```js
pointerCancel(id = 0)
```

#### `Ui.wheel`

```js
wheel(x, y, dy)
```

The wheel turned at a position; the widget under it (or a parent) may use it.

<sub>src/ui.js:24</sub>

### `class Widget`

```js
class Widget
```

A node in the UI tree. Containers lay their children out (see layout.js); leaf widgets (label, button, ...) measure and draw
themselves. Everything is in logical pixels; the `Ui` applies the scale.

Style (all optional):
- `direction`: 'column' (default), 'row' or 'stack' (children overlap, placed by `anchor`).
- `gap`, `padding` (number, [vertical, horizontal] or [top, right, bottom, left]).
- `align`: cross axis, 'stretch' (default), 'start', 'center', 'end'. `justify`: main axis, 'start' (default), 'center', 'end', 'between'.
- `width` / `height`: a number, or 'fill' (take the free space); `grow`: share of free space along the parent's main axis;
  `minWidth`, `minHeight`, `maxWidth`, `maxHeight`; `alignSelf` overrides the parent's `align` for this child.
- `anchor` (children of a 'stack'): 'fill' (default), 'center', 'top', 'bottom', 'left', 'right', 'top-left', 'top-right', 'bottom-left', 'bottom-right'; `offsetX`, `offsetY`.
- `background`, `border`: packed colours (or true for the theme's panel colours); `radius`.

#### `Widget.constructor`

```js
constructor(style = {})
```

| Name | Type | Description |
|---|---|---|
| `style` (optional) | `object` |  |

#### `Widget.add`

```js
add(...kids)
```

Add children (arrays and null/false are accepted, so `add(cond && widget)` works).

#### `Widget.remove`

```js
remove(kid)
```

#### `Widget.clear`

```js
clear()
```

#### `Widget.root`

```js
root()
```

#### `Widget.invalidate`

```js
invalidate()
```

Ask for a new layout (a size-affecting change happened).

#### `Widget.walk`

```js
walk(fn)
```

Visit this widget and every descendant (parents first); return false from `fn` to skip the children.

#### `Widget.find`

```js
find(id)
```

#### `Widget.shown`

```js
get shown
```

True when this widget and all its ancestors are shown.

#### `Widget.setVisible`

```js
setVisible(v)
```

#### `Widget.setEnabled`

```js
setEnabled(v)
```

#### `Widget.pad`

```js
get pad
```

Padding as {t, r, b, l}.

#### `Widget.contains`

```js
contains(px, py)
```

Is the point inside this widget's box?

#### `Widget.measure`

```js
measure(ui, maxWidth)
```

Natural size of the content (without padding) when it may be at most `maxWidth` wide. Containers need not override.

#### `Widget.paint`

```js
paint(ui)
```

Draw this widget's own content (the background is already drawn).

#### `Widget.draw`

```js
draw(ui)
```

Draw background, own content, children.

#### `Widget.pointerDown`

```js
pointerDown(ui, x, y)
```

Pointer pressed on this widget (coordinates are logical).

#### `Widget.pointerMove`

```js
pointerMove(ui, x, y)
```

The pointer moved while this widget has it captured.

#### `Widget.pointerUp`

```js
pointerUp(ui, x, y, inside)
```

Released; `inside` says whether it is still over the widget (a click).

#### `Widget.wheel`

```js
wheel(ui, dy)
```

The mouse wheel turned over this widget; return true if it was used.

#### `Widget.navigate`

```js
navigate(ui, dir)
```

A direction key / stick push while focused; return true if used (a slider takes left and right).

#### `Widget.activate`

```js
activate(ui)
```

Enter / Space / gamepad A while focused.

#### `Widget.key`

```js
key(ui, code, mods)
```

A key while focused; return true if used.

#### `Widget.onFocus`

```js
onFocus(ui, focused)
```

Called when focus arrives or leaves.

<sub>src/widget.js:14</sub>

## Constants

### `darkTheme`

```js
const darkTheme
```

Everything a widget needs to look like part of one game: colours (packed, see color.js), text sizes and spacing, in logical
pixels. Pass overrides to `createTheme`; anything left out keeps the default, so a game restyles only what it cares about.

Value: `{`

<sub>src/theme.js:8</sub>

### `highContrastTheme`

```js
const highContrastTheme
```

A theme for players who need strong contrast: white on black, yellow accents, thick borders and focus rings, a taller row. It passes `auditTheme` with the boundary checks too.
Offer it in the settings (`ui.theme = highContrastTheme`, then `ui.setViewport(...)` to lay out again).

Value: `createTheme({`

<sub>src/theme.js:60</sub>

### `lightTheme`

```js
const lightTheme
```

A lighter variant, mostly to show that a theme is only data.

Value: `createTheme({`

<sub>src/theme.js:42</sub>

## Types

### `A11yNode`

What a screen reader is told about one widget.

Type: `object`

| Name | Type | Description |
|---|---|---|
| `id` | `string` | Stable for the widget while it lives (its `id` style, or one made for it). |
| `role` | `'button' \| 'switch' \| 'slider' \| 'spinbutton' \| 'textbox' \| 'listbox' \| 'option' \| 'progressbar' \| 'text' \| 'heading' \| 'separator' \| 'group' \| 'dialog'` |  |
| `name` | `string` | What it is called ("Music volume", "Resume"). |
| `description` (optional) | `string` | Extra help ("Type a room name"). |
| `value` (optional) | `string` | What it holds, as it should be read ("50%", "Hard"); never the text of a password. |
| `valueNow` (optional) | `number` |  |
| `valueMin` (optional) | `number` |  |
| `valueMax` (optional) | `number` | For sliders, spin buttons and progress bars. |
| `checked` (optional) | `boolean` | For switches. |
| `selected` (optional) | `boolean` | For options. |
| `level` (optional) | `number` | For headings (1 is the biggest). |
| `password` (optional) | `boolean` |  |
| `disabled` | `boolean` |  |
| `focused` | `boolean` |  |
| `focusable` | `boolean` |  |
| `modal` | `boolean` | For dialogs. |
| `bounds` | `{x: number, y: number, w: number, h: number}` | Where it is on screen, in CSS pixels (for a screen magnifier or a touch explorer). |
| `children` | `A11yNode[]` |  |
| `widget` | `Widget` | The widget itself (so a front end can act on it). |

### `A11yOptions`

Optional help for the screen reader, set on any widget: `widget.a11y = { label, description, role, hidden, live }`. `label` replaces the name worked out from its text, `description` adds help,
`role` overrides the role, `hidden: true` leaves a decorative widget out, and `live: 'polite' | 'assertive'` makes changes to a text widget be announced.

Type: `{label?: string, description?: string, role?: A11yNode['role'], hidden?: boolean, live?: 'polite' \| 'assertive'}`

### `Painter`

What the UI draws with (see painter.js for ready-made ones). Sizes and positions are in screen pixels.

Type: `object`

| Name | Type | Description |
|---|---|---|
| `rect` | `(x: number, y: number, w: number, h: number, color: number, radius: number) => void` |  |
| `text` | `(text: string, x: number, y: number, o: {size: number, color: number, align: string, maxWidth?: number, shadow?: boolean}) => void` | `y` is the top of the first line |
| `measure` | `(text: string, o: {size: number, maxWidth?: number}) => {width: number, height: number}` |  |

### `Theme`

Everything a widget needs to look like part of one game: colours (packed, see color.js), text sizes and spacing, in logical
pixels. Pass overrides to `createTheme`; anything left out keeps the default, so a game restyles only what it cares about.

Type: `typeof darkTheme`
