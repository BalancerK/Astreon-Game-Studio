# Astreon Studio

A game studio that runs entirely in the browser: write code beside the game it makes, with the game changing as you type. Projects are kept in the browser (nothing is uploaded), and can be exported as a zip at any time. The design, research and plan are in [`docs/STUDIO.md`](../docs/STUDIO.md).

```
npm run studio       # then open http://localhost:8090/   (use "localhost": the game runs on 127.0.0.1)
```

This is **S1**, the studio's shell. It has projects, files, a code editor, the live game, a console, history, a search box for everything, menus, settings, and panels you can rearrange. Nothing in it needs a server beyond the static files.

## What you can do

| | |
|---|---|
| **Start** | Pick a template on the start page (Blank, Bouncing block, Run and jump, Space shooter, Push the boxes, Gem hall (3D), Gem hall from a scene (3D), or Made with rules), name it, and you are writing code with the game running. |
| **Write** | The editor saves as you type, and the game updates within a blink **without losing its place** (its clock and score carry on). A typo shows the file and line in the Console, and the game keeps running the last version that worked. Click the error to jump to it. |
| **Ship** | The Ship workspace measures your game (download size, first picture, frame cost, memory), holds it to limits you set, and exports it as a folder of plain web files that works offline and can be installed. Only the engine files your game imports are included. |
| **Plugins, rules and a folder** | Plugins add panels, commands, exporters and importers, and run in a closed box that can only do what you allowed. The Rules panel builds "when this happens, do that" from pieces and writes the code into `src/rules.js`. File > *Link this project to a folder…* keeps the project's files in a folder on your computer so git and other tools can see them (Chrome and Edge). |
| **3D scene** | The 3D workspace is the engine's scene editor: place blocks (cube, floor, wall, ball…) with handles, change their size and colour in the inspector, undo. The scene is saved as `scenes/<name>.json` in your project. There is no Play for 3D yet. |
| **Your own pictures and sounds** | Import PNG, JPG, GIF, WebP, WAV, MP3 or OGG files (the Import button in Files, drag and drop, or File > Import…). They are kept in `assets/`; use a picture with `image: 'assets/hero.png'` on a thing (or `drawImage`), and a sound with `sounds({ boom: { file: 'assets/boom.wav' } })`. Exports include them. The folder link does not copy them yet. |
| **Small screens** | On a phone or a narrow window the studio shows one panel at a time with a bar of tabs at the bottom; the layout you arranged returns when the window is wide again. |
| **Pick and debug** | Press **Pick** above the game (or hold Alt and click) and click a thing: it opens in the Inspector and is outlined in the game. **Debug** (F3) puts frames per second, frame cost, counts of each kind of thing, your status numbers and the picked thing's values on the game; *Show or hide a box around every thing* draws every box. |
| **Project settings** | *File > Project settings…*: title, screen size (classic, wide, phone upright, square or your own), background colour and icon. Saved in `project.json`; exports use them. |
| **Works offline, installs as an app** | Opened from a web host (or with `?pwa=1`), the studio keeps itself and the engine and opens with no network. *Help > Offline use and installing…* shows what is kept. To publish the studio, run `npm run studio:offline` first. Your projects never leave your browser. |
| **Touch and controllers** | The game responds to on-screen buttons on a touch screen and to a game controller, in the studio and in exported games. They act as the arrow keys, Space (A), X (B) and Enter (Start), so games written for the keyboard just work. |
| **Network lab** | A tiny online game over a pretend network: slide the lag, jitter and loss, switch prediction, correction smoothing and interpolation on and off, and watch the graphs and the 7- and 25-byte packets. |
| **Paint and make sounds** | The Art workspace has a sprite painter, a level painter and a sound maker. Each saves a plain text file your game imports (`src/art/hero.js`, the `LEVEL` rows in your code, `src/sounds.js`), so a change shows in the running game as you paint, and you can still edit the files by hand. |
| **Time Machine** | Pause the game (<kbd>F8</kbd>), drag back through what just happened, step a tick at a time, and "replay with my code" to see what would have happened with a change. Edit any value in the running game from the Inspector. *Save recording* makes a file that reproduces the game exactly; *Open recording* checks it on your computer, and `node tools/replay-run.js` checks it in CI. |
| **Learn** | "Start the guided route" on the start page makes a game and walks you through 11 hands-on steps: change `SPEED`, `JUMP`, the level, the hero's look, save a restore point, load a bigger level, follow with a camera, add spikes, collect coins, show a win message. Each step is checked against your project and the running game, hints grow in help, the answer is last, and the guide can be turned off at any time. |
| **Code with help** | Brackets close themselves and Enter keeps your indentation. Suggestions come from the engine's own API docs as you type (choosing one adds its import), hovering a name shows what it does, and inside a call the parameters are shown. <kbd>Ctrl</kbd>+<kbd>F</kbd> / <kbd>Ctrl</kbd>+<kbd>H</kbd> find and replace; <kbd>Ctrl</kbd>+<kbd>/</kbd> comments; <kbd>Alt</kbd>+arrows move lines. Mistakes are underlined and explained in plain words, with "did you mean". |
| **Search everything** | <kbd>Ctrl</kbd>+<kbd>K</kbd> finds commands, files, projects and settings at once. Start with `>` for commands, `/` for files, `@` for projects, `:` to go to a line. Every action has a name there, and its shortcut is shown. |
| **Arrange** | Drag a panel's tab to another group, or to an edge to split it. Drag the lines between panels (or focus one and use the arrow keys). Each workspace (Make, Code) remembers its own arrangement. |
| **Never lose work** | Every change is saved at once. The History panel keeps restore points (automatic ones every few minutes, plus your own with <kbd>Ctrl</kbd>+<kbd>S</kbd>); going back first keeps what you had. Deleted files and projects can be brought back. If saving ever fails, you are told at once and the work stays in the tab. |
| **Leave and return** | Export a project as a zip; import one back. A project is plain files (`src/main.js`...), so it also works outside the studio. |
| **A game that hangs** | An endless loop is stopped for you; the studio stays responsive and carries on from where the game was. |

