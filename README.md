# Astreon Engine

A modular, zero-dependency JavaScript engine for **fast-action browser multiplayer games**: authoritative Node server, browser client, binary delta protocol, swept collision, and a WebGPU/WebGL2/Canvas2D renderer. Apache-2.0.

> Status: version 0.1.0. Milestones M1 to M11 are done (netcode, 2D and 3D rendering, audio, input, UI, physics, AI, prefabs, saves, asset pipeline, scene editor); M12 (making it easy for other people) is under way. See `docs/PLAN.md` for the roadmap and known gaps, `CHANGELOG.md` for what is in each release.

## Read the docs
The documentation website is generated from this repository: `npm run site`, then open `docs/site/index.html` (guides, tutorials, every package and the API, with search and a lag simulator). Good places to begin: [Start here](docs/guide/start-here.md), [How it works](docs/guide/architecture.md) and [Multiplayer, explained](docs/guide/multiplayer-explained.md).

## Astreon Studio
A game studio in the browser, made with Astreon Engine: `npm run studio`, then open `http://localhost:8090/`. Write code beside the game it makes; see [`studio/README.md`](studio/README.md) and the design in [`docs/STUDIO.md`](docs/STUDIO.md).

## Start a game
```
npx create-game my-game                 # or: --template 3d  (with the scene editor)
cd my-game && npm run dev
```
See [`packages/create-game`](packages/create-game). Releases are one version for all packages (`node tools/release.js`: check, bump, pack, verify).

## Try the demos
```
node -v                  # 20+ (developed on 24)
npm test                 # dependency rules + unit/integration tests
npm run arena            # open http://127.0.0.1:8080/   (add: -- --mods examples/arena/mods  to load the sample mods)
node tools/mod.js        # mod author tools: validate, run in the sandbox, sign, pack
npm run test:browser     # headless Chrome + Firefox: renderers, the live demo, cross-engine determinism
npm run determinism      # shared simulation hashed bit-for-bit in Node, Chrome and Firefox
# in the demo: press F3 for the debug overlay (or add ?debug=1)
```

