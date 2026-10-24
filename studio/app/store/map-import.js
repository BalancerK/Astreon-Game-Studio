// Bringing in levels made elsewhere: Tiled (a .tmj or .json map) and LDtk (a .ldtk project). What comes in is what the studio's own painters understand: each layer of tiles
// (a Tiled tile layer, an LDtk IntGrid layer) becomes a level made of letters with a legend, in a small module the Level painter can open, and each group of objects (Tiled
// objects, LDtk entities) becomes a scene for the Scene panel, with their fields kept. Pictures (tile images, LDtk tile layers) are not brought in: only the layout is. Anything left out
// or cut to fit is said in `warnings`. Pure functions, tested in Node.
import { serializeScene } from '../paint/scene-model.js';

export const IMPORT_LIMITS = { columns: 300, rows: 100, things: 500, legend: 50, bytes: 8_000_000 };
const LETTERS = 'abcdefghijklmnpqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';          // no o (the coin), no @ (the hero), no . (nothing)
const COLORS = ['#3b4a6b', '#6b8e4e', '#8a5a3a', '#b9a24a', '#4a6b8e', '#8e4a6b', '#4a8e7a', '#7a4a8e', '#8e7a4a', '#5a5a6e'];
const KIND = /^[A-Za-z_][\w-]*$/;

const slug = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'level';

/** A word made safe to be a kind: letters, digits, _ and -, starting with a letter, 24 at most. */
export function kindName(raw, fallback = 'thing') {
  const s = String(raw ?? '').trim().replace(/[^\w-]+/g, '-').replace(/^[^A-Za-z_]+/, '').replace(/-+$/g, '').slice(0, 24);
  return KIND.test(s) ? s : fallback;
}

/**
 * Turn a grid of numbers (0 is empty) into rows of letters with a legend: the commonest value is `#`, the next ones letters, and so on.
 * @param {number[][]} grid
 * @param {{names?: Object<number, string>, colors?: Object<number, string>}} [o] what each value is called and coloured, if the source says
 * @returns {{rows: string[], legend: Object<string, {kind: string, color: string}>, cut: number}}
 */
export function lettersFor(grid, { names = {}, colors = {} } = {}) {
  const counts = new Map();
  for (const row of grid) for (const v of row) if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  const order = [...counts].sort((a, b) => b[1] - a[1] || a[0] - b[0]).map(([v]) => v);
  const letter = new Map();
  const legend = {};
  let cut = 0;
  order.forEach((v, i) => {
    if (i >= IMPORT_LIMITS.legend) { cut++; return; }
    const ch = i === 0 ? '#' : LETTERS[i - 1];
    letter.set(v, ch);
    legend[ch] = { kind: kindName(names[v], i === 0 ? 'wall' : `tile${v}`), color: colors[v] ?? COLORS[i % COLORS.length] };
  });
  const rows = grid.map((row) => row.map((v) => (v ? letter.get(v) ?? '#' : '.')).join(''));
  return { rows, legend, cut };
}

const safeValue = (v) => (typeof v === 'string' ? v.slice(0, 120) : typeof v === 'number' || typeof v === 'boolean' ? v : undefined);

// ---------- Tiled ----------

function decodeData(layer, warnings) {
  const d = layer.data;
  if (Array.isArray(d)) return d;
  if (typeof d === 'string' && (layer.encoding === 'csv' || !layer.encoding)) return d.split(',').map((n) => Number(n.trim()) || 0);
  if (typeof d === 'string' && layer.encoding === 'base64' && !layer.compression) {
    const bin = atob(d);
    const view = new DataView(Uint8Array.from(bin, (c) => c.charCodeAt(0)).buffer);
    return Array.from({ length: view.byteLength >> 2 }, (_, i) => view.getUint32(i * 4, true));
  }
  warnings.push(`The layer "${layer.name}" is stored compressed. In Tiled, choose CSV or uncompressed for "Tile layer format" and save again.`);
  return null;
}

