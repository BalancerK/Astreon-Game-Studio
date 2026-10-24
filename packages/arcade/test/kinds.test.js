import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newGame, spawn } from '../src/things.js';
import { loadScene } from '../src/map.js';
import {
  cleanField, cleanKinds, fieldDefaults, fitValue, named, refOf, kindProblems, sceneFieldProblems, FIELD_TYPES, isReservedField,
} from '../src/kinds.js';

const KINDS = {
  door: { template: { w: 32, h: 48, color: '#c8a064' }, fields: { locked: { type: 'flag', default: true }, label: { type: 'text',
    default: 'front door' } } },
  button: { fields: {
    opens: { type: 'ref', to: 'door' }, delay: { type: 'number', default: 1, min: 0, max: 10, step: 0.5 }, mode: { type: 'choice',
      choices: ['press', 'toggle'], default: 'press' },
  } },
};
const SCENE = {
  w: 480, h: 320, things: [
    { kind: 'door', x: 100, y: 50, w: 32, h: 48, extra: { name: 'front' } },
    { kind: 'button', x: 10, y: 10, w: 16, h: 16, extra: { opens: 'front', delay: 3 } },
    { kind: 'button', x: 10, y: 40, w: 16, h: 16 },
  ],
};

test('every type of field cleans to itself, with a default that fits', () => {
  for (const type of Object.keys(FIELD_TYPES)) {
    const clean = cleanField({ type });
    assert.equal(clean.type, type);
    assert.deepEqual(cleanField(clean), clean, `${type}: cleaning twice changes nothing`);
  }
  assert.equal(cleanField({ type: 'sparkle' }), null);
  assert.deepEqual(cleanField({ type: 'number', min: 5, max: 1, default: 99 }), { type: 'number', default: 5, min: 5, max: 5, step: 1 });
  assert.equal(cleanField({ type: 'number', min: 0, max: 10, default: 99 }).default, 10);
  assert.deepEqual(cleanField({ type: 'choice', choices: ['a', 'a', '', 7, 'b'], default: 'zzz' }), { type: 'choice', choices: ['a', 'b'],
    default: 'a' });
  assert.equal(cleanField({ type: 'ref', to: 'not valid!' }).to, '');
});

test('a kinds table is made safe: bad names, reserved field names and broken fields are dropped', () => {
  const clean = cleanKinds({ ...KINDS, '9bad': {}, ghost: null, odd: { template: { w: -3, h: 9, color: 4 }, fields: { x: { type: 'flag' },
    ok: { type: 'text' }, bad: { type: 'nope' } } } });
  assert.deepEqual(Object.keys(clean).sort(), ['button', 'door', 'odd']);
  assert.deepEqual(clean.odd.template, { h: 9 });
  assert.deepEqual(Object.keys(clean.odd.fields), ['ok']);
  assert.deepEqual(cleanKinds(cleanKinds(KINDS)), cleanKinds(KINDS));
  assert.deepEqual(cleanKinds(null), {});
  assert.equal(isReservedField('x'), true);
  assert.equal(isReservedField('locked'), false);
});

test('values are made to fit their field', () => {
  const f = cleanKinds(KINDS).button.fields;
  assert.equal(fitValue(f.delay, 99), 10);
  assert.equal(fitValue(f.delay, 'abc'), 1);
  assert.equal(fitValue(f.mode, 'nope'), 'press');
  assert.equal(fitValue(f.mode, 'toggle'), 'toggle');
  assert.equal(fitValue(cleanKinds(KINDS).door.fields.locked, 'true'), true);
  assert.equal(fitValue(cleanKinds(KINDS).door.fields.label, 5), '5');
  assert.equal(fitValue(f.opens, 7), '');
});

test('loadScene with kinds gives every thing its fields: the ones it has stay, the others start at their defaults', () => {
  const game = newGame();
  const { things } = loadScene(game, SCENE, KINDS);
  const [door, pressed, other] = things;
  assert.deepEqual([door.locked, door.label, door.name], [true, 'front door', 'front']);
  assert.deepEqual([pressed.delay, pressed.mode, pressed.opens], [3, 'press', 'front']);
  assert.deepEqual([other.delay, other.mode, other.opens], [1, 'press', undefined], 'a pointer starts with nothing');
  const plain = loadScene(newGame(), SCENE).things[1];
  assert.equal(plain.mode, undefined, 'without kinds nothing is added');
});

test('a pointer finds the thing it points at, and nothing if there is none', () => {
  const game = newGame();
  const { things } = loadScene(game, SCENE, KINDS);
  assert.equal(refOf(game, things[1], 'opens'), things[0]);
  assert.equal(refOf(game, things[2], 'opens'), undefined);
  assert.equal(named(game, 'front'), things[0]);
  assert.equal(named(game, ''), undefined);
  game.things = game.things.filter((t) => t !== things[0]);
  assert.equal(refOf(game, things[1], 'opens'), undefined, 'the door is gone');
  assert.equal(refOf(game, undefined, 'opens'), undefined);
  const g2 = newGame();
  spawn(g2, 'x', { name: 'a', w: 1, h: 1 });
  assert.equal(named(g2, 'a').kind, 'x');
});

test('kindProblems says what is wrong with the definitions', () => {
  assert.deepEqual(kindProblems(KINDS), []);
  const text = kindProblems({
    '9bad': {}, a: { fields: { x: { type: 'flag' }, 'bad name': { type: 'flag' }, t: { type: 'tele' }, n: { type: 'number', min: 5, max: 1 },
      c: { type: 'choice', choices: [] }, r: { type: 'ref', to: 'zzz' } } },
  }).map((p) => p.message).join(' | ');
  assert.match(text, /not a name for a kind/);
  assert.match(text, /already something every thing has/);
  assert.match(text, /not a name for a field/);
  assert.match(text, /no type the kit knows/);
  assert.match(text, /smallest above its largest/);
  assert.match(text, /nothing to choose from/);
  assert.match(text, /points at "zzz"/);
});

test('sceneFieldProblems finds pointers to nothing, to the wrong kind, repeated names and values out of range', () => {
  const kinds = cleanKinds(KINDS);
  assert.deepEqual(sceneFieldProblems(SCENE, kinds), []);
  const broken = JSON.parse(JSON.stringify(SCENE));
  broken.things[1].extra.opens = 'back';
  broken.things.push({ kind: 'button', x: 0, y: 0, w: 1, h: 1, extra: { name: 'front', opens: 'front', delay: 99, mode: 'zap' } });
  broken.things.push({ kind: 'button', x: 0, y: 0, w: 1, h: 1, extra: { opens: 'front' } });
  broken.things[2].extra = { name: 'b2' };
  broken.things[4].extra.opens = 'b2';
  const text = sceneFieldProblems(broken, kinds).map((p) => p.message).join(' | ');
  assert.match(text, /points at "back", but nothing/);
  assert.match(text, /has the name "front", which thing 1 has too/);
  assert.match(text, /should point at a door, but "b2" is a button/);
  assert.match(text, /outside 0 to 10/);
  assert.match(text, /not one of press, toggle/);
});
