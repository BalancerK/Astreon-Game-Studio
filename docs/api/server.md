# @engine/server

Interest management, bandwidth budgets, lag-compensation queries, isolated rooms (worker threads).

```
npm install @engine/server
```

Version 0.1.0. The package's own README ([packages/server](../../packages/server/README.md)) explains how the pieces fit together; this page lists every export.

## Contents (6 of 6 documented)

| Name | Kind | Summary |
|---|---|---|
| [`ClientReplicator`](#class-clientreplicator) | class | Everything the server remembers and decides for ONE client's replication. |
| [`InlineRoom`](#class-inlineroom) | class | @implements {RoomHandle} |
| [`InterestGrid`](#class-interestgrid) | class | Interest management: which entities does a given client need to know about? |
| [`ProcessRoom`](#class-processroom) | class | A room in its own OS process, connected to the gateway by an IPC channel. |
| [`RoomManager`](#class-roommanager) | class | Creates, finds and retires rooms, and routes incoming connections to them. |
| [`WorkerRoom`](#class-workerroom) | class | A room in its own worker thread. |

## Classes

### `class ClientReplicator`

```js
class ClientReplicator
```

Everything the server remembers and decides for ONE client's replication.

A client's "view" is the snapshot it was sent: only the entities it is interested in, and (when a
bandwidth budget is set) not all of them freshly updated, because far-away, low-priority entities
may carry slightly older values. So deltas are computed against the *views we actually sent* (kept in
a per-client history, keyed by tick), not against the world.

Per tick: `setVisible` (who), `buildView` (what values, within budget), `encode` (bytes + history).

Budget: each unsent entity accumulates priority (faster when near), the highest-priority ones get
fresh values, and an AIMD controller adjusts how many per tick so the measured bytes/second tracks
the budget. The client's own entity and entities it has never seen are always fresh.

#### `ClientReplicator.constructor`

```js
constructor({ schema, worldCapacity, maxVisible = 384, historySize = 32, bytesPerSecond = Infinity, tickRate = 60, minUpdates = 2, priorityRange = 250, position = { component: 0, x: 'x', y: 'y' } })
```

| Name | Type | Description |
|---|---|---|
| `o` | `object` |  |
| `o.schema` | `import('../../protocol/src/index.js').NetSchema` |  |
| `o.worldCapacity` | `number` | Max entity slots in the world. |
| `o.maxVisible` (optional) | `number` | Max entities in one view. |
| `o.historySize` (optional) | `number` | Views remembered (ack lag you can serve deltas for). |
| `o.bytesPerSecond` (optional) | `number` | Budget; Infinity = unlimited. |
| `o.tickRate` (optional) | `number` |  |
| `o.minUpdates` (optional) | `number` | Never refresh fewer than this many entities per tick (each costs about ackLag x its size, so keep it small). |
| `o.priorityRange` (optional) | `number` | Distance (world units) at which update priority has halved. |
| `o.position` (optional) | `{component: number, x: string, y: string, z?: string}` | Which replicated fields are the position (for `positionAt`). Add `z` for a 3D game: `positionAt` then reports all three coordinates. |

#### `ClientReplicator.setVisible`

```js
setVisible(ids, count)
```

Record this tick's visible set (ids sorted by slot index) and remember it for hysteresis.

#### `ClientReplicator.buildView`

```js
buildView(src, tick, selfId, cx, cy, xs, ys)
```

Build this tick's view from the full-world snapshot.

| Name | Type | Description |
|---|---|---|
| `src` | `Snapshot` | Full-world snapshot of this tick (rows sorted by slot index). |
| `tick` | `number` |  |
| `selfId` | `number` | The client's own entity id (always fresh), or -1. |
| `cx` | `number` | Client position, for priority by distance. |
| `cy` | `number` |  |
| `xs` | `Float32Array \| Float64Array` | World positions by slot |
| `ys` | `Float32Array \| Float64Array` |  |

**Returns** `Snapshot` — The view (also stored as `this.view`).

#### `ClientReplicator.encode`

```js
encode(w, ackTick, overhead = 0)
```

Encode the view as a delta against the view the client acknowledged (or a full snapshot if that is gone
or ackTick is 0), remember it, and adapt the update allowance to the budget.

| Name | Type | Description |
|---|---|---|
| `w` | `import('../../protocol/src/index.js').BinaryWriter` | Positioned after any message header. |
| `ackTick` | `number` | Newest tick the client confirmed receiving. |
| `overhead` (optional) | `number` | Bytes already written for the header (counted against the budget). |

**Returns** `number` — Payload bytes written

#### `ClientReplicator.positionAt`

```js
positionAt(tick, id, out, teleportDistance = 300)
```

Where this client was *shown* entity `id` at a (fractional) server tick: interpolated between the two
views we sent around that tick, exactly as a client renders them. This is the basis for lag
compensation: judge a shot against what the shooter actually saw. Returns false if the entity was not
in the client's view then, so entities a client could not see cannot be hit.

| Name | Type | Description |
|---|---|---|
| `tick` | `number` |  |
| `id` | `number` |  |
| `out` | `{x: number, y: number, z?: number}` | `z` is written only when the replicator was given a `position.z`. |
| `teleportDistance` (optional) | `number` | Jumps larger than this (respawns) are not interpolated across. |

**Returns** `boolean`

<sub>src/replicator.js:19</sub>

### `class InlineRoom`

```js
class InlineRoom
```

@implements {RoomHandle}

#### `InlineRoom.constructor`

```js
constructor({ name, module, options = {} })
```

| Name | Type | Description |
|---|---|---|
| `o` | `{name: string, module: string \| URL, options?: object}` |  |

#### `InlineRoom.players`

```js
get players
```

#### `InlineRoom.stats`

```js
stats()
```

#### `InlineRoom.join`

```js
join(conn)
```

#### `InlineRoom.control`

```js
control(data)
```

#### `InlineRoom.stop`

```js
async stop()
```

<sub>src/room-host.js:216</sub>

### `class InterestGrid`

```js
class InterestGrid
```

Interest management: which entities does a given client need to know about? A uniform grid over entity
positions, rebuilt once per tick, answers "everything within R of this point" cheaply, so the cost of
serving a client depends on how much is near it, not on how big the world is.

Hysteresis stops flicker at the boundary: an entity becomes visible inside `enterRadius` but only
stops being visible outside `leaveRadius` (> enter).

#### `InterestGrid.constructor`

```js
constructor({ width, height, capacity, cellSize = 256 })
```

| Name | Type | Description |
|---|---|---|
| `o` | `object` |  |
| `o.width` | `number` | World width |
| `o.height` | `number` |  |
| `o.capacity` | `number` | Max entity slot index + 1. |
| `o.cellSize` (optional) | `number` | Roughly the view radius works well. |

#### `InterestGrid.rebuild`

```js
rebuild(ids, n, xs, ys)
```

Index this tick's positions. Call once per tick before any `query`.

| Name | Type | Description |
|---|---|---|
| `ids` | `Uint32Array` | Live entity ids (any order). |
| `n` | `number` |  |
| `xs` | `Float32Array \| Float64Array` | Position by slot index |
| `ys` | `Float32Array \| Float64Array` |  |

#### `InterestGrid.query`

```js
query({ cx, cy, enterRadius, leaveRadius, prevMark, generations, maxVisible, outIds })
```

Entities this client should see, as ids sorted by slot index.

| Name | Type | Description |
|---|---|---|
| `q` | `object` |  |
| `q.cx` | `number` | Centre (usually the client's own entity) |
| `q.cy` | `number` |  |
| `q.enterRadius` | `number` |  |
| `q.leaveRadius` | `number` | >= enterRadius |
| `q.prevMark` | `Uint32Array` | Per-client: id + 1 at each slot visible last tick (0 = not visible) |
| `q.generations` | `Uint16Array \| Uint8Array \| Int32Array \| Uint32Array` | Entity generations by slot |
| `q.maxVisible` | `number` | Hard cap; the nearest entities win. |
| `q.outIds` | `Uint32Array` | Receives the ids |

**Returns** `number` — Count written

<sub>src/interest.js:14</sub>

### `class ProcessRoom`

```js
class ProcessRoom extends ChannelRoom
```

A room in its own OS process, connected to the gateway by an IPC channel.

Containment beyond a worker thread: a heap cap (`memoryMb`) so a leaking or hostile room dies alone (V8 aborts the
process, the gateway sees the exit and reports it), a scrubbed environment, optional Node permission-model
confinement (`confine`), and lower scheduling priority if asked. If the gateway dies, rooms exit with it.

#### `ProcessRoom.constructor`

```js
constructor({ name, module, options = {}, startTimeoutMs, stopTimeoutMs, memoryMb, env = {}, confine = null, priority, execArgv = [], inheritStderr = true })
```

| Name | Type | Description |
|---|---|---|
| `o` | `object` |  |
| `o.name` | `string` |  |
| `o.module` | `string \| URL` | Room module URL. |
| `o.options` (optional) | `object` | Passed to `createRoom` (must be JSON-serialisable or structured-cloneable). |
| `o.startTimeoutMs` (optional) | `number` |  |
| `o.stopTimeoutMs` (optional) | `number` | How long `stop()` waits for a clean exit before killing the process (default 3000). |
| `o.memoryMb` (optional) | `number` | V8 old-space heap cap for the room process (default: none). |
| `o.env` (optional) | `Record<string, string>` | Environment for the room process (default: none; the OS adds its own standard variables on Windows). |
| `o.confine` (optional) | `{fsRead?: string[], fsWrite?: string[], childProcess?: boolean} \| null` | Run under Node's permission model: no file access except the listed paths, no child processes unless allowed. The room's own source files must be readable, so list the directory your room module and its imports live in. Does not restrict the network (Node's model does not cover it); for that use a container. |
| `o.priority` (optional) | `number` | An `os.constants.priority` value (e.g. `os.constants.priority.PRIORITY_BELOW_NORMAL`). |
| `o.execArgv` (optional) | `string[]` | Extra node flags. |
| `o.inheritStderr` (optional) | `boolean` | Show the room's stderr (default true, so crashes are visible). |

<sub>src/room-host.js:157</sub>

### `class RoomManager`

```js
class RoomManager
```

Creates, finds and retires rooms, and routes incoming connections to them.

- Rooms are created on demand (`autoCreate`) up to `maxRooms`, each with at most `maxPlayers`.
- A connection that arrives while its room is still starting is held (its early packets are buffered
  and replayed) until the room is ready.
- Empty rooms are closed after `idleCloseMs`.
- A room that crashes disconnects only its own players; the next join to that name starts a fresh room.

#### `RoomManager.constructor`

```js
constructor({ module, mode = 'worker', hostOptions = {}, defaultOptions = {}, maxRooms = 16, maxPlayers = 32, autoCreate = true, idleCloseMs = 60_000, log = () => {} })
```

| Name | Type | Description |
|---|---|---|
| `o` | `object` |  |
| `o.module` | `string \| URL` | Room module: exports `createRoom(options)`. |
| `o.mode` (optional) | `'process' \| 'worker' \| 'inline'` | Where rooms run: own OS process (strongest containment), own worker thread, or this thread. |
| `o.hostOptions` (optional) | `object` | Options for the room host itself (process mode: `memoryMb`, `env`, `confine`, `priority`, `startTimeoutMs`, ...). Not passed to `createRoom`. |
| `o.defaultOptions` (optional) | `object` | Options for every room (can be overridden per room). |
| `o.maxRooms` (optional) | `number` |  |
| `o.maxPlayers` (optional) | `number` | Per room. |
| `o.autoCreate` (optional) | `boolean` | Create a room when someone asks for an unknown name. |
| `o.idleCloseMs` (optional) | `number` | Close a room this long after its last player left (0 = never). |
| `o.log` (optional) | `(message: string) => void` |  |

#### `RoomManager.ensureRoom`

```js
async ensureRoom(name, options = {})
```

Make sure a room exists (creating it if allowed) and return its handle once it is ready.

| Name | Type | Description |
|---|---|---|
| `name` | `string` |  |
| `options` (optional) | `object` | Per-room options (merged over the defaults) used only when creating. |

#### `RoomManager.join`

```js
async join(name, conn, options)
```

Route a connection into a room. Rejections close the connection with an explanatory reason.

| Name | Type | Description |
|---|---|---|
| `name` | `string` |  |
| `conn` | `import('../../transport/src/index.js').Transport` |  |
| `options` (optional) | `object` | Used only if this creates the room. |

#### `RoomManager.list`

```js
list()
```

Snapshot of every room, for a lobby page or monitoring.

#### `RoomManager.closeRoom`

```js
async closeRoom(name)
```

#### `RoomManager.close`

```js
async close()
```

<sub>src/rooms.js:12</sub>

### `class WorkerRoom`

```js
class WorkerRoom extends ChannelRoom
```

A room in its own worker thread.

#### `WorkerRoom.constructor`

```js
constructor({ name, module, options = {}, startTimeoutMs, stopTimeoutMs })
```

| Name | Type | Description |
|---|---|---|
| `o` | `object` |  |
| `o.name` | `string` |  |
| `o.module` | `string \| URL` | Room module URL (must be importable from the worker). |
| `o.options` (optional) | `object` | Passed to `createRoom` (structured-cloneable). |
| `o.startTimeoutMs` (optional) | `number` |  |
| `o.stopTimeoutMs` (optional) | `number` | How long `stop()` waits for a clean exit before terminating (default 3000). |

<sub>src/room-host.js:127</sub>

## Types

### `RoomHandle`

The gateway-side handle on one room. Three implementations share this interface so a game can choose
isolation per deployment without changing room code:

 - `ProcessRoom`: the room runs in its own OS process. Strongest containment: a crash, a runaway allocation
   (per-room heap cap), a native fault or a hang kills only that process, and the OS can limit it further.
 - `WorkerRoom`: the room runs in its own worker thread. Nothing is shared; a slow or crashing room cannot
   stall or take down the gateway or other rooms, but a native crash or out-of-memory still takes the whole process.
 - `InlineRoom`: the room runs in this thread (cheapest, no message passing; one room can stall the others).

A room module exports `createRoom(options)` returning `{ attach(transport), close?(), stats?(), control?(data) }`.

Type: `Object`

| Name | Type | Description |
|---|---|---|
| `name` | `string` |  |
| `mode` | `'process' \| 'worker' \| 'inline'` |  |
| `ready` | `Promise<void>` | Resolves when the room can accept players. |
| `players` | `number` | Connected players. |
| `join` | `(conn: import('../../transport/src/index.js').Transport) => void` |  |
| `control` | `(data: any) => void` | Send a control message to the room module (`room.control`). |
| `stats` | `() => any` | Latest statistics reported by the room. |
| `stop` | `() => Promise<void>` |  |
| `onExit` | `((reason: string) => void) \| null` | Called once if the room ends without `stop()` (crash). |
