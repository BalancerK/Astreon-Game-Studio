import { test } from 'node:test';
import assert from 'node:assert/strict';
import { quat } from '../../math/src/index.js';
import { Skeleton, AnimationClip, samplePose, solveTwoBone, solveChain, aimJoint, humanoidKey, autoMapJoints, retargetPose, retargetClip } from '../src/index.js';

const near = (a, b, eps = 1e-4, msg = '') => assert.ok(Math.abs(a - b) <= eps, `${msg} ${a} vs ${b}`);
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const worldPos = (skel, pose, i) => { skel.computePalette(pose); const m = skel.jointWorld(i); return [m[12], m[13], m[14]]; };
const axisAngle = (axis, angle) => quat.fromAxisAngle([0, 0, 0, 1], axis, angle);
const setRot = (pose, i, q) => { for (let k = 0; k < 4; k++) pose.r[i * 4 + k] = q[k]; };

// an arm lying along +x: shoulder, elbow, wrist, each one metre on
const arm = (opts = {}) => new Skeleton([
  { name: 'shoulder', parent: -1 }, { name: 'elbow', parent: 0, t: [1, 0, 0] }, { name: 'wrist', parent: 1, t: [1, 0, 0] },
], opts);

test('two-bone IK reaches a target within reach and keeps both bones the same length', () => {
  const sk = arm(), pose = sk.createPose().setRest(sk);
  const r = solveTwoBone(sk, pose, { root: 0, mid: 1, end: 2, target: [1, 1, 0], pole: [0, 0, 1] });
  assert.equal(r.reached, true); assert.ok(r.distance < 1e-4, `distance ${r.distance}`);
  const e = worldPos(sk, pose, 1), w = worldPos(sk, pose, 2);
  near(dist([0, 0, 0], e), 1, 1e-5, 'upper bone'); near(dist(e, w), 1, 1e-5, 'lower bone'); near(dist(w, [1, 1, 0]), 0, 1e-4, 'wrist at the target');
});

test('the pole point decides which way the elbow bends', () => {
  for (const side of [1, -1]) {
    const sk = arm(), pose = sk.createPose().setRest(sk);
    solveTwoBone(sk, pose, { root: 0, mid: 1, end: 2, target: [1.2, 0, 0], pole: [0.5, 0, side * 3] });
    const e = worldPos(sk, pose, 1);
    assert.ok(e[2] * side > 0.4, `elbow z ${e[2]} for pole side ${side}`);
    near(dist(worldPos(sk, pose, 2), [1.2, 0, 0]), 0, 1e-4);
  }
  const up = arm(), p = up.createPose().setRest(up);
  solveTwoBone(up, p, { root: 0, mid: 1, end: 2, target: [1.2, 0, 0], pole: [0.6, 5, 0] });
  assert.ok(worldPos(up, p, 1)[1] > 0.4, 'a pole above bends the elbow up');
});

test('a target out of reach stretches the limb straight toward it, and one too close folds it without breaking', () => {
  const sk = arm(), pose = sk.createPose().setRest(sk);
  const far = solveTwoBone(sk, pose, { root: 0, mid: 1, end: 2, target: [0, 5, 0], pole: [0, 0, 1] });
  assert.equal(far.reached, false);
  const w = worldPos(sk, pose, 2), e = worldPos(sk, pose, 1);
  near(w[0], 0, 1e-3); near(w[1], 2, 1e-3); near(dist(e, [0, 0, 0]), 1, 1e-4);
  const sk2 = arm(), p2 = sk2.createPose().setRest(sk2);
  const close = solveTwoBone(sk2, p2, { root: 0, mid: 1, end: 2, target: [0.0001, 0, 0], pole: [0, 1, 0] });
  assert.ok(Number.isFinite(close.distance) && close.distance < 0.01, `distance ${close.distance}`);
  for (const v of p2.r) assert.ok(Number.isFinite(v));
});

