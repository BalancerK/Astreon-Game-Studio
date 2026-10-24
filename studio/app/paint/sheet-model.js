// Sprite sheets: one picture that holds many frames in a grid. This cuts a picture into cells, finds the empty ones, guesses a sensible cell size, and turns the
// cells into a pixel sprite for the Sprite painter (every colour becomes a letter of a palette, so it can be painted over and animated). Pure functions on
// RGBA pixels (`Uint8ClampedArray`, 4 numbers a pixel, as a canvas gives them): no page needed, tested in Node.
import { LETTERS, MAX_SIZE, problemWith } from './sprite-model.js';

export const SHEET_LIMITS = { frames: 256, colors: LETTERS.length };

/**
 * The cells of a grid laid over a picture.
 * @param {number} w picture width
 * @param {number} h picture height
 * @param {{cw: number, ch: number, margin?: number, spacing?: number}} o the size of one cell, the border round the whole sheet, the gap between cells
 * @returns {{cols: number, rows: number, cells: {index: number, col: number, row: number, x: number, y: number, w: number, h: number}[], leftover: {x: number, y: number}}}
 */
export function gridOf(w, h, { cw, ch, margin = 0, spacing = 0 }) {
  const cell = (n) => Math.max(1, Math.floor(n) || 1);
  cw = cell(cw);
  ch = cell(ch);
  margin = Math.max(0, Math.floor(margin) || 0);
  spacing = Math.max(0, Math.floor(spacing) || 0);
  const cols = Math.max(0, Math.floor((w - 2 * margin + spacing) / (cw + spacing)));
  const rows = Math.max(0, Math.floor((h - 2 * margin + spacing) / (ch + spacing)));
  const cells = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      cells.push({ index: row * cols + col, col, row, x: margin + col * (cw + spacing), y: margin + row * (ch + spacing), w: cw, h: ch });
    }
  }
  return {
    cols, rows, cells,
    leftover: {
      x: Math.max(0, w - 2 * margin - cols * cw - Math.max(0, cols - 1) * spacing),
      y: Math.max(0, h - 2 * margin - rows * ch - Math.max(0, rows - 1) * spacing),
    },
  };
}

const COMMON = [8, 12, 16, 24, 32, 48, 64, 96, 128];

/** A cell size that probably matches how the sheet was made: a strip of squares, or a common size that divides the picture evenly. */
export function guessCell(w, h) {
  if (w > h && w % h === 0 && h <= MAX_SIZE && w / h <= SHEET_LIMITS.frames) return { cw: h, ch: h };
  if (h > w && h % w === 0 && w <= MAX_SIZE && h / w <= SHEET_LIMITS.frames) return { cw: w, ch: w };
  const fits = COMMON.filter((n) => w % n === 0 && h % n === 0 && (w / n) * (h / n) >= 2 && (w / n) * (h / n) <= SHEET_LIMITS.frames);
  if (fits.length) return { cw: fits[fits.length - 1], ch: fits[fits.length - 1] };
  const side = (n) => Math.min(MAX_SIZE, Math.max(1, n));
  return { cw: side(w), ch: side(h) };
}

/** Which cells have nothing in them (every pixel see-through)? @returns {Set<number>} cell indexes */
export function emptyCells(rgba, w, grid) {
  const empty = new Set();
  for (const c of grid.cells) {
    let any = false;
    for (let y = c.y; y < c.y + c.h && !any; y++) {
      for (let x = c.x; x < c.x + c.w; x++) { if (rgba[(y * w + x) * 4 + 3] >= 128) { any = true; break; } }
    }
    if (!any) empty.add(c.index);
  }
  return empty;
}

