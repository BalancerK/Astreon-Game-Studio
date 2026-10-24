import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fuzzyMatch, rank } from '../app/util/fuzzy.js';
import { parseCombo, comboMatches, formatCombo, normalizeCombo, isMac } from '../app/util/keys.js';
import { Emitter } from '../app/util/emitter.js';
import { CommandRegistry } from '../app/core/commands.js';
import { Settings, SCHEMA, clean } from '../app/core/settings.js';

// ---------- fuzzy search ----------
test('fuzzy: letters must appear in order, case is ignored, and the matched positions are returned for highlighting', () => {
  assert.equal(fuzzyMatch('xyz', 'Play game'), null);
  assert.deepEqual(fuzzyMatch('ga', 'a game').indices, [2, 3], 'the g of "game", then its a');
  assert.deepEqual(fuzzyMatch('pg', 'Play game').indices, [0, 5]);
  assert.deepEqual(fuzzyMatch('PLAY', 'play game').indices, [0, 1, 2, 3]);
  assert.deepEqual(fuzzyMatch('', 'anything'), { score: 0, indices: [] });
  assert.equal(fuzzyMatch('abcd', 'abc'), null, 'a query longer than the text cannot match');
  assert.equal(fuzzyMatch('a'.repeat(5), 'a'.repeat(300)), null, 'very long text is not aligned');
});

test('fuzzy: an exact match beats a prefix, a prefix beats a word start, a word start beats letters scattered through a word', () => {
  const s = (q, t) => fuzzyMatch(q, t).score;
  assert.ok(s('run', 'run') > s('run', 'run game'));
  assert.ok(s('run', 'run game') > s('run', 'restart game and run'));
  assert.ok(s('rg', 'Run game') > s('rg', 'program'), 'letters that start words are worth more');
  assert.ok(s('file', 'File: new') > s('file', 'profile settings'));
  assert.ok(s('pl', 'Play') > s('pl', 'Apple'), 'the start of the text is worth more than the middle');
  const camel = fuzzyMatch('gs', 'goToScene'); assert.deepEqual(camel.indices, [0, 4], 'a capital letter inside a word counts as a word start');
  const path = fuzzyMatch('um', 'src/util/main.js'); assert.deepEqual(path.indices, [4, 9], 'after a slash too');
});

test('fuzzy: consecutive letters are chosen over scattered ones when both are possible', () => {
  const m = fuzzyMatch('rest', 'reset restart'); assert.deepEqual(m.indices, [6, 7, 8, 9], 'the whole word "rest" in "restart", not r-e-s-t spread over "reset"');
});

test('rank: best first, equal scores keep the given order, recent ones win ties, extra keywords can find an item, and there is a limit', () => {
  const items = [{ id: 'a', t: 'Open file', k: ['load'] }, { id: 'b', t: 'Open data', k: [] }, { id: 'c', t: 'Restart game', k: ['open', 'again'] }, { id: 'd', t: 'Close', k: [] }];
  const text = (x) => [x.t, ...x.k];
  const r = rank(items, 'open', { text, id: (x) => x.id });
  assert.deepEqual(r.map((x) => x.item.id), ['a', 'b', 'c'], 'two titles tie, in the given order; the keyword match is worth less');
  const recent = rank(items, 'open', { text, id: (x) => x.id, recent: ['b'] });
  assert.equal(recent[0].item.id, 'b', 'a recent item wins a tie');
  assert.equal(rank(items, 'zzz', { text }).length, 0);
  assert.equal(rank(items, 'o', { text, limit: 2 }).length, 2);
  assert.deepEqual(r[0].indices, [0, 1, 2, 3], 'highlight positions refer to the title');
  const all = rank(items, '', { text, id: (x) => x.id, recent: ['d', 'c'] });
  assert.deepEqual(all.map((x) => x.item.id), ['d', 'c', 'a', 'b'], 'with nothing typed the recent ones come first');
});

test('rank: results do not reorder as a person types more letters of the same word (they only narrow)', () => {
  const items = ['Run game', 'Restart game', 'Rename file', 'Rotate view', 'Run tests'].map((t) => ({ t }));
  let previous = null;
  for (const q of ['r', 'ru', 'run']) {
    const ids = rank(items, q, { text: (x) => x.t }).map((x) => x.item.t);
    if (previous) assert.deepEqual(ids, previous.filter((t) => ids.includes(t)).sort((a, b) => ids.indexOf(a) - ids.indexOf(b)), `"${q}" keeps the relative order of what "${q.slice(0, -1)}" showed`);
    previous = ids;
  }
});

