import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../app/paint/controls-model.js';
import { accessibilityReport, accessibilityScore } from '../app/profile/accessibility.js';

test('a controls file is saved and read back exactly, bad parts are put right, and a damaged one is explained', () => {
  let c = C.newControls();
  c = C.addAction(c, 'fire', 'KeyX');
  c = C.addKey(c, 'fire', 'KeyZ');
  c = C.setStart(c, 'musicVolume', 0.6);
  c = C.setOffered(c, 'highContrast', false);
  const text = C.serializeControls(c);
  assert.match(text, /^\/\/ Made with the studio/);
  assert.deepEqual(C.parseControls(text), c);
  assert.throws(() => C.parseControls('x'), /not a set of controls/);
  assert.throws(() => C.parseControls('export default { nope };'), /plain JSON/);
  assert.throws(() => C.parseControls('export default [];'), /object with actions/);
  const loose = C.parseControls('export default { "actions": { "ok": ["KeyA", "KeyA", "not a key", "KeyB", "KeyC", "KeyD"], "bad name": ["KeyA"], "none": [] }, "settings": { "textScale": 99, "x": 1, "subtitles": "yes" }, "offer": ["masterVolume", "nope", "masterVolume"] }');
  assert.deepEqual(loose.actions, { ok: ['KeyA', 'KeyB', 'KeyC'] });
  assert.deepEqual(loose.settings, { textScale: 2 });
  assert.deepEqual(loose.offer, ['masterVolume']);
  assert.deepEqual(C.parseControls('export default {};').offer, C.SETTING_NAMES, 'no list: every setting is offered');
});

test('actions: named safely, started with a key, keys added (three at most) and taken away (one always stays), and built-in ones show their usual keys', () => {
  let c = C.newControls();
  assert.match(C.actionProblem(c, '1x'), /Use letters/);
  assert.match(C.actionProblem(c, 'jump'), /already/);
  assert.match(C.actionProblem(c, 'space'), /already/);
  assert.equal(C.actionProblem(c, 'fire'), null);
  assert.deepEqual(C.keysOf(c, 'left'), ['ArrowLeft', 'KeyA']);
  assert.deepEqual(C.keysOf(c, 'nothing'), []);
  c = C.addAction(c, 'fire', 'KeyX');
  assert.match(C.actionProblem(c, 'fire'), /already/);
  c = C.addKey(c, 'fire', 'KeyX');
  assert.deepEqual(c.actions.fire, ['KeyX'], 'no repeat');
  c = C.addKey(C.addKey(C.addKey(c, 'fire', 'KeyZ'), 'fire', 'KeyC'), 'fire', 'KeyV');
  assert.deepEqual(c.actions.fire, ['KeyX', 'KeyZ', 'KeyC'], 'three at most');
  assert.equal(C.addKey(c, 'fire', 'not valid!'), c);
  c = C.removeKey(c, 'fire', 'KeyZ');
  assert.deepEqual(c.actions.fire, ['KeyX', 'KeyC']);
  assert.equal(C.removeKey(C.addAction(C.newControls(), 'a', 'KeyA'), 'a', 'KeyA').actions.a[0], 'KeyA', 'the last key stays');
  assert.equal(C.addKey(C.newControls(), 'jump', 'KeyJ').actions.jump, undefined, 'jump already has three keys');
  let b = C.addKey(C.newControls(), 'left', 'KeyJ');
  assert.deepEqual(b.actions.left, ['ArrowLeft', 'KeyA', 'KeyJ']);
  b = C.removeKey(b, 'left', 'KeyJ');
  assert.ok(!('left' in b.actions), 'back to the usual keys: nothing to say in the file');
  assert.ok(!('fire' in C.removeAction(c, 'fire').actions));
  assert.deepEqual(C.BUILT_IN_NAMES.includes('click'), false);
});

test('keys that two actions start with are noticed', () => {
  const c = C.addAction(C.newControls(), 'fire', 'KeyA');
  assert.deepEqual(C.clashes(c, 'fire', 'KeyA'), ['left']);
  assert.deepEqual(C.clashes(c, 'fire', 'KeyQ'), []);
  assert.deepEqual(C.clashes(c, 'left', 'KeyA'), ['fire']);
});

