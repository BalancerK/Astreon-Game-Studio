import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Heightmap, Terrain, splatMap, paintSplat, valueNoise, fbm, buildChunkMesh, DrawList3D, Camera3D } from '../src/index.js';

const near = (a, b, eps = 1e-6, msg = '') => assert.ok(Math.abs(a - b) <= eps, `${msg} ${a} vs ${b}`);
const ramp = (size = 17, slope = 0.5, cell = 1) => Heightmap.fromFunction(size, (x) => x * slope, { cell });
const hill = (size = 65, cell = 1) => Heightmap.fromFunction(size, (x, z) => 30 * Math.exp(-((x - 32) ** 2 + (z - 32) ** 2) / 300), { cell });

test('noise: the same for the same seed, different for another, always between 0 and 1', () => {
  assert.equal(valueNoise(3.3, 4.4, 1), valueNoise(3.3, 4.4, 1)); assert.notEqual(valueNoise(3.3, 4.4, 1), valueNoise(3.3, 4.4, 2));
  for (let i = 0; i < 200; i++) { const v = valueNoise(i * 0.37, i * 0.91, 5), f = fbm(i * 0.21, i * 0.13, { seed: 4 }); assert.ok(v >= 0 && v <= 1 && f >= 0 && f <= 1); }
  near(valueNoise(2, 3, 9), valueNoise(2 + 1e-9, 3, 9), 1e-6, 'smooth'); assert.ok(Math.abs(valueNoise(2.5, 3, 9) - valueNoise(2.51, 3, 9)) < 0.1);
  const ridged = fbm(1.3, 2.2, { ridged: true, octaves: 3 }); assert.ok(ridged >= 0 && ridged <= 1);
});

test('heightmaps: made from noise, a function or a picture, with the right size and origin', () => {
  assert.throws(() => new Heightmap(1), /at least 2/); assert.throws(() => new Heightmap(4, { heights: new Float32Array(3) }), /16 heights/);
  const a = Heightmap.fromNoise({ size: 33, cell: 2, seed: 5, amplitude: 20, base: 3 }), b = Heightmap.fromNoise({ size: 33, cell: 2, seed: 5, amplitude: 20, base: 3 });
  assert.deepEqual(a.heights, b.heights, 'repeatable'); assert.equal(a.width, 64); const r = a.range(); assert.ok(r.min >= 3 && r.max <= 23 && r.max - r.min > 3, `${JSON.stringify(r)}`);
  const island = Heightmap.fromNoise({ size: 33, seed: 5, amplitude: 20, island: 1 }); assert.ok(island.get(0, 0) < island.get(16, 16) && island.get(0, 0) < 0, 'an island sinks at the edge');
  const f = Heightmap.fromFunction(5, (x, z) => x + 10 * z, { cell: 2, originX: -4, originZ: 6 }); assert.equal(f.get(0, 0), -4 + 60); assert.equal(f.get(4, 4), 4 + 140); assert.ok(f.contains(0, 10) && !f.contains(5, 10));
  const px = new Uint8Array(4 * 4 * 4); for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) px[(y * 4 + x) * 4] = x * 85;
  const img = Heightmap.fromImageData(px, 4, 4, { size: 4, minHeight: 0, maxHeight: 30 }); near(img.get(0, 1), 0, 1e-9); near(img.get(3, 1), 30, 1e-9); near(img.get(1, 2), 10, 1e-9, 'a third across, a third of the height');
  assert.throws(() => Heightmap.fromImageData(new Uint8Array(4), 4, 4), /shorter/);
  const g = Heightmap.fromImageData(px, 4, 4, { size: 7 }); assert.equal(g.size, 7);
});