// ---------- shortcuts ----------
test('shortcuts: parsed, matched against key presses, and written the way each kind of computer writes them', () => {
  assert.deepEqual(parseCombo('Mod+Shift+P'), { ctrl: true, alt: false, shift: true, meta: false, key: 'p' });
  assert.deepEqual(parseCombo('Mod+K', true), { ctrl: false, alt: false, shift: false, meta: true, key: 'k' }, 'Mod is Command on a Mac');
  assert.equal(parseCombo('Esc').key, 'escape'); assert.equal(parseCombo('Ctrl+Space').key, ' '); assert.equal(parseCombo('Ctrl++').key, '+');
  assert.throws(() => parseCombo('Ctrl+'), /needs a key/); assert.throws(() => parseCombo(''), /needs a key/);
  const press = (key, mods = {}) => ({ key, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...mods });
  assert.ok(comboMatches('Mod+K', press('k', { ctrlKey: true }))); assert.ok(comboMatches('Mod+K', press('K', { ctrlKey: true })), 'caps lock or shift does not change the letter');
  assert.ok(!comboMatches('Mod+K', press('k'))); assert.ok(!comboMatches('Mod+K', press('k', { ctrlKey: true, shiftKey: true })), 'an extra Shift is a different shortcut');
  assert.ok(!comboMatches('Mod+K', press('k', { ctrlKey: true, altKey: true }))); assert.ok(comboMatches('Mod+K', press('k', { metaKey: true }), true));
  assert.ok(comboMatches('F1', press('F1'))); assert.ok(comboMatches('?', press('?', { shiftKey: true })) && comboMatches('?', press('?')), 'Shift is not compared for symbols');
  assert.equal(formatCombo('Mod+Shift+P'), 'Ctrl+Shift+P'); assert.equal(formatCombo('Mod+Shift+P', true), '⇧⌘P'); assert.equal(formatCombo('Escape'), 'Esc'); assert.equal(formatCombo('Alt+ArrowLeft'), 'Alt+←');
  assert.equal(normalizeCombo('shift+ctrl+p'), normalizeCombo('Ctrl+Shift+P'), 'the order of modifiers does not matter');
  assert.equal(isMac({ platform: 'MacIntel' }), true); assert.equal(isMac({ platform: 'Win32', userAgent: 'Windows' }), false);
});

// ---------- emitter ----------
test('emitter: listeners run in order, can be removed, run once on request, and one that throws does not stop the others', () => {
  const e = new Emitter(); const log = [];
  const off = e.on('x', (v) => log.push(`a${v}`)); e.on('x', () => { throw new Error('boom'); }); e.once('x', (v) => log.push(`once${v}`)); e.on('x', (v) => log.push(`b${v}`));
  const errors = []; const before = Emitter.onError; Emitter.onError = (err) => errors.push(err.message);
  e.emit('x', 1); off(); e.emit('x', 2); Emitter.onError = before;
  assert.deepEqual(log, ['a1', 'once1', 'b1', 'b2']); assert.deepEqual(errors, ['boom', 'boom'], 'the failure is reported, not swallowed');
});

// ---------- commands ----------
test('commands: registered, found, run, hidden while disabled, removable, and the most recent come first', async () => {
  const reg = new CommandRegistry(); const ran = [];
  let ready = false;
  const off = reg.register({ id: 'file.new', title: 'New file', category: 'File', keywords: ['create'], shortcut: 'Mod+N', run: () => { ran.push('new'); return 42; } });
  reg.register({ id: 'game.run', title: 'Run game', run: () => ran.push('run'), enabled: () => ready });
  assert.deepEqual(reg.list().map((c) => c.id), ['file.new'], 'a disabled command is not offered');
  ready = true; assert.equal(reg.list().length, 2);
  assert.equal(await reg.execute('file.new'), 42);
  ready = false; await assert.rejects(reg.execute('game.run'), /cannot be used right now/); await assert.rejects(reg.execute('nope'), /no command/);
  assert.throws(() => reg.register({ id: 'file.new', title: 'x', run() {} }), /already a command/); assert.throws(() => reg.register({ id: 'x' }), /needs an id/);
  assert.throws(() => reg.register({ id: 'bad', title: 'x', shortcut: 'Ctrl+', run() {} }), /needs a key/, 'an unreadable shortcut is refused when registering');
  ready = true; await reg.execute('game.run'); assert.deepEqual(reg.recent, ['game.run', 'file.new']);
  off(); assert.equal(reg.get('file.new'), undefined);
});

