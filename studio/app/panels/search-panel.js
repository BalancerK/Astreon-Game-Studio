// The Search panel: find (and replace) text in every file of the project, and the place where "find all uses of this name" shows its answer. Results are grouped
// by file; Enter or a click opens the place, the arrow keys move between results, and the panel says how many there are.
import { h, fill, button } from '../ui/dom.js';
import { searchProject } from '../editing/project-search.js';
import { replaceInFiles } from '../core/refactor.js';

export function searchPanel(studio) {
  return {
    id: 'search',
    title: 'Search',
    icon: 'search',
    create() {
      const find = h('input', {
        type: 'search', class: 'search-input', placeholder: 'Find in all files', spellcheck: false, aria: { label: 'Find in all files' },
      });
      const replacement = h('input', {
        type: 'text', class: 'search-input', placeholder: 'Replace with', spellcheck: false, aria: { label: 'Replace with' },
      });
      const options = { caseSensitive: false, wholeWord: false, regex: false };
      const toggle = (key, text, label) => {
        const b = h('button', {
          type: 'button', class: 'btn small search-toggle', text, title: label, aria: { label, pressed: false },
          on: { click: () => { options[key] = !options[key]; b.setAttribute('aria-pressed', String(options[key])); run(); } },
        });
        return b;
      };
      let replaceMode = false;
      const replaceRow = h('div', { class: 'search-row', hidden: true }, replacement,
        button({ text: 'Replace all', class: 'small', title: 'Replace in every file (you see what changes first)', onClick: () => doReplace(null) }));
      const modeBtn = h('button', {
        type: 'button', class: 'btn small ghost', text: 'Replace…', aria: { expanded: false, label: 'Show replace' },
        on: {
          click: () => {
            replaceMode = !replaceMode;
            replaceRow.hidden = !replaceMode;
            modeBtn.setAttribute('aria-expanded', String(replaceMode));
            draw();
            if (replaceMode) replacement.focus();
          },
        },
      });
      const summary = h('div', { class: 'search-summary', role: 'status', aria: { live: 'polite' } });
      const out = h('div', { class: 'search-results', role: 'tree', aria: { label: 'Search results' } });
      const head = h('div', { class: 'search-head' },
        h('div', { class: 'search-row' }, find, toggle('caseSensitive', 'Aa', 'Match case'), toggle('wholeWord', 'ab', 'Whole word'),
          toggle('regex', '.*', 'Pattern (regular expression)'), modeBtn),
        replaceRow, summary);
      const el = h('div', { class: 'panel-body search', 'aria-label': 'Search' }, head, out);

      let shown = { results: [], title: '', uses: false };
      const open = (path, hit) => studio.goto(path, hit.line, hit.column);

      function line(hit, path) {
        const before = hit.text.slice(0, hit.start);
        const match = hit.text.slice(hit.start, hit.start + hit.length);
        const after = hit.text.slice(hit.start + hit.length);
        return h('button', {
          type: 'button', class: 'search-hit', role: 'treeitem', tabIndex: -1, dataset: { path, line: hit.line },
          aria: { label: `${path}, line ${hit.line}: ${hit.text}` },
          on: { click: () => open(path, hit), keydown: (e) => hitKey(e) },
        }, h('span', { class: 'search-line', text: String(hit.line) }),
        h('span', { class: 'search-text' }, before, h('mark', { text: match }), after));
      }

      function hitKey(e) {
        const hits = [...out.querySelectorAll('.search-hit')];
        const i = hits.indexOf(e.currentTarget);
        if (e.key === 'ArrowDown') { e.preventDefault(); hits[Math.min(hits.length - 1, i + 1)]?.focus(); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); if (i <= 0) find.focus(); else hits[i - 1].focus(); }
      }

      function draw() {
        const { results, uses } = shown;
        const total = results.reduce((n, r) => n + r.hits.length, 0);
        const query = find.value;
        if (!studio.project) {
          fill(out, h('div', { class: 'empty' }, h('p', { text: 'Open a project to search its files.' })));
          summary.textContent = '';
          return;
        }
        if (!results.length) {
          summary.textContent = uses ? shown.title : query ? (shown.error ? `Not a valid pattern: ${shown.error}` : 'No results.') : '';
          const help = 'Type to find text in all the files of this project. '
            + 'Put the cursor on a name in the editor and press Shift+F12 to see where it is used.';
          fill(out, !query && !uses ? h('div', { class: 'empty' }, h('h3', { text: 'Search every file' }), h('p', { text: help })) : null);
          return;
        }
        const count = `${total} result${total === 1 ? '' : 's'} in ${results.length} file${results.length === 1 ? '' : 's'}`;
        summary.textContent = `${uses ? `${shown.title}: ` : ''}${count}${shown.capped ? ' (showing the first ones: be more specific)' : ''}`;
        fill(out, results.map((r) => h('div', { class: 'search-group', role: 'group', aria: { label: r.path } },
          h('div', { class: 'search-file' }, h('span', { class: 'name', text: r.path }), h('span', { class: 'badge', text: String(r.hits.length) }),
            replaceMode && !uses ? button({ text: 'Replace in file', class: 'small ghost', onClick: () => doReplace([r.path]) }) : null),
          r.hits.map((hit) => line(hit, r.path)))));
        const first = out.querySelector('.search-hit');
        if (first) first.tabIndex = 0;
      }

      let timer = 0;
      function run() {
        clearTimeout(timer);
        shown = { ...searchProject(studio.textFiles(), find.value, options), uses: false, title: '' };
        draw();
      }
      find.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, 150); });
      find.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); run(); out.querySelector('.search-hit')?.focus(); }
        else if (e.key === 'ArrowDown') { e.preventDefault(); out.querySelector('.search-hit')?.focus(); }
        else if (e.key === 'Escape') { find.value = ''; run(); }
      });
      replacement.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doReplace(null); } });
      async function doReplace(only) {
        if (!find.value) { find.focus(); return; }
        const n = await replaceInFiles(studio, find.value, replacement.value, options, only);
        if (n) run();
      }

      studio.searchApi = {
        /** Open the panel on a text (what is selected in the editor, usually) and search for it. */
        open(text = '') {
          studio.dock.show('search');
          if (text) find.value = text;
          run();
          find.focus();
          find.select();
        },
        /** Show the uses of a name (found by the editor's "find all uses"). */
        showUses(name, results, count) {
          shown = { results, uses: true, title: `Uses of “${name}” (${count})`, capped: false };
          draw();
          out.querySelector('.search-hit')?.focus();
        },
      };
      // what is on show goes out of date when files change
      let again = 0;
      studio.on('file-changed', () => { if (!shown.uses && find.value) { clearTimeout(again); again = setTimeout(run, 400); } });
      studio.on('project', () => { find.value = ''; shown = { results: [], uses: false, title: '' }; draw(); });
      draw();
      return { el, focus: () => find.focus() };
    },
  };
}
