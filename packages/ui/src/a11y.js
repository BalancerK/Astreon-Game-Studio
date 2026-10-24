// Accessibility for the UI: a description of what is on screen that a screen reader can use (`accessibilityTree`), a hidden mirror of it in the page that assistive technology reads and
// can operate (`attachAccessibility`), and spoken announcements. The tree is plain data, so tests, other front ends and text-to-speech can use it without a page.
import { Widget } from './widget.js';
import { Label, Button, Control, Toggle, Choice, ProgressBar, Separator } from './widgets.js';
import { Slider, TextInput, ScrollList } from './controls.js';

/**
 * What a screen reader is told about one widget.
 * @typedef {object} A11yNode
 * @property {string} id Stable for the widget while it lives (its `id` style, or one made for it).
 * @property {'button' | 'switch' | 'slider' | 'spinbutton' | 'textbox' | 'listbox' | 'option' | 'progressbar' | 'text' | 'heading' | 'separator' | 'group' | 'dialog'} role
 * @property {string} name What it is called ("Music volume", "Resume").
 * @property {string} [description] Extra help ("Type a room name"). @property {string} [value] What it holds, as it should be read ("50%", "Hard"); never the text of a password.
 * @property {number} [valueNow] @property {number} [valueMin] @property {number} [valueMax] For sliders, spin buttons and progress bars. @property {boolean} [checked] For switches.
 * @property {boolean} [selected] For options. @property {number} [level] For headings (1 is the biggest). @property {boolean} [password]
 * @property {boolean} disabled @property {boolean} focused @property {boolean} focusable @property {boolean} modal For dialogs.
 * @property {{x: number, y: number, w: number, h: number}} bounds Where it is on screen, in CSS pixels (for a screen magnifier or a touch explorer).
 * @property {A11yNode[]} children
 * @property {Widget} widget The widget itself (so a front end can act on it).
 */

let nextId = 1;
const ids = new WeakMap();
const idOf = (w) => w.id ?? ids.get(w) ?? (ids.set(w, `w${nextId++}`), ids.get(w));

/**
 * Optional help for the screen reader, set on any widget: `widget.a11y = { label, description, role, hidden, live }`. `label` replaces the name worked out from its text, `description` adds help,
 * `role` overrides the role, `hidden: true` leaves a decorative widget out, and `live: 'polite' | 'assertive'` makes changes to a text widget be announced.
 * @typedef {{label?: string, description?: string, role?: A11yNode['role'], hidden?: boolean, live?: 'polite' | 'assertive'}} A11yOptions
 */

/** The role a widget plays for assistive technology. @param {Widget} w */
export function roleOf(w) {
  const o = w.a11y?.role; if (o) return o;
  if (w instanceof Button) return 'button';
  if (w instanceof Toggle) return 'switch';
  if (w instanceof Slider) return 'slider';
  if (w instanceof Choice) return 'spinbutton';
  if (w instanceof TextInput) return 'textbox';
  if (w instanceof ScrollList) return 'listbox';
  if (w instanceof ProgressBar) return 'progressbar';
  if (w instanceof Separator) return 'separator';
  if (w instanceof Label) return w.style.heading ? 'heading' : 'text';
  return 'group';
}

const stripDecoration = (t) => String(t ?? '').replace(/\s+/g, ' ').trim();

/** What a widget is called: its `a11y.label`, else its text or label, else (for a text field) its placeholder. @param {Widget} w @param {string} [fromSibling] The text of the label next to it, if any. */
export function nameOf(w, fromSibling = '') {
  if (w.a11y?.label) return w.a11y.label;
  if (w instanceof Button || w instanceof Label) return stripDecoration(w.text);
  if (w instanceof Control) return stripDecoration(w.label);
  if (w instanceof ProgressBar) return stripDecoration(w.label) || fromSibling;
  if (w instanceof TextInput) return fromSibling || stripDecoration(w.placeholder) || 'text field';
  if (w instanceof ScrollList) return fromSibling || 'list';
  return fromSibling;
}

