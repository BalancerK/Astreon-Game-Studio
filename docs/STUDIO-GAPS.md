# Studio gaps: how the studio compares with other game editors

Written 2026-10-14 from a round of research and from what the studio does today (see `docs/STUDIO.md` for the studio itself). The point is to find what a person would miss coming from another editor, and what the studio has that others do not, so the next work is chosen from evidence and not from habit. **We decided to close as many of these as we sensibly can before putting the project under git**, so this page is also the list to work through; the status column is kept up to date.

## How this was found

The studio was compared with Godot, GDevelop, PlayCanvas, Defold, Unity 6 and Roblox Studio, using their own documentation pages. Sources:

- Godot: <https://docs.godotengine.org/en/stable/about/list_of_features.html>
- GDevelop: <https://gdevelop.io/features>
- PlayCanvas Editor: <https://playcanvas.com/products/editor>
- Defold: <https://defold.com/manuals/hot-reload>
- Unity 6: <https://docs.unity.com/en-us/engine/6000.0/manual/whats-new/unity6.md>
- Roblox Studio: <https://create.roblox.com/docs/en-us/studio/testing-modes>
- Editor accessibility: <https://discussions.unity.com/t/accessibility-in-the-unity-editor/947198> and Godot 4.5's screen reader support (AccessKit).

**What could not be confirmed** (the searches returned little): Unity's Timeline, Cinemachine, Addressables and Profiler; Construct 3 and Phaser Editor details; Roblox's analytics, localization and plugin marketplace; PlayCanvas's version control beyond "checkpoints". Treat claims about those as unchecked. Feature lists on vendor pages are marketing: "one-click" and similar words were not tried.

## Where the studio is ahead of, or level with, the others

| | |
|---|---|
| **Time Machine** | Rewind, record and replay a game, and keep a bug as a file that runs again in another project or from the command line. Nothing in the list above has it as far as the research could tell. |
| **Offline and private** | Works with no account and no server after one visit. |
| **Hot reload that keeps state** | Level with Defold and PlayCanvas. |
| **Per-function profiler** | Level with Godot's CPU profiler (no GPU timing: that is a gap). |
| **Guided pathways** | Comparable with GDevelop's in-app tutorials; two pathways so far, **not yet tried with real people**. |
| **Accessibility** | Keyboard, focus and screen-reader work is audited by a test; Godot added screen reader support only in 4.5 and Unity's editor is reported as largely unusable with a screen reader. **Never tried with a real screen reader.** |
| **3D editing feel** | Blender-style keys, shape edit, four kinds of snapping, a 3D cursor, batch rename. Blocks only. |

## The gaps, and where each stands

Order is the order we expect to take them in (value for effort). Status: **open**, **started**, **done**, **decided against**.