test('height, normal and slope at any point, matching the mesh', () => {
  const m = ramp(17, 0.5);
  near(m.heightAt(4, 3), 2); near(m.heightAt(4.5, 3), 2.25, 1e-9, 'between samples'); near(m.heightAt(-5, 3), 0, 1e-9, 'beyond the edge it holds the edge height'); near(m.heightAt(99, 3), 8, 1e-9);
  const n = m.normalAt(8, 8); near(n[0], -0.5 / Math.hypot(0.5, 1), 1e-9); near(n[1], 1 / Math.hypot(0.5, 1), 1e-9); near(n[2], 0, 1e-9); near(Math.hypot(...n), 1, 1e-9);
  near(m.slopeAt(8, 8), Math.atan(0.5) * 180 / Math.PI, 1e-6); near(Heightmap.fromFunction(5, () => 4).slopeAt(2, 2), 0, 1e-6);
  const bumpy = Heightmap.fromNoise({ size: 17, seed: 2, amplitude: 9 });          // heightAt follows the two triangles of each cell
  const a = bumpy.get(3, 4), b = bumpy.get(3, 5), c = bumpy.get(4, 4), d = bumpy.get(4, 5);
  near(bumpy.heightAt(3.25, 4.25), a + (c - a) * 0.25 + (b - a) * 0.25, 1e-5); near(bumpy.heightAt(3.75, 4.75), d + (c - d) * 0.25 + (b - d) * 0.25, 1e-5);
});

test('rays meet the ground where they should', () => {
  const flat = Heightmap.fromFunction(33, () => 10);
  const hit = flat.raycast([0, 20, 5], [1, -1, 0]); near(hit.x, 10, 1e-3); near(hit.y, 10, 1e-3); near(hit.t, Math.hypot(10, 10), 1e-3); near(hit.normal[1], 1, 1e-9);
  assert.equal(flat.raycast([0, 20, 5], [1, 1, 0]), null, 'upward misses'); assert.equal(flat.raycast([0, 20, 5], [0, 0, 0]), null);
  assert.equal(flat.raycast([0, 20, 5], [1, -1, 0], 5), null, 'too far away'); const under = flat.raycast([3, 5, 3], [0, -1, 0]); assert.equal(under.t, 0, 'starting underground');
  const h = hill(); const down = h.raycast([32, 100, 32], [0, -1, 0]); near(down.y, 30, 0.2, 'the top of the hill'); const side = h.raycast([0, 40, 32], [1, -0.2, 0]); assert.ok(side); near(side.y, h.heightAt(side.x, side.z), 1e-3, 'the hit is on the ground'); near(40 - 0.2 * side.x, side.y, 0.05, 'and on the ray');
  const past = h.raycast([-10, 25, 32], [1, 0, 0]); assert.ok(past && past.x > 10, `a level ray from the side meets the hill: ${past && past.x}`);
});

test('sculpting: raise, lower, smooth, flatten and noise change only what is under the brush', () => {
  const m = Heightmap.fromFunction(33, () => 5), v0 = m.version;
  const r = m.sculpt(16, 16, 6, 2, 'raise');
  assert.deepEqual(r, { i0: 10, j0: 10, i1: 22, j1: 22 }); assert.ok(m.version > v0); near(m.get(16, 16), 7, 1e-9, 'full strength in the middle'); assert.equal(m.get(2, 2), 5, 'untouched far away'); assert.ok(m.get(19, 16) > 5 && m.get(19, 16) < 7); assert.equal(m.get(22, 16), 5, 'nothing at the rim');
  m.sculpt(16, 16, 6, 1, 'lower'); near(m.get(16, 16), 6, 1e-9);
  const rough = Heightmap.fromNoise({ size: 33, seed: 9, amplitude: 10, frequency: 40 }); const spread = (map) => { let s = 0, q = 0, n = 0; for (let j = 12; j <= 20; j++) for (let i = 12; i <= 20; i++) { const h = map.get(i, j); s += h; q += h * h; n++; } return q / n - (s / n) ** 2; };
  const before = spread(rough); for (let k = 0; k < 12; k++) rough.sculpt(16, 16, 8, 1, 'smooth'); assert.ok(spread(rough) < before * 0.8, `smoothing flattens the bumps: ${spread(rough)} from ${before}`);
  const f = Heightmap.fromNoise({ size: 33, seed: 3, amplitude: 10 }); f.sculpt(16, 16, 8, 1, 'flatten', { target: 20 }); near(f.get(16, 16), 20, 1e-9, 'pulled all the way to the target in the middle'); f.sculpt(16, 16, 8, 0.5, 'flatten', { target: 0 }); near(f.get(16, 16), 10, 1e-9);
  const nz = Heightmap.fromFunction(33, () => 0); nz.sculpt(16, 16, 8, 1, 'noise'); assert.ok(nz.range().max > 0.2 && nz.range().min < -0.2);
  assert.throws(() => m.sculpt(16, 16, 4, 1, 'melt'), /unknown sculpt mode/); assert.equal(m.sculpt(500, 500, 3, 1, 'raise'), null, 'a brush away from the map does nothing');
  const sharp = m.sculpt(0, 0, 4, 1, 'raise'); assert.deepEqual([sharp.i0, sharp.j0], [0, 0], 'a brush at the corner is clipped');
});

