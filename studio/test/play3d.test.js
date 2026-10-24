import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PlayWorld } from '../scene3d/play-world.js';
import { createLibrary, describe } from '../scene3d/library.js';
import { emptyScene } from '../../packages/scene/src/index.js';

const library = createLibrary();
const scene = (entities) => ({ ...emptyScene('Test'), entities });
const world = (entities) => new PlayWorld(scene(entities), { library, describe });
const idle = { forward: 0, strafe: 0, run: false, jump: false };
const run = (w, ticks, input = idle) => { for (let i = 0; i < ticks; i++) w.step(1 / 60, input); };

const FLOOR = { id: 'floor', prefab: 'floor', at: { y: -0.1 } };                      // 8 by 8 metres, the top at y = 0
const WALL = { id: 'wall', prefab: 'wall', at: { y: 1.5, z: -2 } };                   // across the way, 4 metres wide, 3 metres high

test('someone starts where the start marker is, standing on the floor, facing the way the marker faces', () => {
  const w = world([FLOOR, { id: 's', prefab: 'marker', name: 'start', at: { x: 1, y: 0.2, z: 2, yaw: Math.PI / 2 } }]);
  run(w, 90);
  assert.ok(Math.abs(w.player.x - 1) < 0.01 && Math.abs(w.player.z - 2) < 0.01);
  assert.ok(Math.abs(w.player.feetY) < 0.06, `feet at ${w.player.feetY}`);
  assert.ok(w.player.grounded);
  assert.ok(Math.abs(w.yaw - Math.PI / 2) < 1e-6, `facing ${w.yaw}`);
  assert.equal(w.total, 0, 'the start marker is not something to collect');
});

test('with no start marker someone is dropped on the floor at the middle; a scene with nothing in it still has ground', () => {
  const w = world([FLOOR]);
  run(w, 90);
  assert.ok(w.player.grounded && Math.abs(w.player.feetY) < 0.06);
  const empty = world([]);
  assert.equal(empty.hasGround, false);
  run(empty, 90);
  assert.ok(empty.player.grounded, 'an empty scene has an invisible floor');
});

test('walking: forward goes the way they face, a wall stops them (even a turned one), and jumping leaves the ground', () => {
  const w = world([FLOOR, WALL, { id: 's', prefab: 'marker', name: 'start', at: { y: 0.2, z: 3 } }]);
  run(w, 30);
  const z0 = w.player.z;
  run(w, 60, { ...idle, forward: 1 });
  assert.ok(w.player.z < z0 - 3, `moved forward from ${z0} to ${w.player.z}`);
  run(w, 200, { ...idle, forward: 1 });
  assert.ok(w.player.z > -1.7 && w.player.z < -1.4, `stopped by the wall at ${w.player.z}`);
  const turned = world([FLOOR, { ...WALL, at: { y: 1.5, z: -2, yaw: 0.5 } }, { id: 's', prefab: 'marker', name: 'start', at: { y: 0.2, z: 3 } }]);
  run(turned, 400, { ...idle, forward: 1 });
  assert.ok(turned.player.z > -2.4, `a turned wall stops them too (${turned.player.z})`);
  const jumper = world([FLOOR]);
  run(jumper, 60);
  const y0 = jumper.player.y;
  run(jumper, 10, { ...idle, jump: true });
  assert.ok(jumper.player.y > y0 + 0.5 && !jumper.player.grounded, 'in the air');
  run(jumper, 120);
  assert.ok(jumper.player.grounded);
});

test('strafing and running: sideways is as fast as forward, running is faster, and a diagonal is not faster than straight', () => {
  const w = world([FLOOR]);
  run(w, 60);
  const start = { x: w.player.x, z: w.player.z };
  run(w, 30, { ...idle, forward: 1, strafe: 1 });
  const diagonal = Math.hypot(w.player.x - start.x, w.player.z - start.z);
  const s = world([FLOOR]);
  run(s, 60);
  const s0 = { x: s.player.x, z: s.player.z };
  run(s, 30, { ...idle, forward: 1 });
  const straight = Math.hypot(s.player.x - s0.x, s.player.z - s0.z);
  assert.ok(Math.abs(diagonal - straight) < 0.05, `${diagonal} against ${straight}`);
  const r = world([FLOOR]);
  run(r, 60);
  const r0 = r.player.z;
  run(r, 30, { ...idle, forward: 1, run: true });
  assert.ok(Math.abs(r.player.z - r0) > straight * 1.5, 'running covers more ground');
});

