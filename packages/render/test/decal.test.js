import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDecal, meshTriangles, createBox, Heightmap, Terrain } from '../src/index.js';

const near = (a, b, eps = 1e-5, msg = '') => assert.ok(Math.abs(a - b) <= eps, `${msg} ${a} vs ${b}`);
/** A flat floor of two triangles from (-5, 0, -5) to (5, 0, 5), facing up. */
const floor = Float32Array.of(-5, 0, -5, -5, 0, 5, 5, 0, -5, 5, 0, -5, -5, 0, 5, 5, 0, 5);
const verts = (mesh) => Array.from({ length: mesh.vertexCount }, (_, i) => [mesh.vertices[i * 6], mesh.vertices[i * 6 + 1], mesh.vertices[i * 6 + 2]]);

test('a decal on a floor: a square of the size asked for, lifted a little, facing up, with uvs over the whole picture', () => {
  const d = createDecal(floor, { position: [1, 0, 2], size: 2, depth: 1, offset: 0.02 });
  const v = verts(d), xs = v.map((p) => p[0]), zs = v.map((p) => p[2]);
  near(Math.min(...xs), 0, 1e-5); near(Math.max(...xs), 2, 1e-5); near(Math.min(...zs), 1, 1e-5); near(Math.max(...zs), 3, 1e-5); assert.ok(v.every((p) => Math.abs(p[1] - 0.02) < 1e-6), 'lifted by the offset');
  assert.ok(d.vertices.every((x, i) => i % 6 !== 4 || x > 0.99), 'normals point up'); near(Math.min(...d.uv), 0, 1e-5); near(Math.max(...d.uv), 1, 1e-5);
  let area = 0; for (let k = 0; k < d.indices.length; k += 3) { const a = v[d.indices[k]], b = v[d.indices[k + 1]], c = v[d.indices[k + 2]]; const cross = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]); assert.ok(cross > 0, 'counter-clockwise from above'); area += cross / 2; }
  near(area, 4, 1e-4, 'the area of a 2 x 2 decal');
  assert.equal(d.name, 'decal'); assert.equal(createDecal(floor, { position: [0, 0, 0], name: 'hole' }).name, 'hole');
});

test('uv follow the picture: its top is toward the decal\'s up, and rotation turns it', () => {
  const uvAt = (d, x, z) => { const v = verts(d); let best = 0, dist = Infinity; v.forEach((p, i) => { const q = Math.hypot(p[0] - x, p[2] - z); if (q < dist) { dist = q; best = i; } }); return [d.uv[best * 2], d.uv[best * 2 + 1]]; };
  const d = createDecal(floor, { position: [0, 0, 0], size: 2, normal: [0, 1, 0] });
  const a = uvAt(d, 1, 1), b = uvAt(d, -1, -1);
  assert.ok(Math.abs(a[0] - b[0]) > 0.9 && Math.abs(a[1] - b[1]) > 0.9, 'opposite corners get opposite uvs');
  const r = createDecal(floor, { position: [0, 0, 0], size: 2, rotation: Math.PI / 2 }), a2 = uvAt(r, 1, 1);
  assert.ok(Math.abs(a2[0] - a[0]) > 0.9 || Math.abs(a2[1] - a[1]) > 0.9, 'a quarter turn moves where the corners are'); assert.equal(verts(r).length, verts(d).length);
  const cell = createDecal(floor, { position: [0, 0, 0], size: 2, uvRect: [0.5, 0, 1, 0.5] }); assert.ok(cell.uv.every((x, i) => (i % 2 === 0 ? x >= 0.5 - 1e-6 && x <= 1 + 1e-6 : x >= -1e-6 && x <= 0.5 + 1e-6)), 'an atlas cell');
});

test('a rectangle, and the box limits: nothing beyond the size or the depth', () => {
  const wide = createDecal(floor, { position: [0, 0, 0], size: [4, 1] }), xs = verts(wide).map((p) => p[0]), zs = verts(wide).map((p) => p[2]);
  near(Math.max(...xs) - Math.min(...xs), 4, 1e-5); near(Math.max(...zs) - Math.min(...zs), 1, 1e-5);
  assert.equal(createDecal(floor, { position: [0, 3, 0], size: 2, depth: 1 }), null, 'a surface further than half the depth away is not touched'); assert.ok(createDecal(floor, { position: [0, 0.4, 0], size: 2, depth: 1 }));
  assert.equal(createDecal(floor, { position: [20, 0, 0], size: 2 }), null, 'a box away from the surface');
  const edge = createDecal(floor, { position: [5, 0, 0], size: 4 }), ex = verts(edge).map((p) => p[0]); near(Math.max(...ex), 5, 1e-5, 'cut off where the floor ends');
});

