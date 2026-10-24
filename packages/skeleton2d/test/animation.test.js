import { test } from 'node:test';
import assert from 'node:assert/strict';
import { frameIndex, curveFraction, BLEND, Animation } from '../src/index.js';
import { makeSkeleton, makeData, near } from './fixtures.js';

const n = (a, b, eps, msg) => near(assert, a, b, eps, msg);
const pose = (name, time, o = {}) => {
  const s = o.skeleton ?? makeSkeleton(), data = s.data;
  if (!o.keep) s.setToSetupPose();
  data.animation(name).apply(s, time, o.alpha ?? 1, o.blend ?? BLEND.replace, o.loop ?? false);
  return s;
};

test('finding the key before a time', () => {
  const t = [0, 0.5, 1, 2];
  assert.equal(frameIndex(t, -1), -1); assert.equal(frameIndex(t, 0), 0); assert.equal(frameIndex(t, 0.49), 0); assert.equal(frameIndex(t, 0.5), 1); assert.equal(frameIndex(t, 1.9), 2); assert.equal(frameIndex(t, 2), 3); assert.equal(frameIndex(t, 99), 3); assert.equal(frameIndex([], 1), -1);
});

test('curves: linear, stepped, and Bezier eases that start slow and end slow', () => {
  assert.equal(curveFraction(null, 0.3), 0.3); assert.equal(curveFraction('stepped', 0.99), 0);
  const ease = [0.42, 0, 0.58, 1];
  n(curveFraction(ease, 0), 0, 1e-6); n(curveFraction(ease, 1), 1, 1e-6); n(curveFraction(ease, 0.5), 0.5, 1e-3, 'symmetric');
  assert.ok(curveFraction(ease, 0.1) < 0.1 && curveFraction(ease, 0.9) > 0.9, 'slow in, slow out');
  let last = -1; for (let f = 0; f <= 1; f += 0.05) { const v = curveFraction(ease, f); assert.ok(v >= last - 1e-9, 'never goes backwards'); last = v; }
  assert.ok(curveFraction([0, 1, 1, 1], 0.5) > 0.8, 'a steep start');
});

test('bone keys are relative to the setup pose: rotate, translate, scale, shear', () => {
  const head = (s) => s.findBone('head');
  n(head(pose('idle', 0.5)).rotation, 10, 1e-6, 'halfway between 0 and 20'); n(head(pose('idle', 1)).rotation, 20, 1e-6); n(head(pose('idle', 1.5)).rotation, 10, 1e-6); n(head(pose('idle', 9)).rotation, 0, 1e-6, 'after the last key it holds');
  const s = pose('lean', 0.5); n(s.findBone('torso').rotation, -90 + 15, 1e-6, 'added to the setup rotation (-90)'); n(s.findBone('hip').x, 5, 1e-9); n(s.findBone('hip').y, -50 - 2.5, 1e-9, 'added to the setup position (0, -50)');
  const g = pose('grow', 0.5).findBone('head'); n(g.scaleX, 1.5, 1e-9); n(g.scaleY, 2, 1e-9); n(g.shearX, 5, 1e-9);
  const custom = makeSkeleton({ bones: [...makeData().bones.map((b) => ({ name: b.name, parent: b.parent?.name, x: b.x, y: b.y, rotation: b.rotation, length: b.length, scaleX: b.name === 'head' ? 2 : 1 }))] });
  n(pose('grow', 0.5, { skeleton: custom }).findBone('head').scaleX, 3, 1e-9, 'a scale of 1.5 times the head\'s setup scale of 2');
});

test('stepped keys hold, eased keys follow their curve, and a rotation can turn more than once', () => {
  const head = (name, t) => pose(name, t).findBone('head').rotation;
  assert.equal(head('step', 0.99), 0); assert.equal(head('step', 1), 40);
  n(head('ease', 0.5), 50, 0.5); assert.ok(head('ease', 0.1) < 10 && head('ease', 0.9) > 90);
  n(head('spin', 0.5), 360, 1e-4, 'a full turn at half way: keys are not wrapped'); n(head('spin', 0.25), 180, 1e-4);
});

test('alpha mixes toward the animation by the shortest turn; add layers its change on top', () => {
  const s = makeSkeleton(); s.findBone('head').rotation = 350;
  s.data.animation('idle').apply(s, 1, 0.5);                       // target 20, from 350: the short way is +30, half of it is +15
  n(s.findBone('head').rotation, 365, 1e-6, 'half way along the short way round, not through 180');
  const t = makeSkeleton(); t.findBone('head').rotation = 5;
  t.data.animation('idle').apply(t, 1, 1, BLEND.add); n(t.findBone('head').rotation, 25, 1e-6, 'add: 5 plus 20');
  const u = makeSkeleton(); u.data.animation('idle').apply(u, 1, 0.25, BLEND.add); n(u.findBone('head').rotation, 5, 1e-6);
  const v = makeSkeleton(); v.findBone('hip').y = 0; v.data.animation('lean').apply(v, 1, 0.5); n(v.findBone('hip').y, -50 * 0.5 + -5 * 0.5 + 0, 1e-6, 'translate mixes toward setup + key');
});

