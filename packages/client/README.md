# @engine/client

Client-side building blocks that do not depend on any particular game.

**May import:** `@engine/core`, `@engine/protocol`, `@engine/transport`, `@engine/physics` (currently nothing).

## `InterpolationClock`
Decides which server tick to draw other entities at, and keeps that clock smooth.

```js
const clock = new InterpolationClock({ tickMs: 1000 / 60 });
// on every accepted (newer) snapshot:
clock.onSnapshot(performance.now(), snapshot.tick);
// once per rendered frame:
const tick = clock.renderTick(performance.now());   // fractional; NaN before the first snapshot
sampleWorld(history, tick, out);
```
What it measures per snapshot: **lateness** (arrival time minus snapshot tick: latency plus average queueing), **jitter** (mean deviation of lateness), and the **gap** between accepted snapshot ticks (lost packets widen it; the buffer follows a slowly decaying *peak* gap because one lost snapshot must not freeze the view).

Buffer depth = peak gap + 4 x jitter, never below 2 ticks. The render clock **slews** (plays at most +-10% faster or slower) toward `now - lateness - buffer`, so changing conditions never look like a jump, and it snaps only when the target moves far away. A sustained lateness step (route change, 5 samples in a row) is adopted immediately; single spikes are ignored.

`status(nowMs)` returns lateness, jitter, buffer, how far behind the newest snapshot we really are, playback speed and snap count for a debug overlay. `fixedDelayMs` switches adaptation off for A/B comparisons.

## How the defaults were chosen (numbers from `tools/arena-netlab.js`, virtual clock, 30 s each)
| Network | Adaptive: behind newest / starved frames | Fixed 100 ms | Fixed 50 ms |
|---|---|---|---|
| good (20 ms) | 10-18 ms / 0% | 85 ms / 0% | 35 ms / 0% |
| jittery (60 ms jitter) | 63-76 ms / 0% | 81 ms / 0% | 31 ms / 2.2% |
| lossy (10% loss) | 30-36 ms / 0.7% | 83 ms / 0% | 33 ms / 0.4% |
| awful (80 ms jitter, 25% loss) | 92-107 ms / 0-0.2% | 75 ms / 0.3% | 25 ms / 13.9% |

"Starved" = frames where no newer snapshot had arrived to interpolate toward. `node tools/arena-netlab-sweep.js` re-runs the parameter sweep (the first defaults, k=3 / 1.5 ticks, starved 4% of frames at only 10 ms of jitter).

Input queues and the arena rules still live in `examples/arena` because they are that game's. Prediction does not: it is `Predictor`, below.

## `Predictor`: client-side prediction with server reconciliation
Your own character moves the moment you press a key, and the server's word is checked afterwards. You give it the **same step function the server runs** for one input; it applies every input at once, remembers what it predicted, and when a snapshot says "I have applied your inputs up to N, and you were here", it compares. Nearly always the guess was right and nothing happens. When it was wrong, the server's state is adopted, every input newer than N is replayed on top of it, and the jump is hidden by easing a visual offset to zero.

```js
const predictor = new Predictor({ step: (s, input, dt) => move(s, input, dt), dt: 1 / 60, initial: { x: 0, y: 0 } });
predictor.record(seq, input);                       // every tick, with the seq you send to the server
predictor.reconcile(snapshot.ackSeq, snapshot.me);  // on every snapshot that carries your own state
predictor.smooth(frameSeconds);                     // every rendered frame
const at = predictor.renderState(alpha);            // where to draw yourself
```
A state is a flat object of numbers (use 0 and 1 for yes and no); an input is plain data that is not changed after it is recorded; the step function must be deterministic. The server may send only some of the numbers. `tolerance`, `snapDistance`, `smoothHalfLife`, which numbers are `smooth` (default `x` and `y`) and how the `error` is measured can all be set. `predictor.stats` counts corrections, snaps and the largest error, for a debug overlay.

It is tested against the arena's own hand-written predictor (`examples/arena/test/predictor-equivalence.test.js`): on the arena's real movement and walls, with and without a push from the server, both draw the same position, to within a billionth of a unit, on every tick.

## `RollbackSession`: rollback netcode
For peer-to-peer or lockstep-style games (fighting games, small co-op) where every player runs the whole game and only **inputs** are sent. Each frame is simulated at once with the inputs that are known and a **guess** for those that have not arrived (the same as the last one, by default). When a real input arrives that was guessed wrong, the session goes back to the state before that frame and simulates forward again with the truth, all inside one `advance()`.

```js
const session = new RollbackSession({ players: 2, local: 0, init: () => ({ x: [0, 100] }), step: (state, inputs, frame) => { /* deterministic */ },
  inputDelay: 2, maxRollback: 8, checksum: (state) => hash(state) });
const frame = session.addLocalInput(readKeys());          // which frame this input is for
send({ frame, input });                                   // to the other players
for (const m of received) session.addRemoteInput(m.player, m.frame, m.input);   // late, early or twice is fine
session.advance();                                        // false when it has to wait (maxRollback frames ahead of what is confirmed)
draw(session.state);
```
- `inputDelay` takes the local input a few frames late, which gives the other player time to answer and so means fewer rollbacks (the tests show it).
- `confirmed()` is the newest state that can never change and its checksum; send `{frame, checksum}` and give what you receive to `report(frame, theirChecksum)`: it returns `false` and sets `session.desync` the moment the two machines stop agreeing.
- `stats` counts rollbacks, frames simulated again, the longest rollback and stalls. Old snapshots and inputs are forgotten, so a long game does not grow.
- Two machines with a delay between them end up, for every confirmed frame, in exactly the state of the same game run on one machine (the tests check this, with even and uneven delays).

The state must be plain data (it is copied with `structuredClone`, or the `clone` you give) and `step` must be deterministic: use `@engine/math` instead of `Math.sin`, and no clock or random numbers that are not seeded.
