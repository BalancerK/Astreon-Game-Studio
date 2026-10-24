import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AnimationState } from '../src/index.js';
import { makeSkeleton, makeData, near } from './fixtures.js';

const n = (a, b, eps, msg) => near(assert, a, b, eps, msg);
const setup = (o) => { const data = makeData(), skeleton = makeSkeleton(), state = new AnimationState(data, o); return { data, skeleton, state }; };
const rot = (skeleton, bone = 'head') => skeleton.findBone(bone).rotation;
const step = (state, skeleton, dt) => { state.update(dt); state.apply(skeleton); };

test('a looping animation plays over and over; a one-shot holds its last frame', () => {
  const { skeleton, state } = setup();
  state.setAnimation(0, 'idle', { loop: true });
  step(state, skeleton, 1); n(rot(skeleton), 20, 1e-6); step(state, skeleton, 1.5); n(rot(skeleton), 10, 1e-6, '2.5 seconds in is 0.5 into the second pass');
  const one = setup(); one.state.setAnimation(0, 'idle'); step(one.state, one.skeleton, 5); n(rot(one.skeleton), 0, 1e-9, 'the last key of idle is 0 and it stays there');
  const lean = setup(); lean.state.setAnimation(0, 'lean'); step(lean.state, lean.skeleton, 9); n(rot(lean.skeleton, 'torso'), -60, 1e-6, 'lean ends at 30 degrees from -90 and holds');
});

test('time scales: the state, and each animation', () => {
  const { skeleton, state } = setup();
  const e = state.setAnimation(0, 'idle', { loop: true }); e.timeScale = 2; step(state, skeleton, 0.25); n(rot(skeleton), 10, 1e-6);
  state.timeScale = 0; step(state, skeleton, 5); n(rot(skeleton), 10, 1e-6, 'a stopped state does not move');
});

test('applying poses from the rest each time, so nothing sticks from before', () => {
  const { skeleton, state } = setup();
  skeleton.findBone('torso').rotation = 123; skeleton.findBone('head').rotation = 55;
  state.setAnimation(0, 'idle'); step(state, skeleton, 0.5);
  n(rot(skeleton, 'torso'), -90, 1e-9, 'untouched bones are back at the rest pose'); n(rot(skeleton), 10, 1e-9);
});

test('a new animation crossfades from the old one: shared things blend, the old one\'s own things ease out, the new one\'s ease in', () => {
  const { skeleton, state } = setup({ defaultMix: 1 });
  state.setAnimation(0, 'idle', { loop: true }); step(state, skeleton, 1);               // head 20
  state.setAnimation(0, 'lean');                                                         // lean moves the torso and hip, not the head
  step(state, skeleton, 0);
  n(rot(skeleton), 20, 1e-6, 'at the start of the mix nothing has changed'); n(rot(skeleton, 'torso'), -90, 1e-6);
  step(state, skeleton, 0.5);                                                            // half way: idle at 1.5s = 10; lean at 0.5s: torso -75
  n(rot(skeleton), 10 * 0.5, 1e-6, 'the head, only in the old animation, is half way back to the rest pose'); n(rot(skeleton, 'torso'), -90 + 15 * 0.5, 1e-6, 'the torso eases in');
  step(state, skeleton, 0.5); n(rot(skeleton), 0, 1e-6, 'the mix is over: only lean is left'); n(rot(skeleton, 'torso'), -90 + 30, 1e-6);
  assert.equal(state.getCurrent(0).from, null);
  const shared = setup({ defaultMix: 1 }); shared.state.setAnimation(0, 'idle', { loop: true }); step(shared.state, shared.skeleton, 1);
  shared.state.setAnimation(0, 'ease'); step(shared.state, shared.skeleton, 0.5);        // idle at 1.5 = 10, ease at 0.5 = 50: blended half way
  n(rot(shared.skeleton), (10 + 50) / 2, 0.3, 'something both animate is a straight blend');
});

test('mix times: per pair, per call, or none', () => {
  const { skeleton, state } = setup();
  state.setMix('idle', 'spin', 0.5); state.setAnimation(0, 'idle', { loop: true }); step(state, skeleton, 1);
  const e = state.setAnimation(0, 'spin'); assert.equal(e.mixDuration, 0.5); assert.equal(state.getMix('spin', 'idle'), 0);
  const quick = state.setAnimation(0, 'idle', { mix: 0 }); assert.equal(quick.from, null, 'no mix, no crossfade'); const slow = state.setAnimation(0, 'wave', { mix: 2 }); assert.equal(slow.mixDuration, 2);
});

test('queued animations start when the one before ends, overlapping by the mix', () => {
  const { skeleton, state } = setup({ defaultMix: 0.25 });
  const events = []; state.on('start', (e) => events.push(`start ${e.animation.name}`)); state.on('end', (e) => events.push(`end ${e.animation.name}`)); state.on('complete', (e) => events.push(`complete ${e.animation.name}`)); state.on('interrupt', (e) => events.push(`interrupt ${e.animation.name}`));
  state.setAnimation(0, 'wave'); const next = state.addAnimation(0, 'lean', { delay: 0.5 });
  step(state, skeleton, 0.5); assert.equal(state.getCurrent(0).animation.name, 'wave');
  step(state, skeleton, 0.5);                                                            // wave is 1s: lean starts at 1 - 0.25 + 0.5 = 1.25
  assert.equal(state.getCurrent(0).animation.name, 'wave', 'not yet'); assert.deepEqual(events, ['start wave', 'complete wave']);
  step(state, skeleton, 0.3); assert.equal(state.getCurrent(0), next); assert.ok(next.from, 'mixing from wave'); assert.ok(events.includes('start lean') && events.includes('interrupt wave'));
  step(state, skeleton, 0.5); assert.equal(next.from, null); assert.ok(events.includes('end wave'));
  const empty = setup(); const added = empty.state.addAnimation(0, 'idle'); assert.equal(empty.state.getCurrent(0), added, 'queueing on an empty track starts at once');
});

