// Ready-made screens built from the widgets: a menu, a confirmation dialog, a settings screen (sliders, switches, choices, key
// rebinding) and a room browser. They return a widget to `ui.push(...)`; nothing here is special, a game can build its own the same way.
import { Widget, Panel, Spacer } from './widget.js';
import { Label, Button, Toggle, Choice, Separator } from './widgets.js';
import { Slider, TextInput, ScrollList } from './controls.js';
import { naturalSize } from './layout.js';

const heading = (ui, text) => new Label(text, { size: ui.theme.text.title, color: ui.theme.colors.text, padding: [0, 0, 4, 0], heading: 2 });

/**
 * A vertical menu: a title and a column of buttons.
 * @param {import('./ui.js').Ui} ui
 * @param {{title?: string, items: {text: string, onClick: () => void, variant?: string, enabled?: boolean}[], width?: number, subtitle?: string}} o
 */
export function menuScreen(ui, { title = '', subtitle = '', items, width = 320 }) {
  const panel = new Panel({ width, padding: 20, gap: 10 });
  if (title) panel.add(new Label(title, { size: ui.theme.text.title, align: 'center', heading: 1 }));
  if (subtitle) panel.add(new Label(subtitle, { color: ui.theme.colors.textDim, align: 'center' }));
  if (title || subtitle) panel.add(new Spacer(4));
  for (const it of items) {
    const b = new Button(it.text, { variant: it.variant, onClick: it.onClick });
    b.enabled = it.enabled ?? true;
    panel.add(b);
  }
  return panel;
}

/** A question with two answers. `onAnswer(true | false)` is called after the dialog closes. */
export function confirmDialog(ui, { title = 'Are you sure?', message = '', confirm = 'OK', cancel = 'Cancel', danger = false, onAnswer }) {
  const panel = new Panel({ width: 380, padding: 20, gap: 12 });
  const answer = (v) => () => { ui.close(panel); onAnswer?.(v); };
  panel.add(new Label(title, { size: ui.theme.text.heading, heading: 1 }), message && new Label(message, { color: ui.theme.colors.textDim }));
  const row = new Widget({ direction: 'row', gap: 10, justify: 'end' });
  row.add(new Button(cancel, { onClick: answer(false), width: 120 }), new Button(confirm, { variant: danger ? 'danger' : 'primary', onClick: answer(true), width: 120 }));
  panel.add(new Spacer(4), row);
  return panel;
}

const deviceClass = (b) => (b.type.startsWith('gamepad') ? 'gamepad' : b.type.startsWith('touch') ? 'touch' : 'keyboard');

/**
 * Rows that rebind button actions: the action's name, its keyboard / mouse control and its gamepad control. Click a control, press the
 * new one (Escape cancels). A control already used by another action is taken from it, and the screen says so.
 * Only `button` actions are listed (a movement vector is four keys and is set up by the game).
 * @param {import('./ui.js').Ui} ui
 * @param {object} o
 * @param {import('../../input/src/core.js').InputCore} o.input
 * @param {{action: string, label: string}[]} o.actions
 * @param {Label} o.status A label to report conflicts and errors in.
 * @param {() => void} [o.onChange] Called after any change (save the bindings here).
 * @param {{id: string, title: string, devices: string[]}[]} [o.slots]
 */
export function bindingRows(ui, { input, actions, status, onChange, slots = [{ id: 'keyboard', title: 'Keyboard / mouse', devices: ['keyboard'] }, { id: 'gamepad', title: 'Gamepad', devices: ['gamepad'] }] }) {
  const rows = [];
  let cancelListen = null, listening = null;
  const buttons = []; // {button, action, slot}
  const labelOf = (action, slot) => {
    const bs = input.bindings(action), i = bs.findIndex((b) => deviceClass(b) === slot.id);
    return i < 0 ? '-' : input.describe(action)[i];
  };
  const refresh = () => { for (const x of buttons) x.button.text = listening === x ? 'Press a control...' : labelOf(x.action, x.slot); };
  const stop = () => { cancelListen?.(); cancelListen = null; listening = null; ui.captureKeys = false; ui.cancelCapture = null; };
  const start = (x) => {
    stop();
    listening = x; ui.captureKeys = true; ui.cancelCapture = () => { stop(); refresh(); status.text = ''; };
    status.text = 'Press the new control, or Escape to cancel.';
    refresh();
    cancelListen = input.listen((binding) => {
      listening = null; cancelListen = null; ui.captureKeys = false; ui.cancelCapture = null;
      if (binding) assign(x, binding); else status.text = '';
      refresh();
    }, { devices: x.slot.devices });
  };
  const assign = (x, binding) => {
    const { action, slot } = x;
    try {
      const taken = input.findConflicts(binding, action).sort((a, b) => b.index - a.index);
      const bs = input.bindings(action), i = bs.findIndex((b) => deviceClass(b) === slot.id);
      if (i >= 0) input.rebind(action, i, binding); else input.addBinding(action, binding);
      for (const t of taken) input.removeBinding(t.action, t.index);
      const names = [...new Set(taken.map((t) => actions.find((a) => a.action === t.action)?.label ?? t.action))];
      status.text = names.length ? `${names.join(' and ')} no longer ${names.length === 1 ? 'uses' : 'use'} that control.` : '';
      onChange?.();
    } catch (e) { status.text = String(e.message); }
  };
  for (const { action, label } of actions) {
    const row = new Widget({ direction: 'row', gap: 8, align: 'center' });
    row.add(new Label(label, { width: 130 }));
    for (const slot of slots) {
      const button = new Button('', {});
      const x = { button, action, slot };
      button.onClick = () => (listening === x ? (stop(), refresh()) : start(x));
      button.style.width = 'fill';
      buttons.push(x);
      row.add(button);
    }
    rows.push(row);
  }
  refresh();
  return {
    rows, refresh, stop,
    reset() { stop(); input.resetBindings(); refresh(); status.text = 'Controls reset to their defaults.'; onChange?.(); },
  };
}

