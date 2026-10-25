import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Heightmap, Terrain, DrawList3D, Camera3D, createBox, packInstancesForLight, INSTANCE3D_FLOATS, computeShadowMatrix } from '../src/index.js';

const model = (x, y, z, s = 1) => Float32Array.of(s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, x, y, z, 1);

test('the instances packed for a sun cascade are exactly those whose sphere can touch its box', () => {
  const list = new DrawList3D(), box = createBox(1, 1, 1);
  const places = [[0, 0, 0], [10, 0, 5], [-20, 3, 12], [400, 0, 0], [0, 0, -500], [60, 40, 60], [-1000, 0, 1000]];
  for (const [x, y, z] of places) list.add(box, model(x, y, z, 2));
  const camera = new Camera3D({ fovY: 1 });
  camera.x = 0; camera.y = 5; camera.z = 0; camera.yaw = 0; camera.update();
  const matrix = new Float64Array(16);
  computeShadowMatrix(matrix, camera, [0.4, 1, 0.3], { size: 1024, radius: 50 });
  const staging = new Float32Array(places.length * 2 * INSTANCE3D_FLOATS);
  const { parts, rows } = packInstancesForLight(list.groups, matrix, INSTANCE3D_FLOATS, staging, 0);
  assert.ok(rows >= 3 && rows < places.length, `the near ones are kept, the far ones left out: ${rows} of ${places.length}`);
  assert.equal(parts.length, 1);
  const xs = Array.from({ length: rows }, (_, i) => staging[i * INSTANCE3D_FLOATS + 12]);
  assert.ok(xs.includes(0) && xs.includes(10) && !xs.includes(400) && !xs.includes(-1000), `kept x: ${xs}`);
  const again = packInstancesForLight(list.groups, matrix, INSTANCE3D_FLOATS, staging, 5);
  assert.equal(again.parts[0].row, 5, 'rows are written from where it is told');
});

test('a draw list can be asked whether a sphere is seen, and told not to look at each instance', () => {
  const list = new DrawList3D(), box = createBox(1, 1, 1), camera = new Camera3D({ fovY: 1 });
  camera.x = 0; camera.y = 0; camera.z = 0; camera.yaw = 0; camera.update(); list.setCamera(camera);
  assert.equal(list.sphereVisible(0, 0, -50, 2), true, 'ahead');
  assert.equal(list.sphereVisible(0, 0, 500, 2), false, 'behind');
  list.add(box, model(0, 0, 500));
  assert.equal(list.count, 0, 'culled by default');
  list.cull = false;
  list.add(box, model(0, 0, 500));
  assert.equal(list.count, 1, 'added without a look when culling is off');
});

test('far chunks of terrain, merged, are the same triangles in fewer draws', () => {
  const map = Heightmap.fromNoise({ size: 193, cell: 4, seed: 3, amplitude: 30 });
  const plain = new Terrain(map, { chunkCells: 24, lods: 4, lodDistance: 60 }), merged = new Terrain(map, { chunkCells: 24, lods: 4, lodDistance: 60, farMerge: 4 });
  const list = new DrawList3D(), list2 = new DrawList3D();
  const view = { x: -300, y: 20, z: -300 };
  plain.addToDrawList(list, view); merged.addToDrawList(list2, view);
  assert.ok(merged.squares.length > 0);
  assert.equal(merged.triangles, plain.triangles, 'the same number of triangles');
  assert.ok(list2.groups.size < list.groups.size, `fewer meshes: ${list2.groups.size} against ${list.groups.size}`);
});
