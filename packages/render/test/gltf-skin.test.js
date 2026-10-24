import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseGltf, addGltfToDrawList, samplePose, DrawList3D } from '../src/index.js';

const near = (a, b, tol = 1e-5, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} ${a} vs ${b}`);

/**
 * A two-joint strip: joints are node 0 (root) and node 1 (child, one metre up, given as a matrix to exercise decomposition);
 * the mesh is a 1 m wide, 2 m tall quad whose lower vertices follow the root and upper ones the child. The animation bends
 * the child by 90 degrees about z over one second. `reverse` lists the joints child-first in the skin.
 */
function skinnedModel({ reverse = false, interpolation = 'LINEAR' } = {}) {
  const chunks = [];
  const add = (typed) => { const offset = chunks.reduce((n, c) => n + c.byteLength, 0); chunks.push(new Uint8Array(typed.buffer.slice(typed.byteOffset, typed.byteOffset + typed.byteLength))); return offset; };
  const pos = new Float32Array([-0.5, 0, 0, 0.5, 0, 0, -0.5, 2, 0, 0.5, 2, 0]);
  const rootIdx = reverse ? 1 : 0, childIdx = reverse ? 0 : 1;
  const joints = new Uint8Array([rootIdx, 0, 0, 0, rootIdx, 0, 0, 0, childIdx, 0, 0, 0, childIdx, 0, 0, 0]);
  const weights = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]);
  const indices = new Uint16Array([0, 1, 3, 0, 3, 2, 0, 0]); // padded to a multiple of 4 bytes
  const ident = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], childIbm = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, -1, 0, 1];
  const ibm = new Float32Array(reverse ? [...childIbm, ...ident] : [...ident, ...childIbm]);
  const times = new Float32Array([0, 1]);
  const s = Math.SQRT1_2;
  const rot = new Float32Array([0, 0, 0, 1, 0, 0, s, s]);
  const cubic = new Float32Array([0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, /* key 1: in, value, out */ 0, 0, 0, 0, 0, 0, s, s, 0, 0, 0, 0]);
  const out = interpolation === 'CUBICSPLINE' ? cubic : rot;
  const o = { pos: add(pos), joints: add(joints), weights: add(weights), indices: add(indices), ibm: add(ibm), times: add(times), rot: add(out) };
  const bytes = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0));
  let at = 0; for (const c of chunks) { bytes.set(c, at); at += c.byteLength; }
  const uri = `data:application/octet-stream;base64,${Buffer.from(bytes).toString('base64')}`;
  return {
    asset: { version: '2.0' },
    buffers: [{ byteLength: bytes.length, uri }],
    bufferViews: Object.values(o).map((byteOffset, i, all) => ({ buffer: 0, byteOffset, byteLength: (i + 1 < all.length ? all[i + 1] : bytes.length) - byteOffset })),
    accessors: [
      { bufferView: 0, componentType: 5126, count: 4, type: 'VEC3', min: [-0.5, 0, 0], max: [0.5, 2, 0] },
      { bufferView: 1, componentType: 5121, count: 4, type: 'VEC4' },
      { bufferView: 2, componentType: 5126, count: 4, type: 'VEC4' },
      { bufferView: 3, componentType: 5123, count: 6, type: 'SCALAR' },
      { bufferView: 4, componentType: 5126, count: 2, type: 'MAT4' },
      { bufferView: 5, componentType: 5126, count: 2, type: 'SCALAR' },
      { bufferView: 6, componentType: 5126, count: interpolation === 'CUBICSPLINE' ? 6 : 2, type: 'VEC4' },
    ],
    meshes: [{ name: 'strip', primitives: [{ attributes: { POSITION: 0, JOINTS_0: 1, WEIGHTS_0: 2 }, indices: 3 }] }],
    nodes: [
      { name: 'root', children: [1] },
      { name: 'child', matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 1, 0, 1] },
      { name: 'body', mesh: 0, skin: 0, translation: [50, 0, 0] }, // glTF ignores a skinned mesh node's own transform
    ],
    skins: [{ name: 'rig', joints: reverse ? [1, 0] : [0, 1], inverseBindMatrices: 4 }],
    animations: [{ name: 'bend', samplers: [{ input: 5, output: 6, interpolation }], channels: [{ sampler: 0, target: { node: 1, path: 'rotation' } }] }],
    scenes: [{ nodes: [0, 2] }],
    scene: 0,
  };
}

for (const reverse of [false, true]) {
  test(`glTF skins: skeleton, weights and animation (${reverse ? 'child-first joint order' : 'parents first'})`, () => {
    const model = parseGltf(skinnedModel({ reverse }));
    assert.deepEqual(model.warnings, []);
    assert.equal(model.skins.length, 1);
    const { skeleton, clips } = model.skins[0];
    assert.equal(skeleton.count, 2);
    near(skeleton.restT[(reverse ? 0 : 1) * 3 + 1], 1, 1e-6, 'a matrix-given node is decomposed into a translation');
    assert.equal(clips.length, 1);
    assert.equal(clips[0].name, 'bend');
    near(clips[0].duration, 1);
    const inst = model.instances.find((i) => i.skin === 0);
    assert.ok(inst.mesh.skin, 'the mesh is a skinned mesh');
    assert.equal(inst.mesh.jointCount, 2);
    near(inst.matrix[12], 0, 1e-9, "the node's translation is ignored for skinned meshes");

    const pose = skeleton.createPose();
    samplePose(skeleton, clips[0], 0, pose);
    const rest = skeleton.computePalette(pose);
    for (let j = 0; j < 2; j++) for (let k = 0; k < 16; k++) near(rest[j * 16 + k], k % 5 === 0 ? 1 : 0, 1e-5, 'bind pose is the identity');

    samplePose(skeleton, clips[0], 0.999999, pose); // end of the bend (a looping clip wraps at exactly 1): the child turned 90 degrees about z
    const palette = skeleton.computePalette(pose);
    const childJoint = reverse ? 0 : 1, rootJoint = reverse ? 1 : 0;
    // the top-left vertex (-0.5, 2, 0) belongs to the child: it swings to (-1, 0.5, 0)
    const m = palette.subarray(childJoint * 16, childJoint * 16 + 16);
    const p = [-0.5, 2, 0];
    near(m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], -1, 1e-4, 'x');
    near(m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], 0.5, 1e-4, 'y');
    const r = palette.subarray(rootJoint * 16, rootJoint * 16 + 16);
    near(r[0], 1); near(r[13], 0); // the root stays

    const list = new DrawList3D();
    addGltfToDrawList(list, model);
    assert.equal(list.skinned.get(inst.mesh).count, 1, 'drawn skinned, in the bind pose by default');
    addGltfToDrawList(list, model, undefined, { 0: palette });
    near(list.skinned.get(inst.mesh).palettes[32 + childJoint * 16 + 12], m[12], 1e-6, 'a given palette is used');
  });
}

test('glTF skins: cubic-spline animation is played as linear with a warning; bad data is refused', () => {
  const model = parseGltf(skinnedModel({ interpolation: 'CUBICSPLINE' }));
  assert.ok(model.warnings.some((w) => /cubic/.test(w)));
  const pose = model.skins[0].skeleton.createPose();
  samplePose(model.skins[0].skeleton, model.skins[0].clips[0], 0.999999, pose);
  near(pose.r[4 + 2], Math.SQRT1_2, 1e-3, 'the keyed values, not the tangents');

  const noJoints = skinnedModel(); noJoints.skins[0].joints = [];
  assert.throws(() => parseGltf(noJoints), /no joints/);
  const missing = skinnedModel(); missing.skins[0].joints = [0, 9];
  assert.throws(() => parseGltf(missing), /does not exist/);
  const badSkin = skinnedModel(); badSkin.nodes[2].skin = 3;
  assert.throws(() => parseGltf(badSkin), /skin 3 does not exist/);
  const wrongJoint = skinnedModel(); wrongJoint.skins[0].joints = [0]; wrongJoint.skins[0].inverseBindMatrices = undefined;
  assert.throws(() => parseGltf(wrongJoint), /outside/);
});
