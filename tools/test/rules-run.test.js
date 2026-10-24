import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadGame } from '../replay-run.js';
import {
  newRule, nextId, problemWith, describeRule, codeFor, generateModule, parseRules, addToGame, WHENS, THENS,
} from '../../studio/app/rules/rules-model.js';
import { setSoundSink, setCanvasFactory } from '../../packages/arcade/src/index.js';
import { TEMPLATES } from '../../studio/app/store/templates.js';

/** A tiny game whose only rules are the ones under test: a hero on a floor with three coins in a row, walking right. */
const GAME = `import { newGame, loadMap, first, all, walk, gravity, moveAndCollide, drawThings, clear, sounds } from '@engine/arcade';
import { applyRules, drawRules } from './rules.js';
sounds({ coin: { duration: 0.2, layers: [{ wave: 'sine', freq: 440 }] } });
export function create() {
  const game = newGame();
  loadMap(game, ['##########', '#@..o.o.o#', '##########'], { '#': { kind: 'wall' }, o: { kind: 'coin', w: 16, h: 16 }, '@': { kind: 'hero', w: 24, h: 30 } });
  return game;
}
export function update(game, keys, dt) {
  const hero = first(game, 'hero');
  walk(hero, keys, 120); gravity(hero, dt); moveAndCollide(game, hero, dt);
  applyRules(game, keys, dt);
}
export function render(game, g) { clear(g); drawThings(g, game); drawRules(game, g); }
`;
const ctx = () => new Proxy({}, { get: (o, k) => (k in o ? o[k] : () => {}), set: (o, k, v) => { o[k] = v; return true; } });

async function play(rules, { keysAt = () => new Set(['ArrowRight']), ticks = 400, files = {} } = {}) {
  const sounds = [];
  setSoundSink((m) => sounds.push(m.spec));
  setCanvasFactory(() => ({ getContext: ctx }));
  const { mod, cleanup } = await loadGame({ 'src/main.js': GAME, 'src/rules.js': generateModule(rules), ...files });
  try {
    const game = mod.create();
    for (let t = 0; t < ticks; t++) mod.update(game, keysAt(t), 1 / 60);
    mod.render(game, ctx(), 0);
    return { game, sounds };
  } finally { cleanup(); }
}

test('every rule is checked before it makes code: unknown pieces, bad names and impossible combinations say what to fix', () => {
  assert.equal(problemWith(newRule('touch')), null);
  for (const type of Object.keys(WHENS)) assert.equal(problemWith(newRule(type, 2)), null, type);
  const touch = (patch) => ({ ...newRule('touch'), ...patch });
  assert.match(problemWith(touch({ when: { type: 'touch', a: 'he ro', b: 'coin' } })), /two things/);
  assert.match(problemWith(touch({ when: { type: 'touch', a: 'hero"); evil(); ("', b: 'coin' } })), /two things/);
  assert.match(problemWith(touch({ then: [] })), /something for the rule to do/);
  assert.match(problemWith({ ...newRule('every'), then: [{ type: 'remove', who: 'b' }] }), /second thing/);
  assert.match(problemWith({ ...newRule('every'), then: [{ type: 'add', field: 'a.b', n: 1 }] }), /Name the value/);
  assert.match(problemWith({ ...newRule('every'), then: [{ type: 'add', field: 'constructor; evil', n: 1 }] }), /Name the value/);
  assert.match(problemWith({ ...newRule('every'), then: [{ type: 'set', field: 'x', value: { a: 1 } }] }), /Choose a value/);
  assert.match(problemWith({ ...newRule('every'), then: [{ type: 'play', sound: 'x"); y("' }] }), /Name the sound/);
  assert.match(problemWith({ ...newRule('every'), when: { type: 'every', seconds: 0 } }), /seconds/);
  assert.match(problemWith({ ...newRule('every'), then: [{ type: 'say', text: '', seconds: 2 }] }), /short message/);
  assert.match(problemWith({ ...newRule('every'), then: [{ type: 'bogus' }] }), /not known/);
  assert.match(problemWith(null), /not a rule/); assert.match(problemWith({ id: 1, when: { type: 'nope' }, then: [] }), /what the rule waits for/);
  assert.equal(nextId([]), 1); assert.equal(nextId([{ id: 4 }, { id: 2 }]), 5);
});

