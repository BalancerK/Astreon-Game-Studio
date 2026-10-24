import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Camera3D, DrawList3D, createBox, createSphere, createSkinnedMesh, createMesh } from '../src/index.js';

function rng(seed) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }
const at = (x, y, z, s = 1) => new Float32Array([s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, x, y, z, 1]);
/** A 90 degree square view at the origin looking down -z, far plane at 100. */
const camera = () => new Camera3D({ fovY: Math.PI / 2, near: 0.1, far: 100, viewW: 100, viewH: 100 }).update();

test('frustum planes: unit normals, points inside and outside each side', () => {
  const cam = camera();
  for (let i = 0; i < 24; i += 4) near(Math.hypot(cam.planes[i], cam.planes[i + 1], cam.planes[i + 2]), 1, 1e-9);
  assert.ok(cam.sphereVisible(0, 0, -5, 0), 'straight ahead');
  assert.ok(cam.sphereVisible(4.9, 4.9, -5, 0), 'near the top right corner');
  assert.ok(!cam.sphereVisible(5.2, 0, -5, 0), 'beyond the right edge');
  assert.ok(!cam.sphereVisible(-5.2, 0, -5, 0), 'beyond the left edge');
  assert.ok(!cam.sphereVisible(0, 5.2, -5, 0), 'above');
  assert.ok(!cam.sphereVisible(0, -5.2, -5, 0), 'below');
  assert.ok(!cam.sphereVisible(0, 0, 5, 0), 'behind the camera');
  assert.ok(!cam.sphereVisible(0, 0, -100.5, 0), 'past the far plane');
  assert.ok(!cam.sphereVisible(0, 0, -0.05, 0), 'in front of the near plane');
  assert.ok(cam.sphereVisible(5.5, 0, -5, 1), 'a sphere crossing the edge is kept');
  assert.ok(!cam.sphereVisible(8, 0, -5, 1), 'one clear of it is dropped');
});
function near(a, b, tol, msg = '') { assert.ok(Math.abs(a - b) <= tol, `${msg} ${a} vs ${b}`); }

test('culling never drops anything that is on screen (random cameras and spheres, checked against the projection)', () => {
  const rand = rng(7);
  let dropped = 0, kept = 0;
  for (let n = 0; n < 4000; n++) {
    const cam = new Camera3D({
      x: (rand() - 0.5) * 40, y: (rand() - 0.5) * 20, z: (rand() - 0.5) * 40, yaw: (rand() - 0.5) * 7, pitch: (rand() - 0.5) * 2.4, roll: (rand() - 0.5) * 0.6,
      fovY: 0.5 + rand() * 1.5, near: 0.1 + rand(), far: 50 + rand() * 300, viewW: 200 + rand() * 1000, viewH: 200 + rand() * 600,
    }).update();
    const x = (rand() - 0.5) * 120, y = (rand() - 0.5) * 60, z = (rand() - 0.5) * 120, r = rand() * 3;
    const m = cam.viewProj;
    const cx = m[0] * x + m[4] * y + m[8] * z + m[12], cy = m[1] * x + m[5] * y + m[9] * z + m[13];
    const cz = m[2] * x + m[6] * y + m[10] * z + m[14], cw = m[3] * x + m[7] * y + m[11] * z + m[15];
    const inside = cw > 0 && Math.abs(cx) <= cw && Math.abs(cy) <= cw && cz >= 0 && cz <= cw; // the centre is on screen
    const visible = cam.sphereVisible(x, y, z, r);
    if (inside) assert.ok(visible, `a sphere whose centre is on screen was culled (case ${n})`);
    if (visible) kept++; else dropped++;
  }
  assert.ok(dropped > 500 && kept > 500, `a mix of both (${kept} kept, ${dropped} dropped)`);
});

test('the draw list drops what is outside the view, counts it, and draws everything when no camera is set', () => {
  const box = createBox(1, 1, 1), cam = camera();
  const list = new DrawList3D();
  list.add(box, at(0, 0, -5));      // ahead
  list.add(box, at(0, 0, 5));       // behind
  list.add(box, at(50, 0, -5));     // far to the side
  list.add(box, at(0, 0, -500));    // beyond the far plane
  assert.equal(list.count, 4, 'without a camera everything is kept');
  list.clear();
  list.setCamera(cam);
  list.add(box, at(0, 0, -5)); list.add(box, at(0, 0, 5)); list.add(box, at(50, 0, -5)); list.add(box, at(0, 0, -500));
  assert.equal(list.count, 1);
  assert.equal(list.culled, 3);
  assert.equal(list.groups.get(box).count, 1);
  list.clear();
  assert.equal(list.culled, 0, 'the counter restarts each frame');
  list.setCamera(null);
  list.add(box, at(0, 0, 5));
  assert.equal(list.count, 1);
});

