import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aabbOf, snapMove, snapCoordinate, snapPoints, pointsOf } from '../src/snap.js';

const box = (min, max) => ({ min, max });
const near = (a, b, e = 1e-9) => a.every((v, i) => Math.abs(v - b[i]) < e);

test('the world box of a turned box holds all of it', () => {
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 3, 1, 0, 1];
  const a = aabbOf(identity, [1, 0.5, 2]);
  assert.deepEqual(a.min, [2, 0.5, -2]);
  assert.deepEqual(a.max, [4, 1.5, 2]);
  const c = Math.SQRT1_2;
  const turned = [c, 0, -c, 0, 0, 1, 0, 0, c, 0, c, 0, 0, 0, 0, 1];                      // a quarter turn about y, half way: 45 degrees
  const b = aabbOf(turned, [1, 1, 1]);
  assert.ok(Math.abs(b.max[0] - Math.SQRT2) < 1e-9 && Math.abs(b.max[2] - Math.SQRT2) < 1e-9);
});

test('a move snaps so that a side of the moving box meets a side of another: face to face, and the same side to the same side', () => {
  const mover = box([0, 0, 0], [1, 1, 1]);
  const wall = box([3, 0, 0], [4, 1, 1]);
  const out = snapMove(mover, [1.92, 0, 0], [wall], { threshold: 0.25 });
  assert.ok(near(out.vector, [2, 0, 0]), 'the far side (x = 1 + 2 = 3) meets the wall\'s near side');
  assert.deepEqual(out.guides.map((g) => g.axis), [0, 1, 2], 'y and z already line up with the wall, so they show too');
  assert.equal(out.guides[0].value, 3);
  const aligned = snapMove(mover, [2.9, 0, 0], [wall], { threshold: 0.25 });
  assert.ok(near(aligned.vector, [3, 0, 0]), 'near side to near side (x = 3) is just as good: they stand side by side');
  const far = snapMove(mover, [1.5, 0, 0], [wall], { threshold: 0.25 });
  assert.ok(near(far.vector, [1.5, 0, 0]) && far.guides.every((g) => g.axis !== 0), 'too far from anything along x: x is left alone');
});

test('the middle snaps too, the nearest of all the ways wins, and only the axes allowed move', () => {
  const mover = box([0, 0, 0], [2, 2, 2]);
  const other = box([5, 0, 0], [9, 2, 2]);                                                   // its middle is at x = 7
  assert.ok(near(snapMove(mover, [5.9, 0, 0], [other], { threshold: 0.3 }).vector, [6, 0, 0]), 'its middle (x = 1 + 6 = 7) meets the other\'s middle');
  const both = snapMove(mover, [3.1, 0.04, 0], [box([5, 0, 0], [6, 2, 2])], { threshold: 0.25 });
  assert.ok(near(both.vector, [3, 0, 0]), 'x snaps to the near side at 5 and y to the floor at 0, each on its own');
  const onlyX = snapMove(mover, [3.1, 0.04, 0], [box([5, 0, 0], [6, 2, 2])], { threshold: 0.25, axes: [true, false, false] });
  assert.ok(near(onlyX.vector, [3, 0.04, 0]), 'a locked axis is left alone');
  assert.deepEqual(snapMove(mover, [3.1, 0, 0], [], { threshold: 1 }).guides, [], 'nothing to snap to');
});

test('a box far away on the other axes is not something to line up with', () => {
  const mover = box([0, 0, 0], [1, 1, 1]);
  const distant = box([3, 0, 40], [4, 1, 41]);
  const out = snapMove(mover, [1.95, 0, 0], [distant], { threshold: 0.25, near: 3 });
  assert.ok(near(out.vector, [1.95, 0, 0]), 'forty metres away in z: left alone');
  assert.ok(near(snapMove(mover, [1.95, 0, 0], [distant], { threshold: 0.25, near: 100 }).vector, [2, 0, 0]), 'unless the reach is wide');
});

test('a dragged side snaps to the sides and middles of other boxes, on its own axis', () => {
  const self = box([0, 0, 0], [2, 2, 2]);
  const target = box([3, 0, 0], [5, 2, 2]);
  const hit = snapCoordinate(2.9, 0, self, [target], { threshold: 0.2 });
  assert.equal(hit.value, 3);
  assert.equal(snapCoordinate(2.5, 0, self, [target], { threshold: 0.2 }), null, 'too far');
  assert.equal(snapCoordinate(4.05, 0, self, [target], { threshold: 0.2 }).value, 4, 'the middle');
  assert.equal(snapCoordinate(0.1, 1, self, [target], { threshold: 0.2 }).value, 0, 'another axis');
  assert.equal(snapCoordinate(2.9, 0, self, [box([3, 0, 90], [5, 2, 92])], { threshold: 0.2 }), null, 'a box far away in z does not count');
});

