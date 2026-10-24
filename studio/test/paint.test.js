import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../app/paint/sprite-model.js';
import * as L from '../app/paint/level-model.js';
import * as D from '../app/paint/sound-model.js';
import { spriteProblem, cleanSound } from '../../packages/arcade/src/index.js';
import { synthesize } from '../../packages/audio/src/synth.js';
import { TEMPLATES } from '../app/store/templates.js';

const tiny = () => S.newSprite(4, 3, ['#111111', '#ff0000']);

test('a new sprite is valid, and the painter and the kit agree on what valid means', () => {
  const s = S.newSprite(8, 8); assert.equal(S.problemWith(s), null); assert.equal(spriteProblem(s), null); assert.equal(Object.keys(s.palette).length, 8);
  const bad = [
    { ...s, w: 0 }, { ...s, w: 129 }, { ...s, frames: [] }, { ...s, frames: [['x']] }, { ...s, palette: { ab: '#fff' } }, { ...s, palette: { a: 5 } },
    { ...s, frames: [Array(8).fill('zzzzzzzz')] }, { ...s, animations: { run: { frames: [3], fps: 8 } } }, { ...s, animations: { run: { frames: [0], fps: 0 } } },
  ];
  for (const b of bad) { assert.ok(S.problemWith(b), JSON.stringify(b).slice(0, 60)); assert.ok(spriteProblem(b), 'the kit agrees'); }
  assert.equal(S.problemWith(null), 'a sprite is an object');
});

test('painting: a pixel, a fill, a line, a rectangle; a stroke off the edge is ignored; nothing changes if the pixel is already that colour', () => {
  let s = tiny(); const a = 'b';
  const p = S.setPixel(s, 0, 1, 1, a); assert.equal(p.frames[0][1], '.b..'); assert.equal(s.frames[0][1], '....', 'the old sprite is untouched'); assert.equal(S.setPixel(p, 0, 1, 1, a), p, 'same sprite back');
  assert.equal(S.setPixel(s, 0, 9, 9, a), s); assert.equal(S.setPixel(s, 0, -1, 0, a), s); assert.equal(S.setPixel(s, 0, 1.5, 0, a), s);
  const filled = S.floodFill(s, 0, 0, 0, a); assert.deepEqual(filled.frames[0], ['bbbb', 'bbbb', 'bbbb']);
  const walled = S.paintPoints(s, 0, S.linePoints(2, 0, 2, 2), a); const f2 = S.floodFill(walled, 0, 0, 0, 'a');
  assert.deepEqual(f2.frames[0], ['aab.', 'aab.', 'aab.'], 'a fill stops at a wall of another colour');
  assert.deepEqual(S.linePoints(0, 0, 3, 0), [[0, 0], [1, 0], [2, 0], [3, 0]]); assert.equal(S.linePoints(0, 0, 4, 4).length, 5); assert.deepEqual(S.linePoints(2, 2, 2, 2), [[2, 2]]);
  assert.equal(S.rectPoints(0, 0, 2, 2).length, 8); assert.equal(S.rectPoints(0, 0, 2, 2, true).length, 9); assert.equal(S.rectPoints(2, 2, 0, 0, true).length, 9);
  assert.equal(S.paintPoints(s, 0, [[9, 9]], a), s); const erased = S.setPixel(p, 0, 1, 1, '.'); assert.equal(erased.frames[0][1], '....');
  assert.equal(S.floodFill(s, 0, 9, 9, a), s); assert.equal(S.problemWith(filled), null); s = filled;
});

test('frames and animations stay in step: adding, copying and removing frames keeps animations pointing at the right ones', () => {
  let s = tiny(); const a = Object.keys(s.palette)[1];
  s = S.setPixel(s, 0, 0, 0, a); s = S.addFrame(s, 0); assert.equal(s.frames.length, 2); assert.deepEqual(s.frames[1], s.frames[0], 'a copy');
  s = S.addFrame(s); assert.deepEqual(s.frames[2], ['....', '....', '....'], 'a blank one at the end');
  s = S.setAnimation(s, 'run', [0, 1, 2], 8); assert.deepEqual(s.animations.run, { frames: [0, 1, 2], fps: 8 }); assert.equal(S.problemWith(s), null); assert.equal(spriteProblem(s), null);
  const inserted = S.addFrame(s, 0); assert.deepEqual(inserted.animations.run.frames, [0, 2, 3], 'frames after the new one move along');
  const removed = S.deleteFrame(s, 1); assert.deepEqual(removed.animations.run.frames, [0, 1]); assert.equal(removed.frames.length, 2);
  const gone = S.deleteFrame(S.deleteFrame(S.setAnimation(S.addFrame(tiny()), 'x', [1], 4), 1), 0); assert.equal(gone.frames.length, 1, 'never the last frame'); assert.deepEqual(gone.animations, {});
  assert.equal(S.setAnimation(s, 'bad name!', [0], 8), s); assert.equal(S.setAnimation(s, 'x', [9], 8), s); assert.equal(S.setAnimation(s, 'x', [], 8), s); assert.equal(S.setAnimation(s, 'x', [0], 500).animations.x.fps, 60);
  assert.deepEqual(S.removeAnimation(s, 'run').animations, {}); assert.equal(S.removeAnimation(s, 'nope'), s);
});

