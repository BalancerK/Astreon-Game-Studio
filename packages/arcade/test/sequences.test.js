import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newGame, spawn, first } from '../src/things.js';
import {
  playSequence, stepSequence, sequenceActive, takeSequenceCommands, clearSequence, drawSequence, sequenceProblems, cleanEvent, EVENT_KINDS,
} from '../src/sequences.js';
import { sounds, setSoundSink } from '../src/sound.js';
import { music } from '../src/music.js';
import { story, advanceStory, storyActive } from '../src/story.js';

const DT = 1 / 20;
const heard = [];
setSoundSink((m) => heard.push(m));
sounds({ door: { wave: 'square', pitch: 300 } });
music({ calm: { tempo: 90, bars: 1, tracks: [{ wave: 'sine', notes: [] }] } });
story('== greeting ==\nSam: Hello!\n<<end>>\n');

const make = () => {
  const game = newGame();
  spawn(game, 'hero', { x: 0, y: 100, w: 20, h: 20 });
  spawn(game, 'door', { x: 200, y: 100, w: 20, h: 40, hidden: true });
  return game;
};
const seq = () => ({
  duration: 2,
  tracks: { hero: { x: [[0, 0], [2, 100]] }, camera: { x: [[0, 0], [2, 40]] }, screen: { fade: [[1, 0], [2, 1]] } },
  events: [{ at: 0.5, kind: 'sound', name: 'door' }, { at: 1, kind: 'show', target: 'door' }, { at: 1.5, kind: 'command', name: 'open',
    arg: 'north' }],
});
const run = (game, s, seconds, opts) => { for (let i = 0; i < Math.round(seconds / DT); i++) stepSequence(game, s, DT, opts); };

test('tracks move several things at once: a thing, the camera and the screen', () => {
  const game = make();
  const s = seq();
  playSequence(game, s);
  run(game, s, 1);
  assert.equal(Math.round(first(game, 'hero').x), 50);
  assert.equal(Math.round(game.camera.x), 20);
  assert.equal(Math.round(game.sequence.screen.fade * 1000), 0, 'the fade starts at 1 second');
  run(game, s, 1);
  assert.equal(first(game, 'hero').x, 100);
  assert.equal(game.sequence.screen.fade, 1);
  assert.equal(sequenceActive(game), false, 'it is over');
});

test('each event happens once, at its time, in order', () => {
  heard.length = 0;
  const game = make();
  const s = seq();
  playSequence(game, s);
  run(game, s, 0.4);
  assert.equal(heard.length, 0, 'not yet');
  run(game, s, 0.2);
  assert.equal(heard.filter((m) => m.t === 'sound').length, 1);
  assert.equal(first(game, 'door').hidden, true, 'the door is shown at 1 s');
  run(game, s, 0.5);
  assert.equal(first(game, 'door').hidden, undefined);
  run(game, s, 2);
  assert.equal(heard.filter((m) => m.t === 'sound').length, 1, 'never twice');
  assert.deepEqual(takeSequenceCommands(game), [{ name: 'open', arg: 'north' }]);
  assert.deepEqual(takeSequenceCommands(game), [], 'taken once');
});

test('a track for a thing that is gone does nothing, and a sequence does not crash on it', () => {
  const game = make();
  const s = seq();
  playSequence(game, s);
  game.things = game.things.filter((t) => t.kind !== 'hero');
  assert.doesNotThrow(() => run(game, s, 2.5));
});

test('skipping jumps to the end: things end up where they would, only changes to the game still happen', () => {
  heard.length = 0;
  const game = make();
  const s = seq();
  playSequence(game, s);
  run(game, s, 0.2);
  assert.equal(stepSequence(game, s, DT, { skip: true }), false);
  assert.equal(first(game, 'hero').x, 100);
  assert.equal(game.sequence.screen.fade, 1);
  assert.equal(heard.length, 0, 'no sound plays for what was skipped');
  assert.equal(first(game, 'door').hidden, undefined, 'but the door is shown');
  assert.equal(takeSequenceCommands(game).length, 1, 'and the game is told');
  const locked = { ...seq(), skippable: false };
  const g2 = make();
  playSequence(g2, locked);
  stepSequence(g2, locked, DT, { skip: true });
  assert.equal(sequenceActive(g2), true, 'a sequence that cannot be skipped carries on');
});

