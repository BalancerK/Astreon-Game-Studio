// The Plugins panel: what is installed, install one from a file or from your own project, start a new one from a small template, and turn them on and off. A
// plugin adds panels, commands, exporters and importers, and runs in a closed box: it can only do what it asked for when you installed it.
import { h, button, fill } from '../ui/dom.js';
import { confirm } from '../ui/dialog.js';
import { PERMISSIONS } from '../../plugins/protocol.js';
import { TEMPLATE, TEMPLATE_PATH } from '../../plugins/template.js';
import { GALLERY, sampleUrl } from '../../plugins/gallery.js';
import { parseManifest } from '../../plugins/protocol.js';

const PLUGIN_FILE = /\.plugin\.js$/;

export function pluginsPanel(studio) {
  return {
    id: 'plugins',
    title: 'Plugins',
    icon: 'plus',
    create() {
      const mgr = studio.plugins;
      const list = h('div', { class: 'plugin-list' });
      const fromProject = h('select', { class: 'art-select', aria: { label: 'A plugin in this project' } });
      const fileInput = h('input', {
        type: 'file', accept: '.js,text/javascript', hidden: true, aria: { label: 'Choose a plugin file' },
        on: { change: async () => { const f = fileInput.files[0]; fileInput.value = ''; if (f) await install(await f.text()); } },
      });
      const el = h('div', { class: 'panel-body plugins', 'aria-label': 'Plugins' });
      const gallery = h('div', { class: 'plugin-gallery' });
      const samples = new Map();                        // file -> the manifest read from it, once fetched

      async function install(text) {
        try {
          const r = await mgr.install(text);
          if (r) studio.toasts.show(`Installed "${r.name}".`, { kind: 'success' });
        } catch (error) { studio.toasts.show(error.message, { kind: 'error' }); }
      }

      async function newPlugin() {
        if (!studio.project) { studio.toasts.show('Open a project first: the plugin is made as a file in it.', { kind: 'info' }); return; }
        let path = TEMPLATE_PATH;
        for (let n = 2; studio.project.has(path); n++) path = TEMPLATE_PATH.replace('.plugin.js', `-${n}.plugin.js`);
        studio.project.write(path,
          TEMPLATE.replace(/"id": "my-panel"/, `"id": "my-panel${path === TEMPLATE_PATH ? '' : `-${path.match(/-(\d+)\.plugin/)[1]}`}"`));
        studio.emit('files');
        studio.openFile(path);
        studio.dock?.show('editor', { focus: false });
        studio.toasts.show(`Made ${path}. Change it, then press "Install from this project".`, { kind: 'success' });
      }

      async function installSample(sample) {
        try {
          const response = await fetch(sampleUrl(sample.file));
          if (!response.ok) throw new Error(`Could not load ${sample.title} (${response.status}).`);
          await install(await response.text());
        } catch (error) { studio.toasts.show(error.message, { kind: 'error' }); }
      }

      /** The sample plugins, each with what it may do (read from its own manifest) and a button to install it. */
      async function drawGallery() {
        for (const s of GALLERY) {
          if (samples.has(s.file)) continue;
          try { samples.set(s.file, parseManifest(await (await fetch(sampleUrl(s.file))).text())); } catch { samples.set(s.file, null); }
        }
        const have = new Set([...mgr.plugins.keys()]);
        fill(gallery, h('h3', { text: 'Sample plugins' }),
          h('p', { class: 'dim', text: 'Small plugins that come with the studio. Install one, then read it to learn how.' }),
          ...GALLERY.map((s) => {
            const m = samples.get(s.file);
            const asks = !m ? '' : m.permissions?.length
              ? m.permissions.map((x) => PERMISSIONS[x]).join('; ') : 'nothing: it cannot see your project';
            return h('div', { class: 'plugin-card' },
              h('div', { class: 'plugin-title' }, h('strong', { text: s.title })),
              h('p', { text: s.blurb }), asks ? h('p', { class: 'plugin-asks', text: `Allowed to: ${asks}.` }) : null,
              h('div', { class: 'plugin-actions' }, have.has(s.id) ? h('span', { class: 'badge on', text: 'installed' })
                : button({ text: 'Install', class: 'small primary', aria: { label: `Install ${s.title}` }, onClick: () => installSample(s) })));
          }));
      }

      function draw() {
        drawGallery();
        const files = studio.project?.list().filter((p) => PLUGIN_FILE.test(p)) ?? [];
        fill(fromProject, ...files.map((p) => h('option', { value: p, text: p })));
        const plugins = [...mgr.plugins.values()];
        fill(list, ...(plugins.length ? plugins.map((p) => {
          const m = p.manifest;
          const failed = mgr.failed.get(m.id);
          const state = !p.enabled ? 'off' : failed ? 'stopped' : 'on';
          const asks = m.permissions.length ? m.permissions.map((x) => PERMISSIONS[x]).join('; ') : 'nothing: it cannot see your project';
          return h('div', { class: `plugin-card ${state}` },
            h('div', { class: 'plugin-title' }, h('strong', { text: m.name }), h('span', { class: 'dim', text: ` ${m.version}` }),
              h('span', { class: `badge ${state}`, text: state === 'on' ? 'on' : state })),
            m.description ? h('p', { text: m.description }) : null,
            h('p', { class: 'plugin-asks', text: `Allowed to: ${asks}.` }),
            m.panels.length || m.commands.length || m.exporters.length || m.importers.length ? h('p', { class: 'plugin-adds', text: `Adds: ${[
              ...m.panels.map((x) => `panel ${x.title}`), ...m.commands.map((x) => `command ${x.title}`),
              ...m.exporters.map((x) => `export ${x.title}`), ...m.importers.map((x) => `import ${x.title}`),
            ].join(', ')}.` }) : null,
            failed ? h('p', { class: 'plugin-problem', role: 'alert', text: `Stopped: ${failed}` }) : null,
            h('div', { class: 'plugin-actions' },
              ...(p.enabled ? m.panels.map((x) => button({ text: `Show ${x.title}`, class: 'small',
                onClick: () => studio.dock.show(`plugin:${m.id}:${x.id}`) })) : []),
              button({ text: p.enabled ? 'Turn off' : 'Turn on', class: 'small', onClick: () => mgr.setEnabled(m.id, !p.enabled) }),
              button({
                text: 'Remove', class: 'small ghost',
                onClick: async () => { if (await confirm({ title: `Remove "${m.name}"?`, confirmLabel: 'Remove', danger: true,
                  message: 'Its panels and commands go away, and so does anything it kept.' })) mgr.remove(m.id); },
              })));
        }) : [h('div', { class: 'empty' }, h('h3', { text: 'No plugins yet' }),
          h('p',
            { text: 'A plugin adds a panel, a command, an exporter or an importer to the studio. Start a new one to see how small one can be.' }))]));
      }

      fill(el,
        h('div', { class: 'toolbar art-bar' },
          button({ text: 'Start a new plugin', icon: 'plus', class: 'small primary', onClick: newPlugin }),
          fromProject,
          button({
            text: 'Install from this project', class: 'small',
            onClick: async () => { if (fromProject.value) await install(studio.project.readText(fromProject.value)); },
          }),
          button({ text: 'Install from a file…', icon: 'upload', class: 'small', onClick: () => fileInput.click() }), fileInput),
        list,
        gallery,
        h('p', {
          class: 'ship-note plugin-note',
          text: 'Plugins run in a closed box with no internet and no access to the rest of the studio. '
            + 'They can only use what they listed when you installed them.',
        }));
      draw();
      studio.on('plugins', draw);
      studio.on('files', draw);
      studio.on('project', draw);
      return { el, focus: () => el.querySelector('button')?.focus(), onShow: draw };
    },
  };
}
