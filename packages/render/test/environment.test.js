import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  skyEnvironment, uniformEnvironment, environmentFromImage, parseHdr, buildEnvironment, environmentIrradiance, sampleEnvironment, rotateForEnvironment, ambientFromEnvironment,
  pbrAmbientEnvironment, loadEnvironment,
} from '../src/index.js';
import { MATERIAL_SLOTS } from '../src/materials.js';
import { cubeDirection, toHalf, halfFaceData, writeEnvironmentBlock, ENV_BLOCK_AT, ENV_BLOCK_VEC4S, CUBE_FACES } from '../src/environment.js';

const near = (a, b, tol, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} ${a} vs ${b}`);
const norm = (v) => { const l = Math.hypot(...v); return v.map((x) => x / l); };

test('the cube faces point where their names say, and a direction finds the face it points at', () => {
  assert.deepEqual(CUBE_FACES, ['+x', '-x', '+y', '-y', '+z', '-z']);
  const middle = (face) => cubeDirection(face, 0, 0);
  assert.deepEqual([0, 1, 2, 3, 4, 5].map(middle).map((v) => v.map((x) => x + 0)), [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]], 'the middle of each face');
  const colours = [[1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 1, 0], [1, 0, 1], [0, 1, 1]];
  const env = buildEnvironment(colours.map((c) => Float32Array.from({ length: 16 * 16 * 3 }, (_, i) => c[i % 3])), 16);
  const looks = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  looks.forEach((d, f) => assert.deepEqual(sampleEnvironment(env, d, 0).map((v) => Math.round(v)), colours[f], `looking along ${CUBE_FACES[f]}`));
  const slanted = sampleEnvironment(env, norm([1, 0.1, 0.1]), 0);
  assert.deepEqual(slanted.map((v) => Math.round(v)), [1, 0, 0], 'a direction that is mostly +x is on the +x face');
});

test('a uniform environment gives the same light from every side, and its levels are all the same colour', () => {
  const env = uniformEnvironment([0.5, 0.25, 1], 32);
  for (const n of [[0, 1, 0], [0, -1, 0], [1, 0, 0], norm([1, 1, -1])]) {
    const e = environmentIrradiance(env, n);
    near(e[0], 0.5, 1e-3); near(e[1], 0.25, 1e-3); near(e[2], 1, 1e-3);
  }
  assert.deepEqual(env.levels.map((l) => l.size), [32, 16, 8, 4]);
  assert.equal(env.maxLod, 3);
  for (let lod = 0; lod <= 3; lod++) sampleEnvironment(env, norm([0.3, -0.5, 0.8]), lod).forEach((v, k) => near(v, [0.5, 0.25, 1][k], 2e-3, `level ${lod}`));
  assert.throws(() => uniformEnvironment([1, 1, 1], 20), /power of two/);
  assert.throws(() => uniformEnvironment([1, 1, 1], 512), /16 to 256/);
});

test('the spherical harmonics give the soft light of the sky: more from above than below, and close to adding it all up', () => {
  const env = skyEnvironment({ size: 32 });
  const up = environmentIrradiance(env, [0, 1, 0]), down = environmentIrradiance(env, [0, -1, 0]);
  assert.ok(up[2] > down[2] * 3, 'a blue sky lights an upward face blue');
  // brute force: add up every texel's light, weighted by the cosine of its angle, over the sphere
  const brute = (n) => {
    const total = [0, 0, 0];
    const size = env.size, d = [0, 0, 0];
    for (let f = 0; f < 6; f++) {
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const sc = (2 * (x + 0.5)) / size - 1, tc = (2 * (y + 0.5)) / size - 1;
          cubeDirection(f, sc, tc, d);
          const l = Math.hypot(...d), cos = (d[0] * n[0] + d[1] * n[1] + d[2] * n[2]) / l;
          if (cos <= 0) continue;
          const w = ((2 / size) ** 2 / (1 + sc * sc + tc * tc) ** 1.5) * cos / Math.PI;
          for (let k = 0; k < 3; k++) total[k] += env.levels[0].faces[f][(y * size + x) * 3 + k] * w;
        }
      }
    }
    return total;
  };
  for (const n of [[0, 1, 0], [0, -1, 0], [1, 0, 0], norm([1, 1, 1]), norm([-1, 0.3, 0.5])]) {
    const a = environmentIrradiance(env, n), b = brute(n);
    for (let k = 0; k < 3; k++) near(a[k], b[k], Math.max(0.08 * b[k], 0.015), `normal ${n.map((v) => v.toFixed(2))} channel ${k}`);   // nine numbers cannot hold a sharp horizon exactly
  }
});

test('blurring for roughness spreads a bright sun without making or losing light', () => {
  const env = skyEnvironment({ sun: { direction: [0.5, 0.6, 0.3], intensity: 30, size: 0.05 } });
  const sun = norm([0.5, 0.6, 0.3]);
  const peaks = env.levels.map((_, lod) => sampleEnvironment(env, sun, lod)[0]);
  for (let i = 1; i < peaks.length; i++) assert.ok(peaks[i] < peaks[i - 1], `the sun is dimmer and wider at level ${i}: ${peaks.map((p) => p.toFixed(2))}`);
  const mean = (level) => {
    let sum = 0, weight = 0;
    const d = [0, 0, 0];
    for (let f = 0; f < 6; f++) for (let y = 0; y < level.size; y++) for (let x = 0; x < level.size; x++) {
      const sc = (2 * (x + 0.5)) / level.size - 1, tc = (2 * (y + 0.5)) / level.size - 1;
      cubeDirection(f, sc, tc, d);
      const w = 1 / (1 + sc * sc + tc * tc) ** 1.5;
      sum += (level.faces[f][(y * level.size + x) * 3] + level.faces[f][(y * level.size + x) * 3 + 1] + level.faces[f][(y * level.size + x) * 3 + 2]) * w;
      weight += w;
    }
    return sum / weight;
  };
  const base = mean(env.levels[0]);
  for (let i = 1; i < env.levels.length; i++) near(mean(env.levels[i]) / base, 1, 0.12, `the total light at level ${i}`);
  for (const level of env.levels) for (const f of level.faces) assert.ok(f.every((v) => Number.isFinite(v) && v >= 0), 'no speckles of nonsense');
});

test('making an environment is deterministic: the same input gives the same numbers, and each one gets its own id', () => {
  const a = skyEnvironment({ size: 32, sun: { direction: [1, 1, 0] } }), b = skyEnvironment({ size: 32, sun: { direction: [1, 1, 0] } });
  assert.deepEqual([...a.sh], [...b.sh]);
  a.levels.forEach((l, i) => l.faces.forEach((f, k) => assert.deepEqual([...f], [...b.levels[i].faces[k]], `level ${i} face ${k}`)));
  assert.notEqual(a.id, b.id);
});

test('a picture wrapped round the sky: bytes are sRGB, floats are light, and the middle of the picture is -z', () => {
  const w = 16, h = 8;
  const bytes = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) bytes.set(y < h / 2 ? [255, 0, 0, 255] : [0, 0, 255, 255], (y * w + x) * 4);
  const env = environmentFromImage({ width: w, height: h, data: bytes }, { size: 16 });
  const up = sampleEnvironment(env, [0, 1, 0], 0), down = sampleEnvironment(env, [0, -1, 0], 0);
  assert.ok(up[0] > 0.9 && up[2] < 0.1, 'the top of the picture is overhead');
  assert.ok(down[2] > 0.9 && down[0] < 0.1, 'the bottom is underfoot');
  const grey = new Uint8ClampedArray(w * h * 4).fill(128);
  const lin = sampleEnvironment(environmentFromImage({ width: w, height: h, data: grey }, { size: 16 }), [1, 0, 0], 0)[0];
  near(lin, 0.2158, 0.01, 'sRGB 128 is about 0.216 of the light, not 0.5');
  const floats = new Float32Array(w * h * 3).fill(7);
  near(sampleEnvironment(environmentFromImage({ width: w, height: h, data: floats }, { size: 16 }), [0, 0, 1], 0)[1], 7, 1e-3, 'floats are used as they are, so a bright sun can stay bright');
  const half = environmentFromImage({ width: w, height: h, data: floats }, { size: 16, intensity: 0.5 });
  near(sampleEnvironment(half, [0, 0, 1], 0)[0], 3.5, 1e-3);
  // the middle column faces -z: put a marker there
  const marked = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y++) { marked[(y * w + w / 2) * 3] = 10; marked[(y * w + w / 2 - 1) * 3] = 10; }
  const m = environmentFromImage({ width: w, height: h, data: marked }, { size: 32 });
  assert.ok(sampleEnvironment(m, [0, 0, -1], 0)[0] > sampleEnvironment(m, [0, 0, 1], 0)[0] + 2, 'the marker is in the -z direction');
  assert.throws(() => environmentFromImage({ width: 1, height: 1, data: [] }), /at least 2/);
  assert.throws(() => environmentFromImage({ width: 4, height: 4, data: new Uint8Array(10) }), /expected 64/);
});

/** A Radiance file: the header, the size line, and pixels as RGBE bytes (flat, or run-length encoded line by line). */
function hdrFile(width, height, pixel, { rle = false, size = `-Y ${height} +X ${width}`, format = '32-bit_rle_rgbe' } = {}) {
  const head = new TextEncoder().encode(`#?RADIANCE\n# made by a test\nFORMAT=${format}\n\n${size}\n`);
  const parts = [head];
  for (let y = 0; y < height; y++) {
    const rgbe = Array.from({ length: width }, (_, x) => pixel(x, y));
    if (!rle) { parts.push(Uint8Array.from(rgbe.flat())); continue; }
    const line = [2, 2, width >> 8, width & 255];
    for (let c = 0; c < 4; c++) {                                          // each channel: a run of the same value, then the rest as a literal run
      const v = rgbe[0][c];
      let x = 0;
      while (x < width && rgbe[x][c] === v && x < 127) x++;
      if (x >= 2) { line.push(128 + x, v); } else x = 0;
      while (x < width) { const n = Math.min(128, width - x); line.push(n, ...rgbe.slice(x, x + n).map((p) => p[c])); x += n; }
    }
    parts.push(Uint8Array.from(line));
  }
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

