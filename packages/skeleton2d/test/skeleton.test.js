import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Skeleton, INHERIT, angleDelta, parseSkeleton } from '../src/index.js';
import { RIG, makeSkeleton, makeData, near } from './fixtures.js';

const n = (a, b, eps, msg) => near(assert, a, b, eps, msg);
const simple = (bones, o = {}) => { const s = new Skeleton(parseSkeleton({ bones, slots: [], ...o })); s.updateWorldTransform(); return s; };

test('angles: the shortest way round', () => {
  assert.equal(angleDelta(10, 30), 20); assert.equal(angleDelta(350, 10), 20); assert.equal(angleDelta(10, 350), -20); assert.equal(angleDelta(0, 180), 180); n(angleDelta(0, 540), 180, 1e-9);
});

test('a bone placed under its parent: position, then turning clockwise on the screen (y down)', () => {
  const s = simple([{ name: 'root', x: 100, y: 50 }, { name: 'a', parent: 'root', x: 10, y: 0 }, { name: 'b', parent: 'a', x: 10, y: 0 }]);
  assert.deepEqual([s.bones[2].worldX, s.bones[2].worldY], [120, 50], 'ten right of ten right of the root');
  s.bones[1].rotation = 90; s.updateWorldTransform();
  n(s.bones[2].worldX, 110, 1e-9); n(s.bones[2].worldY, 60, 1e-9, 'turned 90 degrees, the child hangs below: clockwise on a y-down screen'); n(s.bones[2].worldRotation, 90, 1e-9);
  s.bones[1].rotation = 180; s.updateWorldTransform(); n(s.bones[2].worldX, 100, 1e-9); n(s.bones[2].worldY, 50, 1e-9);
});

test('scale and shear: sizes multiply down the chain, and a shear leans the y axis', () => {
  const s = simple([{ name: 'root', scaleX: 2, scaleY: 3 }, { name: 'a', parent: 'root', x: 10, y: 10, scaleX: 0.5 }]);
  n(s.bones[1].worldX, 20, 1e-9); n(s.bones[1].worldY, 30, 1e-9); n(s.bones[1].a, 1, 1e-9); n(s.bones[1].d, 3, 1e-9);
  const sh = simple([{ name: 'root', shearY: 30 }]);
  n(sh.bones[0].b, Math.cos((90 + 30) * Math.PI / 180), 1e-9, 'the y axis leans'); n(sh.bones[0].a, 1, 1e-9);
});

test('the skeleton places and scales its root; a negative scale mirrors everything', () => {
  const s = simple([{ name: 'root' }, { name: 'a', parent: 'root', x: 10, y: 5, rotation: 30, length: 20 }]);
  s.x = 100; s.y = 200; s.scaleX = -1; s.updateWorldTransform();
  n(s.bones[1].worldX, 100 - 10, 1e-9); n(s.bones[1].worldY, 205, 1e-9);
  const tip = s.bones[1].tip(); n(tip.x, 90 - 20 * Math.cos(30 * Math.PI / 180), 1e-9); n(tip.y, 205 + 20 * Math.sin(30 * Math.PI / 180), 1e-9);
  s.scaleX = 2; s.scaleY = 2; s.x = 0; s.y = 0; s.updateWorldTransform(); n(s.bones[1].worldX, 20, 1e-9);
});

test('inherit modes: some of the parent can be left out', () => {
  const rig = (inherit) => simple([{ name: 'root' }, { name: 'p', parent: 'root', x: 100, y: 0, rotation: 90, scaleX: 2, scaleY: 2 }, { name: 'c', parent: 'p', x: 10, y: 0, inherit }]);
  const normal = rig('normal').bones[2], only = rig('onlyTranslation').bones[2], noScale = rig('noScale').bones[2], noRot = rig('noRotationOrReflection').bones[2], noScaleRefl = rig('noScaleOrReflection').bones[2];
  for (const b of [normal, only, noScale, noRot, noScaleRefl]) { n(b.worldX, 100, 1e-6); n(b.worldY, 20, 1e-6, 'every mode keeps the position: ten along the parent\'s x axis, which points down and is twice as long'); }
  n(normal.worldRotation, 90, 1e-6); n(Math.hypot(normal.a, normal.c), 2, 1e-6);
  n(only.worldRotation, 0, 1e-6, 'onlyTranslation: the parent\'s turning is left out'); n(Math.hypot(only.a, only.c), 1, 1e-6, 'and its size');
  n(noScale.worldRotation, 90, 1e-6, 'noScale follows the turning'); n(Math.hypot(noScale.a, noScale.c), 1, 1e-6, 'but not the size');
  n(noRot.worldRotation, 0, 1e-6, 'noRotationOrReflection ignores the turning'); n(Math.hypot(noRot.a, noRot.c), 2, 1e-6, 'and keeps the size'); n(noScaleRefl.worldRotation, 90, 1e-6); n(Math.hypot(noScaleRefl.a, noScaleRefl.c), 1, 1e-6);
  const bad = () => parseSkeleton({ bones: [{ name: 'r' }, { name: 'a', parent: 'r', inherit: 'sideways' }] });
  assert.throws(bad, /inherit/);
  assert.equal(INHERIT.normal, 0);
});

