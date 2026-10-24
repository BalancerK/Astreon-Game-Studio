// The files of the open project as a tree you can fold, filter and move about in with the keyboard. It is used by the Files panel and by the explorer beside the
// code, so browsing works the same in both. The rows are worked out by a pure function (`buildRows`, tested in Node); the rest is the page.
import { h, icon, fill } from './dom.js';
import { makeDraggable } from './pointer-drag.js';
import { assetKind } from '../store/assets.js';

/**
 * The rows to show: folders first, then files, each level in alphabetical order, with a depth for the indent.
 * @param {string[]} paths every file of the project
 * @param {Set<string>} collapsed folders that are folded shut
 * @param {string} [filter] text the path must contain (letters in order are enough); folders are opened to show what matches
 * @returns {{kind: 'dir' | 'file', path: string, name: string, depth: number, open?: boolean, count?: number}[]}
 */
export function buildRows(paths, collapsed = new Set(), filter = '') {
  const want = filter.trim().toLowerCase();
  const hit = (p) => {
    if (!want) return true;
    const low = p.toLowerCase();
    if (low.includes(want)) return true;
    let at = 0;
    for (const ch of low) if (ch === want[at] && ++at === want.length) return true;
    return false;
  };
  const root = { dirs: new Map(), files: [] };
  for (const p of paths.filter(hit)) {
    const parts = p.split('/');
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const key = parts.slice(0, i + 1).join('/');
      if (!node.dirs.has(parts[i])) node.dirs.set(parts[i], { path: key, dirs: new Map(), files: [] });
      node = node.dirs.get(parts[i]);
    }
    node.files.push({ path: p, name: parts.at(-1) });
  }
  const count = (n) => n.files.length + [...n.dirs.values()].reduce((c, d) => c + count(d), 0);
  const rows = [];
  const walk = (node, depth) => {
    for (const [name, dir] of [...node.dirs].sort(([a], [b]) => a.localeCompare(b))) {
      const open = want ? true : !collapsed.has(dir.path);
      rows.push({ kind: 'dir', path: dir.path, name, depth, open, count: count(dir) });
      if (open) walk(dir, depth + 1);
    }
    for (const f of node.files.sort((a, b) => a.name.localeCompare(b.name))) rows.push({ kind: 'file', path: f.path, name: f.name, depth });
  };
  walk(root, 0);
  return rows;
}

/**
 * @param {import('../core/studio.js').Studio} studio
 * @param {{label: string, onOpen: (path: string) => void, onContext?: (row: object, x: number, y: number, el: HTMLElement) => void,
 *   dragLabel?: (path: string) => string}} o
 */