test('a Radiance .hdr file is read: flat or run-length encoded, with its exponent', () => {
  const pixel = (x, y) => [128 + x, 64, y * 10, 129];                      // exponent 129: times 2^(129-136) = 1/128
  for (const rle of [false, true]) {
    const hdr = parseHdr(hdrFile(16, 3, pixel, { rle }));
    assert.deepEqual([hdr.width, hdr.height, hdr.data.length], [16, 3, 16 * 3 * 3]);
    near(hdr.data[(1 * 16 + 5) * 3], (128 + 5) / 128, 1e-6, `red of pixel (5, 1), rle ${rle}`);
    near(hdr.data[(2 * 16 + 0) * 3 + 2], 20 / 128, 1e-6, `blue of pixel (0, 2), rle ${rle}`);
  }
  const black = parseHdr(hdrFile(8, 1, () => [200, 100, 50, 0]));
  assert.deepEqual([...black.data], new Array(24).fill(0), 'exponent 0 is black');
  const flipped = parseHdr(hdrFile(8, 2, (x, y) => [x * 10, 0, 0, 136], { size: '+Y 2 -X 8' }));
  assert.equal(flipped.data[0], 70, 'the size line can say the rows run bottom to top and the columns right to left');
  assert.equal(flipped.data[(1 * 8 + 0) * 3], 70);
  // and it feeds an environment
  const env = environmentFromImage(parseHdr(hdrFile(16, 8, () => [128, 128, 128, 130])), { size: 16 });
  near(sampleEnvironment(env, [0, 1, 0], 0)[0], 2, 1e-3, '128 at exponent 130 is 128 * 2^(130 - 136) = 2.0');
});

