import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Filter, planFilters, runFilters, filterColor, toPremultiplied, fromPremultiplied, packTint, MAX_GRADIENT_STOPS } from '../src/index.js';
import { FILTER_REGISTERS, FILTER_MODE } from '../src/filters.js';

const W = 24, H = 16;
/** A picture as premultiplied floats: a filled rectangle of one colour on transparent. */
function rect(x0, y0, x1, y1, [r, g, b, a] = [1, 1, 1, 1], w = W, h = H) {
  const p = new Float32Array(w * h * 4);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const o = (y * w + x) * 4; p[o] = r * a; p[o + 1] = g * a; p[o + 2] = b * a; p[o + 3] = a; }
  return p;
}
const at = (p, x, y, w = W) => Array.from(p.subarray((y * w + x) * 4, (y * w + x) * 4 + 4));
const run = (filters, p, o = {}) => runFilters(planFilters(filters, o), p, o.w ?? W, o.h ?? H);
const near = (a, b, eps = 1e-3, msg = '') => assert.ok(Math.abs(a - b) <= eps, `${msg} ${a} vs ${b}`);
const total = (p, k = 3) => { let s = 0; for (let i = k; i < p.length; i += 4) s += p[i]; return s; };

test('colours: packed tints, strings and arrays all become [r, g, b, a] in 0..1', () => {
  assert.deepEqual(filterColor(packTint(255, 0, 128, 255)).map((v) => +v.toFixed(3)), [1, 0, 0.502, 1]);
  assert.deepEqual(filterColor('#f80').map((v) => +v.toFixed(3)), [1, 0.533, 0, 1]);
  assert.deepEqual(filterColor('#00ff0080').map((v) => +v.toFixed(2)), [0, 1, 0, 0.5]);
  assert.deepEqual(filterColor([0.1, 0.2, 0.3]), [0.1, 0.2, 0.3, 1]);
  assert.throws(() => filterColor('red'), /not a colour/);
});

test('filter descriptions are plain data and are checked', () => {
  assert.equal(Filter.blur(6).type, 'blur'); assert.equal(Filter.blur(-3).radius, 0); assert.equal(Filter.pixelate(2.7).size, 3); assert.equal(Filter.pixelate(0).size, 1);
  assert.throws(() => Filter.gradientMap([[0, '#000']]), /at least two/);
  assert.throws(() => Filter.gradientMap(Array.from({ length: MAX_GRADIENT_STOPS + 1 }, (_, i) => [i / 10, '#fff'])), /at most/);
  assert.throws(() => Filter.colorMatrix([1, 2, 3]), /20 numbers/);
  assert.deepEqual(Filter.gradientMap([[1, '#fff'], [0, '#000']]).stops.map((s) => s.pos), [0, 1], 'stops are put in order');
  assert.throws(() => planFilters([{ type: 'nonsense' }]), /unknown filter/); assert.throws(() => planFilters([null]), /not a filter/);
  assert.equal(Filter.wave({ axis: 'y' }).axis, 'y'); assert.equal(Filter.wave({ axis: 'q' }).axis, 'x');
});

test('plans: passes, registers and results', () => {
  assert.deepEqual(planFilters([]), { passes: [], result: 0 });
  const one = planFilters([Filter.grayscale()]); assert.equal(one.passes.length, 1); assert.equal(one.passes[0].mode, FILTER_MODE.matrix); assert.deepEqual([one.passes[0].inputs, one.passes[0].output, one.result], [[0], 1, 1]);
  const blur = planFilters([Filter.blur(8)]); assert.equal(blur.passes.length, 2, 'across, then down'); assert.deepEqual(blur.passes.map((p) => p.mode), [FILTER_MODE.blur, FILTER_MODE.blur]);
  assert.equal(planFilters([Filter.blur(40)]).passes.length, 6, 'a wide blur is several narrow ones');
  assert.equal(planFilters([Filter.blur(0)]).passes.length, 0, 'no blur is no passes');
  const glow = planFilters([Filter.glow({ radius: 6 })]); assert.deepEqual(glow.passes.map((p) => p.mode), [FILTER_MODE.blur, FILTER_MODE.blur, FILTER_MODE.composite]); assert.deepEqual(glow.passes[2].inputs, [0, glow.passes[1].output], 'the glow goes under the original');
  const long = planFilters([Filter.glow(), Filter.sepia(), Filter.outline({ width: 2 }), Filter.dropShadow(), Filter.pixelate(3), Filter.vignette(), Filter.wave(), Filter.blur(50), Filter.glow({ radius: 40 })]);
  for (const p of long.passes) { assert.ok(p.output < FILTER_REGISTERS && p.inputs.every((r) => r < FILTER_REGISTERS)); assert.ok(!p.inputs.includes(p.output), 'a pass never writes the picture it reads'); }
  assert.ok(long.passes.length > 15);
  assert.equal(planFilters([Filter.blur(8)], { scale: 2 }).passes[0].u[4], planFilters([Filter.blur(16)]).passes[0].u[4], 'sizes scale with the pixel ratio');
});

