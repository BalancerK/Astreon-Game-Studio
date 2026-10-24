# @engine/ui

Menus, HUDs, settings and lobby screens for games that run in a browser, drawn with the engine's own 2D renderer (so the UI costs a few more sprites in the same draw call, and looks the same on WebGPU, WebGL2 and Canvas2D). Layout, buttons, sliders, switches, choices, text fields, lists, themes, keyboard / gamepad / mouse / touch navigation, and ready-made screens for pausing, settings (with key rebinding) and picking a room. Zero dependencies.

```js
import { Ui, createSpritePainter, attachDom, Panel, Label, Button, Slider, menuScreen } from '@engine/ui';

const ui = new Ui({ painter: createSpritePainter({ batch: hudBatch, dot: whiteSprite, font }) });
attachDom(ui, stageElement);                                  // pointer, touch, wheel, keyboard, typing, resizing

ui.push(menuScreen(ui, { title: 'Paused', items: [
  { text: 'Resume', variant: 'primary', onClick: () => ui.closeAll() },
  { text: 'Settings', onClick: openSettings },
] }));

// every frame, after you drew your own HUD into hudBatch:
ui.update(dt);
ui.draw();                                                    // adds the UI to the batch
```

## How it works

You build a tree of widgets once and change their state when something happens (`label.text = ...`, `slider.value = ...`); there is no per-frame description to rebuild. `update(dt)` lays out whatever changed, `draw()` asks the **painter** for rectangles and text. Sizes are logical pixels; `Ui` scales them (`scale`, bigger on touch screens) and keeps clear of notches (`insets`).

- **Layers.** `ui.hud` holds permanent widgets (a menu button, a health bar; give children an `anchor`). `ui.push(widget)` opens a screen on top: modal by default (dimmed, takes all input), `ui.close()` / `ui.closeAll()` / Escape / B close it. `ui.onActiveChange(open)` is where you pause the game and switch the input layer to a menu context.
- **What the UI uses, the game does not get.** Every input call returns whether the UI took it: `pointerDown(...)` is `false` over empty HUD space, so the click is the game's. `wantsPointer(x, y)` asks without acting.

## Layout

Flexbox in miniature. A container's style: `direction` (`'column'` default, `'row'`, `'stack'`), `gap`, `padding` (`8`, `[v, h]` or `[t, r, b, l]`), `align` (cross axis: `'stretch'` default, `'start'`, `'center'`, `'end'`), `justify` (`'start'`, `'center'`, `'end'`, `'between'`). A child's: `width` / `height` (a number, or `'fill'`, which shares free room equally), `grow`, `minWidth`..`maxHeight`, `alignSelf`, and in a `'stack'` `anchor` (`'center'`, `'top-right'`, ...) with `offsetX` / `offsetY`. Text wraps to the width it is given and gets taller, so a narrow label is a tall one. Content that does not fit shrinks the `fill` children, then the content-sized ones; fixed sizes are kept (set `shrink: true` to let one give way).

## Widgets

| Widget | What it is |
|---|---|
| `Widget`, `Panel`, `Spacer` | containers; `Panel` has a background and border |
| `Label` | text (wraps; `size`, `color`, `align`) |
| `Button` | `variant: 'normal' \| 'primary' \| 'danger'`, `onClick` |
| `Toggle`, `Choice`, `Slider` | labelled rows: switch, pick-one with arrows, value between min and max (drag, arrows, wheel) |
| `TextInput` | one line, caret, selection, `maxLength`, `filter`, `password`, `onChange`, `onSubmit` |
| `ScrollList` | rows to pick from; scrolls by whole rows (wheel, keys, touch drag), `onSelect`, `onActivate` |
| `ProgressBar`, `Separator` | |

Write your own by extending `Widget`: override `measure(ui, maxWidth)` and `paint(ui)`, and the pointer / key hooks (`pointerDown`, `navigate`, `activate`, ...). Drawing helpers on `ui`: `fill`, `stroke`, `text`, `textCentered`, `measureText`, `focusRing`.

## Input

`attachDom(ui, element, { scale, safeArea })` connects a page: pointer and touch events (one finger at a time), wheel, keys, resizing. Typing goes through a hidden `<input>` that takes focus while a `TextInput` has it, so **soft keyboards, IME, accents and paste work** and the widget just shows the state. Keys the UI used do not reach the game (`stopImmediatePropagation`); while a modal screen is open it keeps all of them.

Without a browser (tests, bots, other front ends) call the same methods yourself: `pointerDown/Move/Up(x, y, id, type)`, `wheel`, `key(code, mods)`, `insertText`, `navigate('up' | ...)`, `activate()`, `cancel()`.

Navigation: Tab, arrow keys (spatial: the nearest widget in that direction), Enter / Space, Escape. The focus ring shows only after a key or gamepad press (`ui.noteDevice(...)`), never after a mouse click.

**Gamepad menus:** add `menuActions()` to your `@engine/input` actions (d-pad and left stick, A, B, bumpers, in a `menu` context) and call `createMenuPump(ui, input).update(dt)` each frame; held directions repeat.

## Screens

Built from the widgets above; copy them if you need something different.