Keyboard: everything is reachable without a mouse (<kbd>F6</kbd> moves between panels, <kbd>Alt</kbd>+<kbd>1</kbd>/<kbd>2</kbd> switches workspace, <kbd>F1</kbd> lists and changes shortcuts, menus and dialogs work with arrows, Enter and Esc).

## How a game is written

A game is `src/main.js` exporting three functions (and an optional fourth):

```js
export function create() { return { x: 0 }; }          // a new game: plain data
export function update(game, keys, dt) { game.x += 1; } // one tick, 1/60 s; keys is the set of keys held down
export function render(game, g) { g.fillRect(game.x, 20, 10, 10); }   // draw on a 2D canvas context (480 x 320)
export function summary(game) { return { x: game.x }; }               // optional: shown under the game
```

Other files are imported as usual (`import { clamp } from './util.js'`), and the engine's packages as `@engine/math`, `@engine/core`... The game state must be plain data, so it can be saved and rewound.

## How it is built

| Folder | What it is |
|---|---|
| `export/` | What an exported game contains and how it is built (`export.js`, `bundle.js`, `pwa.js`, the shipped `runtime.js`) and what a budget means (`health.js`). Pure, tested in Node. |
| `netlab/` | The Network lab's engine: a tiny server and client over the engine's simulated network. |
| `runner/timeline.js` | The Time Machine's core (also used by the studio's checks): recording, going back, replaying, exporting and verifying. Pure logic, tested in Node. |
| `app/learn` | The pathway: missions and their checks (`stage1.js`, `stage2.js`), the session that tracks progress, how a check reads code. Pure logic, tested in Node, including a walk through every mission. |
| `app/editing` | The editor's brains as pure functions, tested in Node: colouring, typing helpers, suggestions, find and replace, error explanations. |
| `app/data` | `api-index.js`, **generated** by `node tools/studio-api-index.js write` from the API docs (`npm test` fails if it is out of date). |
| `app/util`, `app/core` | Pure logic with no page in it, tested in Node: fuzzy search, shortcuts, the command list, settings, workspaces, the message format. `core/studio.js` is the studio's state. |
| `app/store` | Projects: IndexedDB and in-memory backends, files, restore points (identical contents stored once), the bin, zip export and import (with checks against unsafe or oversized zips). |
| `app/ui` | The dock (layout model and drawing), search box, menus, dialogs, the start page, the code editor. No dependencies at all. |
| `app/panels` | Files, Code, Game, Console, History. |
| `runner/` | The game's own page. It runs on **another origin** (so a shared project can never touch your projects), keeps files in a service worker, checks syntax with exact locations, and runs the game in a Worker that is killed and restarted if it hangs. |
| `spike/` | The S0 feasibility prototype this was built from (kept with its tests). |

Two things worth knowing:

- **The game runs on a different origin.** In development, open the studio on `localhost` and the game runs on `127.0.0.1`. A deployed studio must serve `studio/runner/` from another host name and set `window.STUDIO_CONFIG = { runnerOrigin: 'https://…' }`.
- **The game frame lives outside the panel layout** and is laid over the Game panel's empty slot. A frame that is moved in the page reloads, so keeping it still means dragging a panel or switching a tab never restarts your game.

## Tests

- `npm test` runs 124 studio unit tests (`studio/test`): search ranking, shortcuts, commands, settings, the dock layout model (including 400 random moves that must never lose a panel or break the rules), the store (saving, failure, restore points, the bin, zips, a zip bomb), message checking and the highlighter.
- Editing: up to three editors side by side (drag a tab to an edge, or Ctrl+\), draggable tabs with a right-click menu, an explorer (Ctrl+B) and a path above the code, eight code colour schemes, accent colours and fonts, a panel that fills the window (Ctrl+Shift+Enter).
- Art tools: slice a sprite sheet, import an SVG (made into a PNG), place things in a Scene by dragging, and make looping music in a piano roll (Art workspace); the kit has `loadScene`, `playMusic` and `drawImage` with `cols`/`rows`.
- From a terminal: `node tools/studio-cli.js new|check|build|serve <folder>` makes, tests, builds and serves a project folder (the same folder the studio's link keeps in step).
- Search all files (Ctrl+Shift+F), go to definition (F12), find uses (Shift+F12), rename everywhere (Ctrl+F2) and go to a name (Ctrl+Shift+O) work across a project's files.
- `node tools/studio-a11y-test.js` audits accessibility in real Chrome (contrast in every theme, names, landmarks, target sizes, the Tab route, the editor's way out).
- `node tools/studio-test.js` drives the real studio in Chrome with real mouse and keyboard events (246 checks, from making a project to dragging panels, a hanging game, reloading the page, and an accessibility pass).
- `node tools/studio-spike-test.js` and `node tools/studio-spike-compat.js` keep the S0 results honest (the second runs in Chrome and Firefox).

Not yet: the Art, Sound and Debug workspaces; lessons; sharing. See the plan in `docs/STUDIO.md`.
