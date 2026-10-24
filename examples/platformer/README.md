# Platformer (tutorial game)

A small 2D platformer: three levels, running and jumping with coyote time, jump buffering and variable height, walking enemies you can stomp, springs, spikes, coins, sound made in code, and best times kept in the browser. Walkthrough: [`docs/tutorials/2d-platformer.md`](../../docs/tutorials/2d-platformer.md).

```
npm run platformer      # then open the printed address
```
Arrows or A/D run, Space / W / Up jump, R restarts the level, N goes to the next, Esc shows the level list. A gamepad works too.

| File | What it is |
|---|---|
| `src/level.js` | Reads levels written as rows of letters; merges ground tiles into boxes |
| `src/game.js` | The rules: `createGame`, `step(game, bits)`, `replay`, `botInput`. No screen, no clock |
| `src/main.js` | The page: drawing, input, sound, saved times |
| `levels/*.json` | The levels (add a file and list it in `levels/index.json`) |
| `test/game.test.js` | The rules, every level finished by a bot, replays |

Tests: `npm test` runs `test/game.test.js`; `node tools/platformer-test.js` plays a level in Chrome with real key presses on both renderers.
