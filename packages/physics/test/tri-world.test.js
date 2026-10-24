import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TriWorld } from '../src/index.js';

/** A tilted grid of triangles, nine numbers each, as `Heightmap.toTriangles()` in @engine/render makes them. */
function slopedGrid(n) {
  const h = (x, z) => 0.5 * x + 0.1 * z, out = [];
  for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) out.push(x, h(x, z), z, x, h(x, z + 1), z + 1, x + 1, h(x + 1, z), z, x + 1, h(x + 1, z), z, x, h(x, z + 1), z + 1, x + 1, h(x + 1, z + 1), z + 1);
  return { tris: Float32Array.from(out), h };
}

test('addTriangles takes triangles as nine numbers each, so terrain can be walked on', () => {
  const { tris, h } = slopedGrid(16);
  const w = new TriWorld({ cellSize: 4 }); w.addTriangles(tris); w.build();
  const hit = {};
  assert.ok(w.raycast(8.25, 50, 6.75, 0, -1, 0, 100, hit));
  assert.ok(Math.abs(50 - hit.t - h(8.25, 6.75)) < 1e-3, `meets the ground at ${50 - hit.t}, expected ${h(8.25, 6.75)}`);
  assert.equal(w.raycast(40, 50, 40, 0, -1, 0, 100, {}), false, 'nothing beyond the grid');
});