test('IK works for a limb whose parents are rotated and whose joints have rest rotations', () => {
  const turned = axisAngle([0, 1, 0], 1.1), tilted = axisAngle([0, 0, 1], -0.6);
  const sk = new Skeleton([
    { name: 'torso', parent: -1, r: Array.from(turned), t: [0.5, 1, 0] },
    { name: 'shoulder', parent: 0, t: [0, 0.2, 0.3], r: Array.from(tilted) },
    { name: 'elbow', parent: 1, t: [0.9, 0, 0], r: Array.from(axisAngle([0, 1, 0], 0.4)) },
    { name: 'wrist', parent: 2, t: [0.8, 0, 0] },
  ], { rootMatrix: Float64Array.from([0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 3, 0, 1, 1]) });  // everything turned a quarter about y and moved
  const pose = sk.createPose().setRest(sk);
  const start = worldPos(sk, pose, 3);
  const target = [start[0] + 0.3, start[1] + 0.35, start[2] - 0.25];
  const lens = [dist(worldPos(sk, pose, 1), worldPos(sk, pose, 2)), dist(worldPos(sk, pose, 2), start)];
  const r = solveTwoBone(sk, pose, { root: 1, mid: 2, end: 3, target });
  assert.ok(r.distance < 1e-4, `distance ${r.distance}`);
  near(dist(worldPos(sk, pose, 1), worldPos(sk, pose, 2)), lens[0], 1e-5); near(dist(worldPos(sk, pose, 2), worldPos(sk, pose, 3)), lens[1], 1e-5);
});

test('IK weight fades the effect, and endRotation sets the end joint\'s world rotation', () => {
  const sk = arm(), rest = sk.createPose().setRest(sk);
  const none = sk.createPose().setRest(sk);
  assert.equal(solveTwoBone(sk, none, { root: 0, mid: 1, end: 2, target: [1, 1, 0], weight: 0 }).reached, false);
  assert.deepEqual(Array.from(none.r), Array.from(rest.r), 'weight 0 changes nothing');
  const half = sk.createPose().setRest(sk);
  solveTwoBone(sk, half, { root: 0, mid: 1, end: 2, target: [0.5, 1.5, 0], pole: [0, 0, 1], weight: 0.5 });
  const w = worldPos(sk, half, 2);
  assert.ok(w[0] < 2 - 0.05 && w[0] > 0.5 && w[1] > 0.05 && w[1] < 1.5, `halfway: ${w}`);
  const flat = sk.createPose().setRest(sk), want = axisAngle([0, 0, 1], 0.7);
  solveTwoBone(sk, flat, { root: 0, mid: 1, end: 2, target: [1, 1, 0], pole: [0, 0, 1], endRotation: want });
  sk.computePalette(flat);
  const m = sk.jointWorld(2), back = quat.rotate([0, 0, 0], want, [1, 0, 0]);
  near(m[0], back[0], 1e-4); near(m[1], back[1], 1e-4);
});

test('two-bone IK checks the joints are connected', () => {
  const sk = arm(), pose = sk.createPose().setRest(sk);
  assert.throws(() => solveTwoBone(sk, pose, { root: 0, mid: 2, end: 1, target: [0, 0, 0] }), /child of root/);
});

// a tail of five joints along +y
const tail = () => new Skeleton(Array.from({ length: 5 }, (_, i) => ({ name: `t${i}`, parent: i - 1, t: i ? [0, 1, 0] : [0, 0, 0] })));

test('a chain reaches a target, keeps its bone lengths and leaves its root where it was', () => {
  const sk = tail(), pose = sk.createPose().setRest(sk);
  const r = solveChain(sk, pose, [0, 1, 2, 3, 4], [2, 2, 1]);
  assert.equal(r.reached, true); assert.ok(r.distance < 1e-3, `distance ${r.distance}`);
  for (let i = 1; i < 5; i++) near(dist(worldPos(sk, pose, i), worldPos(sk, pose, i - 1)), 1, 1e-4, `bone ${i}`);
  near(dist(worldPos(sk, pose, 0), [0, 0, 0]), 0, 1e-9);
  assert.ok(r.iterations > 0 && r.iterations <= 16);
});

