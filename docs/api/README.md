# API reference

Generated from the source by `npm run docs` (`tools/api-docs.js`): every export of every package with its JSDoc. Open [index.html](index.html) for a searchable version.

| Package | What it is | Exports | Documented |
|---|---|---|---|
| [`@engine/ai`](ai.md) | Navigation grid built from the level, A* paths (resumable), steering, behaviour trees and perception; the arena's bots are built from it | 51 | 100% |
| [`@engine/arcade`](arcade.md) | A small kit for a first game (the studio's pathway starts here): things as plain objects, easy key names, walking, jumping and walls, levels drawn with letters, boxes and emoji, a camera | 223 | 100% |
| [`@engine/assets`](assets.md) | Asset manager: one fetch per file, hashed-name manifest, use counting, retries, dependencies, hot reload | 13 | 100% |
| [`@engine/audio`](audio.md) | Web Audio mixer with buses and a limiter, positional sound, voice limits, music cross-fades, and sounds made in code (no files needed) | 48 | 100% |
| [`@engine/build`](build.md) | Production build (bundle, minify, content-hashed files, manifest, precompression) and a dev server with live manifest and page reload | 17 | 100% |
| [`@engine/client`](client.md) | Adaptive interpolation clock (jitter/loss-aware render delay), client-side prediction with reconciliation, and rollback netcode | 3 | 100% |
| [`@engine/core`](core.md) | Fixed-timestep loop, typed-array ECS, plugin system, scheduler | 16 | 100% |
| [`@engine/create-game`](create-game.md) | npx create-game my-game: a new project from a template (2D, 3D or multiplayer card game), wired to the dev server, the build and the editor | 4 | 100% |
| [`@engine/debug`](debug.md) | In-page overlay: live graphs and a decoded packet inspector (F3) | 6 | 100% |
| [`@engine/editor`](editor.md) | Browser scene editor: viewport with gizmos, hierarchy, inspector generated from prefabs, undo, saving, Play-in-editor; the pieces also work without a page | 66 | 100% |
| [`@engine/fsm`](fsm.md) | Hierarchical state machines (events, timers, history, saving) and an animation graph with blend trees and cross-fades | 3 | 100% |
| [`@engine/i18n`](i18n.md) | Localisation: plural forms for every language, contexts, gettext .po and CSV import, fallback chains (pt-BR to pt), pseudo-localisation, a list of what is untranslated | 10 | 100% |
| [`@engine/input`](input.md) | Actions and bindings over keyboard, mouse, gamepad and on-screen touch controls; contexts, rebinding, saving, prompts | 25 | 100% |
| [`@engine/matchmaking`](matchmaking.md) | Getting players into games: fair queues with parties and widening skill windows, balanced teams, Elo ratings, a room directory with join codes and seat reservations, signed join tokens and an HTTP match service | 7 | 100% |
| [`@engine/math`](math.md) | Deterministic sin/cos/tan/atan2/asin/acos plus 3D vectors and quaternions, bit-identical in Node, Chrome and Firefox (the built-in Math.sin is not) | 60 | 100% |
| [`@engine/mods`](mods.md) | Safe third-party mods: manifests, content-hashed bundles, sandboxed script mods in confined processes, signing, policy, validated commands (guide: docs/MODDING.md, threat model: docs/SECURITY.md) | 25 | 100% |
| [`@engine/particles`](particles.md) | Particle effects for the 3D renderer: data-driven bursts and emitters, streaks, decals, additive glow; presets for muzzle flashes, impacts, bullet holes, dust, explosions | 4 | 100% |
| [`@engine/persist`](persist.md) | What outlives a match: a versioned key-value store (memory, files), player profiles with a write-behind cache and migrations, leaderboards, guest accounts and an append-only log | 10 | 100% |
| [`@engine/physics`](physics.md) | 2D spatial hash and swept box collision; 3D triangle worlds, swept-ellipsoid movement and a character controller (no tunnelling at any speed); rigid bodies with joints, sleeping and triggers | 57 | 100% |
| [`@engine/prefab`](prefab.md) | Entity templates as JSON: inheritance, children, parameters, overrides, parent-child transforms, capturing what changed for saves | 13 | 100% |
| [`@engine/protocol`](protocol.md) | Binary codecs, quantization, delta snapshots with acks, handshake, inputs | 48 | 100% |
| [`@engine/render`](render.md) | 2D sprites, text (including scalable SDF text) and a 3D mesh renderer with glTF loading: WebGPU -> WebGL2 (-> Canvas2D for 2D) | 210 | 100% |
| [`@engine/replay`](replay.md) | Replays and spectating: record a match as compact snapshot deltas (seek anywhere, any speed) or as its inputs (a few KB, with drift detection), a delayed feed shared by any number of spectators | 10 | 100% |
| [`@engine/save`](save.md) | Save and load: slots, quick and auto saves, checksums and backups, all-or-nothing loads, versioned data with migrations, sections for the scene, physics and state machines, storage in memory, localStorage, IndexedDB, files or over HTTP | 21 | 100% |
| [`@engine/scene`](scene.md) | Levels as data (scene files, validation, migrations, loading and unloading) and the undoable SceneDocument the editor uses | 11 | 100% |
| [`@engine/server`](server.md) | Interest management, bandwidth budgets, lag-compensation queries, isolated rooms (worker threads) | 6 | 100% |
| [`@engine/skeleton2d`](skeleton2d.md) | 2D skeletal animation: bones, skins, weighted meshes with deformation, IK, keyframes with curves and events, crossfading tracks, drawn through the renderer's mesh batch | 29 | 100% |
| [`@engine/transport`](transport.md) | Reliable/unreliable channel contract, in-memory network + loss/latency simulator, own RFC 6455 WebSocket server and client | 46 | 100% |
| [`@engine/turns`](turns.md) | Turn-based and card games: rules as plain functions with hidden information and seeded randomness, a server room (tokens, robots, turn timers, rematch) and a client with reconnect | 12 | 100% |
| [`@engine/tween`](tween.md) | Tweens and timelines: 30+ easings, delays, repeats, yoyo, relative values, labels, overlapping steps, seeking; deterministic | 10 | 100% |
| [`@engine/ui`](ui.md) | Menus and HUDs on the 2D renderer: flexbox-style layout, buttons, sliders, switches, text fields, lists, themes, keyboard / gamepad / mouse / touch navigation, and ready-made pause, settings (key rebinding) and room-browser screens | 47 | 100% |
