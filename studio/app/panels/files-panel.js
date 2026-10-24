// The Files panel: every file of the project as a tree you can fold and filter. Click or press Enter to open one; F2 renames, Delete deletes (with an Undo for a
// few seconds); a right click offers more; drag a file into an editor to open it there. The tree itself is shared with the explorer beside the code (ui/file-tree.js).
import { h, button } from '../ui/dom.js';
import { importAssets } from '../core/import-assets.js';
import { openFileMenu } from '../core/file-menu.js';
import { createFileTree } from '../ui/file-tree.js';
import { ACCEPT } from '../store/assets.js';

export function filesPanel(studio) {
  return {
    id: 'files',
    title: 'Files',
    icon: 'folder',
    create() {
      const tree = createFileTree(studio, {
        label: 'Project files',
        onOpen: (path) => { studio.openFile(path); studio.dock?.focus('editor'); },
        onContext: (row, x, y, el) => openFileMenu(studio, row, { x, y }, el),
      });
      const picker = h('input', {
        type: 'file', multiple: true, accept: ACCEPT, hidden: true, aria: { label: 'Choose pictures and sounds to import' },
        on: { change: async () => { const chosen = [...picker.files]; picker.value = ''; await importAssets(studio, chosen); } },
      });
      const toolbar = h('div', { class: 'toolbar' },
        button({ label: 'New file', icon: 'plus', text: 'New', class: 'small', onClick: () => studio.commands.execute('file.new') }),
        button({ label: 'Import pictures and sounds', icon: 'upload', text: 'Import', class: 'small', onClick: () => picker.click() }), picker,
        h('span', { class: 'grow' }),
        button({ label: 'Rename file', icon: 'edit', class: 'small ghost', onClick: () => studio.commands.execute('file.rename') }),
        button({ label: 'Delete file', icon: 'trash', class: 'small ghost', onClick: () => studio.commands.execute('file.delete') }));
      const el = h('div', { class: 'panel-body', 'aria-label': 'Files' }, toolbar, tree.el);
      el.addEventListener('dragover',
        (e) => { if ([...(e.dataTransfer?.types ?? [])].includes('Files')) { e.preventDefault(); el.classList.add('dropping'); } });
      el.addEventListener('dragleave', () => el.classList.remove('dropping'));
      el.addEventListener('drop', (e) => {
        el.classList.remove('dropping');
        if (!e.dataTransfer?.files?.length) return;
        e.preventDefault();
        importAssets(studio, [...e.dataTransfer.files]);
      });
      for (const ev of ['project', 'files', 'active-file', 'diagnostics']) studio.on(ev, () => tree.refresh());
      tree.refresh();
      return { el, focus: () => tree.focus() };
    },
  };
}
