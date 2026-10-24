import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildArenaLevel } from '../shared/level.js';
import { surfaceNormal } from '../client/surface.js';

const { parts } = buildArenaLevel();
const near = (n, e) => assert.ok(n.every((v, i) => Math.abs(v - e[i]) < 1e-6), `${n} is not ${e}`);

test('the ground faces up and a tower wall faces out, whichever way the shot came from', () => {
  near(surfaceNormal(parts, [20, 0, 20], [0, 1, 0]), [0, 1, 0]);
  near(surfaceNormal(parts, [10, 3, 2], [1, 0, 0]), [1, 0, 0]);
  near(surfaceNormal(parts, [-10, 3, 2], [-1, 0, 0]), [-1, 0, 0]);
  near(surfaceNormal(parts, [3, 6, 4], [0, 1, 0]), [0, 1, 0]);
});

test('a ramp has a slanted normal on the side the shooter is on', () => {
  const up = surfaceNormal(parts, [0, 3, 16], [0, 1, 0.5]);
  assert.ok(up[1] > 0.7 && up[2] > 0.3, `${up}`);
  assert.ok(Math.abs(Math.hypot(...up) - 1) < 1e-9);
  const down = surfaceNormal(parts, [0, 3, 16], [0, -1, -0.5]);
  assert.ok(down[1] < -0.7, 'seen from below, the other face');
});

test('a point that is not on any surface faces back toward the shooter', () => {
  near(surfaceNormal(parts, [5, 30, 5], [0, 0, 2]), [0, 0, 1]);
});