test('a line of the story that the sequence waits for stops time until it is finished', () => {
  const game = make();
  const s = { duration: 2, tracks: { hero: { x: [[0, 0], [2, 100]] } }, events: [{ at: 0.5, kind: 'say', node: 'greeting', wait: true }] };
  playSequence(game, s);
  run(game, s, 0.6);
  assert.ok(storyActive(game), 'the story started');
  const x = first(game, 'hero').x;
  run(game, s, 1);
  assert.equal(first(game, 'hero').x, x, 'time stood still');
  advanceStory(game);
  run(game, s, 0.2);
  assert.ok(!storyActive(game));
  run(game, s, 2);
  assert.equal(first(game, 'hero').x, 100);
  assert.equal(sequenceActive(game), false);
});

test('a line that is not waited for lets the sequence carry on', () => {
  const game = make();
  const s = { duration: 1, tracks: {}, events: [{ at: 0.1, kind: 'say', node: 'greeting', wait: false }] };
  playSequence(game, s);
  run(game, s, 1.2);
  assert.equal(sequenceActive(game), false);
});

test('the fade and the black bars are drawn over the picture, and clearing the sequence removes them', () => {
  const calls = [];
  const g = new Proxy({}, { get: (_, n) => (...a) => calls.push([n, ...a]), set: (_, n, v) => { calls.push(['set', n, v]); return true; } });
  const game = make();
  const s = { duration: 1, tracks: { screen: { fade: [[0, 0.5]], letterbox: [[0, 1]] } }, events: [] };
  playSequence(game, s);
  run(game, s, 0.2);
  drawSequence(g, game, { width: 100, height: 100 });
  assert.equal(calls.filter((c) => c[0] === 'fillRect').length, 3, 'two bars and the fade');
  assert.ok(calls.some((c) => c[0] === 'set' && c[1] === 'globalAlpha' && c[2] === 0.5));
  clearSequence(game);
  calls.length = 0;
  drawSequence(g, game, { width: 100, height: 100 });
  assert.equal(calls.length, 0);
});

test('what it remembers is plain data and the run is the same each time', () => {
  const play = () => {
    const game = make();
    const s = seq();
    playSequence(game, s);
    run(game, s, 1.3);
    return JSON.stringify(game);
  };
  assert.equal(play(), play());
  assert.doesNotThrow(() => JSON.parse(play()));
});

test('events are made safe, and every kind has words and settings that clean to themselves', () => {
  for (const [kind, k] of Object.entries(EVENT_KINDS)) {
    assert.ok(k.label && k.help.length > 10, kind);
    const clean = cleanEvent({ kind, at: 1 });
    assert.deepEqual(cleanEvent(clean), clean, `${kind}: cleaning twice changes nothing`);
  }
  assert.equal(cleanEvent({ kind: 'nope' }), null);
  assert.equal(cleanEvent({ kind: 'shake', at: 99, amount: 1000 }, 5).at, 5);
  assert.equal(cleanEvent({ kind: 'shake', amount: 1000 }).amount, 40);
});

test('sequenceProblems says what is wrong, and which names the game does not have', () => {
  assert.deepEqual(sequenceProblems(seq(), { sounds: ['door'], nodes: ['greeting'] }), []);
  const bad = sequenceProblems({ duration: 2, tracks: { screen: { glow: [[0, 1]] }, hero: { x: [[5, 1]] } }, events: [{ at: 9, kind: 'sound',
    name: 'x' }, { at: 1, kind: 'dance' }] },
    { sounds: ['door'] });
  const text = bad.map((p) => p.message).join(' | ');
  assert.match(text, /no number called "glow"/);
  assert.match(text, /outside the sequence/);
  assert.match(text, /no sound called "x"/);
  assert.match(text, /not something that can happen/);
  assert.match(sequenceProblems({ duration: 0, tracks: {} })[0].message, /lasts more than 0/);
  assert.match(sequenceProblems({ duration: 2, tracks: {}, events: [{ at: 1, kind: 'say', node: 'nope' }] }, { nodes: ['a'] })[0].message,
    /no story part/);
});
