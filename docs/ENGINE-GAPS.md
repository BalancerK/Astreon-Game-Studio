# Astreon Engine: gaps against other engines

Written 2026-10-15. This is about the **engine** (`packages/`), not the studio (the studio's own list is `docs/STUDIO-GAPS.md`). It compares what the engine can do with what the official feature lists of five other engines say they can do, and says which differences matter for this engine's goals.

## How this was made, and what it can and cannot tell you

- **Others:** the official feature pages of Godot 4 (`docs.godotengine.org/.../list_of_features`), Babylon.js (`babylonjs.com/specifications`), PlayCanvas (`playcanvas.com/products/engine`) and Phaser (`phaser.io/why-phaser` and its Phaser 4 release notes), plus Unity's package documentation for Timeline and Cinemachine. Unity's own feature list, Excalibur's and Unreal's were not read directly (searches returned only commentary), so they are not used for any claim.
- **Us:** read from the code. Every "we have" below was checked in `packages/*/src` or the package README; a generic word search was not trusted (it gave false hits) and was redone by reading the exports.
- **A feature list is marketing.** It says an engine *has* something, not that it is good, tested or easy. "Others have it" is a reason to look, not a reason to build.
- **Not compared:** performance, documentation, community, price, and the editors (those are the studio's list). Phaser 4 and PlayCanvas change quickly; the dates above are when the pages were read.

## What the engine is for, so the gaps can be sorted

Astreon Engine is **web-first, zero-dependency, deterministic and multiplayer-first**: a game made with it should run in a browser, behave the same on every machine, and be playable online without extra services. A gap is worth closing when it fits that, and is not just a long feature list.

## Where the engine is already ahead or level (so it is not rebuilt)

| Area | What we have that the others do not list, or only partly |
|---|---|
| **Multiplayer** | Authoritative server, binary delta protocol with acks, interest management, bandwidth budgets, lag-compensated queries, isolated rooms in workers, reconnect with session tokens, matchmaking (parties, Elo, balanced teams), turn and card game rooms. Godot has RPCs over ENet; Phaser, Babylon and PlayCanvas list no netcode at all. |
| **Determinism** | `@engine/math` gives bit-identical trig and vectors in Node, Chrome and Firefox; fixed timestep everywhere. None of the others promise this. |
| **Safe mods** | Sandboxed script mods in confined processes with signed, content-hashed bundles. Not listed by any of the five. |
| **Three-backend renderer** | WebGPU, then WebGL2, then Canvas2D, chosen automatically, same output. PlayCanvas has WebGPU with WebGL2 fallback; none go down to Canvas2D. |
| **Level of the basics** | ECS and plugin system, prefabs with inheritance, scene files with migrations and undo, saves with checksums and versioned migration, asset manager with hashed manifest and hot reload, behaviour trees, A* and steering, 3D character controller, rigid bodies with joints, sensors and bullets, GPU particles, HDR bloom, tone mapping and grading, cascaded directional shadows, skinned animation with blend trees, spatial audio, input actions with gamepad rumble and on-screen touch controls. |

## The gaps

Priority: **A** = fits what the engine is for and others clearly have it; **B** = worth doing when a game needs it; **C** = probably not, or a decision for later. Effort: S (days), M (a week or two), L (more).

### Rendering (3D)

| # | Gap | Others | We have (checked) | Priority / effort |
|---|---|---|---|---|
| E1 | **DONE 2026-10-15 (see `@engine/render` README, "Physically based materials"; the studio has no material editor yet):** **The full glTF material set**: normal, metallic-roughness, emissive and occlusion maps, and a lit PBR shading model that uses them | Godot (PBR, parallax, subsurface), Babylon (PBR, OpenPBR, clear coat, sheen), PlayCanvas (PBR with image-based lighting) | The glTF loader reads the base colour and warns that other texture kinds are ignored (`gltf.js`); lighting is directional, hemisphere ambient, fog and up to 32 point lights | **A** / L |
| E2 | **DONE 2026-10-23 (see `@engine/render` README, "Environment lighting"):** **Environment lighting and a sky**: image-based lighting from an HDR or generated environment, a skybox, reflection of it on shiny things | Godot (sky, probes), Babylon (IBL, skybox, atmosphere), PlayCanvas (IBL, cubemap prefiltering) | Hemisphere ambient only; the arcade kit has a drawn sky for its small 3D view, the renderer has none | **A** / M (needs E1 to pay off) |
| E3 | **DONE 2026-10-24 (see `@engine/render` README, "Spot lights, area lights and shadows from lamps"; exact LTC area lighting, cookies and soft penumbra not done):** **Spot and area lights**, and shadows from point and spot lights | Godot (omni, spot, area), Babylon (spot, area, IES), PlayCanvas (area, cookies, clustered) | One directional light with up to 4 cascades; point lights unshadowed | **B** / M |
| E4 | **DONE 2026-10-24 (see `@engine/render` README, "Ambient occlusion, depth of field and FXAA"; temporal AA and SSR not done):** **Anti-aliasing and screen-space effects beyond bloom**: ambient occlusion, depth of field, temporal or fast approximate AA | Godot (SSAO, DoF, TAA, FSR), Babylon (DoF, SSR, grain), PlayCanvas (TAA, SSAO, DoF) | MSAA, bloom, exposure, tone mapping, colour grading, vignette, dither | **B** / M each |
| E5 | **DONE 2026-10-24 (see `@engine/render` README, "Drawing less"):** **Draw less**: level of detail, occlusion culling, automatic merging | Babylon (LOD, occlusion queries, octrees), Godot (occlusion culling), PlayCanvas (static optimisation) | Frustum culling and GPU instancing | **B** / M |
| E6 | **PARTLY DONE 2026-10-23 (see `@engine/render` README, "Smaller downloads"): meshopt mesh compression, `KHR_mesh_quantization`, and KTX2 textures in BC1/BC3/BC7/ETC2/ASTC and RGBA8 are read; Basis Universal, Zstandard and Draco are not (they need WebAssembly, which the zero-dependency rule rules out).** **Smaller downloads**: GPU texture compression (KTX2, Basis) and mesh compression (Draco, Meshopt) | PlayCanvas (all of them), Godot (VRAM compression), Babylon (DDS, KTX, .basis) | None (PNG and uncompressed glTF buffers) | **A** / M (fits "runs in a browser, loads fast") |
| E7 | **DONE 2026-10-24 (see `@engine/render` README, "Terrain, water, decals and a procedural sky"; no volumetric clouds or refraction):** **Terrain, water, decals as meshes**, procedural sky | Godot (decals, volumetric fog, sky), Babylon (height maps, decals, fluid rendering) | Decal-style particles only | **B** / L |
| E8 | Global illumination, lightmaps, reflection probes, screen-space reflections, volumetric fog | Godot (SDFGI, voxel GI, SSR, volumetric fog), Babylon (RSM GI, SSR, volumetric lighting), PlayCanvas (runtime lightmaps) | None | **C**: heavy, and a stylised web game rarely needs it |
| E9 | Gaussian splats, 3D Tiles, compute shaders, a node-based shader or material editor | Babylon (splats, 3D Tiles, node editors), PlayCanvas (splats, compute) | None | **C** (the shader editor is a studio decision) |

### Rendering (2D)

| # | Gap | Others | We have | Priority / effort |
|---|---|---|---|---|
| E10 | **DONE 2026-10-24 (see `@engine/render` README, "Tile maps"):** **A batched tile-map renderer**: chunks, animated tiles, layers, Tiled-style data, one draw per chunk | Phaser (tilemaps from CSV and Tiled, plus a new GPU tilemap layer), Godot (TileMap layers) | Sprite batch with sorting and 50,000-sprite speed; the arcade kit draws tiles as ordinary things (fine for small levels, wasteful for big ones) | **A** / M |
| E11 | **DONE 2026-10-24 (see `@engine/render` README, "2D lighting"; shadows from sprite alpha only, no specular map):** **2D lighting at the renderer level**: normal maps, shadows from occluders, many lights on the GPU | Godot (normal and specular maps, soft shadows, SDF), Phaser 4 (Lighting component) | The arcade kit's darkness-and-holes lights (no normals, no shadows) | **B** / M |
| E12 | **DONE 2026-10-24 (see `@engine/render` README, "2D filters"; whole-canvas passes, no filter area yet):** **Per-object shader filters** (blur, glow, outline, pixelate, gradient map) on sprites, text and cameras | Phaser 4 (a whole filter system), Godot (2D shaders), Babylon (post processes) | None on 2D; post-processing is 3D only | **B** / M |
| E13 | **DONE 2026-10-24 (see `@engine/skeleton2d`; no clipping or path constraints, no rig editor in the studio yet):** **2D skeletal animation** (bones on sprites, Spine-like) | Phaser (Spine), Godot (2D skeleton, IK) | Frame animation only | **B** / L |
| E14 | **DONE 2026-10-24 (see `@engine/render` README, "Rich text, right-to-left text..."; no justify, vertical text or glyph eviction):** **Text**: rich text with colours and inline pictures, right-to-left and mixed direction text, font fallback, bitmap fonts | Godot (BBCode, bidi, RTL, fallback), Babylon (SDF text) | Scalable SDF text, wrapping, shadows | **B** / M |
| E15 | **DONE 2026-10-24 (see `@engine/render` README, "Video as a texture"):** **Video playback** as a texture | Babylon (video textures, webcam), Godot (Theora) | None | **B** / S |

### Physics

| # | Gap | Others | We have | Priority / effort |
|---|---|---|---|---|
| E16 | **DONE 2026-10-24 (see `@engine/physics` README, "2D rigid bodies"):** **2D rigid bodies**: circles, boxes, polygons, stacking, friction and bounce, joints, sensors | Godot (2D rigid bodies and joints), Phaser (Matter), Babylon and PlayCanvas (3D engines, 2D by flattening) | 2D swept boxes and a spatial hash (excellent for fast movers, but no resting stacks or rotation); the rigid-body solver and joints are 3D | **A** / L |
| E17 | **PARTLY DONE 2026-10-24 (see `@engine/physics` README, "Ragdolls and cone joints", "Vehicles"): ragdoll and raycast vehicle done; soft body and cloth (priority C) not.** **Ragdoll, vehicle (raycast wheels), soft body and cloth** | Godot (ragdolls, vehicle, soft bodies), Babylon (Havok ragdoll, character controller) | A 3D character controller only | **B** (ragdoll, vehicle) / M; soft body **C** |
| E18 | **DONE 2026-10-24 (see `@engine/physics` README, "Smooth drawing between steps"):** **Physics interpolation** between fixed steps for smooth rendering | Godot (2D and 3D physics interpolation) | The multiplayer client interpolates remote entities; rigid bodies themselves are not interpolated for rendering | **B** / S |

### Navigation and AI

| # | Gap | Others | We have | Priority / effort |
|---|---|---|---|---|
| E19 | **DONE 2026-10-24 (see `@engine/ai` README, "Navigation mesh and crowds"):** **Navigation meshes** with runtime baking, dynamic obstacles and **crowd avoidance** between agents | Godot (navmesh, obstacle avoidance, runtime baking), Babylon (navmesh and crowd) | A grid built from the level, A*, steering with separation, behaviour trees, perception | **A** / L (the grid is deterministic and good for platformers; open 3D worlds want a mesh) |

### Animation

| # | Gap | Others | We have | Priority / effort |
|---|---|---|---|---|
| E20 | **DONE 2026-10-24 (see `@engine/render` README, "Morph targets, animation events and root motion"):** **Morph targets and animation events**: blend shapes from glTF, events fired at a point of an animation, root motion | PlayCanvas (blend shapes), Babylon (morphing), Godot (method and sound tracks) | Skeletal animation with blend trees and crossfades; the glTF loader ignores morph weights | **A** / M |
| E21 | **DONE 2026-10-24 (see `@engine/render` README, "Inverse kinematics and retargeting"):** **Inverse kinematics** and **animation retargeting** | Godot (forward and inverse kinematics, retargeting), Babylon (retargeting) | None | **B** / M |
| E22 | **DONE 2026-10-24 (see the new `@engine/tween` package):** **A tween and timeline library** in the engine proper (not only the kit's clips and sequences) | Phaser (tweens, 30+ easings, chained timelines), Unity (Timeline) | Clips and sequences live in `@engine/arcade`; the 3D engine has no equivalent | **B** / S |

### Audio

| # | Gap | Others | We have | Priority / effort |
|---|---|---|---|---|
| E23 | **DONE 2026-10-24 (see `@engine/audio` README, "Effects", "Ducking", "Occlusion"):** **Bus effects**: reverb, low-pass and other filters, ducking (music quieter while someone speaks), a muffled sound behind a wall | Godot (re-routable buses with many built-in effects), Babylon (audio engine) | Buses, a limiter, voice limits, positional sound, cross-fades, synthesised sounds; no effects on buses | **A** / M |
| E24 | **DONE 2026-10-24 (see `@engine/audio` README, "Voice chat in a game"):** Streaming long music, audio sprites, microphone input, voice chat | Godot (microphone, procedural audio), Phaser (audio sprites) | Procedural sounds and music in the kit | **B** / M |

### Input and platform

| # | Gap | Others | We have | Priority / effort |
|---|---|---|---|---|
| E25 | **WebXR** (VR and AR sessions, controllers, hand tracking) | Babylon, PlayCanvas (full support), Godot (OpenXR) | None | **C**: a large separate feature; decide on demand |
| E26 | **Native packaging** (desktop and mobile apps, store builds) | Godot (Windows, macOS, Linux, Android, iOS, web), Babylon (native host) | Web build and installable web app; Android client planned last (M9) | **C** for now (already on the roadmap) |
| E27 | **DONE 2026-10-24 (see `@engine/ui` README, "Accessibility", and `@engine/input` README, "Pen and gestures"):** **Accessibility in the engine**: UI focus navigation, screen-reader text for UI, pen and gesture input | Godot (screen reader support, pen and tablet input) | The studio and the kit's UI have keyboard focus and settings; `@engine/ui` has no screen-reader layer | **B** / M |
| E28 | **WebAssembly modules and threads** for heavy work (physics, pathfinding) | PlayCanvas (ammo.js is compiled to WebAssembly) | None; the engine stays plain JavaScript on purpose | **C**: against the zero-dependency rule unless measured |
| E29 | **DONE 2026-10-24 (see the new `@engine/i18n` package):** **Engine-level localisation**: plural forms, translation contexts, gettext and CSV import, pseudo-localisation | Godot (all of these) | The arcade kit's text table has languages, pseudo-localisation and placeholders; no plural or context rules in the engine | **B** / S |

### Multiplayer (where we lead, but pieces are missing)

| # | Gap | Others | We have | Priority / effort |
|---|---|---|---|---|
| E30 | **DONE 2026-10-15:** `Predictor` and `RollbackSession` in `@engine/client` (see its README). **Client prediction and reconciliation as a reusable module** (also rollback for fighting-game style netcode) | Godot (high-level multiplayer API with RPCs; prediction is still left to the game) | A working prediction implementation lives in the `arena` example (`examples/arena/client/predict.js`) and is explained in the guide, but it is not a package other games can import | **A** / M |
| E31 | **DONE 2026-10-24 (see `@engine/transport` README, "Browser to browser (WebRTC)"; a self-hostable signalling server, no hosted service, no host migration):** **Browser-to-browser play** over WebRTC data channels, and a hosted-room option | Godot (WebRTC client and server, UPnP) | WebSocket transport and a Node server; no WebRTC | **B** / L (hosting is also the studio's open S8 decision) |
| E32 | **DONE 2026-10-24 (see `@engine/replay` README, and `@engine/save` `CloudSync`):** Replays and spectating of a match, cloud saves | none of the five list them as engine features | Recordings in the studio's Time Machine; saves are local | **B** / M |

## Suggested order

The **A** items, in an order where each helps the next:

1. **E30 prediction module.** Smallest step that makes the multiplayer lead usable by someone else's game.
2. **E1 then E2 (materials, then environment lighting).** 3D games look flat without them, and everything glTF-based depends on them.
3. **E6 compression.** Cheap to measure, big for browser load times.
4. **E10 tile-map renderer** and **E16 2D rigid bodies.** The two 2D things the studio's kit already points at.
5. **E23 audio effects**, **E20 morph targets and animation events**, **E19 navigation meshes.**

Each needs a decision from you before it starts (as with the studio gaps), and each should arrive with unit tests and, where it draws, a real-browser check.

## What this list does not say

- It does not say the engine should grow a feature just because Godot or Unity has it. Items marked **C** are mostly "no, unless a real game needs it".
- It does not rank the studio's needs. Several gaps (E1, E10, E16) would also need studio work (a material editor, a tile-layer panel) to be usable by beginners, which is a separate decision.
- It cannot see what real users run into first. Testing with real people (studio gap 1) will reorder this list.
