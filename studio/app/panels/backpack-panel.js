// The Backpack panel: carry things from one project to another. Everything in the open project that can be carried is listed on top; press "Put in backpack" and it is kept on this
// computer (in the browser, never sent anywhere). Open another project and add it from the backpack: it goes in under a name that is free there, so nothing of yours is overwritten. The
// backpack can be saved as a file and loaded on another computer. The logic is in store/backpack.js.
import { h, button, fill } from '../ui/dom.js';
import { confirm } from '../ui/dialog.js';
import * as B from '../store/backpack.js';
import { parseSprite } from '../paint/sprite-model.js';
import { download } from '../ui/hub.js';

const KEY = 'backpack';

export function backpackPanel(studio) {
  return {
    id: 'backpack',
    title: 'Backpack',
    icon: 'folder',
    create() {
      let items = [];
      let query = '';
      let kind = '';
      const toolbar = h('div', { class: 'toolbar art-bar' });
      const here = h('div', { class: 'backpack-here' });
      const packed = h('div', { class: 'backpack-packed' });
      const el = h('div', { class: 'panel-body backpack', 'aria-label': 'Backpack' }, toolbar, here, packed);

      async function load() {
        try { items = B.parseBackpack(JSON.stringify({ format: B.FORMAT, version: 1,
          items: (await studio.store.getMeta(KEY)) ?? [] })); } catch { items = []; }
        draw();
      }
      async function save() {
        try { await studio.store.setMeta(KEY, items); } catch (error) { studio.toasts.show(`The backpack could not be kept: ${error.message}`,
          { kind: 'error' }); }
      }
      const filesNow = () => (studio.project ? studio.textFiles() : {});

      function thumb(item) {
        if (item.kind !== 'sprite') return h('span', { class: 'backpack-kind', text: B.KINDS[item.kind] });
        const canvas = h('canvas', { width: 32, height: 32, class: 'pack-thumb', role: 'img', 'aria-label': item.name });
        try {
          const s = parseSprite(item.payload);
          const g = canvas.getContext('2d');
          const k = Math.max(1, Math.floor(32 / Math.max(s.w, s.h)));
          s.frames[0].forEach((row, y) => [...row].forEach((ch, x) => { if (s.palette[ch]) { g.fillStyle = s.palette[ch]; g.fillRect(x * k, y * k,
            k, k); } }));
        } catch { /* a damaged sprite shows an empty square */ }
        return canvas;
      }

      async function putIn(entry) {
        try {
          items = B.addItem(items, B.take(filesNow(), entry.kind, entry.name), { from: studio.project?.name ?? '' });
          await save();
          studio.toasts.show(`Put ${B.KINDS[entry.kind].toLowerCase()} "${entry.name}" in the backpack.`, { kind: 'success' });
        } catch (error) { studio.toasts.show(error.message, { kind: 'error' }); }
        draw();
      }
      async function addToProject(item) {
        if (!studio.project) { studio.toasts.show('Open a project first: the thing is added to it.', { kind: 'info' }); return; }
        try {
          const placed = B.put(filesNow(), item);
          if (placed.replaces && !await confirm({
            title: `Replace the ${B.KINDS[item.kind].toLowerCase()} in this project?`, confirmLabel: 'Replace', danger: true,
            message: `This project already has ${placed.path}. The one from the backpack will take its place.`,
          })) return;
          studio.project.write(placed.path, placed.text);
          studio.emit('files');
          studio.toasts.show(`Added ${B.KINDS[item.kind].toLowerCase()} "${placed.name}" (${placed.path}).`, { kind: 'success' });
          studio.emit('plugin-event', 'backpack-added');
        } catch (error) { studio.toasts.show(error.message, { kind: 'error', ms: 8000 }); }
        draw();
      }
      async function remove(item) {
        items = B.removeItem(items, item.id);
        await save();
        draw();
      }
      async function saveFile() {
        download('backpack.json', new TextEncoder().encode(B.serializeBackpack(items)));
      }
      function loadFile() {
        const input = h('input', { type: 'file', accept: '.json,application/json' });
        input.addEventListener('change', async () => {
          const f = input.files[0];
          if (!f) return;
          try {
            const merged = B.mergeBackpack(items, B.parseBackpack(await f.text()));
            items = merged.items;
            await save();
            const plural = merged.added === 1 ? '' : 's';
            const already = 'Everything in that file is in the backpack already.';
            const said = merged.added ? `Added ${merged.added} thing${plural} to the backpack.` : already;
            studio.toasts.show(said, { kind: 'success' });
          } catch (error) { studio.toasts.show(error.message, { kind: 'error' }); }
          draw();
        });
        input.click();
      }

      function draw() {
        fill(toolbar,
          button({ text: 'Save the backpack as a file', class: 'small', disabled: !items.length, onClick: saveFile }),
          button({ text: 'Load a backpack file…', class: 'small', onClick: loadFile }),
          h('span', { class: 'dim', text: `${items.length} thing${items.length === 1 ? '' : 's'} in the backpack, kept on this computer only.` }));
        const mine = studio.project ? B.itemsIn(filesNow()) : [];
        fill(here, h('h4', { text: studio.project ? `In ${studio.project.name}` : 'No project open' }),
          mine.length ? h('div', { class: 'backpack-list' }, ...mine.map((e) => h('div', { class: 'backpack-row' },
            h('span', { class: 'backpack-kind', text: B.KINDS[e.kind] }), h('strong', { text: e.name }),
            button({ text: 'Put in backpack', class: 'small', aria: { label: `Put ${e.name} in the backpack` }, onClick: () => putIn(e) }))))
            : h('p', { class: 'dim',
              text: studio.project ? 'Nothing here can be carried yet: make a sprite, a sound, an effect, a screen…'
                : 'Open a project to see what it has.' }));
        const shown = B.search(items, query, kind);
        const kinds = [...new Set(items.map((i) => i.kind))];
        fill(packed, h('h4', { text: 'In the backpack' }),
          items.length ? h('div', { class: 'state-line' },
            h('input', { type: 'search', value: query, placeholder: 'Search…', class: 'text-filter', aria: { label: 'Search the backpack' },
              on: { input: (e) => { query = e.target.value; draw(); e.target.focus(); } } }),
            h('select', { aria: { label: 'Kind of thing' }, on: { change: (e) => { kind = e.target.value; draw(); } } }, h('option', { value: '',
              text: 'Everything' }),
              ...kinds.map((k) => h('option', { value: k, text: B.KINDS[k], selected: k === kind })))) : null,
          shown.length ? h('div', { class: 'backpack-list' }, ...shown.map((i) => h('div', { class: 'backpack-row' }, thumb(i), h('strong',
            { text: i.name }),
            h('span', { class: 'dim', text: `${B.KINDS[i.kind]}${i.from ? `, from ${i.from}` : ''}` }),
            button({ text: 'Add to this project', class: 'small primary', aria: { label: `Add ${i.name} to this project` },
              disabled: !studio.project, onClick: () => addToProject(i) }),
            button({ text: 'Remove', class: 'small ghost', aria: { label: `Remove ${i.name} from the backpack` }, onClick: () => remove(i) }))))
            : h('p', { class: 'dim',
              text: items.length ? 'Nothing matches.' : 'The backpack is empty. Put a sprite, a sound or a screen in it from the list above.' }));
      }

      studio.on('files', draw);
      studio.on('file-changed', draw);
      studio.on('project', draw);
      load();
      return { el, focus: () => el.querySelector('button')?.focus(), onShow: load };
    },
  };
}
