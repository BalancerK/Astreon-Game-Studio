// The Kinds panel: what each kind of thing is. A kind has a template (its size, colour and emoji when it is first placed in the Scene panel) and fields, each with a type: a number
// with a smallest and a largest, some text, a yes-or-no, one choice from a list, or a pointer to another thing by its name (a button that opens THAT door). The Scene panel shows
// these fields for every thing of the kind, and the game gets them with `loadScene(game, scene, kinds)`. Kept in `src/kinds.js`.
import { h, button, fill } from '../ui/dom.js';
import { promptText } from '../ui/dialog.js';
import * as M from '../paint/kinds-model.js';

const FILE = 'src/kinds.js';
const HINT = 'A kind says what a thing is: a door that can be locked, a button that opens a particular door, an enemy with hit points and a mood. '
  + 'Pick a ready-made one and change it.';
const SNIPPET = [
  "import kinds from './kinds.js';",
  "import scene from '../scenes/rooms.js';",
  "import { loadScene, refOf } from '@engine/arcade';",
  '',
  '// in create():   const world = loadScene(game, scene, kinds);   // every thing gets the fields of its kind',
  '// later:         const door = refOf(game, button, "opens");      // the door this button points at',
  '//                if (door) door.locked = false;',
].join('\n');
const TYPE_WORDS = { number: 'A number', text: 'Some text', flag: 'Yes or no', choice: 'A choice', ref: 'A pointer to another thing' };

