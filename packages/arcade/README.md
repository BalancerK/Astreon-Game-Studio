# @engine/arcade

A small kit for a first game. Zero dependencies, and it never touches the page, so it runs inside the studio's game worker.

Everything is **plain data**: a hero, a coin and a wall are plain objects in a list inside your game's state. There are no classes and no hidden state, so hot reload, saving, copying and rewinding the game just work.

```js
import { newGame, loadMap, first, all, despawn, touches, walk, jump, gravity, moveAndCollide, clear, drawThings, follow, label } from '@engine/arcade';

const LEVEL = [
  '##########',
  '#........#',
  '#..o..o.@#',
  '##########',
];

export function create() {
  const game = newGame();
  game.map = loadMap(game, LEVEL, {
    '#': { kind: 'wall', color: '#3b4a6b' },
    o: { kind: 'coin', emoji: '\u{1FA99}' },
    '@': { kind: 'hero', w: 24, h: 30 },
  });
  return game;
}

export function update(game, keys, dt) {
  const hero = first(game, 'hero');
  walk(hero, keys);
  jump(hero, keys);
  gravity(hero, dt);
  moveAndCollide(game, hero, dt);
  const coin = touches(game, hero, 'coin');
  if (coin) { despawn(game, coin); game.score++; }
  follow(game, hero, game.map);
}

export function render(game, g) {
  clear(g);
  drawThings(g, game);
  label(g, 'Score ' + game.score, 12, 24);
}
```

**Your own pictures and sounds:** in the studio, import a PNG, JPG, GIF or WebP and give a thing `image: 'assets/hero.png'` (or call `drawImage(g, 'assets/hero.png', x, y)`; a strip of frames works with `{ frames: 4, frame: n }`). A sound file is used like any sound: `sounds({ boom: { file: 'assets/boom.wav' } })`, then `play('boom')`. A missing picture is drawn as a pink and black square.

`keys` is the set of keys held down. In the studio and in exported games, touch buttons and game controllers press the same codes (arrows, `Space`, `KeyX`, `Enter`), so `held(keys, 'left')` and the rest work with a keyboard, a phone and a controller without any change to your game.

## What is in it

| | |
|---|---|
| **Things** | `newGame`, `spawn`, `all`, `first`, `despawn`, `touching`, `touches`, `overlaps`, `move` |
| **Keys and movement** | `held` (easy names: left, right, up, down, space, jump, action), `walk`, `steer` (seen from above), `jump`, `gravity`, `moveAndCollide` (stops at walls, cannot tunnel through thin ones) |
| **Levels** | `loadMap`: rows of letters and a legend; clear messages for a wrong row or an unknown letter. `loadScene`: the things of a scene placed by dragging in the studio's Scene panel |
| **Timing** | `timed('name', () => ...)` wraps a piece of work so the studio's Profiler shows what it costs in every frame (it only runs your function outside the studio) |
| **Music** | `music({...})`, `playMusic('name')`, `stopMusic()`: songs made in the studio's Music panel loop without a click; a sheet of frames draws with `drawImage(..., { cols, rows, frame })` |
| **3D** | `camera3d`, `move3d` (turn and walk, blocks stop you), `jump3d`, `block` (can be turned with `yaw`), `ramp` and `stairs` (you walk up them; `move3d` also climbs low blocks, jumps onto high ones and falls off ledges), `groundAt`, `gem`, `mouseLook3d` and `mouseDelta` (the mouse, after a click; Esc lets go), `chase3d` (a guardian that walks towards you), `drawWorld3d` (sky, floor lines, then blocks and gems far to near with fog), `project3d`, `loadWorld3d` (a scene made in the studio's 3D panel as blocks, gems and a start place): a first-person world drawn flat-shaded on the same 2D canvas, all plain data (the studio's **Gem hall (3D)** template; see docs/guide/3d-games.md). Boxes only, no textures; for the GPU renderer use `@engine/render` |
| **Drawing** | `clear`, `drawThings` (boxes, circles, emoji; the camera applies), `label` (text that stays still), `follow` (the camera) |
| **Time and chance** | `every` (do something every so many seconds), `random` and `randomBetween` (seeded, kept in the game state, so a game replays the same way) |

## How it relates to the rest of the engine

It is a separate, optional layer for first games and quick prototypes. It does not use the other packages, and a project can import it and any engine package in the same file. When a game outgrows it, the same ideas exist in the engine proper: `@engine/physics` for real collision and `@engine/core` for a world of entities and systems.