export function createFileTree(studio, { label, onOpen, onContext = () => {}, dragLabel = (p) => p.slice(p.lastIndexOf('/') + 1) }) {
  const filter = h('input', {
    type: 'search', class: 'tree-filter', placeholder: 'Filter files', spellcheck: false, aria: { label: `Filter ${label}` },
  });
  const list = h('div', { class: 'tree', role: 'tree', aria: { label } });
  const el = h('div', { class: 'file-tree' }, filter, list);
  let rows = [];
  let focusPath = null;

  const key = () => `tree.${studio.project?.id ?? ''}`;
  const collapsed = () => new Set(studio.prefs.get(key(), []));
  const saveCollapsed = (set) => studio.prefs.set(key(), [...set]);
  const items = () => [...list.querySelectorAll('[role=treeitem]')];

  function refresh() {
    const project = studio.project;
    if (!project) { fill(list, h('div', { class: 'empty', text: 'No project open.' })); return; }
    const fold = collapsed();
    rows = buildRows(project.list(), fold, filter.value);
    const active = studio.activeFile;
    if (!rows.some((r) => r.path === focusPath)) focusPath = rows.some((r) => r.path === active) ? active : rows[0]?.path ?? null;
    const bad = new Set([...studio.diagnostics.keys()].filter((p) => studio.diagnostics.get(p)?.length));
    fill(list, rows.length ? rows.map((r, i) => {
      const selected = r.kind === 'file' && r.path === active;
      const row = h('div', {
        class: `row tree-row ${r.kind}${selected ? ' selected' : ''}${bad.has(r.path) ? ' has-error' : ''}`, role: 'treeitem',
        tabIndex: r.path === focusPath ? 0 : -1,
        dataset: { path: r.path, kind: r.kind },
        aria: { level: r.depth + 1, selected, posinset: i + 1, setsize: rows.length, ...(r.kind === 'dir' ? { expanded: r.open } : {}) },
        style: { paddingLeft: `${8 + r.depth * 14}px` },
        title: r.path,
        on: {
          click: () => { focusPath = r.path; if (r.kind === 'dir') toggle(r.path); else onOpen(r.path); },
          keydown: (e) => onKey(e, r),
          contextmenu: (e) => { e.preventDefault(); onContext(r, e.clientX, e.clientY, row); },
        },
      }, r.kind === 'dir' ? h('span', { class: 'twisty', text: r.open ? '▾' : '▸', aria: { hidden: true } }) : h('span', { class: 'twisty' }),
      icon(r.kind === 'dir' ? 'folder' : 'file', 14),
      h('span', { class: 'name', text: r.name }),
      r.kind === 'dir' ? h('span', { class: 'meta', text: String(r.count) })
        : typeof project.read(r.path) === 'string' ? null : h('span', { class: 'badge', text: assetKind(r.path) ?? 'binary' }),
      bad.has(r.path) ? h('span', { class: 'dot-error', title: 'This file has a problem', aria: { label: 'has a problem' } }) : null);
      if (r.kind === 'file') {
        makeDraggable(row, { payload: () => ({ type: 'file', path: r.path }), label: () => dragLabel(r.path) });
      }
      return row;
    }) : h('div', { class: 'empty', text: filter.value ? 'No file matches.' : 'This project has no files.' }));
  }

  function toggle(path, force) {
    const set = collapsed();
    const shut = force === undefined ? !set.has(path) : !force;
    if (shut) set.add(path); else set.delete(path);
    saveCollapsed(set);
    refresh();
    list.querySelector(`[data-path="${CSS.escape(path)}"]`)?.focus();
  }

  function onKey(e, row) {
    const all = items();
    const i = all.findIndex((x) => x.dataset.path === row.path);
    const go = (j) => {
      e.preventDefault();
      const t = all[Math.max(0, Math.min(all.length - 1, j))];
      focusPath = t?.dataset.path ?? focusPath;
      t?.focus();
      all.forEach((x) => { x.tabIndex = x === t ? 0 : -1; });
    };
    if (e.key === 'ArrowDown') go(i + 1);
    else if (e.key === 'ArrowUp') go(i - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(all.length - 1);
    else if (e.key === 'ArrowRight') {
      e.preventDefault();
      if (row.kind === 'dir') { if (!row.open) toggle(row.path, true); else go(i + 1); }
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      if (row.kind === 'dir' && row.open) toggle(row.path, false);
      else {
        const parent = row.path.includes('/') ? row.path.slice(0, row.path.lastIndexOf('/')) : null;
        const at = all.findIndex((x) => x.dataset.path === parent);
        if (at >= 0) go(at);
      }
    } else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (row.kind === 'dir') toggle(row.path); else onOpen(row.path); }
    else if (e.key === 'F2' && row.kind === 'file') { e.preventDefault(); studio.commands.execute('file.rename', row.path); }
    else if (e.key === 'Delete' && row.kind === 'file') { e.preventDefault(); studio.commands.execute('file.delete', row.path); }
    else if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
      e.preventDefault();
      const r = e.currentTarget.getBoundingClientRect();
      onContext(row, r.left + 24, r.bottom, e.currentTarget);
    } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const rotated = [...all.slice(i + 1), ...all.slice(0, i + 1)];
      const next = rotated.find((x) => x.querySelector('.name')?.textContent.toLowerCase().startsWith(e.key.toLowerCase()));
      if (next) go(all.indexOf(next));
    }
  }

  filter.addEventListener('input', refresh);
  filter.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); (items().find((x) => x.tabIndex === 0) ?? items()[0])?.focus(); }
    else if (e.key === 'Escape' && filter.value) { e.preventDefault(); e.stopPropagation(); filter.value = ''; refresh(); }
    else if (e.key === 'Enter') { const first = rows.find((r) => r.kind === 'file'); if (first) onOpen(first.path); }
  });

  /** Show a file in the tree: unfold the folders it is in and focus its row. */
  function reveal(path, { focus = true } = {}) {
    const set = collapsed();
    let changed = false;
    const parts = path.split('/');
    for (let i = 1; i < parts.length; i++) { const d = parts.slice(0, i).join('/'); if (set.delete(d)) changed = true; }
    if (changed) saveCollapsed(set);
    filter.value = '';
    focusPath = path;
    refresh();
    const row = list.querySelector(`[data-path="${CSS.escape(path)}"]`);
    row?.scrollIntoView?.({ block: 'nearest' });
    if (focus) row?.focus();
  }

  return { el, refresh, reveal, filter, items, focus: () => (items().find((x) => x.tabIndex === 0) ?? filter).focus() };
}
