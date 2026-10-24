// The dock: draws a layout (see dock-model.js) with real panels in it. Tabs can be clicked, dragged to another group or to the edge of one (which splits it),
// and moved with the keyboard; the lines between panels can be dragged or moved with the arrow keys. Each panel's element is made once and moved when the
// layout changes, so a panel keeps its state (scroll position, what was typed) however it is rearranged.
import { Emitter } from '../util/emitter.js';
import { h, icon } from './dom.js';
import { activate, movePanel, removePanel, addPanel, resize, reorderTabs, dropZone, groupOf, panelIds, repair, walk } from './dock-model.js';

/**
 * @typedef {Object} PanelDef
 * @property {string} id
 * @property {string} title
 * @property {string} [icon]
 * @property {(ctx: {dock: Dock}) => {el: HTMLElement, focus?: () => void, dispose?: () => void}} create build the panel once, when first shown
 */

const COMPACT_ENTER = 820;
const COMPACT_LEAVE = 880;
/** Which panels come first in the narrow view's bar of tabs: the ones a person reaches for most. */
const COMPACT_ORDER = ['editor', 'game', 'files', 'console', 'learn', 'sprites', 'levels', 'sounds', 'rules', 'scene3d', 'time', 'inspect',
  'history'];

export class Dock extends Emitter {
  /** @type {Map<string, PanelDef>} */
  #defs = new Map();
  #views = new Map();            // panel id -> what `create` returned
  #layout = null;
  #drag = null;
  #compact = false;              // a narrow window: one panel at a time, with a bar of tabs at the bottom
  #compactActive = null;

