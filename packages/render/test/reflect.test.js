import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBox, createSphere, DrawList3D } from '../src/index.js';

const model = (x) => { const m = new Float32Array(16); m[0] = m[5] = m[10] = m[15] = 1; m[12] = x; return m; };

test('a mesh marked reflective is remembered for the frame, and clear() forgets it', () => {
  const list = new DrawList3D(), glass = createBox(1, 1, 1), stone = createSphere(1, 8, 6);
  list.add(glass, model(0), 0.5, 0.7, 0.9, 1); list.reflect(glass); list.add(stone, model(2), 1, 1, 1, 1);
  assert.ok(list.reflective.has(glass)); assert.ok(!list.reflective.has(stone));
  assert.equal(list.groups.get(glass).count, 1, 'it is still drawn as a solid, in the same group');
  list.clear();
  assert.equal(list.reflective.size, 0);
});