const hex = (r, g, b) => `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;

/**
 * Turn cells of a picture into a pixel sprite.
 * @param {Uint8ClampedArray | Uint8Array} rgba the whole picture
 * @param {number} w picture width
 * @param {ReturnType<typeof gridOf>} grid
 * @param {{skipEmpty?: boolean, rowAnimations?: boolean, fps?: number}} [o] `skipEmpty` leaves out cells with nothing in them; `rowAnimations` makes one animation of each row
 * @returns {{sprite: object, colors: number, reduced: boolean, skipped: number} | {error: string}}
 */
export function spriteFromSheet(rgba, w, grid, { skipEmpty = true, rowAnimations = true, fps = 8 } = {}) {
  if (!grid.cells.length) return { error: 'The grid has no cells: the cell size is bigger than the picture.' };
  const { w: cw, h: ch } = grid.cells[0];
  if (cw > MAX_SIZE || ch > MAX_SIZE) {
    return {
      error: `A sprite can be at most ${MAX_SIZE} pixels on a side, and a cell is ${cw} × ${ch}. Use a smaller cell, or keep this as a picture.`,
    };
  }
  const empty = skipEmpty ? emptyCells(rgba, w, grid) : new Set();
  const keep = grid.cells.filter((c) => !empty.has(c.index));
  if (!keep.length) return { error: 'Every cell is empty (see-through).' };
  if (keep.length > SHEET_LIMITS.frames) return { error: `A sprite can have at most ${SHEET_LIMITS.frames} frames, and this has ${keep.length}.` };
  // the colours in use, reduced (fewer bits a channel) until they fit the palette
  const used = (shift) => {
    const seen = new Set();
    for (const c of keep) {
      for (let y = c.y; y < c.y + c.h; y++) {
        for (let x = c.x; x < c.x + c.w; x++) {
          const i = (y * w + x) * 4;
          if (rgba[i + 3] >= 128) seen.add(((rgba[i] >> shift) << 16) | ((rgba[i + 1] >> shift) << 8) | (rgba[i + 2] >> shift));
        }
      }
    }
    return seen;
  };
  let shift = 0;
  let seen = used(0);
  const exact = seen.size;
  while (seen.size > SHEET_LIMITS.colors && shift < 7) seen = used(++shift);
  const key = (r, g, b) => ((r >> shift) << 16) | ((g >> shift) << 8) | (b >> shift);
  const letterOf = new Map();
  const palette = {};
  for (const k of [...seen].sort((a, b) => a - b)) {
    const letter = LETTERS[letterOf.size];
    letterOf.set(k, letter);
    // the middle of the bucket, so a reduced colour is not always darker than it was
    const mid = shift ? (1 << shift) >> 1 : 0;
    const part = (n) => Math.min(255, ((n >> 0) << shift) + mid);
    palette[letter] = hex(part((k >> 16) & 255), part((k >> 8) & 255), part(k & 255));
  }
  const frames = keep.map((c) => {
    const rows = [];
    for (let y = c.y; y < c.y + c.h; y++) {
      let row = '';
      for (let x = c.x; x < c.x + c.w; x++) {
        const i = (y * w + x) * 4;
        row += rgba[i + 3] >= 128 ? letterOf.get(key(rgba[i], rgba[i + 1], rgba[i + 2])) : '.';
      }
      rows.push(row);
    }
    return rows;
  });
  const animations = {};
  if (rowAnimations && grid.rows > 1) {
    for (let r = 0; r < grid.rows; r++) {
      const ids = keep.map((c, n) => [c, n]).filter(([c]) => c.row === r).map(([, n]) => n);
      if (ids.length > 1) animations[`row${r + 1}`] = { frames: ids, fps };
    }
  }
  const sprite = { w: cw, h: ch, palette, frames, animations };
  const problem = problemWith(sprite);
  if (problem) return { error: `The sprite could not be made: ${problem}.` };
  return { sprite, colors: letterOf.size, reduced: shift > 0 && exact > SHEET_LIMITS.colors, skipped: grid.cells.length - keep.length };
}

/** The code that draws a frame of a sheet kept as a picture, for the dialog to show. */
export function sheetCode(path, grid, frame = 0) {
  const one = grid.rows <= 1 ? `frames: ${grid.cols}, frame: ${frame}` : `cols: ${grid.cols}, rows: ${grid.rows}, frame: ${frame}`;
  return `drawImage(g, '${path}', x, y, ${grid.cells[0]?.w ?? 32}, ${grid.cells[0]?.h ?? 32}, { ${one} });\n`
    + `// or on a thing:  { image: '${path}', ${one.replace(`frame: ${frame}`, 'frame: 0')} }   (change its frame to animate it)`;
}
