import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as K from '../app/paint/kinds-model.js';
import * as F from '../app/paint/scene-fields.js';
import { sceneFieldProblems, loadSceneCheck } from './kinds-helpers.js';

const table = () => ({ ...K.addKind(K.addKind({}, 'door', 'door'), 'button', 'button') });

test('every starter is a kind the kit accepts, and the table writes out and reads back the same', () => {
  let t = {};
  for (const name of Object.keys(K.STARTERS)) t = K.addKind(t, name, name);
  assert.deepEqual(K.kindProblems(t), []);
  assert.deepEqual(K.parseKinds(K.serializeKinds(t)), t);
});

test('kinds are added with free names and taken away', () => {
  let t = K.addKind({}, 'door');
  assert.deepEqual(Object.keys(t.door.fields), []);
  assert.throws(() => K.addKind(t, 'door'), /already a kind/);
  assert.throws(() => K.addKind(t, '9x'), /Use letters/);
  assert.equal(K.freeName(t, 'door'), 'door2');
  assert.equal(K.freeName(t, '9 lives!'), 'lives');
  t = K.removeKind(t, 'door');
  assert.deepEqual(t, {});
});

test('a template can change, and an empty value takes that part out', () => {
  let t = K.addKind({}, 'door', 'door');
  t = K.setTemplate(t, 'door', { w: 40, emoji: '🚪', color: '' });
  assert.deepEqual(t.door.template, { w: 40, h: 48, emoji: '🚪' });
  assert.throws(() => K.setTemplate(t, 'door', { speed: 3 }), /not part of a template/);
  assert.equal(K.setTemplate(t, 'door', { w: -5 }).door.template.w, undefined, 'a size that is not allowed is dropped');
});

test('fields are added, changed, moved and removed, always kept to what the kit accepts', () => {
  let t = K.addKind({}, 'enemy');
  t = K.addField(t, 'enemy', 'hp', 'number');
  t = K.addField(t, 'enemy', 'mood', 'choice');
  assert.deepEqual(Object.keys(t.enemy.fields), ['hp', 'mood']);
  assert.throws(() => K.addField(t, 'enemy', 'hp', 'text'), /already/);
  assert.throws(() => K.addField(t, 'enemy', 'x', 'text'), /already "x"|Every thing already has/);
  assert.throws(() => K.addField(t, 'enemy', '9a', 'text'), /Use a name/);
  assert.throws(() => K.addField(t, 'enemy', 'foo', 'sparkle'), /no type/);
  t = K.setField(t, 'enemy', 'hp', { min: 1, max: 9, default: 50 });
  assert.deepEqual([t.enemy.fields.hp.min, t.enemy.fields.hp.max, t.enemy.fields.hp.default], [1, 9, 9]);
  t = K.setField(t, 'enemy', 'mood', { choices: 'calm, angry,  ,asleep', default: 'angry' });
  assert.deepEqual(t.enemy.fields.mood.choices, ['calm', 'angry', 'asleep']);
  assert.equal(t.enemy.fields.mood.default, 'angry');
  t = K.setField(t, 'enemy', 'hp', { type: 'text' });
  assert.deepEqual(t.enemy.fields.hp, { type: 'text', default: '' }, 'changing the type drops the old settings');
  t = K.moveField(t, 'enemy', 'mood', -1);
  assert.deepEqual(Object.keys(t.enemy.fields), ['mood', 'hp']);
  t = K.removeField(t, 'enemy', 'mood');
  assert.deepEqual(Object.keys(t.enemy.fields), ['hp']);
});

test('placement gives what a new thing of a kind starts with', () => {
  const t = table();
  assert.deepEqual(K.placement(t, 'door'), { w: 32, h: 48, color: '#c8a064', extra: { locked: true } });
  assert.deepEqual(K.placement(t, 'button').extra, { delay: 0 }, 'a pointer starts with nothing');
  assert.deepEqual(K.placement(t, 'ghost'), {});
});

test('a hand-edited file is cleaned, and a broken one is explained', () => {
  const t = K.parseKinds('export default { "a": { "fields": { "x": { "type": "flag" }, "ok": { "type": "number", "default": 99, "max": 5 } } }, "9b": {} };');
  assert.deepEqual(Object.keys(t), ['a']);
  assert.deepEqual(Object.keys(t.a.fields), ['ok']);
  assert.equal(t.a.fields.ok.default, 5);
  assert.throws(() => K.parseKinds('nope'), /not a set of kinds/);
  assert.throws(() => K.parseKinds('export default { x };'), /plain JSON/);
  assert.throws(() => K.parseKinds('export default [1];'), /object of named kinds/);
});

// ---- the scene's side: names, values, pointers ----

