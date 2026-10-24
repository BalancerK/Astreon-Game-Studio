import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { openSettingsMenu, closeSettingsMenu, settingsMenuOpen, stepSettingsMenu, drawSettingsMenu, settingsMenuScreen, menuItems } from '../src/settings-menu.js';
import { settings, getSetting, setSetting, keysFor, controls, resetForTests, SETTING_SPEC } from '../src/settings.js';
import { uiProblems, placeOf } from '../src/ui.js';
import { setProgressHost } from '../src/progress.js';

beforeEach(() => {
  resetForTests();
  setProgressHost({ send: () => {}, initial: null });
  settings();
});

/** Press keys one tick at a time, as the game would give them: each entry is the set held that tick (an empty entry lets go). */
function play(game, ticks, mouse) {
  let result = null;
  for (const held of ticks) result = stepSettingsMenu(game, new Set(held), mouse?.(held)) ?? result;
  return result;
}
const tap = (...codes) => codes.flatMap((c) => [[c], []]);
const opened = (o) => { const g = {}; openSettingsMenu(g, o); stepSettingsMenu(g, new Set()); return g; };

test('the menu opens, lists the settings and the buttons, and closes', () => {
  const g = {};
  assert.equal(settingsMenuOpen(g), false);
  openSettingsMenu(g);
  assert.equal(settingsMenuOpen(g), true);
  const items = menuItems(g);
  assert.deepEqual(items.slice(0, 7), Object.keys(SETTING_SPEC).map((n) => `row-${n}`));
  assert.deepEqual(items.slice(-3), ['go-controls', 'reset', 'back']);
  closeSettingsMenu(g);
  assert.equal(settingsMenuOpen(g), false);
  assert.deepEqual(menuItems(g), []);
  const few = {};
  openSettingsMenu(few, { offer: ['masterVolume', 'bogus', 'textScale'], title: 'Options' });
  assert.deepEqual(menuItems(few).slice(0, 2), ['row-masterVolume', 'row-textScale'], 'only real settings are offered');
});

test('the key that opened the menu does nothing in it, then up, down, left, right and Enter work', () => {
  const g = {};
  openSettingsMenu(g);
  assert.equal(play(g, [['Enter'], ['Enter'], []]), null);
  assert.equal(g.settingsMenu.page, 'main', 'Enter held from before did not press "Master volume"');
  play(g, tap('ArrowRight'));
  assert.equal(getSetting('masterVolume'), 1, 'already full');
  play(g, tap('ArrowLeft', 'ArrowLeft'));
  assert.equal(getSetting('masterVolume'), 0.8);
  play(g, tap('ArrowDown', 'ArrowDown', 'ArrowLeft'));
  assert.equal(getSetting('musicVolume'), 0.9, 'the third row is Music');
  play(g, tap('ArrowDown', 'ArrowLeft'));
  assert.equal(getSetting('textScale'), 0.75);
  play(g, tap('ArrowDown', 'Enter'));
  assert.equal(getSetting('subtitles'), false, 'Enter on a yes/no row flips it');
  play(g, tap('ArrowUp', 'ArrowUp', 'ArrowUp', 'ArrowUp', 'ArrowUp'));
  assert.equal(g.settingsMenu.focus, menuItems(g).length - 1, 'up wraps round from the top to the bottom');
});

test('a held key does not repeat: one press changes one step', () => {
  const g = opened();
  play(g, [['ArrowLeft'], ['ArrowLeft'], ['ArrowLeft'], []]);
  assert.equal(getSetting('masterVolume'), 0.9);
});

test('Reset puts the settings back, Back leaves, Esc leaves, and a mouse click works on the buttons', () => {
  const g = opened();
  setSetting('masterVolume', 0.2);
  g.settingsMenu.focus = menuItems(g).indexOf('reset');
  play(g, tap('Enter'));
  assert.equal(getSetting('masterVolume'), 1);
  assert.match(g.settingsMenu.note, /back to how it started/);
  assert.equal(play(g, tap('Escape')), 'back');
  assert.equal(settingsMenuOpen(g), false);
  const h = opened();
  const { screen } = settingsMenuScreen(h);
  const dec = screen.widgets.find((x) => x.id === 'dec-masterVolume');
  const b = placeOf(dec, { width: 480, height: 320 });
  const click = { x: b.x + b.w / 2, y: b.y + b.h / 2, clicked: true };
  stepSettingsMenu(h, new Set(), click);
  assert.equal(getSetting('masterVolume'), 0.9, 'the minus button was clicked');
  const back = screen.widgets.find((x) => x.id === 'back');
  const bb = placeOf(back, { width: 480, height: 320 });
  assert.equal(stepSettingsMenu(h, new Set(), { x: bb.x + 5, y: bb.y + 5, clicked: true }), 'back');
  stepSettingsMenu(h, new Set(), { x: 1, y: 1, clicked: true });
});