export function kindsPanel(studio) {
  return {
    id: 'kinds',
    title: 'Kinds',
    icon: 'edit',
    create() {
      let table = {};
      let current = null;
      let lastWritten = '';
      let saveTimer = 0;
      let problem = '';
      let newType = 'number';

      const picker = h('select', { class: 'art-select', aria: { label: 'Kind to edit' }, on: { change: () => { current = picker.value; draw(); } } });
      const toolbar = h('div', { class: 'toolbar art-bar' });
      const template = h('fieldset', { class: 'sound-layer' });
      const fieldsBox = h('div', { class: 'kind-fields' });
      const issues = h('details', { class: 'art-help text-issues' }, h('summary'), h('ul'));
      const help = h('details', { class: 'art-help' }, h('summary', { text: 'How do I use this in my game?' }), h('pre', { class: 'learn-code',
        text: SNIPPET }));
      const empty = h('div', { class: 'empty' });
      const body = h('div', { class: 'layers-body' }, template, fieldsBox);
      const el = h('div', { class: 'panel-body art kinds', 'aria-label': 'Kinds' }, toolbar, body, issues, help, empty);
      const kind = () => table[current];

      // ---- the file ----
      function load() {
        problem = '';
        const raw = studio.project?.has(FILE) ? studio.project.readText(FILE) : null;
        lastWritten = raw ?? '';
        try { table = raw ? M.parseKinds(raw) : {}; } catch (error) { table = {}; problem = error.message; }
        if (!(current in table)) current = Object.keys(table)[0] ?? null;
        draw();
      }
      function flush() {
        clearTimeout(saveTimer);
        if (!studio.project || problem || !Object.keys(table).length) return;
        const out = M.serializeKinds(table);
        if (out === lastWritten) return;
        lastWritten = out;
        studio.project.write(FILE, out);
        studio.emit('files');
      }
      const save = () => { clearTimeout(saveTimer); saveTimer = setTimeout(flush, 250); };
      function edit(next, { redraw = true } = {}) {
        table = next;
        save();
        if (redraw) draw();
      }
      const attempt = (fn, o) => { try { edit(fn(), o); } catch (error) { studio.toasts.show(error.message, { kind: 'error' }); draw(); } };

      // ---- the controls ----
      const numberInput = (label, value, onChange, { min, max, step = 1 } = {}) => h('label', { class: 'state-line' }, `${label} `, h('input', {
        type: 'number', value: String(value ?? ''), min: min === undefined ? undefined : String(min),
          max: max === undefined ? undefined : String(max), step: String(step),
        aria: { label }, style: { width: '6em' }, on: { change: (e) => onChange(e.target.value === '' ? undefined : Number(e.target.value)) },
      }));
      function drawTemplate() {
        const t = kind().template;
        const set = (props) => attempt(() => M.setTemplate(table, current, props));
        const swatch = h('div', { class: 'kind-swatch', 'aria-hidden': 'true', style: {
          width: `${Math.min(64, t.w ?? 32)}px`, height: `${Math.min(64, t.h ?? 32)}px`, background: t.color ?? 'transparent', fontSize: '28px',
            lineHeight: '1',
        }, text: t.emoji ?? '' });
        fill(template, h('legend', { text: `The template of "${current}"` }), swatch,
          numberInput('Width', t.w, (v) => set({ w: v }), { min: 1, max: 8192 }), numberInput('Height', t.h, (v) => set({ h: v }), { min: 1,
            max: 8192 }),
          h('label', { class: 'state-line' }, 'Colour ', h('input', { type: 'color',
            value: /^#[0-9a-f]{6}$/i.test(t.color ?? '') ? t.color : '#5ac8ff', aria: { label: 'Colour' },
            on: { change: (e) => set({ color: e.target.value }) } })),
          h('label', { class: 'state-line' }, 'Emoji ', h('input', { type: 'text', value: t.emoji ?? '', maxlength: '8', placeholder: '🚪',
            style: { width: '4em' }, aria: { label: 'Emoji' },
            on: { change: (e) => set({ emoji: e.target.value.trim() }) } })),
          h('p', { class: 'dim', text: 'A thing of this kind placed in the Scene panel starts like this.' }));
      }
      function fieldRow(name, f, names) {
        const set = (props) => attempt(() => M.setField(table, current, name, props), { redraw: false });
        const setRedraw = (props) => attempt(() => M.setField(table, current, name, props));
        const details = [];
        if (f.type === 'number') {
          details.push(numberInput('Starts at', f.default, (v) => set({ default: v }), { step: f.step }), numberInput('Smallest', f.min,
            (v) => set({ min: v })),
            numberInput('Largest', f.max, (v) => set({ max: v })), numberInput('Steps of', f.step, (v) => set({ step: v }), { min: 0.001,
              step: 0.1 }));
        } else if (f.type === 'text') {
          details.push(h('label', { class: 'state-line' }, 'Starts as ', h('input', { type: 'text', value: f.default,
            aria: { label: `Starting text of ${name}` },
            on: { change: (e) => set({ default: e.target.value }) } })));
        } else if (f.type === 'flag') {
          details.push(h('label', { class: 'state-line' }, h('input', { type: 'checkbox', checked: f.default,
            on: { change: (e) => set({ default: e.target.checked }) } }), ' Starts as yes'));
        } else if (f.type === 'choice') {
          details.push(h('label', { class: 'state-line' }, 'The choices, with commas between ', h('input', { type: 'text',
            value: f.choices.join(', '), aria: { label: `Choices of ${name}` },
            on: { change: (e) => setRedraw({ choices: e.target.value }) } })),
          h('label', { class: 'state-line' }, 'Starts as ', h('select', { aria: { label: `Starting choice of ${name}` },
            on: { change: (e) => set({ default: e.target.value }) } },
            ...f.choices.map((c) => h('option', { value: c, text: c, selected: c === f.default })))));
        } else {
          details.push(h('label', { class: 'state-line' }, 'Points at a thing of the kind ', h('select',
            { aria: { label: `Kind that ${name} points at` },
            on: { change: (e) => set({ to: e.target.value }) } }, h('option', { value: '', text: '(any kind)' }), ...names.map((n) => h('option',
              { value: n, text: n, selected: n === f.to })))));
        }
        return h('div', { class: 'kind-field' },
          h('div', { class: 'layers-row' }, h('strong', { text: name }),
            h('select', { aria: { label: `Type of ${name}` }, on: { change: (e) => setRedraw({ type: e.target.value }) } },
              ...Object.entries(TYPE_WORDS).map(([t, label]) => h('option', { value: t, text: label, selected: t === f.type }))),
            button({ text: '↑', class: 'small ghost', aria: { label: `Move ${name} up` }, onClick: () => attempt(() => M.moveField(table, current,
              name, -1)) }),
            button({ text: '↓', class: 'small ghost', aria: { label: `Move ${name} down` }, onClick: () => attempt(() => M.moveField(table, current,
              name, 1)) }),
            button({ text: 'Remove', class: 'small ghost', aria: { label: `Remove the field ${name}` },
              onClick: () => attempt(() => M.removeField(table, current, name)) })),
          h('div', { class: 'toolbar' }, ...details));
      }
      function drawFields() {
        const fields = Object.entries(kind().fields);
        fill(fieldsBox, h('h4', { text: `Fields of "${current}"` }),
          ...(fields.length ? fields.map(([name, f]) => fieldRow(name, f, Object.keys(table))) : [h('p', { class: 'dim',
            text: 'No fields yet. Add one: a number for hit points, a yes-or-no for locked, a pointer to another thing.' })]),
          h('div', { class: 'toolbar' }, h('select', { aria: { label: 'Type of the new field' },
            on: { change: (e) => { newType = e.target.value; } } },
            ...Object.entries(TYPE_WORDS).map(([t, label]) => h('option', { value: t, text: label, selected: t === newType }))),
          button({ text: 'Add a field', class: 'small primary', onClick: addField })));
      }

      // ---- the whole panel ----
      function drawToolbar() {
        const names = Object.keys(table);
        fill(picker, ...names.map((n) => h('option', { value: n, text: n, selected: n === current })));
        fill(toolbar, names.length ? picker : null,
          h('select', { aria: { label: 'New kind from a ready-made one' },
            on: { change: (e) => { const k = e.target.value; e.target.value = ''; if (k) newKind(k); } } },
            h('option', { value: '', text: 'New kind from…' }), h('option', { value: 'blank', text: 'a blank kind' }),
              ...Object.keys(M.STARTERS).map((n) => h('option', { value: n, text: n }))),
          kind() ? button({ text: 'Delete', class: 'small ghost', onClick: removeKind }) : null);
      }
      function draw() {
        drawToolbar();
        const has = Boolean(kind());
        body.hidden = !has;
        help.hidden = !has;
        issues.hidden = !has;
        empty.hidden = has;
        if (!has) {
          fill(empty, h('h3', { text: problem ? 'The kinds file needs fixing' : 'No kinds yet' }), h('p', { text: problem || HINT }),
            problem ? null : h('div', { class: 'toolbar' }, ...Object.keys(M.STARTERS).map((n) => button({ text: `A ${n}`, class: 'primary',
              onClick: () => newKind(n) }))));
          return;
        }
        drawTemplate();
        drawFields();
        const found = M.kindProblems(table);
        issues.hidden = !found.length;
        issues.querySelector('summary').textContent = `${found.length} thing${found.length === 1 ? '' : 's'} to look at`;
        fill(issues.querySelector('ul'), ...found.map((p) => h('li', { class: 'text-missing', text: p.message })));
      }
      function newKind(starter) {
        const name = M.freeName(table, starter === 'blank' ? 'kind' : starter);
        table = M.addKind(table, name, starter === 'blank' ? undefined : starter);
        current = name;
        flush();
        draw();
      }
      async function addField() {
        const text = await promptText({
          title: 'Add a field', label: 'Name of the field (for example hp, locked, opens)', value: 'hp', confirmLabel: 'Add it',
          validate: (v) => M.fieldNameProblem(table, current, v.trim()),
        });
        if (text === undefined) return;
        attempt(() => M.addField(table, current, text.trim(), newType));
      }
      function removeKind() {
        const next = M.removeKind(table, current);
        table = next;
        current = Object.keys(table)[0] ?? null;
        flush();
        draw();
      }

      studio.on('file-changed', (e) => { if (e.path === FILE && studio.project?.readText(FILE) !== lastWritten) load(); });
      studio.on('project', load);
      studio.on('files', () => { if (!studio.project?.has(FILE) && !Object.keys(table).length) load(); });
      load();
      return { el, focus: () => el.querySelector('button, select')?.focus(), onShow: load, dispose: () => flush() };
    },
  };
}