test('the markers are things to collect: walking into one picks it up, and picking them all up is done', () => {
  const w = world([FLOOR, { id: 's', prefab: 'marker', name: 'start', at: { y: 0.2, z: 3 } },
    { id: 'a', prefab: 'marker', at: { y: 0.8, z: 0 } }, { id: 'b', prefab: 'marker', at: { x: 2, y: 0.8, z: 0 } }]);
  assert.equal(w.total, 2);
  assert.equal(w.count, 0);
  run(w, 30);
  run(w, 120, { ...idle, forward: 1 });
  assert.equal(w.count, 1, 'the one on the way');
  assert.equal(w.done, false);
  assert.equal(w.drawable().some((i) => i.id === 'a'), false, 'a collected marker is not drawn any more');
  w.player.x = 2;
  w.player.y = 1;
  w.player.vy = 0;
  w.player.z = 0.2;
  run(w, 5);
  assert.equal(w.done, true);
});

test('every kind of solid shape is something to stand on or bump into, and what is switched off is not there', () => {
  const ball = world([{ id: 'b', prefab: 'ball', at: { y: 0.5 } }]);
  assert.ok(ball.world.triangleCount > 40, 'a ball is made of triangles');
  const capsule = world([{ id: 'c', prefab: 'capsule', at: { y: 1 } }]);
  assert.ok(capsule.world.triangleCount > 40);
  const resting = world([FLOOR, { id: 'cube', prefab: 'cube', at: { x: 0, y: 0.5, z: 0 } }, { id: 's', prefab: 'marker', name: 'start', at: { y: 3, z: 0 } }]);
  run(resting, 120);
  assert.ok(Math.abs(resting.player.feetY - 1) < 0.08, `landed on top of the cube (${resting.player.feetY})`);
  const off = world([FLOOR, { id: 'cube', prefab: 'cube', at: { y: 0.5 }, disabled: true }]);
  assert.equal(off.solids.length, 1);
  const crowd = world([FLOOR, ...Array.from({ length: 40 }, (_, i) => ({ id: `p${i}`, prefab: 'pillar', at: { x: (i % 8) - 4, y: 1.5, z: -3 - Math.floor(i / 8) } }))]);
  assert.equal(crowd.solids.length, 41);
});

test('falling off the world puts someone back at the start', () => {
  const w = world([{ id: 's', prefab: 'marker', name: 'start', at: { x: 0, y: 0.2, z: 0 } }, { id: 'f', prefab: 'floor', at: { x: 40, y: -0.1 } }]);
  run(w, 600);
  assert.ok(w.player.y > -60, 'caught before going far');
});

test('a ramp is a wedge to walk up in the editor\'s Play: the walker climbs it and a steep wall of the same block is not climbed', () => {
  const w = world([FLOOR, { id: 'ramp', prefab: 'ramp', at: { x: 0, y: 0.5, z: -1.5 } }, { id: 's', prefab: 'marker', name: 'start', at: { y: 0.2, z: 3 } }]);
  assert.equal(w.solids.find((i) => i.id === 'ramp').ramp, true, 'the editor knows it is a ramp');
  run(w, 30);
  let top = 0;
  for (let i = 0; i < 240; i++) { w.step(1 / 60, { ...idle, forward: 1 }); top = Math.max(top, w.player.feetY); }
  assert.ok(top > 0.8, `climbed the ramp (${top})`);
  const steep = world([FLOOR, { id: 'ramp', prefab: 'ramp', at: { x: 0, y: 1, z: -1.5 }, params: { halfHeight: 1, halfDepth: 0.4 } }, { id: 's', prefab: 'marker', name: 'start', at: { y: 0.2, z: 3 } }]);
  run(steep, 30);
  let high = 0;
  for (let i = 0; i < 240; i++) { steep.step(1 / 60, { ...idle, forward: 1 }); high = Math.max(high, steep.player.feetY); }
  assert.ok(high < 0.7, `a ramp that steep stops it (${high})`);
});
