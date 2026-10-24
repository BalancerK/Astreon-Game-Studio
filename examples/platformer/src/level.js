// A level is a picture made of characters, one per 16-pixel tile:
//   #  solid ground      ^  spikes       S  spring      o  coin       E  walking enemy      @  where you start      G  the goal flag      .  nothing
// `loadLevel` turns the rows into what the game needs: rectangles to collide with (neighbouring ground tiles are merged, so nothing snags on the
// seams between them), and lists of everything else.

export const TILE = 16;

/** Check a level file and read it. @param {{name: string, rows: string[], par?: number}} data */
export function loadLevel(data) {
  const rows = data?.rows;
  if (!Array.isArray(rows) || rows.length < 4) throw new Error('a level needs a list of rows of tiles');
  const h = rows.length, w = rows[0].length;
  rows.forEach((r, i) => {
    if (typeof r !== 'string' || r.length !== w) throw new Error(`row ${i + 1} is ${r?.length} tiles wide, the first is ${w}`);
  });
  const level = {
    name: data.name ?? 'Untitled', par: data.par ?? 60, w, h, rows,
    start: null, goal: null, spikes: [], springs: [], coins: [], enemies: [],
  };
  const solid = Array.from({ length: h }, () => new Uint8Array(w));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = rows[y][x], cx = x * TILE + TILE / 2, cy = y * TILE + TILE / 2;
      switch (c) {
        case '#': solid[y][x] = 1; break;
        case '^': level.spikes.push({ x: cx, y: cy + 4, hw: 6, hh: 4 }); break;           // only the pointy half hurts
        case 'S': level.springs.push({ x: cx, y: cy + 4, hw: 7, hh: 4 }); break;
        case 'o': level.coins.push({ x: cx, y: cy }); break;
        case 'E': level.enemies.push({ x: cx, y: cy + 2, hw: 6, hh: 6 }); break;
        case '@': if (level.start) throw new Error('two start tiles'); level.start = { x: cx, y: cy }; break;
        case 'G': if (level.goal) throw new Error('two goals'); level.goal = { x: cx, y: cy, hw: 6, hh: 8 }; break;
        case '.': case ' ': break;
        default: throw new Error(`unknown tile "${c}" at column ${x + 1}, row ${y + 1}`);
      }
    }
  }
  if (!level.start) throw new Error('a level needs a start (@)');
  if (!level.goal) throw new Error('a level needs a goal (G)');
  level.solid = solid;
  level.rects = mergeTiles(solid, w, h);
  return level;
}

/** Is the tile at this pixel solid? Outside the level sideways counts as solid (walls), above and below does not. */
export function solidAt(level, px, py) {
  const x = Math.floor(px / TILE), y = Math.floor(py / TILE);
  if (x < 0 || x >= level.w) return true;
  if (y < 0 || y >= level.h) return false;
  return level.solid[y][x] === 1;
}

/** Merge runs of ground tiles into as few rectangles as possible: a row of tiles becomes one box, and equal runs on top of each other join. */
function mergeTiles(solid, w, h) {
  const used = Array.from({ length: h }, () => new Uint8Array(w)), rects = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!solid[y][x] || used[y][x]) continue;
      let x2 = x; while (x2 + 1 < w && solid[y][x2 + 1] && !used[y][x2 + 1]) x2++;
      let y2 = y;
      for (;;) { // grow downwards while the whole run continues
        if (y2 + 1 >= h) break;
        let full = true; for (let i = x; i <= x2; i++) if (!solid[y2 + 1][i] || used[y2 + 1][i]) { full = false; break; }
        if (!full) break;
        y2++;
      }
      for (let j = y; j <= y2; j++) for (let i = x; i <= x2; i++) used[j][i] = 1;
      rects.push({ x: ((x + x2 + 1) / 2) * TILE, y: ((y + y2 + 1) / 2) * TILE, hw: ((x2 - x + 1) / 2) * TILE, hh: ((y2 - y + 1) / 2) * TILE });
    }
  }
  return rects;
}
