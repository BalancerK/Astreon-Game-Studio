import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as B from '../app/store/backpack.js';
import * as sounds from '../app/paint/sound-model.js';
import * as particles from '../app/paint/particle-model.js';
import * as states from '../app/paint/state-model.js';
import * as clips from '../app/paint/clip-model.js';
import * as behaviors from '../app/paint/behavior-model.js';
import * as ui from '../app/paint/ui-model.js';
import * as music from '../app/paint/music-model.js';
import { serializeSprite, parseSprite } from '../app/paint/sprite-model.js';
import { SPRITES } from '../app/pack/sprites.js';
import { serializeScene, parseScene } from '../app/paint/scene-model.js';
import { STARTER, serializeStoryFile, parseStoryFile } from '../app/paint/story-model.js';

const hero = serializeSprite(SPRITES.find((s) => s.name === 'hero').make());
const project = () => ({
  'src/main.js': 'export function create() { return {}; }',
  'src/art/hero.js': hero,
  'src/art/gem.js': serializeSprite(SPRITES.find((s) => s.name === 'gem').make()),
  'src/sounds.js': sounds.serializeSounds({ coin: sounds.preset('coin'), jump: sounds.preset('jump') }),
  'src/music.js': music.serializeSongs({ calm: music.PRESETS.calm() }),
  'src/particles.js': particles.serializeParticles({ fire: particles.preset('fire') }),
  'src/states.js': states.serializeStates({ hero: states.starterMachine() }),
  'src/clips.js': clips.serializeClips({ bob: clips.PRESETS.bob() }),
  'src/behaviors.js': behaviors.serializeBehaviors({ enemy: behaviors.STARTERS.enemy() }),
  'src/ui.js': ui.serializeUi({ hud: ui.STARTERS.hud() }),
  'scenes/cave.js': serializeScene({ w: 128, h: 64, things: [{ kind: 'coin', x: 1, y: 2, w: 16, h: 16 }] }),
  'src/levels/one.js': 'export const LEVEL = ["#.#", "#@#", "###"];',
  'src/dialogue.js': serializeStoryFile(STARTER),
  'notes.md': 'not carried',
});

test('everything a project could put in the backpack is listed, by kind and name, and damaged files offer nothing instead of failing', () => {
  const items = B.itemsIn(project());
  const key = (i) => `${i.kind}:${i.name}`;
  for (const k of ['sprite:hero', 'sprite:gem', 'sound:coin', 'sound:jump', 'song:calm', 'effect:fire', 'machine:hero', 'clip:bob', 'behaviors:enemy', 'screen:hud', 'scene:cave', 'level:one', 'story:story']) {
    assert.ok(items.map(key).includes(k), k);
  }
  assert.ok(!items.some((i) => i.name === 'notes' || i.name === 'main'));
  assert.deepEqual(B.itemsIn({ 'src/sounds.js': 'nonsense', 'src/ui.js': 'export default 5;' }), []);
  assert.deepEqual(B.itemsIn({}), []);
  assert.ok(Object.keys(B.KINDS).length >= 12);
});

test('each kind is taken out of a project and put into an empty one, and comes out the same', () => {
  const files = project();
  for (const { kind, name } of B.itemsIn(files)) {
    const item = B.take(files, kind, name);
    const placed = B.put({}, item);
    assert.equal(placed.replaces, false, kind);
    assert.ok(placed.text.length > 10, kind);
    const again = B.take({ [placed.path]: placed.text }, kind, placed.name);
    assert.deepEqual(again.payload, item.payload, `${kind} ${name} survives the trip`);
  }
  assert.deepEqual(parseSprite(B.put({}, B.take(files, 'sprite', 'hero')).text), parseSprite(hero));
  assert.deepEqual(parseScene(B.put({}, B.take(files, 'scene', 'cave')).text).things, parseScene(files['scenes/cave.js']).things);
  assert.equal(parseStoryFile(B.put({}, B.take(files, 'story', 'story')).text), STARTER);
});

test('putting a thing into a project that has the name already gives it a free name and keeps what is there', () => {
  const files = project();
  const coin = B.take(files, 'sound', 'coin');
  const placed = B.put(files, coin);
  assert.equal(placed.path, 'src/sounds.js');
  assert.equal(placed.name, 'coin2');
  const table = sounds.parseSounds(placed.text);
  assert.deepEqual(Object.keys(table).sort(), ['coin', 'coin2', 'jump']);
  assert.deepEqual(table.coin2, table.coin);
  const sprite = B.put(files, B.take(files, 'sprite', 'hero'));
  assert.equal(sprite.path, 'src/art/hero2.js');
  assert.equal(sprite.name, 'hero2');
  const level = B.put(files, B.take(files, 'level', 'one'));
  assert.equal(level.path, 'src/levels/one2.js');
  const intoDamaged = () => B.put({ 'src/sounds.js': 'oops' }, coin);
  assert.throws(intoDamaged, /not a list of sounds/, 'a damaged table is reported, not overwritten');
});

