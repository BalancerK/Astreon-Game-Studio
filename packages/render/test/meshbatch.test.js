import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MeshBatch2D, MESH_VERTEX_WORDS, MESH_VERTEX_BYTES, META_ADDITIVE, packTint } from '../src/index.js';

const sprite = { u0: 0.25, v0: 0.5, u1: 0.5, v1: 0.75, page: 3 };

test('a mesh batch holds vertices of position, atlas place, tint and page, with indices counted from each mesh', () => {
  const m = new MeshBatch2D(4, 6);
  assert.equal(MESH_VERTEX_BYTES, MESH_VERTEX_WORDS * 4);
  m.push([0, 0, 10, 0, 0, 10], [0, 0, 1, 0, 0, 1], [0, 1, 2], 2, packTint(255, 0, 0));
  m.push([5, 5, 6, 5, 5, 6], [0, 0, 1, 0, 0, 1], [0, 1, 2], 1, packTint(0, 255, 0), true);
  assert.equal(m.vertexCount, 6); assert.equal(m.indexCount, 6); assert.deepEqual(Array.from(m.indices.slice(0, 6)), [0, 1, 2, 3, 4, 5], 'the second mesh counts from its own first vertex');
  assert.deepEqual(Array.from(m.f32.slice(MESH_VERTEX_WORDS, MESH_VERTEX_WORDS + 4)), [10, 0, 1, 0]);
  assert.equal(m.u32[4], packTint(255, 0, 0)); assert.equal(m.u32[5], 2); assert.equal(m.u32[3 * MESH_VERTEX_WORDS + 5], 1 | META_ADDITIVE);
  m.clear(); assert.deepEqual([m.vertexCount, m.indexCount], [0, 0]);
});

test('growing keeps what was already there', () => {
  const m = new MeshBatch2D(2, 3);
  for (let i = 0; i < 100; i++) m.push([i, 0, i + 1, 0, i, 1], [0, 0, 1, 0, 0, 1], [0, 1, 2], 0);
  assert.equal(m.vertexCount, 300); assert.equal(m.indexCount, 300);
  assert.equal(m.f32[0], 0); assert.equal(m.f32[99 * 3 * MESH_VERTEX_WORDS], 99); assert.equal(m.indices[299], 299); assert.ok(m.f32.length >= 300 * MESH_VERTEX_WORDS);
  const base = m.begin(3, 3); assert.equal(base, 300);
});

test('a sprite as a quad: two triangles, uvs from the sprite, corners where you put them', () => {
  const m = new MeshBatch2D();
  m.pushQuad(sprite, [0, 0, 20, 5, 22, 30, -2, 25], packTint(1, 2, 3, 4));
  assert.equal(m.vertexCount, 4); assert.deepEqual(Array.from(m.indices.slice(0, 6)), [0, 1, 2, 0, 2, 3]);
  const uvs = []; for (let i = 0; i < 4; i++) uvs.push(m.f32[i * MESH_VERTEX_WORDS + 2], m.f32[i * MESH_VERTEX_WORDS + 3]);
  assert.deepEqual(uvs, [0.25, 0.5, 0.5, 0.5, 0.5, 0.75, 0.25, 0.75]); assert.equal(m.f32[MESH_VERTEX_WORDS * 3], -2); assert.equal(m.u32[5], 3); assert.equal(m.u32[4], packTint(1, 2, 3, 4));
});
