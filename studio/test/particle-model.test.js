import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../app/paint/particle-model.js';
import { newGame, all } from '../../packages/arcade/src/things.js';
import { emit, stream } from '../../packages/arcade/src/particles.js';
import { effects } from '../../packages/arcade/src/effects.js';

test('every preset is a clean recipe, nothing is changed by the kit\'s check, and it plays: bursts make particles, streams make them at the rate, and they all go in the end', () => {
  for (const name of Object.keys(P.PRESETS)) {
    const e = P.preset(name);
    assert.deepEqual(P.recipeProblems(e), [], name);
    const { use, ...settings } = e;
    assert.ok(use === 'emit' || use === 'stream');
    assert.deepEqual(P.cleanRecipe(e), settings, `${name}: already in range`);
    const g = newGame();
    if (e.use === 'stream') for (let i = 0; i < 60; i++) { stream(g, e, 100, 100, 1 / 60); effects(g, 1 / 60); } else emit(g, e, 100, 100);
    assert.ok(all(g, 'spark').length > 0, `${name} makes particles`);
    for (let i = 0; i < 600 && all(g, 'spark').length; i++) effects(g, 1 / 60);
    assert.equal(all(g, 'spark').length, 0, `${name} ends`);
  }
  assert.ok(Object.keys(P.PRESETS).length >= 10);
});

test('an effects file is saved and read back exactly, a damaged one is explained, and loose numbers are put in range on reading', () => {
  const effects2 = { fire: P.preset('fire'), boom: P.preset('explosion') };
  const text = P.serializeParticles(effects2);
  assert.match(text, /^\/\/ Made with the studio/);
  assert.deepEqual(P.parseParticles(text), effects2);
  assert.throws(() => P.parseParticles('x'), /not a set of effects/);
  assert.throws(() => P.parseParticles('export default { nope };'), /plain JSON/);
  assert.throws(() => P.parseParticles('export default { "bad name": {} };'), /not usable/);
  assert.throws(() => P.parseParticles('export default { "a": [] };'), /not usable/);
  const loose = P.parseParticles('export default { "a": { "count": 99999, "use": "stream" } };');
  assert.equal(loose.a.count, 200);
  assert.equal(loose.a.use, 'stream');
  assert.deepEqual(Object.keys(loose.a).sort(), Object.keys(P.newEffect()).sort(), 'every field is filled in');
});

test('numbers and pairs are set within limits; life and speed keep their order; size may shrink', () => {
  let e = P.newEffect();
  e = P.setValue(e, 'count', 5000);
  assert.equal(e.count, 200);
  e = P.setValue(e, 'angle', -45);
  assert.equal(e.angle, -45);
  e = P.setPair(e, 'life', 0, 3);
  assert.deepEqual(e.life, [3, 3], 'the shortest cannot pass the longest: the longest comes with it');
  e = P.setPair(e, 'life', 1, 1);
  assert.deepEqual(e.life, [1, 1]);
  e = P.setPair(e, 'size', 1, 20);
  assert.deepEqual(e.size, [4, 20]);
  e = P.setPair(e, 'size', 0, 30);
  assert.deepEqual(e.size, [30, 20], 'size may go either way');
  assert.equal(e.use, 'emit', 'the use stays');
  assert.equal(P.setShape(e, 'circle').shape, 'circle');
  assert.equal(P.setShape(e, 'star').shape, 'square');
  assert.equal(P.setFade(e, false).fade, false);
  assert.equal(P.setUse(e, 'stream').use, 'stream');
});

test('colors: added (up to six), changed, removed (one always stays)', () => {
  let e = P.newEffect();
  assert.deepEqual(e.colors, ['#ffd23c']);
  e = P.addColor(e, '#ff0000');
  e = P.setColor(e, 0, '#00ff00');
  assert.deepEqual(e.colors, ['#00ff00', '#ff0000']);
  for (let i = 0; i < 10; i++) e = P.addColor(e, '#0000ff');
  assert.equal(e.colors.length, 6);
  e = P.removeColor(e, 0);
  assert.equal(e.colors[0], '#ff0000');
  const one = P.removeColor(P.newEffect(), 0);
  assert.equal(one.colors.length, 1);
});

test('"surprise me" gives a different, valid effect, the same one for the same number, and keeps the use', () => {
  const base = P.preset('fire');
  const a = P.mutate(base, 1);
  assert.notDeepEqual(a, base);
  assert.deepEqual(a, P.mutate(base, 1));
  assert.notDeepEqual(a, P.mutate(base, 2));
  for (let seed = 1; seed <= 30; seed++) {
    const m = P.mutate(base, seed, 1);
    assert.deepEqual(P.recipeProblems(m), [], `seed ${seed}`);
    assert.ok(m.life[0] <= m.life[1] && m.speed[0] <= m.speed[1]);
    assert.equal(m.colors.length, base.colors.length);
    assert.equal(m.use, 'stream');
  }
});

test('names: free ones are found and bad ones are explained', () => {
  assert.equal(P.freeName({ fire: 1 }, 'fire'), 'fire2');
  assert.equal(P.freeName({}, '1 bad'), 'bad');
  assert.match(P.nameProblem('1x', () => false), /Use letters/);
  assert.match(P.nameProblem('fire', (n) => n === 'fire'), /already/);
  assert.equal(P.nameProblem('fire', () => false), null);
});

test('every control has a sane range that matches the kit, and a pair control has two names', () => {
  for (const f of P.FIELDS) {
    assert.ok(f.min < f.max && f.step > 0 && f.label, f.key);
    if (f.pair) assert.equal(f.names.length, 2);
    const e = P.setValue(P.newEffect(), f.key, f.max * 10);
    if (!f.pair) assert.ok(e[f.key] <= f.max, f.key);
  }
});
