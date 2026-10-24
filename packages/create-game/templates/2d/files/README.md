# {{title}}

A small top-down game made with the engine: move with WASD, the arrow keys or a gamepad, collect coins, stay away from the red hazards.

```
npm run dev       # http://127.0.0.1:8080/ with live reload (Ctrl+C stops it)
npm test          # the rules of the game (src/game.js) have tests
npm run build     # one hashed script, minified, with a manifest and compressed copies: dist/
```

(The packages were installed when the project was made. Run `npm install` again only after you change `package.json`. The project links to the engine checkout it was made from, so do not move that folder.)

## Try this
Open `src/game.js` and change `PLAYER_SPEED`. Run `npm test`: the tests that pin the old speed fail and show the number they expected. Update them, or change it back. The rules have tests because they are separate from the page.

## Where things are
- `src/game.js`: the rules. No page, no renderer; `step(game, move, dt)` is all there is.
- `src/main.js`: the page. Draws the game, reads the input, runs the rules at a fixed 60 Hz, saves the best score.
- `assets/`: sounds, images and data (hashed and listed in the build's manifest).
- `engine.config.json`: what the build processes.

## Next
- Add sounds with `@engine/audio` (sounds made in code need no files).
- Add menus and a pause screen with `@engine/ui`.
- Make it multiplayer: `src/game.js` has no browser code in it, so the same rules can run on a server (`@engine/server`, `@engine/transport`).
