import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../app/paint/sprite-model.js';

/** A 4×2 sprite: a is the main colour, b a near-copy of it, c different, d never used, e the same as c written differently. */
const make = () => ({
  w: 4, h: 2,
  palette: { a: '#ff0000', b: '#fe0101', c: '#0000ff', d: '#00ff00', e: '#0000FF' },
  frames: [['aaab', 'ccee'], ['aaaa', 'ceee']],
  animations: { go: { frames: [0, 1], fps: 8 } },
});

test('animations can be given a mode, which is kept, changed and written to the file and back', () => {
  let s = make();
  s = S.setAnimationMode(s, 'go', 'pingpong');
  assert.equal(s.animations.go.mode, 'pingpong');
  assert.deepEqual(s.animations.go.frames, [0, 1]);
  assert.equal(S.problemWith(s), null);
  assert.deepEqual(S.parseSprite(S.serializeSprite(s)).animations.go, { frames: [0, 1], fps: 8, mode: 'pingpong' });
  s = S.setAnimation(s, 'go', [1, 0], 12);
  assert.equal(s.animations.go.mode, 'pingpong', 'changing the frames keeps the mode');
  s = S.setAnimationMode(s, 'go', 'loop');
  assert.equal('mode' in s.animations.go, false, 'loop is the default and is not written');
  assert.equal(S.setAnimationMode(s, 'go', 'spin'), s);
  assert.equal(S.setAnimationMode(s, 'nope', 'once'), s);
  assert.match(S.problemWith({ ...make(), animations: { go: { frames: [0], fps: 4, mode: 'spin' } } }), /mode that is not one of/);
});

test('swapping two colours makes every pixel of one the other and back', () => {
  const s = S.swapColors(make(), 'a', 'c');
  assert.equal(s.palette.a, '#0000ff');
  assert.equal(s.palette.c, '#ff0000');
  assert.equal(S.swapColors(s, 'a', 'c').palette.a, '#ff0000', 'swapping twice is as it was');
  assert.equal(S.swapColors(make(), 'a', 'a').palette.a, '#ff0000');
  const same = make();
  assert.equal(S.swapColors(same, 'a', 'zz'), same);
});

test('merging folds a colour into another: its pixels move over, in every frame, and it leaves the palette', () => {
  const s = S.mergeColors(make(), 'b', 'a');
  assert.deepEqual(s.frames[0], ['aaaa', 'ccee']);
  assert.equal('b' in s.palette, false);
  assert.equal(S.problemWith(s), null);
  const same = make();
  assert.equal(S.mergeColors(same, 'a', 'a'), same);
  assert.equal(S.mergeColors(same, 'a', 'zz'), same);
});

test('colours that are the same are found (however they are written) and merged', () => {
  assert.deepEqual(S.duplicateColors(make()), [['c', 'e']]);
  const s = S.mergeDuplicates(make());
  assert.equal('e' in s.palette, false);
  assert.deepEqual(s.frames[0], ['aaab', 'cccc']);
  assert.deepEqual(S.duplicateColors(s), []);
});

test('colours nothing uses are found and removed', () => {
  assert.deepEqual(S.unusedColors(make()), ['d']);
  const s = S.removeUnused(make());
  assert.deepEqual(Object.keys(s.palette), ['a', 'b', 'c', 'e']);
  assert.deepEqual(S.countLetters(make()), { a: 7, b: 1, c: 3, e: 5 });
});

test('reducing to a limit folds the least used colour into its nearest, and stops at the limit', () => {
  const s = S.reduceColors(make(), 3);
  assert.deepEqual(Object.keys(s.palette).sort(), ['a', 'c', 'e'], 'the unused one went, then b (the least used) was folded into a, its nearest');
  assert.deepEqual(s.frames[0], ['aaaa', 'ccee']);
  const two = S.reduceColors(make(), 2);
  assert.equal(Object.keys(two.palette).length, 2);
  assert.equal(S.problemWith(two), null);
  assert.equal(Object.keys(S.reduceColors(make(), 1).palette).length, 1);
  assert.equal(Object.keys(S.reduceColors(make(), 99).palette).length, 4, 'it only takes away what is needed (and the unused one)');
});

test('the palette is described in plain words', () => {
  assert.deepEqual(S.paletteProblems(make(), 0), ['1 colour is the same as another one.', '1 colour is not used by any pixel.']);
  assert.match(S.paletteProblems(make(), 2).join(' '), /uses 4 colours; the limit is 2/);
  assert.deepEqual(S.paletteProblems(S.reduceColors(S.mergeDuplicates(make()), 2), 2), []);
});