test('a file that is not a usable .hdr says why', () => {
  assert.throws(() => parseHdr(new TextEncoder().encode('P6\n1 1\n255\n')), /not a Radiance/);
  assert.throws(() => parseHdr(hdrFile(8, 1, () => [0, 0, 0, 0], { format: '32-bit_rle_xyze' })), /not supported/);
  assert.throws(() => parseHdr(new TextEncoder().encode('#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\nnonsense\n')), /size line/);
  assert.throws(() => parseHdr(hdrFile(8, 4, () => [0, 0, 0, 0]).slice(0, -20)), /ends early/);
  assert.throws(() => parseHdr(hdrFile(100000, 1000, () => [0, 0, 0, 0], {}).slice(0, 80)), /not usable/);
});

test('half floats: the right bits for the usual numbers, and small errors for everything else', () => {
  assert.equal(toHalf(1), 0x3c00);
  assert.equal(toHalf(0), 0);
  assert.equal(toHalf(0.5), 0x3800);
  assert.equal(toHalf(-2), 0xc000);
  assert.equal(toHalf(65504), 0x7bff);
  assert.equal(toHalf(1e6), 0x7c00, 'too big for a half float is infinity');
  assert.equal(toHalf(Infinity), 0x7c00);
  assert.equal(toHalf(1e-9), 0, 'too small is zero');
  const decode = (h) => { const s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 31, m = h & 1023; return e === 0 ? s * m * 2 ** -24 : s * (1 + m / 1024) * 2 ** (e - 15); };
  for (const v of [0.001, 0.0333, 0.2158, 0.7, 1.5, 3.14159, 20, 777.7, 60000]) near(decode(toHalf(v)) / v, 1, 0.001, `${v}`);
  near(decode(toHalf(3e-5)) / 3e-5, 1, 0.02, 'a denormal keeps a couple of digits');
  const env = uniformEnvironment([0.5, 2, 8], 16);
  const face = halfFaceData(env.levels[0], 3);
  assert.equal(face.length, 16 * 16 * 4);
  assert.deepEqual([face[0], face[1], face[2], face[3]], [toHalf(0.5), toHalf(2), toHalf(8), toHalf(1)], 'RGBA, with alpha 1');
});