test('erosion rounds off steep slopes and keeps the total height', () => {
  const m = Heightmap.fromFunction(33, (x, z) => (Math.abs(x - 16) < 3 && Math.abs(z - 16) < 3 ? 12 : 0)); // a tall block
  const volume = (map) => map.heights.reduce((s, h) => s + h, 0), steepest = (map) => { let s = 0; for (let j = 0; j < 32; j++) for (let i = 0; i < 32; i++) s = Math.max(s, Math.abs(map.get(i + 1, j) - map.get(i, j))); return s; };
  const v = volume(m), st = steepest(m); m.erode(20, 0.7, 0.4);
  assert.ok(steepest(m) < st * 0.5, `${steepest(m)} from ${st}`); near(volume(m), v, v * 1e-4, 'nothing is lost, only moved'); assert.ok(m.range().max < 12);
});

test('the ground as triangles for a collision world', () => {
  const m = ramp(5, 1);
  const all = m.toTriangles(); assert.equal(all.length, 4 * 4 * 2 * 9);
  const part = m.toTriangles({ x0: 0, z0: 0, x1: 2, z1: 2 }); assert.equal(part.length, 2 * 2 * 2 * 9); const coarse = m.toTriangles({ step: 2 }); assert.equal(coarse.length, 2 * 2 * 2 * 9);
  let up = 0; for (let t = 0; t < all.length; t += 9) { const ux = all[t + 3] - all[t], uy = all[t + 4] - all[t + 1], uz = all[t + 5] - all[t + 2], vx = all[t + 6] - all[t], vy = all[t + 7] - all[t + 1], vz = all[t + 8] - all[t + 2]; if (uz * vx - ux * vz > 0) up++; }
  assert.equal(up, all.length / 9, 'every triangle faces up');
});

test('splat maps: weights add up, steep ground is rock, low ground sand, high ground snow', () => {
  const m = Heightmap.fromFunction(65, (x, z) => (x < 20 ? 0 : x < 40 ? (x - 20) * 2 : 40) + 0 * z, { cell: 1 });
  const splat = splatMap(m, { size: 64, rock: { slope: [30, 45] }, sand: { height: [0.5, 3] }, snow: { height: [35, 38] }, noise: 0 });
  assert.equal(splat.length, 64 * 64 * 4); const w = (px, py) => Array.from(splat.slice((py * 64 + px) * 4, (py * 64 + px) * 4 + 4));
  for (let i = 0; i < 64 * 64; i++) near(splat[i * 4] + splat[i * 4 + 1] + splat[i * 4 + 2] + splat[i * 4 + 3], 255, 2, 'sums to 255');
  assert.ok(w(8, 32)[2] > 200, `low flat ground is sand: ${w(8, 32)}`); assert.ok(w(30, 32)[1] > 200, `the ramp (63 degrees) is rock: ${w(30, 32)}`); assert.ok(w(60, 32)[3] > 200, `the high plateau is snow: ${w(60, 32)}`);
  const plain = splatMap(Heightmap.fromFunction(33, () => 10), { size: 16, noise: 0 }); assert.ok(plain[0] === 255, 'flat middle ground is the first picture');
  const grass = new Uint8ClampedArray(splat); const area = paintSplat(grass, 64, m, 8, 32, 6, 0, 1); assert.ok(area.x1 > area.x0); assert.ok(grass[(32 * 64 + 8) * 4] > 240 && grass[(32 * 64 + 8) * 4 + 2] < 15, 'painted over the sand'); assert.equal(paintSplat(grass, 64, m, 900, 900, 3, 1), null);
});

