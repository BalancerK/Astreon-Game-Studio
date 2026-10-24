// Auto-tiling: ground, walls and water that draw their own edges and corners. In a level made of letters, a tile does not have to be one picture: a tile with no neighbour above
// it gets a top edge, one with a neighbour on every side is plain, one in a corner of a block gets a rounded corner. You paint "this is ground" and the kit works out the rest.
// Turn it on in the level's legend:
//
//   loadMap(game, LEVEL, { '#': { kind: 'wall', color: '#3b4a6b', autotile: 'blob47' } });         // or 'edges4': four sides only
//
// With no picture it draws the edges itself (`edge` is their colour, `edgeWidth` how thick). With a picture (`sprite: 'ground-tiles'`, which has one frame for each shape: 16 for
// 'edges4', 47 for 'blob47', see `makeAutotileSprite`) it picks the right frame. Tiles of the same `terrain` join each other (default: the letter itself, so '#' joins '#').
//
// Each neighbour is a bit: 1 north, 2 east, 4 south, 8 west, 16 north-east, 32 south-east, 64 south-west, 128 north-west. A set bit means that neighbour is part of the same terrain.

/** The two kinds of auto-tiling and how many pictures each needs: 'edges4' looks at the four sides (16), 'blob47' also at the corners (47). */
export const AUTOTILE_MODES = { edges4: 16, blob47: 47 };
const N = 1;
const E = 2;
const S = 4;
const W = 8;
const NE = 16;
const SE = 32;
const SW = 64;
const NW = 128;

/** Keep a corner only when both sides next to it are there (a corner next to a gap would not be seen), so 256 shapes become 47. */
export function cleanMask(mask) {
  let m = mask & 0xff;
  if (!((m & N) && (m & E))) m &= ~NE;
  if (!((m & S) && (m & E))) m &= ~SE;
  if (!((m & S) && (m & W))) m &= ~SW;
  if (!((m & N) && (m & W))) m &= ~NW;
  return m;
}

const BLOB = (() => {
  const seen = new Set();
  for (let m = 0; m < 256; m++) seen.add(cleanMask(m));
  const sorted = [...seen].sort((a, b) => a - b);
  return { frames: new Map(sorted.map((m, i) => [m, i])), masks: sorted };
})();

/** The shapes of a mode, as the neighbour masks they stand for, in frame order (frame 0 is a tile on its own). */
export const shapesOf = (mode) => (mode === 'blob47' ? BLOB.masks : Array.from({ length: 16 }, (_, i) => i));

/** The frame (the number of the picture) for a tile with these neighbours. */
export function frameFor(mask, mode) {
  if (mode === 'blob47') return BLOB.frames.get(cleanMask(mask));
  return mask & 15;
}

/**
 * The neighbour mask of every cell of a grid of terrains.
 * @param {(string | null)[][]} grid the terrain of each cell, null for a cell that is not auto-tiled
 * @param {{outside?: 'solid' | 'open'}} [o] what is beyond the edge of the map: more of the same ('solid', the default) or nothing
 * @returns {(number | null)[][]}
 */
export function masksFromGrid(grid, { outside = 'solid' } = {}) {
  const at = (x, y) => (y < 0 || y >= grid.length || x < 0 || x >= grid[y].length ? undefined : grid[y][x]);
  return grid.map((row, y) => row.map((own, x) => {
    if (own === null || own === undefined) return null;
    const joined = (dx, dy) => {
      const there = at(x + dx, y + dy);
      return there === undefined ? outside === 'solid' : there === own;
    };
    let m = 0;
    if (joined(0, -1)) m |= N;
    if (joined(1, 0)) m |= E;
    if (joined(0, 1)) m |= S;
    if (joined(-1, 0)) m |= W;
    if (joined(1, -1)) m |= NE;
    if (joined(1, 1)) m |= SE;
    if (joined(-1, 1)) m |= SW;
    if (joined(-1, -1)) m |= NW;
    return m;
  }));
}

/**
 * The neighbour mask of every tile of a level made of letters.
 * @param {string[]} rows
 * @param {(ch: string) => string | null} terrainOf which terrain a letter belongs to (null: not auto-tiled; two tiles join when their terrains are the same)
 * @param {{outside?: 'solid' | 'open'}} [o]
 * @returns {(number | null)[][]} a mask for each tile that has a terrain, null for the rest
 */
export function masksFor(rows, terrainOf, o) {
  return masksFromGrid(rows.map((row) => [...row].map((ch) => terrainOf(ch) ?? null)), o);
}