test('resize, flip and shift', () => {
  let s = tiny(); const a = 'b'; s = S.setPixel(S.setPixel(s, 0, 0, 0, a), 0, 3, 2, a);
  const big = S.resize(s, 6, 4); assert.deepEqual(big.frames[0], ['b.....', '......', '...b..', '......']); assert.equal(S.problemWith(big), null);
  const small = S.resize(s, 2, 2); assert.deepEqual(small.frames[0], ['b.', '..']); assert.equal(S.resize(s, 0, 5), s); assert.equal(S.resize(s, 200, 5), s);
  assert.deepEqual(S.flipHorizontal(s, 0).frames[0], ['...b', '....', 'b...']);
  assert.deepEqual(S.shift(s, 0, 1, 0).frames[0], ['.b..', '....', 'b...'], 'sliding right: what leaves the right edge comes back on the left');
  assert.deepEqual(S.shift(s, 0, 0, 1).frames[0], ['...b', 'b...', '....']);
});

test('colours: add, change, remove (pixels using a removed colour become see-through)', () => {
  let s = tiny(); const { sprite: s2, letter } = S.addColor(s, '#00ff00'); assert.equal(letter, 'c'); assert.equal(s2.palette.c, '#00ff00');
  const painted = S.setPixel(s2, 0, 0, 0, 'c'); assert.deepEqual([...S.usedLetters(painted)], ['c']);
  assert.equal(S.setColor(painted, 'c', '#123456').palette.c, '#123456'); assert.equal(S.setColor(painted, 'z', '#fff'), painted);
  const removed = S.removeColor(painted, 'c'); assert.equal(removed.palette.c, undefined); assert.equal(removed.frames[0][0], '....'); assert.equal(S.problemWith(removed), null); assert.equal(S.removeColor(painted, 'z'), painted);
  const full = S.newSprite(2, 2, Array(62).fill('#000000')); assert.equal(S.freeLetter(full), null); assert.equal(S.addColor(full, '#fff').letter, null);
  s = S.newSprite(2, 2); assert.equal(S.freeLetter(s), 'i');
});

