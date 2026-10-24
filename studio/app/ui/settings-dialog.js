// The settings dialog and the keyboard shortcut list (with changing shortcuts). Both are built from the same data the rest of the studio uses: the settings
// schema and the command registry, so a new setting or command appears here without anyone remembering to add it.
import { h, button, fill } from './dom.js';
import { showDialog } from './dialog.js';
import { formatCombo } from '../util/keys.js';

/** @param {import('../core/studio.js').Studio} studio */
export function openSettings(studio) {
  const s = studio.settings;
  const grid = h('div', { class: 'settings-grid' });
  const draw = () => {
    fill(grid, Object.entries(s.schema).flatMap(([name, def]) => {
      const id = `setting-${name}`;
      let control;
      if (def.type === 'choice') {
        const options = def.choices.map((c) => h('option', {
          value: c, text: def.names?.[c] ?? c[0].toUpperCase() + c.slice(1), selected: c === s.get(name),
        }));
        control = h('select', { id, on: { change: () => { s.set(name, control.value); } } }, options);
      } else if (def.type === 'boolean') {
        control = h('input', { id, type: 'checkbox', checked: s.get(name), on: { change: () => { s.set(name, control.checked); } } });
      } else {
        control = h('input', {
          id, type: 'number', min: def.min, max: def.max, step: def.step ?? 1, value: s.get(name), style: { width: '90px' },
          on: { change: () => { control.value = s.set(name, Number(control.value)); } },
        });
      }
      return [h('label', { for: id, text: def.label }), control];
    }));
  };
  draw();
  const span = (cls, text) => h('span', { class: cls, text });
  const NL = String.fromCharCode(10);
  const sample = h('pre', { class: 'ed-sample', aria: { hidden: true } },
    span('c', `// make the hero jump${NL}`), span('k', 'function '), span('f', 'update'), `(game, keys) {${NL}  `, span('k', 'const '), 'speed = ',
    span('n', '160'), `;${NL}  `, span('k', 'if'), ' (keys.has(', span('s', "'Space'"), ')) ', span('f', 'jump'), '(hero, ',
    span('n', '620'), `);${NL}  `,
    span('f', 'label'), '(g, ', span('s', '"Coins "'), ' + game.score, ', span('n', '8'), `);${NL}}`);
  const body = h('div', {}, h('p', { text: 'These are kept on this computer.' }), sample, grid);
  return showDialog({
    title: 'Settings', body,
    buttons: [{ label: 'Reset to defaults', value: 'reset', danger: true }, { label: 'Done', value: 'done', primary: true }],
    beforeClose: (value) => { if (value === 'reset') { s.reset(); draw(); return false; } return true; },
  });
}

/** Every command with its shortcut; each can be given another one. */
export function openShortcuts(studio) {
  const reg = studio.commands;
  const table = h('table', { class: 'shortcuts' });
  const note = h('div', { class: 'error', role: 'status' });
  const draw = () => {
    const byName = (a, b) => (a.category ?? '').localeCompare(b.category ?? '') || a.title.localeCompare(b.title);
    const cmds = reg.list({ includeDisabled: true }).filter((c) => !c.id.startsWith('setting.')).sort(byName);
    fill(table, cmds.map((c) => h('tr', {},
      h('td', { text: c.category ? `${c.category}: ${c.title}` : c.title }),
      h('td', {}, reg.shortcutOf(c.id) ? h('kbd', { text: reg.shortcutLabel(c.id) }) : h('span', { text: 'none', style: { color: 'var(--dim)' } })),
      h('td', {}, button({ text: 'Change', class: 'small ghost', label: `Change the shortcut for ${c.title}`, onClick: () => capture(c) }),
        reg.shortcutOf(c.id)
          ? button({
            text: 'Clear', class: 'small ghost', label: `Remove the shortcut for ${c.title}`,
            onClick: () => { reg.rebind(c.id, null); draw(); },
          })
          : null))));
  };
  async function capture(c) {
    let combo = null;
    const ask = h('p', { text: 'Press the keys you want to use (Esc to cancel).' });
    const done = showDialog({ title: `Shortcut for “${c.title}”`, body: ask, buttons: [{ label: 'Cancel', value: false }] });
    const onKey = (e) => {
      if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') return;
      const key = e.key.length === 1 ? e.key.toUpperCase() : e.key;
      const parts = [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Meta', key].filter(Boolean);
      combo = parts.join('+');
      [...document.querySelectorAll('.overlay')].pop()?.querySelector('.btn')?.click();       // the question on top closes with what was pressed
    };
    addEventListener('keydown', onKey, true);
    await done;
    removeEventListener('keydown', onKey, true);
    if (combo) {
      try {
        const clashes = reg.rebind(c.id, combo);
        const others = clashes.map((id) => reg.get(id)?.title).join(', ');
        note.textContent = clashes.length ? `${formatCombo(combo, studio.mac)} is also used by ${others}.` : '';
      } catch (error) {
        note.textContent = error.message;
      }
    }
    draw();
  }
  draw();
  return showDialog({
    title: 'Keyboard shortcuts', body: h('div', { style: { maxHeight: '55vh', overflow: 'auto' } }, table, note),
    buttons: [{ label: 'Reset all', value: 'reset', danger: true }, { label: 'Done', value: 'done', primary: true }],
    beforeClose: (value) => { if (value === 'reset') { reg.resetShortcuts(); draw(); return false; } return true; },
  });
}
