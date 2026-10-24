# @engine/protocol

The wire format: binary reader/writer, quantizing codecs, replicated-state schema, delta snapshots with acks, handshake and input messages.

**May import:** nothing. It talks to the world only through its documented shape (`world.stores`).

## Concepts
- **`NetSchema`**: the agreed list of replicated components and fields. Both sides build the same one; its `hash` is checked in the handshake.
- **Codecs** (`u8`...`i32`, `f32`, `f64`, `q(min, max, bits)`): values are held as exact quantized integers, so change detection never jitters.
- **`Snapshot`**: replicated state at one tick, rows sorted by entity slot.
- **`SnapshotCodec`**: `encode(writer, current, baselineOrNull)` / `decode(reader, getBaseline, out)`. Sends only changed entities and fields against an acked baseline; falls back to a full snapshot when 75%+ of entities changed. `decode` throws `MissingBaselineError` when the baseline is gone (reply with ack tick 0 to get a full snapshot).
- **`SnapshotHistory`**: ring of recent snapshots. `acquire()`, fill, `commit()`. Half-written snapshots can never become baselines.
- **Messages**: `HELLO`, `WELCOME` (includes the plugin list), `REJECT`, `INPUT` (newest snapshot ack + up to 16 redundant inputs with sub-tick offsets), `SNAPSHOT`.

## Safety
The reader is bounds-checked and decoders only ever throw `ProtocolError` on malformed data (fuzz-tested). Always catch it at the network boundary.

## Not here yet
Applying a decoded snapshot to a client `World` (needs `createWithId` in core), bandwidth budgets, interest filtering.

Benchmark: `node packages/protocol/bench/snapshot.js [entities]`
