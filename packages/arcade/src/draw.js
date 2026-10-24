// Drawing: a screen-sized background, every thing as a coloured box or an emoji, text, and a camera that follows the hero. They take the 2D canvas context
// `g` that `render` is given.

import { getSetting } from './settings.js';
import { frameCanvas, drawSprite } from './art.js';
import { shakeOffset } from './effects.js';
import { drawImage } from './assets.js';
import { screen } from './screen.js';
import { drawAutoTile } from './autotile.js';

/**
 * Fill the whole screen with one colour (the background colour from the project's settings unless you give one).
 * @param {CanvasRenderingContext2D} g
 * @param {string} [color]
 * @param {number} [width] screen width in pixels
 * @param {number} [height] screen height in pixels
 */
export function clear(g, color = screen().background, width = screen().width, height = screen().height) {
  g.fillStyle = color;
  g.fillRect(0, 0, width, height);
}

/**
 * Draw every thing: its picture file if it has one (`thing.image = 'assets/hero.png'`, see {@link drawImage}; `frames` and `frame` pick from a strip, or `cols`, `rows` and `frame` from a sheet), its sprite if it has one (`thing.sprite = 'hero'`, drawn from the `art` you pass, mirrored when `thing.flip` is true), its emoji, or a box in
 * its colour (`shape: 'circle'` makes a round one). Things with `hidden: true` are skipped and `alpha` makes them see-through. The camera (see {@link follow})
 * decides which part of the world is on the screen, and a {@link shake} moves it for a moment. Draw text and scores with {@link label} afterwards.
 * @param {CanvasRenderingContext2D} g
 * @param {{things: import('./things.js').Thing[], camera?: {x: number, y: number}}} game
 * @param {Object<string, import('./art.js').Sprite>} [art] the game's sprites by name
 */
export function drawThings(g, game, art) {
  const cam = game.camera ?? { x: 0, y: 0 };
  const shaken = shakeOffset(game);
  g.save();
  g.translate(-Math.round(cam.x) + Math.round(shaken.x), -Math.round(cam.y) + Math.round(shaken.y));
  for (const t of game.things ?? []) {
    if (t.hidden) continue;
    g.globalAlpha = t.alpha ?? 1;
    if (t.image) {
      drawImage(g, t.image, t.x, t.y, t.w, t.h, { flip: !!t.flip, frames: t.frames ?? 1, frame: t.frame ?? 0, cols: t.cols ?? 0, rows: t.rows ?? 1 });
      continue;
    }
    if (t.sprite && art?.[t.sprite]) {
      drawSprite(g, art[t.sprite], t.frame ?? 0, t.x, t.y, t.w, t.h, !!t.flip);
      continue;
    }
    if (t.emoji) {
      g.font = `${Math.round(Math.min(t.w, t.h) * 0.85)}px system-ui, "Segoe UI Emoji", sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(t.emoji, t.x + t.w / 2, t.y + t.h / 2 + 1);
      continue;
    }
    if (t.autotile && t.mask !== undefined) {                       // a tile that draws its own edges (see autotile.js)
      drawAutoTile(g, t.x, t.y, t.w, t.mask, t.color ?? '#5ac8ff', { edge: t.edge, width: t.edgeWidth });
      continue;
    }
    g.fillStyle = t.color ?? '#5ac8ff';
    if (t.shape === 'circle') {
      g.beginPath();
      g.ellipse(t.x + t.w / 2, t.y + t.h / 2, t.w / 2, t.h / 2, 0, 0, Math.PI * 2);
      g.fill();
    } else g.fillRect(t.x, t.y, t.w, t.h);
  }
  g.globalAlpha = 1;
  g.restore();
}

/**
 * Write text on the screen (it does not move with the camera).
 * @param {CanvasRenderingContext2D} g
 * @param {string|number} text
 * @param {number} x
 * @param {number} y
 * @param {{size?: number, color?: string, align?: 'left'|'center'|'right'}} [style]
 */
export function label(g, text, x, y, { size = 16, color = '#fff', align = 'left' } = {}) {
  g.fillStyle = color;
  g.font = `${Math.round(size * getSetting('textScale'))}px system-ui, sans-serif`;       // the player's text size applies
  g.textAlign = align;
  g.textBaseline = 'alphabetic';
  g.fillText(String(text), x, y);
}

/**
 * Point the camera at a thing so it stays in the middle of the screen, without showing anything outside the map.
 * @param {{camera?: {x: number, y: number}}} game
 * @param {import('./things.js').Thing | undefined} thing
 * @param {{width: number, height: number}} map the size of the whole world, for example what {@link loadMap} returned
 * @param {number} [screenWidth]
 * @param {number} [screenHeight]
 */
export function follow(game, thing, map, screenWidth = screen().width, screenHeight = screen().height) {
  if (!thing) return;
  if (!map || typeof map.width !== 'number') {
    throw new Error('follow needs the size of the level. In create, write game.map = loadMap(...), then press Run to start the game again.');
  }
  game.camera ??= { x: 0, y: 0 };
  const limit = (v, size, world) => Math.max(0, Math.min(v, world - size));
  game.camera.x = limit(thing.x + thing.w / 2 - screenWidth / 2, screenWidth, map.width);
  game.camera.y = limit(thing.y + thing.h / 2 - screenHeight / 2, screenHeight, map.height);
}
