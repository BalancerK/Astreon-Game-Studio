// The dialog for renaming many things at once (Ctrl+F2): choose names from a pattern or find and replace, see every new name before anything changes, then Apply (one step of
// undo) or Cancel. What the names become is worked out in ../batch-rename.js.
import { h } from './dom.js';
import { previewRename, canApply } from '../batch-rename.js';

const STYLE = `
.batch-dialog { position: absolute; z-index: 12; left: 50%; top: 8%; transform: translateX(-50%); width: min(560px, calc(100% - 24px)); max-height: 84%; overflow: auto; padding: 12px 14px;
  border-radius: 10px; background: #181c2a; border: 1px solid #4d5a8c; color: #e8ecf6; font: 13px system-ui, sans-serif; box-shadow: 0 12px 40px rgba(0, 0, 0, .55); }
.batch-dialog h3 { margin: 0 0 8px; font-size: 15px; } .batch-dialog .grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px 10px; margin-bottom: 8px; }
.batch-dialog label { display: grid; gap: 2px; } .batch-dialog input[type=text], .batch-dialog input[type=number], .batch-dialog select { padding: 3px 6px; background: #0e1118; border: 1px solid #3a4468; border-radius: 4px; }
.batch-dialog .wide { grid-column: 1 / -1; } .batch-dialog .check { display: flex; gap: 6px; align-items: center; }
.batch-dialog table { width: 100%; border-collapse: collapse; margin: 6px 0; } .batch-dialog td { padding: 2px 6px; border-top: 1px solid #2a3150; overflow-wrap: anywhere; }
.batch-dialog td.from { opacity: .65; } .batch-dialog tr.same td { opacity: .45; } .batch-dialog tr.bad td.to { color: #ff8a80; }
.batch-dialog .summary { opacity: .85; margin: 4px 0 8px; } .batch-dialog .buttons { display: flex; gap: 8px; justify-content: flex-end; }
`;

const DEFAULTS = { target: 'name', mode: 'pattern', pattern: '{prefab} {n}', start: 1, step: 1, digits: 1, find: '', replace: '', matchCase: false };

/**
 * Open the dialog for the selected entities. Does nothing (and says why) when nothing is selected.
 * @param {any} editor the object `startEditor` makes
 * @returns {{close: () => void} | null}
 */
