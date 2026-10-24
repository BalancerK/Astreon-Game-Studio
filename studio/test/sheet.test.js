import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gridOf, guessCell, emptyCells, spriteFromSheet, sheetCode, SHEET_LIMITS } from '../app/paint/sheet-model.js';
import { problemWith, parseSprite, serializeSprite } from '../app/paint/sprite-model.js';

/** A picture from text: each character is a pixel; '.' is see-through, other letters are colours from the key. */
function picture(rows, key) {
  const h = rows.length;
  const w = rows[0].length;
  const rgba = new Uint8ClampedArray(w * h * 4);
  rows.forEach((row, y) => [...row].forEach((ch, x) => {
    const i = (y * w + x) * 4;
    if (ch === '.') return;
    const [r, g, b] = key[ch];
    rgba.set([r, g, b, 255], i);
  }));
  return { rgba, w, h };
}
const KEY = { r: [255, 0, 0], g: [0, 255, 0], b: [0, 0, 255], w: [255, 255, 255] };

test('a grid of cells: how many fit, where each is, with a border round the sheet and a gap between cells', () => {
  const g = gridOf(64, 32, { cw: 16, ch: 16 });
  assert.deepEqual([g.cols, g.rows, g.cells.length], [4, 2, 8]);
  assert.deepEqual(g.cells[5], { index: 5, col: 1, row: 1, x: 16, y: 16, w: 16, h: 16 });
  const spaced = gridOf(70, 35, { cw: 16, ch: 16, margin: 2, spacing: 2 });
  assert.deepEqual([spaced.cols, spaced.rows], [3, 1]);
  assert.deepEqual([spaced.cells[1].x, spaced.cells[1].y], [20, 2]);
  assert.deepEqual(gridOf(50, 20, { cw: 16, ch: 16 }).leftover, { x: 2, y: 4 });
  assert.equal(gridOf(10, 10, { cw: 16, ch: 16 }).cells.length, 0, 'a cell bigger than the picture');
  assert.deepEqual(gridOf(8, 8, { cw: 0, ch: -3 }).cells.length, 64, 'nonsense sizes become 1');
});

test('guessing the cell: a strip of squares, a common size, or the whole picture', () => {
  assert.deepEqual(guessCell(128, 32), { cw: 32, ch: 32 });
  assert.deepEqual(guessCell(32, 96), { cw: 32, ch: 32 });
  assert.deepEqual(guessCell(128, 64), { cw: 64, ch: 64 }, 'two big cells, the largest common size that gives more than one');
  assert.deepEqual(guessCell(96, 48), { cw: 48, ch: 48 });
  assert.deepEqual(guessCell(30, 20), { cw: 30, ch: 20 });
  assert.deepEqual(guessCell(1000, 900), { cw: 128, ch: 128 }, 'never bigger than a sprite can be');
});

test('empty cells are found by their see-through pixels', () => {
  const p = picture(['rr..', 'rr..', '....', '..gg'], KEY);
  const grid = gridOf(p.w, p.h, { cw: 2, ch: 2 });
  assert.deepEqual([...emptyCells(p.rgba, p.w, grid)], [1, 2]);
});

test('cells become a sprite: letters for colours, a dot for see-through, one frame a cell, empty cells skipped, a row of cells an animation', () => {
  const p = picture(['rg..bb..', 'gr..bw..', '........', '........', 'wwrr....', 'wwrr....', '....gggg', '....gggg'], KEY);
  const out = spriteFromSheet(p.rgba, p.w, gridOf(p.w, p.h, { cw: 2, ch: 2 }));
  assert.equal(out.error, undefined);
  const s = out.sprite;
  assert.equal(problemWith(s), null);
  assert.deepEqual([s.w, s.h], [2, 2]);
  assert.equal(out.colors, 4);
  assert.equal(out.skipped, 10, 'empty cells are left out');
  assert.equal(s.frames.length, 6);
  const colour = (frame, x, y) => s.palette[s.frames[frame][y][x]];
  assert.equal(colour(0, 0, 0), '#ff0000');
  assert.equal(colour(0, 1, 0), '#00ff00');
  assert.equal(colour(1, 0, 0), '#0000ff');
  assert.equal(colour(1, 1, 1), '#ffffff');
  assert.equal(s.frames[0].join(''), s.frames[0].join('').replace(/\./g, '.'), 'letters only from the palette');
  // keeping the empty cells
  const all = spriteFromSheet(p.rgba, p.w, gridOf(p.w, p.h, { cw: 2, ch: 2 }), { skipEmpty: false });
  assert.equal(all.sprite.frames.length, 16);
  assert.equal(all.sprite.frames[1].join(''), '....');
  assert.deepEqual(Object.keys(all.sprite.animations), ['row1', 'row2', 'row3', 'row4']);
  assert.deepEqual(all.sprite.animations.row2, { frames: [4, 5, 6, 7], fps: 8 });
  const none = spriteFromSheet(p.rgba, p.w, gridOf(p.w, p.h, { cw: 2, ch: 2 }), { skipEmpty: false, rowAnimations: false });
  assert.deepEqual(none.sprite.animations, {});
  // and the file the painter reads and writes round-trips
  assert.deepEqual(parseSprite(serializeSprite(s)), s);
});

test('too many colours are merged into the palette size, and the sprite says so', () => {
  const w = 16;
  const h = 16;
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) rgba.set([(i * 7) % 256, (i * 13) % 256, (i * 29) % 256, 255], i * 4);   // 256 different colours
  const out = spriteFromSheet(rgba, w, gridOf(w, h, { cw: 16, ch: 16 }));
  assert.equal(out.error, undefined);
  assert.ok(out.colors <= SHEET_LIMITS.colors && out.reduced, `${out.colors} colours, reduced ${out.reduced}`);
  assert.equal(problemWith(out.sprite), null);
});

test('things that cannot be sprites say why', () => {
  const p = picture(['rr', 'rr'], KEY);
  assert.match(spriteFromSheet(p.rgba, p.w, gridOf(2, 2, { cw: 5, ch: 5 })).error, /no cells/);
  const blank = picture(['..', '..'], KEY);
  assert.match(spriteFromSheet(blank.rgba, blank.w, gridOf(2, 2, { cw: 1, ch: 1 })).error, /empty/);
  const big = new Uint8ClampedArray(200 * 200 * 4).fill(255);
  assert.match(spriteFromSheet(big, 200, gridOf(200, 200, { cw: 200, ch: 200 })).error, /at most 128/);
  const many = new Uint8ClampedArray(300 * 1 * 4).fill(255);
  assert.match(spriteFromSheet(many, 300, gridOf(300, 1, { cw: 1, ch: 1 })).error, /at most 256 frames/);
});

test('the code to draw a sheet kept as a picture: a strip or a grid', () => {
  assert.match(sheetCode('assets/a.png', gridOf(64, 16, { cw: 16, ch: 16 }), 2), /frames: 4, frame: 2/);
  assert.match(sheetCode('assets/a.png', gridOf(64, 32, { cw: 16, ch: 16 })), /cols: 4, rows: 2, frame: 0/);
});
