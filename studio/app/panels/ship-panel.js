// The Ship panel: get your game to players. Measure it (how big to download, how fast to first picture, how much of every frame it uses), hold it to limits you
// choose, and export it as a web page you can put on any web host. Nothing leaves your computer until you upload it yourself.
import { h, button, fill } from '../ui/dom.js';
import { confirm, promptText } from '../ui/dialog.js';
import { settingsOf } from '../store/project-settings.js';
import { human, BUDGETS } from '../../export/health.js';
import * as P from '../../export/profiles.js';

const SLOW = [[1, 'This computer'], [2, '2 times slower'], [4, 'A mid-range phone (4 times)'], [6, 'A weak phone (6 times)']];
const MARK = { ok: '✓', fail: '✗', unknown: '–', off: '–' };
const WORDS = { ok: 'within the limit', fail: 'over the limit', unknown: 'not measured yet', off: 'no limit set' };

export function shipPanel(studio) {
  return {
    id: 'ship',
    title: 'Ship',
    icon: 'download',
    create() {
      const ship = studio.ship;
      const summary = h('div', { class: 'ship-summary', role: 'status' });
      const table = h('div', { class: 'ship-table', role: 'table', aria: { label: 'Web health and budgets' } });
      const sizes = h('div', { class: 'ship-sizes' });
      const exportBox = h('div', { class: 'ship-export' });
      const profileBox = h('div', { class: 'ship-profiles' });
      const el = h('div', { class: 'panel-body ship', 'aria-label': 'Ship' }, summary, table, sizes, profileBox, exportBox);
      let title = '';
      let titleEdited = false;
      let exporting = false;
      const sizeWords = (n) => (n < 1000 ? `${n} B` : `${Math.round(n / 100) / 10} KB`);

      function draw() {
        const has = !!studio.project;
        const last = ship.last;
        const ev = last?.evaluation;
        fill(summary,
          h('div', { class: 'ship-head' },
            button({
              text: ship.measuring ? 'Measuring…' : last ? 'Measure again' : 'Measure my game', class: 'primary', disabled: !has || ship.measuring,
              onClick: () => ship.measure(),
            }),
            h('label', { class: 'art-inline' }, 'Pretend the device is ', h('select', {
              aria: { label: 'How much slower than this computer to pretend' }, on: { change: (e) => ship.setSlowdown(Number(e.target.value)) },
            }, ...SLOW.map(([n, text]) => h('option', { value: String(n), text, selected: n === ship.slowdown }))))),
          h('p', {
            class: `ship-verdict ${ev ? (ev.passed ? 'ok' : 'fail') : ''}`,
            text: !ev ? 'Press "Measure my game": it starts the game fresh, lets it run for a few seconds and reads what it costs.'
              : ev.passed ? 'Your game is inside every limit you set.' : `Over the limit: ${ev.failing.join(', ')}.`,
          }),
          last ? h('p', {
            class: 'ship-note', text: `Measured at ${new Date(last.at).toTimeString().slice(0, 8)}. A slower device is an estimate: the cost of a frame here, multiplied.`,
          }) : null);
        fill(table, ...BUDGETS.map((b) => {
          const item = ev?.items.find((i) => i.id === b.id);
          const state = item?.state ?? 'unknown';
          const limit = ship.budgets[b.id];
          const input = h('input', {
            type: 'number', class: 'num', min: '0', step: 'any', value: limit === null ? '' : String(limit), disabled: limit === null,
            aria: { label: `Limit for ${b.label}, in ${b.unit || 'files'}` },
            on: { change: (e) => { const n = Number(e.target.value); if (Number.isFinite(n) && n > 0) ship.setBudget(b.id, n); } },
          });
          return h('div', { class: `ship-row ${state}`, role: 'row' },
            h('div', { class: 'name', role: 'cell' }, h('strong', { text: b.label }), h('small', { text: b.help })),
            h('div', { class: 'value', role: 'cell', text: human(item?.value ?? null, b.unit) }),
            h('div', { class: 'limit', role: 'cell' }, h('span', { text: 'limit ' }), input, h('span', { text: ` ${b.unit}` }),
              h('label', { class: 'art-inline' }, h('input', {
                type: 'checkbox', checked: limit === null, aria: { label: `No limit for ${b.label}` },
                on: { change: (e) => ship.setBudget(b.id, e.target.checked ? null : b.limit) },
              }), ' off')),
            h('div', { class: 'state', role: 'cell', aria: { label: WORDS[state] }, title: WORDS[state], text: MARK[state] }));
        }));
        const s = last?.sizes;
        fill(sizes, s ? [
          h('div', { class: 'art-label', text: 'What a player downloads' }),
          h('p', { text: `${s.files} files, ${Math.round(s.rawBytes / 1000)} KB, about ${Math.round(s.gzipBytes / 1000)} KB compressed. `
            + Object.entries(s.byKind).map(([k, v]) => `${k} ${Math.round(v.rawBytes / 100) / 10} KB`).join(' · ') }),
          h('p', { class: 'ship-note', text: `Biggest: ${s.largest.map((f) => `${f.path} (${Math.round(f.bytes / 100) / 10} KB)`).join(', ')}` }),
        ] : null);
        if (!titleEdited && studio.project) {
          title = ship.profiles.profiles[ship.profiles.selected].title || settingsOf(studio.textFiles()).settings.title || studio.project.name;
        }
        drawProfiles();
        const done = ship.lastExport;
        fill(exportBox,
          h('div', { class: 'art-label', text: 'Export' }),
          h('p', {
            text: 'Make your game a web page. You get a folder of plain files; put it on any web host (itch.io, GitHub Pages, Netlify, your own server).',
          }),
          h('div', { class: 'ship-form' },
            h('label', { class: 'art-inline' }, 'Game title ', h('input', {
              type: 'text', value: title, class: 'ship-title', aria: { label: 'Game title' },
              on: { input: (e) => { title = e.target.value; titleEdited = true; } },
            })),
            button({ text: exporting ? 'Exporting…' : 'Export as a web game (.zip)', icon: 'download', class: 'primary',
              disabled: !has || exporting, onClick: doExport })),
          done ? h('p', {
            class: 'ship-done', role: 'status', text: `Exported "${done.title}": ${done.files} files, ${Math.round(done.bytes / 1000)} KB (${done.name}).`,
          }) : null,
          h('details', { class: 'art-help' }, h('summary', { text: 'How do I put it online?' }), h('div', { class: 'learn-body' },
            h('p', {
              text: '1. Unzip the file. 2. Upload the whole folder to a web host. 3. Open its address. '
                + 'Opening index.html straight from your disk will not work: browsers only allow games like this to load from a web address (or from localhost).',
            }),
            h('p', {
              text: 'To install it as an app, open the hosted page in a browser that supports installing (Chrome, Edge) and use its Install button. '
                + 'The offline copy needs the page to be served over https or from localhost.',
            }),
            h('p', {
              text: 'Games made with the arcade kit draw with Canvas 2D, which works in every browser. The engine\'s 3D games try WebGPU first, then WebGL2, then Canvas 2D.',
            }))));
      }

      function drawProfiles() {
        if (!studio.project) { fill(profileBox); return; }
        const all = ship.profiles;
        const name = all.selected;
        const profile = all.profiles[name];
        const preview = ship.previewProfile(name);
        const save = (next) => ship.setProfiles(next);
        const left = preview.left.filter((l) => l.path !== P.FILE);
        fill(profileBox,
          h('div', { class: 'art-label', text: 'Build profiles' }),
          h('p', { class: 'ship-note', text: 'A profile is a way of making the game: what it leaves out, whether it works offline, and whether the game is told it is a debug build (build().debug in the kit).' }),
          h('div', { class: 'ship-form' },
            h('label', { class: 'art-inline' }, 'Build ', h('select', {
              aria: { label: 'Build profile' }, on: { change: (e) => { titleEdited = false; save(P.selectProfile(ship.profiles, e.target.value)); } },
            }, ...Object.keys(all.profiles).map((n) => h('option', { value: n, text: n, selected: n === name })))),
            button({ text: 'New profile…', class: 'small', onClick: newProfile }),
            button({ text: 'Delete', class: 'small ghost', disabled: Object.keys(all.profiles).length <= 1, onClick: () => removeProfile(name) })),
          h('div', { class: 'ship-form' },
            h('label', { class: 'art-inline' }, 'Page title ', h('input', {
              type: 'text', value: profile.title, placeholder: '(the project\'s title)', aria: { label: 'Page title for this profile' },
              on: { change: (e) => save(P.updateProfile(ship.profiles, name, { title: e.target.value })) },
            })),
            h('label', { class: 'art-inline' }, h('input', {
              type: 'checkbox', checked: profile.offline, aria: { label: 'Installable and works offline' },
              on: { change: (e) => save(P.updateProfile(ship.profiles, name, { offline: e.target.checked })) },
            }), ' Installable and works offline'),
            h('label', { class: 'art-inline' }, h('input', {
              type: 'checkbox', checked: profile.debug, aria: { label: 'A debug build' },
              on: { change: (e) => save(P.updateProfile(ship.profiles, name, { debug: e.target.checked })) },
            }), ' A debug build')),
          h('label', { class: 'ship-exclude' }, h('span', { text: 'Leave out these files (one pattern a line: tests/**, **/*.test.js, docs)' }), h('textarea', {
            rows: '3', spellcheck: false, value: profile.exclude.join('\n'), aria: { label: 'Files this profile leaves out' },
            on: { change: (e) => save(P.updateProfile(ship.profiles, name, { exclude: e.target.value.split('\n') })) },
          })),
          h('p', { class: 'ship-note', role: 'status', text: left.length
            ? `This build leaves out ${left.length} file${left.length === 1 ? '' : 's'} (${sizeWords(left.reduce((n, l) => n + l.bytes, 0))}): `
              + `${left.slice(0, 4).map((l) => l.path).join(', ')}${left.length > 4 ? '…' : ''}.` : 'This build leaves nothing out.' }),
          preview.problems.length ? h('p', { class: 'plugin-problem', role: 'alert',
            text: `${preview.problems[0].from} imports ${preview.problems[0].path}, which this profile leaves out. The build would not work.` }) : null);
      }

      async function newProfile() {
        const all = ship.profiles;
        const name = await promptText({
          title: 'Name the profile', label: 'Name (for example itch or phone)', value: 'itch', confirmLabel: 'Make it',
          validate: (v) => P.nameProblem(all, v.trim()),
        });
        if (name === undefined) return;
        titleEdited = false;
        ship.setProfiles(P.addProfile(all, name.trim(), all.selected));
      }
      function removeProfile(name) {
        try { titleEdited = false; ship.setProfiles(P.removeProfile(ship.profiles, name)); } catch (error) { studio.toasts.show(error.message, { kind: 'error' }); }
      }

      async function doExport() {
        if (exporting) return;
        const ev = ship.last?.evaluation;
        if (ev && !ev.passed) {
          const ok = await confirm({
            title: 'Over your limits', confirmLabel: 'Export anyway',
            message: `The last measurement was over: ${ev.failing.join(', ')}. `
              + 'You can change a limit, make the game lighter and measure again, or export anyway.',
          });
          if (!ok) return;
        }
        exporting = true;
        draw();
        try {
          await ship.exportZip({ title: titleEdited ? title.trim() || studio.project.name : undefined });
        } catch (error) {
          studio.toasts.show(`Could not export: ${error.message}`, { kind: 'error' });
        } finally {
          exporting = false;
          draw();
        }
      }

      studio.on('ship', draw);
      studio.on('project', draw);
      draw();
      return { el, focus: () => el.querySelector('button')?.focus(), onShow: draw };
    },
  };
}
