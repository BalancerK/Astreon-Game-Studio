// The search box (Ctrl+K): one place to find anything. It searches commands, the project's files, projects, and settings, all at once, with the best match on
// top. Start the text with a symbol to narrow it: ">" commands and settings, "/" files, "@" projects, "#" a name in any file, ":" go to a line.
import { h } from './dom.js';
import { rank } from '../util/fuzzy.js';
import { trapFocus } from './dom.js';

/**
 * @typedef {Object} PaletteItem
 * @property {string} id
 * @property {'command' | 'file' | 'project' | 'setting' | 'help'} kind
 * @property {string} title
 * @property {string} [detail] smaller text after the title (a category, a folder)
 * @property {string[]} [keywords]
 * @property {string} [shortcut] already written for display ("Ctrl+K")
 * @property {() => void} run
 */

const KIND_LABEL = { command: 'Command', file: 'File', project: 'Project', setting: 'Setting', help: 'Help', symbol: 'Name' };
const PREFIX_KINDS = { '>': ['command', 'setting', 'help'], '/': ['file'], '@': ['project'], '#': ['symbol'] };

export class Palette {
  /**
   * @param {{items: () => PaletteItem[], recent: () => string[], gotoLine?: (line: number) => void, onClose?: () => void}} o
   */
  constructor({ items, recent, gotoLine, onClose = () => {} }) {
    this.items = items;
    this.recent = recent;
    this.gotoLine = gotoLine;
    this.onClose = onClose;
    this.el = null;
    this.results = [];
    this.selected = 0;
  }

  get isOpen() { return !!this.el; }

