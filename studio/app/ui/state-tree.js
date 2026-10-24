// A tree of the game's state that can be edited: objects and lists open and close, numbers, text and switches are fields. It is rebuilt only when the shape
// of what is open changes; otherwise the values are updated where they stand, so a game that changes sixty times a second does not make the tree flicker
// or take a field away while you are typing in it. Everything is built with textContent and input values: nothing from the game becomes markup.
import { h } from './dom.js';

const MAX_CHILDREN = 100;
const MAX_RESULTS = 80;
const isObject = (v) => v !== null && typeof v === 'object';
const keyOf = (path) => JSON.stringify(path);
const show = (n) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 1000) / 1000));

/** A short description of an object or list for its closed row: `hero`, or `3 items`, or the first values. */
function summarize(value) {
  if (Array.isArray(value)) return `${value.length} item${value.length === 1 ? '' : 's'}`;
  if (typeof value.kind === 'string') return value.kind;
  if (typeof value.name === 'string') return value.name;
  const keys = Object.keys(value);
  return keys.length ? keys.slice(0, 3).join(', ') + (keys.length > 3 ? ', …' : '') : 'empty';
}

/**
 * @param {{onEdit: (path: (string|number)[], value: any) => void, onSelect: (path: (string|number)[] | null) => void}} handlers
 */
