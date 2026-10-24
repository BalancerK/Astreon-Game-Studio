import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Atlas, SpriteBatch, Font, computeSdf, INSTANCE_WORDS, META_SDF, packTint } from '../src/index.js';

// instance data is stored as float32
const near = (a, b, msg) => assert.ok(Math.abs(a - b) <= Math.abs(b) * 1e-6 + 1e-6, `${msg}: ${a} vs ${b}`);
const frac = (v) => { const f = Math.abs(v % 1); return Math.min(f, 1 - f); };

function rng(seed) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }

/** A canvas stand-in per page, so tests can see which page was drawn into. */
function pagedAtlas(size, maxPages) {
  const canvases = [];
  const atlas = new Atlas({
    size, maxPages,
    createCanvas: () => {
      const draws = [];
      const ctx = { save() {}, restore() {}, beginPath() {}, clip() {}, rect() {}, draws };
      const canvas = { getContext: () => ctx, ctx };
      canvases.push(canvas);
      return canvas;
    },
  });
  return { atlas, canvases };
}

test('atlas starts a new page when one fills up, up to maxPages, and tracks versions per page', () => {
  const { atlas, canvases } = pagedAtlas(32, 3);
  assert.equal(atlas.pages.length, 1);
  const placed = [];
  for (let i = 0; i < 4; i++) placed.push(atlas.add(`s${i}`, 14, 14, (ctx, x, y) => ctx.draws.push([x, y]))); // two fit per row, two rows per page: 4 per page
  assert.deepEqual(placed.map((p) => p.page), [0, 0, 0, 0]);
  assert.equal(atlas.pages.length, 1);
  const fifth = atlas.add('s4', 14, 14, (ctx) => ctx.draws.push('fifth'));
  assert.equal(fifth.page, 1, 'the fifth sprite opened page 1');
  assert.equal(atlas.pages.length, 2);
  assert.ok(canvases[1].ctx.draws.includes('fifth'), 'and was drawn into that page\'s own canvas');
  assert.ok(!canvases[0].ctx.draws.includes('fifth'));
  assert.equal(atlas.canvas, canvases[0], 'canvas still means page 0');
  assert.deepEqual(atlas.pages.map((p) => p.version), [4, 1], 'each page counts only its own changes');
  assert.equal(atlas.version, 5);
  assert.deepEqual([fifth.u0, fifth.v0, fifth.u1, fifth.v1], [1 / 32, 1 / 32, 15 / 32, 15 / 32], 'coordinates are within the page');
  for (let i = 5; i < 12; i++) atlas.add(`s${i}`, 14, 14, () => {});
  assert.equal(atlas.pages.length, 3);
  assert.throws(() => atlas.add('overflow', 14, 14, () => {}), /atlas full.*3 page/, 'maxPages is a hard limit');
  assert.throws(() => atlas.add('too-big', 40, 40, () => {}), /atlas full/, 'a sprite larger than a page can never fit');
  assert.equal(atlas.pages.length, 3, 'and does not waste a page trying');
  assert.throws(() => new Atlas({ maxPages: 0, createCanvas: () => ({ getContext: () => ({}) }) }), /maxPages/);
});

test('instances carry their page and the sdf flag in the meta word; the old words are untouched', () => {
  assert.equal(INSTANCE_WORDS, 11);
  const b = new SpriteBatch(2);
  const plain = { u0: 0, v0: 0, u1: 1, v1: 1, page: 0 }, onPage3 = { u0: 0.25, v0: 0.5, u1: 0.5, v1: 0.75, page: 3 }, glyph = { u0: 0, v0: 0, u1: 1, v1: 1, page: 2, sdf: true };
  b.push(1, 2, 3, 4, 0.5, plain, packTint(1, 2, 3, 4));
  b.push(5, 6, 7, 8, 0, onPage3);
  b.push(9, 9, 9, 9, 0, glyph);
  b.push(0, 0, 1, 1, 0, { u0: 0, v0: 0, u1: 1, v1: 1 }); // a sprite object without a page (older code) is page 0
  assert.deepEqual([0, 1, 2, 3].map((i) => b.u32[i * INSTANCE_WORDS + 10]), [0, 3, 2 | META_SDF, 0]);
  assert.equal(META_SDF, 256, 'the flag lives above the 8 page bits');
  assert.deepEqual([...b.f32.subarray(INSTANCE_WORDS, INSTANCE_WORDS + 9)], [5, 6, 7, 8, 0, 0.25, 0.5, 0.5, 0.75]);
  // sorting moves the meta word with its sprite
  const c = new SpriteBatch(2);
  c.push(1, 0, 1, 1, 0, onPage3, 0xffffffff, 5);
  c.push(2, 0, 1, 1, 0, glyph, 0xffffffff, 1);
  c.sort();
  assert.deepEqual([c.f32[0], c.u32[10], c.f32[INSTANCE_WORDS], c.u32[INSTANCE_WORDS + 10]], [2, 2 | META_SDF, 1, 3]);
});

