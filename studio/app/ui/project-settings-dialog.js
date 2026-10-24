// The "Project settings" dialog: the game's title, the size of its screen, its background colour and its icon. It writes project.json (see
// store/project-settings.js), so everything here is also just a text file you can open.
import { h } from './dom.js';
import { showDialog } from './dialog.js';
import { PRESETS, LIMITS, FILE, settingsOf, serialize, aspectName } from '../store/project-settings.js';

/**
 * Ask for the open project's settings and save them.
 * @param {import('../core/studio.js').Studio} studio
 * @returns {Promise<boolean>} whether anything was saved
 */
export async function editProjectSettings(studio) {
  const project = studio.project;
  if (!project) return false;
  const { settings: now, problems } = settingsOf(studio.textFiles());

  const field = (label, control, hint) => h('label', { class: 'settings-field' }, h('span', { text: label }), control,
    hint ? h('small', { class: 'dim', text: hint }) : null);
  const title = h('input', { type: 'text', value: now.title, maxlength: String(LIMITS.title), placeholder: project.name });
  const width = h('input', { type: 'number', value: String(now.width), min: String(LIMITS.min), max: String(LIMITS.max), step: '10' });
  const height = h('input', { type: 'number', value: String(now.height), min: String(LIMITS.min), max: String(LIMITS.max), step: '10' });
  const preset = h('select', { aria: { label: 'Screen size' } },
    h('option', { value: '', text: 'Custom size' }), ...PRESETS.map((p) => h('option', { value: p.id, text: p.label })));
  const shape = h('span', { class: 'dim' });
  const background = h('input',
    { type: 'color', value: now.background.length === 4 ? `#${[...now.background.slice(1)].map((c) => c + c).join('')}` : now.background });
  const pixelArt = h('input', { type: 'checkbox', checked: Boolean(now.pixelArt) });
  const letter = h('input', { type: 'text', value: now.icon.letter, maxlength: '2', placeholder: 'first letter of the title', size: '8' });
  const colour = h('input',
    { type: 'color', value: now.icon.color.length === 4 ? `#${[...now.icon.color.slice(1)].map((c) => c + c).join('')}` : now.icon.color });

  const sync = () => {
    const match = PRESETS.find((p) => p.width === Number(width.value) && p.height === Number(height.value));
    preset.value = match?.id ?? '';
    const w = Number(width.value);
    const hh = Number(height.value);
    shape.textContent = w > 0 && hh > 0 ? `Shape ${aspectName(w, hh)}${hh > w ? ', upright' : ''}` : '';
  };
  preset.addEventListener('change', () => {
    const p = PRESETS.find((x) => x.id === preset.value);
    if (p) { width.value = String(p.width); height.value = String(p.height); }
    sync();
  });
  width.addEventListener('input', sync);
  height.addEventListener('input', sync);
  sync();

  const body = h('div', { class: 'settings-dialog' },
    problems.length ? h('p', { class: 'error', role: 'alert', text: problems.join(' ') }) : null,
    field('Game title', title, 'Shown on the page and as the app name. Left empty, the project name is used.'),
    field('Screen size', preset),
    h('div', { class: 'settings-size' }, field('Width', width), field('Height', height), shape),
    field('Background colour', background, 'What clear(g) paints, and the colour behind the game on its page.'),
    field('Pixel art', pixelArt, 'Keep pictures sharp when the game is scaled up (no blurring), in the studio and in the exported game.'),
    h('div', { class: 'settings-size' }, field('Icon letter', letter), field('Icon colour', colour)),
    h('small', { class: 'dim', text: 'Saved in project.json, a plain text file in your project.' }));

  const answer = await showDialog({
    title: 'Project settings', body, initialFocus: () => title,
    buttons: [{ label: 'Cancel', value: false }, { label: 'Save', value: true, primary: true }],
  });
  if (answer !== true) return false;
  const text = serialize({
    title: title.value, width: Number(width.value), height: Number(height.value), background: background.value, pixelArt: pixelArt.checked,
    icon: { letter: letter.value, color: colour.value },
  });
  if (text === null) { if (project.has(FILE)) project.remove(FILE); } else project.write(FILE, text);
  studio.emit('files');
  studio.toasts.show('Project settings saved.', { kind: 'success' });
  studio.emit('plugin-event', 'settings-saved');
  return true;
}
