// A whole model made by the real meshopt encoder (positions and texture coordinates quantised to 16 bits, normals octahedral, triangles compressed) loads as the mesh it was made from.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseGltf } from '../src/index.js';

const glb = () => { const b = readFileSync(new URL('./fixtures/meshopt-quantized.glb', import.meta.url)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };

test('a meshopt-compressed, quantised model loads: positions, normals, texture coordinates and triangles', () => {
  const model = parseGltf(glb());
  assert.equal(model.warnings.length, 0);
  assert.equal(model.meshes.length, 1);
  const mesh = model.meshes[0];
  assert.equal(mesh.vertexCount, 25);
  assert.equal(mesh.indices.length, 4 * 4 * 6);
  // positions are whole numbers (the node's scale of 0.001 turns them into metres)
  assert.deepEqual(Array.from(mesh.vertices.subarray(0, 3)), [-2000, Math.round(Math.sin(0) * 500), -2000]);
  assert.deepEqual(Array.from(mesh.vertices.subarray(6 * 6, 6 * 6 + 3)), [-1000, Math.round(Math.sin(1) * 500), -1000]);
  for (let i = 0; i < 25; i++) {
    const nx = mesh.vertices[i * 6 + 3], ny = mesh.vertices[i * 6 + 4], nz = mesh.vertices[i * 6 + 5];
    assert.ok(Math.abs(nx) < 0.01 && Math.abs(ny - 1) < 0.01 && Math.abs(nz) < 0.01, `normal ${i} is up: ${nx} ${ny} ${nz}`);
  }
  assert.ok(Math.abs(mesh.uv[0]) < 1e-6 && Math.abs(mesh.uv[1]) < 1e-6);
  assert.ok(Math.abs(mesh.uv[48] - 1) < 1e-6 && Math.abs(mesh.uv[49] - 1) < 1e-6);
  assert.deepEqual(Array.from(mesh.indices.subarray(0, 6)), [0, 5, 1, 1, 5, 6]);
  assert.ok(Math.abs(model.instances[0].matrix[0] - 0.001) < 1e-9, 'the node scale is kept');
});

test('a Draco model is refused with a message that says what to do', () => {
  const doc = { asset: { version: '2.0' }, extensionsRequired: ['KHR_draco_mesh_compression'] };
  assert.throws(() => parseGltf(doc), /Draco.*meshopt/s);
});

test('damaged compressed data names the buffer view', () => {
  const b = new Uint8Array(glb());
  b[b.length - 40] ^= 0xff; b[b.length - 41] ^= 0xff; b[b.length - 60] ^= 0xff;
  try { parseGltf(b.buffer); } catch (e) { assert.match(e.message, /bufferView \d|index/); }
});
