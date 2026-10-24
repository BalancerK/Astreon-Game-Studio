// Levels as pictures made of letters. A row of text is a row of tiles, and a legend says what each letter turns into:
//
//   loadMap(game, ['#######',
//                  '#@..o.#',
//                  '#######'], { '#': { kind: 'wall', color: '#3b4a6b' }, '@': { kind: 'hero' }, o: { kind: 'coin', emoji: '🪙' } });
import { spawn, all } from './things.js';
import { masksFor, masksFromGrid, frameFor, AUTOTILE_MODES } from './autotile.js';
import { cleanKinds, fieldDefaults } from './kinds.js';

/**
 * Fill the game with things from a picture made of letters.
 * @param {Object} game
 * @param {string[]} rows one string per row; all rows must be the same length. '.' and ' ' are empty.
 * @param {Object<string, {kind: string} & Object>} legend what each letter makes: `{ kind: 'wall', color: '#345' }`. Each thing is one tile big unless it says otherwise.
 * @param {number} [tile] the size of a tile in pixels
 * @returns {{columns: number, rows: number, width: number, height: number}} the size of the map (keep it: the camera needs it, see {@link follow})
 */
export function loadMap(game, rows, legend, tile = 32) {
  if (!Array.isArray(rows) || !rows.length) throw new Error('loadMap needs a list of rows, for example ["#..#", "####"]');
  const columns = rows[0].length;
  const terrainOf = (ch) => (legend[ch]?.autotile in AUTOTILE_MODES ? String(legend[ch].terrain ?? ch) : null);
  const openEdge = Object.values(legend).some((e) => e?.openEdge);
  const masks = masksFor(rows, terrainOf, { outside: openEdge ? 'open' : 'solid' });
  rows.forEach((row, y) => {
    if (typeof row !== 'string' || row.length !== columns) {
      throw new Error(`Row ${y + 1} is ${row?.length} characters long but the first row is ${columns}. Every row of the level must be the same length (look at the level you gave loadMap).`);
    }
    for (let x = 0; x < columns; x++) {
      const ch = row[x];
      if (ch === '.' || ch === ' ') continue;
      const { kind, ...props } = legend[ch] ?? {};
      if (!kind) throw new Error(`Unknown map symbol "${ch}" at row ${y + 1}, column ${x + 1}. Add it to the legend, like { "${ch}": { kind: 'wall' } }.`);
      const thing = spawn(game, kind, { x: x * tile, y: y * tile, w: tile, h: tile, ...props });
      if (masks[y][x] !== null) {                       // an auto-tiled tile: which neighbours are the same terrain, and so which picture it needs
        thing.mask = masks[y][x];
        thing.frame = frameFor(masks[y][x], props.autotile);
      }
    }
  });
  game.mapInfo = { columns, rows: rows.length, tile, openEdge };
  return { columns, rows: rows.length, width: columns * tile, height: rows.length * tile };
}

/**
 * Work out the shape of every auto-tiled tile again, after the game has added or removed some (breaking a block, growing a bridge). Call it once after the change.
 * @param {Object} game
 */
export function retile(game) {
  const info = game.mapInfo;
  if (!info) return;
  const grid = Array.from({ length: info.rows }, () => Array(info.columns).fill(null));
  const tiles = all(game).filter((t) => t.autotile in AUTOTILE_MODES);
  for (const t of tiles) {
    const x = Math.round(t.x / info.tile);
    const y = Math.round(t.y / info.tile);
    if (y >= 0 && y < info.rows && x >= 0 && x < info.columns) grid[y][x] = String(t.terrain ?? t.kind);
  }
  const masks = masksFromGrid(grid, { outside: info.openEdge ? 'open' : 'solid' });
  for (const t of tiles) {
    const m = masks[Math.round(t.y / info.tile)]?.[Math.round(t.x / info.tile)];
    if (m === null || m === undefined) continue;
    t.mask = m;
    t.frame = frameFor(m, t.autotile);
  }
}

/**
 * Fill the game with the things of a scene made in the studio's Scene panel (a file in `scenes/`): each thing is spawned where it was placed, with the size,
 * colour, picture and any extra fields it was given. Give it the kinds from the Kinds panel and every thing also gets the fields of its kind, the ones it was not given set
 * to their starting values (a pointer field starts with nothing; `refOf` finds the thing it points at).
 * @param {Object} game
 * @param {{w?: number, h?: number, things: ({kind: string} & Object)[]}} scene what the file holds (the default export of a file in `scenes/`)
 * @param {Object<string, object>} [kinds] what the Kinds panel made (the default export of `src/kinds.js`)
 * @returns {{width: number, height: number, things: import('./things.js').Thing[]}} the size of the scene (the camera needs it, see {@link follow}) and the things made, in order
 */
export function loadScene(game, scene, kinds) {
  if (!scene || !Array.isArray(scene.things)) throw new Error('loadScene needs a scene from the Scene panel (the default export of a file in scenes/)');
  const made = [];
  const clean = kinds ? cleanKinds(kinds) : null;
  scene.things.forEach((t, i) => {
    if (!t || typeof t.kind !== 'string' || !t.kind) throw new Error(`Thing ${i + 1} of the scene has no kind. Open the scene in the Scene panel and give it one.`);
    const { kind, extra, ...props } = t;
    made.push(spawn(game, kind, { ...props, ...(clean ? fieldDefaults(clean, kind) : {}), ...(extra && typeof extra === 'object' ? extra : {}) }));
  });
  return { width: scene.w ?? 480, height: scene.h ?? 320, things: made };
}
