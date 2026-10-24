# Tutorial: a 3D first-person shooter

You will build a small first-person shooter: an arena with cover, five waves of robots that find you, aim and shoot back, a rifle with headshots and reloading, pickups, shadows, bloom, particles and sound, and a computer player that proves the game can be won. The finished game is `examples/shooter`; run it with `npm run shooter` and open the printed address.

Files: `src/level.js` (the arena), `src/game.js` (the rules), `src/main.js` (the page), `test/game.test.js`.

## 1. One description, two uses
`buildArena()` makes the collision world (`TriWorld` from `@engine/physics`: a triangle soup in a grid) and, from the same `box(...)` calls, the list of boxes the page draws. They cannot disagree about where a wall is. It also lists spawn points and lamps. It imports nothing from the renderer, so the rules and their tests run in Node.

## 2. The rules know nothing about the screen
`step(game, input)` moves the game on by 1/60 s. `input` is plain data: `{ mx, mz, yaw, pitch, fire, jump, reload, run }`. Random numbers (weapon spread, who drops what, where robots enter) come from a seeded generator inside the game, so the same seed and the same inputs always give the same game. A replay is a list of inputs and a seed, and tests need no browser.

The player is a `CharacterController`: it walks on slopes, climbs steps, jumps and cannot tunnel through a wall at any speed. Robots use the same controller.

## 3. Shooting is a ray
The rifle is a *hitscan* weapon. Each shot casts a ray from the eye along the aim direction, plus a little random spread:
```js
if (world.raycast(ox, oy, oz, dx, dy, dz, range, hit)) wall = hit.t;     // how far until a wall
const t = raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, radius);         // how far until a robot
```
Each robot is two spheres, a body and a head. The nearest hit that is closer than the wall wins, and a head hit does double damage. Because the wall test comes first, a robot behind cover cannot be shot, which the tests check. The same `raycast` is how robots know whether they can see you: a ray from their chest to your eyes that touches nothing means a clear shot.

## 4. Enemies you can read
- **Grunts** walk until they have a clear shot, strafe at a comfortable distance, and *warn before they fire*: an `aim` event first (the page plays a click and lights their eye), then the shot 0.45 s later. A warning is what makes a shooter feel fair. They often miss at a distance.
- **Rushers** run straight at you and bite. When blocked, both slide sideways, which gets them round a pillar.
- **Waves** arrive a few at a time, never more than six alive, and each wave is larger. Clearing a wave heals a little and gives ammo, and clearing wave five wins.

## 5. Tuning with a bot
`botInput(game)` is a computer player. It turns towards the nearest enemy it can see at a limited speed, fires when it is on target, backs away from rushers and fetches pickups. The test lets it play whole games:
- a bot that turns at a human-ish speed wins on several seeds;
- one that turns too slowly can lose;
- a player who stands still dies in the first wave.

Those three together say the difficulty is fair. When you change a number in `CFG` and one of them stops being true, you know what you changed.

## 6. The page
`src/main.js` reads `@engine/input` actions (WASD and mouse or a gamepad: no key names in the game), runs the rules at a fixed rate, and draws:
- the arena and robots as boxes, spheres and capsules, lit by the sun with shadows (`shadows: true`), point lights for the lamps and for muzzle flashes and explosions, and bloom (`post: true`);
- tracers and sparks as particles;
- the HUD (crosshair, hit marker, health, ammo, damage direction) with the 2D renderer on a transparent canvas over the 3D view;
- sounds made in code, placed in the world: a robot's shot comes from where the robot is.

Nothing in `main.js` decides anything about the game. It calls `step`, then turns the returned events (`shot`, `hit`, `kill`, `hurt`, `wave`...) into sound, sparks and screen shake.

`node tools/shooter-test.js` opens the game in Chrome on both renderers, starts it with Enter, lets the bot press the real W A S D keys and click the real mouse button, and checks that robots die, nothing throws, the end screen appears and the best score is saved.

## 7. Make it yours
- Change `CFG` (a slower rifle, tougher robots, six waves).
- Add a robot type: an entry in `CFG.enemies`, a branch in `moveEnemy` and `actEnemy`, and a colour in `main.js`.
- Add a weapon: a shotgun is `fire` called several times with more spread.
- Build another arena in `level.js`, or load a level made with the editor (`@engine/scene`).