- `menuScreen(ui, { title, items })`, `confirmDialog(ui, { title, message, danger, onAnswer })` (focus starts on Cancel).
- `settingsScreen(ui, { tabs: [{ title, rows }] })`; rows are `slider`, `toggle`, `choice`, `text`, `button`, `label`, `separator` or `bindings`. The panel keeps one size across tabs.
- `bindingRows` (the `bindings` row): keyboard and gamepad controls per button action, click one and press the new one (Escape or a click elsewhere cancels). A control another action had is taken from it, and the screen says so. Needs an `@engine/input` `InputCore`; saving is up to you (`onChange`, then `input.serialize()`).
- `roomBrowser(ui, { fetchRooms, onJoin })`: a list from your server, a field to type a new room name, Refresh / Cancel / Join.

## Accessibility

```js
import { attachAccessibility, accessibilityTree, speak, highContrastTheme, auditTheme } from '@engine/ui';

const a11y = attachAccessibility(ui, { field: () => dom.input });   // dom = attachDom(...); call a11y.update() once a frame
ui.announce('Wave 3 starts');                                       // spoken politely; { assertive: true } interrupts
ui.setTextScale(1.5);                                               // all text bigger, the layout follows
ui.theme = highContrastTheme; ui.setViewport(ui.width, ui.height);  // strong contrast
```

- **Screen readers.** A canvas is invisible to them, so `attachAccessibility` keeps a hidden mirror of the UI in the page: real elements (buttons, switches, sliders, spin buttons for choices, text fields, lists with options, progress bars, headings, dialogs) with the right ARIA roles, names, values and states. It only touches what changed. Moving the screen reader's cursor onto a control moves the UI's focus there, and the UI's own focus (keyboard or gamepad) moves the page focus, so what is read follows what you do; activating a control clicks the widget; arrow keys on a slider or switch go through the normal key handling; announcements and opening a screen (`"Settings, dialog"`) go to live regions. While a modal screen is open only it (and what is above it) is exposed, since what is below is blocked. The page's hidden typing field (`attachDom`) is labelled with the field being edited.
- **The tree is plain data**: `accessibilityTree(ui)` returns `{ dialogs, hud, focused }` of nodes (`role`, `name`, `value`, `valueNow` and range, `checked`, `selected`, `disabled`, `focused`, `bounds` in CSS pixels, `children`), and `speak(node)` turns one into a sentence ("Music, slider, 50%"), so text-to-speech, a screen magnifier, a bot or a test can use it without a page. `ui.onAnnounce` and `ui.announcements` do the same for announcements, and `ui.onFocusChange` tells you when focus moves.
- **Naming things.** A widget is named by its text or label; a text field or list by the `Label` right before it in its row (that label is then not read twice), else its placeholder. Set `widget.a11y = { label, description, role, hidden, live }` to say more: `description` is extra help, `role` makes a custom widget a button, `hidden` leaves out decoration, and `live: 'polite' | 'assertive'` on a `Label` announces its changes (the settings and room-browser status lines already do). Title `Label`s take `style.heading: 1..6`; the built-in screens set it.
- **Contrast.** `contrastRatio(a, b)` and `luminance(c)` follow WCAG 2. `auditTheme(theme)` checks a theme against the AA numbers (text on every surface 4.5 to 1, the focus ring and slider fill 3 to 1; `{ boundaries: true }` adds borders) and names every failure; it found and fixed real problems in the engine's own two themes (the "danger" button's text, the light theme's accent and focus ring). `highContrastTheme` passes everything, with thick borders and focus rings and taller rows.
- **Text size and motion.** `ui.setTextScale(k)` (0.5 to 3) scales all text and re-lays everything out; `ui.reducedMotion` (set from the system's *reduce motion* setting by `attachAccessibility`) holds the blinking caret still, and is there for your own animations to read.
- **Not done:** a spoken description of a canvas game scene itself (the mirror covers the UI; a game that wants its world described writes the text and calls `ui.announce`), pointer gestures on the mirror elements beyond a click (a screen reader's own gestures reach the page as clicks and keys, which are handled), right-to-left layout of the widgets, and automatic dark or light theme by system setting (read `matchMedia('(prefers-color-scheme: dark)')` and choose the theme).

## Themes and painters

`createTheme({ colors, text, rowHeight, ... })` overrides the defaults (`darkTheme`, `lightTheme`); colours are packed 32-bit integers like the renderer's tints (`rgba`, `hex`, `mix`, `withAlpha`). A **painter** is three functions (`rect`, `text`, `measure`): `createSpritePainter` draws into a sprite batch, `createCanvasPainter` into a 2D context, `createRecordingPainter` records commands with a fake font for tests.

## Tests

`npm test` runs 39 tests: layout (rows, columns, stacks, grow, fill, justify, anchors, wrapping, overflow), pointer (click, cancel, touch, scale, safe areas), keyboard and gamepad navigation, every widget, text editing, screens (stacking, dismissal, focus return), settings and rebinding against the real `InputCore`, the room browser, and the painters. `node tools/arena3d-test.js` drives the pause menu, settings (rebinding, a conflict, sliders, interface size), the room browser (a real typed room name and navigation), taps on a touch screen and a gamepad in the real 3D arena in Chrome.

Not done (yet): a mouse button as a binding in the settings screen (clicks belong to the UI there), scrolling containers with clipping (lists scroll by rows), drop-downs and tooltips, animation and transitions, right-to-left text, screen readers (accessibility tree), gestures such as pinch.