test('commands: shortcuts run commands, can be changed and cleared, clashes are found, and saved choices are loaded safely', async () => {
  const reg = new CommandRegistry(); const ran = [];
  reg.register({ id: 'a', title: 'A', shortcut: 'Mod+1', run: () => ran.push('a') }); reg.register({ id: 'b', title: 'B', shortcut: 'Mod+2', run: () => ran.push('b'), enabled: () => false });
  reg.register({ id: 'c', title: 'C', run: () => ran.push('c') });
  const press = (key, ctrlKey = true) => ({ key, ctrlKey });
  assert.equal(reg.handleKey(press('1')), true); await new Promise((r) => setTimeout(r, 5)); assert.deepEqual(ran, ['a']);
  assert.equal(reg.handleKey(press('2')), false, 'a disabled command does not take its shortcut'); assert.equal(reg.handleKey(press('9')), false);
  assert.deepEqual(reg.rebind('c', 'Mod+1'), ['a'], 'a clash is reported, not refused'); assert.deepEqual(reg.allConflicts(), [{ shortcut: 'ctrl+1', ids: ['a', 'c'] }]);
  reg.rebind('c', 'Mod+3'); assert.deepEqual(reg.allConflicts(), []); assert.equal(reg.shortcutLabel('c'), 'Ctrl+3');
  reg.rebind('a', null); assert.equal(reg.shortcutOf('a'), undefined, 'cleared: no shortcut, even though it has a default');
  assert.deepEqual(reg.overrides, { c: 'Mod+3', a: null });
  const other = new CommandRegistry(); other.register({ id: 'a', title: 'A', shortcut: 'Mod+1', run() {} });
  other.loadOverrides({ a: 'Mod+5', gone: 'Mod+6', broken: 'Ctrl+' }); assert.equal(other.shortcutOf('a'), 'Mod+5');
  other.resetShortcuts(); assert.equal(other.shortcutOf('a'), 'Mod+1'); assert.throws(() => reg.rebind('zzz', 'Mod+1'), /no command/);
});

// ---------- settings ----------
test('settings: defaults, valid values only, saved and restored, damaged saves repaired', () => {
  const store = new Map(); const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  const s = new Settings(storage); const changes = [];
  s.on('change', (n, v) => changes.push([n, v]));
  assert.equal(s.get('theme'), 'system'); assert.equal(s.get('fontSize'), 14);
  assert.equal(s.set('fontSize', 200), 28, 'too big: the largest allowed'); assert.equal(s.set('fontSize', 3), 11); assert.equal(s.set('fontSize', 15.4), 15, 'rounded to the step');
  assert.equal(s.set('theme', 'neon'), 'system', 'not one of the choices: the default'); assert.equal(s.set('reduceMotion', 'yes'), false);
  assert.equal(s.set('theme', 'dark'), 'dark'); assert.throws(() => s.get('nope'), /no setting/); assert.throws(() => s.set('nope', 1), /no setting/);
  assert.deepEqual(changes, [['fontSize', 28], ['fontSize', 11], ['fontSize', 15], ['theme', 'dark']], 'only real changes are announced');
  const again = new Settings(storage); assert.equal(again.get('theme'), 'dark'); assert.equal(again.get('fontSize'), 15);
  store.set('studio.settings', JSON.stringify({ fontSize: 'big', theme: 'light', tabSize: 99, unknown: 1 }));
  const damaged = new Settings(storage); assert.equal(damaged.get('fontSize'), 14); assert.equal(damaged.get('theme'), 'light'); assert.equal(damaged.get('tabSize'), 8);
  store.set('studio.settings', '{not json'); assert.equal(new Settings(storage).get('theme'), 'system', 'an unreadable save is ignored');
  s.reset(); assert.equal(s.get('theme'), 'system'); assert.equal(new Settings(null).get('theme'), 'system', 'no storage at all still works');
  assert.deepEqual(Object.keys(s.toJSON()), Object.keys(SCHEMA)); assert.equal(clean({ type: 'number', default: 5, min: 1, max: 9 }, NaN), 5);
});