test('culling respects scale and where the mesh sits relative to its origin', () => {
  const cam = camera(), list = new DrawList3D();
  list.setCamera(cam);
  const box = createBox(1, 1, 1);
  list.add(box, at(7, 0, -5, 1));    // a unit box well outside the right edge (the edge is at x = 5)
  assert.equal(list.count, 0);
  list.add(box, at(7, 0, -5, 6));    // the same placement, but 6 m across: it reaches into view
  assert.equal(list.count, 1);
  // a mesh whose vertices are far from its origin: the bound follows the vertices, not the origin
  const off = createMesh([20, 0, 0, 0, 1, 0, 21, 0, 0, 0, 1, 0, 20, 1, 0, 0, 1, 0], [0, 1, 2], 'offset');
  list.clear();
  list.add(off, at(-20, 0, -5)); // origin to the left of view, vertices land on the axis
  assert.equal(list.count, 1, 'drawn: the geometry is in view even though the origin is not');
  list.add(off, at(0, 0, -5));   // origin in view, vertices 20 m to the right
  assert.equal(list.count, 1, 'dropped: the origin is in view but the geometry is not');
});

test('skinned meshes get a more generous bound, and mesh.cullRadius overrides it', () => {
  const v = [-0.2, 0, 0, 0, 1, 0, 0.2, 0, 0, 0, 1, 0, 0, 1.8, 0, 0, 1, 0];
  const mesh = createSkinnedMesh(v, [0, 1, 2], new Array(12).fill(0), [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 1, 'person');
  const list = new DrawList3D(), pal = new Float32Array(16);
  list.setCamera(camera());
  // centre of the bind-pose box is at y = 0.9; radius ~0.92: a plain mesh at x = 6.2 would be dropped, a skinned one is kept by the margin
  list.addSkinned(mesh, at(6.4, 0, -5), pal);
  assert.equal(list.count, 1, 'the extra margin keeps a posed character whose bind-pose box is just off screen');
  list.addSkinned(mesh, at(30, 0, -5), pal);
  assert.equal(list.count, 1, 'far off screen is still dropped');
  mesh.cullRadius = 40;
  list.addSkinned(mesh, at(30, 0, -5), pal);
  assert.equal(list.count, 2, 'an explicit cullRadius is used as given');
});

test('thousands of instances mostly behind the camera: culling keeps only the visible ones', () => {
  const sphere = createSphere(0.5, 8, 6), list = new DrawList3D(), rand = rng(3);
  list.setCamera(camera());
  for (let i = 0; i < 5000; i++) list.add(sphere, at((rand() - 0.5) * 200, (rand() - 0.5) * 200, (rand() - 0.5) * 200));
  assert.equal(list.count + list.culled, 5000);
  assert.ok(list.count < 1200 && list.count > 300, `${list.count} kept of 5000`);
});

test('with a light, instances whose shadow can fall into view are kept even when they are not in view themselves', () => {
  const box = createBox(1, 5, 1), cam = camera(), list = new DrawList3D();
  const low = [0, 0.3, 1]; // a low sun behind the camera: it throws long shadows ahead of it, away from the light
  list.setCamera(cam);
  list.add(box, at(0, 2.5, 10)); // a pillar behind the camera
  assert.equal(list.count, 0, 'without the light: dropped');
  list.setCamera(cam, { light: low });
  list.add(box, at(0, 2.5, 10));
  assert.equal(list.count, 1, 'with the light: kept, its shadow reaches the view');
  list.add(box, at(0, 2.5, 10 + 200)); // too far for any shadow to reach
  assert.equal(list.count, 1);
  list.add(box, at(60, 2.5, 10)); // off to the side and the shadow runs parallel to the view axis: never enters
  assert.equal(list.count, 1);
  list.setCamera(cam, { light: [0, 1, 0] }); // sun straight overhead: shadows fall straight down, so something behind you stays out
  list.add(box, at(0, 2.5, 10));
  assert.equal(list.count, 1);
  list.setCamera(null);
  assert.equal(list.light, null);
});

test('swept spheres: conservative against the projection, and a path that never meets the view is rejected', () => {
  const rand = rng(11);
  let rejected = 0;
  for (let n = 0; n < 3000; n++) {
    const cam = new Camera3D({ x: (rand() - 0.5) * 30, y: (rand() - 0.5) * 10, z: (rand() - 0.5) * 30, yaw: (rand() - 0.5) * 7, pitch: (rand() - 0.5) * 2, fovY: 0.6 + rand(), near: 0.1, far: 200, viewW: 800, viewH: 600 }).update();
    const x = (rand() - 0.5) * 100, y = (rand() - 0.5) * 40, z = (rand() - 0.5) * 100, r = rand() * 2;
    const dx = (rand() - 0.5) * 80, dy = (rand() - 0.5) * 80, dz = (rand() - 0.5) * 80;
    const swept = cam.sweptSphereVisible(x, y, z, r, dx, dy, dz);
    for (let t = 0; t <= 1; t += 0.05) { // any point along the path that is on screen means the sweep must say yes
      if (cam.sphereVisible(x + dx * t, y + dy * t, z + dz * t, r)) { assert.ok(swept, `a swept sphere that enters the view was rejected (case ${n})`); break; }
    }
    if (!swept) rejected++;
  }
  assert.ok(rejected > 300, `some are rejected (${rejected})`);
});