function tiledProps(props) {
  const out = {};
  const list = Array.isArray(props) ? props.map((p) => [p.name, p.value]) : Object.entries(props ?? {});
  for (const [k, v] of list) if (KIND.test(String(k)) && safeValue(v) !== undefined) out[k] = safeValue(v);
  return out;
}

/** Read a Tiled map (JSON). */
export function parseTiled(map, name = 'map') {
  const warnings = [];
  if (map.orientation && map.orientation !== 'orthogonal') {
    warnings.push(`This map is ${map.orientation}; it is read as a plain grid, and the shapes will not look right.`);
  }
  const tile = Number(map.tilewidth) || 16;
  const levels = [];
  const things = [];
  const walk = (layers, prefix = '') => {
    for (const layer of layers ?? []) {
      if (layer.type === 'group') { walk(layer.layers, `${prefix}${layer.name}-`); continue; }
      if (layer.type === 'tilelayer') {
        let width = layer.width ?? map.width;
        let height = layer.height ?? map.height;
        let data = decodeData(layer, warnings);
        if (!data && Array.isArray(layer.chunks)) data = null;
        if (Array.isArray(layer.chunks) && layer.chunks.length) {
          const minX = Math.min(...layer.chunks.map((c) => c.x));
          const minY = Math.min(...layer.chunks.map((c) => c.y));
          width = Math.max(...layer.chunks.map((c) => c.x + c.width)) - minX;
          height = Math.max(...layer.chunks.map((c) => c.y + c.height)) - minY;
          data = new Array(width * height).fill(0);
          for (const c of layer.chunks) c.data.forEach((v,
            i) => { data[(c.y - minY + Math.floor(i / c.width)) * width + (c.x - minX + (i % c.width))] = v; });
          warnings.push(`The layer "${layer.name}" is an infinite map: the area its chunks cover was used.`);
        }
        if (!data || !width || !height) continue;
        const grid = [];
        for (let y = 0; y < height; y++) grid.push(Array.from({ length: width }, (_, x) => (data[y * width + x] ?? 0) & 0x1fffffff));
        if (grid[0].length > IMPORT_LIMITS.columns || grid.length > IMPORT_LIMITS.rows) {
          warnings.push(`The layer "${layer.name}" is bigger than ${IMPORT_LIMITS.columns} by ${IMPORT_LIMITS.rows} tiles: the top left was kept.`);
        }
        const clipped = grid.slice(0, IMPORT_LIMITS.rows).map((r) => r.slice(0, IMPORT_LIMITS.columns));
        if (!clipped.some((r) => r.some(Boolean))) { warnings.push(`The layer "${layer.name}" has no tiles, so it was left out.`); continue; }
        const made = lettersFor(clipped);
        if (made.cut) {
          warnings.push(`The layer "${layer.name}" uses more than ${IMPORT_LIMITS.legend} kinds of tile: ${made.cut} of the rarest became "#".`);
        }
        levels.push({ name: `${prefix}${layer.name}`, tile, columns: clipped[0].length, rows: made.rows, legend: made.legend });
      } else if (layer.type === 'objectgroup') {
        for (const o of layer.objects ?? []) {
          if (things.length >= IMPORT_LIMITS.things) { warnings.push(`Only the first ${IMPORT_LIMITS.things} objects were kept.`); return; }
          const w = o.width > 0 ? o.width : tile;
          const h = o.height > 0 ? o.height : tile;
          const kind = kindName(o.type || o.class || o.name, 'object');
          const thing = { kind, x: Math.round(o.x), y: Math.round(o.gid ? o.y - h : o.y), w: Math.round(w), h: Math.round(h) };
          const extra = { ...tiledProps(o.properties), ...(o.name && o.name !== kind ? { name: String(o.name).slice(0, 60) } : {}) };
          if (Object.keys(extra).length) thing.extra = extra;
          things.push(thing);
        }
      } else if (layer.type === 'imagelayer') warnings.push(`The picture layer "${layer.name}" was left out: only the layout comes in.`);
    }
  };
  walk(map.layers);
  const width = (map.width ?? 0) * tile || 480;
  const height = (map.height ?? 0) * tile || 320;
  return { source: 'tiled', name, levels, scene: things.length ? { w: Math.max(64, Math.round(width)), h: Math.max(64, Math.round(height)),
    things } : null, warnings };
}

