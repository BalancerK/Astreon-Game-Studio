// Slicing a sprite sheet: pick a picture of your project, say how big one frame is (or let the studio guess), see the grid laid over it, and either make a pixel
// sprite from the cells (to paint over and animate in the Sprite painter) or get the code that draws a cell straight from the picture. The cutting and the
// colours are in paint/sheet-model.js (tested in Node); this is the dialog around it.
import { gridOf, guessCell, emptyCells, spriteFromSheet, sheetCode } from '../paint/sheet-model.js';
import { serializeSprite } from '../paint/sprite-model.js';
import { assetsOf } from '../store/assets.js';
import { showDialog } from '../ui/dialog.js';
import { h, button } from '../ui/dom.js';

const PREVIEW = { w: 440, h: 280 };

/** Read a picture of the project as pixels. */
async function pixelsOf(bytes, mime) {
  const bitmap = await createImageBitmap(new Blob([bytes], { type: mime }));
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const g = canvas.getContext('2d', { willReadFrequently: true });
  g.drawImage(bitmap, 0, 0);
  const { data } = g.getImageData(0, 0, bitmap.width, bitmap.height);
  return { bitmap, w: bitmap.width, h: bitmap.height, rgba: data };
}

/**
 * @param {import('./studio.js').Studio} studio
 * @param {string} [startPath] the picture to start with
 */
