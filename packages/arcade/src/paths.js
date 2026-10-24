// Finding the way round walls. `navGrid` turns the things of a kind that block (the walls of a level) into a grid of open and blocked squares; `route` finds the shortest way across
// it from one place to another, a step at a time. The "Go to" behaviour uses them, and a game can too. It has no state of its own: the grid is made again from the things
// each frame, so a wall that is broken or built opens or closes the way at once, and rewinding in the Time Machine just works.
import { all } from './things.js';

const SCREEN = { width: 480, height: 320 };

/**
 * @typedef {{columns: number, rows: number, tile: number, blocked: Uint8Array}} NavGrid
 */

/**
 * Make the grid of a game: every square that a thing of a blocking kind covers is blocked. It follows the level that `loadMap` made (its size and its tile size); without one it
 * covers the 480 by 320 screen in squares of `tile` pixels.
 * @param {{things: import('./things.js').Thing[], mapInfo?: {columns: number, rows: number, tile: number}}} game
 * @param {string} [solid] the kind of thing that blocks the way
 * @param {number} [tile] the size of a square, when there is no level
 * @returns {NavGrid}
 */
export function navGrid(game, solid = 'wall', tile = 32) {
  const info = game.mapInfo;
  const size = info?.tile ?? Math.max(4, tile);
  const columns = info?.columns ?? Math.ceil(SCREEN.width / size);
  const rows = info?.rows ?? Math.ceil(SCREEN.height / size);
  const blocked = new Uint8Array(columns * rows);
  for (const t of all(game, solid)) {
    const x0 = Math.max(0, Math.floor(t.x / size));
    const y0 = Math.max(0, Math.floor(t.y / size));
    const x1 = Math.min(columns - 1, Math.floor((t.x + t.w - 0.001) / size));
    const y1 = Math.min(rows - 1, Math.floor((t.y + t.h - 0.001) / size));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) blocked[y * columns + x] = 1;
  }
  return { columns, rows, tile: size, blocked };
}

/** Is the square at this pixel place blocked (or off the grid)? */
export function isBlocked(grid, x, y) {
  const c = Math.floor(x / grid.tile);
  const r = Math.floor(y / grid.tile);
  return c < 0 || r < 0 || c >= grid.columns || r >= grid.rows || grid.blocked[r * grid.columns + c] === 1;
}

const STEPS = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [-1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, -1, Math.SQRT2]];

/**
 * Find the shortest way from one place to another across a grid, moving to the next square, up, down, left, right or across (not round the corner of a wall). The way is a list of
 * the middles of the squares to walk through, not counting the one it starts in. If the end is blocked or cannot be reached, the way leads to the nearest square it could get to.
 * @param {NavGrid} grid
 * @param {{x: number, y: number}} from a place in pixels
 * @param {{x: number, y: number}} to a place in pixels
 * @param {number} [maxSearch] the most squares it will look at before giving up and using the best it has
 * @returns {{x: number, y: number}[]}
 */
export function route(grid, from, to, maxSearch = 4000) {
  const { columns, rows, tile, blocked } = grid;
  const cell = (p) => [Math.max(0, Math.min(columns - 1, Math.floor(p.x / tile))), Math.max(0, Math.min(rows - 1, Math.floor(p.y / tile)))];
  const [sc, sr] = cell(from);
  const [gc, gr] = cell(to);
  const start = sr * columns + sc;
  const goal = gr * columns + gc;
  if (start === goal) return [];
  const heuristic = (i) => {
    const dx = Math.abs((i % columns) - gc);
    const dy = Math.abs(Math.floor(i / columns) - gr);
    return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
  };
  const cost = new Map([[start, 0]]);
  const from_ = new Map();
  const open = [[heuristic(start), start]];
  const closed = new Set();
  let best = start;
  let searched = 0;
  const pop = () => {                                                       // the open square with the lowest estimate (a small list, so a scan is enough)
    let at = 0;
    for (let i = 1; i < open.length; i++) if (open[i][0] < open[at][0] || (open[i][0] === open[at][0] && open[i][1] < open[at][1])) at = i;
    return open.splice(at, 1)[0][1];
  };
  while (open.length && searched < maxSearch) {
    const here = pop();
    if (closed.has(here)) continue;
    closed.add(here);
    searched++;
    if (here === goal) { best = goal; break; }
    if (heuristic(here) < heuristic(best)) best = here;
    const c = here % columns;
    const r = Math.floor(here / columns);
    for (const [dx, dy, step] of STEPS) {
      const nc = c + dx;
      const nr = r + dy;
      if (nc < 0 || nr < 0 || nc >= columns || nr >= rows) continue;
      const next = nr * columns + nc;
      if (blocked[next] || closed.has(next)) continue;
      if (dx !== 0 && dy !== 0 && (blocked[r * columns + nc] || blocked[nr * columns + c])) continue;       // no cutting the corner of a wall
      const total = cost.get(here) + step;
      if (total < (cost.get(next) ?? Infinity)) {
        cost.set(next, total);
        from_.set(next, here);
        open.push([total + heuristic(next), next]);
      }
    }
  }
  const way = [];
  for (let i = best; i !== start; i = from_.get(i)) way.push({ x: (i % columns) * tile + tile / 2, y: Math.floor(i / columns) * tile + tile / 2 });
  return way.reverse();
}
