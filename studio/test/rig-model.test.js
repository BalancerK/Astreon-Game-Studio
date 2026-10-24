import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RIG_DIR, isRigPath, findRigs, readRig, summarize, pictureNames, pictureIndex, missingPictures, placeholderColour, animationOr, sampleRig,
} from '../app/paint/rig-model.js';
import { Skeleton, AnimationState } from '../../packages/skeleton2d/src/index.js';

test('skeleton files are the JSON files in rigs/ and ones named skeleton, found in order', () => {
  assert.ok(isRigPath(`${RIG_DIR}hero.json`));
  assert.ok(isRigPath('art/hero.skeleton.json'));
  assert.ok(!isRigPath('data/levels.json'));
  assert.ok(!isRigPath('rigs/readme.txt'));
  assert.deepEqual(findRigs(['src/main.js', 'rigs/b.json', 'rigs/a.json', 'project.json', 'x/skeleton.json']), ['rigs/a.json', 'rigs/b.json', 'x/skeleton.json']);
});

test('the sample rig loads, says what is in it, and plays: the arm really moves', () => {
  const { data, problem } = readRig(JSON.stringify(sampleRig()));
  assert.equal(problem, '');
  const sum = summarize(data);
  assert.equal(sum.bones, 5);
  assert.equal(sum.slots, 3);
  assert.deepEqual(sum.skins, ['default']);
  assert.deepEqual(sum.animations.map((a) => a.name), ['idle', 'wave']);
  assert.equal(sum.animations[1].duration, 1.2);
  assert.deepEqual(sum.events, ['clap']);
  assert.deepEqual(sum.pictures.sort(), ['sample/arm', 'sample/body', 'sample/head']);
  const skeleton = new Skeleton(data), state = new AnimationState(data);
  skeleton.updateWorldTransform();
  const rest = skeleton.bones.find((b) => b.data.name === 'lower').worldY;
  state.setAnimation(0, 'wave', { loop: false });
  state.update(0.3);
  state.apply(skeleton);
  skeleton.updateWorldTransform();
  assert.notEqual(skeleton.bones.find((b) => b.data.name === 'lower').worldY, rest, 'the hand has moved');
});

test('a damaged or wrong file gives a plain problem and no skeleton', () => {
  assert.match(readRig('{nope').problem, /./);
  assert.equal(readRig('{nope').data, null);
  const bad = readRig(JSON.stringify({ bones: [{ name: 'a', parent: 'ghost' }] }));
  assert.equal(bad.data, null);
  assert.ok(bad.problem.length > 0);
});

test('pictures are found by path or by name, and the missing ones are listed', () => {
  const index = pictureIndex(['images/arm.png', 'sample/head.PNG', 'sounds/hit.wav', 'other/arm.png']);
  assert.equal(index.get('images/arm'), 'images/arm.png');
  assert.equal(index.get('arm'), 'images/arm.png', 'the first picture called arm answers to the short name');
  assert.equal(index.get('head'), 'sample/head.PNG');
  assert.ok(!index.has('hit'));
  assert.deepEqual(missingPictures(['sample/head', 'sample/body', 'arm.png'], index), ['sample/body']);
  assert.deepEqual(pictureNames(readRig(JSON.stringify(sampleRig())).data).length, 3);
});

test('a missing picture gets a colour that is the same every time and different for different names', () => {
  assert.match(placeholderColour('sample/arm'), /^#[0-9a-f]{6}$/);
  assert.equal(placeholderColour('sample/arm'), placeholderColour('sample/arm'));
  assert.notEqual(placeholderColour('sample/arm'), placeholderColour('sample/head'));
});

test('an animation name that is not there falls back to the first, and a rig with none gives null', () => {
  const sum = summarize(readRig(JSON.stringify(sampleRig())).data);
  assert.equal(animationOr(sum, 'wave'), 'wave');
  assert.equal(animationOr(sum, 'ghost'), 'idle');
  assert.equal(animationOr(summarize(readRig(JSON.stringify({ bones: [{ name: 'root' }] })).data), 'x'), null);
});
