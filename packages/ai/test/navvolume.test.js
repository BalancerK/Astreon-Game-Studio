import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NavVolume } from '../src/navvolume.js';

const volume = (extra = {}) => new NavVolume({ min: [-40, 0, -40], max: [40, 40, 40], cell: 4, radius: 1, height: 4, ...extra });
const box = (x0, x1, y0, y1, z0, z1) => ({ x0, x1, y0, y1, z0, z1 });
const wall = box(-30, 30, 0, 12, -2, 2);                                     // a wall across the middle, 12 m high, 60 m wide
const length = (path) => path.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - path[i][0], p[1] - path[i][1], p[2] - path[i][2]), 0);

test('in open space the path is a straight line from start to goal', () => {
  const nav = volume();
  const r = nav.findPath([-30, 0, -30], [30, 0, 30]);
  assert.equal(r.status, 'found');
  assert.equal(r.path.length, 2, 'smoothed to start and end');
  assert.ok(Math.abs(length(r.path) - Math.hypot(60, 60)) < 6);
});

test('a wall that does not reach the sides is gone round, or flown over: whichever is shorter', () => {
  const nav = volume();
  nav.addBox(wall);
  const around = nav.findPath([0, 0, -20], [0, 0, 20]);
  assert.equal(around.status, 'found');
  const top = Math.max(...around.path.map((p) => p[1]));
  assert.ok(top >= 12 || Math.max(...around.path.map((p) => Math.abs(p[0]))) > 30, 'over the top or round the end');
  for (let i = 1; i < around.path.length; i++) assert.ok(nav.lineClear(around.path[i - 1], around.path[i]), 'every leg is clear');
  const full = volume();
  full.addBox(box(-40, 40, 0, 12, -2, 2));
  const over = full.findPath([0, 0, -20], [0, 0, 20]);
  assert.equal(over.status, 'found');
  assert.ok(Math.max(...over.path.map((p) => p[1])) >= 12, 'a wall right across has to be flown over');
});

test('a path can end high up: the goal on a platform', () => {
  const nav = volume();
  nav.addBox(box(10, 30, 16, 18, -10, 10));
  const r = nav.findPath([-20, 0, 0], [20, 18, 0]);
  assert.equal(r.status, 'found');
  const end = r.path[r.path.length - 1];
  assert.ok(end[1] >= 17 && Math.abs(end[0] - 20) < 5);
});

test('a bigger agent cannot use a gap a smaller one fits through', () => {
  const walls = [box(-40, -3, 0, 40, -2, 2), box(3, 40, 0, 40, -2, 2)];          // a 6 m gap in a wall that goes right up
  const small = volume({ radius: 1 }), big = volume({ radius: 4 });
  small.addBoxes(walls);
  big.addBoxes(walls);
  assert.equal(small.findPath([0, 0, -20], [0, 0, 20]).status, 'found');
  assert.notEqual(big.findPath([0, 0, -20], [0, 0, 20]).status, 'found');
});

test('a goal that cannot be reached gives a partial path to the nearest point, and a goal inside a wall is moved out of it', () => {
  const nav = volume();
  nav.addBoxes([box(-40, 40, 0, 40, -2, 2)]);                                   // a wall from floor to ceiling across everything
  const r = nav.findPath([0, 0, -20], [0, 0, 20]);
  assert.equal(r.status, 'partial');
  const end = r.path[r.path.length - 1];
  assert.ok(end[2] < 0, 'it got as close as the wall allowed');
  const inside = volume();
  inside.addBox(box(-5, 5, 0, 10, -5, 5));
  const into = inside.findPath([-30, 0, 0], [0, 2, 0]);
  assert.ok(['found', 'partial'].includes(into.status));
  assert.ok(inside.free(...into.path[into.path.length - 1]));
});

test('free places, the nearest free place, and lines of sight', () => {
  const nav = volume();
  nav.addBox(box(-5, 5, 0, 10, -5, 5));
  assert.equal(nav.free(0, 2, 0), false);
  assert.equal(nav.free(20, 0, 20), true);
  assert.equal(nav.free(0, 12, 0), true, 'above the block is free');
  assert.equal(nav.free(500, 0, 0), false, 'outside the space is not');
  const p = nav.nearestFree(0, 2, 0);
  assert.ok(p && nav.free(...p));
  assert.equal(nav.lineClear([-30, 0, 0], [30, 0, 0]), false);
  assert.equal(nav.lineClear([-30, 0, 20], [30, 0, 20]), true);
  assert.equal(nav.lineClear([-30, 20, 0], [30, 20, 0]), true, 'over the top');
});

test('the same question always gives the same path, and a version number says when the boxes changed', () => {
  const make = () => { const n = volume(); n.addBoxes([wall, box(10, 20, 0, 30, 5, 15)]); return n; };
  const a = make().findPath([-30, 0, -30], [30, 10, 30]), b = make().findPath([-30, 0, -30], [30, 10, 30]);
  assert.deepEqual(a, b);
  const nav = volume();
  const v = nav.version;
  nav.addBox(wall);
  assert.ok(nav.version > v);
});

test('a big space is searched fast enough to ask every few ticks', () => {
  const nav = volume({ cell: 2 });
  nav.addBoxes([wall, box(-10, 10, 0, 30, 10, 14), box(15, 25, 0, 20, -20, -10)]);
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < 5; i++) nav.findPath([-35, 0, -35], [35, 15, 35]);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6 / 5;
  assert.ok(ms < 200, `${ms.toFixed(1)} ms a search`);
});

test('the ground can be added as a height function: paths go over a hill, or round it, and never through it', () => {
  const nav = volume({ min: [-40, -8, -40], max: [40, 60, 40], cell: 4 });
  const hill = (x, z) => Math.max(-2, 30 - Math.hypot(x, z) * 1.5);                  // a cone 30 m high, 20 m across at the foot, over a plain at -2
  nav.addHeightfield(hill);
  assert.equal(nav.free(0, 0, 0), false, 'inside the hill');
  assert.equal(nav.free(0, 40, 0), true, 'above it');
  assert.equal(nav.free(30, 0, 30), true, 'on the plain');
  const r = nav.findPath([-35, 0, 0], [35, 0, 0]);
  assert.equal(r.status, 'found');
  for (let i = 1; i < r.path.length; i++) assert.ok(nav.lineClear(r.path[i - 1], r.path[i]), 'every leg is clear of the ground');
  const climb = nav.findPath([-35, 0, 0], [0, 33, 0]);
  assert.ok(['found', 'partial'].includes(climb.status));
  assert.ok(climb.path[climb.path.length - 1][1] > 20, 'a goal on top of the hill is reached high up');
});
