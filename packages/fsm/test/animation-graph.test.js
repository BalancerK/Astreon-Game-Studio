import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AnimationGraph } from '../src/index.js';
import { samplePose, blendPoses } from '../../render/src/index.js';
import { createCharacter } from '../../../examples/arena3d/client/character.js';

const near = (a, b, eps = 1e-9, msg = '') => assert.ok(Math.abs(a - b) <= eps, `${msg} ${a} is not within ${eps} of ${b}`);

// a "skeleton" whose pose is one number, so every blend can be checked exactly
const skeleton = { createPose: () => ({ v: new Float64Array(1), copy(o) { this.v.set(o.v); return this; } }) };
const io = { skeleton, sample: (sk, clip, time, out) => { out.v[0] = clip.at(time); }, blend: (out, a, b, w) => { out.v[0] = a.v[0] * (1 - w) + b.v[0] * w; } };
const clip = (name, duration, at, loop = true) => ({ name, duration, loop, at });
const idle = clip('idle', 2, () => 0), walk = clip('walk', 1, () => 10), run = clip('run', 0.5, () => 20);
const jumpClip = clip('jump', 1, (t) => 100 + t * 10, false), air = clip('air', 1, () => 50);
const ramp = clip('ramp', 4, (t) => t);

const make = (extra = {}) => new AnimationGraph({
  parameters: { speed: 0, grounded: true, jump: 'trigger', dead: false },
  initial: 'loco',
  states: {
    loco: { blend1d: { param: 'speed', clips: [{ clip: idle, at: 0 }, { clip: walk, at: 2 }, { clip: run, at: 6 }] } },
    jump: { clip: jumpClip }, air: { clip: air }, dead: { clip: clip('dead', 1, () => -1, false) },
  },
  transitions: [
    { from: 'loco', to: 'jump', when: { trigger: 'jump' }, duration: 0.2 },
    { from: 'jump', to: 'air', exitTime: 0.9, duration: 0.1 },
    { from: 'air', to: 'loco', when: { param: 'grounded', equals: true }, duration: 0.25 },
    { from: '*', to: 'dead', when: { param: 'dead', equals: true }, duration: 0, interrupt: true },
  ],
  ...extra,
}, io);

test('a state with one clip plays it, looping or holding the last frame', () => {
  const g = new AnimationGraph({ initial: 'a', states: { a: { clip: ramp }, b: { clip: clip('once', 4, (t) => t, false) } } }, io);
  g.update(1); near(g.pose.v[0], 1);
  g.update(3.5); near(g.pose.v[0], 0.5, 1e-9, 'a looping clip wraps');
  g.force('b'); g.update(5); near(g.pose.v[0], 4, 1e-9, 'a one-shot clip holds its end');
  assert.equal(g.progress, 1);
});

test('a 1D blend crossfades between the clips either side of the parameter and keeps their cycles in step', () => {
  const g = make();
  g.set('speed', 0); near(g.update(0.1).v[0], 0);
  g.set('speed', 1); near(g.update(0.1).v[0], 5, 1e-9, 'half way between idle (0) and walk (10)');
  g.set('speed', 2); near(g.update(0.1).v[0], 10);
  g.set('speed', 4); near(g.update(0.1).v[0], 15, 1e-9, 'half way between walk and run');
  g.set('speed', 99); near(g.update(0.1).v[0], 20, 1e-9, 'beyond the last clip: that clip');
  // the blended cycle length: halfway between walk (1 s) and run (0.5 s) is 0.75 s per cycle
  const r = new AnimationGraph({ initial: 'l', parameters: { s: 4 }, states: { l: { blend1d: { param: 's', clips: [{ clip: clip('w', 1, (t) => t, true), at: 2 }, { clip: clip('r', 0.5, (t) => t * 2, true), at: 6 }] } } } }, io);
  r.update(0.375); // half a cycle of 0.75 s: phase 0.5 -> walk at 0.5 s (value 0.5), run at 0.25 s (value 0.5)
  near(r.pose.v[0], 0.5, 1e-9, 'both clips are at the same phase');
});

