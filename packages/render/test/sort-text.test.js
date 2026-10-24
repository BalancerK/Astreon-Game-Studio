import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SpriteBatch, INSTANCE_WORDS, packTint, sortKey, Camera, Atlas, Font } from '../src/index.js';

const SPR = { u0: 0, v0: 0, u1: 1, v1: 1 };
// x doubles as an id so we can read back the order
const ids = (b) => Array.from({ length: b.count }, (_, i) => b.f32[i * INSTANCE_WORDS]);
const keysOf = (b) => Array.from(b.keys.subarray(0, b.count));

function rng(seed) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }

test('sorting: stable, matches a reference sort for any mix of keys, and keeps data and keys together', () => {
  const rand = rng(7);
  for (const n of [1, 2, 7, 100, 3000]) {
    const b = new SpriteBatch(4);
    const ref = [];
    for (let i = 0; i < n; i++) {
      const choice = rand();
      const key = choice < 0.2 ? 0 : choice < 0.4 ? -rand() * 1e6 : choice < 0.6 ? Math.floor(rand() * 5) : rand() * 1e5 - 5e4; // ties, negatives, fractions
      b.push(i, i * 2, 3, 4, 0.5, SPR, packTint(i & 255, 1, 2, 3), key);
      ref.push({ id: i, key });
    }
    ref.sort((a, c) => a.key - c.key || a.id - c.id); // Array#sort is stable, ties broken by push order
    b.sort();
    assert.deepEqual(ids(b), ref.map((r) => r.id), `n=${n}: order`);
    assert.deepEqual(keysOf(b), ref.map((r) => Math.fround(r.key)), `n=${n}: keys travel with their sprites`);
    for (let i = 0; i < n; i++) { // the other words moved with them
      const o = i * INSTANCE_WORDS, id = ref[i].id;
      assert.equal(b.f32[o + 1], id * 2);
      assert.equal(b.u32[o + 9] & 255, id & 255, 'tint');
    }
    assert.equal(b.needsSort, false);
  }
});

test('sorting costs nothing when keys are already in order, and is safe to repeat', () => {
  const b = new SpriteBatch(8);
  for (let i = 0; i < 100; i++) b.push(i, 0, 1, 1, 0, SPR, 0xffffffff, i >> 2); // ascending, with ties
  assert.equal(b.needsSort, false);
  const before = b.f32;
  b.sort();
  assert.equal(b.f32, before, 'no copy was made');
  assert.equal(b.scratch, null, 'and nothing was allocated');
  const plain = new SpriteBatch();
  for (let i = 0; i < 10; i++) plain.push(i, 0, 1, 1, 0, SPR); // default keys: push order
  assert.equal(plain.needsSort, false);

  b.push(-1, 0, 1, 1, 0, SPR, 0xffffffff, -5); // one out-of-order sprite
  assert.equal(b.needsSort, true);
  b.sort();
  assert.equal(ids(b)[0], -1);
  const after = b.f32;
  b.sort();
  assert.equal(b.f32, after, 'sorting twice does nothing the second time');
});

test('sorting survives frame reuse: clear, growth after a sort, NaN and infinite keys', () => {
  const b = new SpriteBatch(2);
  for (let frame = 0; frame < 5; frame++) {
    b.clear();
    assert.equal(b.needsSort, false);
    const n = 10 + frame * 300; // grows past the scratch buffers from earlier frames
    for (let i = 0; i < n; i++) b.push(i, 0, 1, 1, 0, SPR, 0xffffffff, (n - i) % 7);
    b.sort();
    const k = keysOf(b);
    assert.ok(k.every((v, i) => i === 0 || k[i - 1] <= v), `frame ${frame} sorted`);
    assert.equal(b.count, n);
    assert.equal(new Set(ids(b)).size, n, 'no sprite lost or duplicated');
  }
  b.clear();
  b.push(1, 0, 1, 1, 0, SPR, 0xffffffff, Infinity);
  b.push(2, 0, 1, 1, 0, SPR, 0xffffffff, NaN); // treated as 0
  b.push(3, 0, 1, 1, 0, SPR, 0xffffffff, -Infinity);
  b.sort();
  assert.deepEqual(ids(b), [3, 2, 1]);
});

test('sortKey: higher layers on top; within a layer, lower on screen draws later', () => {
  assert.ok(sortKey(0, 5000) < sortKey(1, -5000), 'layer beats y');
  assert.ok(sortKey(2, 10) < sortKey(2, 11));
  const b = new SpriteBatch();
  b.push(1, 0, 1, 1, 0, SPR, 0xffffffff, sortKey(1, 0));    // UI-ish layer
  b.push(2, 0, 1, 1, 0, SPR, 0xffffffff, sortKey(0, 300));  // world, low on screen
  b.push(3, 0, 1, 1, 0, SPR, 0xffffffff, sortKey(0, 100));  // world, high on screen
  b.sort();
  assert.deepEqual(ids(b), [3, 2, 1]);
});

