// The side panels: the hierarchy tree, the inspector, and the prefab palette. Each is a function that builds the elements and returns
// `{ refresh() }`; they read the editor's state and call its operations, nothing more.
import { h } from './dom.js';
import { inspect, applyField, resetField } from '../inspector.js';

// ---------- hierarchy ----------
export function createHierarchy(editor, container) {
  const { doc, selection } = editor;
  const collapsed = new Set();
  const list = h('div', { id: 'hier-list' });
  container.append(list);
  let dragIds = null;

  const zoneOf = (row, e) => { const r = row.getBoundingClientRect(), y = (e.clientY - r.top) / r.height; return y < 0.28 ? 'before' : y > 0.72 ? 'after' : 'into'; };
  const clearMarks = () => list.querySelectorAll('.drop-into,.drop-before,.drop-after').forEach((n) => n.classList.remove('drop-into', 'drop-before', 'drop-after'));
  const visibleOrder = [];

  function drop(targetId, zone) {
    const moving = dragIds.filter((id) => doc.has(id) && id !== targetId && !doc.ancestors(targetId).includes(id));
    if (!moving.length) return;
    try {
      doc.batch('Move', () => {
        for (const id of moving) {
          if (zone === 'into') doc.reparent(id, targetId);
          else if (zone === 'before') doc.reparent(id, doc.get(targetId).parent ?? null, { before: targetId });
          else {
            const parent = doc.get(targetId).parent ?? null, sub = doc.subtree(targetId), next = doc.order[doc.order.indexOf(sub.at(-1)) + 1];
            const sibling = next && (doc.get(next).parent ?? null) === parent && !moving.includes(next) ? next : undefined;
            doc.reparent(id, parent, sibling ? { before: sibling } : {});
          }
        }
      });
    } catch (e) { editor.say(e.message, 'bad'); }
  }

  function row(id, depth) {
    const e = doc.get(id), kids = doc.children(id), view = editor.view;
    visibleOrder.push(id);
    const label = e.name || e.id;
    const r = h('div', {
      class: `row${selection.has(id) ? ' sel' : ''}${selection.primary === id ? ' primary' : ''}${e.disabled ? ' off' : ''}${view.errors.has(id) ? ' bad' : ''}`,
      dataset: { id }, draggable: true, style: { paddingLeft: `${8 + depth * 14}px` },
      title: view.errors.get(id) ?? `${e.id} (${e.prefab})`,
      onclick: (ev) => {
        if (ev.target.classList.contains('arrow')) return;
        if (ev.shiftKey) selection.range(id, visibleOrder); else if (ev.ctrlKey || ev.metaKey) selection.toggle(id); else selection.set(id);
      },
      ondblclick: (ev) => { if (!ev.target.classList.contains('arrow')) editor.focus([id]); },
      ondragstart: (ev) => { dragIds = selection.has(id) ? selection.roots(doc) : [id]; ev.dataTransfer.setData('text/x-entity', id); ev.dataTransfer.effectAllowed = 'move'; },
      ondragover: (ev) => { if (!dragIds) return; ev.preventDefault(); clearMarks(); r.classList.add(`drop-${zoneOf(r, ev)}`); },
      ondragleave: () => r.classList.remove('drop-into', 'drop-before', 'drop-after'),
      ondrop: (ev) => { if (!dragIds) return; ev.preventDefault(); const z = zoneOf(r, ev); clearMarks(); drop(id, z); dragIds = null; },
      ondragend: () => { clearMarks(); dragIds = null; },
    },
    h('span', { class: 'arrow', onclick: () => { if (collapsed.has(id)) collapsed.delete(id); else collapsed.add(id); refresh(); } }, kids.length ? (collapsed.has(id) ? '▸' : '▾') : ''),
    h('span', { class: 'label' }, label), h('span', { class: 'meta' }, e.prefab));
    list.append(r);
    if (!collapsed.has(id)) for (const k of kids) row(k, depth + 1);
  }

  function refresh() {
    list.textContent = ''; visibleOrder.length = 0;
    if (!doc.size) { list.append(h('div', { class: 'empty' }, 'The scene is empty. Click a prefab below to add one.')); return; }
    for (const id of doc.children(null)) row(id, 0);
    const p = list.querySelector('.row.primary'); if (p && editor.revealPrimary) { p.scrollIntoView?.({ block: 'nearest' }); editor.revealPrimary = false; }
  }
  // dropping on the empty part of the list moves things to the top level
  list.addEventListener('dragover', (ev) => { if (dragIds && ev.target === list) ev.preventDefault(); });
  list.addEventListener('drop', (ev) => { if (!dragIds || ev.target !== list) return; ev.preventDefault(); try { doc.batch('Move', () => dragIds.forEach((id) => doc.reparent(id, null))); } catch (e) { editor.say(e.message, 'bad'); } dragIds = null; });
  list.addEventListener('click', (ev) => { if (ev.target === list) selection.clear(); });

  /**
   * Rename in place (F2): the row's name becomes a text box. `what` is `name` (the label people see, which a game can look things up by; empty gives it back to the id) or
   * `id` (the entity's own unique id, letters, digits and - _ . :). Enter keeps it, Esc leaves it, and a name that will not do says why and stays open.
   * @param {string} id
   * @param {'name' | 'id'} [what]
   * @returns {boolean} whether a box was opened
   */
  function rename(id, what = 'name') {
    if (!doc.has(id) || editor.state.playing) return false;
    for (const a of doc.ancestors(id)) collapsed.delete(a);
    refresh();
    const row = [...list.querySelectorAll('.row')].find((r) => r.dataset.id === id);
    const label = row?.querySelector('.label');
    if (!label) return false;
    const e = doc.get(id);
    const box = h('input', {
      type: 'text', class: 'rename', spellcheck: false, maxlength: what === 'id' ? 64 : 80, value: what === 'id' ? e.id : (e.name ?? ''),
      placeholder: what === 'id' ? 'id' : e.id, 'aria-label': what === 'id' ? `Rename the id of ${e.id}` : `Rename ${e.name || e.id}`,
    });
    let done = false;
    const finish = (keep) => {
      if (done) return;
      if (keep) {
        try {
          const value = box.value.trim();
          if (what === 'id') { if (value && value !== id) { doc.rename(id, value); selection.set(value); } }
          else if (value !== (e.name ?? '')) doc.update(id, { name: value === '' ? null : value });
        } catch (error) { editor.say(error.message, 'bad'); box.classList.add('bad'); return; }              // stays open so it can be corrected
      }
      done = true;
      refresh();
      editor.stage.focus({ preventScroll: true });
    };
    box.addEventListener('keydown', (ev) => {
      ev.stopPropagation();
      if (ev.key === 'Enter') { ev.preventDefault(); finish(true); } else if (ev.key === 'Escape') { ev.preventDefault(); finish(false); }
    });
    box.addEventListener('blur', () => finish(true));
    box.addEventListener('click', (ev) => ev.stopPropagation());
    label.replaceChildren(box);
    box.focus();
    box.select();
    return true;
  }
  return { refresh, rename };
}