test('a chain out of reach straightens toward the target; a chain already there does nothing', () => {
  const sk = tail(), pose = sk.createPose().setRest(sk);
  const r = solveChain(sk, pose, [0, 1, 2, 3, 4], [10, 0, 0]);
  assert.equal(r.reached, false);
  near(dist(worldPos(sk, pose, 4), [4, 0, 0]), 0, 1e-3);
  const there = tail(), p = there.createPose().setRest(there), before = Array.from(p.r);
  const r2 = solveChain(there, p, [0, 1, 2, 3, 4], [0, 4, 0]);
  assert.equal(r2.iterations, 0); assert.ok(r2.distance < 1e-6);
  Array.from(p.r).forEach((v, i) => near(v, before[i], 1e-6));
  assert.throws(() => solveChain(there, p, [0, 2, 3], [0, 0, 0]), /not a child/); assert.throws(() => solveChain(there, p, [0], [0, 0, 0]), /at least two/);
});

test('a chain can be a part of a longer skeleton, and a partial weight leaves it partway', () => {
  const sk = tail(), pose = sk.createPose().setRest(sk);
  solveChain(sk, pose, [1, 2, 3], [1, 2.5, 0]);
  near(dist(worldPos(sk, pose, 1), [0, 1, 0]), 0, 1e-9, 'its first joint stays');
  near(dist(worldPos(sk, pose, 3), [1, 2.5, 0]), 0, 1e-3);
  const half = tail(), p = half.createPose().setRest(half);
  solveChain(half, p, [0, 1, 2, 3, 4], [3, 1, 0], { weight: 0.5 });
  const tip = worldPos(half, p, 4);
  assert.ok(tip[0] > 0.3 && tip[0] < 3 - 0.1, `tip ${tip}`);
});

test('aimJoint turns a joint\'s axis to the target, within a limit, and fades with weight', () => {
  const sk = new Skeleton([{ name: 'body', parent: -1 }, { name: 'head', parent: 0, t: [0, 1.6, 0] }]);
  const facing = (pose) => { sk.computePalette(pose); const m = sk.jointWorld(1); return [m[8], m[9], m[10]]; }; // local +z in the world
  const pose = sk.createPose().setRest(sk);
  const r = aimJoint(sk, pose, 1, [3, 1.6, 0]);
  const f = facing(pose);
  near(f[0], 1, 1e-5); near(f[2], 0, 1e-5); near(r.angle, Math.PI / 2, 1e-5); assert.equal(r.limited, false);
  const lim = sk.createPose().setRest(sk), r2 = aimJoint(sk, lim, 1, [3, 1.6, 0], { limit: 0.3 });
  assert.equal(r2.limited, true); near(r2.angle, 0.3, 1e-6);
  near(facing(lim)[0], Math.sin(0.3), 1e-5);
  const off = sk.createPose().setRest(sk); aimJoint(sk, off, 1, [3, 1.6, 0], { weight: 0 }); near(facing(off)[2], 1, 1e-9);
  const half = sk.createPose().setRest(sk); aimJoint(sk, half, 1, [3, 1.6, 0], { weight: 0.5 }); const fh = facing(half);
  assert.ok(fh[0] > 0.3 && fh[0] < 0.95 && fh[2] > 0.3, `half-turned ${fh}`);
  const other = sk.createPose().setRest(sk); aimJoint(sk, other, 1, [0, 1.6, 4], { axis: [1, 0, 0] });                  // aim local +x at a point ahead (+z)
  sk.computePalette(other); const m = sk.jointWorld(1); near(m[2], 1, 1e-5, 'local x now points along +z');
});