test('slot attachments switch at their keys, colours blend, and the rest pose is the start', () => {
  const s = pose('swap', 0.25); const arm = s.findSlot('arm');
  assert.equal(arm.attachment, 'arm'); n(arm.color[1], 0.75, 1e-4, 'a quarter of the way to red'); n(arm.color[3], 1 - 0.25 * (1 - 128 / 255), 1e-4);
  assert.equal(pose('swap', 0.5).findSlot('arm').attachment, 'arm-alt'); assert.equal(pose('swap', 1).findSlot('arm').attachment, null);
  const low = pose('swap', 0.5, { alpha: 0.3 }).findSlot('arm'); assert.equal(low.attachment, 'arm', 'a switch needs at least half the weight');
  assert.equal(pose('swap', 0.5, { alpha: 0.5 }).findSlot('arm').attachment, 'arm-alt');
});

test('mesh deformation is added to the setup points, only while that mesh is shown', () => {
  const s = pose('flap', 0.5); const cape = s.findSlot('cape');
  assert.deepEqual(Array.from(cape.deform), [0, 0, 0, 0, 5, 10, 5, 10]);
  const half = pose('flap', 1, { alpha: 0.5 }).findSlot('cape'); assert.deepEqual(Array.from(half.deform), [0, 0, 0, 0, 5, 10, 5, 10], 'alpha 0.5 of the full offset');
  const hidden = makeSkeleton(); hidden.setAttachment('cape', null); hidden.data.animation('flap').apply(hidden, 1); assert.equal(hidden.findSlot('cape').deform, null, 'nothing to deform when the mesh is not shown');
  const added = makeSkeleton(); added.data.animation('flap').apply(added, 1, 1); added.data.animation('flap').apply(added, 1, 1, BLEND.add); assert.equal(added.findSlot('cape').deform[4], 20);
});

test('draw order: keys name how slots move, and a key without offsets restores the order', () => {
  const names = (s) => s.drawOrder.map((x) => x.data.name);
  assert.deepEqual(names(pose('reorder', 0.2)), ['torso', 'arm', 'cape', 'glow', 'hit'], 'before the first key: untouched');
  assert.deepEqual(names(pose('reorder', 0.5)), ['arm', 'cape', 'torso', 'glow', 'hit'], 'torso moved two places up the list');
  assert.deepEqual(names(pose('reorder', 1)), ['torso', 'arm', 'cape', 'glow', 'hit']);
});

test('IK keys set the mix and the bend', () => {
  const s = pose('reach', 0.5); n(s.findIk('arm-ik').mix, 0.5, 1e-6); assert.equal(s.findIk('arm-ik').bend, 1);
  const e = pose('reach', 1); n(e.findIk('arm-ik').mix, 1, 1e-6); assert.equal(e.findIk('arm-ik').bend, -1);
});

test('events: those inside a span of time, in order, with their data, across loops', () => {
  const a = makeData().animation('walk'), names = (ev) => ev.map((e) => `${e.name}@${e.time}`);
  assert.deepEqual(names(a.collectEvents(-1, 0.3, false)), ['footstep@0.25']); assert.deepEqual(names(a.collectEvents(0.25, 0.8, false)), ['footstep@0.75'], 'the start of the span is excluded');
  const ev = a.collectEvents(-1, 5, false); assert.deepEqual(names(ev), ['footstep@0.25', 'footstep@0.75', 'swing@1']); assert.deepEqual([ev[0].int, ev[0].float, ev[0].string, ev[1].int], [1, 0.5, 'left', 2], 'defaults from the declaration, overridden by the key');
  assert.deepEqual(names(a.collectEvents(0.9, 1.3, true)), ['swing@1', 'footstep@0.25'], 'across the end of a loop');
  assert.deepEqual(names(a.collectEvents(0.9, 2.3, true)), ['swing@1', 'footstep@0.25', 'footstep@0.75', 'swing@1', 'footstep@0.25']);
  assert.equal(a.collectEvents(0.3, 0.4, true).length, 0); assert.deepEqual(names(a.collectEvents(-1, 0.3, true)), ['footstep@0.25']);
});

test('an animation knows its length and what it animates', () => {
  const data = makeData();
  assert.equal(data.animation('walk').duration, 1); assert.equal(data.animation('idle').duration, 2); assert.equal(data.animation('reorder').duration, 1);
  assert.ok(data.animation('idle').keys.has('rotate:6')); assert.ok(!data.animation('walk').keys.has('events'), 'events are not part of the pose');
  assert.throws(() => data.animation('dance'), /no animation "dance" \(has: idle/);
  assert.equal(new Animation('x', [], 3).duration, 3); assert.equal(new Animation('y', []).duration, 0);
  const looped = makeSkeleton(); data.animation('idle').apply(looped, 2.5, 1, BLEND.replace, true); n(looped.findBone('head').rotation, 10, 1e-6, 'looping wraps the time (2.5 is 0.5 into the second pass)');
});
