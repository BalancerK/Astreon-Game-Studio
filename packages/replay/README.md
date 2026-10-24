# @engine/replay

Replays and spectating. Three ways to keep a match, and one way to watch it live. Zero dependencies apart from `@engine/protocol`; every piece is optional.

**May import:** `@engine/protocol`.

| You want | Use | Size |
|---|---|---|
| To save what a viewer saw, and play it back on any machine, even if the game's rules have since changed | `ReplayRecorder` / `ReplayPlayer` (snapshots) | about 1 to 3 MB for 5 minutes of 40 entities |
| A tiny file, for a game whose simulation is deterministic | `InputRecorder` / `InputPlayer` (inputs) | a few KB for a 100 second match of two players |
| Anyone to watch a match live, a few seconds behind the players | `SpectatorFeed` + `SnapshotReceiver` | one encode shared by every spectator |

## Snapshot replays

```js
import { ReplayRecorder, ReplayPlayer } from '@engine/replay';

const rec = new ReplayRecorder({ schema, capacity: 1024, tickRate: 60, keyframeEvery: 120, meta: { map: 'dunes', players } });
// on the server, once per tick (the full-world snapshot, or what one viewer is shown):
rec.record(snapshot);
rec.event(tick, 'kill', { by: 'ann', who: 'bob' });          // anything JSON-able, tied to a tick
const bytes = rec.finish();                                   // a file; or pass onChunk to write it as you go

const player = new ReplayPlayer(bytes, { schema, capacity: 1024, onSnapshot: (snap) => {}, onEvent: (e) => showFeed(e) });
player.update(dt);                  // every frame; speed, playing and loop are plain properties
player.seek(95); player.seekTick(5700);
// draw like a live client: player.history.around(player.tickAt) gives the pair of snapshots to interpolate between
```

- **What is stored** is what the network carries: the same quantised delta snapshots (`SnapshotCodec`), against the previous frame, with a full snapshot every `keyframeEvery` ticks so a seek starts from the nearest one and decodes forward (at most `keyframeEvery` frames of work). The schema's hash is in the header: a replay only plays against the schema it was recorded with (`ProtocolError` otherwise), and the file layout is versioned.
- **Measured** (5 minutes at 60 Hz, `keyframeEvery: 120`, positions quantised to 16 bits): 40 entities with 10% moving each tick, 834 KB (2.8 KB/s); 40 entities, half moving, 3.4 MB (11 KB/s); 200 entities, 10% moving, 3.5 MB; 200 entities, half moving, 16 MB. The delta saves a lot when little changes (a quarter of the size of storing every frame whole) and little when everything moves every tick (about three quarters), as it does on the wire. `every: 3` records 20 frames a second for a third of the size, and plays smoothly with interpolation.
- **Crashes:** `onChunk` receives the header and every frame as it is made, so a server can write the file as it goes; a file cut short plays up to where it stopped (`player.truncated`).
- **Playing:** `update(dt)` advances by `dt * speed` seconds, tells `onSnapshot` of every frame passed and `onEvent` of every event passed (once, in order; not during a seek), and decodes the next frame ahead, so `history` always holds both sides of the playhead. `seek` lands on the frame at or before the time; `frameAt`, `eventsBetween`, `frames` and `events` are there for a timeline with markers.

## Input replays

For a game whose simulation is deterministic (the engine's fixed timestep and `@engine/math` are for that), keep only what the players pressed:

```js
import { InputRecorder, InputPlayer, hashState } from '@engine/replay';

const rec = new InputRecorder({ game: 'dots', version: 3, tickRate: 60, meta: { seed },
  save: () => game.state, hash: () => hashState(game.state), checkpointEvery: 600, hashEvery: 60 });
// at the start of every tick, before the game runs it:
rec.record(tick, inputsOfEveryPlayer);                         // anything JSON-able
const text = rec.toText();                                     // or rec.finish() for plain data

const player = new InputPlayer(text, { step: (inputs, tick) => game.step(inputs, tick), load: (s) => game.load(s), hash: () => hashState(game.state) });
player.update(dt); player.seek(4000); player.speed = 4; player.loop = true;
```

- **Seeking** restores the nearest saved state at or before the tick (`load`) and plays forward: jumping anywhere costs at most `checkpointEvery` ticks. A replay with no saved states plays from the start only.
- **Drift is caught.** Every `hashEvery` ticks the recording keeps a hash of the state; the player checks it before running that tick. If an update changed the rules, or something in the game is not as deterministic as it should be, you get a `ReplayDesyncError` naming the tick (or `onDesync` for each one) instead of a wrong ending.
- Identical consecutive inputs are stored as one run, so a held button costs nothing.

## Spectating

```js
import { SpectatorFeed, SnapshotReceiver } from '@engine/replay';

const feed = new SpectatorFeed({ schema, worldCapacity: 1024, delayTicks: 600, every: 3 });   // ten seconds behind, 20 snapshots a second
// server, each tick: feed.push(fullWorldSnapshot)
// per spectator, when sending: const bytes = feed.packet(spectatorId, theirAckTick); if (bytes) send(bytes);

const rx = new SnapshotReceiver({ schema, capacity: 1024 });  // the spectator's client
const snapshot = rx.receive(packet);                          // then ack rx.ackTick (-1 asks for a full snapshot)
```

- **The delay** keeps a team from being told where the enemy is: spectators are shown the world `delayTicks` ago.
- **Shared bytes:** every spectator whose acknowledged tick is the same gets the very same packet, encoded once (`feed.stats.cacheHits`), so a hundred spectators cost a few encodes, not a hundred. One acknowledged too long ago (beyond `ackLag` kept snapshots), or none, gets a full snapshot.
- **The packets are ordinary snapshot packets** (`MSG.SNAPSHOT`, input acknowledgement 0), so a spectator's client can be the normal client with prediction switched off. `SnapshotReceiver` is that client's decoding half, usable on its own: it keeps the snapshots it needs, ignores late and repeated packets, survives garbage, and when it lacks the snapshot a delta starts from it sets `needsFull` instead of throwing.
- **Not done:** spectators choosing a camera on the server (they see the whole world: filter on the client), a spectator-only room with chat, a bandwidth budget per spectator, and joining a replay as a live player ("take over the bot").
