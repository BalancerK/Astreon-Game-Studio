# @engine/replay

Replays and spectating: record a match as compact snapshot deltas (seek anywhere, any speed) or as its inputs (a few KB, with drift detection), a delayed feed shared by any number of spectators.

```
npm install @engine/replay
```

Version 0.1.0. The package's own README ([packages/replay](../../packages/replay/README.md)) explains how the pieces fit together; this page lists every export.

## Contents (10 of 10 documented)

| Name | Kind | Summary |
|---|---|---|
| [`INPUT_REPLAY_VERSION`](#input_replay_version) | constant | The version of the input-replay layout this code writes and reads. |
| [`InputPlayer`](#class-inputplayer) | class | Plays an input recording back through your simulation: it hands your `step` the recorded inputs, tick by tick, checking the recorded hashes as it goes. |
| [`InputRecorder`](#class-inputrecorder) | class | Records a match of a **deterministic** game as its inputs: the starting state, then what each player pressed on each tick. |
| [`REPLAY_FORMAT_VERSION`](#replay_format_version) | constant | The version of the replay file layout this code writes and reads. |
| [`ReplayDesyncError`](#class-replaydesyncerror) | class | The replay does not reproduce what was recorded: the state at `tick` hashes differently from the recording. |
| [`ReplayPlayer`](#class-replayplayer) | class | Plays a replay back. |
| [`ReplayRecorder`](#class-replayrecorder) | class | Records a match as a stream of snapshots, in the same compact delta form the network uses, so five minutes of a world of forty entities is about 1 to 3 megabytes (a full snapshot every `keyframeEvery` ticks makes it possible to jump to any moment without playing everything before it). |
| [`SnapshotReceiver`](#class-snapshotreceiver) | class | The other end: turns the snapshot packets of a live game (a player's or a spectator's) into snapshots, keeps the ones needed to read the next delta, and says which tick to acknowledge. |
| [`SpectatorFeed`](#class-spectatorfeed) | class | Watching a match: the server keeps the whole world for spectators, a few seconds behind what the players are doing (so nobody can tell a team where the enemy is), and sends it to any number of viewers. |
| [`hashState`](#hashstate) | function | A 32-bit FNV-1a hash of any JSON-able value, as 8 hex digits (for comparing the state of two runs). |

## Functions

### `hashState`

```js
function hashState(value)
```

A 32-bit FNV-1a hash of any JSON-able value, as 8 hex digits (for comparing the state of two runs).

<sub>src/inputs.js:5</sub>

## Classes

### `class InputPlayer`

```js
class InputPlayer
```

Plays an input recording back through your simulation: it hands your `step` the recorded inputs, tick by tick, checking the recorded hashes as it goes. It can jump to any tick (it restores the
nearest saved state before it with `load` and plays forward from there), run faster or slower, pause and loop.

#### `InputPlayer.constructor`

```js
constructor(replay, { step, load = null, hash = null, onDesync = null })
```

| Name | Type | Description |
|---|---|---|
| `replay` | `object \| string` | What `InputRecorder.finish()` returned, or its text. |
| `o` | `object` |  |
| `o.step` | `(inputs: any, tick: number) => void` | Run one tick of the game with these inputs. |
| `o.load` (optional) | `(state: any) => void` | Put the game into a saved state (needed to seek, to start from a state other than the game's fresh one, and to loop). |
| `o.hash` (optional) | `() => any` | The same function the recording used, to check the replay still matches (without it nothing is verified). |
| `o.onDesync` (optional) | `(error: ReplayDesyncError) => void` | Called when a hash differs. Without it the error is thrown from `advance` / `update`. |

#### `InputPlayer.endTick`

```js
get endTick
```

#### `InputPlayer.finished`

```js
get finished
```

#### `InputPlayer.inputsAt`

```js
inputsAt(tick)
```

The recorded inputs of a tick.

#### `InputPlayer.rewind`

```js
rewind()
```

Put the game at the start of the recording: the first checkpoint, if there is one (otherwise the game must be fresh).

#### `InputPlayer.advance`

```js
advance(n = 1)
```

Run `n` ticks (stops at the end). Returns how many ran.

#### `InputPlayer.seek`

```js
seek(tick)
```

Jump so that the next tick to run is `tick` (clamped): restores the nearest saved state at or before it, then plays forward. Needs `load` and a recorded `save`.

#### `InputPlayer.update`

```js
update(dt)
```

Play along for `dt` real seconds (times `speed`, unless paused). Returns how many ticks ran.

<sub>src/inputs.js:79</sub>

### `class InputRecorder`

```js
class InputRecorder
```

Records a match of a **deterministic** game as its inputs: the starting state, then what each player pressed on each tick. Because the simulation gives the same result every time (that is what
the fixed timestep and `@engine/math` are for), playing the inputs back through it reproduces the whole match, and a ten-minute match is a few kilobytes. Every `checkpointEvery` ticks it also
keeps a copy of the game state (so a player can jump into the middle) and every `hashEvery` ticks a hash of it (so a replay that has stopped matching, after an update changed the rules, is caught
at once, not by someone noticing the wrong ending).

Call `record(tick, inputs)` at the start of every tick, before the simulation runs it, with whatever your simulation takes as input for that tick (anything JSON-able: a map from player to
buttons). Ticks must be consecutive.

#### `InputRecorder.constructor`

```js
constructor({ game = '', version = 1, tickRate = 60, meta = {}, save = null, hash = null, checkpointEvery = 600, hashEvery = 60 })
```

| Name | Type | Description |
|---|---|---|
| `o` | `object` |  |
| `o.game` (optional) | `string` | Name of the game, stored. |
| `o.version` (optional) | `number` | Version of the game's rules (1): a replay of another version is refused by the player's caller, not guessed at. |
| `o.tickRate` (optional) | `number` | Ticks per second (60). |
| `o.meta` (optional) | `Record<string, any>` | Anything about the match (map, players, seed, date). |
| `o.save` (optional) | `() => any` | Returns the game state as plain data (it is copied by `JSON`), for checkpoints. Without it the replay can only be played from the start. |
| `o.hash` (optional) | `() => any` | Returns a number or string that is the same whenever the game state is the same, for catching drift. Default: `hashState(save())` if `save` is given. |
| `o.checkpointEvery` (optional) | `number` | Ticks between saved states (600). |
| `o.hashEvery` (optional) | `number` | Ticks between hashes (60). |

#### `InputRecorder.ticks`

```js
get ticks
```

The number of ticks recorded.

#### `InputRecorder.record`

```js
record(tick, inputs = null)
```

Record the inputs of `tick` (call before running the tick).

#### `InputRecorder.finish`

```js
finish()
```

The recording as plain, JSON-safe data.

**Returns** `object`

#### `InputRecorder.toText`

```js
toText()
```

The recording as text (a file, a message, a bug report).

<sub>src/inputs.js:30</sub>

### `class ReplayDesyncError`

```js
class ReplayDesyncError extends Error
```

The replay does not reproduce what was recorded: the state at `tick` hashes differently from the recording.

#### `ReplayDesyncError.constructor`

```js
constructor(tick, expected, actual)
```

| Name | Type | Description |
|---|---|---|
| `tick` | `number` |  |
| `expected` | `string` |  |
| `actual` | `string` |  |

<sub>src/inputs.js:13</sub>

### `class ReplayPlayer`

```js
class ReplayPlayer
```

Plays a replay back. Give it the bytes (a file, or what `ReplayRecorder.finish()` returned) and the schema it was recorded with; call `update(dt)` each frame, and draw `history`
(the same `SnapshotHistory` a live client draws from, so interpolation code is shared: `history.around(player.tickAt)`). Seek anywhere, change speed, pause, loop.
A recording cut short by a crash plays up to where it stopped (`truncated` is true).

#### `ReplayPlayer.constructor`

```js
constructor(bytes, { schema, capacity, onSnapshot = null, onEvent = null })
```

| Name | Type | Description |
|---|---|---|
| `bytes` | `Uint8Array` |  |
| `o` | `object` |  |
| `o.schema` | `import('../../protocol/src/index.js').NetSchema` |  |
| `o.capacity` | `number` | Same as when recording (at least). |
| `o.onSnapshot` (optional) | `(snapshot: Snapshot, index: number) => void` | Called for each frame played, in order (and for the frame landed on by a seek). |
| `o.onEvent` (optional) | `(event: {tick: number, type: string, data: any}) => void` | Called for each event as the playhead passes it (not during a seek). |

#### `ReplayPlayer.frameCount`

```js
get frameCount
```

#### `ReplayPlayer.firstTick`

```js
get firstTick
```

#### `ReplayPlayer.lastTick`

```js
get lastTick
```

#### `ReplayPlayer.duration`

```js
get duration
```

Length in seconds.

#### `ReplayPlayer.tickAt`

```js
get tickAt
```

The playhead as a (fractional) game tick, for `history.around(tickAt)`.

#### `ReplayPlayer.finished`

```js
get finished
```

Whether the playhead is at the end.

#### `ReplayPlayer.frameAt`

```js
frameAt(tick)
```

The index of the last frame at or before a tick (0 before the first).

#### `ReplayPlayer.seekTick`

```js
seekTick(tick)
```

Jump to a game tick (clamped to the recording). The frame at or before it becomes `current`.

#### `ReplayPlayer.seek`

```js
seek(seconds)
```

Jump to a time in seconds from the start.

#### `ReplayPlayer.update`

```js
update(dt)
```

Advance by `dt` real seconds (times `speed`, unless paused): decodes the frames passed, calls `onSnapshot` for each and `onEvent` for each event passed. At the end it stops, or starts again with `loop`.

**Returns** `number` — how many frames were played

#### `ReplayPlayer.eventsBetween`

```js
eventsBetween(from, to)
```

The events with `from < tick <= to`.

<sub>src/recorder.js:105</sub>

### `class ReplayRecorder`

```js
class ReplayRecorder
```

Records a match as a stream of snapshots, in the same compact delta form the network uses, so five minutes of a world of forty entities is about 1 to 3 megabytes (a full snapshot every
`keyframeEvery` ticks makes it possible to jump to any moment without playing everything before it). Game events (a kill, a chat line, a round start) can be recorded between the frames.
It records what the **server sent** to a viewer (or the full world), so it plays back on any machine, even one whose simulation would not reproduce the match; for a deterministic game that
wants tiny files, see `InputRecorder`.

#### `ReplayRecorder.constructor`

```js
constructor({ schema, capacity, tickRate = 60, keyframeEvery = 120, every = 1, meta = {}, onChunk = null })
```

| Name | Type | Description |
|---|---|---|
| `o` | `object` |  |
| `o.schema` | `import('../../protocol/src/index.js').NetSchema` | The replicated-state schema (its hash is stored: a replay only plays against the same one). |
| `o.capacity` | `number` | Most entities in one snapshot. |
| `o.tickRate` (optional) | `number` | Ticks per second of the game (60); stored, so players know the speed. |
| `o.keyframeEvery` (optional) | `number` | Ticks between full snapshots (120). |
| `o.every` (optional) | `number` | Record only every Nth tick (1: all). 3 at 60 Hz records 20 frames a second and is smoother than it sounds when played with interpolation. |
| `o.meta` (optional) | `Record<string, any>` | Anything JSON-able about the match (map, players, version, date): kept in the file header. |
| `o.onChunk` (optional) | `(bytes: Uint8Array) => void` | Called with the header and then each frame as it is recorded, to write a file as you go (a server that may crash). When given, nothing is kept in memory. |

#### `ReplayRecorder.record`

```js
record(snapshot)
```

Record a snapshot (a full-world one, or what one viewer is shown). Ticks must increase. Frames skipped by `every` are ignored.

| Name | Type | Description |
|---|---|---|
| `snapshot` | `Snapshot` |  |

**Returns** `boolean` — whether it was recorded

#### `ReplayRecorder.event`

```js
event(tick, type, data = null)
```

Record something that happened at `tick`: a kill, a goal, a chat line. `data` must be JSON-able.

#### `ReplayRecorder.finish`

```js
finish()
```

The whole recording as one file (empty after the header if `onChunk` took the frames).

**Returns** `Uint8Array`

<sub>src/recorder.js:22</sub>

### `class SnapshotReceiver`

```js
class SnapshotReceiver
```

The other end: turns the snapshot packets of a live game (a player's or a spectator's) into snapshots, keeps the ones needed to read the next delta, and says which tick to acknowledge.
A delta whose starting point is missing is not an error: it sets `needsFull`, and acknowledging -1 gets a full snapshot next.

#### `SnapshotReceiver.constructor`

```js
constructor({ schema, capacity, historySize = 32 })
```

| Name | Type | Description |
|---|---|---|
| `o` | `object` |  |
| `o.schema` | `import('../../protocol/src/index.js').NetSchema` |  |
| `o.capacity` | `number` |  |
| `o.historySize` (optional) | `number` |  |

#### `SnapshotReceiver.ackTick`

```js
get ackTick
```

What to put in the acknowledgement: the newest tick, or -1 if a full snapshot is needed.

#### `SnapshotReceiver.receive`

```js
receive(packet, { header = true } = {})
```

Read one packet.

| Name | Type | Description |
|---|---|---|
| `packet` | `Uint8Array \| BinaryReader` | A snapshot packet (with its message header). |
| `o` (optional) | `{header?: boolean}` | `header: false` for a bare snapshot payload (as in a replay file). |

**Returns** `Snapshot \| null` — the new snapshot (valid until it is evicted from `history`), or null for a stale, duplicate or unreadable packet

<sub>src/spectate.js:90</sub>

### `class SpectatorFeed`

```js
class SpectatorFeed
```

Watching a match: the server keeps the whole world for spectators, a few seconds behind what the players are doing (so nobody can tell a team where the enemy is), and sends it to any
number of viewers. All spectators who have the same snapshot as a starting point get **the same bytes**, so the cost of a hundred spectators is a few encodes, not a hundred.

Each tick, `push` the full-world snapshot. Each time you send to a spectator, ask for `packet(spectatorId, ackTick)` (the newest tick that spectator says it has) and send the bytes as they are.
The packets have the same layout as a player's snapshot packets (`MSG.SNAPSHOT`, input ack 0, the delta), so a spectator's client can read them with the normal client code or `SnapshotReceiver`.

#### `SpectatorFeed.constructor`

```js
constructor({ schema, worldCapacity, delayTicks = 0, every = 1, ackLag = 32 })
```

| Name | Type | Description |
|---|---|---|
| `o` | `object` |  |
| `o.schema` | `import('../../protocol/src/index.js').NetSchema` |  |
| `o.worldCapacity` | `number` | Most entities in the world. |
| `o.delayTicks` (optional) | `number` | How far behind the live game spectators are (default 0; 600 is ten seconds at 60 Hz). |
| `o.every` (optional) | `number` | Keep every Nth tick for spectators (1). 3 at 60 Hz sends 20 snapshots a second, a third of the bandwidth, and plays well with interpolation. |
| `o.ackLag` (optional) | `number` | How many kept snapshots back a spectator's acknowledgement may be and still get a delta (32); older ones get a full snapshot. |

#### `SpectatorFeed.push`

```js
push(snapshot)
```

Give the feed this tick's full-world snapshot (its rows are copied; keep using your own).

#### `SpectatorFeed.add`

```js
add(id)
```

Someone starts watching.

#### `SpectatorFeed.remove`

```js
remove(id)
```

Someone stops.

#### `SpectatorFeed.size`

```js
get size
```

#### `SpectatorFeed.targetTick`

```js
get targetTick
```

The tick spectators are being shown: the newest kept snapshot at least `delayTicks` old, or -1 if there is none yet.

#### `SpectatorFeed.packet`

```js
packet(id, ackTick = -1)
```

What to send a spectator now. `ackTick` is the newest tick they have confirmed (-1 for none: they get a full snapshot). Returns null if there is nothing new for them (or nothing to show
yet). The returned bytes are shared with other spectators: send them, do not change them.

| Name | Type | Description |
|---|---|---|
| `id` | `any` |  |
| `ackTick` (optional) | `number` |  |

**Returns** `Uint8Array \| null`

<sub>src/spectate.js:10</sub>

## Constants

### `INPUT_REPLAY_VERSION`

```js
const INPUT_REPLAY_VERSION
```

The version of the input-replay layout this code writes and reads.

Value: `1`

<sub>src/inputs.js:2</sub>

### `REPLAY_FORMAT_VERSION`

```js
const REPLAY_FORMAT_VERSION
```

The version of the replay file layout this code writes and reads.

Value: `1`

<sub>src/recorder.js:5</sub>
