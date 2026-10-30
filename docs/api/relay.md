# @engine/relay

Online play where every machine plays the whole game and a server has the last word on every input: the input relay, the frames it sends, the window, and the rollback client.

```
npm install @engine/relay
```

Version 0.1.0. The package's own README ([packages/relay](../../packages/relay/README.md)) explains how the pieces fit together; this page lists every export.

## Contents (15 of 15 documented)

| Name | Kind | Summary |
|---|---|---|
| [`InputRelay`](#class-inputrelay) | class | The server's side of one match: the commands of every seat for every frame, and the frames played from them (see the top of this file). |
| [`MAX_AHEAD`](#max_ahead) | constant | The furthest ahead (frames) a player may send a command for. |
| [`MAX_WINDOW`](#max_window) | constant | The most frames the window grows to. |
| [`OnlineRollback`](#class-onlinerollback) | class | A player's side of an online match: plays at once, takes the server's word, keeps the clock and the delay (see the top of this file). |
| [`TICK_MS`](#tick_ms) | constant | The length of a frame in milliseconds (60 a second). |
| [`TONE`](#tone) | constant | The colour of a tone, for pages with their own style. |
| [`WINDOW`](#window) | constant | The usual window, in frames. |
| [`createFrameLog`](#createframelog) | function | Make the log of a match's frames. |
| [`createTokenBucket`](#createtokenbucket) | function | Make a bucket. |
| [`describeDifferences`](#describedifferences) | function | The first few paths where `mine` and `theirs` differ, and the two values. |
| [`linkQuality`](#linkquality) | function | How good a connection is: bars (0 to 4), a word and a tone. |
| [`neededWindow`](#neededwindow) | function | The window the connections in a room need: half the round trip and twice its jitter, in frames, and 3 more. |
| [`pack`](#pack) | function | A message as bytes. |
| [`stepWindow`](#stepwindow) | function | One look at the window: up at once (by 3 frames a time) when more is needed, down by 1 frame at most every 2 seconds when less is. |
| [`unpack`](#unpack) | function | A message from bytes. |

## Functions

### `createFrameLog`

```js
function createFrameLog({ hashEvery = 60, keep = 900 } = {})
```

Make the log of a match's frames.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `o` (optional) | `{hashEvery?: number, keep?: number}` | `hashEvery` how many frames between checksums (60), `keep` how many frames of history (900) |

<sub>src/frames.js:8</sub>

### `createTokenBucket`

```js
function createTokenBucket({ rate, burst, now = 0 })
```

Make a bucket.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `o` | `{rate: number, burst: number, now?: number}` | `rate` requests a second it earns, `burst` the most it holds (and starts with), `now` the time in milliseconds it starts at |

<sub>src/limit.js:7</sub>

### `describeDifferences`

```js
function describeDifferences(mine, theirs, limit = 8)
```

The first few paths where `mine` and `theirs` differ, and the two values.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `mine` | `any` |  |
| `theirs` | `any` |  |
| `limit` (optional) | `number` |  |

**Returns** `string[]`

<sub>src/diff.js:7</sub>

### `linkQuality`

```js
function linkQuality({ ping, jitter = 0, ahead = 0, lost = false })
```

How good a connection is: bars (0 to 4), a word and a tone.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `c` | `{ping: number, jitter?: number, ahead?: number, lost?: boolean}` |  |

**Returns** `Quality`

<sub>src/quality.js:11</sub>

### `neededWindow`

```js
function neededWindow(connections, { base = WINDOW, max = MAX_WINDOW, tickMs = TICK_MS } = {})
```

The window the connections in a room need: half the round trip and twice its jitter, in frames, and 3 more.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `connections` | `Array<{rtt?: number, jitter?: number} \| null \| undefined>` | the players' links (a link with no `rtt` yet, or none, counts for nothing) |
| `o` (optional) | `{base?: number, max?: number, tickMs?: number}` |  |

<sub>src/window.js:16</sub>

### `pack`

```js
function pack(msg)
```

A message as bytes.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `msg` | `any` |  |

**Returns** `Uint8Array`

<sub>src/wire.js:5</sub>

### `stepWindow`

```js
function stepWindow(room, need, now)
```

One look at the window: up at once (by 3 frames a time) when more is needed, down by 1 frame at most every 2 seconds when less is.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `room` | `{window?: number, downAt?: number}` | the room's state, `window` (default WINDOW) and `downAt` (when it last came down): both are updated |
| `need` | `number` | from `neededWindow` |
| `now` | `number` | milliseconds |

**Returns** `number` — the window now

<sub>src/window.js:27</sub>

### `unpack`

```js
function unpack(bytes)
```

A message from bytes.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `bytes` | `Uint8Array \| ArrayBuffer` |  |

**Returns** `any` — the message, or null if it is not one

<sub>src/wire.js:8</sub>

## Classes

### `class InputRelay`

```js
class InputRelay
```

The server's side of one match: the commands of every seat for every frame, and the frames played from them (see the top of this file).

#### `InputRelay.constructor`

```js
constructor({ seats, codec, think, onChange = () => {}, hooks = {}, maxAhead = MAX_AHEAD })
```

| Name | Type | Description |
|---|---|---|
| `o` | `object` |  |
| `o.seats` | `RelaySeat[]` | the seats; the array is kept and changed as seats change hands |
| `o.codec` | `CommandCodec` |  |
| `o.think` | `(seat: number, frame: number) => any` | the command (decoded) of a computer-driven seat for this frame |
| `o.onChange` (optional) | `(entries: Array<{seat: number, [k: string]: any}>) => void` | called with the changes of a frame as they are recorded, so the game's own copy can apply them at once (the players apply them at the same frame) |
| `o.hooks` (optional) | `{human?: (seat: number) => void, bot?: (seat: number, frame: number) => void}` | called when a person takes a seat (`human`) and when a computer takes it back (`bot`), so the game can drop or make the seat's mind |
| `o.maxAhead` (optional) | `number` |  |

#### `InputRelay.seatOf`

```js
seatOf(pilot)
```

The seat a person is in, or -1.

| Name | Type | Description |
|---|---|---|
| `pilot` | `string` |  |

#### `InputRelay.receive`

```js
receive(seat, frame, encoded)
```

A command from a player's machine for a frame. Too late (that frame is already played) it is used for the next frame instead, so that a slow connection delays what the player does and does not lose it
(unless it is older than one already taken); too far ahead, or for a seat that is not a person's, it is ignored.

| Name | Type | Description |
|---|---|---|
| `seat` | `number` |  |
| `encoded` | `any` |  |
| `frame` | `number` |  |

**Returns** `boolean` — whether it was kept

#### `InputRelay.seatHuman`

```js
seatHuman(seat, pilot, name)
```

A person takes over a computer-driven seat from the next frame.

| Name | Type | Description |
|---|---|---|
| `seat` | `number` |  |
| `pilot` | `string` |  |
| `name` | `string` |  |

#### `InputRelay.seatBot`

```js
seatBot(seat)
```

The person in a seat has gone: the computer takes it from the next frame.

| Name | Type | Description |
|---|---|---|
| `seat` | `number` |  |

#### `InputRelay.record`

```js
record(entry)
```

Note a change that takes effect at the next frame to be played, on every machine at the same frame (it comes with that frame to the players): a seat changing hands, or anything else of the game's own
(a new build chosen during the round).

| Name | Type | Description |
|---|---|---|
| `entry` | `{seat: number, [k: string]: any}` |  |

#### `InputRelay.freeSeats`

```js
freeSeats(team)
```

The seats a person could take over: computer-driven ones, the weakest-placed first (a team's own before any other, when `team` is given).

| Name | Type | Description |
|---|---|---|
| `team` (optional) | `number` |  |

#### `InputRelay.step`

```js
step(play)
```

Play one frame. `play` is given the commands (decoded) of every seat and the changes that take effect at this frame, and plays the game; what it returns comes back as `events`.

| Name | Type | Description |
|---|---|---|
| `play` | `(commands: any[], changes: Array<{seat: number, [k: string]: any}>) => T` |  |

**Returns** `{frame: number, inputs: any[], events: T, changes: Array<{seat: number, [k: string]: any}>}` — `inputs[i]` is the encoded command of seat i

<sub>src/relay.js:25</sub>

### `class OnlineRollback`

```js
class OnlineRollback
```

A player's side of an online match: plays at once, takes the server's word, keeps the clock and the delay (see the top of this file).

#### `OnlineRollback.constructor`

```js
constructor({ seats, you, game, send, sendFast = send, redundant = () => false, window = 6, inputDelay = 0, onEvents = () => {} })
```

| Name | Type | Description |
|---|---|---|
| `o` | `object` |  |
| `o.seats` | `any[]` | a record for each seat, kept (the server's `roster` messages update them) |
| `o.you` | `number` | this player's seat |
| `o.game` | `OnlineGame` |  |
| `o.send` | `(msg: any) => void` | sends a message to the server the reliable way |
| `o.sendFast` (optional) | `(msg: any) => void` | for what may be lost (pings, commands) |
| `o.redundant` (optional) | `() => boolean` | whether commands go in datagrams of several at a time |
| `o.window` (optional) | `number` | the server's window in frames |
| `o.inputDelay` (optional) | `number` |  |
| `o.onEvents` (optional) | `(events: any[], frame: number) => void` |  |

#### `OnlineRollback.state`

```js
get state
```

The game now (it is replaced whenever it is played again from an earlier frame, so ask each frame).

#### `OnlineRollback.aheadMs`

```js
get aheadMs
```

How far ahead of what the server has confirmed this machine is playing (milliseconds): the part of what is on the screen that is a guess.

#### `OnlineRollback.frame`

```js
get frame
```

The frame the machine has played up to.

#### `OnlineRollback.message`

```js
message(msg, now)
```

A message from the server.

| Name | Type | Description |
|---|---|---|
| `msg` | `any` |  |
| `now` | `number` | milliseconds |

#### `OnlineRollback.ping`

```js
ping(now, force = false)
```

Ask the server what time it is in the match (every second or so).

| Name | Type | Description |
|---|---|---|
| `now` | `number` |  |
| `force` (optional) | `boolean` |  |

#### `OnlineRollback.matchFrame`

```js
matchFrame(now)
```

Which frame of the match it is now, by the server's clock (a fraction), or NaN before the clock is known.

| Name | Type | Description |
|---|---|---|
| `now` | `number` |  |

#### `OnlineRollback.tick`

```js
tick(now, readCommand)
```

Play the frames that are due: for each, take the player's command, send it, and play the frame. Call every rendered frame (or at least often).

| Name | Type | Description |
|---|---|---|
| `now` | `number` | milliseconds |
| `readCommand` | `() => any` | gives the player's command for this moment |

**Returns** `number` — how many frames were played

<sub>src/online.js:27</sub>

## Constants

### `MAX_AHEAD`

```js
const MAX_AHEAD
```

The furthest ahead (frames) a player may send a command for.

Value: `90`

<sub>src/relay.js:12</sub>

### `MAX_WINDOW`

```js
const MAX_WINDOW
```

The most frames the window grows to.

Value: `20`

<sub>src/window.js:7</sub>

### `TICK_MS`

```js
const TICK_MS
```

The length of a frame in milliseconds (60 a second).

Value: `1000 / 60`

<sub>src/window.js:9</sub>

### `TONE`

```js
const TONE
```

The colour of a tone, for pages with their own style.

Value: `Object.freeze({ good: '#6fcf97', fair: '#e0b84a', poor: '#e0594f', lost: '#e0594`

<sub>src/quality.js:21</sub>

### `WINDOW`

```js
const WINDOW
```

The usual window, in frames.

Value: `6`

<sub>src/window.js:5</sub>

## Types

### `CommandCodec`

How a game's command is written for the wire.

Type: `object`

| Name | Type | Description |
|---|---|---|
| `normalize` | `(raw?: any) => any` | makes a command that is certainly sound (no argument: "nothing pressed") |
| `encode` | `(command: any) => any` | a command as plain data (JSON) |
| `decode` | `(encoded: any) => any` |  |

### `OnlineGame`

What the game is, for the online match.

Type: `object`

| Name | Type | Description |
|---|---|---|
| `base` | `() => any` | makes the state at frame 0 (the same on every machine, from what the server's `start` message said) |
| `step` | `(state: any, commands: any[], changes: Array<{seat: number, [k: string]: any}> \| undefined, frame: number) => any[]` | plays one frame: apply the changes (of who holds a seat, and anything else the server recorded), play the game with these commands (one decoded command for each seat), and return the events of the frame (shown once, when the frame is played for the first time) |
| `clone` | `(state: any) => any` |  |
| `checksum` | `(state: any) => number` |  |
| `serialize` | `(state: any) => any` | the state as plain data (for the server's copy and for finding differences) |
| `revive` | `(data: any, base: any) => any` | the state from plain data (`base` is a fresh state to take what cannot be written down from) |
| `normalize` | `(raw?: any) => any` |  |
| `encode` | `(command: any) => any` |  |
| `decode` | `(encoded: any) => any` | a command (see `CommandCodec` in relay.js) |

### `Quality`

Type: `{bars: 0 \| 1 \| 2 \| 3 \| 4, label: string, tone: 'good' \| 'fair' \| 'poor' \| 'lost'}`

### `RelaySeat`

A seat: who or what plays it.

Type: `object`

| Name | Type | Description |
|---|---|---|
| `kind` | `'human' \| 'bot'` |  |
| `pilot` (optional) | `string` | the id of the person in it (none for a computer-driven seat) |
| `team` (optional) | `number` |  |
| `name` (optional) | `string` |  |