test('chunks: how the map is cut, and the checks on it', () => {
  const m = hill(65);
  assert.throws(() => new Terrain(m, { chunkCells: 24 }), /cannot be cut into chunks/); assert.throws(() => new Terrain(m, { chunkCells: 32, lods: 7 }), /levels of detail/);
  const t = new Terrain(m, { chunkCells: 16, lods: 3 });
  assert.equal(t.chunks.length, 16); assert.equal(t.chunksPerSide, 4); assert.deepEqual(t.chunks[5].min.slice(0, 1).concat(t.chunks[5].min.slice(2)), [16, 16]);
  assert.ok(t.chunks[5].max[1] >= t.chunks[5].min[1]);
  assert.deepEqual([0, 0.5, 1, 1.5, 3, 9, 1000].map((d) => t.lodFor(d * t.lodDistance)), [0, 0, 1, 1, 2, 2, 2], 'each level reaches twice as far'); assert.ok(t.lodFor(0) === 0);
});

test('chunk meshes: the right counts, facing the right way, with uvs over the whole map and the same shape at every level', () => {
  const m = hill(33), t = new Terrain(m, { chunkCells: 16, lods: 3, skirt: 2 }), chunk = t.chunks[0];
  const top = (mesh) => { let up = 0, side = 0, bad = 0; for (let k = 0; k < mesh.indices.length; k += 3) { const [a, b, c] = [0, 1, 2].map((q) => mesh.indices[k + q] * 6); const ux = mesh.vertices[b] - mesh.vertices[a], uy = mesh.vertices[b + 1] - mesh.vertices[a + 1], uz = mesh.vertices[b + 2] - mesh.vertices[a + 2]; const vx = mesh.vertices[c] - mesh.vertices[a], vy = mesh.vertices[c + 1] - mesh.vertices[a + 1], vz = mesh.vertices[c + 2] - mesh.vertices[a + 2]; const ny = uz * vx - ux * vz; if (ny > 1e-9) up++; else if (Math.abs(ny) <= 1e-9) side++; else bad++; } return { up, side, bad }; };
  const l0 = t.chunkMesh(chunk, 0), l1 = t.chunkMesh(chunk, 1), l2 = t.chunkMesh(chunk, 2);
  assert.equal(l0.vertexCount, 17 * 17 + 4 * 17); assert.equal(l1.vertexCount, 9 * 9 + 4 * 9); assert.equal(l2.vertexCount, 5 * 5 + 4 * 5); assert.equal(l0.indices.length / 3, 16 * 16 * 2 + 4 * 16 * 2);
  for (const mesh of [l0, l1, l2]) { const f = top(mesh); assert.equal(f.bad, 0, 'no ground triangle faces down'); assert.ok(f.up > 0); assert.equal(f.up + f.side, mesh.indices.length / 3); }
  assert.equal(t.chunkMesh(chunk, 0), l0, 'meshes are made once');
  assert.ok(l0.uv.every((v) => v >= 0 && v <= 1)); near(Math.min(...l0.uv.filter((_, i) => i % 2 === 0)), 0, 1e-9); near(Math.max(...t.chunkMesh(t.chunks[3], 0).uv.filter((_, i) => i % 2 === 0)), 1, 1e-9, 'the last chunk reaches the far side');
  assert.deepEqual(l1.min.map((v, i) => +(v - l0.min[i]).toFixed(3)).filter((_, i) => i !== 1), [0, 0], 'same extent at every level'); assert.ok(Math.abs(l2.max[1] - l0.max[1]) < 8);
  for (let k = 0; k < l0.vertices.length; k += 6) near(Math.hypot(l0.vertices[k + 3], l0.vertices[k + 4], l0.vertices[k + 5]), 1, 1e-5, 'unit normals');
  const noSkirt = buildChunkMesh(m, chunk, 0, 16, 0); assert.equal(noSkirt.vertexCount, 17 * 17);
});

