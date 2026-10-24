import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadWorld3d, camera3d, drawWorld3d, block } from '../src/index.js';

const scene = (entities) => ({ format: 'engine-scene', version: 1, entities });

test('shapes become blocks standing where they were placed, with the size and colour they had', () => {
  const w = loadWorld3d(scene([
    { id: 'c', prefab: 'cube', at: { x: 2, y: 0.5, z: -3 } },
    { id: 'wall', prefab: 'wall', at: { x: 0, y: 1.5, z: -8 }, params: { halfWidth: 5, halfHeight: 1.5, halfDepth: 0.5 } },
    { id: 'big', prefab: 'cube', at: { x: 0, y: 1, z: 0 }, at2: 0, overrides: { components: { colour: { r: 1, g: 0, b: 0 } } }, params: { halfHeight: 1 } },
  ]));
  assert.equal(w.blocks.length, 3);
  assert.deepEqual([w.blocks[0].x, w.blocks[0].z, w.blocks[0].w, w.blocks[0].d, w.blocks[0].h, w.blocks[0].y], [2, -3, 1, 1, 1, 0]);
  assert.equal(w.blocks[0].color, '#d19e59');
  assert.deepEqual([w.blocks[1].w, w.blocks[1].d, w.blocks[1].h, w.blocks[1].y], [10, 1, 3, 0]);
  assert.equal(w.blocks[2].color, '#ff0000');
  assert.equal(w.blocks[2].h, 2);
});

test('a ball and a capsule are blocks that hold them; a floor is a flat block drawn first', () => {
  const w = loadWorld3d(scene([
    { id: 'b', prefab: 'ball', at: { x: 0, y: 0.5, z: 0 }, params: { radius: 1 } },
    { id: 'k', prefab: 'capsule', at: { x: 5, y: 0.8, z: 0 } },
    { id: 'f', prefab: 'floor', at: { y: -0.1 } },
  ]));
  assert.deepEqual([w.blocks[0].w, w.blocks[0].h, w.blocks[0].y], [2, 2, -0.5]);
  assert.ok(Math.abs(w.blocks[1].h - 1.6) < 1e-9 && Math.abs(w.blocks[1].w - 0.6) < 1e-9);
  assert.equal(w.blocks[2].floor, true);
  assert.ok(Math.abs(w.blocks[2].y + 0.2) < 1e-9 && Math.abs(w.blocks[2].h - 0.2) < 1e-9, 'the top of the floor is at the ground');
});

test('a turned shape stays turned (it keeps its size and gets a yaw), a scale grows the block, and a parent moves its children', () => {
  const w = loadWorld3d(scene([
    { id: 'a', prefab: 'wall', at: { x: 0, y: 1.5, z: 0, yaw: Math.PI / 2 } },
    { id: 's', prefab: 'cube', at: { y: 1, scale: 2 } },
    { id: 'parent', prefab: 'marker', name: 'start', at: { x: 10, z: 10 } },
    { id: 'kid', prefab: 'cube', parent: 'parent', at: { x: 1, y: 0.5, z: 0 } },
  ]));
  assert.deepEqual([w.blocks[0].w, w.blocks[0].d], [4, 0.3]);
  assert.ok(Math.abs(w.blocks[0].yaw - Math.PI / 2) < 1e-9);
  assert.equal(w.blocks[1].yaw, undefined, 'a block that is not turned has no yaw');
  assert.equal(w.blocks[1].w, 2);
  assert.deepEqual([w.blocks[2].x, w.blocks[2].z], [11, 10]);
});

test('a marker called start is where you begin, the other markers are gems, and nothing is lost to a missing start', () => {
  const w = loadWorld3d(scene([
    { id: 'start', prefab: 'marker', name: 'start', at: { x: 1, y: 0.3, z: 9, yaw: 0.5 } },
    { id: 'g1', prefab: 'marker', at: { x: 3, y: 1, z: 2 }, overrides: { components: { colour: { r: 0, g: 1, b: 0 } } } },
    { id: 'g2', prefab: 'marker', at: { x: -3, y: 1.5, z: 2 } },
  ]));
  assert.deepEqual(w.start, { x: 1, z: 9, yaw: 0.5 });
  assert.equal(w.gems.length, 2);
  assert.deepEqual([w.gems[0].x, w.gems[0].z, w.gems[0].y, w.gems[0].color], [3, 2, 1, '#00ff00']);
  assert.equal(loadWorld3d(scene([{ id: 'g', prefab: 'marker', at: {} }])).start, null);
});

test('what is switched off or not understood is left out, and a wrong file says what it needs', () => {
  const w = loadWorld3d(scene([{ id: 'x', prefab: 'cube', disabled: true }, { id: 'y', prefab: 'dragon' }, { id: 'z', prefab: 'cube' }]));
  assert.equal(w.blocks.length, 1);
  assert.deepEqual(w.skipped, ['y']);
  assert.throws(() => loadWorld3d({}), /3D panel/);
  assert.throws(() => loadWorld3d(null), /3D panel/);
});

test('the loaded world is plain data, and the floor is drawn before everything else', () => {
  const w = loadWorld3d(scene([{ id: 'f', prefab: 'floor', at: { z: -30, y: -0.1 } }, { id: 'c', prefab: 'cube', at: { z: -6, y: 0.5 } }]));
  assert.deepEqual(JSON.parse(JSON.stringify(w)), w);
  const order = [];
  let fill = '';
  const g = {
    beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, stroke() {}, fillRect() {}, fill() { order.push(fill); },
    set fillStyle(v) { fill = v; }, get fillStyle() { return fill; }, set strokeStyle(v) {}, set lineWidth(v) {},
  };
  drawWorld3d(g, camera3d({ z: 0 }), { blocks: [...w.blocks].reverse() }, { width: 480, height: 320, grid: false, fogFar: 0 });
  const green = order.findIndex((c) => /^rgb\(\d+, \d+, \d+\)$/.test(c) && Number(/rgb\(\d+, (\d+)/.exec(c)[1]) > Number(/rgb\((\d+)/.exec(c)[1]) && Number(/rgb\(\d+, \d+, (\d+)/.exec(c)[1]) < 140);
  assert.ok(order.length >= 2);
  assert.ok(green === 0, `the floor (greenish) comes first (${order.slice(0, 3)})`);
  assert.equal(block(0, 0, 1, 1).floor, undefined);
});

test('a ramp from the panel becomes a ramp: a block you can walk up', () => {
  const w = loadWorld3d(scene([{ id: 'r', prefab: 'ramp', at: { x: 8, y: 0.5, z: 1 } }]));
  assert.equal(w.blocks[0].ramp, true);
  assert.deepEqual([w.blocks[0].w, w.blocks[0].d, w.blocks[0].h, w.blocks[0].y], [2, 3, 1, 0]);
  assert.deepEqual(w.skipped, []);
});