export function openBatchRename(editor) {
  const { doc, selection, stage } = editor;
  if (editor.state.playing) return null;
  const ids = doc.order.filter((id) => selection.has(id));
  if (!ids.length) { editor.say('Select what to rename first (Ctrl+F2 renames several at once)'); return null; }
  if (document.querySelector('.batch-dialog')) return null;
  if (!document.getElementById('batch-rename-style')) document.head.append(h('style', { id: 'batch-rename-style' }, STYLE));
  const o = { ...DEFAULTS, ...(editor.state.batchRename ?? {}) };
  const items = ids.map((id) => ({ id, name: doc.get(id).name, prefab: doc.get(id).prefab }));

  const target = h('select', { 'aria-label': 'What to rename' }, h('option', { value: 'name' }, 'the name (what the hierarchy shows)'), h('option', { value: 'id' }, 'the id (the unique handle)'));
  const mode = h('select', { 'aria-label': 'How' }, h('option', { value: 'pattern' }, 'give them names from a pattern'), h('option', { value: 'replace' }, 'find and replace in their names'));
  const num = (value, min) => h('input', { type: 'number', value: String(value), min: String(min), step: '1' });
  const text = (value, label, placeholder = '') => h('input', { type: 'text', value, spellcheck: false, 'aria-label': label, placeholder });
  const pattern = text(o.pattern, 'Pattern', 'Crate {n}');
  const start = num(o.start, -1e6);
  const step = num(o.step, -1e6);
  const digits = num(o.digits, 1);
  const find = text(o.find, 'Find');
  const replace = text(o.replace, 'Replace with');
  const matchCase = h('input', { type: 'checkbox', checked: o.matchCase, 'aria-label': 'Capitals count' });
  const labelled = (label, input, cls = '') => h('label', { class: cls }, label, input);
  const patternFields = [
    labelled('Pattern: {n} number, {name} now, {id}, {prefab}', pattern, 'wide'), labelled('First number', start), labelled('Count by', step), labelled('Digits (zeros in front)', digits),
  ];
  const replaceFields = [labelled('Find', find, 'wide'), labelled('Replace with', replace, 'wide'), h('label', { class: 'check wide' }, matchCase, 'Capitals count')];
  const grid = h('div', { class: 'grid' }, labelled('Rename', target), labelled('by', mode), ...patternFields, ...replaceFields);
  const preview = h('table', { 'aria-label': 'New names' });
  const summary = h('div', { class: 'summary', role: 'status' });
  const apply = h('button', { type: 'button', class: 'btn on' }, 'Apply');
  const cancel = h('button', { type: 'button', class: 'btn' }, 'Cancel');
  const box = h('div', { class: 'batch-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Rename several' },
    h('h3', {}, `Rename ${ids.length} ${ids.length === 1 ? 'thing' : 'things'}`), grid, preview, summary, h('div', { class: 'buttons' }, cancel, apply));

  const read = () => ({
    target: target.value, mode: mode.value, pattern: pattern.value, start: Number(start.value), step: Number(step.value), digits: Number(digits.value),
    find: find.value, replace: replace.value, matchCase: matchCase.checked,
  });
  let rows = [];
  function refresh() {
    const options = read();
    patternFields.forEach((f) => { f.hidden = options.mode !== 'pattern'; });
    replaceFields.forEach((f) => { f.hidden = options.mode !== 'replace'; });
    rows = previewRename(items, options, doc.order);
    preview.replaceChildren(...rows.slice(0, 12).map((r) => h('tr', { class: r.error ? 'bad' : r.changed ? '' : 'same' },
      h('td', { class: 'from' }, r.from || `(${r.id})`), h('td', {}, '→'), h('td', { class: 'to' }, r.error ? `${r.to || '(empty)'}: ${r.error}` : r.to || `(${r.id})`))));
    if (rows.length > 12) preview.append(h('tr', {}, h('td', { colspan: 3 }, `…and ${rows.length - 12} more`)));
    const changing = rows.filter((r) => r.changed).length;
    const wrong = rows.filter((r) => r.error).length;
    summary.textContent = wrong ? `${wrong} would not work: change the pattern.` : changing ? `${changing} will change.` : 'Nothing would change.';
    apply.disabled = !canApply(rows);
  }
  function close() { box.remove(); editor.state.batchRename = read(); stage.focus({ preventScroll: true }); }
  function run() {
    if (!canApply(rows)) return;
    const changed = rows.filter((r) => r.changed);
    const options = read();
    try {
      doc.batch(`Rename ${changed.length}`, () => {
        if (options.target === 'name') {
          for (const r of changed) doc.update(r.id, { name: r.to === '' ? null : r.to });
        } else {                                                                              // through temporary ids, so two ids can swap or shift
          const temp = [];
          for (const r of changed) {
            const id = doc.freeId('__rename');
            doc.rename(r.id, id);
            temp.push({ r, id });
          }
          for (const t of temp) doc.rename(t.id, t.r.to);
        }
      });
      if (options.target === 'id') selection.set(ids.map((id) => changed.find((r) => r.id === id)?.to ?? id));
      editor.say(`Renamed ${changed.length}`, 'good');
      close();
    } catch (error) {
      editor.say(error.message, 'bad');
    }
  }
  target.value = o.target;
  mode.value = o.mode;
  for (const el of [target, mode, pattern, start, step, digits, find, replace, matchCase]) { el.addEventListener('input', refresh); el.addEventListener('change', refresh); }
  apply.addEventListener('click', run);
  cancel.addEventListener('click', close);
  box.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); close(); } else if (e.key === 'Enter' && e.target.tagName !== 'BUTTON') { e.preventDefault(); run(); }
  });
  stage.append(box);
  refresh();
  (o.mode === 'pattern' ? pattern : find).focus();
  (o.mode === 'pattern' ? pattern : find).select?.();
  return { close };
}
