# How it works

The engine is 26 small packages that fit together through a few strict rules. This page is the map: the layers, what happens in a frame, how a networked game works, the rules that keep packages apart, and the reasons behind the main decisions. If you are going to change the engine, start here.

## The shape in one picture

{{diagram:layers}}

Read it from the bottom. **Foundation** has no engine dependencies at all. **Simulation** is what a game world *is*: movement, collision, behaviour, levels. **Presentation** is how a player perceives it. **Content and tools** are how you make, save and ship it. **Multiplayer** is how several people share one world, or one game table.

The important property is that nothing is mandatory. A single-player 2D game uses perhaps five packages and never loads the network code. A dedicated server uses the multiplayer and simulation layers and never loads a renderer.

## Four principles

**1. The rules are separate from the picture.** Game rules are plain functions over plain data (`step(game, input)`), with no screen, no clock and no keyboard inside them. This is what lets the same rules run in the browser, on the server and in a test, and it is what makes a replay a list of inputs.

**2. Time moves in fixed steps.** The simulation advances 60 times a second, whatever the frame rate. Rendering blends between two states. This is what makes physics stable and prediction possible: the client and the server compute the same step.

{{diagram:frame}}

**3. The same code gives the same answer everywhere.** Prediction only works if client and server agree bit for bit, but `Math.sin` is *not* the same in every JavaScript engine. So `@engine/math` has its own trigonometry, shared code sticks to operations the language specifies exactly (`+ - * /`, `sqrt`), and `node tools/determinism.js` hashes the shared simulation in Node, Chrome and Firefox to prove it.

**4. The server decides what is true.** In a networked game the browser is a very fast *guess*: it shows your move immediately, then the server's answer corrects it. The server never takes the client's word about an outcome (a hit, a score, a position past a wall), so cheating clients mostly cheat themselves.

## What happens in a frame

For one rendered frame of a networked game:

1. The browser reports how much real time passed. The `FixedLoop` adds it to an accumulator.
2. For each full 1/60 s in the accumulator, one **tick** runs: read input, send it, apply it to your own character at once (prediction), apply any snapshot that arrived and replay the inputs the server has not seen yet (reconciliation).
3. Then the frame is drawn: other players are shown a little in the past, blended between two server snapshots (interpolation), so they move smoothly even though updates come in bursts.
4. Sound, particles and the HUD update from the events the tick produced.

A single-player game is the same loop without step 2's network parts. [Multiplayer, explained](multiplayer-explained.md) has the details and a lag simulator you can play with.

## Components of a networked game

{{diagram:net}}

| Package | Its job in the loop |
|---|---|
| [`protocol`](../../packages/protocol) | The wire format: which fields exist (`NetSchema`), how they are packed (quantized integers), delta snapshots against an acknowledged baseline, the handshake. |
| [`transport`](../../packages/transport) | A two-channel connection contract (reliable and unreliable), an in-memory network with simulated loss and latency for tests, and our own WebSocket server and client. |
| [`server`](../../packages/server) | Interest management (tell each client only about what is near it), bandwidth budgets, rooms in worker threads or processes, session resume. |
| [`client`](../../packages/client) | The interpolation clock that decides how far in the past to draw others, and keeps that smooth; client-side prediction with reconciliation for your own character; and rollback netcode for peer-to-peer games. |
| [`matchmaking`](../../packages/matchmaking) | Queues, parties, rating windows, lobbies, join tokens. |
| [`persist`](../../packages/persist) | What outlives a match: profiles, leaderboards, guest accounts. |
| [`turns`](../../packages/turns) | The turn-based variant: rules as functions, hidden information, a room, a client. |

Rooms are isolated by design: each one is a separate simulation behind the same `Transport` contract, in a worker thread, a child process, or inline for tests. One room crashing or overrunning its budget does not take the others down.

## The import rules

Packages may only import the packages listed for them, and only through their public entry. A short script, `tools/check-deps.js`, reads every `src/` file and fails `npm test` if the rule is broken:

```js
// tools/check-deps.js: the whole list of allowed edges (an excerpt)
export const ALLOWED = {
  core: [],                                  // the foundation imports nothing
  physics: ['core', 'math'],
  render: ['core', 'math'],
  server: ['core', 'protocol', 'transport', 'physics', 'math'],
  turns: ['matchmaking', 'transport'],
};
```