test('grayscale, sepia, saturate, invert, brightness, contrast, tint and hue change colours and keep the shape', () => {
  const red = rect(4, 4, 12, 12, [1, 0, 0, 1]);
  const gray = at(run([Filter.grayscale()], red), 6, 6); near(gray[0], 0.2126); near(gray[1], 0.2126); near(gray[2], 0.2126); assert.equal(gray[3], 1);
  assert.deepEqual(at(run([Filter.grayscale()], red), 0, 0), [0, 0, 0, 0], 'transparent stays transparent');
  const half = at(run([Filter.grayscale(0.5)], red), 6, 6); near(half[0], 0.6063, 1e-3); near(half[1], 0.1063, 1e-3);
  const inv = at(run([Filter.invert()], red), 6, 6); near(inv[0], 0); near(inv[1], 1); near(inv[2], 1);
  assert.deepEqual(at(run([Filter.saturate(1)], red), 6, 6).map((v) => +v.toFixed(3)), [1, 0, 0, 1], 'saturate 1 is no change');
  const desat = at(run([Filter.saturate(0)], red), 6, 6); near(desat[0], 0.2126); near(desat[1], 0.2126);
  const dark = at(run([Filter.brightness(0.5)], rect(0, 0, 24, 16, [1, 0.5, 0.2, 1])), 3, 3); near(dark[0], 0.5); near(dark[1], 0.25); near(dark[2], 0.1);
  const flat = at(run([Filter.contrast(0)], rect(0, 0, 24, 16, [1, 0, 0.3, 1])), 3, 3); near(flat[0], 0.5); near(flat[1], 0.5);
  const flash = at(run([Filter.tint('#ffffff', 0.8)], red), 6, 6); near(flash[0], 1); near(flash[1], 0.8); near(flash[2], 0.8);
  const hue = at(run([Filter.hueRotate(120)], red), 6, 6); assert.ok(hue[1] > hue[0] && hue[1] > hue[2], `red turned 120 degrees is green-ish: ${hue}`);
  const same = at(run([Filter.hueRotate(0)], red), 6, 6); near(same[0], 1); near(same[1], 0);
  const sepia = at(run([Filter.sepia()], rect(0, 0, 24, 16, [1, 1, 1, 1])), 3, 3); assert.ok(sepia[0] >= sepia[1] && sepia[1] > sepia[2], `brown: ${sepia}`);
  const translucent = at(run([Filter.grayscale()], rect(2, 2, 10, 10, [1, 0, 0, 0.5])), 5, 5); near(translucent[3], 0.5); near(translucent[0], 0.2126 * 0.5, 2e-3, 'premultiplied stays premultiplied');
  const custom = at(run([Filter.colorMatrix([0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0])], red), 6, 6); assert.deepEqual(custom.map((v) => +v.toFixed(3)), [0, 1, 0, 1], 'a matrix can swap channels');
});

test('blur spreads the shape evenly, keeps the total, and a bigger radius spreads more', () => {
  const p = rect(10, 6, 14, 10, [1, 1, 1, 1], 24, 16);
  const small = run([Filter.blur(3)], p), big = run([Filter.blur(6)], p);
  near(total(small), total(p), 0.5, 'the amount of ink is kept (the shape is well inside the picture)'); near(total(big), total(p), 0.5);
  assert.ok(at(small, 12, 8)[3] < 1 && at(small, 12, 8)[3] > 0.5, 'the middle thins'); assert.ok(at(small, 7, 8)[3] > 0 && at(small, 7, 8)[3] < 0.3, 'the edge spreads out');
  assert.ok(at(big, 12, 8)[3] < at(small, 12, 8)[3], 'a bigger radius spreads more'); assert.ok(at(big, 5, 8)[3] > at(small, 5, 8)[3]);
  for (const [a, b] of [[at(small, 8, 8), at(small, 15, 8)], [at(small, 12, 5), at(small, 12, 10)]]) near(a[3], b[3], 1e-4, 'symmetric');
  assert.deepEqual(run([Filter.blur(0)], p), p, 'no radius, no change');
  const solid = run([Filter.blur(8)], rect(0, 0, 24, 16)); near(at(solid, 12, 8)[3], 1, 1e-4); near(at(solid, 0, 0)[3], 1, 1e-4, 'the edge of the picture is not darkened');
});