test('joint names match across the common rig naming schemes', () => {
  const same = (...names) => { const keys = names.map(humanoidKey); assert.ok(keys[0] && keys.every((k) => k === keys[0]), `${names} -> ${keys}`); };
  same('mixamorig:LeftUpLeg', 'LeftUpperLeg', 'thigh.L', 'Bip01 L Thigh', 'J_Bip_L_UpperLeg', 'upleg_l', 'LeftThigh');
  same('mixamorig:LeftLeg', 'LeftLowerLeg', 'shin.L', 'Bip01 L Calf', 'calf_l');
  same('mixamorig:RightForeArm', 'RightLowerArm', 'forearm.R', 'lowerarm_r', 'J_Bip_R_LowerArm');
  same('mixamorig:Spine1', 'Chest', 'Bip01 Spine1'); same('mixamorig:Spine2', 'UpperChest');
  same('mixamorig:Hips', 'pelvis', 'Bip01 Pelvis', 'Hips'); same('mixamorig:LeftShoulder', 'clavicle.L', 'LeftShoulder');
  same('mixamorig:LeftToeBase', 'LeftToes', 'toe.L'); same('mixamorig:RightHandThumb1', 'thumb_01_r', 'Thumb1.R');
  assert.notEqual(humanoidKey('LeftHand'), humanoidKey('RightHand')); assert.notEqual(humanoidKey('Spine'), humanoidKey('Spine1'));
  assert.equal(humanoidKey('Sword'), null); assert.equal(humanoidKey('LeftArmTwist_helper'), null); assert.equal(humanoidKey(''), null);
});

// two rigs of one character: a Mixamo-style one in a T-pose, and a taller Unity-style one with its arms lowered in an A-pose
const SRC = () => new Skeleton([
  { name: 'mixamorig:Hips', parent: -1, t: [0, 1, 0] }, { name: 'mixamorig:Spine', parent: 0, t: [0, 0.5, 0] },
  { name: 'mixamorig:LeftArm', parent: 1, t: [0.3, 0.3, 0] }, { name: 'mixamorig:LeftForeArm', parent: 2, t: [0.5, 0, 0] }, { name: 'mixamorig:Prop', parent: 3, t: [0.2, 0, 0] },
]);
const DST = () => new Skeleton([
  { name: 'Hips', parent: -1, t: [0, 2, 0] }, { name: 'Spine', parent: 0, t: [0, 1, 0] },
  { name: 'LeftUpperArm', parent: 1, t: [0.6, 0.6, 0], r: Array.from(axisAngle([0, 0, 1], -0.7)) }, { name: 'LeftLowerArm', parent: 2, t: [1, 0, 0] },
  { name: 'Tail', parent: 0, t: [0, -0.2, -0.5] },
]);

test('joints are matched between two rigs, each used once, with overrides for the odd ones', () => {
  assert.deepEqual(Array.from(autoMapJoints(SRC(), DST())), [0, 1, 2, 3, -1]);
  const odd = new Skeleton([{ name: 'Pelvis', parent: -1 }, { name: 'Torso', parent: 0 }]), to = new Skeleton([{ name: 'Hips', parent: -1 }, { name: 'Spine', parent: 0 }]);
  assert.deepEqual(Array.from(autoMapJoints(odd, to)), [0, -1]);
  assert.deepEqual(Array.from(autoMapJoints(odd, to, { Torso: 'Spine' })), [0, 1]);
  assert.throws(() => autoMapJoints(odd, to, { Torso: 'Nope' }), /no joint "Nope"/);
});

