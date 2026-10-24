// The Resources panel: what the game loads. Every file of the project with its size, what kind of thing it is, and whether the game reaches it (starting from
// src/main.js and following imports, and any file name written in the code). Files nothing reaches are marked unused, so they can be left out or removed before shipping.
import { h, button, fill } from '../ui/dom.js';
import { confirm } from '../ui/dialog.js';
import { assetsOf } from '../store/assets.js';
import { analyzeResources, byKind, sizeWords } from '../profile/resources.js';

const KIND_WORDS = {
  code: 'Code', sprite: 'Sprites', sounds: 'Sounds (recipes)', music: 'Music (songs)', words: 'Words (languages)', states: 'States', clips: 'Clips',
    particles: 'Particles',
  behaviors: 'Behaviours', ui: 'Screens', settings: 'Settings', image: 'Pictures', 'sound file': 'Sound files', test: 'Tests', plugin: 'Plugins',
    data: 'Data and notes', other: 'Other',
};

export function resourcesPanel(studio) {
  return {
    id: 'resources',
    title: 'Resources',
    icon: 'folder',
    create() {
      const summary = h('div', { class: 'ship-summary', role: 'status' });
      const groups = h('div', { class: 'resource-groups' });
      const el = h('div', { class: 'panel-body resources', 'aria-label': 'Resources' }, summary, groups);
      let timer = 0;
      let showUsed = true;

      function analyze() {
        const files = studio.textFiles();
        const assets = studio.project ? assetsOf(studio.project).map((a) => ({ path: a.path, bytes: a.bytes.length })) : [];
        return analyzeResources(files, assets);
      }

      function draw() {
        if (!studio.project) {
          fill(summary);
          fill(groups, h('div', { class: 'empty' }, h('h3', { text: 'No project open' }), h('p',
            { text: 'Open a project to see what its game loads.' })));
          return;
        }
        const report = analyze();
        const unused = report.entries.filter((e) => !e.used && e.kind !== 'test');
        const unusedBytes = unused.reduce((n, e) => n + e.bytes, 0);
        fill(summary,
          h('p', { text: `${report.entries.length} files, ${sizeWords(report.total)}. The game reaches ${sizeWords(report.usedBytes)}.` }),
          unused.length ? h('p', { class: 'ship-verdict fail',
            text: `${unused.length} file${unused.length === 1 ? '' : 's'} (${sizeWords(unusedBytes)}) nothing reaches.`
              + ' They can be removed or left out of a build.' })
            : h('p', { class: 'ship-verdict ok', text: 'Every file is reached by the game.' }),
          report.missing.length ? h('p', { class: 'plugin-problem', role: 'alert',
            text: `Missing: ${report.missing.map((m) => `${m.from} imports ${m.path}`).join('; ')}` }) : null,
          h('label', { class: 'art-inline' }, h('input', { type: 'checkbox', checked: showUsed,
            on: { change: (e) => { showUsed = e.target.checked; draw(); } } }), ' Show the files that are used too'));
        fill(groups, ...byKind(report.entries).map((group) => {
          const rows = group.entries.filter((e) => showUsed || !e.used);
          if (!rows.length) return null;
          return h('details', { class: 'resource-group', open: group.entries.some((e) => !e.used) || group.entries.length <= 6 },
            h('summary', {}, h('strong', { text: KIND_WORDS[group.kind] ?? group.kind }), h('span', { class: 'dim',
              text: ` ${group.entries.length} · ${sizeWords(group.bytes)}` })),
            ...rows.map((e) => h('div', { class: `resource-row${e.used ? '' : ' unused'}`, role: 'row' },
              h('button', { type: 'button', class: 'link', text: e.path, on: { click: () => studio.openFile?.(e.path) } }),
              h('span', { class: 'dim', text: sizeWords(e.bytes) }),
              h('span', { class: e.used ? 'badge on' : 'badge off', text: e.used ? 'used' : e.kind === 'test' ? 'test' : 'unused' }),
              e.usedBy.length ? h('span', { class: 'dim', text: `by ${e.usedBy.slice(0, 3).join(', ')}${e.usedBy.length > 3 ? '…' : ''}` }) : null,
              !e.used && e.kind !== 'test' ? button({ text: 'Remove', class: 'small ghost', aria: { label: `Remove ${e.path}` },
                onClick: () => remove(e.path) }) : null)));
        }));
      }

      async function remove(path) {
        if (!await confirm({ title: `Remove "${path}"?`, confirmLabel: 'Remove', danger: true,
          message: 'Nothing in the game reaches this file. It cannot be undone.' })) return;
        studio.project.remove?.(path);
        studio.emit('files');
        draw();
      }

      const later = () => { clearTimeout(timer); timer = setTimeout(draw, 300); };
      studio.on('files', later);
      studio.on('file-changed', later);
      studio.on('project', draw);
      draw();
      return { el, focus: () => el.querySelector('button, input')?.focus(), onShow: draw };
    },
  };
}