test('world and local points convert both ways, and a bone can be asked how to point', () => {
  const s = simple([{ name: 'root', x: 10, y: 20, rotation: 30 }, { name: 'a', parent: 'root', x: 5, y: 5, rotation: 20, scaleX: 2 }]);
  const b = s.bones[1], w = b.localToWorld(7, -3), back = b.worldToLocal(w.x, w.y);
  n(back.x, 7, 1e-9); n(back.y, -3, 1e-9);
  b.rotation = b.localRotationFor(75); s.updateWorldTransform(); n(b.worldRotation, 75, 1e-6, 'localRotationFor makes the bone point there');
  s.scaleX = -1; s.updateWorldTransform(); b.rotation = b.localRotationFor(15); s.updateWorldTransform(); n(b.worldRotation, 15, 1e-6, 'even in a mirrored skeleton');
});

test('the rig loads and stands as designed', () => {
  const s = makeSkeleton(); s.updateWorldTransform();
  assert.equal(s.bones.length, 7); assert.equal(s.slots.length, 5); assert.deepEqual(s.drawOrder.map((x) => x.data.name), ['torso', 'arm', 'cape', 'glow', 'hit']);
  const upper = s.findBone('upper'), lower = s.findBone('lower');
  n(upper.worldX, 0, 1e-6); n(upper.worldY, -90, 1e-6); n(upper.worldRotation, 0, 1e-6); n(lower.worldX, 30, 1e-6); n(lower.worldY, -90, 1e-6);
  const hw = s.boneWorld('head'); n(hw.x, 0, 1e-9); n(hw.y, -90, 1e-9); n(hw.rotation, -90, 1e-9); assert.throws(() => s.boneWorld('tail'), /no bone/);
  assert.equal(s.findSlot('cape').data.bone.name, 'torso'); assert.equal(s.findIk('arm-ik').mix, 0);
});

test('going back to the setup pose undoes everything an animation did', () => {
  const s = makeSkeleton(); const head = s.findBone('head'), cape = s.findSlot('cape');
  head.rotation = 99; head.scaleX = 4; cape.color[3] = 0; cape.attachment = null; cape.deform = new Float32Array(8); s.drawOrder.reverse(); s.findIk('arm-ik').mix = 1;
  s.setToSetupPose();
  assert.equal(head.rotation, 0); assert.equal(head.scaleX, 1); assert.equal(cape.color[3], 1); assert.equal(cape.attachment, 'cape'); assert.equal(cape.deform, null);
  assert.deepEqual(s.drawOrder.map((x) => x.data.name), ['torso', 'arm', 'cape', 'glow', 'hit']); assert.equal(s.findIk('arm-ik').mix, 0);
});

test('skins: another outfit for the same slots, falling back to the default', () => {
  const s = makeSkeleton();
  const torso = s.findSlot('torso'); assert.equal(s.attachmentOf(torso).path, 'rig/torso');
  s.setSkin('alt'); assert.equal(s.attachmentOf(torso).path, 'rig/torso-alt'); assert.equal(s.attachmentOf(s.findSlot('arm')).path, 'rig/arm', 'what the new skin lacks comes from the default skin');
  s.setSkin(null); assert.equal(s.attachmentOf(torso).path, 'rig/torso'); assert.throws(() => s.setSkin('missing'), /no skin/);
  s.setAttachment('arm', 'arm-alt'); assert.equal(s.attachmentOf(s.findSlot('arm')).height, 20); s.setAttachment('arm', null); assert.equal(s.attachmentOf(s.findSlot('arm')), null);
  assert.throws(() => s.setAttachment('arm', 'nope'), /no attachment/); assert.throws(() => s.setAttachment('nope', 'arm'), /no slot/);
});

// ---------------------------------------------------------------- inverse kinematics

