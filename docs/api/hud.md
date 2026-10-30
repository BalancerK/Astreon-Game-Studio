# @engine/hud

HUD widgets for a 2D canvas over a 3D view: panels, gauges, cooldown sweeps, a compass tape, a turning radar, off-screen arrows and a frame-time overlay.

```
npm install @engine/hud
```

Version 0.1.0. The package's own README ([packages/hud](../../packages/hud/README.md)) explains how the pieces fit together; this page lists every export.

## Contents (14 of 14 documented)

| Name | Kind | Summary |
|---|---|---|
| [`HUD_THEME`](#hud_theme) | constant | A cool blue-green console on dark glass, with amber for markers. |
| [`bar`](#bar) | function | A plain bar that fills from the left. |
| [`chamfer`](#chamfer) | function | A path round a rectangle with its corners cut off (fill or stroke it afterwards). |
| [`compassTape`](#compasstape) | function | The compass tape along the top: 120 degrees across, a tick every 5, the points named, a marker in the middle and the bearing under it. |
| [`createFrameStats`](#createframestats) | function | Make the numbers of a frame-time overlay: call `frame()` once a frame and `mark(name)` as each part of the frame finishes. |
| [`drawRadar`](#drawradar) | function | Draw a radar. |
| [`drawStatsPanel`](#drawstatspanel) | function | Draw the lines on a dark panel, the first one coloured by the frame rate (green from 55, amber from 30, red below). |
| [`panel`](#panel) | function | A console panel: dark flat glass, a thin edge, and one short accent line on the top edge. |
| [`radarProject`](#radarproject) | function | Where a world place is on a radar. |
| [`screenDirection`](#screendirection) | function | Which way, on the screen, a place is from the crosshair: the angle of the arrow that points to it (0 is to the right, a quarter turn is down), and how far in front of the view it is (1 straight ahead, -1 straight behind). |
| [`segments`](#segments) | function | A row (or a column) of small cells that fill from the start: a gauge. |
| [`statsRows`](#statsrows) | function | The lines of a frame-time overlay. |
| [`sweep`](#sweep) | function | A cooldown sweep: the part of a square cell that is still cooling is shaded like a clock hand going round, starting at the top. |
| [`watchGpuTime`](#watchgputime) | function | Time the graphics card on a WebGPU renderer: after each frame's work is handed over, how long until the card says it is done (smoothed into `stats.gpu`). |

## Functions

### `bar`

```js
function bar(g, x, y, w, h, f, colour, back = 'rgba(255,255,255,0.1)')
```

A plain bar that fills from the left.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `g` | `CanvasRenderingContext2D` |  |
| `f` | `number` | how full, 0 to 1 |
| `colour` | `string` |  |
| `back` (optional) | `string` | the empty part |

<sub>src/widgets.js:40</sub>

### `chamfer`

```js
function chamfer(g, x, y, w, h, c)
```

A path round a rectangle with its corners cut off (fill or stroke it afterwards).

**Parameters**

| Name | Type | Description |
|---|---|---|
| `g` | `CanvasRenderingContext2D` |  |
| `c` | `number` | how much is cut off each corner |

<sub>src/widgets.js:8</sub>

### `compassTape`

```js
function compassTape(g, W, yaw, u, theme = HUD_THEME)
```

The compass tape along the top: 120 degrees across, a tick every 5, the points named, a marker in the middle and the bearing under it.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `g` | `CanvasRenderingContext2D` |  |
| `W` | `number` | the screen's width |
| `yaw` | `number` | radians (the game's own turn) |
| `u` | `number` |  |
| `theme` (optional) | `import('./theme.js').HudTheme` |  |

<sub>src/widgets.js:57</sub>

### `createFrameStats`

```js
function createFrameStats({ window = 500, smoothing = 0.1, now = () => performance.now(), onWindow } = {})
```

Make the numbers of a frame-time overlay: call `frame()` once a frame and `mark(name)` as each part of the frame finishes.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `o` (optional) | `{window?: number, smoothing?: number, now?: () => number, onWindow?: (s: ReturnType<typeof createFrameStats>) => void}` | `window` how many milliseconds each reading covers (500), `smoothing` how much of a part's time is the newest reading (0.1), `now` a clock in milliseconds, `onWindow` called when a reading is ready (once every `window`) |

<sub>src/stats.js:10</sub>

### `drawRadar`

```js
function drawRadar(g, { cx, cy, size = 150, range, center, yaw, wedge, drawWorld, drawMarkers, background = '#0b0e14', theme = HUD_THEME })
```

Draw a radar.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `g` | `CanvasRenderingContext2D` |  |
| `o` | `object` |  |
| `o.cx` | `number` |  |
| `o.cy` | `number` | the middle on the canvas |
| `o.size` (optional) | `number` | the diameter (150) |
| `o.range` | `number` | metres from the middle to the rim |
| `o.center` | `number[]` | `[x, z]` of the player |
| `o.yaw` | `number` | the camera's yaw |
| `o.wedge` (optional) | `number` | half the width the camera sees, in radians, drawn as a wedge of light (none if left out) |
| `o.drawWorld` (optional) | `(g: CanvasRenderingContext2D, k: {k: number, turn: number}) => void` | draws the picture inside, with the origin at the player and units in metres (already turned to the view) |
| `o.drawMarkers` (optional) | `(g: CanvasRenderingContext2D, to: ReturnType<typeof radarProject>['to'], r: {cx: number, cy: number, size: number, k: number, turn: number}) => void` | draws what is on it, on top of the picture and the wedge, under the player's own mark |
| `o.background` (optional) | `string` | the colour behind the picture |
| `o.theme` (optional) | `import('./theme.js').HudTheme` |  |

**Returns** `ReturnType<typeof radarProject>` — so the caller can place its own writing round the rim

<sub>src/radar.js:31</sub>

### `drawStatsPanel`

```js
function drawStatsPanel(g, rows, fps, x, y, u, theme = HUD_THEME)
```

Draw the lines on a dark panel, the first one coloured by the frame rate (green from 55, amber from 30, red below).

**Parameters**

| Name | Type | Description |
|---|---|---|
| `g` | `CanvasRenderingContext2D` |  |
| `rows` | `string[]` |  |
| `fps` | `number` |  |
| `x` | `number` |  |
| `y` | `number` | the top left |
| `u` | `number` | the scale |
| `theme` (optional) | `import('./theme.js').HudTheme` |  |

<sub>src/stats.js:70</sub>

### `panel`

```js
function panel(g, x, y, w, h, u, { c = 4, glow, theme = HUD_THEME } = {})
```

A console panel: dark flat glass, a thin edge, and one short accent line on the top edge.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `g` | `CanvasRenderingContext2D` |  |
| `u` | `number` | the scale |
| `o` (optional) | `{c?: number, glow?: string, theme?: import('./theme.js').HudTheme}` | `c` the cut of the corners (4), `glow` the edge colour |

<sub>src/widgets.js:19</sub>

### `radarProject`

```js
function radarProject({ cx, cy, size, range, center, yaw })
```

Where a world place is on a radar. `to(x, z)` gives `{ x, y, edge, dist }`: its place on the canvas, whether it was far and was pulled in to the rim, and how far it is from the middle (in pixels).
Pure, so a game can test where its markers land.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `r` | `{cx: number, cy: number, size: number, range: number, center: number[], yaw: number}` | `range` is how many metres from the middle to the rim; `center` is `[x, z]` of the player; `yaw` the camera's (yaw 0 looks along -z) |

**Returns** `{k: number, turn: number, to: (x: number, z: number, inset?: number) => {x: number, y: number, edge: boolean, dist: number}}` — `k` is pixels a metre, `turn` the turn that puts the view's direction at the top

<sub>src/radar.js:11</sub>

### `screenDirection`

```js
function screenDirection(eye, target, yaw, pitch)
```

Which way, on the screen, a place is from the crosshair: the angle of the arrow that points to it (0 is to the right, a quarter turn is down), and how far in front of the view it is (1 straight
ahead, -1 straight behind). It is worked out in the camera's own directions (right, up, forward), so it is true whatever the camera's pitch: looking up at the sky, a place below and in front points
down, and one behind you points up (the shortest way to face it is over the top), each to the side it really is on. The camera's convention is the one of this engine's renderer: yaw 0 looks along -z, and a positive pitch looks up.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `eye` | `number[]` | where the view is from |
| `target` | `number[]` | the place |
| `yaw` | `number` | the camera's yaw |
| `pitch` | `number` | the camera's pitch (up is positive) |

**Returns** `{angle: number, front: number, off: number} \| null` — `off` is how far from the middle of the view it is, in radians; null if it is on top of the eye

<sub>src/direction.js:10</sub>

### `segments`

```js
function segments(g, x, y, w, h, f, colour, count = 24, vertical = false)
```

A row (or a column) of small cells that fill from the start: a gauge.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `g` | `CanvasRenderingContext2D` |  |
| `f` | `number` | how full, 0 to 1 |
| `colour` | `string` | the colour of the cells that are on |
| `count` (optional) | `number` |  |
| `vertical` (optional) | `boolean` | fills upward |

<sub>src/widgets.js:31</sub>

### `statsRows`

```js
function statsRows(stats, { parts = Object.keys(stats.shown).filter((k) => k !== 'worst'), head = '', extra = [] } = {})
```

The lines of a frame-time overlay.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `stats` | `ReturnType<typeof createFrameStats>` |  |
| `o` (optional) | `{parts?: string[], head?: string, extra?: string[]}` | `parts` the names to list in order (default: all that were marked), `head` text after the frame rate, `extra` more lines at the end |

**Returns** `string[]`

<sub>src/stats.js:57</sub>

### `sweep`

```js
function sweep(g, x, y, s, cut, frac, shade = 'rgba(0, 0, 0, 0.58)')
```

A cooldown sweep: the part of a square cell that is still cooling is shaded like a clock hand going round, starting at the top. `frac` is the part left (1 all of it, 0 none).

**Parameters**

| Name | Type | Description |
|---|---|---|
| `g` | `CanvasRenderingContext2D` |  |
| `s` | `number` | the cell's size |
| `cut` | `number` | the cut of its corners |
| `frac` | `number` |  |
| `shade` (optional) | `string` |  |

<sub>src/widgets.js:49</sub>

### `watchGpuTime`

```js
function watchGpuTime(renderer, stats, state = { busy: false })
```

Time the graphics card on a WebGPU renderer: after each frame's work is handed over, how long until the card says it is done (smoothed into `stats.gpu`). Does nothing for a renderer without a
`device`. Call once a frame, after rendering.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `renderer` | `{device?: GPUDevice}` |  |
| `stats` | `ReturnType<typeof createFrameStats>` |  |
| `state` (optional) | `{busy: boolean}` | keep the same object between calls |

<sub>src/stats.js:44</sub>

## Constants

### `HUD_THEME`

```js
const HUD_THEME
```

A cool blue-green console on dark glass, with amber for markers.

Value: `Object.freeze({`

<sub>src/theme.js:10</sub>

## Types

### `HudTheme`

Type: `object`

| Name | Type | Description |
|---|---|---|
| `font` | `string` | a CSS font family list |
| `main` | `string` | the usual accent |
| `dim` | `string` | a quiet accent |
| `panel` | `string` | the fill of a panel (translucent) |
| `edge` | `string` | the edge of a panel |
| `amber` | `string` | a warning or a marker |
| `red` | `string` | danger |
| `green` | `string` | fine |
| `white` | `string` | text |
