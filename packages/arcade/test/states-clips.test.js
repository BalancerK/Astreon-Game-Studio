import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stepState, enterState, holds, ready, eventsOf, fieldsOf, describe, machineProblems } from '../src/states.js';
import { stepClip, sampleClip, sampleTrack, clipTime, ease, clipProblems } from '../src/clips.js';

const hero = () => ({
  initial: 'idle',
  states: {
    idle: { animation: 'idle', transitions: [{ to: 'walk', when: { field: 'vx', op: '!=', value: 0 } }, { to: 'hurt', event: 'hit' }] },
    walk: { animation: 'walk', transitions: [{ to: 'idle', when: { field: 'vx', op: '==', value: 0 } }] },
    hurt: { animation: 'hurt', transitions: [{ to: 'idle', after: 0.5 }] },
  },
});

test('a thing starts in the first state, with its animation, and moves when a condition holds', () => {
  const m = hero();
  const thing = { vx: 0 };
  assert.equal(stepState(thing, m, 1 / 60), 'idle');
  assert.equal(thing.anim, 'idle');
  thing.vx = 3;
  assert.equal(stepState(thing, m, 1 / 60), 'walk');
  assert.equal(thing.anim, 'walk');
  assert.equal(thing.stateTime, 0, 'the clock starts again in the new state');
  thing.vx = 0;
  assert.equal(stepState(thing, m, 1 / 60), 'idle');
});

test('an event moves a thing once, and is used up by the move it caused', () => {
  const m = hero();
  const thing = { vx: 0 };
  stepState(thing, m, 0.016);
  assert.equal(stepState(thing, m, 0.016, ['hit']), 'hurt');
  assert.equal(stepState(thing, m, 0.016, ['hit']), 'hurt', 'hit again while hurt does nothing: hurt has no hit transition');
  for (let i = 0; i < 20; i++) stepState(thing, m, 0.016);
  assert.equal(thing.state, 'hurt', 'not yet: 0.5 s have not passed');
  for (let i = 0; i < 20; i++) stepState(thing, m, 0.016);
  assert.equal(thing.state, 'idle', 'after 0.5 s it goes back');
});

test('conditions: every operator, fields found by path, a missing field, and several conditions all have to hold', () => {
  const thing = { n: 5, name: 'x', hp: { now: 2 }, on: true };
  const c = (field, op, value) => holds(thing, { field, op, value });
  assert.ok(c('n', '==', 5) && c('n', '!=', 4) && c('n', '<', 6) && c('n', '<=', 5) && c('n', '>', 4) && c('n', '>=', 5));
  assert.ok(!c('n', '<', 5) && !c('n', '>', 5));
  assert.ok(c('name', '==', 'x') && c('on', '==', true) && c('hp.now', '<', 3));
  assert.ok(!c('missing', '>', 0) && !c('missing', '==', 0) && c('missing', '!=', 0), 'a missing field is undefined');
  assert.ok(!c('name', '<', 3), 'a word is not less than a number');
  assert.ok(!holds(thing, { field: 'n', op: '??', value: 5 }));
  assert.ok(ready(thing, { to: 'a', when: [{ field: 'n', op: '>', value: 1 }, { field: 'on', op: '==', value: true }] }));
  assert.ok(!ready(thing, { to: 'a', when: [{ field: 'n', op: '>', value: 1 }, { field: 'on', op: '==', value: false }] }));
  assert.ok(!ready({ stateTime: 0.2 }, { to: 'a', after: 0.5 }) && ready({ stateTime: 0.5 }, { to: 'a', after: 0.5 }));
  assert.ok(!ready({}, { to: 'a', event: 'x' }, []) && ready({}, { to: 'a', event: 'x' }, ['x']));
});

test('the first transition that can be taken wins, "any" applies from every state, and a chain of moves in one tick cannot loop forever', () => {
  const m = { initial: 'a', any: [{ to: 'dead', event: 'die' }], states: {
    a: { transitions: [{ to: 'b', when: { field: 'go', op: '==', value: true } }, { to: 'c', when: { field: 'go', op: '==', value: true } }] },
    b: { transitions: [{ to: 'c', after: 0 }] }, c: { transitions: [] }, dead: {},
  } };
  const thing = { go: true };
  assert.equal(stepState(thing, m, 0.1), 'c', 'a to b (first), then b to c at once');
  assert.equal(stepState({ go: false }, m, 0.1, ['die']), 'dead', 'any from the starting state');
  const loop = { initial: 'x', states: { x: { transitions: [{ to: 'y', after: 0 }] }, y: { transitions: [{ to: 'x', after: 0 }] } } };
  const t = {};
  assert.doesNotThrow(() => stepState(t, loop, 0.1));
  assert.ok(['x', 'y'].includes(t.state));
  assert.equal(stepState({}, { initial: 'nope', states: { only: {} } }, 0.1), 'only', 'a bad first state falls back to the first one there is');
  assert.equal(stepState({ state: 'ghost', vx: 0 }, hero(), 0.1), 'idle', 'a state that was deleted puts the thing back at the start');
  assert.equal(enterState({}, hero(), 'nope'), false);
});