const IDENTITY = (x = 0, y = 0, z = 0) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
const turned = (yaw, x = 0, y = 0, z = 0) => [Math.cos(yaw), 0, -Math.sin(yaw), 0, 0, 1, 0, 0, Math.sin(yaw), 0, Math.cos(yaw), 0, x, y, z, 1];

test('the points of a thing: a box has eight corners and a middle (the real corners, turned if it is turned), a ramp six, a capsule three, a ball one', () => {
  const box = pointsOf({ matrix: IDENTITY(1, 2, 3), half: [1, 1, 1] });
  assert.equal(box.length, 9);
  assert.deepEqual(box[0], [1, 2, 3], 'the middle first');
  assert.ok(box.some((p) => near(p, [2, 3, 4])) && box.some((p) => near(p, [0, 1, 2])));
  const t = pointsOf({ matrix: turned(Math.PI / 4), half: [1, 1, 1] });
  assert.ok(t.some((p) => near(p, [Math.SQRT2, 1, 0], 1e-9)), 'a corner of a box turned half way sits out on the axis, not on a square corner');
  assert.equal(pointsOf({ matrix: IDENTITY(), half: [1, 1, 1], ramp: true }).length, 1 + 6);
  assert.equal(pointsOf({ matrix: IDENTITY(), half: [0.3, 0.8, 0.3], shape: { type: 'capsule' } }).length, 3);
  assert.deepEqual(pointsOf({ matrix: IDENTITY(2, 0, 0), half: [1, 1, 1], shape: { type: 'sphere' } }), [[2, 0, 0]]);
});

test('a corner lands exactly on a corner of another thing, and the nearest pair wins', () => {
  const mover = pointsOf({ matrix: IDENTITY(0, 0, 0), half: [0.5, 0.5, 0.5] });
  const other = { ...aabbOf(IDENTITY(3, 0, 0), [0.5, 0.5, 0.5]), points: pointsOf({ matrix: IDENTITY(3, 0, 0), half: [0.5, 0.5, 0.5] }) };
  const out = snapPoints(mover, [1.97, 0.04, 0.03], [other], { threshold: 0.2 });
  assert.ok(near(out.vector, [2, 0, 0]), 'the far corners meet the near corners: x = 0.5 + 2 = 2.5, as with the sides');
  assert.deepEqual(out.guide.to, out.guide.from, 'the guide is a ring at the meeting place');
  assert.equal(snapPoints(mover, [1.5, 0, 0], [other], { threshold: 0.2 }), null, 'too far');
  assert.equal(snapPoints(mover, [1.97, 0, 0], [{ min: [3, 0, 0], max: [4, 1, 1] }], { threshold: 0.2 }), null, 'a target with no points is for sides only');
});

test('a corner of a turned box is where it really is: snapping finds it where the sides of its holding box would not', () => {
  const yaw = 0.5;
  const targetMatrix = turned(yaw, 0, 0.5, 0);
  const target = { ...aabbOf(targetMatrix, [0.5, 0.5, 0.5]), points: pointsOf({ matrix: targetMatrix, half: [0.5, 0.5, 0.5] }) };
  const corner = target.points.find((p) => p[1] > 0.9 && p[0] > 0 && p[2] < 0);                  // one of the top corners
  const mover = pointsOf({ matrix: IDENTITY(0, 0.5, 0), half: [0.5, 0.5, 0.5] });
  const want = [corner[0] + 0.5, 0.5, corner[2] + 0.5];                                         // where the mover's middle must go to meet it with its own corner
  const close = [want[0] + 0.04, want[1] + 0.03, want[2] - 0.05].map((v, i) => v - [0, 0.5, 0][i]);
  const out = snapPoints(mover, close, [target], { threshold: 0.2 });
  assert.ok(out && Math.abs(out.guide.to[0] - corner[0]) < 1e-9 && Math.abs(out.guide.to[2] - corner[2]) < 1e-9, 'it met that very corner (the top or the bottom one of the pair)');
  const sides = snapMove({ min: [-0.5, 0, -0.5], max: [0.5, 1, 0.5] }, close, [target], { threshold: 0.2 });
  assert.ok(!near(sides.vector, out.vector, 1e-6), 'the sides of the box that holds it would have put it somewhere else');
});

test('a dragged side also meets the corners of a turned box (they are inside its holding box, not at its sides)', () => {
  const yaw = 0.5;
  const m = turned(yaw, 5, 0.5, 0);
  const target = { ...aabbOf(m, [0.5, 0.5, 0.5]), points: pointsOf({ matrix: m, half: [0.5, 0.5, 0.5] }) };
  const inner = target.points.map((p) => p[0]).sort((a, b) => a - b)[2];                         // a corner that is neither the leftmost nor the rightmost
  const self = box([0, 0, 0], [2, 2, 2]);
  assert.ok(inner > target.min[0] + 0.01 && inner < target.max[0] - 0.01);
  assert.equal(snapCoordinate(inner + 0.05, 0, self, [target], { threshold: 0.1, near: 10 }).value, inner);
});