/**
 * A settings screen: tabs of rows. A row is one of
 * `{type: 'slider', label, min, max, step, get, set, format}`, `{type: 'toggle', label, get, set}`, `{type: 'choice', label, options, get, set}`,
 * `{type: 'text', label, get, set, placeholder, maxLength}`, `{type: 'button', text, onClick}`, `{type: 'label', text}`, `{type: 'separator'}`,
 * or `{type: 'bindings', input, actions: [{action, label}], onChange}` (see `bindingRows`).
 * @param {import('./ui.js').Ui} ui
 * @param {{title?: string, tabs: {title: string, rows: object[]}[], onClose?: () => void, closeText?: string, width?: number}} o
 * @returns {Panel & {showTab(i: number): void, nextTab(): void, prevTab(): void, tab: number}}
 */
export function settingsScreen(ui, { title = 'Settings', tabs, onClose, closeText = 'Back', width = 560 }) {
  const panel = /** @type {any} */ (new Panel({ width, padding: 20, gap: 10 }));
  const status = new Label('', { color: ui.theme.colors.warn, size: ui.theme.text.small });
  status.a11y = { live: 'polite' };                       // a change in the status line is announced
  const bodies = [], cleanups = [];
  for (const tab of tabs) {
    const body = new Widget({ gap: 6 });
    for (const spec of tab.rows) {
      for (const w of buildRow(ui, spec, status, cleanups)) body.add(w);
    }
    bodies.push(body);
  }
  const bar = new Widget({ direction: 'row', gap: 6 });
  const tabButtons = tabs.map((t, i) => new Button(t.title, { onClick: () => panel.showTab(i) }));
  if (tabs.length > 1) bar.add(tabButtons);
  const holder = new Widget({ direction: 'stack' });
  holder.style.height = Math.max(0, ...bodies.map((b) => naturalSize(ui, b, width - 40).h)); // as tall as the tallest tab, so the panel does not jump
  holder.style.anchor = 'fill';
  panel.tab = -1;
  panel.showTab = (i) => {
    i = (i + tabs.length) % tabs.length;
    if (i === panel.tab) return;
    cleanups.forEach((f) => f());
    panel.tab = i;
    holder.clear(); holder.add(bodies[i]);
    bodies[i].style.anchor = 'top';
    tabButtons.forEach((b, j) => { b.variant = j === i ? 'primary' : 'normal'; });
    status.text = '';
    if (ui.focus && !ui.focus.shown) ui.setFocus(null);
  };
  panel.nextTab = () => panel.showTab(panel.tab + 1);
  panel.prevTab = () => panel.showTab(panel.tab - 1);
  const footer = new Widget({ direction: 'row', gap: 8, align: 'center' });
  footer.add(status, new Button(closeText, { variant: 'primary', width: 120, onClick: () => { ui.close(panel); onClose?.(); } }));
  status.style.grow = 1;
  panel.add(heading(ui, title), bar, new Separator(), holder, new Separator(), footer);
  panel.showTab(0);
  return panel;
}

