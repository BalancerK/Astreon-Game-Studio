import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolvePostOptions, TONEMAPS, Camera3D } from '../src/index.js';
import { writePostUniforms, bloomLevels, POST_UNIFORM_FLOATS } from '../src/post.js';
import { resolveShadowOptions, computeCascades, MAX_CASCADES } from '../src/shadow.js';
import { writeSceneUniforms, SCENE_UNIFORM_FLOATS, CASCADE_MATRICES_AT } from '../src/webgpu3d.js';

test('post options: defaults, overrides and validation', () => {
  const d = resolvePostOptions(true);
  assert.equal(d.tonemap, 'aces'); assert.equal(d.exposure, 1); assert.equal(d.bloom.levels, 5); assert.equal(d.bloom.threshold, 0.85); assert.equal(d.vignette, null);
  const o = resolvePostOptions({ bloom: { intensity: 2, levels: 99 }, vignette: {}, tonemap: 'filmic', exposure: 2 });
  assert.equal(o.bloom.intensity, 2); assert.equal(o.bloom.levels, 8, 'levels are capped'); assert.equal(o.vignette.strength, 0.4); assert.equal(o.tonemap, 'filmic');
  assert.equal(resolvePostOptions({ bloom: false }).bloom, null);
  assert.throws(() => resolvePostOptions({ tonemap: 'cinematic' }), /unknown tone map "cinematic"/);
  assert.deepEqual(Object.keys(TONEMAPS), ['none', 'reinhard', 'aces', 'filmic']);
});

test('post uniforms put every setting where the shaders read it', () => {
  const u = writePostUniforms(new Float32Array(POST_UNIFORM_FLOATS), resolvePostOptions({
    exposure: 1.5, contrast: 1.2, saturation: 0.8, bloom: { intensity: 0.7 }, vignette: { strength: 0.3, radius: 0.6 }, tonemap: 'reinhard', dither: 2,
    lift: [0.1, 0.2, 0.3], gamma: [1.1, 1.2, 1.3], gain: [0.9, 0.8, 0.7],
  }));
  const f = (a) => Array.from(a, (v) => +v.toFixed(5));
  assert.deepEqual(f(u.slice(0, 8)), [1.5, 1.2, 0.8, 0.7, 0.3, 0.6, 1, 2]);
  assert.deepEqual(f(u.slice(8, 11)), [0.1, 0.2, 0.3]); assert.deepEqual(f(u.slice(12, 15)), [1.1, 1.2, 1.3]); assert.deepEqual(f(u.slice(16, 19)), [0.9, 0.8, 0.7]);
  const off = writePostUniforms(new Float32Array(POST_UNIFORM_FLOATS), resolvePostOptions({ bloom: false }));
  assert.equal(off[3], 0, 'no bloom: nothing is added back');
  assert.equal(off[4], 0, 'no vignette');
});

test('bloom levels halve the size and stop at two pixels', () => {
  assert.deepEqual(bloomLevels(320, 240, 3), [{ w: 160, h: 120 }, { w: 80, h: 60 }, { w: 40, h: 30 }]);
  const tiny = bloomLevels(10, 6, 8);
  assert.ok(tiny.length < 8 && tiny.at(-1).w === 2 && tiny.at(-1).h === 2, JSON.stringify(tiny));
});

test('cascade options: counts and ratios are checked', () => {
  assert.equal(resolveShadowOptions({}).cascades, 1);
  assert.equal(resolveShadowOptions({ cascades: 4 }).cascades, 4);
  assert.throws(() => resolveShadowOptions({ cascades: 0 }), /cascades/);
  assert.throws(() => resolveShadowOptions({ cascades: MAX_CASCADES + 1 }), /cascades/);
  assert.throws(() => resolveShadowOptions({ cascades: 2.5 }), /cascades/);
  assert.throws(() => resolveShadowOptions({ ratio: 1 }), /ratio/);
});

test('cascades: each is a smaller, sharper box than the next, and all are valid light matrices', () => {
  const cam = new Camera3D({ x: 3, y: 2, z: 5, yaw: 0.4 }).update();
  const out = Array.from({ length: 3 }, () => new Float64Array(16));
  const texels = computeCascades(out, cam, [0.5, 1, 0.3], { size: 1024, radius: 40, cascades: 3, ratio: 0.5 });
  assert.deepEqual(texels.map((t) => +(t * 1024 / 2).toFixed(3)), [10, 20, 40], 'radii are radius * ratio^k');
  assert.ok(texels[0] < texels[1] && texels[1] < texels[2]);
  for (const m of out) assert.ok(m.every(Number.isFinite) && m.some((v) => v !== 0));
  const single = computeCascades([new Float64Array(16)], cam, [0.5, 1, 0.3], { size: 1024, radius: 40, cascades: 1, ratio: 0.5 });
  assert.equal(single[0], 2 * 40 / 1024, 'one cascade is exactly the old single map');
});

test('the scene block carries the cascade matrices, count and normal offsets after the lights', () => {
  const cam = new Camera3D({}).update();
  const mats = [0, 1, 2].map((k) => Float64Array.from({ length: 16 }, (_, i) => k * 100 + i));
  const out = new Float32Array(SCENE_UNIFORM_FLOATS);
  writeSceneUniforms(out, cam, {}, { matrices: mats, size: 2048, bias: 0.0004, strength: 0.75, texels: [0.01, 0.02, 0.04] });
  assert.equal(CASCADE_MATRICES_AT, 320);
  for (let k = 0; k < 3; k++) for (let i = 0; i < 16; i++) assert.equal(out[CASCADE_MATRICES_AT + k * 16 + i], k * 100 + i);
  assert.equal(out[CASCADE_MATRICES_AT + 64], 3, 'count');
  assert.deepEqual(Array.from(out.slice(CASCADE_MATRICES_AT + 68, CASCADE_MATRICES_AT + 71), (v) => +v.toFixed(4)), [0.015, 0.03, 0.06]);
  assert.equal(out[40], 0, 'the first cascade is also where the depth pass reads its matrix'); assert.equal(out[41], 1);
  assert.equal(out[58], 0.75);
  writeSceneUniforms(out, cam, {}, null);
  assert.equal(out[CASCADE_MATRICES_AT + 64], 0, 'no shadows: no cascades');
  assert.equal(SCENE_UNIFORM_FLOATS % 4, 0, 'a whole number of vec4s');
});
