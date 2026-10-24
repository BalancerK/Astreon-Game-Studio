// The "Folder link" window: how the link is doing, what it leaves out (and why), and the files that were changed in both places, each with a choice of which
// version to keep. It redraws when the link changes, so pressing "Use the folder's" updates the list in front of you.
import { h, button } from '../ui/dom.js';
import { showDialog } from '../ui/dialog.js';

const STATUS = {
  synced: 'In step', syncing: 'Syncing…', 'needs-permission': 'Waiting for permission (press Reconnect)', error: 'A problem', off: 'Not linked',
};

const ago = (t) => {
  if (!t) return 'not yet';
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  return s < 5 ? 'just now' : s < 90 ? `${s} seconds ago` : `${Math.round(s / 60)} minutes ago`;
};

/** @param {import('./folder.js').FolderLinker} folder */
export function openFolderDialog(folder) {
  const body = h('div', { class: 'folder-dialog' });
  const area = (label, value, rows, hint) => {
    const box = h('textarea', { rows, spellcheck: false, value, aria: { label }, style: { width: '100%', font: '12px monospace' } });
    const name = h('label', { text: label, style: { display: 'block', margin: '8px 0 2px' } });
    return { box, field: h('div', {}, name, box, h('div', { class: 'muted', text: hint })) };
  };
  let dirsBox;
  let ignoreBox;
  const suggestions = () => {
    const outside = folder.leftOut.filter((s) => /outside assets\//.test(s)).map((s) => s.split('/')[0]);
    return [...new Set(outside)].filter((d) => !d.includes(' ') && !folder.assetDirs.includes(d));
  };
  const settings = () => {
    const dirs = area('Also bring in pictures and sounds from these folders (one per line)', folder.assetDirs.join('\n'), 3,
      'A picture in the folder art/ shows up in the project as assets/art/…, and goes back to art/ when it changes.');
    const ign = area('Leave these alone (one pattern per line)', folder.ignore.join('\n'), 3,
      "Like *.psd, drafts/, src/old/*.js. Neither the studio's copy nor the folder's is touched.");
    dirsBox = dirs.box;
    ignoreBox = ign.box;
    const lines = (box) => box.value.split('\n').map((l) => l.trim()).filter(Boolean);
    const add = suggestions();
    return h('div', {}, h('h3', { text: 'Choices' }), dirs.field,
      add.length ? h('p', {}, 'Found pictures or sounds in: ', add.map((d) => button({
        text: `Bring in ${d}/`, onClick: () => folder.configure({ assetDirs: [...folder.assetDirs, d] }),
      }))) : null,
      ign.field,
      h('p', {}, button({
        text: 'Apply choices', class: 'primary', onClick: () => folder.configure({ assetDirs: lines(dirsBox), ignore: lines(ignoreBox) }),
      })));
  };
  const draw = () => {
    const conflicts = folder.conflicts();
    const keep = body.querySelector('.folder-choices');
    const choices = keep?.contains(document.activeElement) ? keep : null;                      // do not pull a text box away while typing
    body.replaceChildren(
      h('p', {}, h('b', { text: folder.name || 'No folder' }), ` — ${STATUS[folder.status] ?? folder.status}`,
        folder.error ? ` (${folder.error})` : '', h('br'), `Last in step: ${ago(folder.lastSync)}. Files kept in step: ${folder.fileCount}.`),
      h('h3', { text: `Changed in both places (${conflicts.length})` }),
      conflicts.length
        ? h('ul', { class: 'folder-list' }, conflicts.map((c) => h('li', {},
          h('code', { text: c.original }), ' ',
          button({ text: 'Keep mine', title: 'Keep the project version', onClick: () => folder.resolve(c.copy, 'mine') }), ' ',
          button({ text: 'Use the folder version', title: 'Take the folder version', onClick: () => folder.resolve(c.copy, 'folder') }))))
        : h('p', { class: 'muted', text: 'Nothing. If a file changes in both places, yours stays and the folder copy is kept here.' }),
      h('h3', { text: `Left out (${folder.leftOut.length})` }),
      folder.leftOut.length
        ? h('ul', { class: 'folder-list' }, folder.leftOut.map((s) => h('li', { text: s })))
        : h('p', { class: 'muted', text: 'Nothing. Hidden folders, node_modules and other kinds of file are never looked at.' }),
      choices ?? h('div', { class: 'folder-choices' }, settings()));
  };
  draw();
  const stop = ['folder', 'files'].map((ev) => folder.studio.on(ev, draw));
  return showDialog({
    title: 'Folder link', body,
    buttons: [
      { label: 'Unlink', value: 'unlink', danger: true },
      { label: 'Reconnect', value: 'reconnect' },
      { label: 'Sync now', value: 'sync' },
      { label: 'Close', value: 'close', primary: true },
    ],
    beforeClose: (value) => {
      if (value === 'sync') { folder.sync(); return false; }
      if (value === 'reconnect') { folder.reconnect(); return false; }
      return true;
    },
  }).then((value) => {
    for (const off of stop) off();
    if (value === 'unlink') folder.unlink();
  });
}
