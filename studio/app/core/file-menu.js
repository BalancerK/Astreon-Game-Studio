// What a right click (or the menu key) on a file or folder offers, the same in the Files panel and in the explorer beside the code.
import { openContextMenu } from '../ui/context-menu.js';

/**
 * @param {import('./studio.js').Studio} studio
 * @param {{kind: 'dir' | 'file', path: string}} row
 * @param {{x: number, y: number}} at
 * @param {HTMLElement} [from] the element to give the focus back to
 */
export function openFileMenu(studio, row, at, from) {
  const items = [];
  if (row.kind === 'file') {
    items.push({ label: 'Open', run: () => studio.openFile(row.path) });
    items.push({ label: 'Open to the side', run: () => studio.splitFile(row.path, 'right') });
    items.push('separator');
    items.push({ label: 'Rename…', hint: 'F2', run: () => studio.commands.execute('file.rename', row.path) });
    items.push({ label: 'Delete…', run: () => studio.commands.execute('file.delete', row.path) });
    items.push('separator');
    items.push({ label: 'Copy the path', run: () => navigator.clipboard?.writeText(row.path).catch(() => {}) });
  } else {
    items.push({ label: 'New file in this folder…', run: () => studio.commands.execute('file.new', row.path) });
    items.push({ label: 'Copy the path', run: () => navigator.clipboard?.writeText(row.path).catch(() => {}) });
  }
  return openContextMenu(at, items, { label: row.kind === 'file' ? `File ${row.path}` : `Folder ${row.path}`, restore: from });
}