function describe(w, ui, consumed) {
  const role = roleOf(w);
  const sibling = consumed.get(w) ?? '';
  const node = {
    id: idOf(w), role, name: nameOf(w, sibling), disabled: !w.enabled, focused: !!w.focused && ui.focus === w, focusable: !!w.focusable, modal: false,
    bounds: { x: w.x * ui.scale, y: w.y * ui.scale, w: w.w * ui.scale, h: w.h * ui.scale }, children: [], widget: w,
  };
  if (w.a11y?.description) node.description = w.a11y.description;
  if (role === 'heading') node.level = Math.max(1, Math.min(6, +w.style.heading || 2));
  if (w instanceof Slider) { node.valueNow = w.value; node.valueMin = w.min; node.valueMax = w.max; node.value = w.format(w.value); }
  else if (w instanceof Toggle) { node.checked = !!w.value; node.value = w.value ? 'On' : 'Off'; }
  else if (w instanceof Choice) { node.valueNow = w.index; node.valueMin = 0; node.valueMax = Math.max(0, w.options.length - 1); node.value = w.options[w.index]?.label ?? ''; }
  else if (w instanceof ProgressBar) { node.valueNow = Math.round(Math.min(1, Math.max(0, w.value)) * 100); node.valueMin = 0; node.valueMax = 100; node.value = `${node.valueNow}%`; }
  else if (w instanceof TextInput) { node.password = !!w.password; node.value = w.password ? '' : w.value; if (w.placeholder && w.placeholder !== node.name) node.description ??= w.placeholder; }
  else if (w instanceof ScrollList) {
    node.value = w.selectedItem?.text ?? '';
    node.children = w.items.slice(0, 200).map((it, i) => ({
      id: `${idOf(w)}:${i}`, role: 'option', name: stripDecoration(it.text), description: it.detail ? stripDecoration(it.detail) : undefined, selected: i === w.selected, disabled: !w.enabled, focused: false, focusable: false, modal: false,
      bounds: { x: w.x * ui.scale, y: (w.y + i * w.rowHeight(ui)) * ui.scale, w: w.w * ui.scale, h: w.rowHeight(ui) * ui.scale }, children: [], widget: w,
    }));
    return node;
  }
  if (role === 'text' || role === 'heading') { if (w.a11y?.live) node.live = w.a11y.live; return node; }
  if (role === 'button' || role === 'switch' || role === 'slider' || role === 'spinbutton' || role === 'textbox' || role === 'progressbar' || role === 'separator') return node;
  node.children = nodesOf(w.children, ui);
  return node;
}

/** Nodes for a list of sibling widgets; a plain container with no name or role of its own is replaced by what is inside it. */
function nodesOf(widgets, ui) {
  const out = [], consumed = new Map();
  widgets.forEach((w, i) => {                                                    // a label right before a field names it ("Room" before the room name field)
    if (!(w instanceof TextInput || w instanceof ScrollList || w instanceof ProgressBar) || w.a11y?.label) return;
    const prev = widgets[i - 1];
    if (prev instanceof Label && prev.visible && !prev.style.heading && !prev.a11y?.hidden && prev.text) consumed.set(w, nameOf(prev));
  });
  const labelsUsed = new Set(); for (const [w] of consumed) labelsUsed.add(widgets[widgets.indexOf(w) - 1]);
  for (const w of widgets) {
    if (!w.visible || w.a11y?.hidden || labelsUsed.has(w) || w instanceof Separator) continue;
    if (w instanceof Label && !w.text && !w.a11y?.live) continue;                  // an empty status line says nothing until it has something to say
    const n = describe(w, ui, consumed);
    if (n.role === 'group' && !w.a11y?.label && !w.a11y?.role) out.push(...n.children); else out.push(n);
  }
  return out;
}

/**
 * Everything on screen as a screen reader should see it: the open screens (each a `dialog`, named by its first heading; only the top modal one and what is above it while a modal screen is
 * open, since what is below is blocked) and the permanent HUD. Plain data apart from each node's `widget`.
 * @param {import('./ui.js').Ui} ui @returns {{dialogs: A11yNode[], hud: A11yNode[], focused: A11yNode | null}}
 */
export function accessibilityTree(ui) {
  ui.layout();
  let from = 0;
  for (let i = ui.screens.length - 1; i >= 0; i--) if (ui.screens[i].modal) { from = i; break; }
  const modalOpen = ui.screens.some((s) => s.modal);
  const dialogs = ui.screens.slice(from).map((s) => {
    const kids = nodesOf([s.widget], ui);
    const first = (function find(list) { for (const n of list) { if (n.role === 'heading') return n; const f = find(n.children); if (f) return f; } return null; })(kids);
    return { id: idOf(s.root), role: /** @type {const} */ ('dialog'), name: s.widget.a11y?.label ?? first?.name ?? 'dialog', disabled: false, focused: false, focusable: false, modal: s.modal, bounds: { x: s.widget.x * ui.scale, y: s.widget.y * ui.scale, w: s.widget.w * ui.scale, h: s.widget.h * ui.scale }, children: kids, widget: s.widget };
  });
  const hud = modalOpen ? [] : nodesOf(ui.hud.children, ui);
  let focused = null;
  const visit = (n) => { if (n.focused) focused = n; n.children.forEach(visit); };
  dialogs.forEach(visit); hud.forEach(visit);
  return { dialogs, hud, focused };
}

