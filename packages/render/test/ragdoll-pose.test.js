import { test } from 'node:test';
import assert from 'node:assert/strict';
import { quat } from '../../math/src/index.js';
import { PhysicsWorld, Ragdoll, humanoidRagdollSpec } from '../../physics/src/index.js';
import { TriWorld } from '../../physics/src/tri-world.js';
import { Skeleton, poseFromRagdoll, poseToRagdoll, ragdollSpecFromSkeleton } from '../src/index.js';

const near = (a, b, eps = 1e-5, msg = '') => assert.ok(Math.abs(a - b) <= eps, `${msg} ${a} vs ${b}`);
const MIXAMO = { hips: 'mixamorig:Hips', 'spine.1': 'mixamorig:Spine1', head: 'mixamorig:Head', 'upperarm.l': 'mixamorig:LeftArm', 'lowerarm.l': 'mixamorig:LeftForeArm', 'upperarm.r': 'mixamorig:RightArm', 'lowerarm.r': 'mixamorig:RightForeArm', 'upleg.l': 'mixamorig:LeftUpLeg', 'lowleg.l': 'mixamorig:LeftLeg', 'foot.l': 'mixamorig:LeftFoot', 'upleg.r': 'mixamorig:RightUpLeg', 'lowleg.r': 'mixamorig:RightLeg', 'foot.r': 'mixamorig:RightFoot' };
// a skeleton with a joint at the start of each bone of a ragdoll description, named the Mixamo way, plus a joint the ragdoll has no bone for
function skeletonFor(spec, { scale = 1, extra = true } = {}) {
  const joints = spec.bones.map((b, i) => {
    const parent = b.parent, base = parent >= 0 ? spec.bones[parent].from : [0, 0, 0];
    return { name: MIXAMO[b.name], parent, t: [(b.from[0] - base[0]) * scale, (b.from[1] - base[1]) * scale, (b.from[2] - base[2]) * scale] };
  });
  if (extra) joints.push({ name: 'mixamorig:LeftHandIndex1', parent: spec.bones.findIndex((b) => b.name === 'lowerarm.l'), t: [0.05, -0.2, 0] });
  return new Skeleton(joints);
}
const worldPos = (skel, pose, i) => { skel.computePalette(pose); const m = skel.jointWorld(i); return [m[12], m[13], m[14]]; };
const axisAngle = (axis, a) => quat.fromAxisAngle([0, 0, 0, 1], axis, a);

test('an untouched ragdoll gives the skeleton its rest pose', () => {
  const spec = humanoidRagdollSpec(), sk = skeletonFor(spec), rag = new Ragdoll(spec, { x: 2, y: 0, z: 1, yaw: 0 });
  const rest = sk.createPose().setRest(sk), pose = sk.createPose();
  poseFromRagdoll(sk, pose, rag);
  for (let i = 0; i < pose.r.length; i++) near(Math.abs(pose.r[i]), Math.abs(rest.r[i]), 1e-6, `r${i}`);
  // the model-space of the ragdoll is placed in the world; its model space is untouched by the placement
  for (let i = 0; i < pose.t.length; i++) near(pose.t[i], rest.t[i], 1e-6, `t${i}`);
});

test('a bone that has turned turns its joint, and what hangs from the joint comes along', () => {
  const spec = humanoidRagdollSpec(), sk = skeletonFor(spec), rag = new Ragdoll(spec);
  const arm = rag.names.indexOf('upperarm.l'), delta = axisAngle([0, 0, 1], 0.6);
  rag.setBone(arm, delta, spec.bones[arm].from);
  const pose = sk.createPose(); poseFromRagdoll(sk, pose, rag);
  const shoulder = worldPos(sk, pose, arm), elbow = worldPos(sk, pose, rag.names.indexOf('lowerarm.l'));
  const restOffset = [spec.bones[arm].to[0] - spec.bones[arm].from[0], spec.bones[arm].to[1] - spec.bones[arm].from[1], spec.bones[arm].to[2] - spec.bones[arm].from[2]];
  const want = quat.rotate([0, 0, 0], delta, restOffset);
  for (let k = 0; k < 3; k++) near(elbow[k] - shoulder[k], want[k], 1e-5, `elbow offset ${k}`);
  const index = sk.indexOf('mixamorig:LeftHandIndex1'), wrist = worldPos(sk, pose, rag.names.indexOf('lowerarm.l')), finger = worldPos(sk, pose, index);
  near(Math.hypot(finger[0] - wrist[0], finger[1] - wrist[1], finger[2] - wrist[2]), Math.hypot(0.05, 0.2), 1e-5, 'a joint without a bone is carried along rigidly');
});