// ---------- inspector ----------
export function createInspector(editor, container) {
  const { doc, selection } = editor;
  let signature = '', inputs = new Map(), dragSeq = 0;

  function numberInput(field, value, onValue, step) {
    const el = h('input', { type: 'number', value: String(value), step: step ?? 'any' });
    el.addEventListener('input', () => { if (el.value !== '' && Number.isFinite(Number(el.value))) onValue(Number(el.value), true); });
    el.addEventListener('change', () => { if (el.value !== '') onValue(Number(el.value), false); });
    return el;
  }

  function control(id, field, setError) {
    const commit = (raw, drag) => {
      try { applyField(doc, id, field, raw, drag ? { merge: `inspector:${field.path}:${dragSeq}` } : undefined); setError(''); if (!drag) dragSeq++; } catch (e) { setError(e.message); }
    };
    if (field.type === 'readonly') return { el: h('span', {}, String(field.value)), set: (v) => { inputs.get(field.path).el.textContent = String(v); } };
    if (field.type === 'bool') { const el = h('input', { type: 'checkbox', checked: !!field.value, onchange: () => commit(el.checked, false) }); return { el, set: (v) => { el.checked = !!v; } }; }
    if (field.type === 'number') { const el = numberInput(field, field.value, (v, drag) => commit(v, drag), field.step); return { el, set: (v) => { if (document.activeElement !== el) el.value = String(v); } }; }
    if (field.type === 'vec3' || field.type === 'vec') {
      const els = field.value.map((v, i) => { const el = numberInput(field, v, () => commitVec(false), 'any'); el.dataset.i = i; el.addEventListener('input', () => { if (els.every((x) => x.value !== '' && Number.isFinite(Number(x.value)))) commitVec(true); }); return el; });
      const commitVec = (drag) => commit(els.map((x) => Number(x.value)), drag);
      return { el: h('div', { class: 'vec' }, els), set: (v) => v.forEach((n, i) => { if (document.activeElement !== els[i]) els[i].value = String(n); }) };
    }
    if (field.type === 'json') { const el = h('textarea', { rows: 2, value: JSON.stringify(field.value), onchange: () => commit(el.value, false) }); return { el, set: (v) => { if (document.activeElement !== el) el.value = JSON.stringify(v); } }; }
    const el = h('input', { type: 'text', value: String(field.value ?? ''), onchange: () => commit(el.value, false) });
    return { el, set: (v) => { if (document.activeElement !== el) el.value = String(v ?? ''); } };
  }

  function fieldRow(id, field) {
    const err = h('div', { class: 'err' });
    const setError = (m) => { err.textContent = m; };
    const ctl = control(id, field, setError);
    const reset = h('button', { class: 'reset', title: 'Back to the prefab\'s value', onclick: () => { try { resetField(doc, id, field); } catch (e) { setError(e.message); } } }, '↺');
    const row = h('div', { class: `field${field.overridden ? ' over' : ''}${field.type === 'readonly' ? ' readonly' : ''}`, title: field.hint ?? field.path },
      h('label', {}, field.label), ctl.el, reset, err);
    inputs.set(field.path, { ...ctl, row, field });
    return row;
  }

  function refresh() {
    const id = selection.primary;
    const info = id ? inspect(doc, id, { library: editor.library }) : null;
    const sig = info ? JSON.stringify([id, info.error, info.sections.map((s) => [s.title, s.fields.map((f) => [f.path, f.type, f.value?.length])])]) : '';
    if (info && sig === signature) { // same layout: update the values in place (leaving the box being typed in alone)
      for (const s of info.sections) for (const f of s.fields) {
        const entry = inputs.get(f.path); if (!entry) continue;
        entry.row.classList.toggle('over', !!f.overridden);
        entry.set(f.value);
      }
      return;
    }
    signature = sig; inputs = new Map(); container.textContent = '';
    if (!info) { container.append(h('div', { class: 'empty' }, selection.size > 1 ? `${selection.size} entities selected` : 'Nothing selected. Click something in the scene or the list.')); return; }
    if (selection.size > 1) container.append(h('div', { class: 'empty' }, `${selection.size} selected — showing "${id}"`));
    if (info.error) container.append(h('div', { class: 'empty', style: { color: 'var(--bad)' } }, info.error));
    for (const s of info.sections) {
      const body = h('div', {});
      for (const f of s.fields) body.append(fieldRow(id, f));
      const sw = s.kind === 'colour' ? (() => { const g = Object.fromEntries(s.fields.map((f) => [f.label, f.value])); return h('span', { class: 'swatch', style: { background: `rgb(${Math.round((g.r ?? 0) * 255)},${Math.round((g.g ?? 0) * 255)},${Math.round((g.b ?? 0) * 255)})` } }); })() : null;
      const head = h('div', { class: 'head', onclick: () => { body.style.display = body.style.display === 'none' ? '' : 'none'; } }, sw, s.title);
      container.append(h('div', { class: `sect ${s.kind ?? ''}` }, head, body));
    }
  }
  return { refresh };
}

// ---------- prefab palette ----------
export function createPalette(editor, container) {
  const names = editor.library.names.filter((n) => !editor.hidePrefabs.includes(n));
  for (const name of names) {
    container.append(h('div', {
      class: 'item', draggable: true, title: `Add a ${name}`,
      ondragstart: (ev) => { ev.dataTransfer.setData('text/x-prefab', name); ev.dataTransfer.effectAllowed = 'copy'; },
      onclick: () => editor.addPrefab(name),
    }, name));
  }
}
