# Arena demo

A small fast-movement arena that exercises the whole stack: shared rules, authoritative server, delta snapshots over WebSocket, interpolation, and the WebGPU/WebGL2/Canvas2D renderers.

```
npm run arena            # http://127.0.0.1:8080/   (--port, --host, --bots, --tick)
npm run test:browser     # headless Chrome: renderer self-test + the demo with each renderer
```
Controls: WASD or arrows to move, Shift to dash, **mouse to aim and click (or Space) to fire**, **F3 for the debug overlay** (graphs plus a decoded packet inspector; `?debug=1` opens it at start). Server options: `--bots 150 --view 700 --bandwidth 60000 --no-lagcomp` (how far each client sees, in world units, and an optional per-client budget in bytes/second).
Add `?renderer=webgl2` (or `canvas2d`, `webgpu`) to force a backend.

## Layout
- `shared/game.js` - rules both sides use: components, net schema, input layout, deterministic wall map, `stepMover` (swept collision) and `applyInput`, which the server and the client's prediction both call.
- `server/arena-server.js` - fixed 60 Hz tick, static files and WebSocket on one port, per-client delta snapshots against the acked baseline, bots.
- `server/input-queue.js` - per-client sequenced input queue with gap filling and pacing.
- `client/net.js` - handshake, snapshot decoding with acks, redundant input packets. No DOM, so tests and bots can run it in Node.
- `client/predict.js` - `PredictedPlayer`: local prediction, reconciliation, replay and visual smoothing.
- `client/interp.js` - samples the snapshot history at the adaptive render tick and interpolates.
- `client/main.js`, `index.html` - rendering, input, HUD.

## Prediction (M3)
Your own player is predicted: each input is applied locally at once with the same `applyInput` the server runs, remembered with its result, and checked against the server's answer in every snapshot (the snapshot header carries "last input applied"). A mismatch replays the unacknowledged inputs from the server's state and eases the visual jump away. Other players are interpolated slightly in the past; how far is adaptive (`@engine/client` `InterpolationClock`), usually 10-20 ms behind the newest snapshot on a good link and more when jitter or loss appear. Add `?delay=100` to force a fixed delay for comparison; the HUD shows RTT, jitter and playback speed.

Try it on a slow connection without leaving localhost: `http://127.0.0.1:8080/?lag=100&jitter=20&loss=0.05` adds 100 ms each way, 20 ms jitter and 5% loss; add `&predict=0` to feel the difference. The HUD shows pending inputs, corrections and last error.

Server side, each client has an `InputQueue`: inputs are applied in order, one tick of movement each; duplicates and stale packets are ignored; lost inputs are filled by repeating the previous one; pacing (one input per tick plus a little banked credit) means a client flooding inputs cannot move faster than the tick rate.

## Rooms
`/?room=alpha` joins (or creates) the room "alpha" (default "lobby"; names use a-z 0-9 _ -); `/rooms` lists them as JSON. Each room runs in its own worker thread (`--mode inline` runs them in the main thread), so one room cannot stall or crash another. Options: `--max-rooms 8 --max-players 32`.

## Reconnect and session resume
The server issues each player an unguessable 128-bit session token in WELCOME. If the connection drops, the player's entity stays in the world, frozen, for 15 seconds (`resumeWindowMs`, counted in server ticks). The client (`reconnect: { createTransport }`) retries with exponential backoff (250 ms, 500 ms, 1 s, ... up to 4 s, 8 attempts), presents the token, and gets the same player back: same entity, position and health. Replication and input numbering restart cleanly (the first snapshot is full, sequence numbers restart at 1). A new connection with a valid token also takes over a half-open one the server has not noticed dying. After the window, or with an unknown token, the player simply starts as a new one; leaving with `close()` or being rejected never reconnects. `node tools/arena-reconnect-test.js` kills a live browser's WebSocket mid-game and checks it returns as the same player.

## Combat and lag compensation
A hitscan weapon (range 900, 25 damage, 100 HP, 10 tick cooldown; bots and players respawn on death). The shooter aims at what is *drawn on their screen*, which is in the past by their network delay plus the interpolation buffer, so a naive server would judge the shot against where targets are *now* and miss anything that moves.

So when you fire, the input carries the tick you were looking at (quarter-tick precision). The server rewinds to it using the **views it actually sent that client** (`ClientReplicator.positionAt`), not a separate world history, so it judges exactly what you saw, including entities whose updates were budget-limited, and an entity you could not see cannot be hit. The rewind is capped (`--maxRewindMs 250`) so a laggy or dishonest client can only reach back so far. Walls stop shots; the shooter's origin is their authoritative current position (equal to what their prediction used); fire is an *event* so lost-input gap filling never repeats a shot; shot events (tracers) go to the shooter and to clients within view.

Measured, 100 ms each way (200 ms RTT), shooter always aims at the displayed target: **30/30 hits with rewind versus 1/30 without** in the deterministic lab; in a real browser against the real server, **54/54 (8-10 kills) with rewind versus 12-20 of 54 (22-37%, depends on where the bots happen to be) without**. `node tools/arena-combat-test.js` reruns the live comparison.

## Predicting your own shots
Without it, pulling the trigger shows nothing until the server's shot event comes back one round trip later (about 220 ms at 100 ms each way). With `predictShots` (default on; `?predictshots=0` turns it off) the client shows the tracer and the hit **the instant you fire**:
- The ray maths is one shared function (`shared/shot.js`, `traceShot`) used by the server and the client, run from your predicted position, along your quantized aim, against the targets as *you* see them at the view tick you report: exactly the inputs the server rewinds to.
- **Cooldown is counted in your own inputs** (one per tick of your time), by both sides, instead of server wall-clock ticks. So the client knows exactly when the server will accept the next shot: holding fire predicted precisely as many shots as the server accepted, for cooldowns of 5, 10 and 23 (tested). It is still safe: inputs are applied at no more than one per tick over time (with a small banked burst), so flooding inputs or jumping sequence numbers cannot fire faster than the cooldown.
- The shot event now carries the firing input's sequence number. The server's event confirms the prediction (`onShotResult`) and is **not drawn a second time**; if it disagrees (a different victim) the correction is drawn (`corrected: true`), and the client follows the server's cooldown count. The server stays the only judge: damage and kills are never predicted.
- Measured in Chrome at +100 ms each way: tracer on screen after **0 ms** versus **222 ms** without prediction; the server's verdict still arrives about 216 ms later, and 47/47 confirmed shots matched the prediction. `node tools/arena-fire-test.js` reruns it.

## Known limits
- The rewind only covers targets' positions, not their hitbox size changes. Damage, health and kills are shown only when the server's state arrives (a predicted hit flashes the burst, not the health bar).
- Each client only receives entities within its view radius (default 700 units), and an optional per-client bandwidth budget favours near entities (`@engine/server`). With every entity moving every tick the encoder still falls back to full snapshots when no budget is set; deltas shine once a budget makes fewer entities change per tick.
- Axes are integer inputs (-127..127): a quantized float such as `q(-1, 1, 8)` cannot represent exactly 0 and would drift.
