# @engine/server

Server-side replication: who gets told what, and how much. Game-agnostic; the arena example shows it in use.

**May import:** `@engine/core`, `@engine/protocol`, `@engine/transport`, `@engine/physics`. Node built-ins only otherwise (`child_process` and `worker_threads` for room hosts).

## Interest management: `InterestGrid`
A grid over entity positions, rebuilt once per tick, answers "which entities are within R of this client?" so the work and bandwidth per client depend on what is *near it*, not on world size.

```js
grid.rebuild(ids, n, xs, ys);                                   // once per tick
const m = grid.query({ cx, cy, enterRadius: 700, leaveRadius: 805,   // per client
  prevMark: rep.prevMark, generations, maxVisible: 384, outIds });
```
Hysteresis: an entity becomes visible inside `enterRadius` but only stops being visible beyond `leaveRadius`, so nothing flickers at the boundary. A recycled entity slot (new generation) never inherits the old entity's visibility. If more than `maxVisible` are in range, the nearest win.

## Per-client replication and budget: `ClientReplicator`
```js
rep.setVisible(visibleIds, m);
rep.buildView(fullWorldSnapshot, tick, selfId, cx, cy, xs, ys);
writeSnapshotHeader(w, lastAppliedInput);
rep.encode(w, clientAckTick, headerBytes);
```
A client's **view** is the snapshot it was actually sent. Deltas are computed against the *views we sent* (a per-client history keyed by tick), because with a budget not every entity is refreshed every tick.

With `bytesPerSecond` set, each unsent entity earns priority (faster when near the client), the highest-priority ones get fresh values, and an AIMD controller adapts how many per tick so measured bytes/second tracks the budget. The client's own entity and entities it has never seen are always fresh. Entities that were not refreshed simply repeat the value the client already has, so everything the client decodes is internally consistent (tested by exact comparison under ack lag and loss).

Honest limit: a budget cannot go below the cost of the mandatory updates. Each refreshed entity is re-sent in every delta until acknowledged, so the floor is roughly `minUpdates x ack lag x entity size`. Keep `minUpdates` small (default 2).

## Measured (arena demo, 4 clients, 15 s, 40 ms +- 10 ms network, virtual clock)
| 150 bots | KB/s per client | entities seen |
|---|---|---|
| whole world | 81.4 | 154 |
| view 700 | 20.2 | 38 |
| view 400 | 8.1 | 15 |

| 400 bots | KB/s per client | entities seen |
|---|---|---|
| whole world (capped at 384) | 202.3 | 384 |
| view 700 | 51.3 | 97 |
| view 700, budget 30 KB/s | 28.9 | 97 |
| view 700, budget 15 KB/s | 15.8 | 97 |

Server tick time roughly halves with a 700 view. Prediction corrections stayed at 0 in every row. Re-run with `node tools/arena-bandwidth.js`.

## Lag compensation: `rep.positionAt(tick, id, out)`
Where this client was *shown* entity `id` at a fractional server tick, interpolated between the two views we sent around it exactly as a client renders them (no interpolation across respawn teleports). Judge a shooter's shot against this and it is fair at any latency, and entities the client never saw simply cannot be located, so they cannot be hit. Clamp the claimed tick to a rewind window yourself (the arena uses 250 ms).

## Rooms: `RoomManager`, `ProcessRoom`, `WorkerRoom`, `InlineRoom`
A room is a full, self-contained simulation. A room module exports `createRoom(options)` returning `{ attach(transport), close?(), stats?(), control?(data) }`; the manager runs it **in its own OS process** (`mode: 'process'`), **in its own worker thread** (`'worker'`, the default), or **inline** in the gateway's thread. Room code is identical in all three.

```js
const manager = new RoomManager({ module: new URL('./room.js', import.meta.url), mode: 'worker', maxRooms: 8, maxPlayers: 32, idleCloseMs: 60_000 });
listener.onConnection = (conn) => manager.join(conn.route.room, conn);   // rooms are created on demand
manager.list();                                                          // [{ name, players, tick, tickMsAvg, ... }]
```
- **Nothing is shared.** Sockets stay in the gateway (they cannot be handed to a worker); each client appears inside the room as a virtual connection implementing the normal `Transport` contract, carried over the worker's message port with transferable buffers. Room code is identical in both modes.
- **Isolation:** a room that burns CPU or crashes cannot stall or take down the others. A crash disconnects only that room's players (close code 1011, reason "room crashed") and the next join starts a fresh room. A joining client's early packets are buffered until its room is ready.
- **Process mode** (`mode: 'process'`, `hostOptions`): the strongest containment. Each room is a forked child connected by an IPC channel (structured-clone serialisation, so packets travel as binary without encoding). On top of everything worker mode gives, a native fault or **out-of-memory only kills that room's process** (`memoryMb` sets a V8 heap cap per room: a memory bomb died in about 150 ms and the gateway's memory did not move), a hung room is killed after the `stopTimeoutMs` grace period, the environment is scrubbed (`env: {}` by default), and the room can run under Node's **permission model** (`confine: { fsRead, fsWrite, childProcess }`: no files except the listed paths, no writes, no spawning; the engine's own packages are always readable; the network is not restricted). A room process exits on its own if the gateway dies, never keeps the gateway alive once running, and reports its pid and memory (`list()` rows have `pid` and `rssMb`). A crash is reported with the room's own error text ("room exited (code 1): Error: ..."). Costs: about 55 MB of memory per room (a bare Node process) and a little more CPU per tick than worker mode; see below.
- **Limits and lifecycle:** `maxRooms`, `maxPlayers` per room, `autoCreate`, empty rooms closed after `idleCloseMs`.
- Measured on this machine (16 logical CPUs): a room that blocks for 700 ms leaves players in another room with a **31 ms** worst gap between ticks in worker mode, versus **701 ms** inline. Per-room cost is small (1,500 bots and 8 players: about 2 ms of a 16.7 ms tick) and both modes sustained 8 such rooms, so workers buy containment and multi-core headroom rather than speed at this scale. `npm run bench:rooms` reruns it.
- Process mode on the same machine (150 bots, 3 players per room): 8 rooms averaged **0.46 ms** per tick (worst 2.9 ms) versus 0.36 ms in worker mode and 0.18 ms inline, and a 700 ms stall in one room again left the other room's worst tick gap at **32 ms**. The extra cost is IPC serialisation of the snapshots; at 60 snapshots/s per player it is small next to the 16.7 ms budget.
- Gotcha found while building it: `Buffer#slice` is a view, not a copy (unlike `Uint8Array#slice`), so buffers crossing threads are copied explicitly.

## Not here yet
Process-per-room (stronger isolation than threads), moving a live room between workers, and matchmaking beyond routing by room name.