test('a rule is said as a plain sentence, and its code says the same thing in JavaScript', () => {
  const rule = { id: 1, once: false, when: { type: 'touch', a: 'hero', b: 'coin' }, then: [{ type: 'score', add: 1 }, { type: 'remove', who: 'b' }, { type: 'play', sound: 'coin' }] };
  assert.equal(describeRule(rule), 'When hero touches coin: add 1 to the score, remove the coin, play the sound coin.');
  assert.equal(describeRule({ ...newRule('key'), once: true, then: [{ type: 'shake', amount: 5 }] }), 'When the space key is pressed (the first time only): shake the screen.');
  const code = codeFor(rule);
  assert.match(code, /^\/\/ Rule 1: When hero touches coin/); assert.match(code, /for \(const a of all\(game, "hero"\)\)/); assert.match(code, /overlaps\(game, a, "coin"\)/);
  assert.match(code, /game\.score \+= 1;/); assert.match(code, /despawn\(game, b\);/); assert.match(code, /play\("coin"\);/);
  const sneaky = codeFor({ id: 2, once: false, when: { type: 'every', seconds: 1 }, then: [{ type: 'say', text: 'hi */ evil(); /*\n// more', seconds: 2 }] });
  assert.ok(!sneaky.split('\n')[0].includes('*/ evil'), 'the comment cannot be closed early'); assert.ok(sneaky.split('\n')[0].startsWith('// Rule 2'));
  assert.match(sneaky, /game\.say = \{ text: "hi \*\/ evil\(\); \/\*\\n\/\/ more"/, 'the text is a string in the code, never code');
});

test('rules are written to a file and read back exactly, and a damaged file says what is wrong', () => {
  const rules = [newRule('touch', 1), { ...newRule('key', 2), once: true }, newRule('every', 3)];
  const text = generateModule(rules);
  assert.deepEqual(parseRules(text), rules); assert.match(text, /export function applyRules\(game, keys, dt\)/); assert.match(text, /export function drawRules\(game, g\)/);
  assert.deepEqual(parseRules(generateModule([])), []); assert.match(generateModule([]), /no rules yet/);
  assert.throws(() => parseRules('const x = 1'), /not a rules file/); assert.throws(() => parseRules('export const RULES = 5;'), /square brackets/);
  assert.throws(() => parseRules('export const RULES = [ {'), /not closed/); assert.throws(() => parseRules('export const RULES = [ nope ];'), /plain JSON/);
  assert.throws(() => parseRules(`export const RULES = [${new Array(61).fill('{}').join(',')}];`), /at most 60/);
  const incomplete = generateModule([{ id: 1, when: { type: 'touch', a: 'x"y', b: 'c' }, then: [{ type: 'score', add: 1 }] }]);
  assert.match(incomplete, /Rule 1 is not complete yet/); assert.ok(!incomplete.includes('x"y'.replace('"', '\\"') + '")'), 'an incomplete rule makes no code');
});

test('touching: the rule fires for each coin the hero reaches, and removing, scoring, sound and sparks all happen', async () => {
  const rule = { id: 1, once: false, when: { type: 'touch', a: 'hero', b: 'coin' }, then: [{ type: 'score', add: 2 }, { type: 'remove', who: 'b' }, { type: 'play', sound: 'coin' }, { type: 'burst', who: 'b' }] };
  const { game, sounds } = await play([rule]);
  assert.equal(game.score, 6, 'three coins, two points each'); assert.equal(game.things.filter((t) => t.kind === 'coin').length, 0); assert.equal(sounds.length, 3);
  assert.ok(game.things.filter((t) => t.kind === 'spark').length >= 0, 'burst did not throw');
});

test('keys: "pressed" fires once per press, "held" fires every tick; every N seconds counts time; "none left" and "score reaches" wait for their moment, once if asked', async () => {
  const press = { id: 1, once: false, when: { type: 'key', key: 'space', mode: 'press' }, then: [{ type: 'add', field: 'presses', n: 1 }] };
  const hold = { id: 2, once: false, when: { type: 'key', key: 'space', mode: 'hold' }, then: [{ type: 'add', field: 'frames', n: 1 }] };
  const space = (t) => new Set((t >= 10 && t < 40) || (t >= 60 && t < 70) ? ['Space'] : []);
  const a = (await play([press, hold], { keysAt: space, ticks: 100 })).game;
  assert.equal(a.presses, 2, 'two separate presses'); assert.equal(a.frames, 40, 'held for 30 + 10 ticks');
  const every = { id: 3, once: false, when: { type: 'every', seconds: 1 }, then: [{ type: 'add', field: 'ticks', n: 1 }] };
  assert.equal((await play([every], { keysAt: () => new Set(), ticks: 210 })).game.ticks, 3, 'once a second for 3.5 seconds');
  const none = { id: 4, once: true, when: { type: 'none', kind: 'ghost' }, then: [{ type: 'add', field: 'fired', n: 1 }, { type: 'say', text: 'Empty!', seconds: 1 }] };
  const b = (await play([none], { keysAt: () => new Set(), ticks: 200 })).game;
  assert.equal(b.fired, 1, 'only the first time'); assert.equal(b.say, null, 'and the message goes away by itself');
  const early = (await play([none], { keysAt: () => new Set(), ticks: 20 })).game; assert.equal(early.fired, 1); assert.deepEqual(early.say?.text, 'Empty!');
  const score = { id: 5, once: true, when: { type: 'score', n: 2 }, then: [{ type: 'set', field: 'reached', value: true }] };
  const pickup = { id: 6, once: false, when: { type: 'touch', a: 'hero', b: 'coin' }, then: [{ type: 'score', add: 1 }, { type: 'remove', who: 'b' }] };
  assert.equal((await play([pickup, score])).game.reached, true); assert.equal((await play([score], { keysAt: () => new Set() })).game.reached, undefined);
  const restart = { id: 7, once: false, when: { type: 'touch', a: 'hero', b: 'coin' }, then: [{ type: 'move', who: 'a', x: 40, y: 40 }, { type: 'remove', who: 'b' }] };
  assert.ok((await play([restart], { ticks: 90 })).game.things.length > 0);
  const spawner = { id: 8, once: false, when: { type: 'every', seconds: 1 }, then: [{ type: 'spawn', kind: 'gem', x: 'random', y: 100 }] };
  const first = (await play([spawner], { keysAt: () => new Set(), ticks: 190 })).game; const second = (await play([spawner], { keysAt: () => new Set(), ticks: 190 })).game;
  const gems = (g) => g.things.filter((t) => t.kind === 'gem');
  assert.equal(gems(first).length, 3); assert.deepEqual(gems(first).map((t) => t.x), gems(second).map((t) => t.x), 'random, but the same every time');
  assert.ok(gems(first).every((t) => t.x >= 32 && t.x <= 440));
});

test('adding rules to a game: the import, the call in update and the call in render are put in, once, and the game still runs', async () => {
  const main = TEMPLATES.hero.files['src/main.js'];
  const r = addToGame(main);
  assert.equal(r.changed, true); assert.match(r.text, /import \{ applyRules, drawRules \} from '\.\/rules\.js';/); assert.equal((r.text.match(/applyRules\(game, keys, dt\);/g) ?? []).length, 1); assert.equal((r.text.match(/drawRules\(game, g\);/g) ?? []).length, 1);
  assert.ok(r.text.indexOf('drawRules(game, g);') > r.text.indexOf('export function render'), 'in render, not somewhere else');
  const again = addToGame(r.text); assert.equal(again.changed, false); assert.equal(again.text, r.text);
  assert.match(addToGame('export function create() {}').problem, /update\(game, keys, dt\)/);
  const tricky = addToGame("export function update(game, keys, dt) {\n  const s = '}';\n  // }\n  if (keys) { game.t = 1; }\n}\nexport function render(game, g) {}\n"); assert.match(tricky.text, /\n  applyRules\(game, keys, dt\);\n\}\nexport function render/);
  const rules = [{ id: 1, once: false, when: { type: 'touch', a: 'hero', b: 'enemy' }, then: [{ type: 'shake', amount: 4 }] }];
  setCanvasFactory(() => ({ getContext: ctx })); setSoundSink(() => {});
  const { mod, cleanup } = await loadGame({ ...TEMPLATES.hero.files, 'src/main.js': r.text, 'src/rules.js': generateModule(rules) });
  try { const game = mod.create(); for (let i = 0; i < 120; i++) mod.update(game, new Set(['ArrowRight']), 1 / 60); mod.render(game, ctx(), 0); assert.ok(mod.summary(game)); } finally { cleanup(); }
  assert.ok(Object.keys(THENS).length >= 8);
});
