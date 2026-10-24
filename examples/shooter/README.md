# Shooter (tutorial game)

A small first-person shooter: five waves of robots in an arena with cover. Grunts aim (with a warning) and shoot, rushers run in and bite. A hitscan rifle with headshots and reloading, health and ammo pickups, sun shadows, bloom, particles, sound made in code and a saved best score. Walkthrough: [`docs/tutorials/3d-shooter.md`](../../docs/tutorials/3d-shooter.md).

```
npm run shooter      # then open the printed address
```
Click the game to capture the mouse, then press Enter. WASD move, mouse aims, left click fires, R reloads, Space jumps, Shift runs. A gamepad works too.

| File | What it is |
|---|---|
| `src/level.js` | The arena: collision triangles and drawn boxes from one description, spawn points, lamps |
| `src/game.js` | The rules: `createGame`, `step(game, input)`, `replay`, `botInput`. Seeded, no screen, no clock |
| `src/main.js` | The page: input, drawing, particles, HUD, sound, saved score |
| `test/game.test.js` | Walking, rifle, hits and cover, enemies, waves, replays, a bot that wins |

Tests: `npm test` runs `test/game.test.js`; `node tools/shooter-test.js` plays in Chrome with real keys and mouse clicks on both renderers (`SHOOTER_MS=15000` shortens it).
