import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  controls, settings, getSetting, setSetting, settingsValues, resetSettings, setBinding, resetBindings, actionsList, conflictsFor, newKey, keyName, keysFor,
  caption, stepCaptions, drawCaptions, cleanSetting, SETTING_SPEC, onSettingChange, effectsLevel, musicLevel, resetForTests,
} from '../src/settings.js';
import { loadProgress, saveProgress, setProgressHost } from '../src/progress.js';
import { held, walk } from '../src/control.js';
import { play, setSoundSink } from '../src/sound.js';
import { music, playMusic, stopMusic } from '../src/music.js';
import { shake } from '../src/effects.js';
import { newGame } from '../src/things.js';

let saves;
beforeEach(() => {
  resetForTests();
  saves = [];
  setProgressHost({ send: (m) => saves.push(m.data), initial: null });
});

test('every setting has words, a kind and a starting value that is already valid', () => {
  for (const [name, spec] of Object.entries(SETTING_SPEC)) {
    assert.ok(spec.label && ['number', 'flag'].includes(spec.kind), name);
    assert.equal(cleanSetting(name, spec.default), spec.default, name);
  }
  assert.deepEqual(settings(), settingsValues());
  assert.equal(getSetting('masterVolume'), 1);
  assert.equal(getSetting('subtitles'), true);
  assert.equal(getSetting('reducedMotion'), false);
});