| # | Gap | Who has it | What the studio has now | Plan | Status |
|---|---|---|---|---|---|
| 1 | **Real people have not tried it** | (not a feature: the largest unknown) | Pathways and editors built and machine-tested only | Ask a few beginners to try the first pathway and watch; fix what they trip on | open |
| 2 | **Version history and safe storage** | PlayCanvas checkpoints (save, compare, restore); Roblox version history | History panel with restore points; the project is only in OneDrive, not in git | Put the project under git (after the gaps below); a project-level checkpoint with a compare view | open |
| 3 | **A free asset library** | Godot Asset Library, GDevelop store, PlayCanvas store | Imports of your own pictures and sounds; nothing bundled | A small bundled pack of free (CC0) sprites, sounds and tiles that works offline, with a picker; licence file shipped | **done**: 40 pictures, 26 sounds, 9 songs (all original, CC0), window opened from File, the three painters or the command palette |
| 4 | **Localization** | Godot: string tables (CSV, gettext), POT/PO, pseudolocalization test | None | String tables in the project, a language switch in the kit, and a pseudolocalization test run | **done**: kit `text()`, `t()` (with `{places}` and plural forms), `setLanguage`, `setPseudo`; a Text panel with a table, missing-word checks, preview, test text and CSV in and out |
| 5 | **Animation and state editor** | Godot animation editor and AnimationTree; PlayCanvas State Graph | Frame-by-frame sprite animation; the engine has state machines and no editor | A state-graph editor for the kit (states, transitions, a live view) and a keyframe track for numbers | **done**: kit `stepState` and `stepClip`; a States panel (graph, drag, arrows, try it live) and a Clips panel (keyframe tracks you drag, easing, play) |
| 6 | **Particle editor** | Defold, Godot | Kit sparks and bursts by code; the engine has a particles package | A particle panel with live preview and a file the kit can play | **done**: kit `emit` and `stream` (recipes, the same repeatable sparks as `burst`); a Particles panel with sliders, colors, ten presets and a live preview you click for bursts |
| 7 | **Behaviours and extensions** | GDevelop: over 100 behaviours and 160+ extensions | Rules panel (touch, none left, say, sound) | A set of ready-made behaviours (patrol, follow, health, shoot) in the kit and the Rules panel; a gallery of sample plugins | **done** (except the Rules panel link): ten kit behaviours with a Behaviours panel and live arena; six sample plugins installed with one click from the Plugins panel |
| 8 | **UI editor** | Godot Control nodes, Defold GUI | The engine has a UI package; the kit has `label` only | A panel to lay out menus and HUDs that the kit can draw | **done**: kit `drawUi`, `uiHit`, `uiNext`; a UI panel with a drag-and-drop canvas drawn by the same code, anchors, test values and starter screens |
| 9 | **Publish and share** | GDevelop and PlayCanvas one-click publish; Roblox publish | Export as a zip, an installable PWA | Needs the hosting and privacy decision (S8) before any code | open (blocked on a decision) |
| 10 | **Collaboration** | PlayCanvas real-time editing; Roblox Team Create | None (a folder link lets git do it) | After sharing exists; git first | open |
| 11 | **Device and multi-player testing** | GDevelop QR preview on a phone; Godot several instances; Roblox up to 8 clients | Network lab (teaches, simulates); phone not tried | A way to open the game on a phone from the studio; several instances against a local server where the browser allows | open |
| 12 | **3D models, materials and lights** | PlayCanvas (glTF/FBX, texture compression), Unity, Godot | Blocks, balls, capsules and ramps; the engine can load glTF and light a scene | Import a glTF into the 3D panel, simple materials and a light | open |
| 13 | **Small workflow items** | Unity Build Profiles and a test framework; Defold loaded-resources list; Unity's piercing select | Export settings (one set); tests only outside the studio | Named build profiles; run a file of checks in the studio; list what the game has loaded | **done**: build profiles in the Ship panel (`build.json`, `build()` in the kit), a Tests panel running `*.test.js` files in their own worker (`test`, `expect`, `simulate`), a Resources panel (what the game reaches and what is unused). Not done: Unity's piercing select |
| 14 | **GPU timing in the profiler** | Godot (CPU and GPU time, Tracy/Perfetto) | CPU time per function, draw calls, memory | WebGPU timestamp queries where the browser gives them | open |

## Round 2 (2026-10-15): after gaps 3 to 8 and 13 were closed

A second round of research, this time against tools that do one job very well (level editors, a pixel editor, a dialogue tool, a classroom tool) and against accessibility guidance
for games, because the first round compared the studio mostly with whole engines. Sources:

- Construct 3 (second-hand overviews only; the official manual was not reached): <https://www.construct.net/fr/forum/users/ashley-15836/posts/page-2021>
- MakeCode Arcade: <https://makecode.com/blog/arcade/general-release>, <https://learn.adafruit.com/makecode-arcade-with-samd51-m4/what-is-makecode-arcade>
- GameMaker: <https://manual.gamemaker.io/lts/en/The_Asset_Editors/The_Asset_Editors.htm>, <https://gamemaker.io/de/blog/gamemaker-studio-2-dot-3-new-ide-features>
- LDtk: <https://deepnight.itch.io/ldtk/devlog/471310/ldtk-120-is-out-happy-new-year>, <https://deepnight.itch.io/ldtk/devlog/243249/090-biomes-tags>
- Tiled: <https://mapeditor.org/2018/01/03/tiled-1-1-0-released.html>, <https://thorbjorn.itch.io/tiled/devlog/397225/tiled-19-released>, <https://tiled.readthedocs.io/manual/objects/>
- Aseprite: <https://aseprite.org>, <https://aseprite.org/docs/animation/>
- Yarn Spinner: <https://yarnspinner.dev/features/>
- Scratch: <https://en.wikipedia.org/wiki/Scratch_(programming_language)>
- Phaser Editor: <https://docs.phaser.io/phaser-editor/v4/intro/changelog>
- Game accessibility: <https://gameaccessibilityguidelines.com>, <https://accessible.games/wp-content/uploads/2018/11/AbleGamers_Includification.pdf>
- Godot 4 tilemap terrains and animation: <https://uhiyama-lab.com/en/notes/godot/terrains-autotile-setup/>, <https://dev.to/godot/godot-42-stable-is-here-4joi>

**What could not be confirmed:** Construct 3 beyond the existence of event sheets, behaviours, effects and a debugger; Godot's 2D lights, Camera2D smoothing and physics layers; Aseprite's slices; Cinemachine
(still unconfirmed from round 1); any engine's built-in input remapping. Those rows below say so.

### What the studio already does that these tools do too