test('transitions on triggers cross-fade over their duration, and the trigger is used up', () => {
  const g = make();
  g.set('speed', 0); g.update(0.05);
  g.trigger('jump');
  assert.equal(g.get('jump'), true);
  g.update(0.1);
  assert.equal(g.state, 'jump'); assert.equal(g.get('jump'), false, 'consumed');
  near(g.pose.v[0], 0, 1e-9, 'the fade starts from the old pose');
  g.update(0.1);
  // 0.1 s into a 0.2 s fade: halfway (smoothstep 0.5 = 0.5) between idle (0) and the jump clip's value at 0.1 s (101)
  near(g.pose.v[0], 0 * 0.5 + 101 * 0.5, 1e-6);
  g.update(0.2); // the fade is over
  near(g.pose.v[0], 100 + 0.3 * 10, 1e-6);
  assert.equal(g.fade, null);
});

test('exitTime waits for the clip to be nearly done; conditions on parameters bring the state back', () => {
  const g = make();
  g.trigger('jump'); g.update(0.01); g.update(1);
  assert.equal(g.state, 'air', 'after 90% of the one-second jump clip');
  assert.equal(g.state === 'air' && g.fade !== null, true);
  g.set('grounded', false); g.update(0.5); assert.equal(g.state, 'air');
  g.set('grounded', true); g.update(0.01); assert.equal(g.state, 'loco');
  g.update(0.3); near(g.pose.v[0], 0, 1e-9, 'the landing fade is over: idle again');
});

test('numeric conditions and all-of lists', () => {
  const g = new AnimationGraph({
    parameters: { speed: 0, armed: false }, initial: 'idle',
    states: { idle: { clip: idle }, walk: { clip: walk }, aim: { clip: air } },
    transitions: [
      { from: 'idle', to: 'walk', when: [{ param: 'speed', op: '>', value: 0.5 }, { param: 'armed', equals: false }], duration: 0 },
      { from: 'walk', to: 'idle', when: { param: 'speed', op: '<=', value: 0.5 }, duration: 0 },
      { from: 'idle', to: 'aim', when: { param: 'armed', equals: true }, duration: 0 },
    ],
  }, io);
  g.set('speed', 1); g.update(0.1); assert.equal(g.state, 'walk');
  g.set('speed', 0); g.update(0.1); assert.equal(g.state, 'idle');
  g.set('speed', 1); g.set('armed', true); g.update(0.1); assert.equal(g.state, 'aim', 'armed blocks walking and chooses aiming');
});

test('an interrupting transition (to the dead state) cuts in during a cross-fade and starts from what was on screen', () => {
  const g = make();
  g.trigger('jump'); g.update(0.01); g.update(0.1);
  assert.ok(g.fade, 'mid fade into the jump');
  const before = g.pose.v[0];
  g.set('dead', true); g.update(0.01);
  assert.equal(g.state, 'dead'); assert.equal(g.fade, null, 'duration 0: straight there');
  near(g.pose.v[0], -1);
  assert.ok(before > 0);
  // a non-interrupting transition does not start in the middle of a fade
  const h = make();
  h.trigger('jump'); h.update(0.01); h.update(0.01);
  h.set('speed', 3);
  assert.equal(h.state, 'jump');
});

test('interrupting freezes the blend so far as the new starting pose', () => {
  const g = new AnimationGraph({
    initial: 'a', parameters: { toC: false },
    states: { a: { clip: clip('a', 1, () => 0) }, b: { clip: clip('b', 1, () => 10) }, c: { clip: clip('c', 1, () => 100) } },
    transitions: [{ from: 'a', to: 'b', when: { param: 'toC', equals: false }, duration: 1 }, { from: 'b', to: 'c', when: { param: 'toC', equals: true }, duration: 1, interrupt: true }],
  }, io);
  g.update(1e-9); // the a -> b fade begins
  g.update(0.5);  // and is now half way: smoothstep(0.5) = 0.5 -> 5
  near(g.pose.v[0], 5, 1e-6);
  g.set('toC', true);
  g.update(0.01);
  assert.equal(g.state, 'c');
  near(g.pose.v[0], 5, 0.5, 'it starts from the frozen 5, not from b (10) or a (0)');
  g.update(1);
  near(g.pose.v[0], 100, 1e-6);
});

