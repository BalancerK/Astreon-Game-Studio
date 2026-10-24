import { test } from 'node:test';
import assert from 'node:assert/strict';
import { animationFrame, animationDone, animate, spriteProblem, ANIMATION_MODES } from '../src/art.js';

const frames = (mode) => ({ frames: [0, 1, 2, 3], fps: 1, ...(mode ? { mode } : {}) });
const run = (mode, steps) => Array.from({ length: steps }, (_, i) => animationFrame(frames(mode), i + 0.1));

test('loop goes round and round, and is what you get when no mode is given', () => {
  assert.deepEqual(run(undefined, 9), [0, 1, 2, 3, 0, 1, 2, 3, 0]);
  assert.deepEqual(run('loop', 5), [0, 1, 2, 3, 0]);
});

test('once stops on the last frame, and says it is done', () => {
  assert.deepEqual(run('once', 7), [0, 1, 2, 3, 3, 3, 3]);
  assert.equal(animationDone(frames('once'), 2.5), false);
  assert.equal(animationDone(frames('once'), 3), true);
  assert.equal(animationDone(frames('loop'), 99), false, 'a loop never ends');
});

test('reverse goes backwards round and round', () => {
  assert.deepEqual(run('reverse', 9), [3, 2, 1, 0, 3, 2, 1, 0, 3]);
});

test('ping-pong goes to the end and back without showing the end frames twice', () => {
  assert.deepEqual(run('pingpong', 12), [0, 1, 2, 3, 2, 1, 0, 1, 2, 3, 2, 1]);
});

test('it works with the frames in any order, one frame, and two frames', () => {
  assert.equal(animationFrame({ frames: [5], fps: 8, mode: 'pingpong' }, 99), 5);
  assert.deepEqual([0, 1, 2, 3, 4].map((t) => animationFrame({ frames: [7, 9], fps: 1, mode: 'pingpong' }, t + 0.1)), [7, 9, 7, 9, 7]);
  assert.deepEqual([0, 1, 2].map((t) => animationFrame({ frames: [4, 2, 6], fps: 1, mode: 'reverse' }, t + 0.1)), [6, 2, 4]);
});

test('time before the start, and a very slow or fast animation, still give a frame that exists', () => {
  assert.equal(animationFrame(frames('loop'), -5), 0);
  assert.equal(animationFrame({ frames: [0, 1], fps: 60, mode: 'pingpong' }, 1e6) in { 0: 1, 1: 1 }, true);
});

test('animate uses the mode and tells a once animation it is finished', () => {
  const sprite = { w: 1, h: 1, palette: { a: '#fff' }, frames: [['a'], ['a'], ['a']], animations: { die: { frames: [0, 1, 2], fps: 10,
    mode: 'once' }, bob: { frames: [0, 1, 2], fps: 10, mode: 'pingpong' } } };
  const thing = { sprite: 'x', anim: 'die' };
  const art = { x: sprite };
  const seen = [];
  for (let i = 0; i < 6; i++) { animate(thing, art, 0.1); seen.push(thing.frame); }
  assert.deepEqual(seen, [1, 2, 2, 2, 2, 2]);
  assert.equal(thing.animDone, true);
  thing.anim = 'bob';
  const wave = [];
  for (let i = 0; i < 5; i++) { animate(thing, art, 0.1); wave.push(thing.frame); }
  assert.deepEqual(wave, [1, 2, 1, 0, 1], 'it started again from the beginning when the name changed');
  assert.equal(thing.animDone, false);
});

test('a sprite with a mode that does not exist is refused, and every known mode is accepted', () => {
  const base = (mode) => ({ w: 1, h: 1, palette: { a: '#fff' }, frames: [['a']], animations: { x: { frames: [0], fps: 4,
    ...(mode ? { mode } : {}) } } });
  assert.equal(spriteProblem(base()), null);
  for (const m of ANIMATION_MODES) assert.equal(spriteProblem(base(m)), null, m);
  assert.match(spriteProblem(base('spin')), /mode that is not one of/);
});