  open(initial = '') {
    if (this.el) { this.input.value = initial; this.#update(); this.input.focus(); return; }
    this.previous = document.activeElement;
    this.input = h('input', {
      type: 'text', role: 'combobox',
      placeholder: 'Search commands, files and projects…  (> commands   / files   # names   @ projects   : go to line)',
      autocomplete: 'off', spellcheck: false, aria: { expanded: true, controls: 'palette-list', autocomplete: 'list', label: 'Search' },
    });
    this.list = h('ul', { id: 'palette-list', role: 'listbox', aria: { label: 'Results' } });
    this.hint = h('div', { class: 'hint' });
    this.el = h('div', { class: 'overlay', on: { mousedown: (e) => { if (e.target === this.el) this.close(); } } },
      h('div', { class: 'palette', role: 'dialog', aria: { modal: true, label: 'Search' } }, this.input, this.list, this.hint));
    this.untrap = trapFocus(this.el);
    this.input.addEventListener('input', () => this.#update());
    this.input.addEventListener('keydown', (e) => this.#key(e));
    document.body.append(this.el);
    this.input.value = initial;
    this.#update();
    this.input.focus();
  }

  close({ restoreFocus = true } = {}) {
    if (!this.el) return;
    this.untrap();
    this.el.remove();
    this.el = null;
    if (restoreFocus) this.previous?.focus?.();
    this.onClose();
  }

  toggle() { if (this.el) this.close(); else this.open(); }

  #search(raw) {
    const prefix = raw[0] in PREFIX_KINDS || raw[0] === ':' ? raw[0] : '';
    const query = prefix ? raw.slice(1).trim() : raw.trim();
    if (prefix === ':') {
      const line = Number.parseInt(query, 10);
      return Number.isFinite(line) && line > 0 && this.gotoLine
        ? [{ item: { id: 'goto', kind: 'help', title: `Go to line ${line}`, run: () => this.gotoLine(line) }, indices: [] }]
        : [];
    }
    const kinds = PREFIX_KINDS[prefix];
    const pool = this.items().filter((i) => (kinds ? kinds.includes(i.kind) : i.kind !== 'symbol'));      // names only when asked for with #
    const recent = this.recent();
    // letters scattered thinly through a long title are not a real match: each typed letter has to earn some score
    const worthIt = (hit) => hit.score >= 0.2 * query.replace(/\s/g, '').length;
    const hits = rank(pool, query, { text: (i) => [i.title, ...(i.keywords ?? []), i.detail ?? ''], id: (i) => i.id, recent, limit: 80 })
      .filter(worthIt).slice(0, 40);
    if (query === '') {
      // nothing typed: recently used commands first, then the rest alphabetically
      const order = new Map(recent.map((id, n) => [id, n]));
      return hits.sort((a, b) => (order.get(a.item.id) ?? 1e9) - (order.get(b.item.id) ?? 1e9) || a.item.title.localeCompare(b.item.title));
    }
    return hits;
  }

  #update() {
    this.results = this.#search(this.input.value);
    this.selected = 0;
    this.#draw();
  }

  #draw() {
    this.list.replaceChildren();
    if (!this.results.length) {
      this.list.append(h('li', { class: 'none', role: 'presentation', text: this.input.value ? 'Nothing found.' : 'Type to search.' }));
    }
    this.results.forEach(({ item, indices }, i) => {
      const hover = () => { if (this.selected !== i) { this.selected = i; this.#mark(); } };
      const li = h('li', {
        id: `palette-${i}`, role: 'option', aria: { selected: i === this.selected }, on: { mousemove: hover, click: () => this.#run(i) },
      },
        h('span', { class: 'kind', text: KIND_LABEL[item.kind] ?? '' }),
        h('span', { class: 'title' }, ...this.#highlight(item.title, indices),
          item.detail ? h('span', { class: 'meta', style: { marginLeft: '8px' }, text: item.detail }) : null),
        item.shortcut ? h('kbd', { text: item.shortcut }) : null);
      this.list.append(li);
    });
    this.input.setAttribute('aria-activedescendant', this.results.length ? `palette-${this.selected}` : '');
    this.hint.replaceChildren(
      h('span', {}, h('kbd', { text: '↑' }), ' ', h('kbd', { text: '↓' }), ' choose'),
      h('span', {}, h('kbd', { text: 'Enter' }), ' run'),
      h('span', {}, h('kbd', { text: 'Esc' }), ' close'),
      h('span', { class: 'grow' }),
      h('span', { text: this.results.length ? `${this.results.length} result${this.results.length === 1 ? '' : 's'}` : '' }));
  }

  #highlight(title, indices) {
    if (!indices.length) return [title];
    const marks = new Set(indices);
    const out = [];
    let run = '';
    let on = false;
    for (let i = 0; i < title.length; i++) {
      const m = marks.has(i);
      if (m !== on && run) { out.push(on ? h('mark', { text: run }) : run); run = ''; }
      on = m;
      run += title[i];
    }
    if (run) out.push(on ? h('mark', { text: run }) : run);
    return out;
  }

  #mark() {
    [...this.list.children].forEach((li, i) => li.setAttribute('aria-selected', String(i === this.selected)));
    this.list.children[this.selected]?.scrollIntoView?.({ block: 'nearest' });
    this.input.setAttribute('aria-activedescendant', `palette-${this.selected}`);
  }

  #key(e) {
    const n = this.results.length;
    if (e.key === 'Escape') { e.preventDefault(); this.close(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); if (n) { this.selected = (this.selected + 1) % n; this.#mark(); } }
    else if (e.key === 'ArrowUp') { e.preventDefault(); if (n) { this.selected = (this.selected - 1 + n) % n; this.#mark(); } }
    else if (e.key === 'Home' && e.ctrlKey) { this.selected = 0; this.#mark(); }
    else if (e.key === 'PageDown') { e.preventDefault(); this.selected = Math.min(n - 1, this.selected + 8); this.#mark(); }
    else if (e.key === 'PageUp') { e.preventDefault(); this.selected = Math.max(0, this.selected - 8); this.#mark(); }
    else if (e.key === 'Enter') { e.preventDefault(); this.#run(this.selected); }
  }

  #run(i) {
    const hit = this.results[i];
    if (!hit) return;
    this.close({ restoreFocus: false });
    try {
      hit.item.run();
    } catch (error) {
      console.error(error);
    }
  }
}