export async function openSliceDialog(studio, startPath) {
  const project = studio.project;
  if (!project) return null;
  const pictures = assetsOf(project).filter((a) => a.kind === 'image');
  if (!pictures.length) {
    studio.toasts.show('There is no picture to slice yet. Import one first (File > Import pictures and sounds).', { kind: 'info' });
    return null;
  }
  const picker = h('select', { aria: { label: 'Picture to slice' } },
    pictures.map((a) => h('option', { value: a.path, text: a.path, selected: a.path === startPath })));
  const num = (label, value, min = 0) => h('input', { type: 'number', min, max: 2048, value, aria: { label } });
  const cw = num('Cell width', 16, 1);
  const ch = num('Cell height', 16, 1);
  const margin = num('Border round the sheet', 0);
  const spacing = num('Gap between cells', 0);
  const skip = h('input', { type: 'checkbox', checked: true, id: 'slice-skip' });
  const rowsAnim = h('input', { type: 'checkbox', checked: true, id: 'slice-rows' });
  const name = h('input', { type: 'text', value: 'sheet', spellcheck: false, aria: { label: 'Name for the sprite' } });
  const info = h('p', { role: 'status', aria: { live: 'polite' } });
  const problem = h('p', { class: 'error', role: 'alert' });
  const code = h('pre', { class: 'learn-code', hidden: true });
  const canvas = h('canvas', {
    class: 'art-canvas slice-canvas', width: PREVIEW.w, height: PREVIEW.h, role: 'img', aria: { label: 'The picture with the grid on it' },
  });
  canvas.style.cursor = 'default';
  let pic = null;
  let grid = null;

  const options = () => ({ cw: Number(cw.value), ch: Number(ch.value), margin: Number(margin.value), spacing: Number(spacing.value) });
  const refresh = () => {
    if (!pic) return;
    grid = gridOf(pic.w, pic.h, options());
    const empty = emptyCells(pic.rgba, pic.w, grid);
    const scale = Math.min(PREVIEW.w / pic.w, PREVIEW.h / pic.h);
    const g = canvas.getContext('2d');
    g.clearRect(0, 0, PREVIEW.w, PREVIEW.h);
    g.imageSmoothingEnabled = false;
    const sw = Math.round(pic.w * scale);
    const sh = Math.round(pic.h * scale);
    canvas.width = Math.max(1, sw);
    canvas.height = Math.max(1, sh);
    const c2 = canvas.getContext('2d');
    c2.imageSmoothingEnabled = false;
    c2.drawImage(pic.bitmap, 0, 0, sw, sh);
    c2.lineWidth = 1;
    for (const c of grid.cells) {
      c2.strokeStyle = empty.has(c.index) ? 'rgba(255, 80, 80, .9)' : 'rgba(0, 220, 255, .9)';
      const cx = Math.round(c.x * scale);
      const cy = Math.round(c.y * scale);
      c2.strokeRect(cx + 0.5, cy + 0.5, Math.max(1, Math.round(c.w * scale) - 1), Math.max(1, Math.round(c.h * scale) - 1));
      if (c.w * scale >= 22) {
        c2.fillStyle = 'rgba(0, 0, 0, .65)';
        c2.fillRect(Math.round(c.x * scale) + 1, Math.round(c.y * scale) + 1, 18, 11);
        c2.fillStyle = '#fff';
        c2.font = '9px sans-serif';
        c2.fillText(String(c.index), Math.round(c.x * scale) + 3, Math.round(c.y * scale) + 10);
      }
    }
    const n = grid.cells.length;
    info.textContent = n
      ? `${pic.w} × ${pic.h} pixels: ${grid.cols} across and ${grid.rows} down is ${n} frame${n === 1 ? '' : 's'}, ${empty.size} of them empty (red).`
        + `${grid.leftover.x || grid.leftover.y
          ? ` ${grid.leftover.x} pixels at the right and ${grid.leftover.y} at the bottom are not in any cell.` : ''}`
      : `${pic.w} × ${pic.h} pixels: the cell is bigger than the picture.`;
    code.textContent = grid.cells.length ? sheetCode(picker.value, grid, 0) : '';
    problem.textContent = '';
  };

  async function load() {
    const path = picker.value;
    const asset = pictures.find((a) => a.path === path);
    info.textContent = 'Reading the picture…';
    try {
      pic = await pixelsOf(asset.bytes, asset.mime);
    } catch {
      pic = null;
      info.textContent = 'That picture could not be read.';
      return;
    }
    const guess = guessCell(pic.w, pic.h);
    cw.value = guess.cw;
    ch.value = guess.ch;
    margin.value = 0;
    spacing.value = 0;
    name.value = path.replace(/^assets\//, '').replace(/\.[^.]+$/, '').replace(/[^\w-]+/g, '-').replace(/^[^a-z]+/i, 'a') || 'sheet';
    refresh();
  }
  picker.addEventListener('change', load);
  for (const el of [cw, ch, margin, spacing]) el.addEventListener('input', refresh);

  const field = (label, control) => h('label', { class: 'settings-field' }, h('span', { text: label }), control);
  const body = h('div', { class: 'settings-dialog slice-dialog' },
    h('p', { text: 'A sprite sheet is one picture with many frames in a grid. Tell the studio how big one frame is.' }),
    field('Picture', picker),
    h('div', { class: 'settings-size' }, field('Cell width', cw), field('Cell height', ch), field('Border', margin), field('Gap', spacing)),
    h('div', { class: 'art-canvas-wrap slice-preview' }, canvas),
    info,
    h('label', { for: 'slice-skip', class: 'art-inline' }, skip, ' Leave out cells with nothing in them'),
    h('label', { for: 'slice-rows', class: 'art-inline' }, rowsAnim, ' Make an animation from each row'),
    field('Name for the sprite', name),
    problem,
    h('div', { class: 'toolbar' },
      button({ text: 'Show the code for using it as a picture', class: 'small', onClick: () => { code.hidden = !code.hidden; } })),
    code);

  let made = null;
  const done = showDialog({
    title: 'Slice a sprite sheet', body,
    buttons: [{ label: 'Close', value: false }, { label: 'Make a sprite from the cells', value: true, primary: true }],
    initialFocus: () => picker,
    beforeClose: (value) => {
      if (value !== true) return true;
      if (!pic || !grid) { problem.textContent = 'There is no picture to slice.'; return false; }
      const stem = name.value.trim();
      if (!/^[a-z][\w-]{0,23}$/i.test(stem)) {
        problem.textContent = 'Name the sprite with letters and numbers, starting with a letter.';
        name.focus();
        return false;
      }
      const file = `src/art/${stem}.js`;
      if (project.has(file)) { problem.textContent = `There is already a sprite called ${stem}. Choose another name.`; name.focus(); return false; }
      const out = spriteFromSheet(pic.rgba, pic.w, grid, { skipEmpty: skip.checked, rowAnimations: rowsAnim.checked });
      if (out.error) { problem.textContent = out.error; return false; }
      made = { file, out, stem };
      return true;
    },
  });
  load();
  const answer = await done;
  pic?.bitmap.close?.();
  if (answer !== true || !made) return null;
  project.write(made.file, serializeSprite(made.out.sprite, `Cut from ${picker.value} with the sheet slicer.`));
  studio.emit('files');
  studio.dock.show('sprites');
  studio.spriteApi?.open(made.file);
  const extra = made.out.reduced ? ' Its colours were merged to fit the 62-colour palette.' : '';
  const size = `${made.out.sprite.frames.length} frames of ${made.out.sprite.w} × ${made.out.sprite.h}`;
  studio.toasts.show(`Made ${made.file}: ${size}.${extra}`, { kind: 'success', ms: 8000 });
  studio.emit('plugin-event', 'sheet-sliced');
  return made.file;
}
