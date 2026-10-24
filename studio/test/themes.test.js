import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EDITOR_THEMES, EDITOR_THEME_NAMES, ACCENTS, FONTS, contrast, parseColor, soft, editorVars, accentVars, fontStack, ALL_VARS } from '../app/ui/themes.js';

test('colours are read, and the contrast between two of them is the standard ratio', () => {
  assert.deepEqual(parseColor('#ff8000'), [255, 128, 0, 1]);
  assert.deepEqual(parseColor('rgba(10, 20, 30, .5)'), [10, 20, 30, 0.5]);
  assert.equal(parseColor('red'), null);
  assert.ok(Math.abs(contrast('#000000', '#ffffff') - 21) < 0.01);
  assert.ok(Math.abs(contrast('#777777', '#ffffff') - 4.48) < 0.05);
  assert.equal(contrast('#fff', '#000'), 0, 'a colour it cannot read has no contrast');
  assert.equal(soft('#4f46e5', 0.11), 'rgba(79, 70, 229, 0.11)');
});

test('every code colour scheme is readable: text, comments, strings, numbers, keywords, calls, names and line numbers against its background (4.5 to 1)', () => {
  for (const [id, t] of Object.entries(EDITOR_THEMES)) {
    for (const key of ['fg', 'c', 's', 'n', 'k', 'f', 't', 'gutter']) {
      const ratio = contrast(t[key], t.bg);
      assert.ok(ratio >= 4.5, `${id}: ${key} ${t[key]} on ${t.bg} is only ${ratio.toFixed(2)}`);
    }
    assert.ok(parseColor(t.sel) && parseColor(t.cur), `${id}: selection and current line are colours`);
    // the selected text must still be readable: the selection colour laid over the background
    const [r, g, b, a] = parseColor(t.sel);
    const [br, bg2, bb] = parseColor(t.bg);
    const over = `#${[r * a + br * (1 - a), g * a + bg2 * (1 - a), b * a + bb * (1 - a)].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
    assert.ok(contrast(t.fg, over) >= 4.5, `${id}: text on the selection is only ${contrast(t.fg, over).toFixed(2)}`);
    assert.equal(t.dark, contrast(t.bg, '#000000') < contrast(t.bg, '#ffffff'), `${id}: dark is what its background says`);
  }
  assert.ok(Object.keys(EDITOR_THEMES).length >= 8);
});

test('every accent works in a light and a dark interface: the writing on a button, the accent as text, and the accent as a line or border', () => {
  const surfaces = { light: ['#ffffff', '#f4f5f9', '#eef0f6'], dark: ['#12161f', '#0b0e15', '#181d29'] };
  for (const [id, a] of Object.entries(ACCENTS)) {
    for (const mode of ['light', 'dark']) {
      const v = a[mode];
      assert.ok(contrast(v.fg, v.accent) >= 4.5, `${id} ${mode}: writing on the accent ${contrast(v.fg, v.accent).toFixed(2)}`);
      for (const surface of surfaces[mode]) assert.ok(contrast(v.accent, surface) >= 4.5, `${id} ${mode}: accent text on ${surface} ${contrast(v.accent, surface).toFixed(2)}`);
    }
  }
});

test('choices become variables, "auto" and the default accent change nothing, and everything set can be cleared', () => {
  assert.deepEqual(editorVars('auto'), {});
  assert.deepEqual(editorVars('nonsense'), {});
  assert.equal(editorVars('midnight')['--ed-bg'], '#0b1020');
  assert.equal(Object.keys(editorVars('forest')).length, 12);
  assert.deepEqual(accentVars('indigo', false), {});
  assert.equal(accentVars('teal', true)['--accent'], ACCENTS.teal.dark.accent);
  assert.equal(accentVars('teal', false)['--accent-fg'], '#ffffff');
  assert.match(accentVars('rose', false)['--accent-soft'], /^rgba\(190, 18, 60, 0\.11\)$/);
  for (const name of Object.keys(EDITOR_THEMES)) for (const key of Object.keys(editorVars(name))) assert.ok(ALL_VARS.includes(key), key);
  for (const name of Object.keys(ACCENTS)) for (const dark of [true, false]) for (const key of Object.keys(accentVars(name, dark))) assert.ok(ALL_VARS.includes(key), key);
  assert.equal(EDITOR_THEME_NAMES.auto, 'Same as the interface');
  assert.ok(fontStack('jetbrains').startsWith('"JetBrains Mono"'));
  assert.equal(fontStack('nope'), FONTS.system.stack);
  assert.ok(Object.values(FONTS).every((f) => /monospace$|Courier$/.test(f.stack)), 'every font ends in a fallback that always exists');
});
