# @engine/client

Adaptive interpolation clock (jitter/loss-aware render delay), client-side prediction with reconciliation, and rollback netcode.

```
npm install @engine/client
```

Version 0.1.0. The package's own README ([packages/client](../../packages/client/README.md)) explains how the pieces fit together; this page lists every export.

## Contents (3 of 3 documented)

| Name | Kind | Summary |
|---|---|---|
| [`InterpolationClock`](#class-interpolationclock) | class | Decides which server tick to draw other entities at. |
| [`Predictor`](#class-predictor) | class | Client-side prediction with server reconciliation: applies your own inputs at once with the server's step function, checks them against the server's acknowledged state, and when they disagree adopts the server's state, replays the newer inputs and eases the visible jump away. |
| [`RollbackSession`](#class-rollbacksession) | class | Rollback netcode: every player runs the whole game, unknown remote inputs are guessed, and when a real input differs from its guess the session goes back and simulates forward again within one `advance()`. |

## Classes

### `class InterpolationClock`

```js
class InterpolationClock
```

Decides which server tick to draw other entities at.

Snapshots arrive "late" by the network latency plus some queueing jitter. For
smooth interpolation we render slightly in the past: far enough behind the
newest snapshot that the next one has (almost always) arrived, but no
further, because every extra tick of delay is visible lag.

Measured per snapshot:
 - lateness `m`: smoothed (arrival time in ticks - snapshot tick), i.e. the latency floor plus average queueing;
 - jitter `d`: smoothed mean deviation of lateness (RFC 3550 style);
 - gap: spacing between accepted snapshot ticks (1 normally, larger when packets are lost). The buffer
   follows a slowly decaying *peak* of the gap, not its mean, because one lost snapshot must not starve rendering;
 - step detection: if lateness stays far from its estimate for several snapshots (a route change), the estimate
   jumps to the new level at once instead of crawling there.

Buffer depth = peak gap + k * jitter, clamped. The defaults (k = 4, minimum 2 ticks) came from sweeping
the arena network lab (`tools/arena-netlab-sweep.js`): with k = 3 and a 1.5 tick minimum, a link with only
10 ms of jitter starved 4% of frames; k = 4 with a 2 tick minimum removed that at a cost of ~8 ms. The render clock then slews toward
`now - m - buffer` by speeding up or slowing down at most `maxRateAdjust`,
so a changing target never makes motion visibly jump, and it only snaps when
the target moves far away (e.g. a route change).

#### `InterpolationClock.constructor`

```js
constructor({ tickMs, k = 4, minBufferTicks = 2, maxBufferTicks = 20, maxRateAdjust = 0.1, gain = 0.2, snapTicks = 8, stepTicks = 6, fixedDelayMs = null })
```

| Name | Type | Description |
|---|---|---|
| `o` | `object` |  |
| `o.tickMs` | `number` | Server tick period in milliseconds. |
| `o.k` (optional) | `number` | Jitter safety multiplier (default 4). |
| `o.minBufferTicks` (optional) | `number` | Smallest buffer (default 2 ticks). |
| `o.maxBufferTicks` (optional) | `number` |  |
| `o.maxRateAdjust` (optional) | `number` | Largest playback speed change (0.1 = +-10%). |
| `o.gain` (optional) | `number` | Rate change per tick of error. |
| `o.snapTicks` (optional) | `number` | Errors larger than this jump instead of slewing. |
| `o.stepTicks` (optional) | `number` | Lateness deviations larger than this, sustained, count as a latency step. |
| `o.fixedDelayMs` (optional) | `number \| null` | Use a fixed delay behind the newest snapshot instead of adapting (for comparisons). |

#### `InterpolationClock.onSnapshot`

```js
onSnapshot(arrivalMs, tick)
```

Feed every accepted (newer) snapshot.

| Name | Type | Description |
|---|---|---|
| `arrivalMs` | `number` |  |
| `tick` | `number` |  |

#### `InterpolationClock.bufferTicks`

```js
get bufferTicks
```

Ticks of buffering behind the newest snapshot that we aim for.

#### `InterpolationClock.serverTickNow`

```js
serverTickNow(nowMs)
```

Best estimate of the server's current tick (fractional), or NaN before any snapshot.

#### `InterpolationClock.renderTick`

```js
renderTick(nowMs)
```

The tick to draw at, advancing smoothly. Call once per rendered frame.

| Name | Type | Description |
|---|---|---|
| `nowMs` | `number` |  |

**Returns** `number` — Fractional server tick, or NaN before the first snapshot.

#### `InterpolationClock.status`

```js
status(nowMs)
```

Numbers for a debug overlay.

<sub>src/interp-clock.js:26</sub>

### `class Predictor`

```js
class Predictor
```

Client-side prediction with server reconciliation: applies your own inputs at once with the server's step function, checks them against the server's acknowledged state, and when
they disagree adopts the server's state, replays the newer inputs and eases the visible jump away. Draw `renderState(alpha)`.

#### `Predictor.constructor`

```js
constructor({ step, dt, initial, capacity = 256, tolerance = 0.08, snapDistance = 200, smoothHalfLife = 0.06, smooth = ['x', 'y'], error } = {})
```

| Name | Type | Description |
|---|---|---|
| `o` | `object` |  |
| `o.step` | `(state: FlatState, input: any, dt: number) => void` | Applies one input to a state, changing it in place. The server's own function. |
| `o.dt` | `number` | Seconds per input (one tick). |
| `o.initial` (optional) | `FlatState` | Where the player starts. Without it the predictor waits for the first `reconcile` to learn where it is. |
| `o.capacity` (optional) | `number` | Inputs remembered (must be more than the longest stretch the server has not yet acknowledged). Default 256. |
| `o.tolerance` (optional) | `number` | How far (in the units of `error`) the server may differ before it counts as a mismatch. Default 0.08. |
| `o.snapDistance` (optional) | `number` | A correction larger than this jumps instead of easing. Default 200. |
| `o.smoothHalfLife` (optional) | `number` | Seconds for a correction offset to halve. Default 0.06. |
| `o.smooth` (optional) | `string[]` | The numbers that are interpolated and eased when drawn (positions). Default `['x', 'y']`. |
| `o.error` (optional) | `(ours: FlatState, theirs: FlatState) => number` | How far apart two states are. Default: the distance over the `smooth` numbers. |

#### `Predictor.pending`

```js
get pending
```

How many inputs were sent but not yet acknowledged.

#### `Predictor.record`

```js
record(seq, input)
```

Remember an input and apply it at once. Call it every tick with a `seq` that goes up by one each time (starting at 1), the same number you send to the server.

| Name | Type | Description |
|---|---|---|
| `seq` | `number` |  |
| `input` | `any` |  |

#### `Predictor.reconcile`

```js
reconcile(ackSeq, serverState)
```

Check the prediction against what the server says. Call it for every snapshot that carries your own state.

| Name | Type | Description |
|---|---|---|
| `ackSeq` | `number` | The last input the server had applied when it made this snapshot. |
| `serverState` | `FlatState` | Your state after that input, as the server has it (it may leave out numbers it does not send). |

**Returns** `number` — How far the state moved because of the correction (0 when the prediction was right).

#### `Predictor.smooth`

```js
smooth(dt)
```

Ease the correction offset towards zero. Call it once for every rendered frame.

| Name | Type | Description |
|---|---|---|
| `dt` | `number` | Seconds since the last frame. |

#### `Predictor.renderState`

```js
renderState(alpha, out = {})
```

The state to draw: the smoothed numbers are interpolated between the last two predicted ticks plus the fading correction; every other number is as it is now.

| Name | Type | Description |
|---|---|---|
| `alpha` | `number` | 0 to 1: how far we are through the current tick. |
| `out` (optional) | `FlatState` |  |

**Returns** `FlatState`

<sub>src/predict.js:27</sub>

### `class RollbackSession`

```js
class RollbackSession
```

Rollback netcode: every player runs the whole game, unknown remote inputs are guessed, and when a real input differs from its guess the session goes back and simulates forward
again within one `advance()`. Only inputs are sent; checksums find the moment two machines stop agreeing.

#### `RollbackSession.constructor`

```js
constructor(o)
```

| Name | Type | Description |
|---|---|---|
| `o` | `RollbackOptions` |  |

#### `RollbackSession.confirmedFrame`

```js
get confirmedFrame
```

The number of frames for which every player's real input is known. The state before this frame is final and will never change.

**Returns** `number`

#### `RollbackSession.addLocalInput`

```js
addLocalInput(input)
```

Give this machine's input for now. It will take effect `inputDelay` frames from the current one. Send the returned frame and the input to the other players.

| Name | Type | Description |
|---|---|---|
| `input` | `any` |  |

**Returns** `number` — The frame the input is for.

#### `RollbackSession.addRemoteInput`

```js
addRemoteInput(player, frame, input)
```

Give another player's real input, when it arrives (late, early or twice is fine). If it is not what was guessed, the frames from there are simulated again at the next `advance`.

| Name | Type | Description |
|---|---|---|
| `player` | `number` |  |
| `frame` | `number` |  |
| `input` | `any` |  |

#### `RollbackSession.advance`

```js
advance()
```

Simulate one more frame (after going back and correcting any frames whose guessed inputs turned out wrong). Call it once per tick, after giving the inputs.

**Returns** `boolean` — false if it could not: it is `maxRollback` frames ahead of what is confirmed (wait for the other player), or this machine has not given its input for this frame yet.

#### `RollbackSession.confirmed`

```js
confirmed()
```

The newest state that can no longer change, and its checksum if the session has one. Players compare these to find out whether they still agree.

**Returns** `{frame: number, state: any, checksum: number \| null}`

#### `RollbackSession.report`

```js
report(frame, theirChecksum)
```

Compare what another player says the state was at a confirmed frame with ours. When it differs the session is `desync`ed: the game is no longer the same on both machines.

| Name | Type | Description |
|---|---|---|
| `frame` | `number` |  |
| `theirChecksum` | `number` |  |

**Returns** `boolean` — true when they agree (or the frame is too old to check)

<sub>src/rollback.js:35</sub>

## Types

### `FlatState`

A flat object of numbers.

Type: `Object<string, number>`

### `RollbackOptions`

Type: `Object`

| Name | Type | Description |
|---|---|---|
| `players` | `number` | How many players. |
| `local` | `number` | Which player is on this machine (0 to players - 1). |
| `init` | `() => any` | Makes the state at frame 0. |
| `step` | `(state: any, inputs: any[], frame: number) => void` | Simulates one frame, changing the state in place. `inputs[p]` is player p's input for this frame. |
| `clone` (optional) | `(state: any) => any` | Copies a state. Default `structuredClone` (so the state must be plain data). |
| `maxRollback` (optional) | `number` | The most frames it may run ahead of what is confirmed (and so the most it ever re-simulates). Default 8. |
| `inputDelay` (optional) | `number` | Local inputs take effect this many frames late, which gives the other player time to receive them and so means fewer rollbacks. Default 0. |
| `blank` (optional) | `any` | The input that means "nothing pressed", used for the first frames and before anything is known. Default `null`. |
| `guess` (optional) | `(last: any) => any` | Guesses an input that has not arrived from the last one that did. Default: the same again. |
| `checksum` (optional) | `(state: any) => number` | A number that says what a state is, to find players that disagree. |