/** A colour made darker (or lighter, with a factor above 1): `#3b4a6b` to `#24304a`. Anything that is not a hex colour comes back as it was. */
export function shade(color, factor) {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(color));
  if (!m) return color;
  const hex = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
  const parts = [0, 2, 4].map((i) => Math.max(0, Math.min(255, Math.round(parseInt(hex.slice(i, i + 2), 16) * factor))));
  return `#${parts.map((p) => p.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Draw one auto-tiled tile with no picture: the colour, an edge on each side that has no neighbour, and a small notch where a corner is missing between two neighbours.
 * @param {CanvasRenderingContext2D} g
 * @param {number} x
 * @param {number} y
 * @param {number} size
 * @param {number} mask the tile's neighbour mask
 * @param {string} color
 * @param {{edge?: string, width?: number}} [o]
 */
export function drawAutoTile(g, x, y, size, mask, color, { edge, width } = {}) {
  const w = Math.max(1, Math.min(size / 2, width ?? Math.max(2, Math.round(size / 10))));
  g.fillStyle = color;
  g.fillRect(x, y, size, size);
  g.fillStyle = edge ?? shade(color, 0.65);
  if (!(mask & N)) g.fillRect(x, y, size, w);
  if (!(mask & S)) g.fillRect(x, y + size - w, size, w);
  if (!(mask & W)) g.fillRect(x, y, w, size);
  if (!(mask & E)) g.fillRect(x + size - w, y, w, size);
  if ((mask & N) && (mask & E) && !(mask & NE)) g.fillRect(x + size - w, y, w, w);
  if ((mask & S) && (mask & E) && !(mask & SE)) g.fillRect(x + size - w, y + size - w, w, w);
  if ((mask & S) && (mask & W) && !(mask & SW)) g.fillRect(x, y + size - w, w, w);
  if ((mask & N) && (mask & W) && !(mask & NW)) g.fillRect(x, y, w, w);
}

/**
 * Make the picture for an auto-tiled terrain from one plain tile: a sprite with a frame for every shape, with an edge drawn on the sides that have no neighbour and a notch
 * at the corners that are missing. Draw the plain tile once; this makes the 16 or 47 versions.
 * @param {{w: number, h: number, palette: Object<string, string>, frames: string[][]}} base a sprite (its first frame is used)
 * @param {'edges4' | 'blob47'} mode
 * @param {{edge?: string, width?: number, round?: boolean}} [o] `edge` the colour of the edges (default: a darker version of the tile's main colour), `width` in pixels, `round` clears the outer corner pixel
 * @returns {{w: number, h: number, palette: Object<string, string>, frames: string[][], animations: {}}}
 */
export function makeAutotileSprite(base, mode, { edge, width = 2, round = true } = {}) {
  if (!(mode in AUTOTILE_MODES)) throw new Error(`Auto-tiling has two modes: ${Object.keys(AUTOTILE_MODES).join(' and ')}.`);
  const { w, h } = base;
  const first = base.frames[0];
  const counts = {};
  for (const row of first) for (const ch of row) if (ch !== '.') counts[ch] = (counts[ch] ?? 0) + 1;
  const main = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0];
  const palette = { ...base.palette };
  const letters = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const edgeLetter = [...letters].find((c) => !(c in palette)) ?? 'z';
  palette[edgeLetter] = edge ?? shade(palette[main] ?? '#555555', 0.65);
  const b = Math.max(1, Math.min(Math.floor(Math.min(w, h) / 3), width));
  const frames = shapesOf(mode).map((mask) => first.map((row, y) => [...row].map((ch, x) => {
    if (ch === '.') return '.';
    const left = x < b;
    const right = x >= w - b;
    const top = y < b;
    const bottom = y >= h - b;
    if ((top && !(mask & N)) || (bottom && !(mask & S)) || (left && !(mask & W)) || (right && !(mask & E))) {
      if (round && b > 0 && ((top && left && !(mask & N) && !(mask & W) && x === 0 && y === 0) || (top && right && !(mask & N) && !(mask & E) && x === w - 1 && y === 0)
        || (bottom && left && !(mask & S) && !(mask & W) && x === 0 && y === h - 1) || (bottom && right && !(mask & S) && !(mask & E) && x === w - 1 && y === h - 1))) return '.';
      return edgeLetter;
    }
    const notch = (top && right && (mask & N) && (mask & E) && !(mask & NE)) || (bottom && right && (mask & S) && (mask & E) && !(mask & SE))
      || (bottom && left && (mask & S) && (mask & W) && !(mask & SW)) || (top && left && (mask & N) && (mask & W) && !(mask & NW));
    return notch ? edgeLetter : ch;
  }).join('')));
  return { w, h, palette, frames, animations: {} };
}