test('surfaces facing away are left alone, and a decal bends around a corner it can see', () => {
  const wall = Float32Array.of(5, 0, -5, 5, 0, 5, 5, 4, -5, 5, 4, -5, 5, 0, 5, 5, 4, 5);          // a wall at x = 5 facing -x... check which way it faces below
  const faces = (tri) => { const u = [tri[3] - tri[0], tri[4] - tri[1], tri[5] - tri[2]], w = [tri[6] - tri[0], tri[7] - tri[1], tri[8] - tri[2]]; return [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]]; };
  const wn = faces(wall); const out = wn[0] > 0 ? [1, 0, 0] : [-1, 0, 0];
  assert.equal(createDecal(wall, { position: [5, 1, 0], size: 2, normal: out.map((x) => -x) }), null, 'a decal facing away from a wall does not stick to it');
  const hit = createDecal(wall, { position: [5, 1, 0], size: 2, normal: out }); assert.ok(hit); assert.ok(verts(hit).every((p) => Math.abs(p[0] - (5 + out[0] * 0.01)) < 1e-5), 'on the wall, lifted off it');
  assert.equal(createDecal(wall, { position: [5, 1, 0], size: 2, normal: [0, 1, 0] }), null, 'a floor decal does not wrap onto a wall');
  assert.ok(createDecal(wall, { position: [5, 1, 0], size: 2, normal: [out[0], 0.9, 0], maxAngle: 89 }), 'unless it is allowed to');
  const both = new Float32Array(floor.length + wall.length); both.set(floor); both.set(wall, floor.length);
  const corner = createDecal(both, { position: [4.5, 0.5, 0], size: 3, depth: 4, normal: [0, 1, 0], maxAngle: 100 }); assert.ok(corner.vertexCount >= 6, 'both surfaces');
});

test('decals on a mesh: its triangles, placed in the world', () => {
  const box = createBox(2, 2, 2);
  const tris = meshTriangles(box); assert.equal(tris.length, box.indices.length * 3);
  const placed = meshTriangles(box, Float32Array.of(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 10, 0, 0, 1)); near(placed[0] - tris[0], 10);
  const top = createDecal(placed, { position: [10, 1, 0], size: 1, normal: [0, 1, 0] }); assert.ok(top); assert.ok(verts(top).every((p) => Math.abs(p[1] - 1.01) < 1e-5));
  assert.throws(() => createDecal(floor, {}), /needs a position/); assert.throws(() => createDecal(floor, { position: [0, 0, 0], size: 0 }), /positive/);
  assert.equal(createDecal(new Float32Array(0), { position: [0, 0, 0] }), null);
  const bad = Float32Array.of(0, 0, 0, 1, 0, 0, 2, 0, 0); assert.equal(createDecal(bad, { position: [1, 0, 0], size: 4 }), null, 'a triangle with no area is skipped');
});

test('decals on terrain follow every bump of the ground, however far from flat', () => {
  const map = Heightmap.fromNoise({ size: 65, seed: 4, amplitude: 12, frequency: 8 }), terrain = new Terrain(map, { chunkCells: 16, lods: 2 });
  const x = 30, z = 31, y = map.heightAt(x, z), d = terrain.createDecal({ position: [x, y, z], size: 6, depth: 6, offset: 0.03 });
  assert.ok(d && d.vertexCount >= 4);
  for (const p of verts(d)) { const ground = map.heightAt(p[0], p[2]); assert.ok(p[1] > ground - 1e-3 && p[1] < ground + 0.05, `a vertex at ${p} is on the ground (${ground})`); }
  const inside = verts(d).every((p) => Math.hypot(p[0] - x, p[2] - z) < 6); assert.ok(inside, 'inside the box');
  const steep = Heightmap.fromFunction(33, (px) => px * 1.5, { cell: 1 }), t2 = new Terrain(steep, { chunkCells: 16, lods: 2 });
  const onSlope = t2.createDecal({ position: [16, steep.heightAt(16, 16), 16], size: 4, depth: 5 }); assert.ok(onSlope, 'with the facing taken from the ground');
  assert.equal(t2.createDecal({ position: [16, steep.heightAt(16, 16), 16], size: 4, depth: 5, normal: [0, -1, 0] }), null, 'facing into the ground: nothing');
});