test('events and fields a machine uses are listed, and transitions are put in plain words', () => {
  assert.deepEqual(eventsOf(hero()), ['hit']);
  assert.deepEqual(fieldsOf(hero()), ['vx']);
  assert.equal(describe({ to: 'a', event: 'hit' }), 'on hit');
  assert.equal(describe({ to: 'a', after: 0.5 }), 'after 0.5 s');
  assert.equal(describe({ to: 'a', event: 'hit', when: { field: 'hp', op: '>', value: 0 } }), 'on hit and hp > 0');
  assert.equal(describe({ to: 'a' }), 'always');
});

test('the machine check finds missing states, bad targets, instant transitions, unreachable states and dead ends', () => {
  assert.deepEqual(machineProblems(hero()), []);
  assert.equal(machineProblems({ initial: 'a', states: {} })[0].kind, 'shape');
  const bad = { initial: 'zzz', states: { a: { transitions: [{ to: 'nope', event: 'x' }, { to: 'b' }] }, b: {}, island: { transitions: [{ to: 'a', event: 'y' }] } } };
  const kinds = machineProblems(bad).map((p) => `${p.state}:${p.kind}`).sort();
  assert.deepEqual(kinds, ['a:always', 'a:target', 'b:stuck', 'island:unreachable', 'zzz:initial'].sort());
  assert.ok(machineProblems(bad).every((p) => p.message.length > 10));
});

const bob = () => ({ duration: 1, loop: true, tracks: { y: [[0, 100, 'inout'], [0.5, 90, 'inout'], [1, 100]], alpha: [[0, 0, 'linear'], [0.5, 1]] } });

test('easing: ends meet, in is slower at the start, out at the end, step jumps at the end', () => {
  for (const how of ['linear', 'in', 'out', 'inout', 'step']) assert.ok(ease(how, 0) === 0 && ease(how, 1) === 1, how);
  assert.ok(ease('in', 0.5) < 0.5 && ease('out', 0.5) > 0.5 && ease('inout', 0.5) === 0.5);
  assert.equal(ease('step', 0.99), 0);
  assert.equal(ease('linear', 2), 1, 'beyond the end is the end');
  assert.equal(ease('nonsense', 0.3), 0.3);
});

test('a track is its first value before the first key, its last after the last, and moves between keys the way the key says', () => {
  const keys = [[0.2, 10, 'linear'], [0.6, 20, 'step'], [1, 40]];
  assert.equal(sampleTrack(keys, 0), 10);
  assert.equal(sampleTrack(keys, 0.4), 15);
  assert.equal(sampleTrack(keys, 0.8), 20, 'step holds until the next key');
  assert.equal(sampleTrack(keys, 1), 40);
  assert.equal(sampleTrack(keys, 5), 40);
  assert.equal(sampleTrack([], 1), undefined);
  assert.equal(sampleTrack([[0.5, 7]], 0.1), 7);
  assert.equal(sampleTrack([[0, 1], [0, 3]], 0), 1, 'two keys at the same time do not divide by zero');
  assert.equal(sampleTrack([[0, 1, 'linear'], [0, 3]], 0.5), 3);
});

test('a clip gives every number at a time; a looping one wraps and another stops at its end', () => {
  const clip = bob();
  assert.deepEqual(sampleClip(clip, 0), { y: 100, alpha: 0 });
  assert.equal(sampleClip(clip, 0.5).y, 90);
  assert.equal(sampleClip(clip, 1.5).y, 90, 'wraps round');
  assert.equal(clipTime(clip, -0.25), 0.75, 'a negative time wraps too');
  const once = { ...bob(), loop: false };
  assert.equal(sampleClip(once, 7).y, 100);
  assert.equal(clipTime(once, 7), 1);
});

test('stepClip sets the numbers on the thing, keeps its own clock, restarts for a different clip, and says when a clip has finished', () => {
  const thing = { y: 0 };
  const clip = bob();
  stepClip(thing, clip, 0.5);
  assert.equal(thing.y, 90);
  assert.equal(thing.clipTime, 0.5);
  stepClip(thing, clip, 0.25, 'other');
  assert.equal(thing.clipTime, 0.25, 'a different clip starts from the beginning');
  const once = { duration: 0.2, tracks: { x: [[0, 0], [0.2, 10]] } };
  const t = {};
  assert.equal(stepClip(t, once, 0.1, 'slide'), true);
  assert.equal(stepClip(t, once, 0.1, 'slide'), false, 'finished');
  assert.equal(t.x, 10);
  assert.equal(stepClip(t, bob(), 100, 'loop'), true, 'a looping clip never finishes');
});

test('the clip check finds a bad length, no tracks, empty tracks, keys outside the clip, out of order, not numbers and unknown easing', () => {
  assert.deepEqual(clipProblems(bob()), []);
  assert.equal(clipProblems(null)[0].kind, 'shape');
  assert.ok(clipProblems({ duration: 0, tracks: { a: [[0, 1]] } }).some((p) => p.kind === 'length'));
  assert.ok(clipProblems({ duration: 1, tracks: {} }).some((p) => p.kind === 'shape'));
  assert.ok(clipProblems({ duration: 1, tracks: { a: [] } }).some((p) => p.field === 'a'));
  const kinds = clipProblems({ duration: 1, tracks: { a: [[0, 1], [2, 1], [0.5, 'x', 'wobble']] } }).map((p) => p.kind).sort();
  assert.deepEqual(kinds, ['ease', 'order', 'time', 'value']);
});