test('the one story or set of controls replaces the one there, and says so, so the person can be asked', () => {
  const files = project();
  const story = B.take(files, 'story', 'story');
  assert.equal(B.put(files, story).replaces, true);
  assert.equal(B.put({}, story).replaces, false);
  assert.equal(B.put(files, story).path, 'src/dialogue.js');
  assert.throws(() => B.take({}, 'story', 'story'), /no src\/dialogue.js/);
});

test('things that are not there, kinds that are not carried, and names that need cleaning are handled', () => {
  const files = project();
  assert.throws(() => B.take(files, 'sound', 'nope'), /no sound called "nope"/);
  assert.throws(() => B.take({}, 'sound', 'coin'), /no src\/sounds.js/);
  assert.throws(() => B.take(files, 'sprite', 'ghost'), /no src\/art\/ghost.js/);
  assert.throws(() => B.take(files, 'rocket', 'x'), /not something the backpack carries/);
  assert.throws(() => B.put(files, { kind: 'rocket', name: 'x', payload: {} }), /not something the backpack carries/);
  const odd = B.put({}, { kind: 'sound', name: '9 odd name!', payload: sounds.preset('coin') });
  assert.equal(odd.name, 'oddname');
});

test('the backpack keeps items, the same thing once, finds them by words and kind, and gives them up', () => {
  let items = [];
  const files = project();
  items = B.addItem(items, B.take(files, 'sprite', 'hero'), { from: 'Platformer', now: 1000 });
  items = B.addItem(items, B.take(files, 'sound', 'coin'), { from: 'Platformer', now: 2000 });
  items = B.addItem(items, B.take(files, 'sound', 'coin'), { from: 'Platformer', now: 3000 });
  assert.equal(items.length, 2, 'the same thing is not added twice');
  assert.equal(items[0].kind, 'sound', 'the newest first');
  assert.ok(items.every((i) => i.id && i.from === 'Platformer'));
  assert.equal(B.search(items, 'hero').length, 1);
  assert.equal(B.search(items, 'platformer sound').length, 1, 'every word has to match');
  assert.equal(B.search(items, '', 'sprite').length, 1);
  assert.equal(B.search(items, 'zzz').length, 0);
  assert.equal(B.search(items).length, 2);
  items = B.removeItem(items, items[0].id);
  assert.equal(items.length, 1);
  assert.throws(() => B.addItem([], { kind: 'rocket', name: 'x', payload: {} }), /not something/);
});

test('the backpack has limits: one item, the number of items, and the total', () => {
  const big = { kind: 'scene', name: 'big', payload: 'x'.repeat(B.BACKPACK_LIMITS.itemBytes + 1) };
  assert.throws(() => B.addItem([], big), /too big/);
  let items = [];
  for (let i = 0; i < B.BACKPACK_LIMITS.items; i++) items = B.addItem(items, { kind: 'level', name: `l${i}`, payload: `x${i}` });
  assert.throws(() => B.addItem(items, { kind: 'level', name: 'more', payload: 'y' }), /at most 300/);
  let heavy = [];
  const chunk = 'z'.repeat(100_000);
  for (let i = 0; i < 29; i++) heavy = B.addItem(heavy, { kind: 'level', name: `h${i}`, payload: `${i}${chunk}` });
  assert.throws(() => B.addItem(heavy, { kind: 'level', name: 'last', payload: chunk }), /full/);
});

test('a backpack file is saved and read back, damaged parts are left out, and merging adds only what is new', () => {
  const files = project();
  let items = [];
  for (const [k, n] of [['sprite', 'hero'], ['sound', 'coin'], ['screen', 'hud']]) items = B.addItem(items, B.take(files, k, n), { from: 'A', now: 5 });
  const text = B.serializeBackpack(items);
  assert.deepEqual(B.parseBackpack(text).map((i) => `${i.kind}:${i.name}`).sort(), items.map((i) => `${i.kind}:${i.name}`).sort());
  assert.deepEqual(B.parseBackpack(text).find((i) => i.kind === 'sound').payload, items.find((i) => i.kind === 'sound').payload);
  assert.throws(() => B.parseBackpack('nope'), /not JSON/);
  assert.throws(() => B.parseBackpack('{"format":"other","items":[]}'), /not a studio backpack/);
  const messy = JSON.stringify({ format: B.FORMAT, version: 1, items: [
    { kind: 'sound', name: 'ok', payload: { duration: 1 } }, { kind: 'rocket', name: 'x', payload: {} }, { kind: 'sprite', name: 'wrong', payload: { not: 'text' } },
    { kind: 'sound', name: 'wrong2', payload: 'text' }, null, { kind: 'level', name: 'good', payload: 'export default 1;' }, { kind: 'level', payload: 'x' },
  ] });
  assert.deepEqual(B.parseBackpack(messy).map((i) => i.name), ['ok', 'good']);
  const merged = B.mergeBackpack(items, B.parseBackpack(text));
  assert.equal(merged.added, 0, 'all of it is there already');
  const fewer = B.mergeBackpack(items.slice(1), B.parseBackpack(text));
  assert.equal(fewer.added, 1);
  assert.equal(fewer.items.length, 3);
});