/** Brute-force signed distance for comparison. */
function bruteSdf(cov, w, h, spread) {
  const out = new Uint8Array(w * h);
  const inside = (x, y) => cov[y * w + x] >= 128;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const here = inside(x, y);
    let best = Infinity;
    for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) if (inside(xx, yy) !== here) best = Math.min(best, (xx - x) ** 2 + (yy - y) ** 2);
    const dist = Number.isFinite(best) ? Math.sqrt(best) - 0.5 : spread * 4;
    const signed = here ? dist : -dist;
    out[y * w + x] = Math.max(0, Math.min(255, Math.round((0.5 + signed / (2 * spread)) * 255)));
  }
  return out;
}

test('distance transform matches a brute-force reference on random shapes', () => {
  const rand = rng(11);
  for (const [w, h] of [[8, 8], [17, 5], [5, 17], [24, 24], [31, 19]]) {
    const cov = new Uint8Array(w * h);
    for (let blob = 0; blob < 4; blob++) { // a few random filled rectangles and circles
      const cx = rand() * w, cy = rand() * h, r = 1 + rand() * 6;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= r) cov[y * w + x] = 255;
    }
    const fast = computeSdf(cov, w, h, 5);
    const slow = bruteSdf(cov, w, h, 5);
    let worst = 0;
    for (let i = 0; i < fast.length; i++) worst = Math.max(worst, Math.abs(fast[i] - slow[i]));
    assert.ok(worst <= 1, `${w}x${h}: largest difference ${worst}`);
  }
});

test('distance field encoding: 128 at the edge, rising inside, falling outside, saturating at the spread', () => {
  const w = 40, h = 40, cov = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) cov[y * w + x] = x >= 20 ? 255 : 0; // a straight edge between x=19 and x=20
  const s = computeSdf(cov, w, h, 6);
  const row = (x) => s[10 * w + x];
  assert.ok(Math.abs(row(19) - 117) <= 1 && Math.abs(row(20) - 138) <= 1, `half a pixel either side of the edge: ${row(19)}, ${row(20)}`);
  for (let x = 1; x < w; x++) assert.ok(row(x) >= row(x - 1), 'never decreases going inside');
  assert.equal(row(0), 0, 'far outside saturates at 0');
  assert.equal(row(39), 255, 'far inside saturates at 255');
  assert.ok(row(20 + 3) - 128 > 40 && row(20 + 3) < 255, 'about half the spread inside is about three quarters');
  assert.deepEqual([...computeSdf(new Uint8Array(9), 3, 3, 4)], new Array(9).fill(0), 'an empty image has no inside');
  assert.deepEqual([...computeSdf(new Uint8Array(9).fill(255), 3, 3, 4)], new Array(9).fill(255), 'a full image has no edge');
});

// ---- SDF fonts, with a fake canvas that can hand back pixels ----
function sdfAtlas(size = 512) {
  const puts = [];
  const scratch = { draws: [] };
  const ctx = {
    font: '', fillStyle: '', textBaseline: '',
    save() {}, restore() {}, beginPath() {}, rect() {}, clip() {}, clearRect() {},
    measureText: (t) => ({ width: t.length * 24, fontBoundingBoxAscent: 36, fontBoundingBoxDescent: 12 }),
    fillText(ch) { scratch.draws.push(ch); },
    // pretend every glyph is a solid block in the middle of its cell
    getImageData: (x, y, w, h) => { const data = new Uint8ClampedArray(w * h * 4); for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (i > w / 3 && i < (2 * w) / 3 && j > h / 3 && j < (2 * h) / 3) data[(j * w + i) * 4 + 3] = 255; return { data, width: w, height: h }; },
    createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
    putImageData: (img, x, y) => puts.push({ x, y, w: img.width, h: img.height, alpha: img.data[3], centre: img.data[((img.height >> 1) * img.width + (img.width >> 1)) * 4 + 3], rgb: [img.data[0], img.data[1], img.data[2]] }),
  };
  const atlas = new Atlas({ size, createCanvas: () => ({ getContext: () => ctx, width: 64, height: 64 }) });
  return { atlas, puts, scratch };
}

