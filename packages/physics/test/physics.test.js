import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SpatialHash, sweepAabbVsAabb, moveAndSlide, createMoveResult, substepCount } from '../src/index.js';

/** Deterministic PRNG so failures reproduce. */
function rng(seed) {
  return () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
}

function makeHash(boxes, cellSize = 10, size = 200) {
  const h = new SpatialHash({ width: size, height: size, cellSize, capacity: boxes.length + 8 });
  boxes.forEach((b, i) => h.insert(i, b.x, b.y, b.hw, b.hh, b.group ?? 1));
  h.build();
  return h;
}

test('narrow phase: head-on hit, miss, parallel touch, overlap', () => {
  const out = {};
  assert.ok(sweepAabbVsAabb(0, 0, 1, 1, 10, 0, 10, 0, 1, 1, out));
  assert.ok(Math.abs(out.t - 0.8) < 1e-12 && out.nx === -1 && out.ny === 0);
  assert.ok(!sweepAabbVsAabb(0, 0, 1, 1, 10, 0, 10, 5, 1, 1, out), 'passes above');
  assert.ok(!sweepAabbVsAabb(0, 2, 1, 1, 10, 0, 10, 0, 1, 1, out), 'sliding along a touching face is not a hit');
  assert.ok(!sweepAabbVsAabb(0, 0, 1, 1, -10, 0, 10, 0, 1, 1, out), 'moving away');
  assert.ok(sweepAabbVsAabb(0.5, 0, 1, 1, 0, 0, 0, 0, 1, 1, out) && out.t === 0, 'already overlapping');
});

test('broad phase sweep matches brute force on random scenes', () => {
  const r = rng(12345);
  for (let scene = 0; scene < 60; scene++) {
    const boxes = [];
    for (let i = 0; i < 80; i++) boxes.push({ x: 20 + r() * 160, y: 20 + r() * 160, hw: 0.5 + r() * 6, hh: 0.5 + r() * 6 });
    const cellSize = [4, 10, 25][scene % 3];
    const h = makeHash(boxes, cellSize);
    for (let q = 0; q < 40; q++) {
      const hw = r() < 0.2 ? 0 : 0.2 + r() * Math.min(cellSize, 4);
      const hh = hw === 0 ? 0 : 0.2 + r() * Math.min(cellSize, 4);
      const cx = 20 + r() * 160, cy = 20 + r() * 160;
      const dx = (r() - 0.5) * 120, dy = (r() - 0.5) * 120;
      const out = {};
      let bestT = Infinity;
      for (let i = 0; i < boxes.length; i++) {
        const b = boxes[i];
        if (sweepAabbVsAabb(cx, cy, hw, hh, dx, dy, b.x, b.y, b.hw, b.hh, out) && out.t < bestT) bestT = out.t;
      }
      const hit = {};
      const found = h.sweep(cx, cy, hw, hh, dx, dy, 0xffffffff, -1, hit);
      // Brute force only counts hits inside the grid; clamp motion check by comparing finite results.
      const endsInside = cx + dx >= 0 && cx + dx < 200 && cy + dy >= 0 && cy + dy < 200;
      if (!endsInside) continue;
      assert.equal(found, bestT !== Infinity, `scene ${scene} query ${q}`);
      if (found) assert.ok(Math.abs(hit.t - bestT) < 1e-9, `scene ${scene} query ${q}: ${hit.t} vs ${bestT}`);
    }
  }
});

test('fast mover cannot tunnel through a thin wall', () => {
  const h = makeHash([{ x: 100, y: 100, hw: 0.05, hh: 50 }]);
  const res = createMoveResult();
  moveAndSlide(h, 10, 100, 1, 1, 180, 0, 0xffffffff, -1, res); // 180 units in one tick
  assert.ok(res.hit);
  assert.ok(res.x < 100 - 0.05 - 1 + 1e-6, `stopped before wall, x=${res.x}`);
  assert.equal(res.nx, -1);
});

test('slides along a wall keeping the parallel component', () => {
  const h = makeHash([{ x: 100, y: 100, hw: 2, hh: 80 }]);
  const res = createMoveResult();
  moveAndSlide(h, 90, 100, 1, 1, 30, 20, 0xffffffff, -1, res);
  assert.ok(res.hit);
  assert.ok(Math.abs(res.y - 120) < 1e-3, `slid the full vertical distance, y=${res.y}`);
  assert.ok(res.x < 97 && res.x > 96.9, `pressed against wall, x=${res.x}`);
});

test('inner corner stops the mover without escaping', () => {
  const h = makeHash([
    { x: 100, y: 60, hw: 80, hh: 2 }, // ceiling
    { x: 100, y: 100, hw: 2, hh: 60 }, // wall
  ]);
  const res = createMoveResult();
  moveAndSlide(h, 90, 70, 1, 1, 40, -40, 0xffffffff, -1, res);
  assert.ok(res.x < 97.01 && res.y > 63 - 1e-6, `stayed in the corner, got ${res.x},${res.y}`);
});

test('mask and ignore filter collisions', () => {
  const h = makeHash([
    { x: 50, y: 50, hw: 2, hh: 2, group: 2 },
    { x: 60, y: 50, hw: 2, hh: 2, group: 4 },
  ]);
  const hit = {};
  assert.ok(h.sweep(0, 50, 0, 0, 100, 0, 4, -1, hit));
  assert.equal(hit.index, 1, 'group 2 box ignored by mask 4');
  assert.ok(!h.sweep(0, 50, 0, 0, 100, 0, 4, 1, hit), 'ignored index skipped');
});

test('queryRect dedupes multi-cell boxes and respects mask', () => {
  const h = makeHash([
    { x: 50, y: 50, hw: 30, hh: 30 }, // spans many cells
    { x: 150, y: 150, hw: 1, hh: 1 },
    { x: 52, y: 52, hw: 1, hh: 1, group: 2 },
  ]);
  const out = new Int32Array(8);
  const n = h.queryRect(40, 40, 60, 60, out);
  assert.deepEqual([...out.subarray(0, n)].sort(), [0, 2]);
  assert.equal(h.queryRect(40, 40, 60, 60, out, 2), 1);
});

test('hash can be rebuilt every tick and grows its cell list', () => {
  const h = new SpatialHash({ width: 100, height: 100, cellSize: 5, capacity: 4 });
  for (let tick = 0; tick < 3; tick++) {
    h.clear();
    h.insert(0, 50, 50, 40, 40); // covers most cells: forces cellItems growth
    h.insert(1, 10, 10, 1, 1);
    h.build();
    const out = new Int32Array(4);
    assert.equal(h.queryRect(0, 0, 100, 100, out), 2);
  }
});

test('substepCount scales with speed and is bounded', () => {
  assert.equal(substepCount(10, 1 / 60, 2), 1);
  assert.equal(substepCount(600, 1 / 60, 2), 8, 'capped at maxSteps');
  assert.equal(substepCount(600, 1 / 60, 2, 20), 10);
  assert.equal(substepCount(60, 1 / 60, 2), 1);
});
