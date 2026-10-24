// The Tables panel: a game's rules as tables you can edit like a spreadsheet (weapons, frames, enemies, items, anything with a list of records). The data is a plain file the game
// imports; a schema file beside it says what each column is. Changes are checked as you type, saved to the file a moment later, and the game picks them up like any other edit.
import { h, button, fill } from '../ui/dom.js';
import * as M from '../paint/tables-model.js';

const HOW = [
  '// Make a schema file next to your data, for example data/parts.schema.json:',
  '//   { "file": "data/parts.js",',
  '//     "tables": [ { "key": "weapons", "columns": [',
  '//        { "key": "id", "label": "Name", "type": "text" },',
  '//        { "key": "damage", "label": "Damage", "type": "number", "min": 0, "max": 500 } ] } ] }',
  '// and the data file, data/parts.js:   export default { "weapons": [ { "id": "rifle", "damage": 7 } ] };',
  '// Column types: text, number, bool, enum (with "options"), color. A column called "id" names each row.',
].join('\n');
const CELL = { whiteSpace: 'nowrap', padding: '2px 6px', verticalAlign: 'middle' };
const NO_TABLES = 'No tables yet: add a schema file (name.schema.json) that describes your data. See "How do I make a table?" below.';

export function tablesPanel(studio) {
  return {
    id: 'tables',
    title: 'Tables',
    icon: 'edit',
    create() {
      let schemaPath = null;
      let schema = null;
      let data = null;
      let tableKey = null;
      let lastWritten = '';
      let saveTimer = 0;
      let problem = '';
      const toolbar = h('div', { class: 'toolbar art-bar' });
      const tabs = h('div', { class: 'toolbar' });
      const grid = h('div', { class: 'tables-grid', style: { overflow: 'auto' } });
      const issues = h('ul', { class: 'art-help', role: 'status' });
      const note = h('p', { class: 'lab-explain', role: 'status' });
      const help = h('details', { class: 'art-help' }, h('summary', { text: 'How do I make a table?' }),
        h('pre', { class: 'learn-code', text: HOW }));
      const el = h('div', { class: 'panel-body art', 'aria-label': 'Tables' }, toolbar, note, tabs, grid, issues, help);
      const schemas = () => M.findSchemas(studio.project?.list() ?? []);

      function readData() {
        if (!studio.project.has(schema.file)) {
          problem = `The data file ${schema.file} is not in the project yet. Press "Make the file".`;
          return;
        }
        try {
          lastWritten = studio.project.readText(schema.file);
          data = M.parseData(lastWritten);
        } catch (error) { problem = error.message; }
      }
      function load() {
        problem = '';
        schema = null;
        data = null;
        const files = schemas();
        if (!schemaPath || !files.includes(schemaPath)) schemaPath = files[0] ?? null;
        if (schemaPath) {
          const r = M.readSchema(studio.project.readText(schemaPath));
          schema = r.schema;
          problem = r.problems.join(' ');
          if (schema) readData();
        }
        if (schema && !schema.tables.some((t) => t.key === tableKey)) tableKey = schema.tables[0]?.key ?? null;
        draw();
      }
      function flush() {
        clearTimeout(saveTimer);
        if (!studio.project || !schema || !data) return;
        const out = M.serializeData(data);
        if (out === lastWritten) return;
        lastWritten = out;
        studio.project.write(schema.file, out);
        studio.emit('files');
      }
      const edit = (next, redraw = true) => {
        data = next;
        clearTimeout(saveTimer);
        saveTimer = setTimeout(flush, 300);
        if (redraw) draw(); else drawIssues();
      };
      const attempt = (fn, redraw = true) => {
        try { edit(fn(), redraw); } catch (error) { studio.toasts.show(error.message, { kind: 'error' }); }
      };

      function drawIssues() {
        const found = schema && data ? M.validateData(data, schema) : [];
        const more = found.length > 12 ? h('li', { text: `…and ${found.length - 12} more.` }) : null;
        fill(issues, ...found.slice(0, 12).map((p) => h('li', { text: p })), more);
        issues.hidden = found.length === 0;
      }

      /** The box for one cell, of the right kind for its column. */
      function cell(table, row, i, column) {
        const label = `${table.title} row ${i + 1}, ${column.label}`;
        const value = row[column.key];
        const set = (v, redraw = false) => attempt(() => M.setCell(data, table, i, column.key, v), redraw);
        if (column.type === 'bool') {
          return h('input', { type: 'checkbox', checked: Boolean(value), aria: { label }, on: { change: (e) => set(e.target.checked) } });
        }
        if (column.type === 'enum') {
          const options = column.options.map((o) => h('option', { value: o, text: o, selected: o === value }));
          return h('select', { aria: { label }, on: { change: (e) => set(e.target.value) } }, ...options);
        }
        if (column.type === 'color') {
          const colour = /^#[0-9a-f]{6}$/i.test(String(value)) ? value : '#000000';
          return h('input', { type: 'color', value: colour, aria: { label }, on: { input: (e) => set(e.target.value) } });
        }
        if (column.type === 'number') {
          const bound = (v) => (v === undefined ? undefined : String(v));
          return h('input', {
            type: 'number', value: value === null || value === undefined ? '' : String(value), step: String(column.step ?? 'any'),
            min: bound(column.min), max: bound(column.max), title: column.help, aria: { label }, style: { width: '6em' },
            on: { change: (e) => set(e.target.value) },
          });
        }
        const width = column.key === 'description' ? '22em' : '9em';
        return h('input', {
          type: 'text', value: String(value ?? ''), title: column.help, aria: { label }, style: { width },
          on: { change: (e) => set(e.target.value, true) },
        });
      }

      function rowButtons(table, i) {
        const small = (text, label, fn) => button({ text, class: 'small ghost', label, onClick: () => attempt(fn) });
        return h('td', { style: CELL },
          small('↑', `Move row ${i + 1} up`, () => M.moveRow(data, table, i, -1)),
          small('↓', `Move row ${i + 1} down`, () => M.moveRow(data, table, i, 1)),
          small('Copy', `Copy row ${i + 1}`, () => M.duplicateRow(data, table, i).data),
          small('Remove', `Remove row ${i + 1}`, () => M.removeRow(data, table, i)));
      }

      function drawToolbar() {
        const files = schemas();
        const pick = (e) => { schemaPath = e.target.value; load(); };
        const choose = files.length > 1 ? h('select', { aria: { label: 'The tables file' }, on: { change: pick } },
          ...files.map((p) => h('option', { value: p, text: p, selected: p === schemaPath }))) : null;
        const missing = schema && !studio.project?.has(schema.file);
        const make = missing ? button({ text: 'Make the file', class: 'small', label: 'Make the file', onClick: makeFile }) : null;
        fill(toolbar, choose, button({ text: 'Reload the file', class: 'small ghost', label: 'Reload the file', onClick: load }), make);
        const counts = schema ? schema.tables.map((t) => `${M.rowsOf(data ?? {}, t).length} ${t.title.toLowerCase()}`).join(', ') : '';
        note.textContent = problem || (schema ? `${schema.title}: ${counts}.` : files.length ? 'Choose a tables file.' : NO_TABLES);
      }

      function draw() {
        drawToolbar();
        fill(tabs, ...(schema?.tables ?? []).map((t) => button({
          text: t.title, class: `small${t.key === tableKey ? ' primary' : ''}`, label: t.title, aria: { pressed: String(t.key === tableKey) },
          onClick: () => { tableKey = t.key; draw(); },
        })));
        const table = schema?.tables.find((t) => t.key === tableKey);
        if (!table || !data) { fill(grid); drawIssues(); return; }
        const names = table.columns.map((c) => h('th', { text: c.label, title: c.help ?? '' }));
        const head = h('tr', {}, h('th', { text: '' }), ...names, h('th', { text: '' }));
        const body = M.rowsOf(data, table).map((row, i) => h('tr', {},
          h('td', { text: String(i + 1), class: 'dim', style: CELL }), ...table.columns.map((c) => h('td', { style: CELL }, cell(table, row, i, c))),
          rowButtons(table, i)));
        const add = `Add a row to ${table.title}`;
        fill(grid, h('table', { class: 'tables' }, h('thead', {}, head), h('tbody', {}, ...body)),
          button({ text: add, class: 'small primary', label: add, onClick: () => attempt(() => M.addRow(data, table).data) }));
        drawIssues();
      }

      function makeFile() {
        if (!schema) return;
        studio.project.write(schema.file, M.serializeData(Object.fromEntries(schema.tables.map((t) => [t.key, []]))));
        studio.emit('files');
        load();
      }

      studio.on('files', () => {
        const dataChanged = schema && studio.project?.has(schema.file) && studio.project.readText(schema.file) !== lastWritten;
        if (dataChanged || schemas().join() !== (schemaPath ?? '')) load();
      });
      load();
      el.tables = { get data() { return data; }, get schema() { return schema; }, flush };     // so a test can look at what the panel holds
      return {
        el, focus: () => grid.querySelector('input, select, button')?.focus(), dispose: () => flush(),
        expose: { get data() { return data; } },
      };
    },
  };
}