test('sorting 50,000 sprites is cheap', () => {
  const b = new SpriteBatch(50_000);
  const rand = rng(3);
  const fill = () => { b.clear(); for (let i = 0; i < 50_000; i++) b.push(i, 0, 1, 1, 0, SPR, 0xffffffff, rand() * 4000); };
  fill(); b.sort(); // warm up (allocates scratch)
  fill();
  const t0 = performance.now();
  b.sort();
  const ms = performance.now() - t0;
  assert.ok(ms < 60, `sorted 50k sprites in ${ms.toFixed(1)} ms`); // typically about 3 ms; loose so a busy machine cannot fail it
});

test('Camera.setScreenSpace maps world units to CSS pixels, origin top-left', () => {
  const c = Camera.screen(800, 600);
  assert.deepEqual({ ...c.worldToScreen(10, 20) }, { x: 10, y: 20 });
  assert.deepEqual({ ...c.screenToWorld(799, 599) }, { x: 799, y: 599 });
  c.setScreenSpace(400, 300);
  assert.deepEqual({ ...c.worldToScreen(5, 5) }, { x: 5, y: 5 });
  const u = c.uniforms();
  assert.ok(Math.abs((0 - u[0]) * u[2]) <= 1 && Math.abs((((0 - u[1]) * u[3]) - 1)) < 1e-6, 'pixel (0,0) is the top-left corner of clip space');
});

// ---- text, with a fake 2D context so layout logic runs in Node ----
function fakeAtlas(size = 256, maxPages = 8) {
  const log = [];
  const ctx = {
    font: '', fillStyle: '', textBaseline: '',
    save() {}, restore() {}, beginPath() {}, rect() {}, clip() {},
    measureText: (t) => ({ width: t.length * 10 + (t === '\u{1F600}' ? 0 : 0), fontBoundingBoxAscent: 12, fontBoundingBoxDescent: 4 }),
    fillText: (ch, x, y) => log.push([ch, x, y]),
  };
  const atlas = new Atlas({ size, maxPages, createCanvas: () => ({ getContext: () => ctx }) });
  return { atlas, ctx, log };
}

test('Font preloads ASCII, shares glyphs between identical fonts, and measures text', () => {
  const { atlas } = fakeAtlas(512);
  const font = new Font(atlas, { family: 'Test', size: 16 });
  assert.equal(atlas.sprites.size, 94, '95 printable ASCII characters, minus the space which has no pixels');
  assert.equal(font.lineHeight, 16);
  const before = atlas.sprites.size;
  const twin = new Font(atlas, { family: 'Test', size: 16 });
  assert.equal(atlas.sprites.size, before, 'the same font shares its glyphs');
  assert.ok(new Font(atlas, { family: 'Test', size: 16, weight: 'bold', preload: 'A' }).css.includes('bold'));
  assert.equal(font.width('abc'), 30);
  assert.equal(font.width('abc', 2), 60, 'unit scales it');
  assert.deepEqual(font.measure('ab\ncde'), { width: 30, height: 32, lines: ['ab', 'cde'] });
  assert.equal(twin.width(''), 0);
});

test('word wrap breaks at spaces, splits over-long words, and honours newlines', () => {
  const { atlas } = fakeAtlas(512);
  const font = new Font(atlas, { size: 10 }); // every character is 10 wide
  assert.deepEqual(font.wrap('aaa bbb ccc', 70), ['aaa bbb', 'ccc']);
  assert.deepEqual(font.wrap('aaa bbb ccc', 110), ['aaa bbb ccc']);
  assert.deepEqual(font.wrap('aaa bbb ccc', 30), ['aaa', 'bbb', 'ccc']);
  assert.deepEqual(font.wrap('abcdefgh', 30), ['abc', 'def', 'gh'], 'a word wider than the box is split');
  assert.deepEqual(font.wrap('x abcdefgh y', 30), ['x', 'abc', 'def', 'gh', 'y']);
  assert.deepEqual(font.wrap('a\n\nb', 100), ['a', '', 'b']);
  assert.deepEqual(font.wrap('a\tb'), ['a    b'], 'tabs become four spaces');
  assert.deepEqual(font.wrap('one two'), ['one two'], 'no limit: only newlines break');
  assert.deepEqual(font.wrap('', 50), ['']);
  assert.deepEqual(font.wrap('abc', 5).join(''), 'abc', 'a box narrower than one glyph still terminates');
  assert.deepEqual(font.wrap('aaa bbb', 20, 0.5), ['aaa', 'bbb'].map((s) => s), 'unit shrinks the text so more fits');
});

