import { test } from 'node:test';
import assert from 'node:assert/strict';
import { separateBodies } from '../server/separation.js';
import { buildArenaLevel } from '../shared/level.js';
import { createBody, BODY } from '../shared/game.js';

const { world } = buildArenaLevel();
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

test('overlapping bodies are pushed apart, a little per call, until they no longer overlap', () => {
  const a = createBody(-40, 0.9, -40), b = createBody(-39.7, 0.9, -40);
  const bodies = new Map([[1, a], [2, b]]);
  const start = dist(a, b);
  assert.equal(separateBodies(bodies, world, BODY), 1);
  assert.ok(dist(a, b) > start, 'moved apart');
  assert.ok(dist(a, b) - start <= 0.16 + 1e-9, 'bounded per call');
  for (let i = 0; i < 20; i++) separateBodies(bodies, world, BODY);
  assert.ok(dist(a, b) >= BODY.radius * 2 - 1e-6, 'no longer overlapping');
  assert.equal(separateBodies(bodies, world, BODY), 0);
});

test('bodies at different heights do not push each other, and identical positions separate deterministically', () => {
  const a = createBody(-40, 0.9, -40), b = createBody(-39.9, 5, -40);
  assert.equal(separateBodies(new Map([[1, a], [2, b]]), world, BODY), 0);
  const c = createBody(-30, 0.9, -30), d = createBody(-30, 0.9, -30);
  separateBodies(new Map([[3, c], [4, d]]), world, BODY);
  assert.ok(dist(c, d) > 0);
});

test('the result does not depend on map insertion order', () => {
  const mk = () => [createBody(-40, 0.9, -40), createBody(-39.8, 0.9, -39.9), createBody(-39.9, 0.9, -40.2)];
  const [a1, b1, c1] = mk(), [a2, b2, c2] = mk();
  separateBodies(new Map([[1, a1], [2, b1], [3, c1]]), world, BODY);
  separateBodies(new Map([[3, c2], [1, a2], [2, b2]]), world, BODY);
  assert.deepEqual([a1.x, a1.z, b1.x, b1.z, c1.x, c1.z], [a2.x, a2.z, b2.x, b2.z, c2.x, c2.z]);
});

test('server: a crowd of bots does not stay stacked when collision is on', async () => {
  const { startArena3dServer } = await import('../server/arena3d-server.js');
  const deepOverlaps = async (collide) => {
    const server = await startArena3dServer({ listen: false, manualTicks: true, bots: 60, collide, seed: 3 });
    for (let i = 0; i < 180; i++) server.step();
    const list = [...server.bodies.values()];
    let deep = 0;
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      if (Math.abs(list[i].y - list[j].y) < 1.5 && dist(list[i], list[j]) < BODY.radius * 1.2) deep++;
    }
    const pushes = server.stats.pushes;
    await server.close();
    return { deep, pushes };
  };
  const off = await deepOverlaps(false), on = await deepOverlaps(true);
  assert.equal(off.pushes, 0);
  assert.ok(on.pushes > 0, 'pairs were pushed');
  assert.ok(on.deep < off.deep || off.deep === 0, `deep overlaps ${on.deep} vs ${off.deep}`);
  assert.ok(on.deep <= 1, `at most one pair is deeply overlapping (${on.deep})`);
});
