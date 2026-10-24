import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../app/paint/scene-model.js';
import { History } from '../app/paint/sprite-model.js';
import { newGame, loadScene, all } from '../../packages/arcade/src/index.js';

const base = () => {
  let s = M.newScene(480, 320);
  s = M.addThing(s, 'wall', 0, 288, { w: 480, h: 32, color: '#3b4a6b' });
  s = M.addThing(s, 'coin', 100, 60, { w: 16, h: 16, color: '#ffd23c' });
  s = M.addThing(s, 'coin', 140, 60);
  return s;
};

test('a scene is a file: it round-trips through its text, and a bad file says what is wrong', () => {
  const s = base();
  assert.equal(M.problemWith(s), null);
  const text = M.serializeScene(s);
  assert.ok(text.startsWith('// Made with the studio'));
  assert.equal(text.split('\n').filter((l) => l.startsWith('    {')).length, 3, 'one thing a line');
  assert.deepEqual(M.parseScene(text), s);
  assert.deepEqual(M.parseScene(M.serializeScene(M.newScene())), M.newScene());
  assert.throws(() => M.parseScene('const x = 1;'), /not a scene/);
  assert.throws(() => M.parseScene('export default {nope'), /plain JSON/);
  assert.throws(() => M.parseScene('export default {"w":480,"h":320,"things":[{"kind":"a b","x":0,"y":0,"w":1,"h":1}]}'), /thing 1: a thing needs a kind/);
  assert.throws(() => M.parseScene('export default {"w":10,"h":320,"things":[]}'), /w must be a whole number/);
  assert.match(M.problemWith({ w: 100, h: 100, things: [{ kind: 'a', x: 0, y: 0, w: 5, h: 5, image: '../x.png' }] }), /image/);
  assert.match(M.problemWith({ w: 100, h: 100, things: [{ kind: 'a', x: 0, y: 0, w: 0, h: 5 }] }), /w must be a number above 0/);
  assert.match(M.problemWith({ w: 100, h: 100, things: [{ kind: 'a', x: 0, y: 0, w: 5, h: 5, color: 'url(x)' }] }), /color/);
});

test('a new thing takes the look of the last one of its kind, or is a plain square', () => {
  const s = base();
  assert.deepEqual(s.things[2], { kind: 'coin', x: 140, y: 60, w: 16, h: 16, color: '#ffd23c' });
  const plain = M.addThing(M.newScene(), 'hero', 10.6, 20.2);
  assert.deepEqual(plain.things[0], { kind: 'hero', x: 11, y: 20, w: 32, h: 32, color: '#5ac8ff' });
  assert.equal(M.problemWith(plain), null);
});

test('moving and nudging snap to the grid; changing a field to something invalid is ignored', () => {
  const s = base();
  assert.deepEqual(M.moveThing(s, 1, 13, 9, 16).things[1], { kind: 'coin', x: 112, y: 64, w: 16, h: 16, color: '#ffd23c' });
  assert.equal(M.moveThing(s, 1, 3, 3, 0).things[1].x, 103);
  assert.equal(M.moveThing(s, 9, 1, 1), s, 'nothing at that place');
  assert.equal(M.setThing(s, 1, { w: -4 }), s);
  assert.equal(M.setThing(s, 1, { kind: 'no way' }), s);
  assert.equal(M.setThing(s, 1, { color: 'javascript:1' }), s);
  const imaged = M.setThing(s, 1, { image: 'assets/coin.png', extra: { value: 5 } });
  assert.equal(imaged.things[1].image, 'assets/coin.png');
  const cleared = M.setThing(imaged, 1, { image: '', extra: {} });
  assert.deepEqual(Object.keys(cleared.things[1]).sort(), ['color', 'h', 'kind', 'w', 'x', 'y']);
  assert.equal(s.things[1].image, undefined, 'the scene you gave is never changed');
});

