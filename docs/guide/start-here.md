# Start here

This engine makes **browser games**, from a two-minute prototype to an online game with accounts and matchmaking. It is plain JavaScript with no dependencies, and it is split into small packages so you use only what your game needs. This page gets you running and tells you which packages to reach for.

## Five minutes to a running game

> **Note** The packages are not on npm yet. Until they are, run the generator from a checkout of this repository. The commands below use `--engine-path` to link the checkout. Once published, `npx create-game my-game` does the same without it.

1. **Check Node.** You need Node 20 or newer (it is developed on 24) and a recent browser. WebGPU is used when the browser has it, and WebGL2 or Canvas2D otherwise, so nothing needs configuring.
2. **Make a project.** Run this from the root of the repository, and make the project *outside* it (the `..` below puts it next to the repository folder). Pick the template that is closest to what you want:
```
node packages/create-game/src/cli.js ../my-game --template 2d --engine-path .
node packages/create-game/src/cli.js ../my-world --template 3d --engine-path .
node packages/create-game/src/cli.js ../my-cards --template multiplayer --engine-path .
```
The generator installs the project's packages for you, and they link to your checkout of the engine: do not move either folder afterwards. (An absolute path works too, if you want the project somewhere else.)
3. **Run it.** Every project has the same commands:
```
cd ../my-game
npm run dev        # http://127.0.0.1:8080/ with live reload (Ctrl+C stops it; add -- --port 9000 to change the port)
npm test           # the game's own tests: rules are tested without a browser
npm run build      # one hashed, minified script and your assets: the folder to upload
```
Open the address it prints. The `2d` template shows a blue dot you move with WASD or the arrow keys, yellow coins to collect and red hazards to avoid. The `3d` and `multiplayer` templates have their own README with what to expect.
4. **Change something.** In the `2d` template open `src/game.js` and change `PLAYER_SPEED`, then save: the page reloads. Now run `npm test`: a test that pins the old speed fails and tells you the number it expected. That is the point of keeping the rules separate from the page: change the rules, and the tests say what moved. Update the expected number in the test, or change the rule back.

## What do you want to make?

| I want to make… | Reach for | Learn from |
|---|---|---|
| A **2D game**: platformer, top-down, puzzle | [`core`](../../packages/core), [`render`](../../packages/render), [`input`](../../packages/input), [`physics`](../../packages/physics), [`audio`](../../packages/audio), [`save`](../../packages/save) | [2D platformer tutorial](../tutorials/2d-platformer.md) |
| A **3D game** | [`render`](../../packages/render), [`math`](../../packages/math), [`physics`](../../packages/physics) (character controller, ray casts), [`input`](../../packages/input), [`audio`](../../packages/audio) | [3D shooter tutorial](../tutorials/3d-shooter.md) |
| A **real-time online game**: io-style, arena shooter | [`protocol`](../../packages/protocol), [`transport`](../../packages/transport), [`server`](../../packages/server), [`client`](../../packages/client) | [Multiplayer, explained](multiplayer-explained.md), then the [arena](../../examples/arena) example |
| A **turn-based or card game** online | [`turns`](../../packages/turns), [`matchmaking`](../../packages/matchmaking), [`persist`](../../packages/persist) | [Card game tutorial](../tutorials/multiplayer-card-game.md) |
| **Accounts, ratings, leaderboards** | [`persist`](../../packages/persist), [`matchmaking`](../../packages/matchmaking) | The card game's `server/` folder |
| **Sound**, music, sounds made in code | [`audio`](../../packages/audio) | The shooter's `main.js` (`sfx`, positional sound) |
| **Saving**: a best score, settings, save slots | [`save`](../../packages/save) | The `2d` template's `src/main.js` (a best score kept in the browser) |
| **Menus and a HUD** | [`ui`](../../packages/ui), [`input`](../../packages/input) | [`ui`](../../packages/ui) README |
| **Levels as files**, made in an editor | [`scene`](../../packages/scene), [`prefab`](../../packages/prefab), [`assets`](../../packages/assets), [`editor`](../../packages/editor) | The `3d` template |
| **Enemies that think** | [`ai`](../../packages/ai), [`fsm`](../../packages/fsm) | [`ai`](../../packages/ai) README |
| **Effects**: sparks, smoke, explosions | [`particles`](../../packages/particles), [`render`](../../packages/render) | The shooter's `main.js` |
| **Modding** by your players | [`mods`](../../packages/mods) | [Modding guide](../MODDING.md) |
| **Seeing what the network does** | [`debug`](../../packages/debug) | Press F3 in the arena example |

You never need all of them. A 2D game that is for one person needs around five. The [package list](../../packages) has all 26 grouped by what they are for.

## Three ideas that hold everywhere

**1. The rules are separate from the picture.** A game is a function `step(game, input)` that moves the world on by one fixed tick, and a separate page that draws it. The three tutorial games are built this way, and it is why their tests run in Node without a browser, why a replay is just a list of inputs, and why the same rules can run on a server.

```js
const loop = new FixedLoop({
  tickRate: 60,
  update: () => step(game, readInput()),     // the rules: always 1/60 s at a time
  render: (alpha) => draw(game, alpha),      // the picture: once per frame
});
requestAnimationFrame(function frame(now) { loop.advance(elapsedSeconds(now)); requestAnimationFrame(frame); });
```

**2. Input means actions, not keys.** You describe what a player can *do* (`jump`, `fire`, `move`) and which controls do it. The same game then works with keyboard, gamepad and touch, and players can rebind.

**3. Data over code.** Levels, prefabs and settings are JSON that the engine validates and the editor can change. A level is a file, not a function.

Everything else (the network, the renderer, the editor) is a package you add when you need it. [How it works](architecture.md) explains why they fit together this way.

## A good first hour

1. **Run a template** (above) and change a number.
2. **Read the tutorial** that matches your game. Each is one page and ends with things to try.
3. **Break the rules on purpose**: change `PLAYER_SPEED` in your project, or `MOVE` in the platformer tutorial or `CFG` in the shooter, and run `npm test`. The tests say what you changed.
4. **Read [How it works](architecture.md)** when you want the big picture.
5. **Look things up** in the [package pages](../../packages) and the [API reference](../api/README.md), or press <kbd>/</kbd> to search everything.

## What is where in the repository

| Folder | What is in it |
|---|---|
| `packages/` | The engine: one folder per package, each with a README, source in `src/`, tests in `test/` |
| `examples/` | Playable games: the arena (networked), the three tutorial games, and demos of walking, physics and the editor |
| `tools/` | Scripts for the project itself: dependency checks, releases, API docs, this website, load tests, browser tests |
| `docs/` | Guides, tutorials, the generated API reference, benchmarks, security notes, the roadmap |

## When something does not work

- In the engine repository, `npm test` is the reference: if it passes on your machine, the engine works there. `npm run test:browser` (also repository only, not in generated projects) runs the Chrome tests and needs Chrome installed.
- The debug overlay (<kbd>F3</kbd> in the arena example) shows the network live: round-trip time, bandwidth, and every packet decoded.
- Each package page lists exactly what it may import. If an import is refused by `npm test`, that rule is there on purpose: [How it works](architecture.md) explains it.