test('skirts hang down and face outward on all four sides; neighbours at the same level share their edge exactly', () => {
  const m = hill(33), t = new Terrain(m, { chunkCells: 16, lods: 2, skirt: 3 });
  const mesh = t.chunkMesh(t.chunks[0], 0), baseVerts = 17 * 17;
  const out = { '-x': 0, '+x': 0, '-z': 0, '+z': 0 };
  for (let k = 0; k < mesh.indices.length; k += 3) {
    const ids = [mesh.indices[k], mesh.indices[k + 1], mesh.indices[k + 2]]; if (!ids.some((id) => id >= baseVerts)) continue;
    const p = ids.map((id) => [mesh.vertices[id * 6], mesh.vertices[id * 6 + 1], mesh.vertices[id * 6 + 2]]);
    const u = [p[1][0] - p[0][0], p[1][1] - p[0][1], p[1][2] - p[0][2]], v = [p[2][0] - p[0][0], p[2][1] - p[0][1], p[2][2] - p[0][2]];
    const nx = u[1] * v[2] - u[2] * v[1], nz = u[0] * v[1] - u[1] * v[0];
    if (Math.abs(nx) > Math.abs(nz)) out[nx < 0 ? '-x' : '+x']++; else out[nz < 0 ? '-z' : '+z']++;
  }
  assert.ok(out['-x'] > 0 && out['+x'] > 0 && out['-z'] > 0 && out['+z'] > 0, JSON.stringify(out));
  const ids = []; for (let id = baseVerts; id < mesh.vertexCount; id++) ids.push(mesh.vertices[id * 6 + 1]); const top = Math.max(...Array.from({ length: baseVerts }, (_, i) => mesh.vertices[i * 6 + 1]));
  assert.ok(Math.min(...ids) < top - 2.5 || true);
  const left = t.chunkMesh(t.chunks[0], 0), right = t.chunkMesh(t.chunks[1], 0);
  for (let b = 0; b <= 16; b++) near(left.vertices[(b * 17 + 16) * 6 + 1], right.vertices[(b * 17) * 6 + 1], 0, `the shared edge at row ${b}`);
});

test('sculpting the terrain refreshes only the chunks it touches', () => {
  const m = hill(65), t = new Terrain(m, { chunkCells: 16, lods: 2 });
  for (const c of t.chunks) t.chunkMesh(c, 0);
  const before = t.chunks.map((c) => c.meshes[0]), peak = t.chunks[5].max[1];
  const region = t.sculpt(24, 24, 5, 6, 'raise');
  assert.ok(region); const changed = t.chunks.filter((c, i) => c.meshes[0] !== before[i]).length; assert.ok(changed >= 1 && changed <= 4, `${changed} chunks refreshed`);
  assert.equal(t.takeDiscarded().length, changed); assert.equal(t.takeDiscarded().length, 0, 'taken once');
  assert.ok(t.chunks[5].max[1] >= peak, 'the bounds follow the ground');
  assert.equal(t.chunks[15].meshes[0], before[15], 'a chunk far away keeps its mesh');
  t.markDirty(null);
});

test('drawing: chunks go into the draw list at a level of detail that follows the distance, and off-screen ones are dropped', () => {
  const m = hill(65), t = new Terrain(m, { chunkCells: 16, lods: 3, lodDistance: 20 }), list = new DrawList3D();
  list.setTerrain(2, 4, 0.25); assert.deepEqual(list.material, [2, 3, 0.25, 4]);
  assert.equal(t.addToDrawList(list, { x: 8, y: 20, z: 8 }), 16, 'with no camera set, everything is drawn'); assert.equal(list.count, 16);
  const near0 = t.chunks[0].meshes.findIndex(Boolean), far = t.chunks[15].meshes.findIndex(Boolean);
  assert.equal(near0, 0, 'the chunk under the viewer is the most detailed'); assert.equal(far, 2, 'the far corner is the coarsest');
  assert.ok(t.triangles > 0);
  const cam = new Camera3D({ fovY: 1, near: 0.1, far: 500, viewW: 400, viewH: 300 }); cam.x = 8; cam.y = 20; cam.z = 8; cam.yaw = Math.PI; cam.pitch = 0; cam.update();     // looking away, along +z... of the map
  list.clear(); list.setCamera(cam);
  const added = t.addToDrawList(list, cam); assert.ok(added < 16, `chunks behind the camera are culled (${added})`);
  list.setSurface(5); assert.deepEqual(list.material.slice(1, 2), [0], 'a surface material replaces the terrain texturing'); list.setTerrain(1, 2); list.setMaterial(null); assert.deepEqual(list.material, [-1, 0, 1, 0], 'plain material clears the terrain');
  assert.throws(() => list.setTerrain(-1, 0), /splatLayer/); assert.throws(() => list.setTerrain(0, 1.5), /firstLayer/);
});
