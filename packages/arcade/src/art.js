// Pixel art: a sprite is plain data (a size, a palette of letters, and frames made of rows of letters), so it can be painted in the studio, edited by hand,
// saved in a text file and imported like any other module. Things refer to a sprite by name (`thing.sprite = 'hero'`) and the game keeps its art in an object
// of its own (`const art = { hero }`), not in the game state, so the state stays small plain data.
//
//   { w: 4, h: 4, palette: { a: '#5ac8ff' }, frames: [['.aa.', 'aaaa', 'aaaa', '.aa.']], animations: { run: { frames: [0, 1], fps: 8 } } }

/**
 * @typedef {Object} Sprite
 * @property {number} w width in pixels
 * @property {number} h height in pixels
 * @property {Object<string, string>} palette one letter for each colour (any CSS colour); `.` and a space are see-through
 * @property {string[][]} frames each frame is `h` rows of `w` letters
 * @property {Object<string, {frames: number[], fps: number, mode?: 'loop' | 'once' | 'reverse' | 'pingpong'}>} [animations] named runs through the frames (they go round and round unless `mode` says otherwise)
 */

let makeCanvas = (w, h) => new OffscreenCanvas(w, h);

/**
 * Choose how small canvases are made (the default is an OffscreenCanvas, which the game's worker and modern browsers have). Tests and other hosts replace it.
 * @param {(w: number, h: number) => any} factory
 */
export function setCanvasFactory(factory) {
  makeCanvas = factory;
}

/**
 * Make a small canvas to draw on out of sight (the lights use one for the darkness). It is made the way {@link setCanvasFactory} says.
 * @param {number} w
 * @param {number} h
 * @returns {any} a canvas
 */
export function newCanvas(w, h) {
  return makeCanvas(w, h);
}

/**
 * Check that something is a usable sprite.
 * @param {unknown} sprite
 * @returns {string | null} what is wrong, or null when it is fine
 */
export function spriteProblem(sprite) {
  if (!sprite || typeof sprite !== 'object') return 'a sprite is an object';
  const { w, h, palette, frames, animations } = sprite;
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1 || w > 128 || h > 128) return 'w and h must be whole numbers from 1 to 128';
  if (!palette || typeof palette !== 'object') return 'palette must be an object of letters and colours';
  for (const [k,
    v] of Object.entries(palette)) if (k.length !== 1 || typeof v !== 'string') return `palette entry "${k}" must be one letter and a colour`;
  if (!Array.isArray(frames) || !frames.length || frames.length > 256) return 'frames must be a list of at least one frame';
  for (const [i, frame] of frames.entries()) {
    if (!Array.isArray(frame) || frame.length !== h) return `frame ${i + 1} must have ${h} rows`;
    for (const [y, row] of frame.entries()) {
      if (typeof row !== 'string' || row.length !== w) return `row ${y + 1} of frame ${i + 1} must be ${w} letters long`;
      for (const ch of row) if (ch !== '.' && ch !== ' ' && !(ch in palette)) return `frame ${i + 1}, row ${y + 1}: the letter "${ch}" is not in the palette`;
    }
  }
  for (const [name, a] of Object.entries(animations ?? {})) {
    if (!a || !Array.isArray(a.frames) || !a.frames.length || a.frames.some((n) => !Number.isInteger(n) || n < 0 || n >= frames.length)) {
      return `animation "${name}" must list frame numbers that exist`;
    }
    if (!(a.fps > 0 && a.fps <= 60)) return `animation "${name}" needs fps from 1 to 60`;
    if (a.mode !== undefined && !ANIMATION_MODES.includes(a.mode)) return `animation "${name}" has a mode that is not one of ${ANIMATION_MODES.join(', ')}`;
  }
  return null;
}

const cache = new WeakMap();

/**
 * One frame of a sprite as a small canvas, made once and kept.
 * @param {Sprite} sprite
 * @param {number} [index]
 * @returns {any} a canvas
 */
