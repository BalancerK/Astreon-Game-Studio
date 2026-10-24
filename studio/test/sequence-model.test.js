import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../app/paint/sequence-model.js';

const known = { sounds: ['door'], songs: ['calm'], nodes: ['start'] };

test('every preset and the blank sequence are ones the kit accepts, and write out and read back the same', () => {
  for (const make of [...Object.values(M.PRESETS), M.newSequence]) {
    const seq = make();
    assert.deepEqual(M.sequenceProblems(seq, known), []);
    assert.deepEqual(M.parseSequences(M.serializeSequences({ one: seq })).one, seq);
  }
});

test('the length can change, and keys and events past the end are pulled back', () => {
  const seq = M.setDuration(M.PRESETS.door(), 1);
  assert.equal(seq.duration, 1);
  assert.ok(Object.values(seq.tracks.hero.x).every((k) => k[0] <= 1));
  assert.ok(seq.events.every((e) => e.at <= 1));
  assert.equal(M.setDuration(seq, 99999).duration, 300);
  assert.equal(M.setDuration(seq, -4).duration, 0.1);
});

test('targets and tracks are added and taken away, with reasons when they cannot be', () => {
  let seq = M.newSequence();
  seq = M.addTarget(seq, 'door', 'y', 50);
  assert.deepEqual(seq.tracks.door.y, [[0, 50, 'linear'], [3, 50]]);
  seq = M.addTarget(seq, 'camera');
  assert.ok('x' in seq.tracks.camera);
  seq = M.addTarget(seq, 'screen');
  assert.ok('fade' in seq.tracks.screen);
  assert.throws(() => M.addTarget(seq, 'door'), /already/);
  assert.throws(() => M.addTarget(seq, '9lives'), /kind of thing/);
  assert.throws(() => M.addField(seq, 'screen', 'x'), /fade and letterbox/);
  seq = M.addField(seq, 'door', 'alpha', 1);
  assert.ok('alpha' in seq.tracks.door);
  assert.throws(() => M.addField(seq, 'door', 'alpha'), /already/);
  seq = M.removeField(seq, 'door', 'y');
  seq = M.removeField(seq, 'door', 'alpha');
  assert.ok(!('door' in seq.tracks), 'a target with no tracks goes');
  assert.ok(!('hero' in M.removeTarget(seq, 'hero').tracks));
  let many = M.newSequence();
  for (let i = 0; i < 7; i++) many = M.addTarget(many, `t${i}`);
  assert.match(M.targetProblem(many, 'more'), /At most 8/);
});

test('keys are added, moved, eased and removed, keeping time order', () => {
  let seq = M.newSequence();
  let r = M.addKey(seq, 'hero', 'x', 1.5, 100);
  seq = r.seq;
  assert.deepEqual(seq.tracks.hero.x.map((k) => k[0]), [0, 1.5, 3]);
  assert.equal(r.index, 1);
  r = M.moveKey(seq, 'hero', 'x', 1, 2.5, 80);
  seq = r.seq;
  assert.deepEqual(seq.tracks.hero.x.map((k) => k[0]), [0, 2.5, 3]);
  seq = M.setEase(seq, 'hero', 'x', 0, 'out');
  assert.equal(seq.tracks.hero.x[0][2], 'out');
  seq = M.removeKey(seq, 'hero', 'x', 1);
  assert.equal(seq.tracks.hero.x.length, 2);
  assert.throws(() => M.removeKey(M.removeKey(seq, 'hero', 'x', 1), 'hero', 'x', 0), /at least one key/);
});

test('events are added in time order, moved, changed within range, and removed', () => {
  let seq = M.newSequence();
  let r = M.addEvent(seq, 'sound', 2);
  seq = M.addEvent(r.seq, 'shake', 1).seq;
  assert.deepEqual(seq.events.map((e) => e.kind), ['shake', 'sound']);
  r = M.addEvent(seq, 'say', 0.5);
  assert.equal(r.seq.events[r.index].kind, 'say');
  r = M.moveEvent(seq, 0, 2.9);
  assert.deepEqual(r.seq.events.map((e) => e.kind), ['sound', 'shake']);
  assert.equal(r.index, 1);
  seq = M.setEvent(seq, 1, { name: 'boom', volume: 9 });
  assert.equal(seq.events[1].name, 'boom');
  assert.equal(seq.events[1].volume, 1);
  assert.equal(M.removeEvent(seq, 0).events.length, 1);
  assert.throws(() => M.addEvent(seq, 'dance', 1), /not something/);
  assert.equal(M.addEvent(seq, 'sound', 99).seq.events.at(-1).at, 3, 'an event cannot be past the end');
});

test('the preview says where everything is at a time, and which events have happened', () => {
  const seq = M.PRESETS.walk();
  const mid = M.previewAt(seq, 1.5);
  assert.ok(mid.things.hero.x > 40 && mid.things.hero.x < 300);
  assert.ok(mid.camera.x > 0);
  assert.equal(mid.screen.letterbox, 1);
  assert.equal(M.previewAt(seq, 0).screen.fade, 1);
  assert.equal(M.previewAt(seq, 2).screen.fade, 0);
  assert.equal(M.previewAt(seq, 0).happened.length, 1, 'the music starts at 0');
  assert.equal(M.previewAt(M.PRESETS.door(), 1).happened.length, 0);
  assert.equal(M.previewAt(M.PRESETS.door(), 3).happened.length, 4);
  assert.match(M.describeEvent({ kind: 'sound', name: 'door' }), /Play a sound: door/);
});

test('a hand-edited file is read, and a broken one is explained', () => {
  const file = M.parseSequences('export default { "a": { "duration": -1, "tracks": { "hero": { "x": [[0, 1]] } } } };');
  assert.equal(file.a.duration, 1);
  assert.deepEqual(file.a.events, []);
  assert.throws(() => M.parseSequences('nothing'), /not a set of sequences/);
  assert.throws(() => M.parseSequences('export default { oops };'), /plain JSON/);
  assert.throws(() => M.parseSequences('export default { "9a": {} };'), /not usable/);
  assert.throws(() => M.parseSequences('export default { "a": { "tracks": { "9x": {} } } };'), /not usable/);
});