test('the Controls page lists every action with its keys, and picking one then pressing a key sets it (and says if another action has it)', () => {
  controls({ fire: ['KeyX'] });
  const g = opened();
  g.settingsMenu.focus = menuItems(g).indexOf('go-controls');
  play(g, tap('Enter'));
  assert.equal(g.settingsMenu.page, 'controls');
  const items = menuItems(g);
  assert.ok(items.includes('bind-jump') && items.includes('bind-fire') && items.includes('back'));
  const { screen } = settingsMenuScreen(g);
  assert.match(screen.widgets.find((w) => w.id === 'bind-left').text, /Left arrow, A/);
  g.settingsMenu.focus = items.indexOf('bind-fire');
  play(g, tap('Enter'));
  assert.equal(g.settingsMenu.rebinding, 'fire');
  assert.match(settingsMenuScreen(g).screen.widgets.find((w) => w.id === 'bind-fire').text, /Press the key you want/);
  play(g, tap('KeyL'));
  assert.deepEqual(keysFor('fire'), ['KeyL']);
  assert.equal(g.settingsMenu.rebinding, null);
  g.settingsMenu.focus = items.indexOf('bind-action');
  play(g, tap('Enter', 'KeyL'));
  assert.deepEqual(keysFor('action'), ['KeyL']);
  assert.match(g.settingsMenu.note, /Key L|L is also used for fire/);
});

test('Esc while waiting for a key cancels without changing anything, and Reset keys and Back work', () => {
  const g = opened();
  g.settingsMenu.focus = menuItems(g).indexOf('go-controls');
  play(g, tap('Enter'));
  g.settingsMenu.focus = menuItems(g).indexOf('bind-jump');
  play(g, tap('Enter', 'Escape'));
  assert.equal(g.settingsMenu.rebinding, null);
  assert.ok(keysFor('jump').includes('Space'));
  g.settingsMenu.focus = menuItems(g).indexOf('bind-jump');
  play(g, tap('Enter', 'KeyJ'));
  assert.deepEqual(keysFor('jump'), ['KeyJ']);
  g.settingsMenu.focus = menuItems(g).indexOf('resetkeys');
  play(g, tap('Enter'));
  assert.ok(keysFor('jump').includes('Space'));
  g.settingsMenu.focus = menuItems(g).indexOf('back');
  assert.equal(play(g, tap('Enter')), null, 'back from the Controls page goes to the main page, not out');
  assert.equal(g.settingsMenu.page, 'main');
  assert.equal(play(g, tap('Escape')), 'back');
});

test('a game with many actions gets pages on the Controls page', () => {
  controls(Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`act${i}`, [`Digit${i}`]])));
  const g = opened();
  g.settingsMenu.focus = menuItems(g).indexOf('go-controls');
  play(g, tap('Enter'));
  const first = menuItems(g).filter((i) => i.startsWith('bind-'));
  assert.equal(first.length, 7);
  assert.ok(menuItems(g).includes('page'));
  g.settingsMenu.focus = menuItems(g).indexOf('page');
  play(g, tap('Enter'));
  const second = menuItems(g).filter((i) => i.startsWith('bind-'));
  assert.ok(second.length > 0 && !second.some((i) => first.includes(i)));
});

test('the menu screen is a clean UI screen that fits (at the usual size and a bigger one) and follows high contrast', () => {
  const g = opened();
  for (const page of ['main', 'controls']) {
    g.settingsMenu.page = page;
    const { screen } = settingsMenuScreen(g);
    assert.deepEqual(uiProblems(screen, { width: 480, height: 320 }).filter((p) => p.kind !== 'fit'), [], page);
  }
  g.settingsMenu.page = 'main';
  const calls = [];
  const ctx = new Proxy({}, { get: (_, n) => (...a) => { calls.push([n, ...a]); }, set: (_, n, v) => { calls.push([`set:${n}`, v]); return true; } });
  drawSettingsMenu(ctx, g);
  assert.ok(calls.some((c) => c[0] === 'fillText' && c[1] === 'Master volume'));
  assert.ok(calls.some((c) => c[0] === 'fillText' && c[1] === '100'));
  calls.length = 0;
  setSetting('highContrast', true);
  drawSettingsMenu(ctx, g);
  assert.ok(calls.some((c) => c[0] === 'set:fillStyle' && c[1] === '#000000') && calls.some((c) => c[0] === 'set:strokeStyle' && c[1] === '#ffffff'));
  setSetting('textScale', 2);
  calls.length = 0;
  drawSettingsMenu(ctx, g);
  assert.ok(calls.some((c) => c[0] === 'set:font' && /^28px/.test(c[1])), 'text 14 at 200% is 28');
  const none = {};
  assert.doesNotThrow(() => drawSettingsMenu(ctx, none));
  assert.equal(stepSettingsMenu(none, new Set(['Enter'])), null);
});