export function frameCanvas(sprite, index = 0) {
  let frames = cache.get(sprite);
  if (!frames) { frames = []; cache.set(sprite, frames); }
  const i = Math.max(0, Math.min(sprite.frames.length - 1, Math.trunc(index) || 0));
  if (!frames[i]) {
    const problem = spriteProblem(sprite);
    if (problem) throw new Error(`This sprite cannot be drawn: ${problem}.`);
    const canvas = makeCanvas(sprite.w, sprite.h);
    const c = canvas.getContext('2d');
    sprite.frames[i].forEach((row, y) => {
      for (let x = 0; x < sprite.w; x++) {
        const color = sprite.palette[row[x]];
        if (!color) continue;
        c.fillStyle = color;
        c.fillRect(x, y, 1, 1);
      }
    });
    frames[i] = canvas;
  }
  return frames[i];
}

/**
 * Draw one frame of a sprite, crisp (no smoothing), stretched to a size.
 * @param {CanvasRenderingContext2D} g
 * @param {Sprite} sprite
 * @param {number} frame
 * @param {number} x left edge
 * @param {number} y top edge
 * @param {number} [w] drawn width (default: the sprite's own)
 * @param {number} [h] drawn height
 * @param {boolean} [flip] mirrored left to right
 */
export function drawSprite(g, sprite, frame, x, y, w = sprite.w, h = sprite.h, flip = false) {
  const image = frameCanvas(sprite, frame);
  g.imageSmoothingEnabled = false;
  if (!flip) { g.drawImage(image, x, y, w, h); return; }
  g.save();
  g.translate(x + w, y);
  g.scale(-1, 1);
  g.drawImage(image, 0, 0, w, h);
  g.restore();
}

/** How an animation plays: round and round, once and stop on the last frame, backwards round and round, or forwards then backwards. */
export const ANIMATION_MODES = ['loop', 'once', 'reverse', 'pingpong'];

/**
 * Which frame of a sprite an animation shows after some time. The animation's `mode` says how it plays: `loop` (the default) goes round and round, `once` stops on its last frame,
 * `reverse` goes backwards round and round, and `pingpong` goes to the end and back again without showing the end frames twice.
 * @param {{frames: number[], fps: number, mode?: string}} animation
 * @param {number} time seconds since it began
 * @returns {number} the frame number
 */
export function animationFrame(animation, time) {
  const n = animation.frames.length;
  const step = Math.max(0, Math.floor(Math.max(0, time) * animation.fps));
  let at;
  if (animation.mode === 'once') at = Math.min(step, n - 1);
  else if (animation.mode === 'reverse') at = n - 1 - (step % n);
  else if (animation.mode === 'pingpong') {
    const period = Math.max(1, 2 * n - 2);
    const p = step % period;
    at = p < n ? p : period - p;
  } else at = step % n;
  return animation.frames[at];
}

/** Has a `once` animation reached its last frame? (Any other kind never ends.) */
export function animationDone(animation, time) {
  return animation.mode === 'once' && Math.floor(Math.max(0, time) * animation.fps) >= animation.frames.length - 1;
}

/**
 * Move a thing's picture along its animation: set `thing.anim` to a name from the sprite (`'run'`) and call this every tick; it sets `thing.frame`.
 * The animation restarts when the name changes. It plays the way the animation's `mode` says (see {@link animationFrame}), and `thing.animDone` becomes true when a `once` animation has reached its end.
 * @param {import('./things.js').Thing & {anim?: string}} thing
 * @param {Object<string, Sprite>} art the game's sprites
 * @param {number} dt
 */
export function animate(thing, art, dt) {
  const sprite = art?.[thing.sprite];
  const a = sprite?.animations?.[thing.anim];
  if (!a) { thing.frame = thing.frame ?? 0; return; }
  if (thing.animName !== thing.anim) { thing.animName = thing.anim; thing.animTime = 0; }
  thing.animTime = (thing.animTime ?? 0) + dt;
  thing.frame = animationFrame(a, thing.animTime);
  thing.animDone = animationDone(a, thing.animTime);
}
