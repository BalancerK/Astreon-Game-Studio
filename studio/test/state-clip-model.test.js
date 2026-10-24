import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../app/paint/state-model.js';
import * as C from '../app/paint/clip-model.js';

test('a machine file is saved and read back exactly, and a damaged one is explained', () => {
  const machines = { hero: S.starterMachine(), slime: S.newMachine() };
  const text = S.serializeStates(machines);
  assert.match(text, /^\/\/ Made with the studio/);
  assert.deepEqual(S.parseStates(text), machines);
  assert.throws(() => S.parseStates('nothing'), /not a set of state machines/);
  assert.throws(() => S.parseStates('export default { oops };'), /plain JSON/);
  assert.throws(() => S.parseStates('export default { "a b": { "states": { "x": {} } } };'), /not usable/);
  assert.throws(() => S.parseStates('export default { "a": { "states": {} } };'), /at least one state/);
  const fixed = S.parseStates('export default { "a": { "initial": "gone", "states": { "x": {} } } };');
  assert.equal(fixed.a.initial, 'x', 'a first state that does not exist is replaced by one that does');
  assert.deepEqual(fixed.a.states.x.transitions, []);
});

test('the starter machine is clean by the kit\'s own check', () => {
  assert.deepEqual(S.machineProblems(S.starterMachine()), []);
  assert.deepEqual(S.eventsOf(S.starterMachine()), ['hit']);
  assert.deepEqual(S.fieldsOf(S.starterMachine()), ['vx']);
});

test('states: added in a free place, renamed everywhere, removed with what led to them, the first one kept valid', () => {
  let m = S.starterMachine();
  m = S.addState(m, 'jump');
  assert.ok('jump' in m.states);
  const spots = Object.values(S.layoutOf(m)).map((p) => p.join(','));
  assert.equal(new Set(spots).size, spots.length, 'no two states on the same spot');
  m = S.renameState(m, 'walk', 'run');
  assert.ok('run' in m.states && !('walk' in m.states));
  assert.equal(m.states.idle.transitions[0].to, 'run', 'arrows follow the new name');
  assert.deepEqual(m.layout.run, [230, 30]);
  m = S.removeState(m, 'run');
  assert.ok(!m.states.idle.transitions.some((t) => t.to === 'run'));
  m = S.removeState(m, 'idle');
  assert.notEqual(m.initial, 'idle');
  assert.ok(m.initial in m.states);
  assert.throws(() => S.removeState(S.newMachine(), 'idle'), /at least one state/);
  assert.equal(S.nameProblem('1bad', () => false), 'Use letters and numbers, starting with a letter');
  assert.match(S.nameProblem('idle', (n) => n === 'idle'), /already/);
  assert.equal(S.freeName({ state: 1 }, 'state'), 'state2');
});

test('the starting state, animation and place can be set', () => {
  let m = S.starterMachine();
  m = S.setInitial(m, 'walk');
  assert.equal(m.initial, 'walk');
  assert.equal(S.setInitial(m, 'nope'), m);
  m = S.setAnimation(m, 'walk', 'run');
  assert.equal(m.states.walk.animation, 'run');
  m = S.setAnimation(m, 'walk', '');
  assert.ok(!('animation' in m.states.walk));
  m = S.moveState(m, 'idle', 12.4, -5);
  assert.deepEqual(m.layout.idle, [12, 0]);
});

test('transitions: added, changed, removed, reordered, from a state or from any state', () => {
  let m = S.newMachine();
  m = S.addState(m, 'jump');
  m = S.addTransition(m, 'idle', 'jump', { event: 'press' });
  assert.deepEqual(m.states.idle.transitions, [{ to: 'jump', event: 'press' }]);
  m = S.updateTransition(m, 'idle', 0, { event: undefined, after: 2 });
  assert.deepEqual(m.states.idle.transitions[0], { to: 'jump', after: 2 });
  m = S.addTransition(m, 'idle', 'jump', { after: 5 });
  m = S.moveTransition(m, 'idle', 1, -1);
  assert.equal(m.states.idle.transitions[0].after, 5);
  assert.equal(S.moveTransition(m, 'idle', 0, -1).states.idle.transitions[0].after, 5, 'cannot go above the top');
  m = S.removeTransition(m, 'idle', 0);
  assert.equal(S.listOf(m, 'idle').length, 1);
  m = S.addTransition(m, S.ANY, 'idle', { event: 'reset' });
  assert.deepEqual(m.any, [{ to: 'idle', event: 'reset' }]);
  m = S.removeTransition(m, S.ANY, 0);
  assert.ok(!('any' in m), 'an empty "from any" list is dropped');
});

test('conditions: added, edited, removed; one condition is stored as a record, several as a list', () => {
  let m = S.addTransition(S.starterMachine(), 'hurt', 'walk', { event: 'recover' });
  const at = m.states.hurt.transitions.length - 1;
  m = S.addCondition(m, 'hurt', at, 'hp');
  assert.deepEqual(m.states.hurt.transitions[at].when, { field: 'hp', op: '!=', value: 0 });
  m = S.setCondition(m, 'hurt', at, 0, { op: '>', value: 3 });
  assert.deepEqual(m.states.hurt.transitions[at].when, { field: 'hp', op: '>', value: 3 });
  m = S.addCondition(m, 'hurt', at, 'ground');
  assert.equal(m.states.hurt.transitions[at].when.length, 2);
  m = S.removeCondition(m, 'hurt', at, 0);
  assert.deepEqual(m.states.hurt.transitions[at].when, { field: 'ground', op: '!=', value: 0 });
  m = S.removeCondition(m, 'hurt', at, 0);
  assert.ok(!('when' in m.states.hurt.transitions[at]));
  assert.deepEqual([S.parseValue('3'), S.parseValue(' 2.5 '), S.parseValue('true'), S.parseValue('false'), S.parseValue('left'), S.parseValue('')], [3, 2.5, true, false, 'left', '']);
});

