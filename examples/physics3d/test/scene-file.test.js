import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildPlayground } from '../scene.js';
import { createLibrary } from '../prefabs.js';
import { validateScene } from '../../../packages/scene/src/index.js';

const yard = JSON.parse(readFileSync(new URL('../scenes/yard.json', import.meta.url), 'utf8'));
const run = (play, seconds) => { for (let i = 0; i < Math.round(seconds * 60); i++) { play.tick(1 / 60); play.world.step(1 / 60); } };
const snap = (play) => play.world.bodies.map((b) => [b.shape.type, +b.x.toFixed(5), +b.y.toFixed(5), +b.z.toFixed(5), b.mass]).sort((a, b) => JSON.stringify(a) < JSON.stringify(b) ? -1 : 1);

test('the yard scene file is valid for the playground\'s prefabs', () => {
  assert.deepEqual(validateScene(yard, { library: createLibrary() }), []);
  assert.equal(yard.entities.length, 58);
});

test('built from the scene file, the playground is the same world as the one built by code (and stays the same as it plays)', () => {
  const byCode = buildPlayground(), byFile = buildPlayground({ scene: yard });
  assert.equal(byFile.world.bodies.length, byCode.world.bodies.length);
  assert.equal(byFile.spawned.length, byCode.spawned.length);
  const close = (x, y, eps) => x.length === y.length && x.every((r, i) => r[0] === y[i][0] && r.slice(1, 4).every((v, k) => Math.abs(v - y[i][k + 1]) <= eps));
  assert.ok(close(snap(byFile), snap(byCode), 1e-9), 'same bodies in the same places at the start');
  run(byCode, 3); run(byFile, 3);
  // (a stack of crates that exactly touch settles a little differently from a rounding error, so compare the wall with a tolerance)
  const wall = (play) => play.world.bodies.filter((b) => b.mass === 8 && b.z < -11.5 && b.z > -12.5).map((b) => [b.x, b.y, b.z]).sort((p, q) => Math.round(p[0] * 20) - Math.round(q[0] * 20) || Math.round(p[1] * 5) - Math.round(q[1] * 5));
  const w1 = wall(byCode), w2 = wall(byFile);
  assert.equal(w1.length, 42); assert.equal(w2.length, 42);
  assert.ok(w1.every((p, i) => Math.hypot(p[0] - w2[i][0], p[1] - w2[i][1], p[2] - w2[i][2]) < 0.03), 'the wall stands the same');
  assert.ok(byFile.world.bodies.every((b) => Number.isFinite(b.x + b.y + b.z)));
  assert.equal(byFile.door.state, 'closed');
  byFile.reset(); assert.equal(byFile.spawned.length, 58 - 0); assert.equal(byFile.world.bodies.length, byCode.world.bodies.length, 'reset rebuilds from the file');
});
