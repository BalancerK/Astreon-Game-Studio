import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  Camera3D, DrawList3D, createBox, createSphere, createMesh, createSkinnedMesh, simplifyMesh, createLod, lodLevel, OcclusionBuffer, mergeMeshes, StaticBatcher,
} from '../src/index.js';

const near = (a, b, tol, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} ${a} vs ${b}`);
function rng(seed) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }
const at = (x, y, z, s = 1) => new Float32Array([s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, x, y, z, 1]);
const tris = (m) => m.indices.length / 3;
/** A camera at the origin looking down -z. */
const camera = (o = {}) => new Camera3D({ fovY: Math.PI / 2, near: 0.1, far: 200, viewW: 128, viewH: 72, ...o }).update();

function checkMesh(m) {
  for (const i of m.indices) assert.ok(i < m.vertexCount, 'index in range');
  for (let t = 0; t < m.indices.length; t += 3) assert.ok(m.indices[t] !== m.indices[t + 1] && m.indices[t + 1] !== m.indices[t + 2] && m.indices[t] !== m.indices[t + 2], 'no collapsed triangle');
  for (let v = 0; v < m.vertexCount; v++) near(Math.hypot(m.vertices[v * 6 + 3], m.vertices[v * 6 + 4], m.vertices[v * 6 + 5]), 1, 1e-5, 'unit normal');
}

// ---------------------------------------------------------------- LOD

test('simplifyMesh keeps about the asked fraction of triangles, stays valid, stays inside the original, and keeps the shape', () => {
  const sphere = createSphere(1, 48, 24);
  const full = tris(sphere);
  for (const ratio of [0.5, 0.25, 0.1]) {
    const m = simplifyMesh(sphere, { ratio });
    checkMesh(m);
    assert.ok(tris(m) >= full * ratio * 0.9 && tris(m) <= full * ratio * 1.25, `${ratio}: ${tris(m)} of ${full}`);
    for (let v = 0; v < m.vertexCount; v++) { const r = Math.hypot(m.vertices[v * 6], m.vertices[v * 6 + 1], m.vertices[v * 6 + 2]); assert.ok(r < 1.001 && r > 0.6, `radius ${r}`); }
    assert.ok(m.uv && m.uv.length === m.vertexCount * 2, 'uv kept');
  }
  assert.equal(tris(simplifyMesh(sphere, { ratio: 1 })), full, 'a ratio of 1 is a copy');
  assert.notEqual(simplifyMesh(sphere, { ratio: 1 }).vertices, sphere.vertices);
  const coarse = simplifyMesh(sphere, { cellSize: 0.8 });
  assert.ok(tris(coarse) < full / 4);
});

test('simplifyMesh: hard edges are kept on request, and the arguments are checked', () => {
  const box = createBox(2, 2, 2);                              // 24 vertices, 12 triangles, a normal per face
  const smooth = simplifyMesh(box, { cellSize: 0.5 });
  const sharp = simplifyMesh(box, { cellSize: 0.5, keepEdges: true });
  const faces = (m) => new Set(Array.from({ length: m.vertexCount }, (_, v) => [m.vertices[v * 6 + 3], m.vertices[v * 6 + 4], m.vertices[v * 6 + 5]].map((n) => n.toFixed(2)).join()));
  assert.equal(faces(sharp).size, 6, 'six face normals survive');
  const axis = (m) => Array.from({ length: m.vertexCount }, (_, v) => Math.max(...[3, 4, 5].map((k) => Math.abs(m.vertices[v * 6 + k])))).every((c) => c > 0.99);
  assert.ok(axis(sharp) && !axis(smooth), 'without it the corners are rounded: normals no longer follow the faces');
  assert.throws(() => simplifyMesh(box, {}), /ratio.*cellSize/);
  assert.throws(() => simplifyMesh(box, { ratio: 0 }), /ratio/);
  assert.throws(() => simplifyMesh(box, { cellSize: -1 }), /cellSize/);
});

test('simplifyMesh works on skinned meshes: joints stay valid and weights add up', () => {
  const sphere = createSphere(1, 24, 12);
  const n = sphere.vertexCount, joints = [], weights = [];
  for (let v = 0; v < n; v++) { const j = sphere.vertices[v * 6 + 1] > 0 ? 1 : 0; joints.push(j, 2, 0, 0); weights.push(0.7, 0.3, 0, 0); }
  const skinned = createSkinnedMesh(sphere.vertices, sphere.indices, joints, weights, 3, 'ball', sphere.uv);
  const m = simplifyMesh(skinned, { ratio: 0.3 });
  assert.ok(m.skin && m.jointCount === 3); checkMesh(m);
  for (let v = 0; v < m.vertexCount; v++) {
    let sum = 0;
    for (let k = 0; k < 4; k++) { const j = m.skin[v * 8 + k], w = m.skin[v * 8 + 4 + k]; assert.ok(Number.isInteger(j) && j >= 0 && j < 3); sum += w; }
    near(sum, 1, 1e-5, 'weights');
  }
});

test('lodLevel picks by screen size; cullBelow hides; bias shifts', () => {
  const a = createBox(), b = createBox(), c = createBox();
  const lod = createLod({ levels: [{ mesh: a, below: 0.3 }, { mesh: b, below: 0.1 }, { mesh: c }], cullBelow: 0.02 });
  assert.deepEqual([0.9, 0.3, 0.29, 0.1, 0.09, 0.02, 0.019].map((s) => lodLevel(lod, s)), [0, 0, 1, 1, 2, 2, -1]);
  assert.equal(lodLevel(lod, 0.25, 2), 1, 'a bias of 2 treats it as half the size');
  assert.equal(lodLevel(lod, 0.25, 0.5), 0);
  assert.throws(() => createLod({}), /levels/);
  assert.throws(() => createLod({ mesh: a, ratios: [0.5, 0.2], screens: [0.3] }), /one screen size/);
  assert.throws(() => createLod({ levels: [{ mesh: a, below: 0.1 }, { mesh: b, below: 0.2 }] }), /get smaller/);
  const made = createLod({ mesh: createSphere(1, 32, 16), ratios: [0.4, 0.1], screens: [0.25, 0.08], cullBelow: 0.01 });
  assert.equal(made.levels.length, 3);
  assert.ok(tris(made.levels[1].mesh) < tris(made.levels[0].mesh) && tris(made.levels[2].mesh) < tris(made.levels[1].mesh));
  near(made.radius, Math.sqrt(3), 0.02);        // the radius of the box around the sphere, as the culling uses
});

test('addLod draws the level that fits the distance, nothing when it is tiny, and the finest without a camera', () => {
  const lod = createLod({ levels: [{ mesh: createBox(1, 1, 1), below: 0.2 }, { mesh: createBox(1, 1, 1), below: 0.05 }, { mesh: createBox(1, 1, 1) }], cullBelow: 0.01 });
  const list = new DrawList3D(), cam = camera();
  assert.equal(list.addLod(lod, at(0, 0, -5)), 0, 'no camera set yet: the finest');
  list.clear(); list.setCamera(cam);
  // radius 0.866, view height at distance d is 2d (90 degrees): size = 0.866 / d
  const sizeAt = (d) => 0.866 / d;
  const levels = [3, 6, 12, 30, 100, 400].map((d) => list.addLod(lod, at(0, 0, -d)));
  assert.deepEqual(levels, [0, 1, 1, 2, -1, -1], levels.map((d, i) => sizeAt([3, 6, 12, 30, 100, 400][i]).toFixed(3)).join(' '));
  assert.equal(list.tooSmall, 2); assert.equal(list.count, 4);
  list.clear(); list.lodBias = 4;
  assert.equal(list.addLod(lod, at(0, 0, -3)), 1, 'a bias of 4 moves it down a level'); assert.equal(list.tooSmall, 0);
  list.clear(); list.lodBias = 1;
  assert.equal(list.addLod(lod, at(0, 0, -3), 1, 1, 1, 1), 0);
  assert.equal(list.addLod(lod, at(0, 0, -3, 4)), 0, 'a bigger instance holds the detail further out');
  // a thing the size of the view, with the camera inside its bounds
  assert.equal(list.addLod(lod, at(0, 0, -0.2, 3)), 0);
  assert.equal(list.groups.size, 3, 'each level is its own mesh and its own draw');
  // an orthographic view uses the size against the view's half height
  const ortho = camera({ }); ortho.ortho = 10; ortho.update();
  list.clear(); list.setCamera(ortho);
  assert.equal(list.addLod(lod, at(0, 0, -50)), 1);
});

// ---------------------------------------------------------------- occlusion

test('occlusion: a wall hides what is behind it and nothing else', () => {
  const cam = camera(), occ = new OcclusionBuffer(128, 72).begin(cam);
  occ.addBox(-10, -10, -22, 10, 10, -20);                       // a wall 20 m wide and 20 m high, 20 m ahead
  assert.ok(occ.triangles > 0);
  assert.equal(occ.sphereHidden(0, 0, -40, 2), true, 'directly behind');
  assert.equal(occ.sphereHidden(5, 3, -60, 1), true, 'behind, off to one side');
  assert.equal(occ.sphereHidden(0, 0, -10, 2), false, 'in front of it');
  assert.equal(occ.sphereHidden(40, 0, -40, 2), false, 'behind but out past the wall\'s edge');
  assert.equal(occ.sphereHidden(0, 0, -21.5, 1.5), false, 'its nearest point is right at the wall: too close to be sure');
  assert.equal(occ.sphereHidden(20, 0, -40, 3), false, 'poking out past the edge of the wall');
  assert.equal(occ.sphereHidden(0, 0, 5, 1), false, 'behind the camera');
  assert.equal(occ.sphereHidden(0, 0, -0.05, 1), false, 'crossing the near plane');
  assert.equal(occ.sphereHidden(0, 0, -21, 50), false, 'a huge sphere around the wall');
  assert.equal(new OcclusionBuffer().begin(cam).sphereHidden(0, 0, -40, 2), false, 'an empty buffer hides nothing');
  assert.equal(occ.hidden, 2);
});

test('occlusion never hides a sphere that a ray could reach (random walls and spheres, checked by casting rays)', () => {
  const r = rng(7), cam = camera({ fovY: 1.2, near: 0.2 });
  let hiddenCount = 0, testedCount = 0;
  for (let scene = 0; scene < 40; scene++) {
    const occ = new OcclusionBuffer(96, 54).begin(cam), boxes = [];
    for (let i = 0; i < 4; i++) {
      const cx = (r() - 0.5) * 40, cy = (r() - 0.5) * 16, cz = -8 - r() * 40, hx = 1 + r() * 8, hy = 1 + r() * 6, hz = 0.5 + r() * 3;
      boxes.push([cx - hx, cy - hy, cz - hz, cx + hx, cy + hy, cz + hz]);
      occ.addBox(...boxes.at(-1));
    }
    for (let k = 0; k < 60; k++) {
      const sx = (r() - 0.5) * 70, sy = (r() - 0.5) * 30, sz = -2 - r() * 90, sr = 0.3 + r() * 3;
      testedCount++;
      if (!occ.sphereHidden(sx, sy, sz, sr)) continue;
      hiddenCount++;
      // every point of the sphere must be behind some box along the ray from the camera
      for (let s = 0; s < 120; s++) {
        let px, py, pz;
        do { px = (r() * 2 - 1); py = (r() * 2 - 1); pz = (r() * 2 - 1); } while (px * px + py * py + pz * pz > 1);
        px = sx + px * sr; py = sy + py * sr; pz = sz + pz * sr;
        if (pz > -cam.near) continue;
        const th = Math.tan(cam.fovY / 2);
        if (Math.abs(py / pz) > th || Math.abs(px / pz) > th * cam.aspect) continue;         // the part of the sphere off screen cannot be seen anyway
        const len = Math.hypot(px, py, pz), d = [px / len, py / len, pz / len];
        const blocked = boxes.some(([bx0, by0, bz0, bx1, by1, bz1]) => {
          const g = 1.2 * 2 * -bz1 * Math.tan(cam.fovY / 2) / occ.height;       // a gap narrower than a buffer pixel between two occluders can leak; fatten them by one
          const x0 = bx0 - g, y0 = by0 - g, z0 = bz0 - g, x1 = bx1 + g, y1 = by1 + g, z1 = bz1 + g;
          let t0 = 0, t1 = len;
          for (const [o, dd, lo, hi] of [[0, d[0], x0, x1], [0, d[1], y0, y1], [0, d[2], z0, z1]]) {
            if (Math.abs(dd) < 1e-12) { if (o < lo || o > hi) return false; continue; }
            let a = (lo - o) / dd, b = (hi - o) / dd; if (a > b) [a, b] = [b, a];
            t0 = Math.max(t0, a); t1 = Math.min(t1, b);
          }
          return t0 <= t1 && t0 < len - 1e-9;
        });
        assert.ok(blocked, `scene ${scene}: a point of a "hidden" sphere is visible (${px.toFixed(2)}, ${py.toFixed(2)}, ${pz.toFixed(2)}); sphere ${[sx, sy, sz, sr].map((v) => v.toFixed(2))} boxes ${JSON.stringify(boxes.map((b) => b.map((v) => +v.toFixed(2))))}`);
      }
    }
  }
  assert.ok(hiddenCount > 100, `the test must hide a good number of spheres to mean anything (${hiddenCount} of ${testedCount})`);
});

test('occlusion: an orthographic view hides nothing; a mesh and a placed triangle list work like a box', () => {
  const ortho = camera(); ortho.ortho = 10; ortho.update();
  assert.equal(new OcclusionBuffer().begin(ortho).addBox(-5, -5, -22, 5, 5, -20).sphereHidden(0, 0, -40, 1), false);
  const cam = camera(), occ = new OcclusionBuffer().begin(cam);
  occ.addMesh(createBox(30, 30, 2), at(0, 0, -20));
  assert.equal(occ.sphereHidden(0, 0, -40, 2), true);
  assert.throws(() => new OcclusionBuffer(2, 2), /between 8 and 1024/);
});

test('DrawList3D.setOcclusion drops hidden instances and counts them; shadows keep them', () => {
  const cam = camera(), occ = new OcclusionBuffer().begin(cam).addBox(-10, -10, -22, 10, 10, -20);
  const list = new DrawList3D(), box = createBox(2, 2, 2);
  list.setCamera(cam); list.setOcclusion(occ);
  list.add(box, at(0, 0, -40)); list.add(box, at(0, 0, -10)); list.add(box, at(300, 0, -40));
  assert.equal(list.count, 1 + 0, 'one in front only: one hidden by the wall, one outside the view');
  assert.equal(list.occluded, 1); assert.equal(list.culled, 1);
  list.clear(); list.setCamera(cam, { light: [0.3, 1, 0.2] }); list.add(box, at(0, 0, -40));
  assert.equal(list.count, 1, 'with a shadow light, a hidden thing may still shade what is seen');
  list.clear(); list.setCamera(cam); list.setOcclusion(null); list.add(box, at(0, 0, -40));
  assert.equal(list.count, 1);
});

// ---------------------------------------------------------------- merging

test('mergeMeshes bakes positions, rotated and squashed normals, uv, and one mesh out of many', () => {
  const box = createBox(2, 2, 2), sphere = createSphere(1, 8, 4);
  const sq = Float32Array.from([3, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 10, 0, 0, 1]);        // stretched 3 times along x and moved
  const merged = mergeMeshes([{ mesh: box, model: at(5, 0, 0) }, { mesh: sphere, model: sq }], 'two');
  assert.equal(merged.vertexCount, box.vertexCount + sphere.vertexCount); assert.equal(tris(merged), tris(box) + tris(sphere));
  assert.deepEqual([merged.min[0], merged.max[0]], [4, 13]);
  assert.ok(merged.uv && merged.uv.length === merged.vertexCount * 2);
  // a normal of the stretched sphere's side face at the top of the +x end: it should still be unit and still perpendicular to the surface
  checkMesh(merged);
  // a plane tilted by the stretch: a normal (1,1,0)/sqrt2 on a surface that is stretched by 3 along x tilts toward y
  const flat = createMesh([0, 0, 0, 0.7071, 0.7071, 0, 1, 0, 0, 0.7071, 0.7071, 0, 0, 1, 0, 0.7071, 0.7071, 0], [0, 1, 2], 'tilt');
  const m2 = mergeMeshes([{ mesh: flat, model: Float32Array.from([3, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]) }]);
  near(m2.vertices[3], 1 / Math.sqrt(10), 1e-5); near(m2.vertices[4], 3 / Math.sqrt(10), 1e-5);
  assert.throws(() => mergeMeshes([]), /at least one/);
  const skinned = createSkinnedMesh(sphere.vertices, sphere.indices, new Array(sphere.vertexCount * 4).fill(0), new Array(sphere.vertexCount * 4).fill(1), 1);
  assert.throws(() => mergeMeshes([{ mesh: skinned, model: at(0, 0, 0) }]), /skinned/);
  assert.equal(mergeMeshes([{ mesh: createMesh([0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0], [0, 1, 2]), model: at(0, 0, 0) }]).uv, undefined, 'no uv anywhere: none');
});

test('a mirrored placement keeps triangles facing outward', () => {
  const box = createBox(2, 2, 2);
  const mirror = Float32Array.from([-1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  const m = mergeMeshes([{ mesh: box, model: mirror }]);
  for (let t = 0; t < m.indices.length; t += 3) {
    const [a, b, c] = [0, 1, 2].map((k) => m.indices[t + k] * 6);
    const e1 = [0, 1, 2].map((i) => m.vertices[b + i] - m.vertices[a + i]), e2 = [0, 1, 2].map((i) => m.vertices[c + i] - m.vertices[a + i]);
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    assert.ok(n[0] * m.vertices[a + 3] + n[1] * m.vertices[a + 4] + n[2] * m.vertices[a + 5] > 0, 'the winding agrees with the normal');
  }
});

test('StaticBatcher groups by look and place, splits big groups, and the batches draw in one instance each', () => {
  const rock = createSphere(1, 8, 4), crate = createBox(1, 1, 1);
  const b = new StaticBatcher({ cellSize: 20, maxVertices: 400 });
  for (let i = 0; i < 30; i++) b.add(i % 2 ? rock : crate, at(i * 0.5, 0, 0));                 // all in one cell, same look
  b.add(crate, at(1, 0, 0), { color: [1, 0, 0, 1] });                                           // another colour: another batch
  b.add(crate, at(1, 0, 0), { layer: 2 });                                                      // another texture: another batch
  b.add(crate, at(100, 0, 0));                                                                  // another cell
  const batches = b.build();
  const pieces = batches.reduce((n, x) => n + x.pieces, 0);
  assert.equal(pieces, 33); assert.equal(b.pieces, 33);
  assert.ok(batches.every((x) => x.mesh.vertexCount <= 400 + crate.vertexCount), 'big groups are split');
  assert.ok(batches.length >= 5 && batches.length < 33, `${batches.length} batches for 33 pieces`);
  const red = batches.find((x) => x.color[0] === 1 && x.color[1] === 0), tex = batches.find((x) => x.material[0] === 2);
  assert.ok(red && tex);
  const list = new DrawList3D();
  const cam = camera();
  list.setCamera(cam);
  list.setMaterial(5, 'planar', 3);
  for (const batch of batches) list.addBatch(batch);
  assert.deepEqual(list.material, [5, 2, 3, 0], 'the list\'s own material is restored');
  assert.equal(list.groups.size, batches.filter((x) => x.mesh.vertexCount > 0).length - list.culled, 'one group each, except the ones out of view');
});
