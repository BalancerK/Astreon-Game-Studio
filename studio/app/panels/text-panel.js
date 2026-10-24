// The Text panel: a game's words in every language, as a table. One row for each key (`start`, `coins.one`...), one column for each language; the first language is the
// one the others fall back to. Empty boxes show what is missing, a line below lists what looks wrong, "Preview as" shows what the player would see (including the
// stretched, accented test text that finds words that do not fit), and a spreadsheet (CSV) goes out to a translator and comes back. Kept in `src/text.js`; the game
// reads it with `text(words)` and `t('start')` from @engine/arcade.
import { h, button, fill } from '../ui/dom.js';
import { promptText } from '../ui/dialog.js';
import * as M from '../paint/text-model.js';
import { text as setTable, t as lookup, setPseudo, setLanguage } from '../../../packages/arcade/src/text.js';

const FILE = 'src/text.js';
const SHOWN = 400;                                      // rows drawn at once (a filter finds the rest)
const SAMPLE = { zero: 0, one: 1, two: 2, few: 3, many: 5, other: 5 };
const TEST = '*test*';
const HINT = 'Put the words of your game in a table, one column for each language, and show them with t(\'key\'). '
  + 'Then adding a language never means changing the code.';

function download(name, body, type) {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function textPanel(studio) {
  return {
    id: 'text',
    title: 'Text',
    icon: 'edit',
    create() {
      let tables = {};
      let lastWritten = '';
      let saveTimer = 0;
      let problem = '';
      let filter = '';
      let previewAs = '';                               // '' = the first language, a code, or TEST

      const toolbar = h('div', { class: 'toolbar art-bar' });
      const grid = h('div', { class: 'text-grid' });
      const issues = h('details', { class: 'art-help text-issues' }, h('summary'), h('ul'));
      const help = h('details', { class: 'art-help' }, h('summary', { text: 'How do I use this in my game?' }), h('pre', { class: 'learn-code' }));
      const empty = h('div', { class: 'empty' });
      const el = h('div', { class: 'panel-body art text', 'aria-label': 'Text and languages' }, toolbar, grid, issues, help, empty);
      const codes = () => Object.keys(tables);

      // ---- the file ----
      function load() {
        problem = '';
        const raw = studio.project?.has(FILE) ? studio.project.readText(FILE) : null;
        lastWritten = raw ?? '';
        try { tables = raw ? M.parseText(raw) : {}; } catch (error) { tables = {}; problem = error.message; }
        draw();
      }
      function flush() {
        clearTimeout(saveTimer);
        if (!studio.project || problem || !codes().length) return;
        const out = M.serializeText(tables);
        if (out === lastWritten) return;
        lastWritten = out;
        studio.project.write(FILE, out);
        studio.emit('files');
      }
      const save = () => { clearTimeout(saveTimer); saveTimer = setTimeout(flush, 250); };
      function change(next, { redraw = true } = {}) {
        if (next === tables) return;
        tables = next;
        save();
        if (redraw) draw(); else drawSummary();
      }

      // ---- what the player sees ----
      function preview(key) {
        const first = codes()[0];
        const lang = previewAs === TEST ? first : (previewAs || first);
        try {
          setTable(tables, lang);
          setLanguage(lang);
          setPseudo(previewAs === TEST);
          const form = /\.(zero|one|two|few|many|other)$/.exec(key)?.[1];
          return form ? lookup(M.baseKey(key), { n: SAMPLE[form] }) : lookup(key);
        } finally { setPseudo(false); }
      }

      // ---- the parts ----
      function drawSummary() {
        const found = M.problems(tables);
        issues.hidden = !found.length;
        issues.querySelector('summary').textContent = `${found.length} thing${found.length === 1 ? '' : 's'} to look at`;
        fill(issues.querySelector('ul'), ...found.slice(0, 60).map((p) => h('li', { class: `text-${p.kind}`, text: p.message })));
        const done = M.completeness(tables);
        for (const code of codes()) {
          const badge = grid.querySelector(`[data-done="${CSS.escape(code)}"]`);
          if (badge) badge.textContent = `${Math.round((done[code] ?? 0) * 100)}%`;
        }
      }

      function cellFor(code, key, value) {
        const first = code === codes()[0];
        const input = h('textarea', {
          class: `text-cell${value === undefined ? ' missing' : ''}`, rows: '1', value: value ?? '', spellcheck: false, lang: code,
          placeholder: first ? '' : (tables[codes()[0]][key] ?? ''), aria: { label: `${key} in ${code}` },
        });
        input.addEventListener('input', () => {
          input.classList.toggle('missing', input.value === '' && !first);
          change(M.setWord(tables, code, key, input.value), { redraw: false });
          const out = input.closest('.text-row')?.querySelector('.text-preview');
          if (out) out.textContent = preview(key);
        });
        return input;
      }

      function draw() {
        const list = codes();
        const showPreview = list.length > 0;
        fill(toolbar,
          h('input', {
            type: 'search', class: 'text-filter', placeholder: 'Filter keys…', value: filter, spellcheck: false, aria: { label: 'Filter keys' },
            on: { input: (e) => { filter = e.target.value; drawRows(); } },
          }),
          list.length ? [
            button({ text: 'Add a key', icon: 'plus', class: 'small primary', onClick: addKey }),
            button({ text: 'Add a language…', class: 'small', onClick: addLanguage }),
            button({
              text: 'Import CSV…', class: 'small', title: 'Words from a spreadsheet: key, then one column for each language', onClick: importCsv,
            }),
            button({
              text: 'Export CSV', class: 'small', title: 'Send the table to a translator',
              onClick: () => download('text.csv', M.toCsv(tables), 'text/csv'),
            }),
            h('label', { class: 'art-inline' }, 'Preview as ', h('select', {
              aria: { label: 'Preview as' }, on: { change: (e) => { previewAs = e.target.value; drawRows(); } },
            }, ...list.map((c) => h('option', {
              value: c, text: M.LANGUAGE_NAMES[c] ? `${c} (${M.LANGUAGE_NAMES[c]})` : c, selected: (previewAs || list[0]) === c,
            })),
            h('option', { value: TEST, text: 'Test text (finds words that will not fit)', selected: previewAs === TEST }))),
          ] : null);
        help.hidden = !list.length;
        empty.hidden = list.length > 0;
        grid.hidden = !list.length;
        issues.hidden = !list.length;
        if (!list.length) {
          fill(empty, h('h3', { text: problem ? 'The text file needs fixing' : 'No words yet' }),
            h('p', { text: problem || HINT }),
            problem ? null : button({ text: 'Make a table', class: 'primary', onClick: () => change(M.newTable()) }));
          return;
        }
        help.querySelector('pre').textContent = `import words from './text.js';\nimport { text, t, setLanguage } from '@engine/arcade';\n\n`
          + `text(words);                      // once: uses the player's language when the table has it\n\n`
          + `t('start');                       // "${tables[list[0]].start ?? 'Start'}"\n`
          + `t('hello', { name: 'Sam' });      // fills {name} in "Hello, {name}!"\n`
          + `t('coins', { n: 3 });             // picks coins.one or coins.other (or few, many...) for the language\n`
          + `setLanguage('fr');                // switch while playing, from a menu for example`;
        void showPreview;
        drawRows();
      }

      function drawRows() {
        const list = codes();
        const done = M.completeness(tables);
        const head = h('div', { class: 'text-row text-head' }, h('div', { class: 'text-key', text: 'Key' }),
          ...list.map((c, i) => h('div', { class: 'text-lang' },
            h('strong', { text: c, title: M.LANGUAGE_NAMES[c] ?? c }), ' ',
            h('span', { class: 'dim', 'data-done': c, text: `${Math.round((done[c] ?? 0) * 100)}%` }),
            i === 0 ? h('span', { class: 'dim', text: ' (default)' })
              : button({ text: 'Make default', class: 'small ghost', onClick: () => change(M.makeFirst(tables, c)) }),
            button({ text: '×', class: 'small ghost', title: `Remove ${c}`, aria: { label: `Remove ${c}` }, onClick: () => removeLanguage(c) }))),
          h('div', { class: 'text-preview-head', text: 'Preview' }));
        const f = filter.trim().toLowerCase();
        const keys = M.allKeys(tables).filter((k) => !f || k.toLowerCase().includes(f)
          || list.some((c) => (tables[c][k] ?? '').toLowerCase().includes(f)));
        const rows = keys.slice(0, SHOWN).map((key) => h('div', { class: 'text-row' },
          h('div', { class: 'text-key' }, h('code', { text: key }),
            button({ text: 'Rename', class: 'small ghost', onClick: () => renameKey(key) }),
            button({
              text: '×', class: 'small ghost', title: `Remove ${key}`, aria: { label: `Remove ${key}` },
              onClick: () => change(M.removeKey(tables, key)),
            })),
          ...list.map((c) => cellFor(c, key, tables[c][key])),
          h('div', { class: 'text-preview', lang: previewAs && previewAs !== TEST ? previewAs : list[0], text: preview(key) })));
        grid.style.setProperty('--langs', String(list.length));
        const more = keys.length > SHOWN ? h('p', { class: 'dim', text: `${keys.length - SHOWN} more: use the filter to find them.` }) : null;
        fill(grid, head, ...rows, more,
          !keys.length ? h('p', { class: 'dim', text: f ? 'No key or words match the filter.' : 'No keys yet. Press "Add a key".' }) : null);
        drawSummary();
      }

      // ---- the buttons ----
      async function addKey() {
        const key = await promptText({
          title: 'Add a key', label: 'Key (for example start, game-over or coins.one)', confirmLabel: 'Add it',
          validate: (v) => M.keyProblem(tables, v.trim()),
        });
        if (key === undefined) return;
        filter = '';
        change(M.addKey(tables, key.trim()));
      }
      async function renameKey(key) {
        const to = await promptText({
          title: 'Rename the key', label: 'New key', value: key, confirmLabel: 'Rename',
          validate: (v) => (v.trim() === key ? null : M.keyProblem(tables, v.trim())),
        });
        if (to !== undefined && to.trim() !== key) change(M.renameKey(tables, key, to.trim()));
      }
      async function addLanguage() {
        const code = await promptText({
          title: 'Add a language', label: 'Language code (fr, de, es, ja, pt-BR…)', confirmLabel: 'Add it',
          validate: (v) => M.languageProblem(tables, v.trim()),
        });
        if (code !== undefined) { previewAs = ''; change(M.addLanguage(tables, code.trim())); }
      }
      function removeLanguage(code) {
        try { change(M.removeLanguage(tables, code)); } catch (error) { studio.toasts.show(error.message, { kind: 'error' }); }
      }
      function importCsv() {
        const input = h('input', { type: 'file', accept: '.csv,text/csv' });
        input.addEventListener('change', async () => {
          const file = input.files?.[0];
          if (!file) return;
          try {
            const merged = M.mergeTables(tables, M.fromCsv(await file.text()));
            change(merged);
            studio.toasts.show(`Read ${file.name}: ${codes().length} languages, ${M.allKeys(merged).length} keys.`, { kind: 'success' });
          } catch (error) {
            studio.toasts.show(error.message, { kind: 'error', ms: 8000 });
          }
        });
        input.click();
      }

      studio.on('file-changed', (e) => { if (e.path === FILE && studio.project?.readText(FILE) !== lastWritten) load(); });
      studio.on('project', load);
      studio.on('files', () => { if (!studio.project?.has(FILE) && !codes().length) load(); });
      load();
      return { el, focus: () => toolbar.querySelector('input')?.focus(), onShow: load, dispose: flush };
    },
  };
}