- **Default deny.** A new package must be given an entry, which makes adding a dependency a conscious decision.
- **Public entries only.** Another package is imported from `src/index.js` (or `@engine/<name>`), never from a deep path. Internals can change without breaking anyone.
- **Browser or Node.** Code that runs in a browser lives in `src/index.js`. Code that needs Node (files, threads, child processes) lives in `src/node.js`, so a page can never accidentally import a file system.
- **No third-party code.** Packages import only each other and Node's built-ins.

## Where the performance comes from

The hot paths are written for speed on purpose, and each says so in a comment:

- **Typed arrays instead of objects** for entities and snapshots (struct-of-arrays), so the engine allocates nothing per tick and the garbage collector never pauses a frame.
- **Quantized, delta-coded packets**: positions as small integers, only changed fields sent, full snapshots only when most things changed.
- **Interest management**: bandwidth per player depends on what is *near* them, not on the size of the world.
- **Spatial grids** for collision and visibility instead of comparing everything with everything.
- **Instanced rendering**: one draw call per mesh or sprite batch, not one per object.

## Rendering

`createRenderer()` picks WebGPU if the browser has a usable adapter, then WebGL2, then Canvas2D, and your code is the same for all three. 3D has the same shape (`createRenderer3D`): a camera, a `DrawList3D` of meshes, a lighting description, and optional shadows, bloom and particles. A 2D HUD can sit on a transparent canvas over a 3D view, as in the shooter. Benchmarks for both backends are in the [reference](../BENCHMARKS.md).

## Trust and modding

Players can extend a game, so the engine treats mod code as hostile:

1. **Data mods** (JSON) are always safe and cover most needs.
2. **Script mods** run in a separate child process with the Node permission model on (no files, no spawning), a hardened VM context, a time budget per tick and strikes for misbehaviour.
3. **Bundles are content-addressed**: the server advertises each mod's hash, the client downloads and verifies it before joining, so prediction runs the same rules as the server.

The threat model and the abuse cases that were tried are in the [security notes](../SECURITY.md); how to write a mod is in the [modding guide](../MODDING.md).

## How the engine is kept honest

`npm test` is the gate, and it checks more than behaviour:

| Check | What it prevents |
|---|---|
| `check-deps` | A package importing something it must not |
| `release check` | Package metadata that no longer matches the real imports |
| `api-docs check` | A public export without a description, or API pages that are out of date |
| `sync-templates check` | The project templates drifting from the example games they are made from |
| `site check` | This website out of date, or a broken link in it |
| Unit and integration tests | The behaviour of every package, including simulated bad networks |
| `test:browser` (needs Chrome) | Each renderer, the examples with real key presses and clicks, cross-engine determinism |

## Decisions and their costs

| Decision | Why | What it costs |
|---|---|---|
| Zero dependencies | Nothing to audit or update; the engine runs from source | We maintain things (a WebSocket server, a bundler) that libraries already have |
| Plain JavaScript with JSDoc | No build step to start; types are still checked and documented | Less editor help than TypeScript for complex generics |
| Authoritative server | Cheating is hard and every player sees one truth | Needs a server, and latency is hidden with prediction instead of removed |
| Own maths functions | Bit-identical results in every engine | Slightly slower than the built-in `Math.sin` |
| Fixed 60 Hz tick | Stable, predictable, replayable | Fast-twitch games at higher rates would need a different tick rate (it is a setting) |
| Many small packages | Take only what you need, enforce boundaries | More names to learn; this guide and the package list exist to help |

## What is not done

Honesty helps you plan:

- The Android client (a native shell) is planned and not started.
- Load has been measured on one machine (300 players in 10 rooms); multi-machine scaling is untested.
- Persistence has file and memory stores; a real database adapter does not exist yet.
- Packages are not published to npm yet.
- Safari and iPhone are not a priority: they have not been tested for cross-engine determinism.

The [roadmap](../PLAN.md) has the full history and the open items.

## Adding a package

1. Make `packages/<name>/` with `package.json`, `README.md`, `src/index.js` (and `src/node.js` if it needs Node), and `test/`.
2. Add its allowed imports to `ALLOWED` in `tools/check-deps.js` and its layer to `LAYERS` in `tools/site-lib.js`.
3. Describe every public export with JSDoc: `npm test` fails until each has a description.
4. Run `node tools/release.js sync`, `node tools/api-docs.js write` and `node tools/site.js write`, then `npm test`.
