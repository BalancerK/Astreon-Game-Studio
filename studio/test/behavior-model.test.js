import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as B from '../app/paint/behavior-model.js';
import { newGame, spawn, all } from '../../packages/arcade/src/things.js';
import { behaviors, behave } from '../../packages/arcade/src/behaviors.js';

test('every starter kind is clean by the kit\'s check and runs for ten seconds without trouble', () => {
  for (const [name, make] of Object.entries(B.STARTERS)) {
    const list = make();
    assert.deepEqual(B.behaviorProblems(list), [], name);
    assert.ok(list.length >= 1 && list.every((b) => b.type in B.BEHAVIORS));
  }
  const table = Object.fromEntries(Object.entries(B.STARTERS).map(([k, make]) => [k, make()]));
  behaviors(table);
  const g = newGame();
  spawn(g, 'hero', { x: 240, y: 160, w: 20, h: 20 });
  for (const kind of ['enemy', 'coin', 'turret', 'bouncer', 'ghost']) spawn(g, kind, { x: 60 + Math.random() * 0, y: 60, w: 20, h: 20 });
  assert.doesNotThrow(() => { for (let i = 0; i < 600; i++) behave(g, 1 / 60); });
  assert.ok(all(g).every((t) => Number.isFinite(t.x) && Number.isFinite(t.y)), 'nothing ended up lost');
});

test('a behaviours file is saved and read back exactly, cleaned on reading, and a damaged one is explained', () => {
  const table = { enemy: B.STARTERS.enemy(), coin: B.STARTERS.coin() };
  const text = B.serializeBehaviors(table);
  assert.match(text, /^\/\/ Made with the studio/);
  assert.deepEqual(B.parseBehaviors(text), table);
  assert.throws(() => B.parseBehaviors('x'), /not a set of behaviours/);
  assert.throws(() => B.parseBehaviors('export default { nope };'), /plain JSON/);
  assert.throws(() => B.parseBehaviors('export default { "a b": [] };'), /not usable/);
  assert.throws(() => B.parseBehaviors('export default { "a": {} };'), /not usable/);
  const loose = B.parseBehaviors('export default { "a": [{ "type": "pace", "speed": 99999 }, { "type": "bogus" }, 5] };');
  assert.deepEqual(loose.a.map((b) => b.type), ['pace']);
  assert.equal(loose.a[0].speed, 600);
});

test('behaviours are added with their starting settings (up to twelve), removed, reordered, and settings stay in range', () => {
  let list = [];
  list = B.addBehavior(list, 'shoot');
  assert.equal(list[0].every, 1);
  list = B.addBehavior(list, 'health');
  list = B.moveBehavior(list, 1, -1);
  assert.deepEqual(list.map((b) => b.type), ['health', 'shoot']);
  assert.equal(B.moveBehavior(list, 0, -1), list, 'cannot go above the top');
  list = B.setParam(list, 1, 'every', 99999);
  assert.equal(list[1].every, 20);
  list = B.setParam(list, 1, 'aim', 'up');
  assert.equal(list[1].aim, 'up');
  list = B.setParam(list, 1, 'aim', 'sideways');
  assert.equal(list[1].aim, 'right', 'a choice that is not one of the choices is put back');
  list = B.setParam(list, 0, 'removeAtZero', false);
  assert.equal(list[0].removeAtZero, false);
  list = B.removeBehavior(list, 0);
  assert.deepEqual(list.map((b) => b.type), ['shoot']);
  let many = [];
  for (let i = 0; i < 12; i++) many = B.addBehavior(many, 'lifetime');
  assert.throws(() => B.addBehavior(many, 'lifetime'), /At most 12/);
});

test('names, summaries and the kinds a list points at', () => {
  assert.equal(B.freeName({ enemy: [] }, 'enemy'), 'enemy2');
  assert.equal(B.freeName({}, '1 odd name!'), 'oddname');
  assert.match(B.nameProblem('1x', () => false), /Use letters/);
  assert.match(B.nameProblem('enemy', (n) => n === 'enemy'), /already/);
  assert.equal(B.summarize([]), 'nothing yet');
  assert.match(B.summarize(B.STARTERS.enemy()), /pace back and forth, follow something, has health, hurt on touch/);
  assert.deepEqual(B.mentions(B.STARTERS.turret()).sort(), ['bullet', 'hero']);
  assert.deepEqual(B.mentions([]), []);
});