  /** @param {HTMLElement} root */
  constructor(root) {
    super();
    this.root = root;
    root.classList.add('dock');
    this.overlay = h('div', { class: 'dock-drop', hidden: true, aria: { hidden: true } });
    document.addEventListener('pointermove', (e) => this.#onDragMove(e));
    document.addEventListener('pointerup', (e) => this.#onDragEnd(e));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && this.#drag) this.#cancelDrag(); });
    // below this width the panels cannot sit side by side. Leaving needs a little more room, so a window on the edge does not flicker between the two.
    if (typeof ResizeObserver === 'function') {
      new ResizeObserver(() => {
        const width = root.clientWidth;
        if (width > 0) this.setCompact(this.#compact ? width < COMPACT_LEAVE : width < COMPACT_ENTER);
      }).observe(root);
    }
  }

  /** Whether the window is narrow and one panel is shown at a time. */
  get compact() { return this.#compact; }

  /** Turn the narrow-window view on or off. The saved layout is not touched: wide windows get it back as it was. */
  setCompact(on) {
    on = !!on;
    if (on === this.#compact) return;
    this.#compact = on;
    this.render();
    this.emit('compact', on);
  }

  /** Tell the dock about a panel the studio can show. */
  define(def) {
    this.#defs.set(def.id, def);
  }

  /** Forget a panel (a plugin was turned off): close it and drop what was built for it. */
  undefine(id) {
    this.close(id);
    this.#defs.delete(id);
    const view = this.#views.get(id);
    if (view) { view.dispose?.(); view.el.remove(); this.#views.delete(id); }
  }

  get panels() { return [...this.#defs.values()]; }

  get layout() { return this.#layout; }

  /** Whether a panel is in the layout now (not closed). */
  isOpen(id) { return !!groupOf(this.#layout, id); }

  /** The panel that is visible in its group and has focus (or the last one focused). */
  get focusedPanel() { return this.#focused; }

  #focused = null;
  #maximized = null;              // a panel that fills the whole dock for a while (the others are put back by toggling it again)

  /** The panel that fills the dock, or null. */
  get maximized() { return this.#maximized; }

  /** Make a panel fill the dock (the rest wait, unchanged), or put everything back: with no argument it toggles the panel that has the focus. */
  maximize(id = this.#focused) {
    const was = this.#maximized;
    this.#maximized = id && id !== was && this.isOpen(id) ? id : null;
    if (this.#maximized) { this.#activateTab(this.#maximized); this.#focused = this.#maximized; }
    this.render();
    this.emit('maximize', this.#maximized);
    if (this.#maximized) this.focus(this.#maximized);
    return this.#maximized;
  }

  /** Use this layout (anything the studio does not know is repaired away first). */
  setLayout(layout) {
    this.#layout = repair(layout, [...this.#defs.keys()]);
    this.render();
    this.emit('layout', this.#layout);
  }

  #change(next) {
    this.#layout = next;
    this.render();
    this.emit('layout', this.#layout);
  }

  /** Show a panel: open it if it is closed, make its tab the visible one, and (unless `focus` is false) put the keyboard in it. */
  show(id, { focus = true } = {}) {
    if (!this.#defs.has(id)) throw new Error(`no panel "${id}"`);
    if (this.isOpen(id)) this.#activateTab(id);
    else this.#change(addPanel(this.#layout, id, { near: this.#focused ?? undefined }));
    if (focus) this.focus(id);
  }

  close(id) {
    if (this.isOpen(id)) this.#change(removePanel(this.#layout, id));
  }

  focus(id) {
    const view = this.#views.get(id);
    this.#focused = id;
    (view?.focus ?? (() => view?.el?.focus?.()))();
  }

  /** The element of a panel (made if it was not yet). */
  elementOf(id) { return this.#view(id).el; }

  #view(id) {
    let view = this.#views.get(id);
    if (!view) {
      view = this.#defs.get(id).create({ dock: this });
      view.el.classList.add('panel-body');
      view.el.dataset.panel = id;
      this.#views.set(id, view);
    }
    return view;
  }

  /** Draw the layout. */
  render() {
    const open = new Set(panelIds(this.#layout));
    for (const [id, view] of this.#views) if (!open.has(id)) view.el.remove();
    const empty = h('div', { class: 'dock-empty', text: 'No panels are open. Press Ctrl+K and type "show" to open one.' });
    this.root.classList.toggle('compact', this.#compact);
    if (this.#maximized && !open.has(this.#maximized)) this.#maximized = null;
    const only = this.#maximized && !this.#compact ? groupOf(this.#layout, this.#maximized) : null;
    this.root.classList.toggle('maximized', !!only);
    const drawn = !this.#layout ? empty : this.#compact ? this.#pager() : this.#node(only ?? this.#layout);
    this.root.replaceChildren(drawn, this.overlay);
  }

  /** The narrow-window view: every open panel is a tab in one bar at the bottom, and one panel fills the rest. */
  #pager() {
    const open = panelIds(this.#layout);
    const rank = (id) => { const i = COMPACT_ORDER.indexOf(id); return i < 0 ? COMPACT_ORDER.length : i; };
    const ids = [...open].sort((a, b) => rank(a) - rank(b) || open.indexOf(a) - open.indexOf(b));
    if (!ids.includes(this.#compactActive)) {
      const visible = this.#focused && ids.includes(this.#focused) ? this.#focused : groupOf(this.#layout, ids[0])?.active ?? ids[0];
      this.#compactActive = ids.includes('editor') && !this.#focused ? 'editor' : visible;
    }
    const tablist = h('div', { class: 'dock-tabs compact-tabs', role: 'tablist', aria: { label: 'Panels' } });
    const body = h('div', { class: 'dock-body' });
    for (const id of ids) {
      const def = this.#defs.get(id);
      const selected = id === this.#compactActive;
      const tab = h('div', {
        class: `dock-tab${selected ? ' on' : ''}`, role: 'tab', id: `tab-${id}`, tabIndex: selected ? 0 : -1, dataset: { panel: id },
        aria: { selected, controls: `body-${id}` },
      }, def.icon ? icon(def.icon, 16) : null, h('span', { class: 'dock-title', text: def.title }));
      tab.addEventListener('click', () => { this.#activateTab(id); this.focus(id); });
      tab.addEventListener('keydown', (e) => {
        const i = ids.indexOf(id);
        const next = e.key === 'ArrowLeft' ? ids[Math.max(0, i - 1)] : e.key === 'ArrowRight' ? ids[Math.min(ids.length - 1, i + 1)] : null;
        if (!next) return;
        e.preventDefault();
        this.#activateTab(next);
        this.root.querySelector(`.dock-tab[data-panel="${next}"]`)?.focus();
      });
      tablist.append(tab);
      const view = this.#view(id);
      view.el.hidden = !selected;
      view.el.setAttribute('role', 'tabpanel');
      view.el.id = `body-${id}`;
      view.el.setAttribute('aria-labelledby', `tab-${id}`);
      body.append(view.el);
      if (selected) queueMicrotask(() => view.onShow?.());
    }
    const el = h('div', { class: 'dock-group compact', dataset: { id: 'compact' } }, body, tablist);
    el.addEventListener('focusin', (e) => {
      const p = e.target.closest?.('[data-panel]')?.dataset.panel;
      if (p) { this.#focused = p; this.emit('focus', p); }
    });
    tablist.addEventListener('wheel', (e) => { if (e.deltaY) { tablist.scrollLeft += e.deltaY; e.preventDefault(); } }, { passive: false });
    queueMicrotask(() => tablist.querySelector('.dock-tab.on')?.scrollIntoView?.({ inline: 'center', block: 'nearest' }));
    return el;
  }

  #node(node) {
    if (node.type === 'tabs') return this.#group(node);
    const split = h('div', { class: `dock-split dir-${node.dir}`, dataset: { id: node.id } });
    node.children.forEach((child, i) => {
      split.append(h('div', { class: 'dock-cell', style: { flexGrow: String(node.sizes[i]) } }, this.#node(child)));
      if (i < node.children.length - 1) split.append(this.#splitter(node, i));
    });
    return split;
  }

  #splitter(split, index) {
    const vertical = split.dir === 'row';
    const bar = h('div', {
      class: `dock-splitter ${vertical ? 'v' : 'h'}`, role: 'separator', tabIndex: 0, dataset: { split: split.id, index: String(index) },
      aria: {
        orientation: vertical ? 'vertical' : 'horizontal', label: 'Resize panels',
        valuenow: Math.round(split.sizes[index] * 100), valuemin: 5, valuemax: 95,
      },
    });
    bar.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      bar.setPointerCapture(e.pointerId);
      const parent = bar.parentElement.getBoundingClientRect();
      const total = vertical ? parent.width : parent.height;
      let last = vertical ? e.clientX : e.clientY;
      const move = (ev) => {
        const now = vertical ? ev.clientX : ev.clientY;
        this.#layout = resize(this.#layout, split.id, index, (now - last) / total);
        last = now;
        this.#applySizes();
      };
      const up = () => { bar.removeEventListener('pointermove', move); bar.removeEventListener('pointerup', up); this.emit('layout', this.#layout); };
      bar.addEventListener('pointermove', move);
      bar.addEventListener('pointerup', up);
    });
    // a double click shares the space of the two panels beside the bar equally
    bar.addEventListener('dblclick', () => {
      const node = [...walk(this.#layout)].find((n) => n.id === split.id);
      const pair = node.sizes[index] + node.sizes[index + 1];
      this.#layout = resize(this.#layout, split.id, index, pair / 2 - node.sizes[index]);
      this.#applySizes();
      this.emit('layout', this.#layout);
    });
    bar.addEventListener('keydown', (e) => {
      const step = e.shiftKey ? 0.1 : 0.02;
      const keys = vertical ? { ArrowLeft: -step, ArrowRight: step } : { ArrowUp: -step, ArrowDown: step };
      if (!(e.key in keys)) return;
      e.preventDefault();
      this.#layout = resize(this.#layout, split.id, index, keys[e.key]);
      this.#applySizes();
      this.emit('layout', this.#layout);
    });
    return bar;
  }

  /** Update the sizes on screen without rebuilding anything (while a splitter is dragged). */
  #applySizes() {
    for (const n of walk(this.#layout)) {
      if (n.type !== 'split') continue;
      const el = this.root.querySelector(`.dock-split[data-id="${n.id}"]`);
      if (!el) continue;
      [...el.children].filter((c) => c.classList.contains('dock-cell')).forEach((cell, i) => { cell.style.flexGrow = String(n.sizes[i]); });
      const bars = [...el.children].filter((c) => c.classList.contains('dock-splitter'));
      bars.forEach((bar, i) => bar.setAttribute('aria-valuenow', String(Math.round(n.sizes[i] * 100))));
    }
  }

  #group(group) {
    const tablist = h('div', { class: 'dock-tabs', role: 'tablist', aria: { label: 'Panels' } });
    const body = h('div', { class: 'dock-body' });
    for (const id of group.panels) {
      const def = this.#defs.get(id);
      const selected = id === group.active;
      const tab = h('div', {
        class: `dock-tab${selected ? ' on' : ''}`, role: 'tab', id: `tab-${id}`, tabIndex: selected ? 0 : -1, dataset: { panel: id },
        aria: { selected, controls: `body-${id}` },
      },
      def.icon ? icon(def.icon, 14) : null,
      h('span', { class: 'dock-title', text: def.title }),
      h('button', {
        type: 'button', class: 'dock-close', 'aria-label': `Close ${def.title}`, title: 'Close', tabIndex: -1,
        on: { click: (e) => { e.stopPropagation(); this.close(id); } },
      }, icon('close', 12)));
      tab.addEventListener('pointerdown', (e) => this.#startDrag(e, id, group.id));
      tab.addEventListener('dblclick', (e) => { if (!e.target.closest('.dock-close')) this.maximize(id); });
      tab.addEventListener('click', () => { this.#activateTab(id); this.focus(id); });
      tab.addEventListener('keydown', (e) => this.#tabKey(e, group, id));
      tablist.append(tab);
      const view = this.#view(id);
      view.el.hidden = !selected;
      view.el.setAttribute('role', 'tabpanel');
      view.el.id = `body-${id}`;
      view.el.setAttribute('aria-labelledby', `tab-${id}`);
      body.append(view.el);
      if (selected) queueMicrotask(() => view.onShow?.());
    }
    const el = h('div', { class: 'dock-group', dataset: { id: group.id } }, tablist, body);
    el.addEventListener('focusin', (e) => {
      const p = e.target.closest?.('[data-panel]')?.dataset.panel;
      if (p) { this.#focused = p; this.emit('focus', p); }
    });
    return el;
  }

  /**
   * Make a panel the visible tab of its group by changing only what is shown, without rebuilding the page around it (a panel that is rebuilt loses its place).
   */
  #activateTab(id) {
    const next = activate(this.#layout, id);
    if (this.#compact) {
      this.#layout = next;
      this.#compactActive = id;
      for (const tab of this.root.querySelectorAll('.compact-tabs .dock-tab')) {
        const on = tab.dataset.panel === id;
        tab.classList.toggle('on', on);
        tab.setAttribute('aria-selected', String(on));
        tab.tabIndex = on ? 0 : -1;
        if (on) tab.scrollIntoView?.({ inline: 'center', block: 'nearest' });
      }
      for (const body of this.root.querySelectorAll('.dock-group.compact > .dock-body > .panel-body')) body.hidden = body.dataset.panel !== id;
      if (!this.#views.has(id)) this.render(); else this.#views.get(id).onShow?.();
      this.emit('layout', this.#layout);
      return;
    }
    const group = groupOf(next, id);
    const groupEl = group && this.root.querySelector(`.dock-group[data-id="${group.id}"]`);
    if (!groupEl || !this.#views.has(id)) { this.#change(next); return; }
    this.#layout = next;
    for (const tab of groupEl.querySelectorAll(':scope > .dock-tabs > .dock-tab')) {
      const on = tab.dataset.panel === id;
      tab.classList.toggle('on', on);
      tab.setAttribute('aria-selected', String(on));
      tab.tabIndex = on ? 0 : -1;
    }
    for (const body of groupEl.querySelectorAll(':scope > .dock-body > .panel-body')) body.hidden = body.dataset.panel !== id;
    this.#views.get(id).onShow?.();
    this.emit('layout', this.#layout);
  }

  /** Arrow keys move between tabs; Alt+Shift+arrows move the tab itself; Delete closes it. */
  #tabKey(e, group, id) {
    const i = group.panels.indexOf(id);
    if (e.altKey && e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault();
      const to = Math.max(0, Math.min(group.panels.length - 1, i + (e.key === 'ArrowLeft' ? -1 : 1)));
      const order = [...group.panels];
      order.splice(i, 1);
      order.splice(to, 0, id);
      this.#change(reorderTabs(this.#layout, group.id, order));
      this.root.querySelector(`.dock-tab[data-panel="${id}"]`)?.focus();
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      const count = group.panels.length;
      const step = e.key === 'ArrowLeft' ? -1 : 1;
      const next = e.key === 'Home' ? 0 : e.key === 'End' ? count - 1 : (i + step + count) % count;
      this.#activateTab(group.panels[next]);
      this.root.querySelector(`.dock-tab[data-panel="${group.panels[next]}"]`)?.focus();
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      this.focus(id);
    } else if (e.key === 'Delete') {
      e.preventDefault();
      this.close(id);
    }
  }

  // ---- dragging a tab ----
  #startDrag(e, panelId, groupId) {
    if (e.button !== 0 || e.target.closest('.dock-close')) return;
    this.#drag = { panelId, groupId, startX: e.clientX, startY: e.clientY, active: false, target: null };
  }

  #onDragMove(e) {
    const d = this.#drag;
    if (!d) return;
    if (!d.active) {
      if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < 6) return;       // a click is not a drag
      d.active = true;
      document.body.classList.add('dragging-panel');
    }
    const group = document.elementsFromPoint(e.clientX, e.clientY).find((el) => el.classList?.contains('dock-group'));
    if (!group) { this.overlay.hidden = true; d.target = null; return; }
    const r = group.getBoundingClientRect();
    const tabs = group.querySelector('.dock-tabs').getBoundingClientRect();
    const onTabs = e.clientY < tabs.bottom;
    const zone = onTabs ? 'center' : dropZone({ width: r.width, height: r.height }, e.clientX - r.left, e.clientY - r.top);
    let index;
    if (onTabs) {
      const tabEls = [...group.querySelectorAll('.dock-tab')];
      index = tabEls.findIndex((t) => e.clientX < t.getBoundingClientRect().left + t.getBoundingClientRect().width / 2);
      if (index < 0) index = tabEls.length;
    }
    d.target = { groupId: group.dataset.id, zone, index };
    const area = { center: [0, 0, 1, 1], left: [0, 0, 0.5, 1], right: [0.5, 0, 0.5, 1], top: [0, 0, 1, 0.5], bottom: [0, 0.5, 1, 0.5] }[zone];
    const root = this.root.getBoundingClientRect();
    Object.assign(this.overlay.style, {
      left: `${r.left - root.left + area[0] * r.width}px`, top: `${r.top - root.top + area[1] * r.height}px`,
      width: `${area[2] * r.width}px`, height: `${area[3] * r.height}px`,
    });
    this.overlay.hidden = false;
  }

  #onDragEnd() {
    const d = this.#drag;
    if (!d) return;
    this.#drag = null;
    this.overlay.hidden = true;
    document.body.classList.remove('dragging-panel');
    if (d.active && d.target) {
      this.#change(movePanel(this.#layout, d.panelId, d.target.groupId, d.target.zone, d.target.index));
      this.focus(d.panelId);
    }
  }

  #cancelDrag() {
    this.#drag = null;
    this.overlay.hidden = true;
    document.body.classList.remove('dragging-panel');
  }

  /** Move a panel to the edge of the window or beside another (for the "move panel" commands). */
  move(panelId, targetPanelId, zone) {
    const target = groupOf(this.#layout, targetPanelId);
    if (target) this.#change(movePanel(this.#layout, panelId, target.id, zone));
  }
}