test('an sdf font stores distance fields, marks its sprites, and lays text out at any size', () => {
  const { atlas, puts } = sdfAtlas();
  const font = new Font(atlas, { family: 'Test', size: 16, sdf: { size: 48, spread: 8 }, preload: 'AB' });
  assert.equal(atlas.sprites.size, 2);
  for (const s of atlas.sprites.values()) assert.equal(s.sdf, true, 'glyph sprites are flagged for the shader');
  assert.equal(puts.length, 2);
  assert.equal(puts[0].w, 24 + 16, 'cell = advance + a spread of padding on each side');
  assert.equal(puts[0].h, 48 + 16);
  assert.deepEqual(puts[0].rgb, [255, 255, 255], 'colour is white (the tint supplies it)');
  assert.equal(puts[0].alpha, 0, 'the corner is far outside the shape: distance 0');
  assert.ok(puts[0].centre > 128, 'the middle of a solid block is inside');
  assert.equal(font.lineHeight, 48 * (16 / 48), 'line height is in nominal world units: 16');

  const batch = new SpriteBatch();
  font.draw(batch, 'AB', 0, 0);
  const defaultWidth = batch.f32[2];
  near(defaultWidth, (24 + 16) * (16 / 48), 'nominal size 16: one raster pixel is 1/3 world unit');
  assert.equal(batch.u32[10] & META_SDF, META_SDF, 'instances carry the sdf flag');

  const big = new SpriteBatch(), tiny = new SpriteBatch();
  const boxBig = font.draw(big, 'AB', 0, 0, { size: 160 });
  const boxTiny = font.draw(tiny, 'AB', 0, 0, { size: 8 });
  near(big.f32[2], (24 + 16) * (160 / 48), 'size 160');
  near(tiny.f32[2], (24 + 16) * (8 / 48), 'size 8');
  assert.equal(boxBig.width, 48 * (160 / 48), 'two 24 px advances at size 160');
  assert.equal(boxBig.height, 160, 'one line is exactly the font size tall');
  assert.equal(font.measure('AB', { size: 32 }).width, 32, 'two 24 px advances (at the 48 px raster) are 16 world units each at size 32');
  assert.equal(font.measure('AB ', { unit: 2 }).width, font.measure('AB ', { size: 32 }).width, 'unit 2 of a size-16 font is size 32');
  assert.equal(puts.length, 2, 'drawing at different sizes never creates more glyphs');
});

test('sdf text does not snap to pixels by default (it is meant to scale and move smoothly), plain text does', () => {
  const { atlas } = sdfAtlas();
  const sdf = new Font(atlas, { size: 16, sdf: true, preload: 'A' });
  const plain = new Font(atlas, { size: 16, preload: 'A' });
  const a = new SpriteBatch(), b = new SpriteBatch(), c = new SpriteBatch();
  sdf.draw(a, 'A', 10.37, 20.61);
  plain.draw(b, 'A', 10.37, 20.61);
  sdf.draw(c, 'A', 10.37, 20.61, { snap: true });
  const left = (batch) => batch.f32[0] - batch.f32[2] / 2;
  assert.ok(frac(left(a)) > 1e-3, 'smooth');
  assert.ok(frac(left(b)) < 1e-4, 'snapped');
  assert.ok(frac(left(c)) < 1e-4, 'snap can be forced on');
});

test('sdf and plain fonts coexist on one atlas without sharing glyphs; several fonts spill onto extra pages', () => {
  const { atlas } = sdfAtlas(128); // small pages: a few fonts will not fit on one
  const a = new Font(atlas, { size: 16, sdf: { size: 32 }, preload: 'ABCDEFGH' });
  new Font(atlas, { size: 16, preload: 'ABCDEFGH' });
  new Font(atlas, { size: 16, sdf: { size: 32, spread: 3 }, preload: 'ABCDEFGH' });
  assert.ok(atlas.pages.length >= 2, `${atlas.pages.length} pages`);
  assert.equal(atlas.sprites.size, 24, 'three distinct fonts, eight glyphs each');
  assert.equal(a.atlasFull, false);
  const pagesUsed = new Set([...atlas.sprites.values()].map((s) => s.page));
  assert.ok(pagesUsed.size >= 2, 'glyphs really are spread over several pages');
});
