import { test } from 'node:test';
import assert from 'node:assert/strict';
import { snapStretch } from '../src/snap.js';

const box = (min, max, id) => ({ min, max, id });
const SELF = box([-0.5, 0, -0.5], [0.5, 1, 0.5]);
const near = (a, b) => Math.abs(a - b) < 1e-9;

test('a side snaps to where it meets the side of another box: the top of a block grows to the top of a taller one', () => {
  const tall = box([2, 0, -1], [4, 4, 1], 'tower');
  const out = snapStretch(6.8, [{ half: 0.5, centre: 0.5, k: 1 }], [tall], SELF, { threshold: 0.2 });       // asked for half 3.4: its top would be at 3.9
  assert.ok(near(out.factor, 7), 'half 3.5 puts the top at 4, level with the tower\'s');
  assert.equal(out.kind, 'side');
  assert.equal(out.value, 4);
  assert.equal(out.target.id, 'tower');
  assert.equal(snapStretch(6, [{ half: 0.5, centre: 0.5, k: 1 }], [tall], SELF, { threshold: 0.2 }), null, 'half 3 is 0.5 from anything: nothing happens');
});

test('the middle of another box is a place too, and so is the floor', () => {
  const tall = box([2, 0, -1], [4, 4, 1], 'tower');
  const mid = snapStretch(3.1, [{ half: 0.5, centre: 0.5, k: 1 }], [tall], SELF, { threshold: 0.2 });
  assert.ok(near(mid.factor, 3) && mid.value === 2, 'half 1.5 puts the top at 2, the tower\'s middle');
  const flat = snapStretch(1.1, [{ half: 0.5, centre: 0.5, k: 1 }], [], SELF, { threshold: 0.2 });
  assert.ok(near(flat.factor, 1) && flat.value === 0, 'with nothing else about, the floor: the lower side stays at 0 (a stretch about the middle that keeps its feet on the ground)');
});

test('the same size as another box is a place too: a width that matches', () => {
  const wide = box([5, 0, -1], [9, 2, 1], 'slab');                                    // 4 wide: half 2
  const out = snapStretch(3.9, [{ half: 0.5, centre: 0, k: 0 }], [wide], box([-0.5, 0, -0.5], [0.5, 1, 0.5]), { threshold: 0.2, near: 10, floor: false });
  assert.ok(near(out.factor, 4) && out.kind === 'size', 'half 2: as wide as the slab');
  assert.equal(out.target.id, 'slab');
});

test('with several axes stretching together (an even stretch) the nearest snap on any of them decides, and all follow it', () => {
  const tower = box([2, 0, -1], [4, 4, 1], 'tower');
  const axes = [{ half: 0.5, centre: 0, k: 0 }, { half: 0.5, centre: 0.5, k: 1 }, { half: 0.5, centre: 0, k: 2 }];
  const out = snapStretch(6.9, axes, [tower], SELF, { threshold: 0.2, near: 10, floor: false });
  assert.ok(near(out.factor, 7) && out.axis === 1, 'the height met the top of the tower at half 3.5, and the width and depth would grow to match');
});

test('a box that is not aligned with a world axis cannot snap on that axis, a far box does not count, and nothing is ever flat', () => {
  const tall = box([2, 0, -1], [4, 4, 1], 'tower');
  assert.equal(snapStretch(6.8, [{ half: 0.5, centre: 0.5, k: null }], [tall], SELF, { threshold: 0.2 }), null);
  const distant = box([2, 0, 60], [4, 4, 62], 'far');
  assert.equal(snapStretch(6.8, [{ half: 0.5, centre: 0.5, k: 1 }], [distant], SELF, { threshold: 0.2, floor: false }), null, 'sixty metres away');
  assert.equal(snapStretch(0.04, [{ half: 0.5, centre: 0.5, k: 1 }], [box([0, 0, 0], [0.04, 0.04, 0.04])], SELF, { threshold: 0.2, floor: false }), null, 'a size under 5 cm is not offered');
});