test('draw places one quad per visible glyph, aligned and sized in world units', () => {
  const { atlas } = fakeAtlas(512);
  const font = new Font(atlas, { size: 10 });
  const b = new SpriteBatch();
  const box = font.draw(b, 'A B', 100, 50, { tint: packTint(1, 2, 3, 255), key: 7 });
  assert.equal(b.count, 2, 'the space draws nothing');
  assert.deepEqual(box, { width: 30, height: 16, lines: ['A B'] });
  assert.deepEqual(keysOf(b), [7, 7]);
  const cellW = 10 + 4, cellH = 12 + 4 + 4; // advance + padding, line height + padding
  const f = b.f32;
  assert.equal(f[2], cellW); assert.equal(f[3], cellH);
  assert.equal(f[0], 100 - 2 + cellW / 2, 'first glyph starts at x (minus its padding)');
  assert.equal(f[1], 50 - 2 + cellH / 2);
  assert.equal(f[INSTANCE_WORDS], 120 - 2 + cellW / 2, 'third character starts two advances later');
  assert.equal(b.u32[9], packTint(1, 2, 3, 255));

  for (const [align, startX] of [['center', 100 - 15], ['right', 100 - 30]]) {
    const c = new SpriteBatch();
    font.draw(c, 'abc', 100, 0, { align });
    assert.equal(c.f32[0], startX - 2 + cellW / 2, align);
  }
  const wrapped = new SpriteBatch();
  const wb = font.draw(wrapped, 'ab cd', 0, 0, { maxWidth: 25 });
  assert.deepEqual(wb.lines, ['ab', 'cd']);
  assert.equal(wrapped.f32[1] + 16, wrapped.f32[2 * INSTANCE_WORDS + 1], 'second line is one line height lower');
  const big = new SpriteBatch();
  font.draw(big, 'a', 0, 0, { unit: 2 });
  assert.equal(big.f32[2], cellW * 2);
});

test('shadow draws first and the text on top; snapping rounds to device pixels', () => {
  const { atlas } = fakeAtlas(512);
  const font = new Font(atlas, { size: 10, scale: 2 });
  const b = new SpriteBatch();
  font.draw(b, 'a', 10.3, 20.3, { shadow: { dx: 1, dy: 1, tint: packTint(0, 0, 0, 100) } });
  assert.equal(b.count, 2);
  assert.equal(b.u32[9], packTint(0, 0, 0, 100), 'shadow first');
  assert.equal(b.u32[INSTANCE_WORDS + 9], 0xffffffff);
  assert.ok(Math.abs((b.f32[INSTANCE_WORDS] - b.f32[0]) - -1) < 1e-6, 'shadow is offset by (1, 1) world units');
  const left = (i) => b.f32[i * INSTANCE_WORDS] - b.f32[i * INSTANCE_WORDS + 2] / 2;
  assert.equal((left(1) * 2) % 1, 0, 'snapped to half a world unit (one device pixel at scale 2)');
  const loose = new SpriteBatch();
  font.draw(loose, 'a', 10.3, 20.3, { snap: false });
  assert.notEqual(((loose.f32[0] - loose.f32[2] / 2) * 2) % 1, 0, 'snap: false leaves positions alone');
});

test('unusual text: emoji count once, controls draw nothing, a full atlas degrades to ?', () => {
  const { atlas } = fakeAtlas(512);
  const font = new Font(atlas, { size: 10 });
  const b = new SpriteBatch();
  font.draw(b, '\u{1F600}', 0, 0);
  assert.equal(b.count, 1, 'a surrogate pair is one glyph');
  const c = new SpriteBatch();
  font.draw(c, 'a\u0007b', 0, 0);
  assert.equal(c.count, 2, 'control characters are skipped');

  const tiny = fakeAtlas(256, 1); // one page only: it really does run out
  const f2 = new Font(tiny.atlas, { size: 10 }); // 94 glyphs of 14x20 fill most of a 256 atlas
  const before = tiny.atlas.sprites.size;
  const d = new SpriteBatch();
  for (let cp = 0x400; cp < 0x500; cp++) f2.draw(d, String.fromCodePoint(cp), 0, 0); // many new characters
  assert.ok(f2.atlasFull, 'ran out of room');
  assert.ok(tiny.atlas.sprites.size >= before);
  assert.equal(d.count, 256, 'every character still draws something (the ? glyph) instead of throwing');
});