export function createStateTree({ onEdit, onSelect }) {
  const el = h('div', { class: 'state-tree', role: 'tree', aria: { label: 'The game\'s state' } });
  const expanded = new Set(['[]']);                 // the root starts open
  let selected = null;                              // key of the selected path
  let filter = '';
  let state;
  let lastShape = null;
  const leaves = new Map();                         // path key -> { input, kind } for in-place updates

  const labelFor = (key) => (typeof key === 'number' ? `[${key}]` : key);

  function leafEditor(path, value) {
    const type = value === null ? 'null' : typeof value;
    if (type === 'number') {
      const step = Number.isInteger(value) ? '1' : '0.1';
      const input = h('input', { type: 'number', class: 'leaf', step, value: show(value), aria: { label: path.join('.') } });
      const commit = () => { const n = Number(input.value); if (input.value !== '' && Number.isFinite(n)) onEdit(path, n); };
      input.addEventListener('change', commit);
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') commit(); });
      return { input, type };
    }
    if (type === 'boolean') {
      const input = h('input', { type: 'checkbox', class: 'leaf', checked: value, aria: { label: path.join('.') } });
      input.addEventListener('change', () => onEdit(path, input.checked));
      return { input, type };
    }
    if (type === 'string') {
      const input = h('input', { type: 'text', class: 'leaf text', value, spellcheck: false, aria: { label: path.join('.') } });
      input.addEventListener('change', () => onEdit(path, input.value));
      return { input, type };
    }
    return { input: h('span', { class: 'leaf null', text: String(value) }), type: 'static' };
  }

  function row(path, key, value, depth) {
    const k = keyOf(path);
    if (isObject(value)) {
      const open = expanded.has(k);
      const head = h('div', {
        class: `row head${selected === k ? ' selected' : ''}`, role: 'treeitem', tabIndex: 0, style: { paddingLeft: `${depth * 14 + 4}px` },
        aria: { expanded: open, selected: selected === k, level: depth + 1, label: `${labelFor(key)}, ${summarize(value)}` },
      }, h('span', { class: 'twisty', text: open ? '▾' : '▸', aria: { hidden: true } }),
      h('span', { class: 'key', text: labelFor(key) }), h('span', { class: 'sum', text: summarize(value) }));
      const toggle = () => { if (open) expanded.delete(k); else expanded.add(k); rebuild(); };
      head.addEventListener('click', () => { selectPath(path); toggle(); });
      head.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectPath(path); toggle(); }
        else if ((e.key === 'ArrowRight' && !open) || (e.key === 'ArrowLeft' && open)) { e.preventDefault(); toggle(); }
      });
      const out = [head];
      if (open) {
        const entries = Array.isArray(value) ? value.map((v, i) => [i, v]) : Object.entries(value);
        for (const [ck, cv] of entries.slice(0, MAX_CHILDREN)) out.push(...row([...path, ck], ck, cv, depth + 1));
        if (entries.length > MAX_CHILDREN) {
          const pad = `${(depth + 1) * 14 + 4}px`;
          out.push(h('div', { class: 'row more', style: { paddingLeft: pad }, text: `… ${entries.length - MAX_CHILDREN} more` }));
        }
      }
      return out;
    }
    const editor = leafEditor(path, value);
    leaves.set(k, { ...editor, value });
    return [h('div', { class: 'row leafrow', role: 'treeitem', aria: { level: depth + 1 }, style: { paddingLeft: `${depth * 14 + 18}px` } },
      h('span', { class: 'key', text: labelFor(key) }), editor.input)];
  }

  /** The shape of what is on screen: if it is the same, only values need updating. */
  function shapeOf(value, path = []) {
    if (!isObject(value)) return `${keyOf(path)}:${value === null ? 'null' : typeof value}`;
    const k = keyOf(path);
    if (!expanded.has(k)) return `${k}:closed`;
    const entries = Array.isArray(value) ? value.map((v, i) => [i, v]) : Object.entries(value);
    return `${k}:[${entries.slice(0, MAX_CHILDREN).map(([ck, cv]) => `${ck}=${shapeOf(cv, [...path, ck])}`).join(',')}]${entries.length}`;
  }

  /** Every leaf whose path or value contains the text (for the filter box). */
  function search(value, text, path = [], out = []) {
    if (out.length >= MAX_RESULTS) return out;
    if (isObject(value)) {
      const isList = Array.isArray(value);
      for (const [k, v] of isList ? value.map((x, i) => [i, x]) : Object.entries(value)) search(v, text, [...path, isList ? Number(k) : k], out);
    } else if (`${path.join('.')} ${value}`.toLowerCase().includes(text)) out.push([path, value]);
    return out;
  }

  function rebuild() {
    leaves.clear();
    const scroll = el.scrollTop;
    const kids = [];
    if (filter) {
      const found = search(state, filter);
      if (!found.length) kids.push(h('div', { class: 'row more', text: 'Nothing in the game state matches.' }));
      for (const [path, value] of found) {
        const editor = leafEditor(path, value);
        leaves.set(keyOf(path), { ...editor, value });
        kids.push(h('div', { class: 'row leafrow found', role: 'treeitem' }, h('span', { class: 'key', text: path.join('.') }), editor.input));
      }
    } else if (isObject(state)) {
      kids.push(...row([], 'game', state, 0));
    }
    el.replaceChildren(...kids);
    el.scrollTop = scroll;
    lastShape = filter ? `filter:${filter}` : shapeOf(state);
  }

  function selectPath(path) {
    selected = keyOf(path);
    onSelect(path.length ? path : null);
  }

  return {
    el,
    /** Show a new state. */
    update(next) {
      state = next;
      const shape = filter ? `filter:${filter}:${search(state, filter).map(([p]) => keyOf(p)).join()}` : shapeOf(state);
      if (shape !== lastShape || !el.firstChild) {
        const focused = document.activeElement;
        const hadFocus = el.contains(focused);
        const refocus = hadFocus && focused.getAttribute('aria-label');
        rebuild();
        lastShape = shape;
        if (refocus) el.querySelector(`[aria-label="${CSS.escape(refocus)}"]`)?.focus();
        return;
      }
      for (const [k, leaf] of leaves) {
        const value = valueAt(state, JSON.parse(k));
        if (value === leaf.value || leaf.type === 'static' || document.activeElement === leaf.input) continue;
        leaf.value = value;
        if (leaf.type === 'boolean') leaf.input.checked = value;
        else leaf.input.value = leaf.type === 'number' ? show(value) : String(value);
      }
    },
    /** Open the parents of a path, select it and bring it into view (a thing picked in the game). */
    reveal(path) {
      for (let n = 0; n < path.length; n++) expanded.add(keyOf(path.slice(0, n)));
      selected = keyOf(path);
      if (filter) { filter = ''; }
      lastShape = null;
      if (state !== undefined) this.update(state);
      el.querySelector('.row.selected')?.scrollIntoView({ block: 'center' });
      onSelect(path.length ? path : null);
    },
    setFilter(text) { filter = text.trim().toLowerCase(); lastShape = null; if (state !== undefined) this.update(state); },
    clear() { el.replaceChildren(); lastShape = null; },
    get selected() { return selected; },
    deselect() { selected = null; },
  };
}

function valueAt(state, path) {
  let at = state;
  for (const k of path) { if (!isObject(at)) return undefined; at = at[k]; }
  return at;
}