## Packages
| Package | What it is |
|---|---|
| [`core`](packages/core) | Fixed-timestep loop, typed-array ECS, plugin system, scheduler |
| [`math`](packages/math) | Deterministic sin/cos/tan/atan2/asin/acos plus 3D vectors and quaternions, bit-identical in Node, Chrome and Firefox (the built-in `Math.sin` is not) |
| [`physics`](packages/physics) | 2D spatial hash and swept box collision; 3D triangle worlds, swept-ellipsoid movement and a character controller (no tunnelling at any speed); rigid bodies with joints, sleeping and triggers |
| [`protocol`](packages/protocol) | Binary codecs, quantization, delta snapshots with acks, handshake, inputs |
| [`transport`](packages/transport) | Reliable/unreliable channel contract, in-memory network + loss/latency simulator, own RFC 6455 WebSocket server and client |
| [`input`](packages/input) | Actions and bindings over keyboard, mouse, gamepad and on-screen touch controls; contexts, rebinding, saving, prompts |
| [`ui`](packages/ui) | Menus and HUDs on the 2D renderer: flexbox-style layout, buttons, sliders, switches, text fields, lists, themes, keyboard / gamepad / mouse / touch navigation, and ready-made pause, settings (key rebinding) and room-browser screens |
| [`prefab`](packages/prefab) | Entity templates as JSON: inheritance, children, parameters, overrides, parent-child transforms, capturing what changed for saves |
| [`assets`](packages/assets) | Asset manager: one fetch per file, hashed-name manifest, use counting, retries, dependencies, hot reload |
| [`scene`](packages/scene) | Levels as data (scene files, validation, migrations, loading and unloading) and the undoable `SceneDocument` the editor uses |
| [`matchmaking`](packages/matchmaking) | Getting players into games: fair queues with parties and widening skill windows, balanced teams, Elo ratings, a room directory with join codes and seat reservations, signed join tokens and an HTTP match service |
| [`persist`](packages/persist) | What outlives a match: a versioned key-value store (memory, files), player profiles with a write-behind cache and migrations, leaderboards, guest accounts and an append-only log |
| [`turns`](packages/turns) | Turn-based and card games: rules as plain functions with hidden information and seeded randomness, a server room (tokens, robots, turn timers, rematch) and a client with reconnect |
| [`create-game`](packages/create-game) | `npx create-game my-game`: a new project from a template (2D, 3D or multiplayer card game), wired to the dev server, the build and the editor |
| [`build`](packages/build) | Production build (bundle, minify, content-hashed files, manifest, precompression) and a dev server with live manifest and page reload |
| [`editor`](packages/editor) | Browser scene editor: viewport with gizmos, hierarchy, inspector generated from prefabs, undo, saving, Play-in-editor; the pieces also work without a page |
| [`save`](packages/save) | Save and load: slots, quick and auto saves, checksums and backups, all-or-nothing loads, versioned data with migrations, sections for the scene, physics and state machines, storage in memory, localStorage, IndexedDB, files or over HTTP |
| [`arcade`](packages/arcade) | A small kit for a first game (the studio's pathway starts here): things as plain objects, easy key names, walking, jumping and walls, levels drawn with letters, boxes and emoji, a camera |
| [`fsm`](packages/fsm) | Hierarchical state machines (events, timers, history, saving) and an animation graph with blend trees and cross-fades |
| [`tween`](packages/tween) | Tweens and timelines: 30+ easings, delays, repeats, yoyo, relative values, labels, overlapping steps, seeking; deterministic |
| [`i18n`](packages/i18n) | Localisation: plural forms for every language, contexts, gettext `.po` and CSV import, fallback chains (`pt-BR` to `pt`), pseudo-localisation, a list of what is untranslated |
| [`ai`](packages/ai) | Navigation grid built from the level, A* paths (resumable), steering, behaviour trees and perception; the arena's bots are built from it |
| [`skeleton2d`](packages/skeleton2d) | 2D skeletal animation: bones, skins, weighted meshes with deformation, IK, keyframes with curves and events, crossfading tracks, drawn through the renderer's mesh batch |
| [`particles`](packages/particles) | Particle effects for the 3D renderer: data-driven bursts and emitters, streaks, decals, additive glow; presets for muzzle flashes, impacts, bullet holes, dust, explosions |
| [`audio`](packages/audio) | Web Audio mixer with buses and a limiter, positional sound, voice limits, music cross-fades, and sounds made in code (no files needed) |
| [`client`](packages/client) | Adaptive interpolation clock (jitter/loss-aware render delay), client-side prediction with reconciliation, and rollback netcode |
| [`replay`](packages/replay) | Replays and spectating: record a match as compact snapshot deltas (seek anywhere, any speed) or as its inputs (a few KB, with drift detection), a delayed feed shared by any number of spectators |
| [`server`](packages/server) | Interest management, bandwidth budgets, lag-compensation queries, isolated rooms (worker threads) |
| [`mods`](packages/mods) | Safe third-party mods: manifests, content-hashed bundles, sandboxed script mods in confined processes, signing, policy, validated commands (guide: [`docs/MODDING.md`](docs/MODDING.md), threat model: [`docs/SECURITY.md`](docs/SECURITY.md)) |
| [`debug`](packages/debug) | In-page overlay: live graphs and a decoded packet inspector (F3) |
| [`render`](packages/render) | 2D sprites, text (including scalable SDF text) and a 3D mesh renderer with glTF loading: WebGPU -> WebGL2 (-> Canvas2D for 2D) |
| [`examples/platformer`](examples/platformer) | A 2D platformer tutorial game: tile levels, running and jumping that feels right (coyote time, jump buffer, variable height), enemies, springs, sound made in code, best times; the rules are replayable and a bot proves every level can be finished |
| [`examples/shooter`](examples/shooter) | A first-person 3D shooter tutorial game (`npm run shooter`): waves of robots with line of sight and cover, hitscan rifle with headshots, reload, pickups, sun shadows, bloom, particles, positional sound; deterministic rules and a bot that proves it can be won |
| [`examples/crazy-eights`](examples/crazy-eights) | A complete multiplayer card game (`npm run crazy-eights`): accounts, matchmaking, private tables, ratings, leaderboard, robots, browser client; also the `multiplayer` template |
| [`examples/arena`](examples/arena) | Playable 2D multiplayer demo using all of the above |
| [`examples/arena3d`](examples/arena3d) | First-person multiplayer shooter in 3D (`npm run arena3d`): prediction, lag compensation, interest management, mods |
| [`examples/physics3d`](examples/physics3d) | A rigid-body playground (`npm run physics3d`), its things all prefabs: a wall of crates, a wrecking ball, a seesaw, a ragdoll, a spinning paddle, a trigger zone, a sliding door run by a state machine; shoot things and rain more in |
| [`examples/walk3d`](examples/walk3d) | First-person 3D walk around a test level (`npm run walk3d`): math, 3D physics and the 3D renderer together |

Package boundaries are enforced by `tools/check-deps.js` (default deny, no external dependencies).

## Docs
[`docs/api`](docs/api/README.md): the API reference, generated from the source (every export of every package; `docs/api/index.html` is a searchable version; `npm run docs` regenerates it and `npm test` fails if it is stale or an export has no description).

`docs/PLAN.md` holds the architecture decisions, research findings, milestones and open questions.