// ---------- LDtk ----------

/** Read an LDtk project (JSON). Each level becomes levels (one for each IntGrid layer) and a scene (its entities). */
export function parseLdtk(project, name = 'project') {
  const warnings = [];
  const levelList = project.levels?.length ? project.levels : (project.worlds ?? []).flatMap((w) => w.levels ?? []);
  const defs = new Map((project.defs?.layers ?? []).map((l) => [l.uid, l]));
  const results = [];
  for (const level of levelList) {
    const layers = level.layerInstances;
    if (!layers) {
      warnings.push(`The level "${level.identifier}" is saved in a separate file; save the project with "Save levels to separate files" off, `
        + 'or import that file.');
      continue;
    }
    const levels = [];
    const things = [];
    const tile = layers.find((l) => l.__type === 'IntGrid')?.__gridSize ?? layers[0]?.__gridSize ?? 16;
    for (const layer of [...layers].reverse()) {
      if (layer.__type === 'IntGrid') {
        const w = layer.__cWid;
        const h = layer.__cHei;
        const csv = layer.intGridCsv ?? [];
        const grid = Array.from({ length: Math.min(h, IMPORT_LIMITS.rows) }, (_, y) => Array.from({ length: Math.min(w, IMPORT_LIMITS.columns) },
          (_, x) => csv[y * w + x] ?? 0));
        if (w > IMPORT_LIMITS.columns || h > IMPORT_LIMITS.rows) {
          warnings.push(`The layer "${layer.__identifier}" of "${level.identifier}" is bigger than ${IMPORT_LIMITS.columns} by `
            + `${IMPORT_LIMITS.rows}: the top left was kept.`);
        }
        if (!grid.some((r) => r.some(Boolean))) continue;
        const values = defs.get(layer.layerDefUid)?.intGridValues ?? [];
        const names = Object.fromEntries(values.filter((v) => v.identifier).map((v) => [v.value, String(v.identifier).toLowerCase()]));
        const colors = Object.fromEntries(values.filter((v) => /^#[0-9a-f]{6}$/i.test(v.color ?? '')).map((v) => [v.value, v.color]));
        const made = lettersFor(grid, { names, colors });
        if (made.cut) {
          warnings.push(`The layer "${layer.__identifier}" uses more than ${IMPORT_LIMITS.legend} kinds of tile: `
            + `${made.cut} of the rarest became "#".`);
        }
        levels.push({ name: `${level.identifier}-${layer.__identifier}`, tile: layer.__gridSize ?? tile, columns: grid[0].length, rows: made.rows,
          legend: made.legend });
      } else if (layer.__type === 'Entities') {
        for (const e of layer.entityInstances ?? []) {
          if (things.length >= IMPORT_LIMITS.things) {
            warnings.push(`Only the first ${IMPORT_LIMITS.things} entities of "${level.identifier}" were kept.`);
            break;
          }
          const pivot = e.__pivot ?? [0, 0];
          const thing = { kind: kindName(e.__identifier, 'entity'), x: Math.round(e.px[0] - e.width * pivot[0]),
            y: Math.round(e.px[1] - e.height * pivot[1]), w: Math.max(1, Math.round(e.width)), h: Math.max(1, Math.round(e.height)) };
          if (/^#[0-9a-f]{6}$/i.test(e.__smartColor ?? '')) thing.color = e.__smartColor;
          const extra = {};
          for (const f of e.fieldInstances ?? []) {
            if (KIND.test(String(f.__identifier)) && safeValue(f.__value) !== undefined) extra[f.__identifier] = safeValue(f.__value);
          }
          if (Object.keys(extra).length) thing.extra = extra;
          things.push(thing);
        }
      } else {
        warnings.push(`The ${layer.__type} layer "${layer.__identifier}" of "${level.identifier}" was left out: `
          + 'only IntGrid layers and entities come in.');
      }
    }
    results.push({ name: level.identifier, levels, scene: things.length ? { w: Math.max(64, level.pxWid), h: Math.max(64, level.pxHei),
      things } : null });
  }
  return { source: 'ldtk', name, results, warnings: [...new Set(warnings)] };
}

// ---------- reading a file ----------

/**
 * Read a Tiled or LDtk file and say what it holds, in the studio's own forms.
 * @param {string} text the file's contents
 * @param {string} [fileName]
 * @returns {{source: 'tiled' | 'ldtk', parts: {name: string, levels: {name: string, tile: number, columns: number, rows: string[], legend: object}[], scene: object | null}[], warnings: string[]}}
 */
export function importMap(text, fileName = 'map') {
  if (String(text).length > IMPORT_LIMITS.bytes) throw new Error('This file is too big to import (over 8 MB).');
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('This is not a Tiled or LDtk file: it is not JSON. In Tiled, save as JSON (.tmj); LDtk projects are .ldtk.');
  }
  const name = slug(String(fileName).replace(/\.[^.]*$/, ''));
  if (data && (data.__header__ || data.jsonVersion || data.defs?.layers)) {
    const r = parseLdtk(data, name);
    if (!r.results.length) throw new Error('This LDtk project has no levels the studio can read.');
    return { source: 'ldtk', parts: r.results, warnings: r.warnings };
  }
  if (data && Array.isArray(data.layers) && (data.tilewidth || data.tileheight)) {
    const r = parseTiled(data, name);
    if (!r.levels.length && !r.scene) throw new Error('This Tiled map has no tile layers or objects the studio can read.');
    return { source: 'tiled', parts: [{ name, levels: r.levels, scene: r.scene }], warnings: r.warnings };
  }
  throw new Error('This does not look like a Tiled map or an LDtk project.');
}

// ---------- the files to write ----------

/** The text of a level module: the rows, and a function that loads them with their legend (the form the Level painter opens). */
export function levelModule(level, source = 'another editor') {
  const legend = Object.entries(level.legend).map(([ch,
    e]) => `    ${JSON.stringify(ch).replace(/"/g, "'")}: { kind: '${e.kind}', color: '${e.color}' },`).join('\n');
  const rows = level.rows.map((r) => `  '${r}',`).join('\n');
  return `// Level "${level.name}", imported from ${source} by the studio. Open it in the Level painter.
// The letters are the tiles, and the legend says what each one is.
import { loadMap } from '@engine/arcade';

export const TILE = ${level.tile};
export const LEVEL = [
${rows}
];

/** Make the level's tiles in the game and say how big it is (give the size to the camera). */
export function loadLevel(game) {
  return loadMap(game, LEVEL, {
${legend}
  }, TILE);
}
`;
}

/** The files an import would write: `{ path: text }`, with names that are free of the names in `taken`. */
export function filesFor(imported, taken = new Set()) {
  const files = {};
  const free = (base, ext, dir) => {
    let n = 1;
    let path = `${dir}/${base}.${ext}`;
    while (taken.has(path) || path in files) path = `${dir}/${base}-${++n}.${ext}`;
    return path;
  };
  for (const part of imported.parts) {
    const base = slug(part.name);
    part.levels.forEach((level, i) => {
      const path = free(part.levels.length > 1 || imported.parts.length > 1 ? slug(level.name) : base, 'js', 'src/levels');
      files[path] = levelModule(level, imported.source === 'tiled' ? 'Tiled' : 'LDtk');
      level.path = path;
      void i;
    });
    if (part.scene) { const path = free(base, 'js', 'scenes'); files[path] = serializeScene(part.scene,
      `Objects imported from ${imported.source === 'tiled' ? 'Tiled' : 'LDtk'} by the studio. Load them with loadScene(game, scene).`);
      part.scenePath = path;
    }
  }
  return files;
}
