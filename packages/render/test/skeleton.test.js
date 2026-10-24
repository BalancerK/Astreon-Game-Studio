import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Skeleton, AnimationClip, Animator, samplePose, blendPoses, createSkinnedMesh, DrawList3D, SKIN_FLOATS } from '../src/index.js';

const near = (a, b, tol = 1e-5, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} ${a} vs ${b}`);
const rotZ = (angle) => [0, 0, Math.sin(angle / 2), Math.cos(angle / 2)];

/** A straight chain along +y: root at the origin, then two joints one metre apart. */
const chain = () => new Skeleton([
  { name: 'root', parent: -1 },
  { name: 'mid', parent: 0, t: [0, 1, 0] },
  { name: 'tip', parent: 1, t: [0, 1, 0] },
]);

/** Apply the 4x4 column-major matrix m to a point. */
const apply = (m, p) => [
  m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
  m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
  m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
];

test('in the rest pose every skinning matrix is the identity, so a skinned mesh looks like its bind pose', () => {
  const sk = chain();
  const palette = sk.computePalette(sk.createPose().setRest(sk));
  for (let j = 0; j < 3; j++) for (let k = 0; k < 16; k++) near(palette[j * 16 + k], k % 5 === 0 ? 1 : 0, 1e-6, `joint ${j} element ${k}`);
});

test('turning a joint carries everything below it, and the palette moves bind-pose points to the right place', () => {
  const sk = chain();
  const pose = sk.createPose().setRest(sk);
  pose.r.set(rotZ(Math.PI / 2), 4); // bend the middle joint 90 degrees (counter-clockwise around z)
  const palette = sk.computePalette(pose);
  const tipWorld = sk.jointWorld(2);
  near(tipWorld[12], -1, 1e-6, 'tip x'); near(tipWorld[13], 1, 1e-6, 'tip y'); // (0,2,0) swings to (-1,1,0)
  const moved = apply(palette.subarray(32, 48), [0, 2, 0]); // a vertex bound to the tip, at its bind position
  near(moved[0], -1, 1e-6); near(moved[1], 1, 1e-6);
  const still = apply(palette.subarray(0, 16), [0, 0.5, 0]); // a vertex bound to the root does not move
  near(still[0], 0); near(still[1], 0.5);
});

test('clip sampling: linear interpolation, looping, clamping, step tracks, and untouched channels stay at rest', () => {
  const sk = chain();
  const clip = new AnimationClip('slide', [
    { joint: 1, path: 't', times: [0, 1, 2], values: [0, 1, 0, 2, 1, 0, 0, 1, 0] },
    { joint: 2, path: 't', times: [0, 1], values: [0, 1, 0, 0, 5, 0], step: true },
  ]);
  assert.equal(clip.duration, 2);
  const pose = sk.createPose();
  samplePose(sk, clip, 0.5, pose);
  near(pose.t[3], 1); near(pose.t[4], 1); // x halfway from 0 to 2 (joint 1 translation)
  near(pose.t[7], 1, 1e-6, 'step track holds its first key');
  samplePose(sk, clip, 1.5, pose);
  near(pose.t[3], 1, 1e-6, 'back down toward 0 on the second half');
  near(pose.t[7], 5, 1e-6, 'step track jumped at its last key');
  samplePose(sk, clip, 2.5, pose); // loops: same as 0.5
  near(pose.t[3], 1);
  const once = new AnimationClip('once', clip.tracks, { loop: false });
  samplePose(sk, once, 99, pose);
  near(pose.t[3], 0, 1e-6, 'clamped to the end');
  near(pose.r[3], 1, 1e-6, 'rotation still at rest');
  near(pose.t[1], 0); // joint 0 untouched
});

test('blending poses: halfway between two rotations is half the angle, and translations average', () => {
  const sk = chain();
  const a = sk.createPose().setRest(sk), b = sk.createPose().setRest(sk);
  b.r.set(rotZ(Math.PI / 2), 4);
  b.t.set([0, 3, 0], 3);
  const out = sk.createPose();
  blendPoses(out, a, b, 0.5);
  const half = rotZ(Math.PI / 4);
  for (let k = 0; k < 4; k++) near(out.r[4 + k], half[k], 1e-3);
  near(out.t[4], 2);
  blendPoses(out, a, b, 0);
  near(out.t[4], 1);
});

test('the animator cross-fades from the old clip to the new one over the fade time', () => {
  const sk = chain();
  const high = new AnimationClip('high', [{ joint: 0, path: 't', times: [0], values: [0, 10, 0] }]);
  const low = new AnimationClip('low', [{ joint: 0, path: 't', times: [0], values: [0, 0, 0] }]);
  const an = new Animator(sk);
  an.play(high);
  an.update(0.016);
  near(an.pose.t[1], 10);
  an.play(low, { fade: 0.2 });
  an.update(0.1);
  near(an.pose.t[1], 5, 1e-4, 'halfway through the fade');
  an.update(0.2);
  near(an.pose.t[1], 0, 1e-6, 'fade finished');
  an.play(low, { fade: 0.2 }); // same clip again: nothing restarts
  an.update(0.016);
  near(an.pose.t[1], 0);
});

test('skinned meshes: weights are normalised, bad joints and weights are refused', () => {
  const v = [0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0];
  const mesh = createSkinnedMesh(v, [0, 1, 2], [0, 1, 0, 0, 1, 1, 0, 0, 2, 2, 2, 2], [2, 2, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1], 3);
  assert.equal(mesh.skin.length, 3 * SKIN_FLOATS);
  near(mesh.skin[4] + mesh.skin[5], 1); near(mesh.skin[4], 0.5);
  near(mesh.skin[SKIN_FLOATS + 4], 1, 1e-9, 'a vertex with all-zero weights follows its first joint');
  assert.throws(() => createSkinnedMesh(v, [0, 1, 2], new Array(12).fill(5), new Array(12).fill(1), 3), /outside 0\.\.2/);
  assert.throws(() => createSkinnedMesh(v, [0, 1, 2], new Array(12).fill(0), new Array(12).fill(-1), 3), /weights/);
  assert.throws(() => createSkinnedMesh(v, [0, 1, 2], [0], [1], 3), /4 joints/);
});

test('the draw list keeps skinned instances apart and copies their palettes', () => {
  const v = [0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0];
  const mesh = createSkinnedMesh(v, [0, 1, 2], new Array(12).fill(0), [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 2);
  const list = new DrawList3D();
  const palette = new Float32Array(32).fill(1);
  const identity = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  list.addSkinned(mesh, identity, palette, 0.5, 0.6, 0.7);
  palette.fill(9); // reusing the caller's array must not change what was added
  list.addSkinned(mesh, identity, palette);
  assert.equal(list.count, 2);
  const g = list.skinned.get(mesh);
  assert.equal(g.count, 2);
  assert.equal(g.palettes[0], 1); assert.equal(g.palettes[32], 9);
  near(g.data[17], 0.6);
  assert.throws(() => list.addSkinned(mesh, identity, new Float32Array(8)), /palette/);
  assert.throws(() => list.addSkinned({ name: 'plain', vertices: v, indices: [] }, identity, palette), /createSkinnedMesh/);
  list.clear();
  assert.equal(list.count, 0); assert.equal(g.count, 0);
  for (let i = 0; i < 40; i++) list.addSkinned(mesh, identity, palette); // growth path
  assert.equal(list.skinned.get(mesh).count, 40);
});
