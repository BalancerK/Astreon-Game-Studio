import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createBox, createPlane, createSphere, createCylinder, createCapsule, createMeshFromTriangles, computeNormals, createMesh,
  Camera3D, DrawList3D, createLighting, INSTANCE3D_FLOATS, VERTEX_FLOATS, parseGltf, addGltfToDrawList,
} from '../src/index.js';

function rng(seed) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} ${a} vs ${b} (diff ${Math.abs(a - b)})`);

/** Geometric facts about a mesh: every index valid, every normal unit, winding agrees with the normals, enclosed volume. */
function inspect(mesh) {
  const v = mesh.vertices;
  let wrong = 0, area = 0, volume = 0;
  assert.equal(v.length, mesh.vertexCount * VERTEX_FLOATS);
  assert.equal(mesh.indices.length % 3, 0);
  for (let i = 0; i < mesh.vertexCount; i++) near(Math.hypot(v[i * 6 + 3], v[i * 6 + 4], v[i * 6 + 5]), 1, 1e-5, `normal ${i} is unit length`);
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const [a, b, c] = [mesh.indices[t], mesh.indices[t + 1], mesh.indices[t + 2]];
    assert.ok(a < mesh.vertexCount && b < mesh.vertexCount && c < mesh.vertexCount, 'indices stay inside the vertex array');
    const A = [v[a * 6], v[a * 6 + 1], v[a * 6 + 2]], B = [v[b * 6], v[b * 6 + 1], v[b * 6 + 2]], C = [v[c * 6], v[c * 6 + 1], v[c * 6 + 2]];
    const e1 = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], e2 = [C[0] - A[0], C[1] - A[1], C[2] - A[2]];
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const len = Math.hypot(...n);
    area += len / 2;
    volume += (A[0] * (B[1] * C[2] - B[2] * C[1]) - A[1] * (B[0] * C[2] - B[2] * C[0]) + A[2] * (B[0] * C[1] - B[1] * C[0])) / 6;
    if (len < 1e-12) continue; // the poles of a sphere collapse some triangles to nothing
    const vn = [v[a * 6 + 3] + v[b * 6 + 3] + v[c * 6 + 3], v[a * 6 + 4] + v[b * 6 + 4] + v[c * 6 + 4], v[a * 6 + 5] + v[b * 6 + 5] + v[c * 6 + 5]];
    if (n[0] * vn[0] + n[1] * vn[1] + n[2] * vn[2] <= 0) wrong++;
  }
  return { wrong, area, volume };
}

test('primitive meshes: valid indices, unit normals, counter-clockwise outward winding, and the right size', () => {
  const box = inspect(createBox(2, 3, 4));
  assert.equal(box.wrong, 0);
  near(box.area, 2 * (2 * 3 + 2 * 4 + 3 * 4), 1e-9, 'surface area');
  near(box.volume, 24, 1e-9, 'enclosed volume (positive: the triangles face outward)');

  const sphere = inspect(createSphere(1, 48, 32));
  assert.equal(sphere.wrong, 0);
  near(sphere.area, 4 * Math.PI, 0.05, 'a fine sphere has the area of a sphere');
  near(sphere.volume, (4 / 3) * Math.PI, 0.05);

  const cyl = inspect(createCylinder(1, 2, 48));
  assert.equal(cyl.wrong, 0);
  near(cyl.volume, Math.PI * 2, 0.05);

  const cap = inspect(createCapsule(0.5, 3, 32, 12));
  assert.equal(cap.wrong, 0);
  near(cap.volume, Math.PI * 0.25 * 2 + (4 / 3) * Math.PI * 0.125, 0.05, 'a cylinder of height 2 and two half spheres');

  const plane = createPlane(4, 6, 4, 3);
  assert.equal(inspect(plane).wrong, 0);
  assert.equal(plane.vertexCount, 5 * 4);
  assert.equal(plane.indices.length, 4 * 3 * 6);
  assert.deepEqual([plane.min, plane.max], [[-2, 0, -3], [2, 0, 3]]);
  assert.deepEqual([createBox(2, 2, 2).min, createBox(2, 2, 2).max], [[-1, -1, -1], [1, 1, 1]]);
  near(createCapsule(0.4, 1.8).max[1], 0.9, 1e-6, 'a capsule of height 1.8 is 1.8 tall');
});

test('meshes from raw triangles are flat-shaded, and smooth normals average the faces around a vertex', () => {
  const tri = createMeshFromTriangles([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0]);
  assert.equal(tri.vertexCount, 6);
  assert.deepEqual([...tri.vertices.slice(3, 6)], [0, 0, 1], 'first triangle faces +z');
  assert.deepEqual([...tri.vertices.slice(21, 24)], [0, 1, 0], 'second triangle faces +y');
  // two equal triangles meeting at a right angle (z = 0 and y = 0): the shared vertex gets the diagonal normal
  const n = computeNormals([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1], [0, 1, 2, 0, 3, 1]);
  near(Math.hypot(n[0], n[1], n[2]), 1, 1e-6);
  near(n[0], 0, 1e-6); near(n[1], Math.SQRT1_2, 1e-6); near(n[2], Math.SQRT1_2, 1e-6);
  assert.deepEqual([...n.slice(6, 9)], [0, 0, 1], 'a vertex of one face only keeps that face normal');
  const empty = createMesh([], []);
  assert.deepEqual([empty.vertexCount, empty.min, empty.max], [0, [0, 0, 0], [0, 0, 0]]);
});

test('Camera3D: matrices, picking rays and projection agree with each other', () => {
  const cam = new Camera3D({ x: 3, y: 2, z: 8, yaw: 0.4, pitch: -0.2, fovY: 1.0, viewW: 800, viewH: 450, near: 0.1, far: 500 });
  cam.update();
  assert.equal(cam.aspect, 800 / 450);
  // the centre of the screen looks along forward()
  const o = [0, 0, 0], d = [0, 0, 0];
  cam.screenToRay(400, 225, o, d);
  const f = cam.forward();
  for (let i = 0; i < 3; i++) near(d[i], f[i], 1e-12, 'centre ray is the view direction');
  // a ray through a pixel hits that pixel when projected back
  const r = rng(3), p = [0, 0, 0], s = { x: 0, y: 0, depth: 0, visible: false };
  for (let i = 0; i < 100; i++) {
    const sx = r() * 800, sy = r() * 450;
    cam.screenToRay(sx, sy, o, d);
    p[0] = o[0] + d[0] * 25; p[1] = o[1] + d[1] * 25; p[2] = o[2] + d[2] * 25;
    cam.worldToScreen(p[0], p[1], p[2], s);
    assert.ok(s.visible);
    near(s.x, sx, 1e-6, 'x round trip'); near(s.y, sy, 1e-6, 'y round trip');
  }
  // behind the camera is reported as not visible
  const behind = cam.worldToScreen(3 - f[0] * 10, 2 - f[1] * 10, 8 - f[2] * 10);
  assert.equal(behind.visible, false);
  assert.ok(behind.depth < 0);
  // a point straight ahead projects to the centre, at its distance as depth
  const ahead = cam.worldToScreen(3 + f[0] * 12, 2 + f[1] * 12, 8 + f[2] * 12);
  near(ahead.x, 400, 1e-9); near(ahead.y, 225, 1e-9); near(ahead.depth, 12, 1e-9);
  // the screen corners are where the field of view says
  cam.screenToRay(0, 0, o, d);
  const up = Math.tan(0.5), right = up * cam.aspect;
  const fwd = cam.forward();
  const dir = [d[0], d[1], d[2]];
  const cosAngle = dir[0] * fwd[0] + dir[1] * fwd[1] + dir[2] * fwd[2];
  near(cosAngle, 1 / Math.sqrt(1 + up * up + right * right), 1e-12, 'the corner ray leaves at the field-of-view angle');
});

test('DrawList3D groups instances by mesh, grows, and writes matrix and colour in the layout the shaders read', () => {
  const list = new DrawList3D();
  const box = createBox(), sphere = createSphere();
  const m = new Float64Array(16).map((_, i) => i + 1);
  list.add(box, m, 0.1, 0.2, 0.3, 0.4);
  list.addTransform(sphere, 1, 2, 3, null, 2, 2, 2, 1, 0, 0);
  for (let i = 0; i < 100; i++) list.addTransform(box, i, 0, 0);
  assert.equal(list.count, 102);
  assert.equal(list.groups.get(box).count, 101);
  assert.equal(list.groups.get(sphere).count, 1);
  const d = list.groups.get(box).data;
  assert.deepEqual([...d.subarray(0, 16)], [...m], 'the matrix, column-major, first');
  near(d[16], 0.1, 1e-7); near(d[17], 0.2, 1e-7); near(d[18], 0.3, 1e-7); near(d[19], 0.4, 1e-7);
  const s = list.groups.get(sphere).data;
  assert.deepEqual([s[0], s[5], s[10], s[12], s[13], s[14], s[15]], [2, 2, 2, 1, 2, 3, 1], 'scale on the diagonal, translation in the last column');
  assert.deepEqual([s[16], s[17], s[18], s[19]], [1, 0, 0, 1], 'alpha defaults to opaque');
  assert.equal(INSTANCE3D_FLOATS, 24);
  assert.deepEqual([s[20], s[21], s[22]], [-1, 0, 1], 'no texture unless setMaterial was called');
  const before = list.groups.get(box).data;
  list.clear();
  assert.equal(list.count, 0);
  assert.equal(list.groups.get(box).count, 0);
  list.add(box, m);
  assert.equal(list.groups.get(box).data, before, 'the buffers are reused from frame to frame');
  const L = createLighting();
  assert.ok(L.direction.length === 3 && L.fogDensity === 0, 'lighting defaults');
});

// ---- glTF ----
const pad4 = (n) => (4 - (n % 4)) % 4;
/** Assemble a GLB from a JSON object and a binary chunk. */
function makeGlb(json, bin) {
  const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jsonLen = jsonBytes.length + pad4(jsonBytes.length), binLen = bin.byteLength + pad4(bin.byteLength);
  const out = new Uint8Array(12 + 8 + jsonLen + 8 + binLen);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, out.length, true);
  dv.setUint32(12, jsonLen, true); dv.setUint32(16, 0x4e4f534a, true);
  out.set(jsonBytes, 20); out.fill(0x20, 20 + jsonBytes.length, 20 + jsonLen);
  const b = 20 + jsonLen;
  dv.setUint32(b, binLen, true); dv.setUint32(b + 4, 0x004e4942, true);
  out.set(new Uint8Array(bin), b + 8);
  return out.buffer;
}

/** A unit quad in the xy plane (two triangles, 16-bit indices), with normals, and an interleaved variant. */
function quadModel({ normals = true, material = true, node = {} } = {}) {
  const pos = new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]);
  const nor = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]);
  const idx = new Uint16Array([0, 1, 2, 0, 2, 3]);
  const bin = new Uint8Array(pos.byteLength + nor.byteLength + idx.byteLength + 2);
  bin.set(new Uint8Array(pos.buffer), 0); bin.set(new Uint8Array(nor.buffer), pos.byteLength); bin.set(new Uint8Array(idx.buffer), pos.byteLength + nor.byteLength);
  const json = {
    asset: { version: '2.0' },
    scene: 0, scenes: [{ nodes: [0] }],
    nodes: [{ name: 'quad', mesh: 0, ...node }],
    meshes: [{ name: 'Quad', primitives: [{ attributes: { POSITION: 0, ...(normals ? { NORMAL: 1 } : {}) }, indices: 2, ...(material ? { material: 0 } : {}) }] }],
    materials: [{ pbrMetallicRoughness: { baseColorFactor: [0.8, 0.2, 0.1, 1] } }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 4, type: 'VEC3' },
      { bufferView: 1, componentType: 5126, count: 4, type: 'VEC3' },
      { bufferView: 2, componentType: 5123, count: 6, type: 'SCALAR' },
    ],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 48 }, { buffer: 0, byteOffset: 48, byteLength: 48 }, { buffer: 0, byteOffset: 96, byteLength: 12 }],
    buffers: [{ byteLength: bin.byteLength }],
  };
  return { json, bin };
}

test('glTF: a GLB with positions, normals, indices, a material colour and a node transform', () => {
  const { json, bin } = quadModel({ node: { translation: [10, 0, -5], scale: [2, 2, 2] } });
  const model = parseGltf(makeGlb(json, bin.buffer));
  assert.equal(model.meshes.length, 1);
  assert.equal(model.instances.length, 1);
  const mesh = model.meshes[0];
  assert.equal(mesh.vertexCount, 4);
  assert.equal(mesh.indices.length, 6);
  assert.deepEqual([...mesh.vertices.slice(0, 6)], [0, 0, 0, 0, 0, 1], 'first vertex: position then normal');
  assert.deepEqual([...mesh.vertices.slice(6, 9)], [1, 0, 0]);
  assert.deepEqual(mesh.max, [1, 1, 0]);
  const inst = model.instances[0];
  assert.deepEqual(inst.color.map((v) => +v.toFixed(3)), [0.8, 0.2, 0.1, 1]);
  assert.deepEqual([inst.matrix[0], inst.matrix[5], inst.matrix[10], inst.matrix[12], inst.matrix[13], inst.matrix[14]], [2, 2, 2, 10, 0, -5], 'the node scale and translation');
  assert.equal(inst.name, 'quad');
  assert.deepEqual(model.warnings, []);
  // it can be drawn
  const list = new DrawList3D();
  const place = new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 100, 0, 0, 1]);
  addGltfToDrawList(list, model, place);
  const d = list.groups.get(mesh).data;
  assert.deepEqual([d[12], d[13], d[14]], [110, 0, -5], 'the model placement is applied on top of the node transform');
});

test('glTF: node hierarchies compose, missing normals are computed, a data-URI .gltf works, no-scene files show every mesh', () => {
  const { json, bin } = quadModel({ normals: false, material: false });
  // child node under a parent that moves and rotates a quarter turn about y
  json.nodes = [{ name: 'parent', translation: [5, 0, 0], rotation: [0, Math.SQRT1_2, 0, Math.SQRT1_2], children: [1] }, { name: 'child', mesh: 0, translation: [0, 0, 1] }];
  json.scenes = [{ nodes: [0] }];
  const b64 = Buffer.from(new Uint8Array(bin.buffer)).toString('base64');
  json.buffers = [{ byteLength: bin.byteLength, uri: `data:application/octet-stream;base64,${b64}` }];
  const model = parseGltf(JSON.stringify(json));
  const m = model.instances[0].matrix;
  // the child's (0,0,1) rotated a quarter turn about y becomes (1, 0, 0); plus the parent's (5,0,0)
  assert.ok(Math.abs(m[12] - 6) < 1e-6 && Math.abs(m[13]) < 1e-6 && Math.abs(m[14]) < 1e-6, `world position ${[m[12], m[13], m[14]]}`);
  const n = model.meshes[0].vertices;
  assert.deepEqual([n[3], n[4], n[5]].map((v) => Math.round(v)), [0, 0, 1], 'normals were computed from the triangles');
  assert.deepEqual(model.instances[0].color, [1, 1, 1, 1], 'no material: white');
  delete json.scenes; delete json.scene;
  const unscened = parseGltf(json);
  assert.equal(unscened.instances.length, 1, 'with no scene every mesh is shown');
});

test('glTF: warnings for what is ignored; clear errors for what cannot be read', () => {
  const { json, bin } = quadModel();
  json.materials = [{ normalTexture: { index: 0 } }]; json.animations = [{ channels: [{ target: { node: 0, path: 'weights' }, sampler: 0 }], samplers: [] }]; // morph weights: not supported
  assert.deepEqual(parseGltf(makeGlb(json, bin.buffer)).warnings.length, 2);
  json.meshes[0].primitives.push({ attributes: { POSITION: 0 }, mode: 1 });
  assert.match(parseGltf(makeGlb(json, bin.buffer)).warnings.join(), /only triangle lists/);
  const bad = (mutate, pattern) => { const q = quadModel(); mutate(q.json); assert.throws(() => parseGltf(makeGlb(q.json, q.bin.buffer)), pattern); };
  bad((j) => { j.accessors[2].count = 600; }, /reads past the end/);
  bad((j) => { j.accessors[0].sparse = {}; }, /sparse/);
  bad((j) => { j.extensionsRequired = ['KHR_draco_mesh_compression']; }, /KHR_draco/);
  bad((j) => { j.nodes[0].children = [0]; }, /too deep/);
  bad((j) => { j.nodes[0].mesh = 0; j.scenes[0].nodes = [7]; }, /node 7 does not exist/);
  bad((j) => { j.meshes[0].primitives[0].attributes = {}; }, /no POSITION/);
  bad((j) => { j.accessors[2].count = 3; j.accessors[0].count = 2; }, /points past the last vertex/);
  assert.throws(() => parseGltf(new ArrayBuffer(40)), /not a GLB/);
  assert.throws(() => parseGltf('{"asset":{"version":"1.0"}}'), /not a glTF 2.0/);
  const good = quadModel(); const glb = makeGlb(good.json, good.bin.buffer);
  assert.throws(() => parseGltf(glb.slice(0, 100)), /truncated|no JSON/);
  const ext = quadModel(); ext.json.buffers = [{ byteLength: 8, uri: 'model.bin' }];
  assert.throws(() => parseGltf(ext.json), /was not provided/);
  assert.equal(parseGltf(ext.json, { buffers: { 'model.bin': ext.bin.buffer } }).instances.length, 1, 'external buffers are accepted when given');
});

test('an orthographic camera: things keep their size at any distance, rays are parallel, and what is behind the camera is still seen', () => {
  const cam = new Camera3D({ x: 0, y: 0, z: 10, viewW: 800, viewH: 400 });
  cam.ortho = 5;                                           // ten units tall
  cam.update();
  const near = cam.worldToScreen(1, 0, 8);
  const far = cam.worldToScreen(1, 0, -100);
  assert.ok(Math.abs(near.x - far.x) < 1e-6 && Math.abs(near.y - far.y) < 1e-6, 'a point keeps its place on the screen however far it is');
  assert.ok(Math.abs(cam.worldToScreen(0, 5, 0).y) < 1e-6, 'the top of the view is half the ortho height up');
  assert.ok(Math.abs(cam.worldToScreen(10, 0, 0).x - 800) < 1e-6, 'and the width follows the aspect ratio: ten units is half the 20-unit width');
  assert.ok(Math.abs(far.depth - 110) < 1e-6 && Math.abs(near.depth - 2) < 1e-6, 'depth is still the distance in front of the camera');
  const a = [0, 0, 0], d1 = [0, 0, 0], b = [0, 0, 0], d2 = [0, 0, 0];
  cam.screenToRay(100, 100, a, d1);
  cam.screenToRay(700, 300, b, d2);
  assert.ok(Math.abs(d1[2] + 1) < 1e-9 && Math.abs(d2[2] + 1) < 1e-9 && Math.abs(d1[0]) < 1e-9, 'every ray looks straight ahead');
  assert.ok(a[0] < b[0] && a[1] > b[1], 'but they start from different places');
  assert.equal(cam.sphereVisible(0, 0, 30, 0.5), true, 'something behind the camera is inside the view box');
  assert.equal(cam.sphereVisible(0, 20, 0, 0.5), false, 'and something above the view is not');
  cam.ortho = 0;
  cam.update();
  assert.notEqual(cam.worldToScreen(1, 0, 8).x, cam.worldToScreen(1, 0, -100).x, 'back to perspective');
});
