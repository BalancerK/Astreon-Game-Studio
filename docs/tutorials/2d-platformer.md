# Tutorial: a 2D platformer

You will build a small platformer: tile levels, a hero that runs and jumps the way players expect, enemies, springs, coins, sound without audio files, best times that are remembered, and tests that prove every level can be finished. The finished game is `examples/platformer`; run it with `npm run platformer` and open the printed address.

Files: `src/level.js` (levels), `src/game.js` (the rules), `src/main.js` (the page), `levels/*.json`, `test/game.test.js`.

## 1. A level is a picture made of letters
```
..........
..@.....G.
####..####     # ground   ^ spikes   S spring   o coin   E enemy   @ start   G goal
####..####
```
`loadLevel(data)` checks the rows (same width, known letters, one start, one goal, with a message that names the row and column) and turns them into what the game needs. Neighbouring ground tiles are merged into as few rectangles as possible: a floor of 80 tiles is one box, so the hero never catches on the seams between tiles. Merged rectangles also make collision cheaper.

To make a new level, add a file to `levels/` and its name to `levels/index.json`. The tests then check that it can be finished.

## 2. The rules know nothing about the screen
`step(game, input)` moves the game on by 1/60 s. The input is three bits (left, right, jump), so a whole run is a list of small numbers. The same inputs always give the same game, which gives you replays, ghosts, and tests that need no browser:
```js
const game = createGame(level);
step(game, RIGHT | JUMP);           // returns the events of this tick: jump, land, coin, stomp, spring, die, win
```
Collision is `@engine/physics`: the level's boxes go into a `SpatialHash` and `moveAndSlide` moves the hero's box sideways and then down or up. Moving the axes one at a time tells you exactly what you landed on or bumped. The swept motion cannot tunnel through a thin wall at any speed.

## 3. Making it feel right
Four small ideas separate a good jump from a bad one. They are all in `step`, and all numbers in `MOVE`, so change one and feel it.
- **Variable height.** Let go of jump while rising and the upward speed is cut (`cut`). A tap is a hop, a hold is a full jump.
- **Coyote time.** You can still jump for 0.1 s after running off an edge (`coyote`). Players press jump when they *see* the edge, not when the game does.
- **Jump buffer.** A jump pressed up to 0.12 s before landing still happens on landing (`buffer`).
- **Acceleration.** Speed builds and fades instead of switching on and off, more slowly in the air.

Springs and stomps also clear the coyote timer. Without that, a leftover coyote jump overwrote the bounce. The computer player in the tests found this bug.

## 4. A bot that finishes every level
`botInput(game)` runs right and jumps when a wall, a gap, spikes or an enemy is ahead. The test lets it play every file in `levels/` and requires that it wins, never dies, and does it faster than the level's `par`. Add an impossible level and the test says where the bot got stuck. It cannot collect every coin, because they sit in places that need a player who looks around.

## 5. The page
`src/main.js` draws with the sprite renderer (one white square, circle and triangle, tinted), follows the hero with `camera.follow`, shakes the screen on a death, plays sounds made in code (`sfx.jump()`, `sfx.coin()`) after the first key press (browsers insist), and keeps best times with `@engine/save`. The controls are named actions with several bindings each (keys, gamepad, touch buttons), so the game code never mentions a key.

`node tools/platformer-test.js` opens the game in Chrome on both renderers, starts a level with the real Enter key, lets the bot press the real arrow keys and Space until the level is won, and checks that the time is saved.

## 6. Make it yours
- Change `MOVE` (a floatier jump: lower `gravity`, higher `jump`).
- Add a tile in `loadLevel` and a rule in `step` (a moving platform, a key and a door).
- Replace the shapes in `main.js` with sprite art from an `Atlas` or loaded images.
- Record a run (`inputs` list) and play it back as a ghost: `replay(level, inputs)` gives the same game every time.
