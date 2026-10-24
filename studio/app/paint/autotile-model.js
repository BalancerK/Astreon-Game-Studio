// Auto-tiling in the level painter: reading and changing the auto-tile settings of a tile in the legend that is in the game's code (`loadMap(game, LEVEL, { '#': { kind: 'wall',
// color: '#345', autotile: 'blob47' } })`), and making the picture for a terrain. The legend stays code a person can read: only the settings of the one tile are changed, and
// nothing else in the file is touched. What auto-tiling is, and how a tile finds its neighbours, is the kit's own (`autotile.js`), so the painter and the game agree.
import { AUTOTILE_MODES, masksFor, frameFor, makeAutotileSprite, shapesOf, drawAutoTile } from '../../../packages/arcade/src/autotile.js';
import { serializeSprite } from './sprite-model.js';

export { AUTOTILE_MODES, masksFor, frameFor, makeAutotileSprite, shapesOf, drawAutoTile };

const KEY = /^[A-Za-z_$][\w$]*$/;

/** Find the legend entry of a letter in a file: where its `{ ... }` is, and the text inside. Returns null when the file has no such entry. */
export function locateEntry(text, ch) {
  const call = /loadMap\(\s*\w+\s*,\s*[\w.]+\s*,\s*\{/.exec(text ?? '');
  if (!call) return null;
  const start = call.index + call[0].length - 1;
  let depth = 0;
  let end = -1;
  for (let i = start; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}' && --depth === 0) { end = i; break; }
  }
  if (end < 0) return null;
  const body = text.slice(start + 1, end);
  for (const m of body.matchAll(/(?:'([^'])'|"([^"])"|([A-Za-z0-9]))\s*:\s*\{([^}]*)\}/g)) {
    if ((m[1] ?? m[2] ?? m[3]) !== ch) continue;
    const open = start + 1 + m.index + m[0].indexOf('{', m[0].indexOf(':'));
    return { from: open + 1, to: open + 1 + m[4].length, inner: m[4] };
  }
  return null;
}

const literal = (v) => (typeof v === 'string' ? `'${v.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'` : String(v));

/**
 * Change settings of one tile in the legend: a key set to a value is added or changed, a key set to `undefined` is taken out. Everything else in the file stays as it was.
 * @param {string} text the file
 * @param {string} ch the tile's letter
 * @param {Object<string, string | number | boolean | undefined>} patch
 * @returns {string} the new file
 */
export function setLegendProps(text, ch, patch) {
  const at = locateEntry(text, ch);
  if (!at) throw new Error(`The letter "${ch}" is not in the legend of this file.`);
  let inner = at.inner;
  for (const [key, value] of Object.entries(patch)) {
    if (!KEY.test(key)) throw new Error(`"${key}" is not a usable setting name.`);
    const pair = new RegExp(`(^|[,\\s])(${key}\\s*:\\s*)('(?:[^'\\\\]|\\\\.)*'|"(?:[^"\\\\]|\\\\.)*"|[^,}\\s][^,}]*)\\s*(,?)`);
    const found = pair.exec(inner);
    if (value === undefined) {
      if (found) {
        inner = inner.replace(pair, (all, lead, name, val, comma) => (comma && lead === ',' ? ',' : lead.trim() ? lead : ''));
        inner = inner.replace(/,\s*$/, ' ').replace(/^\s*,\s*/, ' ');
      }
    } else if (found) {
      inner = inner.replace(pair, (all, lead, name, val, comma) => `${lead}${name}${literal(value)}${comma}`);
    } else {
      const trimmed = inner.replace(/\s+$/, '');
      const gap = inner.slice(trimmed.length) || ' ';
      inner = `${trimmed}${trimmed.trim() && !trimmed.trim().endsWith(',') ? ',' : ''} ${key}: ${literal(value)}${gap}`;
    }
  }
  return `${text.slice(0, at.from)}${inner}${text.slice(at.to)}`;
}

/** What a legend entry says about auto-tiling (read by the painter). */
export function autotileOf(entry) {
  const mode = entry?.autotile in AUTOTILE_MODES ? entry.autotile : null;
  if (!mode) return null;
  const open = Boolean(entry.openEdge);
  return { mode, terrain: entry.terrain || entry.ch, edge: entry.edge || '', width: entry.edgeWidth || 0, open, sprite: entry.sprite || '' };
}

/** The terrain of every letter of a legend (null when it is not auto-tiled), for finding neighbours. */
export function terrainMap(legend) {
  const map = {};
  for (const e of legend) { const a = autotileOf(e); if (a) map[e.ch] = a.terrain; }
  return (ch) => map[ch] ?? null;
}

/** The neighbour masks of a level with this legend (null where a tile is not auto-tiled). */
export function levelMasks(rows, legend) {
  return masksFor(rows, terrainMap(legend), { outside: legend.some((e) => autotileOf(e)?.open) ? 'open' : 'solid' });
}

/** A name for the picture of a terrain: `wall` becomes `wallTiles`. */
export const tilesName = (kind) => `${String(kind || 'tile').replace(/[^A-Za-z0-9]/g, '') || 'tile'}Tiles`;

/**
 * Make the picture for a terrain: from a plain tile (the sprite the tile already uses) or, with none, from a solid block of its colour.
 * @param {{w: number, h: number, palette: object, frames: string[][]} | null} base the sprite the tile uses now, if it has one
 * @param {string} color the tile's colour (for a tile with no sprite)
 * @param {'edges4' | 'blob47'} mode
 * @param {{edge?: string, width?: number, size?: number}} [o]
 * @returns {{file: string, sprite: object}} the file's text and the sprite
 */
export function tilesFor(base, color, mode, { edge, width = 2, size = 16 } = {}) {
  const solid = /^#[0-9a-f]{3,8}$/i.test(color) ? color : '#556b8d';
  const plain = base ?? { w: size, h: size, palette: { a: solid }, frames: [Array(size).fill('a'.repeat(size))] };
  const sprite = makeAutotileSprite(plain, mode, { edge: edge || undefined, width });
  const note = `Auto-tile pictures (${mode}): one frame for each shape, made in the Level painter. Do not reorder the frames.`;
  return { file: serializeSprite(sprite, note), sprite };
}