test('state speed, enter callbacks, forcing, and saving', () => {
  const entered = [];
  const g = new AnimationGraph({ parameters: { rate: 2 }, initial: 'a', states: { a: { clip: ramp, speed: 'rate', enter: () => entered.push('a') }, b: { clip: ramp, speed: 0.5, enter: () => entered.push('b') } } }, io);
  g.update(0.5); near(g.pose.v[0], 1, 1e-9, 'a parameter can be the speed');
  g.force('b'); g.update(1); near(g.pose.v[0], 0.5);
  assert.deepEqual(entered, ['a', 'b']);
  const saved = JSON.parse(JSON.stringify(g.save()));
  const h = new AnimationGraph({ parameters: { rate: 2 }, initial: 'a', states: { a: { clip: ramp }, b: { clip: ramp, speed: 0.5 } } }, io).load(saved);
  assert.equal(h.state, 'b'); near(h.time, g.time);
});

test('configuration errors say what is wrong', () => {
  assert.throws(() => new AnimationGraph({ initial: 'x', states: { a: {} } }, io), /initial state "x"/);
  assert.throws(() => new AnimationGraph({ initial: 'a', states: { a: {} }, transitions: [{ from: 'a', to: 'zzz' }] }, io), /transition to unknown state "zzz"/);
  const g = make();
  assert.throws(() => g.set('nope', 1), /no parameter "nope" \(it has speed, grounded, jump, dead\)/);
  assert.throws(() => g.force('nope'), /no state "nope"/);
});

test('with the real renderer functions and the arena character: idle to run is a smooth blend of real poses, and it drives the skinning palette', () => {
  const character = createCharacter();
  const sk = character.skeleton, clips = character.clips;
  const graph = new AnimationGraph({
    parameters: { speed: 0, grounded: true },
    initial: 'loco',
    states: { loco: { blend1d: { param: 'speed', clips: [{ clip: clips.idle, at: 0 }, { clip: clips.walk, at: 3 }, { clip: clips.run, at: 6.5 }] } }, air: { clip: clips.air } },
    transitions: [{ from: 'loco', to: 'air', when: { param: 'grounded', equals: false }, duration: 0.15 }, { from: 'air', to: 'loco', when: { param: 'grounded', equals: true }, duration: 0.2 }],
  }, { skeleton: sk, sample: samplePose, blend: blendPoses });
  const palette = new Float32Array(sk.count * 16);
  const poses = [];
  for (const speed of [0, 1.5, 3, 5, 6.5]) { graph.set('speed', speed); for (let i = 0; i < 10; i++) graph.update(1 / 60); poses.push(Array.from(graph.pose.r)); }
  const dist = (a, b) => a.reduce((s, v, i) => s + (v - b[i]) ** 2, 0);
  for (let i = 1; i < poses.length; i++) assert.ok(dist(poses[i - 1], poses[i]) > 1e-6, 'each speed gives a different pose');
  graph.set('speed', 3); for (let i = 0; i < 30; i++) graph.update(1 / 60);
  const walkPose = Array.from(graph.pose.r);
  graph.set('grounded', false); graph.update(1 / 60);
  assert.equal(graph.state, 'air');
  const mid = Array.from(graph.pose.r);
  for (let i = 0; i < 20; i++) graph.update(1 / 60);
  const flying = Array.from(graph.pose.r);
  assert.ok(dist(walkPose, mid) < dist(walkPose, flying), 'the cross-fade starts near the old pose and ends at the new one');
  sk.computePalette(graph.pose, palette);
  assert.ok(palette.every(Number.isFinite), 'a valid skinning palette');
  graph.set('grounded', true);
  for (let i = 0; i < 40; i++) graph.update(1 / 60);
  assert.equal(graph.state, 'loco');
  assert.equal(graph.fade, null);
});