/** A sentence for a node, the way a screen reader would say it ("Music volume, slider, 50%"): for text-to-speech without a browser, and for tests. @param {A11yNode} n */
export function speak(n) {
  const kind = { button: 'button', switch: 'switch', slider: 'slider', spinbutton: 'choice', textbox: 'edit', listbox: 'list', option: '', progressbar: 'progress', heading: `heading level ${n.level ?? 2}`, dialog: 'dialog', text: '', separator: '', group: '' }[n.role] ?? '';
  const parts = [n.name];
  if (kind) parts.push(kind);
  if (n.role === 'switch') parts.push(n.checked ? 'on' : 'off');
  else if (n.role === 'textbox') parts.push(n.password ? 'password, hidden' : n.value ? n.value : 'empty');
  else if (n.role === 'option') parts.push(n.selected ? 'selected' : '');
  else if (n.value && n.role !== 'text' && n.role !== 'heading') parts.push(n.value);
  if (n.description) parts.push(n.description);
  if (n.disabled) parts.push('unavailable');
  return parts.filter(Boolean).join(', ');
}

const HIDDEN_STYLE = 'position:absolute;width:1px;height:1px;margin:-1px;padding:0;border:0;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap';
const TAGS = { button: 'button', heading: 'div', text: 'div', dialog: 'div', group: 'div', separator: 'div' };

/**
 * Mirror the UI in the page for assistive technology. The canvas is invisible to a screen reader; this builds a hidden, always up to date set of real elements with the right ARIA roles
 * (buttons, switches, sliders, text fields, lists, headings, dialogs) that it can read and operate: activating one clicks the widget, the arrow keys on a slider go through the same key handling
 * as for everyone else, and moving the screen reader's cursor onto a control moves the UI's focus there. Announcements (`ui.announce`) go to live regions; opening a screen announces its name.
 * Also sets `ui.reducedMotion` from the system's reduced-motion setting. Call the returned `update()` once a frame (it only touches what changed).
 *
 * @param {import('./ui.js').Ui} ui
 * @param {object} [o]
 * @param {Document} [o.document] @param {HTMLElement} [o.host] Where the mirror is put (default the end of the body).
 * @param {string} [o.label] What the whole region is called ("Game menu").
 * @param {() => HTMLElement | null} [o.field] The page's hidden text field, if you use `attachDom` (`() => dom.input`), so it can be labelled with the widget it is editing.
 * @returns {{update: () => void, detach: () => void, element: HTMLElement}}
 */
