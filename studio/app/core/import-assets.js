// Bringing the person's own pictures and sounds into the open project: read the files they chose, check each one (store/assets.js), keep the good ones under
// assets/, and say clearly what was left out and why.
import { accept, assetsOf, LIMITS } from '../store/assets.js';
import { importSvgFile } from './import-svg.js';

/**
 * @param {import('./studio.js').Studio} studio
 * @param {File[]} files
 * @returns {Promise<string[]>} the paths that were added
 */
export async function importAssets(studio, files) {
  const project = studio.project;
  if (!project) { studio.toasts.show('Open a project first: the files are kept in it.', { kind: 'info' }); return []; }
  const added = [];
  const refused = [];
  let room = LIMITS.count - assetsOf(project).length;
  for (const file of files) {
    if (/\.svg$/i.test(file.name)) { await importSvgFile(studio, file); continue; }       // a drawing: made into a picture after asking how big
    if (room <= 0) { refused.push(`"${file.name}": a project can hold up to ${LIMITS.count} pictures and sounds.`); continue; }
    let bytes;
    try { bytes = new Uint8Array(await file.arrayBuffer()); } catch { refused.push(`"${file.name}" could not be read.`); continue; }
    const verdict = accept(file.name, bytes, (p) => project.has(p));
    if (!verdict.ok) { refused.push(verdict.reason); continue; }
    try {
      project.write(verdict.path, bytes);
      added.push(verdict.path);
      room--;
    } catch (error) {
      refused.push(`"${file.name}": ${error.message}`);
    }
  }
  if (added.length) {
    studio.emit('files');
    studio.openFile(added[0]);
    studio.toasts.show(added.length === 1 ? `Added ${added[0]}. Use it as image: '${added[0]}'.`
      : `Added ${added.length} files to the assets folder.`, { kind: 'success' });
    studio.emit('plugin-event', 'assets-imported');
  }
  if (refused.length) {
    studio.toasts.show(refused.length === 1 ? refused[0] : `${refused.length} files were left out: ${refused.slice(0, 3).join(' ')}`,
      { kind: 'error', ms: 10000 });
  }
  return added;
}