test('an animated pose goes into a ragdoll and comes back out unchanged', () => {
  const spec = humanoidRagdollSpec(), sk = skeletonFor(spec), rag = new Ragdoll(spec, { x: 1, y: 0, z: 1, yaw: 0 });
  const pose = sk.createPose().setRest(sk);
  const turn = (joint, axis, a) => { const q = axisAngle(axis, a), r = pose.r.subarray(joint * 4, joint * 4 + 4), m = quat.multiply([0, 0, 0, 1], q, Array.from(r)); r.set(m); };
  turn(0, [0, 1, 0], 0.4); turn(1, [1, 0, 0], 0.3); turn(3, [0, 0, 1], -0.8); turn(4, [1, 0, 0], -0.9); turn(7, [1, 0, 0], 0.7); turn(8, [1, 0, 0], 0.5); turn(2, [0, 1, 0], 0.5);
  pose.t[0] += 0.3; pose.t[1] -= 0.1; pose.t[2] += 0.2;
  poseToRagdoll(sk, pose, rag, { velocity: [1, 0, 2] });
  const back = sk.createPose(); poseFromRagdoll(sk, back, rag);
  for (let j = 0; j < sk.count - 1; j++) { const a = worldPos(sk, pose, j), b = worldPos(sk, back, j); for (let k = 0; k < 3; k++) near(a[k], b[k], 1e-5, `joint ${j} axis ${k}`); }
  for (const b of rag.bodies) { near(b.vx, 1, 1e-12); near(b.vz, 2, 1e-12); near(b.wx, 0, 1e-12); }
});

test('a ragdoll started from a pose falls and ends up lying on the floor, and the skeleton follows it', () => {
  const spec = humanoidRagdollSpec(), sk = skeletonFor(spec);
  const t = new TriWorld(); t.addBox(0, -1, 0, 50, 1, 50); t.build();
  const w = new PhysicsWorld({ terrain: t, substeps: 4, iterations: 16 });
  const rag = new Ragdoll(spec, { x: 0, y: 0.05, z: 0, yaw: 0 }).addTo(w);
  const pose = sk.createPose().setRest(sk); poseToRagdoll(sk, pose, rag, { velocity: [0, 0, 3] });
  for (let i = 0; i < 60 * 5; i++) w.step(1 / 60);
  const out = sk.createPose(); poseFromRagdoll(sk, out, rag);
  for (const v of [...out.r, ...out.t]) assert.ok(Number.isFinite(v));
  const hips = worldPos(sk, out, 0);
  assert.ok(hips[1] < 0.5, `the hips have come down: ${hips[1]}`);
  assert.ok(hips[2] > 0.5, `it was thrown forward (z) and slid: ${hips[2]}`);
  const head = worldPos(sk, out, 2); assert.ok(head[1] < 0.6, `the head is low: ${head[1]}`);
  // the skeleton's limbs keep their lengths: pose and skeleton agree with the bodies
  const sh = worldPos(sk, out, 3), el = worldPos(sk, out, 4);
  near(Math.hypot(el[0] - sh[0], el[1] - sh[1], el[2] - sh[2]), Math.hypot(spec.bones[4].from[0] - spec.bones[3].from[0], spec.bones[4].from[1] - spec.bones[3].from[1], spec.bones[4].from[2] - spec.bones[3].from[2]), 1e-4, 'upper arm length');
});

test('a ragdoll description can be fitted to a skeleton of other proportions, and the base is left alone', () => {
  const base = humanoidRagdollSpec({ height: 1.8 }), copy = JSON.stringify(base);
  const sk = skeletonFor(humanoidRagdollSpec({ height: 2.1 }), { extra: false });
  const fit = ragdollSpecFromSkeleton(sk, base);
  assert.equal(JSON.stringify(base), copy, 'base unchanged');
  const tall = humanoidRagdollSpec({ height: 2.1 });
  for (const name of ['upperarm.l', 'lowerarm.l', 'upleg.r', 'lowleg.r', 'hips']) {
    const f = fit.bones.find((b) => b.name === name), t = tall.bones.find((b) => b.name === name);
    for (let k = 0; k < 3; k++) near(f.from[k], t.from[k], 1e-5, `${name} from ${k}`);
  }
  const arm = fit.bones.find((b) => b.name === 'upperarm.l'), elbow = fit.bones.find((b) => b.name === 'lowerarm.l');
  for (let k = 0; k < 3; k++) near(arm.to[k], elbow.from[k], 1e-5, 'a bone ends where its child starts');
  assert.deepEqual(fit.bones.map((b) => [b.radius, b.mass]), base.bones.map((b) => [b.radius, b.mass]), 'radii and masses come from the base');
  new Ragdoll(fit);                                                      // and it builds
});