test('settings are kept in range and to their step, flags must be true or false, and an unknown name is refused with the list', () => {
  settings();
  assert.equal(setSetting('masterVolume', 5), 1);
  assert.equal(setSetting('masterVolume', -1), 0);
  assert.equal(setSetting('masterVolume', 0.34), 0.3);
  assert.equal(setSetting('textScale', 1.4), 1.5);
  assert.equal(setSetting('textScale', 0), 0.75);
  assert.equal(setSetting('subtitles', 'yes'), true, 'not true or false: the starting value');
  assert.equal(setSetting('reducedMotion', true), true);
  assert.throws(() => setSetting('nonsense', 1), /There is no setting called "nonsense" \(they are: masterVolume/);
  assert.equal(cleanSetting('masterVolume', NaN), 1);
  assert.equal(cleanSetting('unknown', 1), undefined);
});

test('what the player chose is kept with the progress, found again next time, and never lost when the game saves its own progress', () => {
  settings();
  setSetting('musicVolume', 0.4);
  setBinding('jump', ['KeyJ']);
  assert.deepEqual(saves.at(-1).__settings.values.musicVolume, 0.4);
  assert.deepEqual(saves.at(-1).__settings.keys, { jump: ['KeyJ'] });
  saveProgress({ level: 3 });
  assert.equal(saves.at(-1).level, 3);
  assert.equal(saves.at(-1).__settings.values.musicVolume, 0.4, 'the game saved without mentioning settings: they are still there');
  const next = saves.at(-1);
  resetForTests();
  setProgressHost({ send: (m) => saves.push(m.data), initial: next });
  settings();
  assert.equal(getSetting('musicVolume'), 0.4);
  assert.deepEqual(keysFor('jump'), ['KeyJ']);
  assert.equal(loadProgress().level, 3);
});

test('the game can say what the settings start as, the player\'s choice beats it, and reset goes back to the game\'s start', () => {
  settings({ musicVolume: 0.5, textScale: 1.25, bogus: 1 });
  assert.equal(getSetting('musicVolume'), 0.5);
  assert.equal(getSetting('textScale'), 1.25);
  setSetting('musicVolume', 0.9);
  settings({ musicVolume: 0.5 });
  assert.equal(getSetting('musicVolume'), 0.9, 'the saved choice wins');
  resetSettings();
  assert.equal(getSetting('musicVolume'), 0.5);
  assert.equal(saves.at(-1).__settings.values.musicVolume, 0.5);
});

test('damaged saved settings are put right instead of breaking the game', () => {
  resetForTests();
  setProgressHost({ send: () => {}, initial: { __settings: { values: { masterVolume: 'loud', textScale: 99, subtitles: 7 }, keys: { jump: 'Space', fire: ['not a key!'], 'bad name': ['KeyA'], left: ['KeyH'] } } } });
  settings();
  assert.equal(getSetting('masterVolume'), 1);
  assert.equal(getSetting('textScale'), 2);
  assert.equal(getSetting('subtitles'), true);
  assert.deepEqual(keysFor('jump'), ['Space', 'ArrowUp', 'KeyW'], 'not a list: the usual keys');
  assert.deepEqual(keysFor('left'), ['KeyH']);
});

test('the built-in actions work as before, a game can add its own, and a player\'s keys change what held and walk see', () => {
  settings();
  assert.ok(held(new Set(['KeyA']), 'left') && held(new Set(['ArrowLeft']), 'left') && !held(new Set(['KeyX']), 'left'));
  assert.ok(held(new Set(['KeyP']), 'KeyP'), 'a real key code still works as its own name');
  controls({ fire: ['KeyX'], pause: ['Escape'], 'bad name!': ['KeyQ'], empty: [] });
  assert.ok(held(new Set(['KeyX']), 'fire') && held(new Set(['Escape']), 'pause'));
  assert.ok(!actionsList().some((a) => a.action === 'bad name!' || a.action === 'empty'));
  setBinding('left', ['KeyJ', 'KeyJ', 'KeyK', 'KeyL', 'KeyM']);
  assert.deepEqual(keysFor('left'), ['KeyJ', 'KeyK', 'KeyL'], 'at most three, no repeats');
  assert.ok(held(new Set(['KeyK']), 'left') && !held(new Set(['ArrowLeft']), 'left'));
  const thing = { vx: 0 };
  walk(thing, new Set(['KeyK']), 100);
  assert.equal(thing.vx, -100);
  resetBindings('left');
  assert.ok(held(new Set(['ArrowLeft']), 'left'));
  setBinding('fire', ['KeyZ']);
  setBinding('fire', []);
  assert.deepEqual(keysFor('fire'), ['KeyX'], 'an empty list puts the usual keys back');
  assert.throws(() => setBinding('nothing', ['KeyA']), /There is no action called "nothing"/);
  const list = actionsList();
  assert.ok(list.find((a) => a.action === 'jump').usual.includes('Space') && !list.find((a) => a.action === 'jump').changed);
});

test('a key that another action uses is noticed, and "the key just pressed" is found once', () => {
  settings();
  assert.deepEqual(conflictsFor('jump', 'KeyA'), ['left']);
  assert.deepEqual(conflictsFor('jump', 'KeyQ'), []);
  const game = {};
  assert.equal(newKey(game, new Set()), null);
  assert.equal(newKey(game, new Set(['KeyQ'])), 'KeyQ');
  assert.equal(newKey(game, new Set(['KeyQ'])), null, 'still held: not new');
  assert.equal(newKey(game, new Set(['KeyQ', 'Mouse0'])), null, 'the mouse is not a key to choose');
  assert.equal(newKey(game, new Set(['KeyQ', 'KeyW'])), 'KeyW');
  resetBindings();
});

test('key names are plain words', () => {
  const names = { KeyA: 'A', Digit5: '5', ArrowLeft: 'Left arrow', Space: 'Space', Escape: 'Esc', ShiftLeft: 'Left Shift', Mouse0: 'Left click', F5: 'F5', NumpadEnter: 'Numpad Enter' };
  for (const [code, words] of Object.entries(names)) assert.equal(keyName(code), words, code);
});

test('sound effects and music follow the volume settings, and a change reaches the song that is already playing', () => {
  settings();
  const heard = [];
  setSoundSink((m) => heard.push(m));
  play({ duration: 0.1, layers: [{ wave: 'sine', freq: 440, gain: 1 }] }, 1);
  assert.equal(heard.at(-1).volume, 1);
  setSetting('masterVolume', 0.5);
  setSetting('effectsVolume', 0.4);
  play({ duration: 0.1, layers: [{ wave: 'sine', freq: 440, gain: 1 }] }, 1);
  assert.ok(Math.abs(heard.at(-1).volume - 0.2) < 1e-9);
  assert.ok(Math.abs(effectsLevel() - 0.2) < 1e-9 && Math.abs(musicLevel() - 0.5) < 1e-9);
  const sent = [];
  setSoundSink((m) => sent.push(m));
  music({ tune: { bpm: 100, tracks: [{ wave: 'square', gain: 0.3, notes: [['C4', 1]] }] } });
  playMusic('tune', { volume: 0.6 });
  assert.ok(Math.abs(sent.at(-1).volume - 0.3) < 1e-9, '0.6 times 0.5');
  setSetting('musicVolume', 0.5);
  const last = sent.at(-1);
  assert.equal(last.action, 'play');
  assert.ok(Math.abs(last.volume - 0.15) < 1e-9, 'the playing song was told the new volume');
  stopMusic();
  const count = sent.length;
  setSetting('musicVolume', 1);
  assert.equal(sent.length, count, 'nothing is playing: nothing is sent');
  setSoundSink((m) => globalThis.postMessage?.(m));
});

test('reduced motion stops the screen shake', () => {
  settings();
  const g = newGame();
  shake(g, 6);
  assert.ok(g.shake);
  g.shake = null;
  setSetting('reducedMotion', true);
  shake(g, 6);
  assert.equal(g.shake ?? null, null);
});

test('captions: shown for a moment when on, limited to three, counted down, drawn, and nothing at all when off', () => {
  settings();
  const g = newGame();
  caption(g, '[door creaks]', 1);
  caption(g, 'a', 1);
  caption(g, 'b', 1);
  caption(g, 'c', 1);
  assert.equal(g.captions.length, 3);
  assert.deepEqual(g.captions.map((c) => c.text), ['a', 'b', 'c']);
  stepCaptions(g, 0.6);
  assert.equal(g.captions.length, 3);
  stepCaptions(g, 0.6);
  assert.equal(g.captions.length, 0);
  const calls = [];
  const ctx = new Proxy({}, { get: (_, n) => (n === 'measureText' ? () => ({ width: 50 }) : (...a) => { calls.push([n, ...a]); }), set: () => true });
  caption(g, '[music plays]');
  drawCaptions(ctx, g);
  assert.ok(calls.some((c) => c[0] === 'fillText' && c[1] === '[music plays]'));
  setSetting('subtitles', false);
  calls.length = 0;
  caption(g, 'hidden');
  drawCaptions(ctx, g);
  assert.equal(calls.length, 0);
  assert.ok(!g.captions.some((c) => c.text === 'hidden'));
});

test('someone can be told when a setting changes, and stop being told', () => {
  settings();
  const seen = [];
  const off = onSettingChange((what) => seen.push(what));
  setSetting('textScale', 1.5);
  resetSettings();
  off();
  setSetting('textScale', 1.25);
  assert.deepEqual(seen, ['textScale', 'all']);
});