test('glow and drop shadow go under the shape, in their own colour', () => {
  const p = rect(9, 5, 15, 11, [1, 0, 0, 1], 24, 16);
  const glow = run([Filter.glow({ color: '#00ff00', radius: 5, strength: 2 })], p);
  assert.deepEqual(at(glow, 12, 8).map((v) => +v.toFixed(3)), [1, 0, 0, 1], 'the shape itself is untouched');
  const out = at(glow, 7, 8); assert.ok(out[3] > 0.2 && out[1] > 0.2 && out[0] < 1e-6, `a green halo outside: ${out}`);
  assert.ok(at(glow, 7, 8)[3] > at(glow, 4, 8)[3] && at(glow, 4, 8)[3] >= at(glow, 1, 8)[3], 'fading with distance');
  const shadow = run([Filter.dropShadow({ dx: 5, dy: 0, color: '#000000', alpha: 1, blur: 0 })], p);
  assert.equal(at(shadow, 17, 8)[3], 1, 'shifted right by 5 with no blur: solid'); assert.equal(at(shadow, 3, 8)[3], 0); assert.deepEqual(at(shadow, 12, 8), [1, 0, 0, 1], 'the original is on top');
  const soft = run([Filter.dropShadow({ dx: 4, dy: 3, color: '#000', alpha: 0.5, blur: 3 })], p); assert.ok(at(soft, 17, 12)[3] > 0 && at(soft, 17, 12)[3] <= 0.5);
});

test('outline draws a ring around the shape, not inside it', () => {
  const p = rect(9, 5, 15, 11, [1, 1, 1, 1], 24, 16);
  const o = run([Filter.outline({ color: '#ff0000', width: 2 })], p);
  assert.deepEqual(at(o, 12, 8), [1, 1, 1, 1], 'inside unchanged'); assert.deepEqual(at(o, 8, 8).map((v) => +v.toFixed(2)), [1, 0, 0, 1], 'touching the edge: solid');
  assert.deepEqual(at(o, 7, 8).map((v) => +v.toFixed(2)), [1, 0, 0, 1], 'two pixels out is still the line'); assert.equal(at(o, 4, 8)[3], 0, 'beyond the width: nothing');
  assert.ok(at(o, 8, 4)[3] > 0.2, 'round at the corners'); assert.equal(at(run([Filter.outline({ width: 0 })], p), 8, 8)[3], 0, 'no width, no line');
});

test('pixelate makes square blocks of one colour', () => {
  const p = new Float32Array(W * H * 4); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const o = (y * W + x) * 4; p[o] = x / W; p[o + 1] = y / H; p[o + 3] = 1; p[o] *= 1; }
  const q = run([Filter.pixelate(4)], p);
  for (let by = 0; by < H; by += 4) for (let bx = 0; bx < W; bx += 4) { const c = at(q, bx, by); for (let y = by; y < by + 4; y++) for (let x = bx; x < bx + 4; x++) assert.deepEqual(at(q, x, y), c, `block ${bx},${by}`); }
  assert.deepEqual(at(q, 0, 0), at(p, 2, 2), 'a block shows the pixel at its middle'); assert.notDeepEqual(at(q, 0, 0), at(q, 4, 0));
  assert.deepEqual(run([Filter.pixelate(1)], p), p, 'size 1 changes nothing');
});

test('gradient map recolours by brightness, between its stops, keeping the shape', () => {
  const stops = Filter.gradientMap([[0, '#000000'], [0.5, '#ff0000'], [1, '#ffff00']]);
  const shade = (v, a = 1) => at(run([stops], rect(0, 0, W, H, [v, v, v, a])), 3, 3);
  assert.deepEqual(shade(0).map((x) => +x.toFixed(3)), [0, 0, 0, 1]); assert.deepEqual(shade(0.5).map((x) => +x.toFixed(3)), [1, 0, 0, 1]); assert.deepEqual(shade(1).map((x) => +x.toFixed(3)), [1, 1, 0, 1]);
  const mid = shade(0.25); near(mid[0], 0.5, 2e-3); near(mid[1], 0); const hi = shade(0.75); near(hi[0], 1, 2e-3); near(hi[1], 0.5, 2e-3);
  assert.deepEqual(at(run([stops], rect(2, 2, 6, 6)), 0, 0), [0, 0, 0, 0], 'transparent stays transparent'); near(shade(1, 0.5)[3], 0.5, 1e-6, 'and a half-clear pixel stays half-clear');
  const ends = Filter.gradientMap([[0.3, '#0000ff'], [0.6, '#ffffff']]); assert.deepEqual(at(run([ends], rect(0, 0, W, H, [0, 0, 0, 1])), 3, 3).map((x) => +x.toFixed(2)), [0, 0, 1, 1], 'below the first stop: its colour');
  assert.deepEqual(at(run([ends], rect(0, 0, W, H, [1, 1, 1, 1])), 3, 3).map((x) => +x.toFixed(2)), [1, 1, 1, 1], 'above the last: its colour');
});

