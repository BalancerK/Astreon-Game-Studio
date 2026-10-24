import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWaterStyle, createWaterMesh, waterHeightAt, writeWaterBlock, WATER_STYLES, MAX_WAVES, WATER_BLOCK_AT, WATER_BLOCK_VEC4S, DrawList3D } from '../src/index.js';
import { WATER_STYLE_VEC4S } from '../src/water.js';
import { ENV_BLOCK_AT, ENV_BLOCK_VEC4S } from '../src/environment.js';
import { waterWaveWgsl, waterShadeWgsl, waterWaveGlsl, waterShadeGlsl } from '../src/water-shaders.js';

const near = (a, b, eps = 1e-6, msg = '') => assert.ok(Math.abs(a - b) <= eps, `${msg} ${a} vs ${b}`);

test('a style has sensible defaults, takes up to four waves, and clamps what would break', () => {
  const s = createWaterStyle();
  assert.equal(s.waves.length, 4); assert.ok(s.clarity > 0 && s.opacity <= 1 && s.reflection <= 1); assert.equal(createWaterStyle({ waves: [{}, {}, {}, {}, {}, {}] }).waves.length, MAX_WAVES);
  const odd = createWaterStyle({ opacity: 7, reflection: -2, clarity: -1, waves: [{ wavelength: 0, amplitude: -3 }] });
  assert.equal(odd.opacity, 1); assert.equal(odd.reflection, 0); assert.ok(odd.clarity > 0); assert.ok(odd.waves[0].wavelength > 0 && odd.waves[0].amplitude === 0);
  assert.equal(createWaterStyle({ shallow: [1, 0, 0] }).shallow[0], 1);
});

test('waves: the height is the sum of sines, bounded by the amplitudes, moving with time and travelling in the wave direction', () => {
  const one = createWaterStyle({ waves: [{ angle: 0, wavelength: 10, amplitude: 0.5, speed: 2 }] });
  near(waterHeightAt(0, 0, 0, one).height, 0, 1e-9); near(waterHeightAt(2.5, 0, 0, one).height, 0.5, 1e-9, 'a quarter wavelength along the direction: a crest'); near(waterHeightAt(0, 7, 0, one).height, 0, 1e-9, 'constant across the direction');
  near(waterHeightAt(0, 0, 1.25, one).height, -0.5, 1e-9, 'a crest travelling at 2 m/s has moved 2.5 m: what was a crest at x = 2.5 is now at 5, and x = 0 is a trough... a quarter wave later');
  near(waterHeightAt(2.5 + 2 * 3, 0, 3, one).height, 0.5, 1e-9, 'the crest at x = 2.5 is at 8.5 after 3 seconds');
  const many = createWaterStyle(); let max = 0; for (let i = 0; i < 400; i++) max = Math.max(max, Math.abs(waterHeightAt(i * 0.37, i * 0.21, i * 0.1, many).height));
  assert.ok(max <= many.waves.reduce((s, w) => s + w.amplitude, 0) + 1e-9 && max > 0.1);
});

test('the normal leans away from the slope, is a unit vector, and the waves die away toward the shore', () => {
  const s = createWaterStyle({ waves: [{ angle: 0, wavelength: 10, amplitude: 0.5, speed: 2 }] });
  const rising = waterHeightAt(0, 0, 0, s).normal, falling = waterHeightAt(5, 0, 0, s).normal, crest = waterHeightAt(2.5, 0, 0, s).normal;
  assert.ok(rising[0] < 0 && falling[0] > 0, 'the surface faces away from the high side'); near(crest[0], 0, 1e-9); near(Math.hypot(...rising), 1, 1e-9); assert.ok(rising[1] > 0.8);
  near(waterHeightAt(2.5, 0, 0, s, 0).height, 0, 1e-12); near(waterHeightAt(2.5, 0, 0, s, 0.75).height, 0.5 * 0.5, 0.05, 'half way to full depth: partly'); near(waterHeightAt(2.5, 0, 0, s, 1.5).height, 0.5, 1e-12, 'from 1.5 m deep: full');
  assert.deepEqual(waterHeightAt(2.5, 0, 0, s, 0).normal.map((v) => +v.toFixed(9)), [0, 1, 0], 'flat at the shore');
});