function buildRow(ui, spec, status, cleanups) {
  switch (spec.type) {
    case 'slider': return [new Slider(spec.label, { min: spec.min ?? 0, max: spec.max ?? 1, step: spec.step ?? 0.05, value: spec.get(), format: spec.format, onChange: (v) => spec.set(v) })];
    case 'toggle': return [new Toggle(spec.label, spec.get(), (v) => spec.set(v))];
    case 'choice': {
      const i = Math.max(0, spec.options.findIndex((o) => (typeof o === 'object' ? o.value : o) === spec.get()));
      return [new Choice(spec.label, spec.options, i, (v) => spec.set(v))];
    }
    case 'text': {
      const row = new Widget({ direction: 'row', gap: 8, align: 'center' });
      const input = new TextInput({ value: spec.get(), placeholder: spec.placeholder, maxLength: spec.maxLength, filter: spec.filter, onChange: (v) => spec.set(v), onSubmit: () => ui.setFocus(null), width: 'fill' });
      row.add(new Label(spec.label, { width: Math.round(560 * 0.42) - 20 }), input);
      return [row];
    }
    case 'button': return [new Button(spec.text, { variant: spec.variant, onClick: spec.onClick })];
    case 'label': return [new Label(spec.text, { color: ui.theme.colors.textDim, size: spec.size })];
    case 'separator': return [new Separator()];
    case 'bindings': {
      const set = bindingRows(ui, { input: spec.input, actions: spec.actions, status, onChange: spec.onChange });
      const head = new Widget({ direction: 'row', gap: 8 });
      head.add(new Label('', { width: 130 }), ...(spec.slots ?? [{ title: 'Keyboard / mouse' }, { title: 'Gamepad' }]).map((s) => new Label(s.title, { color: ui.theme.colors.textDim, size: ui.theme.text.small, width: 'fill' })));
      cleanups.push(set.stop);
      return [head, ...set.rows, new Button('Reset controls', { onClick: () => set.reset() })];
    }
    default: throw new Error(`unknown settings row type "${spec.type}"`);
  }
}

/**
 * Pick a room (or make one) and a name. `fetchRooms()` returns `[{name, players, max?}]`; `onJoin(room, name)` is called with the choice.
 * @param {import('./ui.js').Ui} ui
 * @param {object} o
 * @param {() => Promise<{name: string, players?: number, max?: number}[]>} o.fetchRooms
 * @param {(room: string, name: string) => void} o.onJoin
 * @param {string} [o.title]
 * @param {string | null} [o.name] Starting player name; `null` hides the name field (a game without names).
 * @param {RegExp} [o.roomPattern] What a room name may look like.
 * @param {(name: string) => void} [o.onName] Called when the name changes (save it).
 * @param {() => void} [o.onClose]
 */
export function roomBrowser(ui, { fetchRooms, onJoin, title = 'Play online', name = '', roomPattern = /^[a-z0-9_-]{1,24}$/, onName, onClose }) {
  const panel = /** @type {any} */ (new Panel({ width: 480, padding: 20, gap: 10 }));
  const status = new Label('', { color: ui.theme.colors.textDim, size: ui.theme.text.small });
  status.a11y = { live: 'polite' };                       // a change in the status line is announced
  const nameInput = new TextInput({ value: name ?? '', placeholder: 'Your name', maxLength: 16, onChange: (v) => onName?.(v), width: 'fill' });
  const roomInput = new TextInput({ value: '', placeholder: 'or type a room name', maxLength: 24, filter: /[a-z0-9_-]/i, width: 'fill' });
  const list = new ScrollList({ rows: 6, empty: 'No rooms yet: type a name to start one' });
  const join = new Button('Join', { variant: 'primary', width: 120 });
  const roomName = () => (roomInput.value.trim() || list.selectedItem?.value || '').toLowerCase();
  const update = () => {
    const room = roomName();
    join.enabled = roomPattern.test(room);
    join.text = list.selectedItem && !roomInput.value.trim() ? `Join ${room}` : room ? `Join ${room}` : 'Join';
  };
  const go = () => { const room = roomName(); if (roomPattern.test(room)) { ui.close(panel); onJoin(room, name === null ? undefined : nameInput.value.trim()); } };
  join.onClick = go;
  roomInput.onChange = update; roomInput.onSubmit = go; list.onSelect = () => { roomInput.set('', false); update(); }; list.onActivate = go;
  const refresh = async () => {
    status.text = 'Looking for rooms...';
    try {
      const rooms = await fetchRooms();
      list.setItems(rooms.map((r) => ({ text: r.name, detail: `${r.players ?? 0}${r.max ? ` / ${r.max}` : ''} players`, value: r.name })));
      status.text = rooms.length ? `${rooms.length} room${rooms.length === 1 ? '' : 's'}` : '';
    } catch (e) { status.text = `Could not load rooms (${e.message ?? e})`; }
    update();
  };
  const nameRow = name === null ? null : new Widget({ direction: 'row', gap: 8, align: 'center' });
  nameRow?.add(new Label('Name', { width: 60 }), nameInput);
  const roomRow = new Widget({ direction: 'row', gap: 8, align: 'center' });
  roomRow.add(new Label('Room', { width: 60 }), roomInput);
  const footer = new Widget({ direction: 'row', gap: 8, align: 'center', justify: 'end' });
  footer.add(status, new Button('Refresh', { width: 100, onClick: refresh }), new Button('Cancel', { width: 100, onClick: () => { ui.close(panel); onClose?.(); } }), join);
  status.style.grow = 1;
  panel.add(heading(ui, title), nameRow, nameRow && new Separator(), list, roomRow, footer);
  panel.refresh = refresh; panel.list = list; panel.roomInput = roomInput; panel.nameInput = nameInput; panel.join = go;
  update();
  refresh();
  return panel;
}
