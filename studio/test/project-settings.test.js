import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanSettings, settingsOf, serialize, aspectName, DEFAULTS, LIMITS, PRESETS, FILE } from '../app/store/project-settings.js';

test('no file, an empty file or a damaged file mean the usual settings, and say what was wrong', () => {
  assert.deepEqual(settingsOf({}).settings, DEFAULTS); assert.deepEqual(settingsOf({}).problems, []);
  assert.deepEqual(settingsOf({ [FILE]: '  ' }).settings, DEFAULTS);
  const broken = settingsOf({ [FILE]: '{ nope' }); assert.deepEqual(broken.settings, DEFAULTS); assert.match(broken.problems[0], /not valid JSON/);
  assert.match(settingsOf({ [FILE]: '[1,2]' }).problems[0], /curly braces/);
});

test('every field is checked on its own: one bad value does not spoil the others', () => {
  const r = cleanSettings({ title: 5, width: 'wide', height: 400, background: 'red', icon: { letter: 'zebra', color: 'nope' } });
  assert.equal(r.settings.title, ''); assert.equal(r.settings.width, 480); assert.equal(r.settings.height, 400);
  assert.equal(r.settings.background, DEFAULTS.background); assert.deepEqual(r.settings.icon, { letter: 'z', color: DEFAULTS.icon.color });
  assert.equal(r.problems.length, 3);
  const ok = cleanSettings({ title: '  My\nGame  ', width: 800.4, height: 450, background: '#abc', icon: { letter: ' é', color: '#ff0000' } }).settings;
  assert.deepEqual(ok, { title: 'My Game', width: 800, height: 450, background: '#abc', pixelArt: false, icon: { letter: 'é', color: '#ff0000' } });
});

test('the screen size is kept between the limits, so a game can never ask for a huge or empty canvas', () => {
  const small = cleanSettings({ width: 5, height: 99999 });
  assert.equal(small.settings.width, LIMITS.min); assert.equal(small.settings.height, LIMITS.max); assert.match(small.problems[0], /between 120 and 1920/);
  assert.equal(cleanSettings({ width: NaN }).settings.width, 480);
  assert.equal(cleanSettings({ title: 'x'.repeat(200) }).settings.title.length, LIMITS.title);
  for (const p of PRESETS) assert.ok(p.width >= LIMITS.min && p.height <= LIMITS.max, p.id);
});

test('writing settings keeps only what differs, reads back exactly, and a project that changes nothing has no file', () => {
  assert.equal(serialize(DEFAULTS), null);
  const mine = { title: 'Frog', width: 360, height: 640, background: '#101820', pixelArt: false, icon: { letter: 'F', color: '#22aa44' } };
  const text = serialize(mine);
  assert.deepEqual(JSON.parse(text), { title: 'Frog', width: 360, height: 640, background: '#101820', icon: mine.icon }); assert.ok(text.endsWith('\n'));
  assert.deepEqual(settingsOf({ [FILE]: text }).settings, mine);
  assert.deepEqual(JSON.parse(serialize({ ...DEFAULTS, width: 640 })), { width: 640 });
});

test('aspect names: usual ratios by name, odd ones as a number', () => {
  assert.equal(aspectName(480, 320), '3:2'); assert.equal(aspectName(640, 360), '16:9'); assert.equal(aspectName(360, 640), '9:16'); assert.equal(aspectName(400, 400), '1:1');
  assert.equal(aspectName(997, 313), '3.19:1');
});

test('pixel art is off unless asked for, must be true or false, and is only written when on', () => {
  assert.equal(cleanSettings({}).settings.pixelArt, false);
  assert.equal(cleanSettings({ pixelArt: true }).settings.pixelArt, true);
  const bad = cleanSettings({ pixelArt: 'yes' });
  assert.equal(bad.settings.pixelArt, false);
  assert.ok(bad.problems.some((p) => /pixelArt/.test(p)));
  assert.equal(serialize({ pixelArt: false }), null);
  assert.deepEqual(JSON.parse(serialize({ pixelArt: true })), { pixelArt: true });
});