const arm = (tx, ty, { bend = 1, mix = 1 } = {}) => {
  const s = makeSkeleton(); const c = s.findIk('arm-ik'); c.mix = mix; c.bend = bend;
  const t = s.findBone('hand-target'); t.x = tx; t.y = ty;
  s.updateWorldTransform();
  return s;
};
const hand = (s) => s.findBone('lower').tip();

test('IK, two bones: the end of the arm reaches a target within reach', () => {
  for (const [tx, ty] of [[40, -60], [30, -120], [-20, -70], [50, -100]]) {
    const s = arm(tx, ty), h = hand(s);
    n(h.x, tx, 1e-3, `x for ${tx},${ty}`); n(h.y, ty, 1e-3, `y for ${tx},${ty}`);
    n(Math.hypot(s.findBone('lower').worldX - s.findBone('upper').worldX, s.findBone('lower').worldY - s.findBone('upper').worldY), 30, 1e-6, 'the upper arm keeps its length');
  }
});

test('IK, two bones: out of reach the arm stretches straight toward the target; the bend direction picks the elbow', () => {
  const far = arm(200, -90), h = hand(far); n(h.y, -90, 0.05); n(h.x, 60, 0.1, 'as far as it goes'); n(far.findBone('upper').worldRotation, 0, 0.1); n(far.findBone('lower').worldRotation, 0, 0.1);
  const up = arm(30, -90 + 40, { bend: 1 }), down = arm(30, -90 + 40, { bend: -1 });
  const elbow = (s) => s.findBone('lower').worldY;
  assert.ok(Math.abs(elbow(up) - elbow(down)) > 5, 'two different elbows'); assert.notEqual(Math.sign(elbow(up) - (-90 + 20)), Math.sign(elbow(down) - (-90 + 20)), 'on opposite sides of the line to the target');
  for (const s of [up, down]) { n(hand(s).x, 30, 1e-3); n(hand(s).y, -50, 1e-3); }
});

test('IK mixes in by amount, and does nothing at zero', () => {
  const none = arm(40, -60, { mix: 0 }); n(none.findBone('upper').worldRotation, 0, 1e-9); n(hand(none).x, 60, 1e-6);
  const half = arm(40, -60, { mix: 0.5 }), full = arm(40, -60, { mix: 1 });
  const r = (s) => s.findBone('upper').rotation;
  assert.ok(Math.abs(r(half)) > 1e-3 && Math.abs(r(half)) < Math.abs(r(full)), `half way: ${r(half)} between 0 and ${r(full)}`);
});

test('IK, two bones: it follows the target when the skeleton is moved or mirrored', () => {
  const s = makeSkeleton(); s.findIk('arm-ik').mix = 1; s.x = 300; s.y = 100; s.scaleX = -1;
  const t = s.findBone('hand-target'); t.x = 40; t.y = -60; s.updateWorldTransform();
  const h = hand(s), target = { x: t.worldX, y: t.worldY };
  n(h.x, target.x, 1e-3); n(h.y, target.y, 1e-3);
  const moved = makeSkeleton(); moved.findIk('arm-ik').mix = 1; moved.findBone('torso').rotation += 25; moved.findBone('hand-target').x = 30; moved.findBone('hand-target').y = -70; moved.updateWorldTransform();
  n(hand(moved).x, 30, 1e-3); n(hand(moved).y, -70, 1e-3, 'also when the bones above it have turned');
});

test('IK, one bone: it simply turns to point at the target', () => {
  const make = (mix) => { const s = new Skeleton(makeData({ animations: {}, ik: [{ name: 'look', bones: ['head'], target: 'hand-target', mix }] })); const t = s.findBone('hand-target'); t.x = 100; t.y = -90; s.updateWorldTransform(); return s; };
  n(make(1).findBone('head').worldRotation, 0, 1e-6, 'the target is to the right of the head'); n(make(0.5).findBone('head').worldRotation, -45, 1e-6, 'half way from straight up'); n(make(0).findBone('head').worldRotation, -90, 1e-6);
});

test('IK constraints are checked when loading', () => {
  assert.throws(() => makeData({ animations: {}, ik: [{ name: 'x', bones: ['upper', 'head'], target: 'hand-target' }] }), /child of the first/);
  assert.throws(() => makeData({ animations: {}, ik: [{ name: 'x', bones: ['upper'], target: 'nope' }] }), /no target/);
  assert.throws(() => makeData({ animations: {}, ik: [{ name: 'x', bones: [], target: 'hand-target' }] }), /one or two bones/);
  void RIG;
});
