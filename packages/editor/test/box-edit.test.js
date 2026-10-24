import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boxFeatures, moveFeature, describeFeature, nearestFeature, MIN_HALF } from '../src/index.js';

const near = (a, b, e = 1e-9) => a.every((v, i) => Math.abs(v - b[i]) < e);

test('a box has six faces and twelve edges, each with its place on the box', () => {
  const f = boxFeatures([1, 2, 3]);
  assert.equal(f.filter((x) => x.kind === 'face').length, 6);
  assert.equal(f.filter((x) => x.kind === 'edge').length, 12);
  assert.equal(new Set(f.map((x) => x.id)).size, 18, 'every handle has its own id');
  assert.deepEqual(f.find((x) => x.id === 'x+').point, [1, 0, 0]);
  assert.deepEqual(f.find((x) => x.id === 'z-').point, [0, 0, -3]);
  const edge = f.find((x) => x.id === 'y+z-');
  assert.deepEqual(edge.point, [0, 2, -3]);
  assert.equal(edge.along, 0, 'the edge runs along x');
  assert.deepEqual(f.filter((x) => x.kind === 'edge').map((x) => x.along).sort(), [0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2]);
});

test('dragging a face moves that side only: the box grows that way and its middle follows, the other side stays still', () => {
  const half = [1, 1, 1];
  const right = boxFeatures(half).find((x) => x.id === 'x+');
  const out = moveFeature(half, right, [2, 0, 0]);
  assert.deepEqual(out.half, [2, 1, 1], 'two units wider');
  assert.deepEqual(out.shift, [1, 0, 0], 'the middle moves half of that');
  assert.ok(Math.abs(-half[0] + 0) === 1 && out.shift[0] - out.half[0] === -1, 'the left side is still at -1 (the middle is at 1, half is 2)');
  const left = boxFeatures(half).find((x) => x.id === 'x-');
  const grown = moveFeature(half, left, [-2, 0, 0]);
  assert.deepEqual(grown.half, [2, 1, 1], 'dragging the left face out (towards -x) grows it');
  assert.deepEqual(grown.shift, [-1, 0, 0]);
  assert.equal(grown.shift[0] + grown.half[0], 1, 'and the right side is still at +1');
  const inward = moveFeature(half, left, [1, 0, 0]);
  assert.deepEqual(inward.half, [0.5, 1, 1], 'dragging the left face in makes it narrower');
  assert.deepEqual(inward.shift, [0.5, 0, 0]);
});

test('only the parts along the feature count, and a side cannot be pushed through the other', () => {
  const half = [1, 2, 3];
  const top = boxFeatures(half).find((x) => x.id === 'y+');
  assert.deepEqual(moveFeature(half, top, [5, 1, 7]).half, [1, 2.5, 3], 'sideways and deep parts are ignored');
  const squash = moveFeature(half, top, [0, -100, 0]);
  assert.ok(Math.abs(squash.half[1] - MIN_HALF) < 1e-9, 'flattened, never inside out');
  assert.ok(Math.abs(squash.moved[1] + 2 * (2 - MIN_HALF)) < 1e-9, 'and it says how far it really moved');
  assert.ok(squash.half[1] > 0);
});

test('an edge moves two sides at once, each as a face would', () => {
  const half = [1, 1, 1];
  const edge = boxFeatures(half).find((x) => x.id === 'y+z-');            // the top back edge
  const out = moveFeature(half, edge, [0, 1, -2]);
  assert.deepEqual(out.half, [1, 1.5, 2], 'taller by 1 and deeper by 2');
  assert.deepEqual(out.shift, [0, 0.5, -1]);
  const other = moveFeature(half, boxFeatures(half).find((x) => x.id === 'x-y-'), [-1, -1, 0]);
  assert.deepEqual(other.half, [1.5, 1.5, 1]);
  assert.deepEqual(other.shift, [-0.5, -0.5, 0]);
  const mixed = moveFeature(half, edge, [0, -1, -2]);
  assert.deepEqual(mixed.half, [1, 0.5, 2], 'one side in and one side out');
});

test('the nearest handle to the pointer wins, within reach, and a nearer one is preferred when two overlap', () => {
  const list = [{ id: 'a', x: 100, y: 100, depth: 10 }, { id: 'b', x: 140, y: 100, depth: 10 }, { id: 'c', x: 101, y: 100, depth: 5 }];
  assert.equal(nearestFeature(list.slice(0, 2), 108, 100), 'a');
  assert.equal(nearestFeature(list.slice(0, 2), 125, 100), null, 'too far from both');
  assert.equal(nearestFeature(list, 100, 100), 'c', 'a handle in front of another one at the same place is the one you mean');
  assert.equal(nearestFeature([], 0, 0), null);
  const over = [{ id: 'edge', kind: 'edge', x: 100, y: 100, depth: 5 }, { id: 'face', kind: 'face', x: 104, y: 100, depth: 9 }];
  assert.equal(nearestFeature(over, 100, 100), 'face', 'a face under an edge handle is still the one you get when they are close');
  assert.equal(nearestFeature([{ id: 'edge', kind: 'edge', x: 100, y: 100, depth: 5 }, { id: 'face', kind: 'face', x: 112, y: 100, depth: 9 }], 100, 100), 'edge', 'but not when the edge is clearly closer');
  assert.equal(describeFeature(boxFeatures([1, 1, 1]).find((x) => x.id === 'x+')), 'right face');
  assert.equal(describeFeature(boxFeatures([1, 1, 1]).find((x) => x.id === 'y+z-')), 'top back edge');
});
