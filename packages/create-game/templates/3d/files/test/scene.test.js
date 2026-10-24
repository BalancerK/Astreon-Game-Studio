import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateScene } from '@engine/scene';
import { Transform } from '@engine/prefab';
import { createLibrary } from '../src/prefabs.js';
import { createPlay } from '../src/play.js';

const scene = JSON.parse(readFileSync(new URL('../scenes/main.json', import.meta.url), 'utf8'));

test('the scene file is valid for the prefab library', () => {
  assert.deepEqual(validateScene(scene, { library: createLibrary() }), []);
});

test('the scene spawns every entity, children of prefabs included', () => {
  const play = createPlay(scene);
  assert.equal(play.loaded.instances.size, scene.entities.length);
  assert.equal(play.loaded.get('tower-1').entities.length, 4, 'a tower is itself and three blocks');
  play.dispose();
  assert.equal(play.spawner.instances.size, 0);
});

test('spinners turn, others stay put, and a tower\'s blocks follow the tower', () => {
  const play = createPlay(scene);
  const yaw = (id) => play.yawOf(id);
  const before = yaw('spinner-1');
  for (let i = 0; i < 60; i++) play.step(1 / 60);
  assert.ok(Math.abs(yaw('spinner-1') - before - 2) < 1e-3, 'speed 2 turns two radians in a second');
  assert.equal(yaw('ball-1'), 0);
  const block = play.loaded.get('tower-2').get('block2'), t = play.world.data(Transform), b = block & 0xfffff;
  assert.ok(Math.abs(t.x[b] - 4) < 1e-6 && Math.abs(t.z[b] + 2) < 1e-6, 'a block is right above its tower');
  assert.ok(Math.abs(t.y[b] - 2.6) < 1e-6, 'the top block sits at 0.5 + 2 x 1.05');
});
