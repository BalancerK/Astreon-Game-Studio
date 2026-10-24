// The Tests panel: checks you write for your game, run inside the studio. A test file is any file called `something.test.js` (or any .js file in a `tests` folder): it adds
// checks with `test('what it should do', () => { expect(...) })` from @engine/arcade, and can play the game for a while without drawing with `simulate`. They run in a closed
// worker of their own, away from the game, and the panel shows what passed and what failed, with what was expected. Turn on "Run when I change a file" to see a break as it happens.
import { h, button, fill } from '../ui/dom.js';

const TEST_FILE = /(^|\/)tests\/.*\.js$|\.test\.js$/;
const NEW_PATH = 'tests/game.test.js';
const TEMPLATE = `// Checks for the game. Press "Run the tests" in the Tests panel.
import { test, expect, simulate } from '@engine/arcade';
import * as game from '../src/main.js';

test('the game starts with something to play', () => {
  expect(game.create()).toBeTruthy();
});

test('the game keeps going for a second of play', () => {
  const state = simulate(game, 60);                       // create the game and run its update 60 times, without drawing
  expect(state).toBeTruthy();
});
`;

export function testsPanel(studio) {
  return {
    id: 'tests',
    title: 'Tests',
    icon: 'play',
    create() {
      const bar = h('div', { class: 'toolbar art-bar' });
      const summary = h('div', { class: 'ship-summary', role: 'status', 'aria-live': 'polite' });
      const results = h('div', { class: 'test-results' });
      const help = h('details', { class: 'art-help' }, h('summary', { text: 'How do I write a test?' }), h('pre', { class: 'learn-code' }));
      const el = h('div', { class: 'panel-body tests', 'aria-label': 'Tests' }, bar, summary, results, help);
      let auto = studio.prefs?.get('tests-auto', false) ?? false;
      let running = false;
      let again = false;                                // a file changed while the tests were running
      let last = null;                                  // { results, message, at, files }
      let timer = 0;
      help.querySelector('pre').textContent = TEMPLATE;

      const testFiles = () => (studio.project?.list() ?? []).filter((p) => TEST_FILE.test(p) && p.endsWith('.js')).sort();

      async function run() {
        if (running || !studio.project) return;
        const paths = testFiles();
        if (!paths.length) { last = { results: [], message: '', at: Date.now(), files: 0 }; draw(); return; }
        running = true;
        draw();
        await studio.project.flush?.();
        const outcome = await studio.runner.runTests(studio.textFiles(), paths);
        last = { ...outcome, at: Date.now(), files: paths.length };
        running = false;
        if (again) { again = false; setTimeout(run, 100); }
        studio.emit('tests', { passed: outcome.results.filter((r) => r.ok).length, failed: outcome.results.filter((r) => !r.ok).length });
        draw();
      }

      function newFile() {
        if (!studio.project) return;
        let path = NEW_PATH;
        for (let n = 2; studio.project.has(path); n++) path = NEW_PATH.replace('.test.js', `${n}.test.js`);
        studio.project.write(path, TEMPLATE);
        studio.emit('files');
        studio.openFile?.(path);
        draw();
      }

      function row(r) {
        const e = r.error;
        return h('div', { class: `test-row ${r.ok ? 'ok' : 'fail'}`, role: 'row' },
          h('span', { class: 'test-mark', 'aria-label': r.ok ? 'passed' : 'failed', text: r.ok ? '✓' : '✗' }),
          h('span', { class: 'test-name', text: r.name }), h('span', { class: 'dim', text: `${r.ms} ms` }),
          e ? h('div', { class: 'test-error' }, h('div', { text: e.message }),
            e.expected !== undefined ? h('div', { class: 'dim', text: `expected ${e.expected}, got ${e.actual}` }) : null) : null);
      }

      function draw() {
        const files = testFiles();
        const have = Boolean(studio.project);
        fill(bar,
          button({ text: running ? 'Running…' : 'Run the tests', icon: 'play', class: 'small primary', disabled: !have || running || !files.length,
            onClick: run }),
          button({ text: 'New test file', icon: 'plus', class: 'small', disabled: !have, onClick: newFile }),
          h('label', { class: 'art-inline' }, h('input', {
            type: 'checkbox', checked: auto, on: { change: (e) => { auto = e.target.checked; studio.prefs?.set('tests-auto',
              auto); if (auto) run(); } },
          }), ' Run when I change a file'));
        if (!have) {
          fill(summary);
          fill(results, h('div', { class: 'empty' }, h('h3', { text: 'No project open' }), h('p',
            { text: 'Open a project to write checks for its game.' })));
          return;
        }
        if (!files.length) {
          fill(summary);
          fill(results, h('div', { class: 'empty' }, h('h3', { text: 'No tests yet' }),
            h('p', { text: 'A test is a check you write once, so that after you change the game you can see at once that it still works. '
              + 'Start with a ready-made file.' }),
            button({ text: 'Make a test file', class: 'primary', onClick: newFile })));
          return;
        }
        if (!last) {
          fill(summary, h('p', { class: 'dim',
            text: `${files.length} test file${files.length === 1 ? '' : 's'}: ${files.join(', ')}. Press "Run the tests".` }));
          fill(results);
          return;
        }
        const passed = last.results.filter((r) => r.ok).length;
        const failed = last.results.length - passed;
        const verdict = last.message || (failed ? `${failed} failed, ${passed} passed.`
          : last.results.length ? `All ${passed} passed.` : 'The test files have no checks in them yet.');
        fill(summary,
          h('p', {
            class: `ship-verdict ${failed || last.message ? 'fail' : 'ok'}`,
            text: verdict,
          }),
          h('p', { class: 'ship-note',
            text: `Ran ${last.files} file${last.files === 1 ? '' : 's'} at ${new Date(last.at).toTimeString().slice(0, 8)}.` }));
        const byFile = new Map();
        for (const r of last.results) byFile.set(r.file, [...(byFile.get(r.file) ?? []), r]);
        fill(results, ...[...byFile].map(([file, list]) => h('div', { class: 'test-file' },
          h('div', { class: 'test-file-head' }, h('button', { type: 'button', class: 'link', text: file,
            on: { click: () => studio.openFile?.(file) } }),
            h('span', { class: 'dim', text: ` ${list.filter((r) => r.ok).length}/${list.length}` })),
          ...list.map(row))));
      }

      const later = (e) => {
        if (!auto || (e?.path && !/\.js$/.test(e.path) && !/\.json$/.test(e.path))) return;
        if (running) { again = true; return; }
        clearTimeout(timer);
        timer = setTimeout(run, 800);
      };
      studio.on('file-changed', later);
      studio.on('project', () => { last = null; draw(); });
      studio.on('files', draw);
      draw();
      return { el, focus: () => el.querySelector('button')?.focus(), onShow: draw };
    },
  };
}
