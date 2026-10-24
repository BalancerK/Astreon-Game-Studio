// Bringing an SVG drawing into a project. It is kept as text in `art/` (so it can still be edited) and turned into a PNG in `assets/` (what the game draws, since a
// game's worker cannot draw SVG). A small dialog shows the drawing and lets you choose how big the PNG is. The checks and sizes are in store/svg.js.
import { svgProblem, svgSize, rasterSize, svgStem } from '../store/svg.js';
import { accept } from '../store/assets.js';
import { showDialog } from '../ui/dialog.js';
import { h } from '../ui/dom.js';

/** Draw an SVG (as text) onto a canvas of this size and give back the PNG bytes. */
export async function rasterize(text, w, h2) {
  const url = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h2;
    canvas.getContext('2d').drawImage(img, 0, 0, w, h2);
    const blob = await new Promise((done) => canvas.toBlob(done, 'image/png'));
    if (!blob) throw new Error('the picture could not be made');
    return new Uint8Array(await blob.arrayBuffer());
  } finally { URL.revokeObjectURL(url); }
}

/**
 * Ask how big the PNG should be, then make it and keep both files.
 * @param {import('./studio.js').Studio} studio
 * @param {string} text the SVG
 * @param {string} stem the name to build the file names from
 * @param {{replace?: boolean}} [o] `replace`: this is the same drawing again, so its PNG is overwritten instead of getting a new name
 * @returns {Promise<{png: string, svg: string} | null>} the files made, or null when cancelled
 */
export async function makePictureFromSvg(studio, text, stem, { replace = false } = {}) {
  const project = studio.project;
  if (!project) return null;
  const problem = svgProblem(text);
  if (problem) { studio.toasts.show(`That drawing was left out: ${problem}.`, { kind: 'error', ms: 10_000 }); return null; }
  const size = svgSize(text);
  const url = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' }));
  const scale = h('select', { aria: { label: 'Size of the picture' } },
    [['1', 'Its own size'], ['2', 'Twice as big'], ['4', 'Four times as big'], ['custom', 'A width I choose…']]
      .map(([v, t]) => h('option', { value: v, text: t })));
  const width = h('input', { type: 'number', min: 1, max: 1024, value: 128, hidden: true, aria: { label: 'Width in pixels' } });
  const keep = h('input', { type: 'checkbox', checked: true, id: 'svg-keep' });
  const info = h('p', { class: 'dim' });
  const current = () => rasterSize(size, scale.value === 'custom' ? { width: Number(width.value) || 1 } : { scale: Number(scale.value) });
  const refresh = () => {
    width.hidden = scale.value !== 'custom';
    const r = current();
    info.textContent = `The picture will be ${r.w} × ${r.h} pixels${size ? '' : ' (the drawing does not say how big it is)'}.`;
  };
  // a small drawing is made bigger to begin with, so it stays sharp when the game draws it larger
  const biggest = size ? Math.max(size.w, size.h) : 64;
  scale.value = biggest <= 128 ? '4' : biggest <= 256 ? '2' : '1';
  scale.addEventListener('change', refresh);
  width.addEventListener('input', refresh);
  refresh();
  const body = h('div', { class: 'settings-dialog' },
    h('p', { text: 'A game draws pictures, not drawings, so this makes a PNG from your SVG.' }),
    h('img', { class: 'asset-preview', src: url, alt: 'Your drawing', style: { maxHeight: '160px', maxWidth: '100%' } }),
    h('label', { class: 'settings-field' }, h('span', { text: 'Size' }), scale), width, info,
    h('label', { for: 'svg-keep', class: 'art-inline' }, keep, ' Keep the drawing in art/ so I can change it later'));
  const answer = await showDialog({
    title: `Make a picture from ${stem}.svg`, body,
    buttons: [{ label: 'Cancel', value: false }, { label: 'Make the picture', value: true, primary: true }],
  });
  const r = current();
  URL.revokeObjectURL(url);
  if (answer !== true) return null;
  let bytes;
  try { bytes = await rasterize(text, r.w, r.h); } catch (error) {
    studio.toasts.show(`The drawing could not be turned into a picture: ${error.message}`, { kind: 'error', ms: 10_000 });
    return null;
  }
  const verdict = accept(`${stem}.png`, bytes, (p) => !replace && project.has(p));
  if (!verdict.ok) { studio.toasts.show(verdict.reason, { kind: 'error' }); return null; }
  project.write(verdict.path, bytes);
  const svgPath = `art/${stem}.svg`;
  if (keep.checked && project.readText(svgPath) !== text) project.write(svgPath, text);
  studio.emit('files');
  studio.emit('plugin-event', 'assets-imported');
  studio.toasts.show(`Made ${verdict.path}. Use it as image: '${verdict.path}'.`, { kind: 'success' });
  studio.openFile(verdict.path);
  return { png: verdict.path, svg: keep.checked ? svgPath : '' };
}

/** An SVG file the person chose: read it, and go through the dialog. */
export async function importSvgFile(studio, file) {
  let text;
  try { text = await file.text(); } catch { studio.toasts.show(`"${file.name}" could not be read.`, { kind: 'error' }); return null; }
  return makePictureFromSvg(studio, text, svgStem(file.name));
}
