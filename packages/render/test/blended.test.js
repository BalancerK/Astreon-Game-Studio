import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSphere, createBox, DrawList3D, INSTANCE3D_FLOATS } from '../src/index.js';

const model = (x) => { const m = new Float32Array(16); m[0] = m[5] = m[10] = m[15] = 1; m[12] = x; return m; };

test('instances added after setBlended go to their own groups, and clear() puts it back', () => {
  const list = new DrawList3D(), ball = createSphere(1, 8, 6), box = createBox(1, 1, 1);
  list.add(box, model(0), 1, 0, 0, 1);
  list.setBlended(true);
  list.add(ball, model(1), 0, 0, 1, 0.3);
  list.add(ball, model(2), 0, 0, 1, 0.3);
  list.setBlended(false);
  list.add(ball, model(3), 0, 1, 0, 1);
  assert.equal(list.groups.get(box).count, 1);
  assert.equal(list.groups.get(ball).count, 1, 'the solid ball is in the solid group');
  assert.equal(list.blended.get(ball).count, 2, 'the two translucent ones are in the blended group');
  assert.equal(list.count, 4);
  assert.equal(list.blended.get(ball).data[12], 1, 'in the order they were added');
  assert.equal(list.blended.get(ball).data[INSTANCE3D_FLOATS + 12], 2);
  list.setBlended(true);
  list.clear();
  assert.equal(list.blended.get(ball).count, 0);
  list.add(box, model(0), 1, 1, 1, 1);
  assert.equal(list.groups.get(box).count, 1, 'clear() turns blending off');
  assert.equal(list.blended.get(box), undefined);
});