const scene = () => ({
  w: 480, h: 320, things: [
    { kind: 'door', x: 0, y: 0, w: 32, h: 48, extra: { name: 'front', locked: true } },
    { kind: 'button', x: 50, y: 0, w: 24, h: 12, extra: { name: 'b1', opens: 'front' } },
    { kind: 'button', x: 90, y: 0, w: 24, h: 12 },
  ],
});

test('a thing can be named, names cannot repeat, and renaming a thing keeps the pointers to it', () => {
  const kinds = table();
  assert.equal(F.nameOf(scene().things[0]), 'front');
  assert.match(F.nameProblem(scene(), 2, 'front'), /already called/);
  assert.equal(F.nameProblem(scene(), 0, 'front'), null, 'a thing may keep its own name');
  assert.match(F.nameProblem(scene(), 2, '9x'), /letters/);
  assert.equal(F.freeThingName(scene(), 'front'), 'front2');
  const renamed = F.setName(scene(), 0, 'gate', kinds);
  assert.equal(F.nameOf(renamed.things[0]), 'gate');
  assert.equal(renamed.things[1].extra.opens, 'gate', 'the button now points at gate');
  const cleared = F.setName(scene(), 0, '', kinds);
  assert.equal(cleared.things[0].extra.name, undefined);
  assert.equal(cleared.things[1].extra.opens, undefined, 'a pointer to a thing that lost its name is cleared');
  assert.throws(() => F.setName(scene(), 2, 'front', kinds), /already called/);
  assert.equal(F.setName(scene(), 2, 'b3', kinds).things[2].extra.name, 'b3');
  assert.equal(scene().things[0].extra.name, 'front', 'the original is untouched');
});

test('a field value is made to fit, shown with its default, and a pointer lists only what it may point at', () => {
  const kinds = table();
  let s = F.setFieldValue(scene(), 2, kinds, 'delay', 99);
  assert.equal(s.things[2].extra.delay, 10);
  assert.equal(F.fieldValue(s.things[2], kinds, 'delay'), 10);
  assert.equal(F.fieldValue(scene().things[2], kinds, 'delay'), 0, 'the default when it has none');
  assert.equal(F.fieldValue(scene().things[2], kinds, 'opens'), '');
  s = F.setFieldValue(s, 2, kinds, 'opens', 'front');
  assert.equal(s.things[2].extra.opens, 'front');
  s = F.setFieldValue(s, 2, kinds, 'opens', '');
  assert.equal(s.things[2].extra.opens, undefined);
  assert.throws(() => F.setFieldValue(scene(), 2, kinds, 'speed', 1), /no field called/);
  assert.deepEqual(F.targetsFor(scene(), 2, kinds.button.fields.opens), ['front'], 'only doors, and only named ones');
  assert.deepEqual(F.targetsFor(scene(), 1, { type: 'ref', to: '' }), ['front']);
});

test('the lines to draw go from a thing to what its pointers point at', () => {
  const kinds = table();
  assert.deepEqual(F.linksFrom(scene(), 1, kinds), [{ from: 1, to: 0, field: 'opens' }]);
  assert.deepEqual(F.linksFrom(scene(), 2, kinds), []);
  assert.deepEqual(F.linksFrom(scene(), 0, kinds), []);
});

test('the scene checker and the loader agree', () => {
  const kinds = table();
  assert.deepEqual(sceneFieldProblems(scene(), kinds), []);
  assert.equal(loadSceneCheck(scene(), kinds).opensFront, true);
});

test('placing or copying a thing never copies its name, so two things never share one', async () => {
  const SM = await import('../app/paint/scene-model.js');
  const s = { w: 480, h: 320, things: [{ kind: 'door', x: 0, y: 0, w: 32, h: 48, extra: { name: 'front', locked: true } }] };
  const placed = SM.addThing(s, 'door', 100, 100);
  assert.deepEqual(placed.things[1].extra, { locked: true }, 'the look and fields are copied, the name is not');
  const copied = SM.duplicateThing(s, 0).scene;
  assert.deepEqual(copied.things[1].extra, { locked: true });
  const named = { w: 480, h: 320, things: [{ kind: 'door', x: 0, y: 0, w: 32, h: 48, extra: { name: 'front' } }] };
  assert.equal('extra' in SM.addThing(named, 'door', 5, 5).things[1], false, 'a thing with only a name copies to a thing with no extra at all');
  assert.match(SM.usageCode('scenes/rooms.js', s, true), /import kinds from '\.\/kinds\.js'[\s\S]*loadScene\(game, rooms, kinds\)/);
  assert.doesNotMatch(SM.usageCode('scenes/rooms.js', s), /kinds/);
});