test('dragging a handle resizes from that side and never makes a thing smaller than a pixel', () => {
  const r = { x: 10, y: 10, w: 40, h: 20 };
  assert.deepEqual(M.resizeRect(r, 'se', 10, 5), { x: 10, y: 10, w: 50, h: 25 });
  assert.deepEqual(M.resizeRect(r, 'nw', 4, 6), { x: 14, y: 16, w: 36, h: 14 });
  assert.deepEqual(M.resizeRect(r, 'e', -100, 0), { x: 10, y: 10, w: 1, h: 20 });
  assert.deepEqual(M.resizeRect(r, 'n', 0, 100), { x: 10, y: 29, w: 40, h: 1 });
  assert.deepEqual(M.resizeRect(r, 'se', 3, 3, 16), { x: 10, y: 10, w: 38, h: 22 }, 'the moved edge goes onto the grid');
  const t = { x: 10, y: 10, w: 40, h: 20 };
  assert.equal(M.handleAt(t, 50, 30), 'se');
  assert.equal(M.handleAt(t, 30, 10), 'n');
  assert.equal(M.handleAt(t, 10, 20), 'w');
  assert.equal(M.handleAt(t, 30, 20), null, 'the middle is not a handle');
  assert.equal(M.handleAt(null, 1, 1), null);
});

test('picking: the topmost thing under a point wins; duplicate, reorder and delete', () => {
  let s = M.addThing(base(), 'box', 100, 60, { w: 40, h: 40 });
  assert.equal(M.hitTest(s, 105, 65), 3, 'the box is on top of the coin');
  assert.equal(M.hitTest(s, 101, 61), 3);
  assert.equal(M.hitTest(s, 10, 300), 0);
  assert.equal(M.hitTest(s, 400, 10), -1);
  assert.equal(M.hitTest(s, 140, 100), -1, 'the right and bottom edges are outside');
  const d = M.duplicateThing(s, 1);
  assert.equal(d.index, 4);
  assert.deepEqual([d.scene.things[4].x, d.scene.things[4].y, d.scene.things[4].kind], [116, 76, 'coin']);
  const up = M.reorderThing(s, 1, 1);
  assert.equal(up.index, 2);
  assert.equal(up.scene.things[2].x, 100);
  assert.equal(M.reorderThing(s, 0, -1).index, 0);
  s = M.removeThing(s, 3);
  assert.equal(s.things.length, 3);
  assert.equal(M.removeThing(s, 99), s);
});

test('kinds, warnings, resizing the scene, the code to load it and the extra-fields box', () => {
  let s = base();
  assert.deepEqual(M.kindsOf(s), [{ kind: 'coin', count: 2 }, { kind: 'wall', count: 1 }]);
  s = M.addThing(s, 'coin', 140, 60);
  s = M.addThing(s, 'coin', -500, 0);
  assert.deepEqual(M.warnings(s), ['coin 4 is exactly on top of coin 3', 'coin 5 is completely outside the scene']);
  assert.deepEqual([M.resizeScene(s, 640, 360).w, M.resizeScene(s, 10, 360).w], [640, 480]);
  assert.match(M.usageCode('scenes/level-one.js', s), /import levelOne from '\.\.\/scenes\/level-one\.js'[\s\S]*loadScene\(game, levelOne\)/);
  assert.deepEqual(M.sceneFiles(['src/main.js', 'scenes/b.js', 'scenes/a.js', 'scenes/x.json', 'scenes/deep/c.js']), ['scenes/a.js', 'scenes/b.js']);
  assert.deepEqual(M.parseExtra(''), { value: undefined });
  assert.deepEqual(M.parseExtra('{"vx": 40}'), { value: { vx: 40 } });
  assert.match(M.parseExtra('{nope').error, /JSON/);
  assert.match(M.parseExtra('[1]').error, /object/);
  assert.match(M.parseExtra('{"x": 4}').error, /own box/);
});

test('undo works on scenes, and the limit on things is kept', () => {
  const history = new History(M.newScene());
  let s = history.current;
  for (const x of [10, 50, 90]) { s = M.addThing(s, 'a', x, 0); history.push(s); }
  assert.equal(history.undo().things.length, 2);
  assert.equal(history.redo().things.length, 3);
  let big = M.newScene();
  for (let i = 0; i < M.SCENE_LIMITS.things + 5; i++) big = M.addThing(big, 'a', i, 0);
  assert.equal(big.things.length, M.SCENE_LIMITS.things);
});

test('a scene made here is a scene a game can load: things appear where they were placed', () => {
  const s = M.setThing(base(), 2, { extra: { value: 5, vx: 20 } });
  const game = newGame();
  const world = loadScene(game, M.parseScene(M.serializeScene(s)));
  assert.deepEqual([world.width, world.height, world.things.length], [480, 320, 3]);
  assert.deepEqual(all(game, 'coin').map((t) => [t.x, t.y, t.w, t.value ?? 0, t.vx]), [[100, 60, 16, 0, 0], [140, 60, 16, 5, 20]]);
});