export function attachAccessibility(ui, { document: doc = globalThis.document, host = null, label = 'Game menu', field = null } = {}) {
  const root = doc.createElement('div');
  root.setAttribute('role', 'region'); root.setAttribute('aria-label', label); root.style.cssText = HIDDEN_STYLE;
  const polite = doc.createElement('div'), assertive = doc.createElement('div');
  polite.setAttribute('role', 'status'); polite.setAttribute('aria-live', 'polite'); assertive.setAttribute('role', 'alert'); assertive.setAttribute('aria-live', 'assertive');
  const body = doc.createElement('div');
  root.append(polite, assertive, body);
  (host ?? doc.body).append(root);

  const elements = new Map();                                                // node id -> element
  const cleanups = [];
  let lastDialogs = new Set(), lastFocus = null, syncing = false;

  const set = (el, name, value) => {                                         // touch an attribute only when it changes
    const cache = el._a11y ??= {};
    const v = value === undefined || value === null || value === false ? null : String(value);
    if (cache[name] === v) return;
    cache[name] = v;
    if (v === null) el.removeAttribute(name); else el.setAttribute(name, v);
  };
  const text = (el, value) => { const cache = el._a11y ??= {}; if (cache.text !== value) { cache.text = value; el.textContent = value; } };

  const make = (n) => {
    const el = doc.createElement(TAGS[n.role] ?? 'div');
    if (n.role === 'button') el.setAttribute('type', 'button'); else el.setAttribute('role', n.role === 'text' ? 'paragraph' : n.role);
    el.setAttribute('tabindex', '-1');
    el.addEventListener('click', () => { const w = el._widget; if (!w) return; if (w.focusable && w.enabled) { syncing = true; ui.setFocus(w); syncing = false; ui.activate(); } });
    el.addEventListener('focus', () => { const w = el._widget; if (w && w.focusable && w.shown && ui.focus !== w && !syncing) { ui.focusVisible = true; ui.setFocus(w); } });
    return el;
  };

  const build = (n, parent, after) => {
    let el = elements.get(n.id);
    if (!el || el._role !== n.role) { el?.remove(); el = make(n); el._role = n.role; elements.set(n.id, el); }
    el._widget = n.role === 'option' ? null : n.widget;
    el._seen = true;
    if (el.parentNode !== parent || el.previousSibling !== after) parent.insertBefore(el, after ? after.nextSibling : parent.firstChild);
    const name = n.name;
    if (n.role === 'text' || n.role === 'heading') text(el, name); else if (n.role === 'option') { set(el, 'aria-label', name); text(el, n.description ? `${name}, ${n.description}` : name); }
    else set(el, 'aria-label', name);
    if (n.role === 'button') text(el, name);
    set(el, 'aria-level', n.level); set(el, 'aria-description', n.description);
    set(el, 'aria-disabled', n.disabled ? 'true' : null);
    if (n.role === 'switch') set(el, 'aria-checked', n.checked ? 'true' : 'false');
    if (n.role === 'slider' || n.role === 'spinbutton' || n.role === 'progressbar') { set(el, 'aria-valuenow', n.valueNow); set(el, 'aria-valuemin', n.valueMin); set(el, 'aria-valuemax', n.valueMax); set(el, 'aria-valuetext', n.value); }
    if (n.role === 'textbox') { set(el, 'aria-readonly', 'false'); if (n.password) set(el, 'aria-description', 'password'); else text(el, n.value); }
    if (n.role === 'option') set(el, 'aria-selected', n.selected ? 'true' : 'false');
    if (n.role === 'dialog') { set(el, 'aria-modal', n.modal ? 'true' : 'false'); }
    if (n.role === 'text' && n.widget?.a11y?.live) set(el, 'aria-live', n.widget.a11y.live);
    let prev = null;
    for (const c of n.children) prev = build(c, el, prev);
    if (n.role === 'listbox') { const sel = n.children.find((c) => c.selected); set(el, 'aria-activedescendant', sel ? sel.id : null); for (const c of n.children) elements.get(c.id).setAttribute('id', `a11y-${c.id.replace(/[^a-z0-9_-]/gi, '_')}`); if (sel) set(el, 'aria-activedescendant', `a11y-${sel.id.replace(/[^a-z0-9_-]/gi, '_')}`); }
    return el;
  };

  const say = (message, assertiveNow) => {
    const region = assertiveNow ? assertive : polite;
    region.textContent = '';                                                 // clearing first makes a repeated message be read again
    const write = () => { region.textContent = message; };
    (globalThis.queueMicrotask ?? ((f) => Promise.resolve().then(f)))(write);
  };
  const previousAnnounce = ui.onAnnounce;
  ui.onAnnounce = (message, assertiveNow) => { previousAnnounce?.(message, assertiveNow); say(message, assertiveNow); };
  cleanups.push(() => { ui.onAnnounce = previousAnnounce; });

  const mq = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
  if (mq) { ui.reducedMotion = !!mq.matches; const on = (e) => { ui.reducedMotion = !!e.matches; }; mq.addEventListener?.('change', on); cleanups.push(() => mq.removeEventListener?.('change', on)); }

  const labelField = (w, name) => { const f = field?.(); if (f && w) f.setAttribute('aria-label', name || nameOf(w) || 'text input'); };
  const flat = (tree) => { const out = []; const visit = (n) => { out.push(n); n.children.forEach(visit); }; [...tree.dialogs, ...tree.hud].forEach(visit); return out; };
  function update() {
    const tree = accessibilityTree(ui);
    for (const el of elements.values()) el._seen = false;
    let prev = null;
    for (const n of [...tree.dialogs, ...tree.hud]) prev = build(n, body, prev);
    for (const [id, el] of elements) if (!el._seen) { el.remove(); elements.delete(id); }
    const now = new Set(tree.dialogs.map((d) => d.id));
    for (const d of tree.dialogs) if (!lastDialogs.has(d.id)) ui.announce(`${d.name}, dialog`);
    lastDialogs = now;
    const f = tree.focused?.id ?? null, active = doc.activeElement;
    const diverged = !!active && '_widget' in active && active._widget !== ui.focus;       // the screen reader's cursor is on something other than what the UI has focused
    if (f !== lastFocus || diverged) {
      const changed = f !== lastFocus;
      lastFocus = f;
      const el = f ? elements.get(f) : null;
      if (el && (changed || diverged) && ui.focusVisible && active !== el && !ui.textTarget) { syncing = true; try { el.focus({ preventScroll: true }); } finally { syncing = false; } }
    }
    if (ui.textTarget) { const named = flat(tree).find((n) => n.widget === ui.textTarget); labelField(ui.textTarget, named?.name); }
  }
  update();

  return {
    update, element: root,
    detach() { for (const c of cleanups.reverse()) c(); root.remove(); elements.clear(); },
  };
}