test('the numbers handed to the shaders sit where the shaders read them', () => {
  assert.equal(ENV_BLOCK_AT, MATERIAL_SLOTS * 5, 'the block starts right after the 128 materials');
  const table = new Float32Array((ENV_BLOCK_AT + ENV_BLOCK_VEC4S) * 4);
  const env = uniformEnvironment([1, 1, 1], 16);
  const inv = Float64Array.from({ length: 16 }, (_, i) => i + 1);
  const at = ENV_BLOCK_AT * 4;
  const state = writeEnvironmentBlock(table, env, { intensity: 2, rotation: 0.5, skyBlur: 0.5 }, inv);
  assert.deepEqual(state, { lighting: true, sky: true });
  near(table[at], 2, 1e-6); near(table[at + 1], Math.cos(0.5), 1e-6); near(table[at + 2], Math.sin(0.5), 1e-6); assert.equal(table[at + 3], env.maxLod);
  assert.equal(table[at + 4], 1, 'the lighting is on');
  near(table[at + 5], 0.5 * env.maxLod, 1e-6, 'the sky blur is a level');
  assert.equal(table[at + 6], 1, 'the sky is on');
  assert.deepEqual([...table.slice(at + 8, at + 44)], [...env.sh], 'nine harmonics, four numbers each');
  assert.deepEqual([...table.slice(at + 44, at + 60)], [...inv], 'the inverse view-projection matrix, for the sky');
  assert.deepEqual(writeEnvironmentBlock(table, env, { sky: false }, inv), { lighting: true, sky: false });
  assert.equal(table[at + 6], 0);
  assert.equal(table[at], 1, 'the intensity defaults to 1');
  assert.deepEqual(writeEnvironmentBlock(table, env, false, inv), { lighting: false, sky: false });
  assert.ok(table.slice(at, at + 64).every((v) => v === 0), 'turned off: everything in the block is zero');
  assert.deepEqual(writeEnvironmentBlock(table, null, {}, inv), { lighting: false, sky: false }, 'no environment, nothing');
  writeEnvironmentBlock(table, env, { skyBlur: 7, intensity: -3 }, inv);
  assert.deepEqual([table[at], table[at + 5]], [0, env.maxLod], 'values are held to their ranges');
});

