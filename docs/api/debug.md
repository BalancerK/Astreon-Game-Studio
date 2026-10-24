# @engine/debug

In-page overlay: live graphs and a decoded packet inspector (F3).

```
npm install @engine/debug
```

Version 0.1.0. The package's own README ([packages/debug](../../packages/debug/README.md)) explains how the pieces fit together; this page lists every export.

## Contents (6 of 6 documented)

| Name | Kind | Summary |
|---|---|---|
| [`DebugOverlay`](#class-debugoverlay) | class | In-page debug panel: live graphs for each series, info lines and a packet inspector. |
| [`OverlayModel`](#class-overlaymodel) | class | The data side of the debug overlay: named series sampled on a timer, info lines, and a packet log. |
| [`PacketLog`](#class-packetlog) | class | Ring buffer of recent packets plus running totals per direction and type. |
| [`TimeSeries`](#class-timeseries) | class | Fixed-size ring of numbers (oldest overwritten). |
| [`drawGraph`](#drawgraph) | function | Draw a time series as a line graph into a 2D context. |
| [`niceCeil`](#niceceil) | function | Smallest "nice" number (1, 2, 5 x 10^n) that is >= v, for tidy graph ranges. |

## Functions

### `drawGraph`

```js
function drawGraph(ctx, series, rect, { min = 0, max = null, color = '#7fd4ff', background = 'rgba(255,255,255,0.06)', warnAbove = null, warnColor = '#ff7a7a' } = {})
```

Draw a time series as a line graph into a 2D context. Newest sample is at the right edge; gaps (NaN)
break the line. Returns the value range used, so the caller can label it.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `ctx` | `CanvasRenderingContext2D` |  |
| `series` | `import('./time-series.js').TimeSeries` |  |
| `rect` | `{x: number, y: number, w: number, h: number}` |  |
| `o` (optional) | `object` |  |
| `o.min` (optional) | `number` |  |
| `o.max` (optional) | `number \| null` | null = fit to the data (rounded up to a nice number) |
| `o.color` (optional) | `string` |  |
| `o.background` (optional) | `string` |  |
| `o.warnAbove` (optional) | `number \| null` | Draws a threshold line and colours points above it. |
| `o.warnColor` (optional) | `string` |  |

**Returns** `{min: number, max: number}`

<sub>src/graph.js:27</sub>

### `niceCeil`

```js
function niceCeil(v)
```

Smallest "nice" number (1, 2, 5 x 10^n) that is >= v, for tidy graph ranges.

<sub>src/graph.js:2</sub>

## Classes

### `class DebugOverlay`

```js
class DebugOverlay
```

In-page debug panel: live graphs for each series, info lines and a packet inspector.
Toggle with F3 (or `toggle()`). Sampling always runs (cheap) so history is there when you open it;
drawing only happens while it is visible.

#### `DebugOverlay.constructor`

```js
constructor({ title = 'Debug', open = false, hotkey = 'F3', parent = document.body, model = new OverlayModel(), intervalMs = 100 } = {})
```

| Name | Type | Description |
|---|---|---|
| `o` (optional) | `object` |  |
| `o.title` (optional) | `string` |  |
| `o.open` (optional) | `boolean` |  |
| `o.hotkey` (optional) | `string \| null` | KeyboardEvent.code, or null for none. |
| `o.parent` (optional) | `HTMLElement` |  |
| `o.model` (optional) | `OverlayModel` |  |
| `o.intervalMs` (optional) | `number` | Sampling/refresh period. |

#### `DebugOverlay.addSeries`

```js
addSeries(name, def)
```

Convenience passthroughs so callers can configure the overlay directly.

#### `DebugOverlay.addInfo`

```js
addInfo(label, read)
```

#### `DebugOverlay.tap`

```js
tap(transport)
```

#### `DebugOverlay.open`

```js
open()
```

#### `DebugOverlay.close`

```js
close()
```

#### `DebugOverlay.toggle`

```js
toggle()
```

#### `DebugOverlay.refresh`

```js
refresh()
```

Redraw everything from the model now.

#### `DebugOverlay.destroy`

```js
destroy()
```

<sub>src/overlay.js:12</sub>

### `class OverlayModel`

```js
class OverlayModel
```

The data side of the debug overlay: named series sampled on a timer, info lines, and a packet log.
No DOM here, so it is fully testable in Node.

#### `OverlayModel.constructor`

```js
constructor({ now = () => performance.now(), samples = 100, packetCapacity = 200 } = {})
```

| Name | Type | Description |
|---|---|---|
| `o` (optional) | `object` |  |
| `o.now` (optional) | `() => number` |  |
| `o.samples` (optional) | `number` | History length per series. |
| `o.packetCapacity` (optional) | `number` |  |

#### `OverlayModel.addSeries`

```js
addSeries(name, def)
```

| Name | Type | Description |
|---|---|---|
| `name` | `string` |  |
| `def` | `SeriesDef` |  |

#### `OverlayModel.addInfo`

```js
addInfo(label, read)
```

| Name | Type | Description |
|---|---|---|
| `label` | `string` |  |
| `read` | `() => string` |  |

#### `OverlayModel.sample`

```js
sample()
```

Read every series once. Call at a steady interval (the overlay does, every 100 ms).

#### `OverlayModel.infoLines`

```js
infoLines()
```

**Returns** `[string, string][]` — Label/value pairs; failing readers show "?".

#### `OverlayModel.tap`

```js
tap(transport)
```

Wrap a transport so every packet in or out is decoded and logged. Pass the returned wrapper to your client.

| Name | Type | Description |
|---|---|---|
| `transport` | `T` |  |

<sub>src/model.js:24</sub>

### `class PacketLog`

```js
class PacketLog
```

Ring buffer of recent packets plus running totals per direction and type. Can be paused to read a moment closely.

#### `PacketLog.constructor`

```js
constructor(capacity = 200)
```

| Name | Type | Description |
|---|---|---|
| `capacity` (optional) | `number` |  |

#### `PacketLog.add`

```js
add(e)
```

| Name | Type | Description |
|---|---|---|
| `e` | `PacketEntry` | Totals always update; the visible list stops while paused. |

#### `PacketLog.entries`

```js
entries(limit = this.capacity)
```

| Name | Type | Description |
|---|---|---|
| `limit` (optional) | `number` |  |

**Returns** `PacketEntry[]` — Newest first.

#### `PacketLog.total`

```js
total(dir)
```

**Returns** `{count: number, bytes: number}` — Totals for one direction.

#### `PacketLog.clear`

```js
clear()
```

<sub>src/packet-log.js:12</sub>

### `class TimeSeries`

```js
class TimeSeries
```

Fixed-size ring of numbers (oldest overwritten). NaN marks "no data" and is ignored by statistics.

#### `TimeSeries.constructor`

```js
constructor(capacity = 100)
```

| Name | Type | Description |
|---|---|---|
| `capacity` (optional) | `number` |  |

#### `TimeSeries.length`

```js
get length
```

#### `TimeSeries.push`

```js
push(v)
```

#### `TimeSeries.at`

```js
at(i)
```

| Name | Type | Description |
|---|---|---|
| `i` | `number` | 0 = oldest retained sample. |

#### `TimeSeries.clear`

```js
clear()
```

#### `TimeSeries.stats`

```js
stats(n = this.count)
```

| Name | Type | Description |
|---|---|---|
| `n` (optional) | `number` | Only the newest n samples. |

**Returns** `{last: number, min: number, max: number, avg: number, samples: number}` — NaN fields when there is no data.

<sub>src/time-series.js:2</sub>

## Types

### `PacketEntry`

Type: `Object`

| Name | Type | Description |
|---|---|---|
| `time` | `number` | Milliseconds on the caller's clock. |
| `dir` | `'in' \| 'out'` |  |
| `channel` | `number` | 0 reliable, 1 unreliable |
| `size` | `number` | Payload bytes. |
| `type` | `string` | Message type name, e.g. SNAPSHOT. |
| `summary` | `string` |  |

### `SeriesDef`

Type: `Object`

| Name | Type | Description |
|---|---|---|
| `label` (optional) | `string` |  |
| `unit` (optional) | `string` |  |
| `read` | `() => number` | Current value (or a cumulative counter when `rate` is set). |
| `rate` (optional) | `boolean` | `read` is a running total: plot its change per second instead. |
| `scale` (optional) | `number` | Multiplier applied to the value (e.g. 1/1024 for bytes -> KB). |
| `color` (optional) | `string` |  |
| `warnAbove` (optional) | `number \| null` |  |
| `min` (optional) | `number` |  |
| `max` (optional) | `number \| null` |  |
| `decimals` (optional) | `number` |  |