test('a queue behind a loop waits for the loop to finish its pass', () => {
  const { skeleton, state } = setup();
  state.setAnimation(0, 'wave', { loop: true }); const next = state.addAnimation(0, 'lean');
  step(state, skeleton, 0.4); assert.notEqual(state.getCurrent(0), next); step(state, skeleton, 0.4); assert.notEqual(state.getCurrent(0), next); step(state, skeleton, 0.3);
  assert.equal(state.getCurrent(0), next, 'after the first pass of one second');
  n(next.time, 0.1, 1e-6, 'with the time it overshot');
});

test('events fire as time passes, to listeners and in the return value', () => {
  const { skeleton, state } = setup();
  const seen = []; const off = state.on('event', (entry, e) => seen.push(`${e.name}:${e.int}:${entry.animation.name}`));
  state.setAnimation(0, 'walk', { loop: true });
  assert.deepEqual(state.update(0.3).map((e) => e.name), ['footstep'], 'the first update includes the events up to now'); state.apply(skeleton);
  assert.deepEqual(state.update(0.5).map((e) => e.int), [2]); assert.deepEqual(state.update(0.3).map((e) => e.name), ['swing'], 'across the end of the loop');
  assert.deepEqual(state.update(0.2).map((e) => e.name), ['footstep'], 'and on into the next pass');
  assert.deepEqual(seen, ['footstep:1:walk', 'footstep:2:walk', 'swing:0:walk', 'footstep:1:walk']);
  off(); state.update(1); assert.equal(seen.length, 4, 'unsubscribed');
  const early = setup(); early.state.setAnimation(0, 'walk'); assert.equal(early.state.update(0).length, 0); assert.throws(() => early.state.on('nothing', () => {}), /unknown listener/);
});

test('complete fires for each pass of a loop and once for a one-shot', () => {
  const { state } = setup();
  let loops = 0, ones = 0; state.on('complete', (e) => { if (e.loop) loops++; else ones++; });
  state.setAnimation(0, 'wave', { loop: true }); for (let i = 0; i < 25; i++) state.update(0.1); assert.equal(loops, 2);
  state.setAnimation(0, 'wave'); for (let i = 0; i < 25; i++) state.update(0.1); assert.equal(ones, 1);
});

test('tracks layer: a higher track is applied over a lower one, with its own alpha and blend', () => {
  const { skeleton, state } = setup();
  state.setAnimation(0, 'idle', { loop: true }); const wave = state.setAnimation(1, 'lean', { alpha: 0.5 });
  step(state, skeleton, 1);
  n(rot(skeleton, 'torso'), -90 + 15, 1e-6, 'track 1 at half strength'); n(rot(skeleton), 20, 1e-6, 'track 0 untouched');
  wave.alpha = 1; step(state, skeleton, 0); n(rot(skeleton, 'torso'), -60, 1e-6);
  const add = setup(); add.state.setAnimation(0, 'idle', { loop: true }); add.state.setAnimation(1, 'idle', { blend: 'add', alpha: 0.5 }); step(add.state, add.skeleton, 1); n(rot(add.skeleton), 20 + 10, 1e-6, 'an additive layer adds its change on top');
});

test('emptying and clearing tracks', () => {
  const { skeleton, state } = setup();
  const ended = []; state.on('end', (e) => ended.push(e.animation.name));
  state.setAnimation(0, 'idle', { loop: true }); step(state, skeleton, 1);
  state.setEmptyAnimation(0, 1); step(state, skeleton, 0.5); n(rot(skeleton), 10 * 0.5, 1e-6, 'fading out to the rest pose'); step(state, skeleton, 0.6);
  assert.equal(state.getCurrent(0), null, 'cleared when the fade is done'); n(rot(skeleton), 0, 1e-9);
  assert.ok(ended.includes('idle') && ended.includes('<empty>'));
  state.setAnimation(1, 'wave'); state.clearTrack(1); assert.equal(state.getCurrent(1), null); state.setAnimation(0, 'idle'); state.clearTracks(); assert.equal(state.tracks.length, 0);
  const end = setup(); end.state.setAnimation(0, 'idle', { loop: true, trackEnd: 0.5 }); end.state.update(0.4); assert.ok(end.state.getCurrent(0)); end.state.update(0.2); assert.equal(end.state.getCurrent(0), null, 'trackEnd clears it');
});

test('replacing an animation mid-mix does not jump to the old one', () => {
  const { skeleton, state } = setup({ defaultMix: 1 });
  state.setAnimation(0, 'idle', { loop: true }); step(state, skeleton, 1); state.setAnimation(0, 'lean'); step(state, skeleton, 0.5);
  state.setAnimation(0, 'wave'); step(state, skeleton, 0);
  assert.ok(state.getCurrent(0).from.animation.name === 'lean', 'the mix is from the animation just before'); assert.ok(Number.isFinite(rot(skeleton)));
});

test('finished: a one-shot knows when it is over', () => {
  const { state } = setup();
  const e = state.setAnimation(0, 'wave'); assert.equal(e.finished, false); state.update(1); assert.equal(e.finished, true);
  const l = state.setAnimation(0, 'wave', { loop: true }); state.update(5); assert.equal(l.finished, false);
});