test('turning the environment, plain ambient colours that match it, and what a surface receives', () => {
  const r = rotateForEnvironment([1, 0, 0], Math.PI / 2);
  near(r[0], 0, 1e-9); near(r[2], 1, 1e-9);
  assert.deepEqual(rotateForEnvironment([0, 1, 0], 2).map((x) => x + 0), [0, 1, 0], 'up stays up');
  const env = skyEnvironment({ size: 32 });
  const amb = ambientFromEnvironment(env, 2);
  assert.ok(amb.ambientSky[2] > amb.ambientGround[2] * 3);
  near(amb.ambientSky[0], 2 * environmentIrradiance(env, [0, 1, 0])[0], 1e-9);
  const white = uniformEnvironment([1, 1, 1], 16);
  const matte = pbrAmbientEnvironment({ baseColor: [0.5, 0.5, 0.5], metallic: 0, roughness: 1 }, [0, 1, 0], [0, 1, 0], white);
  near(matte.diffuse[0], 0.5, 2e-3, 'a grey surface under white light shows its own grey');
  const mirror = pbrAmbientEnvironment({ baseColor: [1, 1, 1], metallic: 1, roughness: 0.05 }, [0, 1, 0], [0, 1, 0], white);
  assert.deepEqual(mirror.diffuse, [0, 0, 0]);
  assert.ok(mirror.specular[0] > 0.9, 'a polished white metal reflects almost all of a white world');
  const turned = pbrAmbientEnvironment({ baseColor: [1, 1, 1], metallic: 1, roughness: 0.05 }, [0, 0, 1], [0, 0, 1], env, { rotation: Math.PI });
  const straight = pbrAmbientEnvironment({ baseColor: [1, 1, 1], metallic: 1, roughness: 0.05 }, [0, 0, 1], [0, 0, 1], env, { rotation: 0 });
  assert.ok(turned.specular.every((v, k) => Number.isFinite(v)) && straight.specular.every((v) => Number.isFinite(v)));
  const dim = pbrAmbientEnvironment({ baseColor: [1, 1, 1], metallic: 0, roughness: 1 }, [0, 1, 0], [0, 1, 0], env, { intensity: 0.5 });
  const full = pbrAmbientEnvironment({ baseColor: [1, 1, 1], metallic: 0, roughness: 1 }, [0, 1, 0], [0, 1, 0], env, { intensity: 1 });
  near(dim.diffuse[2] * 2, full.diffuse[2], 1e-9, 'intensity scales it');
});

test('building an environment checks what it is given', () => {
  assert.throws(() => buildEnvironment([], 16), /six faces/);
  assert.throws(() => buildEnvironment(new Array(6).fill(new Float32Array(10)), 16), /six faces/);
});

test('an environment is loaded from a URL: a .hdr file as it is, a picture through the decoder, and a missing file says so', async () => {
  const hdr = hdrFile(16, 8, () => [128, 128, 128, 130]);
  const files = { 'sky.hdr': hdr, 'sky.png': new Uint8Array([137, 80, 78, 71]) };
  const fetchImpl = async (url) => (files[url.split('?')[0]] ? { ok: true, status: 200, arrayBuffer: async () => files[url.split('?')[0]].buffer.slice(0) } : { ok: false, status: 404 });
  const fromHdr = await loadEnvironment('sky.hdr?v=2', { size: 16, fetchImpl });
  near(sampleEnvironment(fromHdr, [0, 1, 0], 0)[0], 2, 1e-3);
  let asked;
  const fromPng = await loadEnvironment('sky.png', { size: 16, fetchImpl, decode: async (bytes, mime) => { asked = [bytes.length, mime]; return { width: 4, height: 2, data: new Uint8Array(32).fill(255) }; } });
  assert.deepEqual(asked, [4, 'image/png'], 'the browser decoder is given the file and its type');
  near(sampleEnvironment(fromPng, [0, 0, 1], 0)[2], 1, 1e-3);
  const sniffed = await loadEnvironment('sky', { size: 16, fetchImpl: async () => ({ ok: true, status: 200, arrayBuffer: async () => hdr.buffer.slice(0) }) });
  near(sampleEnvironment(sniffed, [1, 0, 0], 0)[0], 2, 1e-3, 'a Radiance file is recognised by its first two bytes even without the extension');
  await assert.rejects(() => loadEnvironment('nothing.hdr', { fetchImpl }), /could not load nothing\.hdr \(404\)/);
});