test('vignette darkens the corners and leaves the middle', () => {
  const p = rect(0, 0, W, H, [1, 1, 1, 1]), v = run([Filter.vignette({ radius: 0.5, softness: 0.4, strength: 1, color: '#000000' })], p);
  assert.deepEqual(at(v, 12, 8).map((x) => +x.toFixed(2)), [1, 1, 1, 1]); assert.ok(at(v, 0, 0)[0] < 0.05, `corner: ${at(v, 0, 0)}`); assert.equal(at(v, 0, 0)[3], 1, 'the shape is kept');
  assert.ok(at(v, 2, 2)[0] < at(v, 6, 5)[0], 'darker toward the corner');
  const red = at(run([Filter.vignette({ radius: 0.2, softness: 0.1, strength: 1, color: '#ff0000' })], p), 0, 0); near(red[0], 1); near(red[1], 0);
  assert.deepEqual(at(run([Filter.vignette()], rect(0, 0, 4, 4)), 20, 14), [0, 0, 0, 0], 'nothing is drawn where there is nothing');
});

test('wave shifts rows or columns by a sine, and a phase of zero amplitude changes nothing', () => {
  const p = rect(8, 0, 16, 16, [1, 1, 1, 1]);
  const w = run([Filter.wave({ amplitude: 3, wavelength: 16, phase: 0 })], p);
  const left = (y) => { for (let x = 0; x < W; x++) if (at(w, x, y)[3] > 0.5) return x; return -1; };
  const lefts = Array.from({ length: H }, (_, y) => left(y)); assert.ok(new Set(lefts).size > 3, `edges move row by row: ${lefts}`); assert.ok(Math.max(...lefts) - Math.min(...lefts) >= 4 && Math.max(...lefts) - Math.min(...lefts) <= 7);
  const w2 = run([Filter.wave({ amplitude: 3, wavelength: 16, phase: Math.PI })], p); assert.notDeepEqual(lefts, Array.from({ length: H }, (_, y) => { for (let x = 0; x < W; x++) if (at(w2, x, y)[3] > 0.5) return x; return -1; }), 'phase moves it');
  const flat = run([Filter.wave({ amplitude: 0 })], p); for (let i = 0; i < p.length; i++) near(flat[i], p[i], 1e-5);
  const vertical = run([Filter.wave({ amplitude: 3, wavelength: 16, axis: 'y' })], rect(0, 6, 24, 10)); const tops = Array.from({ length: W }, (_, x) => { for (let y = 0; y < H; y++) if (at(vertical, x, y)[3] > 0.5) return y; return -1; }); assert.ok(new Set(tops).size > 3, 'columns move up and down');
});

test('chains run in order and a pixel ratio scales the sizes', () => {
  const p = rect(9, 5, 15, 11, [1, 0, 0, 1], 24, 16);
  const ab = run([Filter.grayscale(), Filter.invert()], p), ba = run([Filter.invert(), Filter.grayscale()], p);
  near(at(ab, 12, 8)[0], 1 - 0.2126, 2e-3); near(at(ba, 12, 8)[0], 0.7152 * 1 + 0.0722 * 1, 3e-3, 'invert first: cyan, then gray');
  const scaled = run([Filter.outline({ width: 1 })], p, { scale: 2 }); assert.deepEqual(at(scaled, 7, 8).map((v) => +v.toFixed(2)), [0, 0, 0, 1], 'width 1 at ratio 2 is two pixels');
  const stack = run([Filter.blur(2), Filter.glow({ radius: 3 }), Filter.pixelate(2), Filter.vignette(), Filter.wave(), Filter.sepia()], p); assert.equal(stack.length, p.length); assert.ok(stack.every(Number.isFinite));
});

test('pixel conversions round trip', () => {
  const bytes = Uint8ClampedArray.from([255, 0, 0, 255, 0, 255, 0, 128, 10, 20, 30, 0, 100, 150, 200, 255]);
  const back = fromPremultiplied(toPremultiplied(bytes));
  assert.deepEqual(Array.from(back.slice(0, 4)), [255, 0, 0, 255]); assert.deepEqual(Array.from(back.slice(4, 8)), [0, 255, 0, 128]); assert.deepEqual(Array.from(back.slice(8, 12)), [0, 0, 0, 0], 'fully clear pixels carry no colour'); assert.deepEqual(Array.from(back.slice(12)), [100, 150, 200, 255]);
});