test('arrows are drawn between the edges of states, with a separate bend each way, and none for states that are not there', () => {
  const m = S.starterMachine();
  const edges = S.edgesOf(m);
  assert.equal(edges.length, 5);
  assert.ok(edges.every((e) => /^M-?\d+,-?\d+ Q/.test(e.path) && e.label.length));
  const ab = edges.find((e) => e.from === 'idle' && e.to === 'walk');
  const ba = edges.find((e) => e.from === 'walk' && e.to === 'idle');
  assert.notEqual(ab.at.join(','), ba.at.join(','), 'the arrows each way do not overlap');
  const broken = S.addTransition(m, 'idle', 'ghost');
  assert.equal(S.edgesOf(broken).length, 5, 'a target that does not exist is not drawn (the check reports it)');
  assert.ok(S.machineProblems(broken).some((p) => p.kind === 'target'));
  const withAny = S.addTransition(m, S.ANY, 'idle', { event: 'reset' });
  assert.ok(S.edgesOf(withAny).some((e) => e.from === S.ANY && e.label === 'on reset'));
});

// ---------- clips ----------

test('a clips file is saved and read back exactly, and a damaged one is explained', () => {
  const clips = { bob: C.PRESETS.bob(), fade: C.PRESETS['fade-in'](), slide: C.PRESETS['slide-in']() };
  assert.deepEqual(C.parseClips(C.serializeClips(clips)), clips);
  assert.throws(() => C.parseClips('x'), /not a set of clips/);
  assert.throws(() => C.parseClips('export default { nope };'), /plain JSON/);
  assert.throws(() => C.parseClips('export default { "a": { "tracks": { "bad name": [] } } };'), /not usable/);
  assert.equal(C.parseClips('export default { "a": { "tracks": { "x": [[0, 1]] } } };').a.duration, 1, 'a missing length becomes 1');
});

test('every preset is a clean clip by the kit\'s own check', () => {
  for (const [name, make] of Object.entries(C.PRESETS)) assert.deepEqual(C.clipProblems(make()), [], name);
  assert.deepEqual(C.clipProblems(C.newClip()), []);
});

test('tracks: added flat, renamed in place, removed (never the last one), checked', () => {
  let c = C.newClip();
  assert.equal(C.fieldProblem(c, 'x'), 'This clip already has a track with that name');
  assert.match(C.fieldProblem(c, '1x'), /Use a name/);
  assert.equal(C.fieldProblem(c, 'alpha'), null);
  c = C.addTrack(c, 'alpha', 1);
  assert.deepEqual(c.tracks.alpha, [[0, 1, 'linear'], [1, 1]]);
  c = C.renameTrack(c, 'x', 'px');
  assert.deepEqual(Object.keys(c.tracks), ['px', 'alpha']);
  c = C.removeTrack(c, 'alpha');
  assert.throws(() => C.removeTrack(c, 'px'), /at least one track/);
});

test('keys: put in time order, replace one at the same time, move without losing their easing, easing set, removed (never the last one)', () => {
  let c = C.newClip();
  let r = C.addKey(c, 'x', 0.5, 70);
  c = r.clip;
  assert.equal(r.index, 1);
  assert.deepEqual(c.tracks.x.map((k) => k[0]), [0, 0.5, 1]);
  r = C.addKey(c, 'x', 0.5, 20);
  assert.equal(r.clip.tracks.x.length, 3, 'same time replaces');
  assert.equal(r.clip.tracks.x[1][1], 20);
  c = C.setEase(c, 'x', 1, 'out');
  assert.deepEqual(c.tracks.x[1], [0.5, 70, 'out']);
  r = C.moveKey(c, 'x', 1, 0.9, 55.55555);
  assert.deepEqual(r.clip.tracks.x[1], [0.9, 55.556, 'out'], 'keeps its easing, rounded');
  r = C.moveKey(c, 'x', 1, 5, 0);
  assert.equal(r.clip.tracks.x.at(-1)[0], 1, 'a key cannot leave the clip');
  assert.equal(r.clip.tracks.x.length, 2, 'it replaced the key at the end');
  c = C.setEase(c, 'x', 1, 'linear');
  assert.deepEqual(c.tracks.x[1], [0.5, 70]);
  c = C.removeKey(c, 'x', 1);
  assert.equal(c.tracks.x.length, 2);
  assert.throws(() => C.removeKey(C.removeKey(c, 'x', 0), 'x', 0), /at least one key/);
});

test('changing the length pulls keys back inside the clip, and the loop switch works', () => {
  let c = C.newClip();
  c = C.setDuration(c, 0.5);
  assert.equal(c.duration, 0.5);
  assert.deepEqual(c.tracks.x.map((k) => k[0]), [0, 0.5]);
  assert.equal(C.setDuration(c, 0).duration, 0.05);
  assert.equal(C.setDuration(c, 9999).duration, C.CLIP_LIMITS.duration);
  assert.equal(C.setLoop(c, false).loop, false);
  assert.equal(C.freeName({ clip: 1 }, 'clip'), 'clip2');
  const [lo, hi] = C.rangeOf([[0, 5], [1, 5]]);
  assert.ok(lo < 5 && hi > 5, 'a flat track still has a height');
});