test('sprite files: written as a module holding JSON, read back exactly, and the kit can use what the painter writes', () => {
  let s = S.newSprite(6, 4); s = S.paintPoints(s, 0, [[1, 1], [2, 1], [3, 2]], 'c'); s = S.addFrame(s, 0); s = S.setAnimation(s, 'blink', [0, 1], 6);
  const text = S.serializeSprite(s);
  assert.match(text, /^\/\/ Made with the studio's sprite painter/); assert.match(text, /export default \{/); assert.ok(text.split('\n').length > 20, 'readable, not one line');
  assert.deepEqual(S.parseSprite(text), s); assert.equal(spriteProblem(S.parseSprite(text)), null);
  const asModule = 'data:text/javascript,' + encodeURIComponent(text); return import(asModule).then((m) => assert.deepEqual(m.default, s, 'a real import gives the same sprite'));
});

test('a sprite file that was edited wrongly gives a message the student can act on', () => {
  assert.throws(() => S.parseSprite('const x = 1;'), /export default/); assert.throws(() => S.parseSprite('export default { w: 4 };'), /plain JSON/);
  assert.throws(() => S.parseSprite('export default {"w":2,"h":2,"palette":{},"frames":[["zz","zz"]]};'), /not in the palette/); assert.throws(() => S.parseSprite(''), /export default/); assert.throws(() => S.parseSprite(undefined), /export default/);
  assert.equal(S.parseSprite('export default {"w":1,"h":1,"palette":{"a":"#fff"},"frames":[["a"]]}').animations !== undefined, true, 'a missing animations list is added');
});

test('undo and redo: every change is a step, going back and then painting forgets the redo, the list is bounded', () => {
  const h = new S.History(tiny()); assert.equal(h.canUndo, false); let s = h.current;
  s = S.setPixel(s, 0, 0, 0, 'b'); assert.equal(h.push(s), true); assert.equal(h.push(s), false, 'no change, no step');
  s = S.setPixel(s, 0, 1, 0, 'b'); h.push(s); assert.equal(h.current.frames[0][0], 'bb..');
  assert.equal(h.undo().frames[0][0], 'b...'); assert.equal(h.undo().frames[0][0], '....'); assert.equal(h.undo().frames[0][0], '....'); assert.equal(h.canUndo, false);
  assert.equal(h.redo().frames[0][0], 'b...'); h.push(S.setPixel(h.current, 0, 3, 2, 'b')); assert.equal(h.canRedo, false, 'painting after undo forgets the redo');
  const small = new S.History(tiny(), 5); for (let i = 0; i < 20; i++) small.push(S.setPixel(small.current, 0, i % 4, i % 3, i % 2 ? 'b' : '.'.repeat(1))); assert.ok(small.items.length <= 5);
});

// ---------- levels ----------
const LEVEL_FILE = `import { loadMap } from '@engine/arcade';
const LEVEL = [
  '#####',
  '#.o@#',
  '#####',
];
const OTHER = ['abc', 'def'];
export function create(game) {
  loadMap(game, LEVEL, {
    '#': { kind: 'wall', color: '#3b4a6b' },
    o: { kind: 'coin', emoji: '🪙' },
    "@": { kind: 'hero', w: 24, h: 30, color: '#5ac8ff' },
  });
}
`;

test('levels are found in code: lists of equal rows that look like a level, with their legend', () => {
  const found = L.findLevels(LEVEL_FILE); assert.equal(found.length, 1, 'OTHER is not a level'); assert.equal(found[0].name, 'LEVEL'); assert.deepEqual(found[0].rows, ['#####', '#.o@#', '#####']);
  assert.equal(found[0].quote, "'"); assert.equal(found[0].indent, '  '); assert.deepEqual(L.findLevels('const A = ["###", "#@"]'), [], 'ragged rows'); assert.deepEqual(L.findLevels(''), []);
  const legend = L.legendOf(LEVEL_FILE); assert.deepEqual(legend.map((e) => e.ch), ['#', 'o', '@']);
  assert.equal(legend[0].kind, 'wall'); assert.equal(legend[0].color, '#3b4a6b'); assert.equal(legend[1].emoji, '🪙'); assert.equal(legend[2].kind, 'hero'); assert.deepEqual(L.legendOf('nothing here'), []);
  const real = TEMPLATES.hero.files['src/main.js']; assert.equal(L.findLevels(real).length, 1); assert.deepEqual(L.legendOf(real).map((e) => e.ch), ['#', 'o', '@']);
});

test('changing a level: tiles, fills, size and a border, and writing it back without touching anything else', () => {
  const rows = ['#####', '#...#', '#####'];
  assert.deepEqual(L.setTile(rows, 2, 1, 'o'), ['#####', '#.o.#', '#####']); assert.equal(L.setTile(rows, 2, 1, '.'), rows); assert.equal(L.setTile(rows, 9, 1, 'o'), rows); assert.equal(L.setTile(rows, 1, -1, 'o'), rows);
  assert.deepEqual(L.fillTiles(['...', '.#.', '...'], 0, 0, 'x'), ['xxx', 'x#x', 'xxx']); assert.deepEqual(L.fillTiles(['..#', '..#'], 0, 0, 'x'), ['xx#', 'xx#']); assert.equal(L.fillTiles(rows, 0, 0, '#'), rows);
  assert.deepEqual(L.resizeRows(rows, 7, 4), ['#####..', '#...#..', '#####..', '.......']); assert.deepEqual(L.resizeRows(rows, 3, 3), ['###', '#..', '###']); assert.equal(L.resizeRows(rows, 2, 3), rows);
  assert.deepEqual(L.border(['...', '...', '...'], '#'), ['###', '#.#', '###']);
  const edited = L.writeLevel(LEVEL_FILE, 'LEVEL', ['#######', '#.o..@#', '#######']);
  assert.ok(edited.includes("  '#######',\n  '#.o..@#',") && edited.includes("const OTHER = ['abc', 'def'];") && edited.includes("o: { kind: 'coin'"), 'only the rows changed');
  assert.deepEqual(L.findLevels(edited)[0].rows, ['#######', '#.o..@#', '#######']); assert.equal(L.writeLevel(LEVEL_FILE, 'NOPE', ['a']), LEVEL_FILE);
  const twice = L.writeLevel(edited, 'LEVEL', ['#####', '#.o@#', '#####']); assert.equal(twice, LEVEL_FILE, 'writing the old rows back gives the old file');
});

test('a level is checked before it is saved: a start, equal rows, letters the legend knows', () => {
  assert.deepEqual(L.warnings(['###', '#@#', '###']), []); assert.match(L.warnings(['###', '#.#', '###'])[0], /no start/); assert.match(L.warnings(['@@@', '###'])[0], /more than one/);
  assert.match(L.warnings(['###', '#@', '###']).join(), /same length/);
  assert.deepEqual(L.unknownLetters(['#o?', '.@x'], L.legendOf(LEVEL_FILE)), ['?', 'x']);
});

// ---------- sounds ----------
test('sound recipes: presets, edits kept in range, layers added and removed, and the kit plays everything the maker can make', () => {
  for (const name of Object.keys(D.PRESETS)) { assert.ok(cleanSound(D.preset(name)), `${name} is a recipe the kit accepts`); assert.ok(synthesize(D.preset(name)).data.length > 0); }
  let s = D.newSound(); assert.ok(cleanSound(s));
  s = D.setLayerValue(s, 0, 'freq', 99999); assert.equal(s.layers[0].freq, 8000); s = D.setLayerValue(s, 0, 'gain', -3); assert.equal(s.layers[0].gain, 0); s = D.setLayerValue(s, 0, 'wave', 'saw'); assert.equal(s.layers[0].wave, 'saw');
  assert.equal(D.setLayerValue(s, 0, 'wave', 'evil').layers[0].wave, 'saw'); assert.equal(D.setLayerValue(s, 0, 'nope', 1), s); assert.equal(D.setLayerValue(s, 7, 'freq', 1), s); assert.equal(D.setLayerValue(s, 0, 'freq', NaN), s);
  s = D.setLayerValue(s, 0, 'freqEnd', 100); assert.equal(D.clearLayerValue(s, 0, 'freqEnd').layers[0].freqEnd, undefined);
  for (let i = 0; i < 12; i++) s = D.addLayer(s, 'noise'); assert.equal(s.layers.length, 8); while (s.layers.length > 1) s = D.removeLayer(s, 0); assert.equal(D.removeLayer(s, 0), s, 'never the last layer');
  assert.equal(D.setDuration(s, 99).duration, 3); assert.equal(D.setDuration(s, 0).duration, 0.05); assert.equal(D.setDuration(s, 'x'), s);
});

test('"surprise me" is repeatable and always makes a sound the kit will play', () => {
  const base = D.preset('coin'); const a = D.mutate(base, 7); const b = D.mutate(base, 7); assert.deepEqual(a, b); assert.notDeepEqual(a, D.mutate(base, 8)); assert.deepEqual(D.preset('coin'), base, 'the original is untouched');
  for (let seed = 1; seed <= 200; seed++) { const m = D.mutate(D.preset(Object.keys(D.PRESETS)[seed % 8]), seed, 1); assert.ok(cleanSound(m), `seed ${seed}`); assert.ok(m.duration >= 0.05 && m.duration <= 3); assert.ok(synthesize(m).data.length > 0); }
});

test('the sounds file: written as a module holding JSON, read back, refused when damaged, names kept free', () => {
  const all = { coin: D.preset('coin'), jump: D.preset('jump') };
  const text = D.serializeSounds(all); assert.match(text, /export default \{/); assert.deepEqual(D.parseSounds(text), all);
  return import('data:text/javascript,' + encodeURIComponent(text)).then((m) => {
    assert.deepEqual(m.default, all);
    assert.throws(() => D.parseSounds('const x = 1'), /export default/); assert.throws(() => D.parseSounds('export default { oops'), /plain JSON/); assert.throws(() => D.parseSounds('export default []'), /object of named sounds/);
    assert.throws(() => D.parseSounds('export default {"9bad": {"layers":[{}]}}'), /not a usable recipe/); assert.throws(() => D.parseSounds('export default {"a": {"layers":[]}}'), /not a usable recipe/);
    assert.equal(D.freeName(all, 'coin'), 'coin2'); assert.equal(D.freeName(all, 'boom'), 'boom'); assert.equal(D.freeName(all, '9 !!'), 'sound'); assert.equal(D.freeName({ ...all, coin2: 1 }, 'coin'), 'coin3');
    assert.deepEqual(D.outline(new Float32Array([0, 0.5, -1, 0.2]), 2), [0.5, 1]); assert.deepEqual(D.outline([], 5), []);
  });
});
