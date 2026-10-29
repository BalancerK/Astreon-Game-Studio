import { test } from 'node:test';
import assert from 'node:assert/strict';
import { QUALITY_LEVELS, qualityOf, reducePost, createDynamicResolution, gpuClass } from '../src/quality.js';
import { WebGL2Renderer3D } from '../src/webgl3d.js';
import { WebGPURenderer3D } from '../src/webgpu3d.js';

test('each level costs less than the one above, and anything unknown is the lightest', () => {
  const { low, medium, high } = QUALITY_LEVELS;
  assert.ok(high.shadowSize > medium.shadowSize && medium.shadowSize >= low.shadowSize);
  assert.ok(high.lights > medium.lights && medium.lights > low.lights);
  assert.ok(high.pixelRatioCap > medium.pixelRatioCap && medium.pixelRatioCap > low.pixelRatioCap);
  assert.ok(low.particles < 1 && !low.antialias && high.antialias);
  assert.equal(qualityOf('ultra'), low); assert.equal(qualityOf(undefined), low); assert.equal(qualityOf('high'), high);
  assert.throws(() => { QUALITY_LEVELS.low.lights = 99; }, TypeError);
});

test('a finishing pass is reduced to a level: high as it is, medium without the expensive passes, low with only the colour work and smooth edges', () => {
  const full = { bloom: { threshold: 1, levels: 5 }, tonemap: 'aces', exposure: 0.8, contrast: 1.1, saturation: 1.2, gain: [1, 1, 1], vignette: { strength: 0.3 }, ao: { radius: 2 }, ssr: { steps: 40 }, dof: { taps: 20 }, heat: [], heatTime: 1, fxaa: false };
  assert.equal(reducePost(full, 'high'), full);
  const med = reducePost(full, 'medium'), low = reducePost(full, 'low');
  for (const p of [med, low]) { assert.equal(p.tonemap, 'aces'); assert.equal(p.exposure, 0.8); assert.equal(p.fxaa, true); for (const k of ['ao', 'ssr', 'dof', 'heat', 'heatTime']) assert.equal(p[k], undefined, k); }
  assert.equal(med.bloom.levels, 4); assert.equal(low.bloom, undefined);
  assert.equal(full.bloom.levels, 5, 'the original is not changed');
  assert.equal(reducePost(undefined, 'low'), undefined);
});

/** Play `seconds` of a card that manages `fpsAt(scale)`, feeding the controller every half second. */
function run(drs, seconds, fpsAt, from = 10) {
  let t = from;
  for (let i = 0; i < seconds * 2; i++, t += 0.5) drs.update(Math.min(60, fpsAt(drs.scale)), 20, t);
  return t;
}

test('dynamic resolution: a slow card gets a smaller picture (never below the minimum), a fast one is left alone, and a recovered one grows back slowly', () => {
  const slow = createDynamicResolution();
  run(slow, 20, (s) => 14 / (s * s));
  assert.ok(slow.scale < 0.6 && slow.scale >= 0.4, `scale ${slow.scale}`);
  const hopeless = createDynamicResolution(); run(hopeless, 30, () => 5); assert.equal(hopeless.scale, 0.4);
  const fast = createDynamicResolution(); run(fast, 20, () => 60); assert.equal(fast.scale, 1);
  const back = createDynamicResolution(); let t = run(back, 6, () => 20); assert.ok(back.scale < 0.8);
  t = run(back, 60, () => 60, t); assert.equal(back.scale, 1);
});

test('dynamic resolution: loading, a stall and a hidden page do not count against the card, and a try that failed is repeated less and less often', () => {
  const drs = createDynamicResolution();
  for (let t = 0; t < 4; t += 0.5) drs.update(3, 900, t);
  assert.equal(drs.scale, 1);
  assert.equal(drs.update(30, 1500, 10), false); assert.equal(drs.scale, 1);
  drs.pause(20); assert.equal(drs.update(1, 40, 20.5), false); assert.equal(drs.scale, 1);
  const card = (s) => (s <= 0.71 ? 60 : 25), d2 = createDynamicResolution();
  let t = run(d2, 20, card); assert.ok(d2.scale <= 0.71);
  const changes = []; let last = d2.scale;
  for (let i = 0; i < 240; i++, t += 0.5) { d2.update(card(d2.scale), 20, t); if (d2.scale !== last) { changes.push(t); last = d2.scale; } }
  const gaps = changes.slice(1).map((c, i) => c - changes[i]);
  assert.ok(Math.max(...gaps) > 8, `the attempts spread out: ${gaps.join(' ')}`);
});

test('graphics cards are told apart by their names: strong ones, weak ones (integrated, a phone\'s, software drawing) and the rest', () => {
  for (const name of ['ANGLE (NVIDIA, NVIDIA GeForce RTX 5060 Laptop GPU (0x00002D59) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1650 Direct3D11)', 'ANGLE (AMD, AMD Radeon RX 6600 Direct3D11)', 'Apple M2', 'ANGLE (Intel, Intel(R) Arc(TM) A380 Graphics Direct3D11)']) assert.equal(gpuClass(name), 'strong', name);
  for (const name of ['ANGLE (Intel, Intel(R) UHD Graphics 630 (0x00003E92) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'ANGLE (Intel, Intel(R) HD Graphics 4000 Direct3D11)', 'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11)', 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)', 'Mali-G78', 'Adreno (TM) 640', 'llvmpipe (LLVM 15)', 'ANGLE (AMD, AMD Radeon(TM) Vega 8 Graphics Direct3D11)', 'ANGLE (NVIDIA, NVIDIA GeForce MX150 Direct3D11)']) assert.equal(gpuClass(name), 'weak', name);
  assert.equal(gpuClass(''), 'unknown'); assert.equal(gpuClass('Some New Chip'), 'unknown');
});

for (const [name, Renderer] of [['WebGL2Renderer3D', WebGL2Renderer3D], ['WebGPURenderer3D', WebGPURenderer3D]]) {
  test(`${name}: resize does not touch the canvas when nothing changed (that empties it), and setRenderScale draws fewer pixels over the same area`, () => {
    const writes = [];
    const canvas = { style: {}, _w: 0, _h: 0, get width() { return this._w; }, set width(v) { writes.push(['width', v]); this._w = v; }, get height() { return this._h; }, set height(v) { writes.push(['height', v]); this._h = v; } };
    const r = Object.create(Renderer.prototype); r.canvas = canvas;
    r.resize(800, 600, 2);
    assert.deepEqual([canvas.width, canvas.height, canvas.style.width, canvas.style.height], [1600, 1200, '800px', '600px']);
    const n = writes.length; r.resize(800, 600, 2); assert.equal(writes.length, n, 'the same size writes nothing');
    r.setRenderScale(0.5);
    assert.deepEqual([canvas.width, canvas.height, canvas.style.width, canvas.style.height], [800, 600, '800px', '600px']);
    r.resize(1000, 500, 1); assert.deepEqual([canvas.width, canvas.height], [500, 250]);
    r.setRenderScale(5); assert.equal(r.renderScale, 1); assert.deepEqual([canvas.width, canvas.height], [1000, 500]);
    r.setRenderScale(0); assert.equal(r.renderScale, 1, 'nonsense means full size'); r.setRenderScale(0.01); assert.equal(r.renderScale, 0.25);
  });
}