test('setting starts: the game\'s choice or the kit\'s, kept in range, and the usual value is not written down; offering is switched on and off in order', () => {
  let c = C.newControls();
  assert.equal(C.startOf(c, 'musicVolume'), 1);
  c = C.setStart(c, 'musicVolume', 0.6);
  assert.equal(C.startOf(c, 'musicVolume'), 0.6);
  c = C.setStart(c, 'textScale', 9);
  assert.equal(c.settings.textScale, 2);
  c = C.setStart(c, 'musicVolume', 1);
  assert.ok(!('musicVolume' in c.settings));
  c = C.setStart(c, 'reducedMotion', true);
  assert.equal(c.settings.reducedMotion, true);
  c = C.setOffered(c, 'masterVolume', false);
  assert.ok(!c.offer.includes('masterVolume') && c.offer[0] === 'effectsVolume');
  c = C.setOffered(c, 'masterVolume', true);
  assert.equal(c.offer[0], 'masterVolume', 'back in its place');
});

const game = (extra = '') => ({
  'src/main.js': `import { held, play, shake, label } from '@engine/arcade';\nexport function update(g, keys) { if (held(keys, 'jump')) play('jump'); shake(g); }\n${extra}`,
});

test('the report says what a game does not offer, with where, and what it does', () => {
  const r = Object.fromEntries(accessibilityReport(game()).map((x) => [x.id, x]));
  assert.equal(r.remap.state, 'todo');
  assert.equal(r.volume.state, 'todo');
  assert.equal(r.motion.state, 'todo');
  assert.equal(r.motion.where[0].path, 'src/main.js');
  assert.equal(r.captions.state, 'check');
  assert.equal(r.hardKeys.state, 'ok');
  assert.equal(r.smallText.state, 'ok');
  assert.ok(['colour', 'flash', 'timing', 'onehand', 'tutorial'].every((id) => r[id].state === 'check'), 'what cannot be read is left to the person');
  const done = Object.fromEntries(accessibilityReport(game("import setup from './controls.js';\ncontrols(setup.actions);\nsettings(setup.settings);\ncaption(g, '[jump]');")).map((x) => [x.id, x]));
  assert.equal(done.remap.state, 'ok');
  assert.equal(done.volume.state, 'ok');
  assert.equal(done.motion.state, 'ok');
  assert.equal(done.captions.state, 'ok');
});

test('keys written into the code, small text and hand-drawn text are found with their lines; files that are not game code are left alone', () => {
  const files = {
    'src/main.js': "export function update(g, keys) {\n  if (keys.has('KeyP')) g.paused = true;\n  if (keys.has(\"Space\")) g.go = true;\n}\nexport function render(g, ctx) {\n  ctx.font = '10px sans-serif';\n  label(ctx, 'hi', 1, 1, { size: 9 });\n  label(ctx, 'ok', 1, 1, { size: 18 });\n}\n",
    'tests/a.test.js': "keys.has('KeyZ')",
    'src/art/hero.js': "keys.has('KeyQ') size: 3",
    'src/ui.js': 'export default { "hud": { "widgets": [{ "type": "label", "size": 8 }, { "type": "label", "size": 18 }] } };',
  };
  const r = Object.fromEntries(accessibilityReport(files).map((x) => [x.id, x]));
  assert.deepEqual(r.hardKeys.where.map((w) => `${w.path}:${w.line}`), ['src/main.js:2', 'src/main.js:3']);
  assert.deepEqual(r.smallText.where.map((w) => `${w.path}:${w.line}`).sort(), ['src/main.js:7', 'src/ui.js:1']);
  assert.equal(r.handText.state, 'check');
  assert.equal(r.handText.where[0].line, 6);
  assert.equal(r.remap.state, 'todo');
});

test('a game that does nothing yet gets "not applicable" rather than a false alarm, and the score counts only what can be decided', () => {
  const none = accessibilityReport({ 'src/main.js': 'export function update() {}' });
  const byId = Object.fromEntries(none.map((x) => [x.id, x.state]));
  assert.deepEqual([byId.remap, byId.volume, byId.motion], ['na', 'na', 'na']);
  assert.deepEqual(accessibilityScore(none), { done: 1, of: 1 }, 'only small text applies, and is fine');
  assert.deepEqual(accessibilityScore(accessibilityReport(game())), { done: 2, of: 5 });
  assert.deepEqual(accessibilityScore([]), { done: 0, of: 0 });
});