test('retargeting carries the movement across rigs with different rest poses and sizes', () => {
  const src = SRC(), dst = DST(), sp = src.createPose().setRest(src), out = dst.createPose();
  const turn = axisAngle([0, 1, 0], 0.5), raise = axisAngle([0, 0, 1], 1.2);
  setRot(sp, 1, turn); setRot(sp, 2, raise);                       // the source twists its spine and raises its arm
  sp.t[0] = 1; sp.t[1] = 1.2; sp.t[2] = 0;                         // and its hips move 1 m along x and 0.2 m up
  retargetPose(src, sp, dst, out);
  // the spine's world rotation changes by the same turn: spine joint of dst has the world delta 'turn' on top of its rest
  dst.computePalette(out); const spine = Array.from(dst.jointWorld(1)); const rest = dst.createPose().setRest(dst); dst.computePalette(rest);
  const spineRest = Array.from(dst.jointWorld(1));
  const expect = quat.rotate([0, 0, 0], turn, [spineRest[0], spineRest[1], spineRest[2]]);
  for (let k = 0; k < 3; k++) near(spine[k], expect[k], 1e-5, `spine axis ${k}`);
  // the upper arm bone points where the source's did, rotated by the same world change: forearm direction = turn then raise applied to the rest direction
  const armDir = (sk, pose) => { const a = worldPos(sk, pose, 2), b = worldPos(sk, pose, 3), l = dist(a, b); return [(b[0] - a[0]) / l, (b[1] - a[1]) / l, (b[2] - a[2]) / l]; };
  const restDirDst = armDir(dst, dst.createPose().setRest(dst));
  const world = quat.multiply([0, 0, 0, 1], turn, raise);          // the source's arm: parent turned by `turn`, then its own `raise` (in the turned frame, so `turn` then `raise` about the local axis)
  const got = armDir(dst, out), want = quat.rotate([0, 0, 0], world, restDirDst);
  for (let k = 0; k < 3; k++) near(got[k], want[k], 1e-4, `arm dir ${k}`);
  // hips: moved 1 m sideways, scaled by 2 / 1 for the taller body
  near(out.t[0], 2, 1e-5); near(out.t[1], 2 + 0.2 * 2, 1e-5);
  // the tail has no counterpart and stays at rest relative to its parent
  assert.deepEqual(Array.from(out.r.subarray(16, 20)), Array.from(dst.restR.subarray(16, 20)));
  const still = dst.createPose(); retargetPose(src, src.createPose().setRest(src), dst, still);
  Array.from(still.r).forEach((v, i) => near(v, dst.restR[i], 1e-5, `rest stays rest ${i}`));
  Array.from(still.t).forEach((v, i) => near(v, dst.restT[i], 1e-5, `rest hips stay ${i}`));
});

test('retargetPose can leave the hips where the destination has them', () => {
  const src = SRC(), dst = DST(), sp = src.createPose().setRest(src), out = dst.createPose();
  sp.t[0] = 1;
  retargetPose(src, sp, dst, out, undefined, { translation: false });
  near(out.t[0], 0, 1e-9);
});

test('a retargeted clip plays on the destination skeleton like the source clip does on its own', () => {
  const src = SRC(), dst = DST();
  const clip = new AnimationClip('walk', [
    { joint: 1, path: 'r', times: [0, 0.5, 1], values: [...axisAngle([0, 1, 0], 0), ...axisAngle([0, 1, 0], 0.6), ...axisAngle([0, 1, 0], 0)] },
    { joint: 0, path: 't', times: [0, 1], values: [0, 1, 0, 2, 1, 0] },
  ], { loop: true, duration: 1, events: [{ time: 0.25, name: 'step' }] });
  const moved = retargetClip(clip, src, dst, { fps: 30 });
  assert.equal(moved.name, 'walk-retargeted'); assert.equal(moved.duration, 1); assert.equal(moved.loop, true); assert.deepEqual(moved.events.map((e) => [e.time, e.name]), [[0.25, 'step']]);
  assert.deepEqual(moved.tracks.filter((t) => t.path === 'r').map((t) => t.joint).sort(), [0, 1, 2, 3], 'a rotation track for every joint that has a counterpart');
  assert.deepEqual(moved.tracks.filter((t) => t.path === 't').map((t) => t.joint), [0], 'a translation track for the hips');
  const dp = dst.createPose(); samplePose(dst, moved, 0.5, dp);
  near(dp.t[0], 2 * 1, 0.05, 'half way along: 1 m sideways, scaled by 2');   // t goes 0 -> 2 m over the clip, so 1 m at 0.5 s, then x2 for the taller body... checked below
  const sp = src.createPose(); samplePose(src, clip, 0.5, sp);
  const direct = dst.createPose(); retargetPose(src, sp, dst, direct);
  for (let i = 0; i < dp.r.length; i++) near(dp.r[i], direct.r[i], 1e-3, `rotation ${i}`);
  for (let i = 0; i < 3; i++) near(dp.t[i], direct.t[i], 1e-3, `hips ${i}`);
  assert.throws(() => retargetClip(clip, src, dst, { overrides: { 'mixamorig:Prop': 'Nope' } }), /no joint "Nope"/);
});