The sprite painter has frames, named animations and onion skin (Aseprite); the Clips panel is the keyframe-curve idea of GameMaker's animation curves and Godot's AnimationPlayer for one thing's numbers;
the Text panel's keys are close to Yarn Spinner's per-line IDs for translation; particles, states, behaviours, UI and tests now exist in the same shape as the engines'.

### New gaps

Order is the order I would take them in (what a learner or a small team would feel soonest, for the effort). Same status words as above.

| # | Gap | Who has it | What the studio has now | Plan | Status |
|---|---|---|---|---|---|
| 14 | **Dialogue and story** | Yarn Spinner: a graph of passages, plain-text format, choices, commands, a unique ID for each line so it can be translated | Nothing: a game shows text with `label` or `t()` | A dialogue panel (a graph of passages with choices and conditions, saved as plain text), a kit runner (`say`, choices, set a flag), line IDs that go straight into the Text panel's table, and a "dead end or unreachable passage" check | **done**: a plain-text story language and runner in the kit (`story`, `startStory`, `stepStory`, `drawStory`), and a Story panel with a node map, per-node writing, problem checks, a live preview and a button that sends the lines to the Text panel |
| 15 | **Controls, settings and the accessibility basics** | The game accessibility guidelines put remapping, text size, colour-blindness and subtitles as the four most complained-about things; separate volumes for effects, music and speech are on their basic list | Keys are fixed in the kit; the engine's `input` package has rebinding but the kit and studio do not use it; the studio's own accessibility is audited, a game's is not | Kit actions (`pressed('jump')`) that a player can remap and that are saved; a Settings screen made in the UI panel (controls, volumes, text size); A studio check that lists what a game does not offer (no remapping, colour alone, tiny text) | **done**: kit `controls`, `settings`, `setBinding`, captions and a ready-made settings menu; a Controls panel with key capture, offered settings, a live menu preview and an accessibility report that reads the code (colour, flashing, timing and one-handed play are listed to check by eye) |
| 16 | **Auto-tiling for levels** | LDtk auto-layers with rules and an assistant; Tiled automapping and Wang tiles; Godot 4 terrains | The Level painter paints one tile at a time; a grass edge or a wall corner is drawn by hand | Terrain brushes: say which tiles belong to a terrain, and the painter picks the edge, corner and inside tile by itself; rules saved with the level | **done**: `autotile: 'edges4' | 'blob47'` in a legend entry (the kit picks the edge and corner of every tile from its neighbours, with no picture needed); the Level painter shows it, switches it on and off, sets edge colour, width, map-edge behaviour and which terrains join, and makes a 16- or 47-frame picture from a tile |
| 17 | **Things with their own fields, references and templates** | LDtk entities with typed fields and references (a button that points at a door); Tiled custom properties, enums and object templates | The Scene panel places things with fixed fields | Typed fields per kind (number, text, choice, a pointer to another thing), shown in the inspector and saved in the scene; reusable templates; the kit hands them to the game | **done**: a Kinds panel (a template and typed fields for each kind: number with smallest and largest, text, yes or no, one choice, a pointer to another thing by name), names and typed fields in the Scene panel's inspector (a pointer is a dropdown of the named things of the right kind, with a dashed line drawn to what it points at), placing a thing uses its kind's template, renaming a thing keeps every pointer to it, problems are listed, and the kit's `loadScene(game, scene, kinds)` fills in the defaults and `refOf` finds what a pointer points at. Templates are per kind, not separate reusable objects |
| 18 | **A world of linked levels** | LDtk world view (grid, linear or free); GameMaker rooms | One level or scene at a time; moving between them is code | A world panel: levels as boxes joined by doors or screen edges, `goTo('cave')` in the kit, the Time Machine and saving that follow | **done**: a World panel (rooms as draggable boxes made from the project's scenes and levels, arrows for links through a screen edge or a named door, arriving on the opposite edge, next to a named thing or at a place, a start room, problems listed) and the kit's `makeWorld` (`start`, `goTo`, `step`, `room`, `visited`). The hero is carried across, and what the world remembers is plain data in the game, so the Time Machine and saves follow. Rooms are scenes or levels the game loads itself; it is not a single big scrolling map |
| 19 | **Sequences and cutscenes** | GameMaker Sequences (sprites, sounds, other sequences on a timeline); Godot AnimationPlayer for cutscenes | Clips move one thing's numbers; nothing joins several things, sounds and dialogue on one timeline | A sequence editor: tracks for several things plus event keys (play a sound, say a line, shake the screen), reusing Clips and the new dialogue | **done**: a Sequences panel (a timeline with a row for each number of each thing, the camera and the screen's fade and black bars, and a row of events: play a sound, start a song, shake, say a part of the story and wait for it, a burst of sparks, show or hide a thing, tell the game) and the kit's `playSequence`, `stepSequence`, `drawSequence`, `takeSequenceCommands`. Sound and music in the preview are listed, not played |
| 20 | **A deeper sprite editor** | Aseprite: layers and cels, loop modes (forward, backward, ping-pong) per animation tag, a tiled preview, palette tools, slices (slices unconfirmed) | Frames, named animations, onion skin | Ping-pong and reverse loops, a tiled preview for textures, a palette panel with colour limits and swapping; layers last | **done except layers**: each animation plays round and round, backwards, forwards and back (ping-pong) or once (the kit's `animationFrame`, `animationDone` and `thing.animDone`), a tiled preview for textures, and palette tools (swap two colours, merge one into another, merge colours that are the same, remove colours nothing uses, a colour limit with "reduce to N colours"). Layers and cels are not built: they change the sprite file format and every tool that reads it, so they are left for a later decision |
| 21 | **A backpack and map importers** | Scratch's backpack carries sprites, sounds and code between projects; LDtk and Tiled are where many levels already live | Assets cannot be carried between projects except by zip; no import of Tiled or LDtk files | A local backpack (kept in the browser, never uploaded) for sprites, sounds, effects, screens and states; import of Tiled and LDtk levels into the Level and Scene panels | **done**: a Backpack panel (twelve kinds of thing, kept in the browser, saved to and loaded from a file) and File > Import a level from Tiled or LDtk (tile layers become levels for the Level painter, objects and entities become scenes) |
| 22 | **Blocks that turn into code** | MakeCode Arcade and Scratch: drag-and-drop blocks that are the same program as the JavaScript, switchable at any time | The Rules panel builds small rules and shows the code; nothing covers a whole game | Research the size first: a block view for a limited, readable part of the kit that round-trips with the text. Large; may be decided against | open |
| 23 | **Camera, layers and parallax** | GameMaker layers (instances, tiles, backgrounds, effect layers) ordered in a layer editor; Godot camera smoothing (unconfirmed) | `follow` and shake; no layers panel, no parallax backgrounds | Scene layers with parallax backgrounds, camera smoothing, limits and look-ahead as a behaviour | **done**: a Layers panel (eight kinds of layer, parallax, drifting, in front or behind, a live preview you can slide or walk through) and the kit's `followSmooth` (delay, look-ahead, dead zone), `drawLayers`, `stepLayers`; no zoom yet |
| 24 | **Path-finding and steering behaviours** | Construct 3's pathfinding behaviour (second-hand); Godot navigation | The engine's `ai` package has grids, A* and steering; the kit's behaviours do not use them | Two behaviours: "go to" (finds its way around walls on the level grid) and "keep away from" | **done**: "Go to something, round walls" (A* on the level grid, 8 directions, never cuts a wall's corner, re-plans as the goal moves, goes as near as it can when there is no way) and "Keep away from something" (runs round walls, stops when cornered); starters `hunter` and `mouse`; the arena has walls; kit `navGrid` and `route`. The `ai` package is not used, so the kit stays free of dependencies. Things bigger than one tile can clip corners |
| 25 | **2D lights and screen effects** | Construct effects (second-hand, lighting and blur listed); GameMaker filter and effect layers | None | Low priority. A small set of screen effects (tint, vignette, blur, darkness with lights) as UI-style layers | **done**: a Lights panel (darkness with soft pools of light cut out of it, lights that sit at a place or on every thing of a kind, colour, size, brightness, flicker, a tint over the whole screen, dark corners) and the kit's `drawLights`. Blur is not included: a canvas cannot do it fast enough on every machine to promise it |

Not worth taking now from this round: hardware export (MakeCode's boards), cloud variables and an online project gallery (accounts and a server), and Aseprite-style full layer compositing before the cheaper sprite items.

### Suggested next four

1. **15 Controls, settings and accessibility basics.** Every game needs it, the guidance is the clearest of anything found, and it uses the UI editor and Text panel just built.
2. **14 Dialogue and story.** The biggest thing a learner making a first story game is missing, and it ties into localization.
3. **16 Auto-tiling.** The thing a level painter user misses first when they come from LDtk, Tiled or Godot.
4. **21 Backpack and map importers.** Small, private, and it makes everything made so far reusable between projects.

## Not copying for now

A visual shader editor, a physics joint editor, cloud accounts and sign-in, and an editor translated into many languages. Each is large and does not fit a studio that is offline, private and meant to teach. They can come back if the research changes.

## Before git

The project is not yet under version control. Gaps 3 to 8 and 13 can be built without any hosting decision, so those came first (and are done; round 2 above adds more); 1 (real people) can happen at any time and is worth doing before the later items so that it can change them. Gaps 9 to 11 wait for the sharing decision.
