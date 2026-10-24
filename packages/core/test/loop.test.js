import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FixedLoop } from '../src/index.js';

test('runs the right number of fixed ticks and reports alpha', () => {
  const ticks = [];
  let alpha = -1;
  const loop = new FixedLoop({
    tickRate: 20,
    update: (_dt, t) => ticks.push(t),
    render: (a) => { alpha = a; },
  });
  assert.equal(loop.advance(0.125), 2); // 2 ticks of 50ms, 25ms left
  assert.deepEqual(ticks, [0, 1]);
  assert.ok(Math.abs(alpha - 0.5) < 1e-9);
});

test('caps huge frames to avoid the spiral of death', () => {
  const loop = new FixedLoop({ tickRate: 60, update() {}, maxFrameTime: 0.25 });
  assert.equal(loop.advance(10), 15);
});
