// Your own picture files: put a PNG, JPG, GIF or WebP in the project (the studio's Files panel has an Import button) and use it by its path: give a thing
// `image: 'assets/hero.png'`, or call `drawImage`. The game never loads files itself. The page that runs it loads every picture first, hands them over, and
// only then calls `create`, so `drawImage` can be used straight away and the pictures never become part of the game's saved state (only the path does).
// A picture that is missing is drawn as a pink and black square, so the mistake is easy to see.

let hosted = null;

/**
 * Choose where pictures come from (for tests, or a host that is not the studio). The studio's game page sets `globalThis.__engineAssets` instead.
 * @param {Map<string, CanvasImageSource> | null} images by path
 */
export function setAssetHost(images) {
  hosted = images;
}

const table = () => hosted ?? globalThis.__engineAssets ?? null;

/**
 * The picture at a path, or null when there is none.
 * @param {string} path for example 'assets/hero.png'
 * @returns {CanvasImageSource | null}
 */
export function image(path) {
  return table()?.get(path) ?? null;
}

/** The size of a picture in pixels, or null when there is none. */
export function imageSize(path) {
  const img = image(path);
  return img ? { w: img.width, h: img.height } : null;
}

/**
 * Draw a picture file. Several frames side by side in one picture (a strip) work too: say how many with `frames` and which one with `frame`. A sheet (a grid
 * of frames, rows as well as columns) works the same way: say `cols` and `rows`, and `frame` counts along the first row, then the next (0 is the top left).
 * @param {CanvasRenderingContext2D} g
 * @param {string} path for example 'assets/hero.png'
 * @param {number} x
 * @param {number} y
 * @param {number} [w] width on the screen (default: the picture's own)
 * @param {number} [h] height on the screen (default: the picture's own)
 * @param {{flip?: boolean, frames?: number, frame?: number, cols?: number, rows?: number}} [o] `flip` mirrors it left to right
 */
export function drawImage(g, path, x, y, w, h, { flip = false, frames = 1, frame = 0, cols = 0, rows = 1 } = {}) {
  const img = image(path);
  if (!img) {
    const width = w ?? 32;
    const height = h ?? 32;
    g.fillStyle = '#ff2fd0';
    g.fillRect(x, y, width, height);
    g.fillStyle = '#000';
    g.fillRect(x, y, width / 2, height / 2);
    g.fillRect(x + width / 2, y + height / 2, width / 2, height / 2);
    return;
  }
  const across = Math.max(1, Math.floor(cols) || Math.floor(frames) || 1);                    // columns: a strip is one row of them
  const down = Math.max(1, Math.floor(rows) || 1);
  const index = Math.min(across * down - 1, Math.max(0, Math.floor(frame) || 0));
  const sw = img.width / across;
  const sh = img.height / down;
  const sx = (index % across) * sw;
  const sy = Math.floor(index / across) * sh;
  const width = w ?? sw;
  const height = h ?? sh;
  g.imageSmoothingEnabled = false;
  if (!flip) { g.drawImage(img, sx, sy, sw, sh, x, y, width, height); return; }
  g.save();
  g.translate(x + width, y);
  g.scale(-1, 1);
  g.drawImage(img, sx, sy, sw, sh, 0, 0, width, height);
  g.restore();
}

/** Is this a path the studio keeps pictures and sounds at? (`assets/` and a plain file name: no folders above, no odd characters.) */
export const isAssetPath = (path) => typeof path === 'string' && /^assets\/[\w][\w .-]{0,79}$/.test(path) && !path.includes('..');