test('a water mesh is a flat grid facing up, carrying the water depth in the first texture coordinate', () => {
  const ground = (x) => 2 - x * 0.5;
  const m = createWaterMesh({ x0: 0, z0: 0, x1: 8, z1: 4, level: 1, cell: 2, ground });
  assert.equal(m.vertexCount, 5 * 3); assert.equal(m.indices.length, 4 * 2 * 6); assert.deepEqual(m.min, [0, 1, 0]); assert.deepEqual(m.max, [8, 1, 4]);
  for (let i = 0; i < m.vertexCount; i++) { near(m.vertices[i * 6 + 1], 1); near(m.vertices[i * 6 + 4], 1); const x = m.vertices[i * 6]; near(m.uv[i * 2], Math.max(0, 1 - ground(x)), 1e-6, `depth at x = ${x}`); }
  assert.equal(m.uv[0], 0, 'ground above the water: zero depth, never negative');
  let up = 0; for (let k = 0; k < m.indices.length; k += 3) { const [a, b, c] = [0, 1, 2].map((q) => m.indices[k + q] * 6); const cross = (m.vertices[b + 2] - m.vertices[a + 2]) * (m.vertices[c] - m.vertices[a]) - (m.vertices[b] - m.vertices[a]) * (m.vertices[c + 2] - m.vertices[a + 2]); if (cross > 0) up++; } assert.equal(up, 16, 'counter-clockwise from above');
  const flat = createWaterMesh({ x0: 0, z0: 0, x1: 4, z1: 4, depth: 7 }); assert.ok(Array.from(flat.uv).filter((_, i) => i % 2 === 0).every((v) => v === 7)); assert.equal(flat.name, 'water');
});

test('the uniform block: styles one after another, colours first, then waves, and the reflection mode last', () => {
  assert.equal(WATER_BLOCK_AT, ENV_BLOCK_AT + 24); assert.equal(WATER_BLOCK_VEC4S, WATER_STYLES * WATER_STYLE_VEC4S + 1); assert.ok(ENV_BLOCK_VEC4S >= 24 + WATER_BLOCK_VEC4S);
  const a = createWaterStyle({ shallow: [0.1, 0.2, 0.3], deep: [0.4, 0.5, 0.6], clarity: 7, opacity: 0.8, foamDepth: 0.9, foamCrest: 0.4, reflection: 0.7, specular: 2, shininess: 100, ripple: 0.3, waves: [{ angle: Math.PI / 2, wavelength: 4, amplitude: 0.2, speed: 3 }] });
  const t = new Float32Array(WATER_BLOCK_VEC4S * 4 + 8); t.fill(9); writeWaterBlock(t, 0, [a], 2);
  const v = (n) => Array.from(t.slice(n * 4, n * 4 + 4)).map((x) => +x.toFixed(5));
  assert.deepEqual(v(0), [0.1, 0.2, 0.3, 7]); assert.deepEqual(v(1), [0.4, 0.5, 0.6, 0.8]); assert.deepEqual(v(2).slice(3), [0.9]); assert.deepEqual(v(3), [0.7, 2, 100, 0.3]);
  const k = (2 * Math.PI) / 4; assert.deepEqual(v(4), [0, 1, +k.toFixed(5), 0.2]); assert.deepEqual(v(5), [+(k * 3).toFixed(5), 1, 0.4, 0]); assert.deepEqual(v(6), [0, 0, 0, 0], 'a missing wave is zero');
  assert.deepEqual(v(WATER_STYLE_VEC4S), [0, 0, 0, 0], 'a missing style is zero'); assert.equal(t[WATER_STYLES * WATER_STYLE_VEC4S * 4], 2, 'the mode'); assert.equal(t[WATER_BLOCK_VEC4S * 4], 9, 'nothing written past the block');
});

test('water in the draw list: its mapping, and how other materials replace it', () => {
  const list = new DrawList3D();
  list.setWater(2, 12.5); assert.deepEqual(list.material, [2, 4, 12.5, 0]);
  list.setSurface(5); assert.deepEqual(list.material, [-1, 0, 1, 5], 'a surface material replaces the water');
  list.setWater(1, 3); list.setMaterial(4, 'planar', 0.5); assert.deepEqual(list.material, [4, 2, 0.5, 0]);
  list.setTerrain(1, 2, 0.1); list.setWater(0, 0); list.setMaterial(null); assert.deepEqual(list.material, [-1, 0, 1, 0]);
  assert.throws(() => list.setWater(4), /0 to 3/); assert.throws(() => list.setWater(1.5), /0 to 3/);
});

test('the shader sources read the same table the CPU writes, in both languages', () => {
  const block = (e) => `T[${e}]`;
  for (const src of [waterWaveWgsl(block), waterShadeWgsl(block), waterWaveGlsl(block), waterShadeGlsl(block)]) { assert.ok(!/\$\{/.test(src), 'no placeholders left'); assert.ok(src.includes(String(WATER_BLOCK_AT)), 'the block starts where the CPU puts it'); }
  assert.ok(waterWaveWgsl(block).includes('fn waterWave') && waterWaveGlsl(block).includes('vec3 waterWave')); assert.ok(waterShadeWgsl(block).includes('fn waterShade') && waterShadeGlsl(block).includes('vec4 waterShade'));
  assert.ok(waterShadeWgsl(block).includes(`T[${WATER_BLOCK_AT + WATER_STYLES * WATER_STYLE_VEC4S}]`), 'and the mode lives after the last style');
});
