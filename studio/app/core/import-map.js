// Bringing a level in from Tiled or LDtk: read the file the person chose, write what it holds as levels (for the Level painter) and a scene (for the Scene panel), and say what came
// in and what was left out. The reading is in store/map-import.js, tested in Node.
import { importMap, filesFor } from '../store/map-import.js';

/**
 * @param {import('./studio.js').Studio} studio
 * @param {{name: string, text: () => Promise<string>}} file
 * @returns {Promise<string[]>} the paths that were written
 */
export async function importMapFile(studio, file) {
  const project = studio.project;
  if (!project) { studio.toasts.show('Open a project first: the level is written into it.', { kind: 'info' }); return []; }
  let imported;
  try {
    imported = importMap(await file.text(), file.name);
  } catch (error) {
    studio.toasts.show(error.message, { kind: 'error', ms: 9000 });
    return [];
  }
  const files = filesFor(imported, new Set(project.list()));
  for (const [path, text] of Object.entries(files)) project.write(path, text);
  studio.emit('files');
  const levels = Object.keys(files).filter((p) => p.startsWith('src/levels/')).length;
  const scenes = Object.keys(files).filter((p) => p.startsWith('scenes/')).length;
  const what = [levels ? `${levels} level${levels === 1 ? '' : 's'} (in src/levels, open the Level painter)` : '',
    scenes ? `${scenes} scene${scenes === 1 ? '' : 's'} of objects (in scenes, open the Scene panel)` : ''].filter(Boolean).join(' and ');
  const from = imported.source === 'tiled' ? 'Tiled' : 'LDtk';
  const left = imported.warnings.length ? ` Left out or changed: ${imported.warnings.slice(0, 3).join(' ')}` : '';
  studio.toasts.show(`Brought in ${what} from ${from}.${left}`, { kind: 'success', ms: imported.warnings.length ? 14000 : 7000 });
  studio.log?.('system', `Imported ${Object.keys(files).join(', ')} from ${file.name}.${imported.warnings.map((w) => ` ${w}`).join('')}`);
  studio.emit('plugin-event', 'map-imported');
  return Object.keys(files);
}

/** Ask the person for a Tiled or LDtk file (a file chooser made on the spot, so the menu, the palette and the painter can all open it). */
export function pickMapFile(studio) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,.tmj,.ldtk,application/json';
  input.addEventListener('change', () => { const f = input.files[0]; if (f) importMapFile(studio, f); });
  input.click();
}
