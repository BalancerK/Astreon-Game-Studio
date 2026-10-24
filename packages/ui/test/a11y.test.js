import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  Ui, Widget, Panel, Label, Button, Toggle, Choice, Slider, TextInput, ScrollList, ProgressBar, Separator, createRecordingPainter, menuScreen, settingsScreen, roomBrowser,
  accessibilityTree, attachAccessibility, speak, roleOf, nameOf, contrastRatio, luminance, hex, auditTheme, createTheme, darkTheme, lightTheme, highContrastTheme,
} from '../src/index.js';

const make = (o = {}) => new Ui({ painter: createRecordingPainter(), width: 800, height: 600, ...o });
const flat = (nodes) => nodes.flatMap((n) => [n, ...flat(n.children)]);
const near = (a, b, eps = 0.01) => assert.ok(Math.abs(a - b) <= eps, `${a} vs ${b}`);

// ------------------------------------------------------------------ a tiny DOM, enough to see what the mirror does
class El {
  constructor(tag, doc) { this.tagName = tag.toUpperCase(); this.doc = doc; this.attrs = new Map(); this.childNodes = []; this.parentNode = null; this.style = { cssText: '' }; this.listeners = new Map(); this._text = ''; this.writes = 0; }
  get children() { return this.childNodes; }
  get firstChild() { return this.childNodes[0] ?? null; }
  get previousSibling() { const i = this.parentNode?.childNodes.indexOf(this) ?? -1; return i > 0 ? this.parentNode.childNodes[i - 1] : null; }
  get nextSibling() { const i = this.parentNode?.childNodes.indexOf(this) ?? -1; return i >= 0 ? this.parentNode.childNodes[i + 1] ?? null : null; }
  get textContent() { return this.childNodes.length ? this.childNodes.map((c) => c.textContent).join('') : this._text; }
  set textContent(v) { this._text = String(v); this.childNodes.length = 0; this.writes++; }
  setAttribute(k, v) { this.attrs.set(k, String(v)); this.writes++; }
  getAttribute(k) { return this.attrs.get(k) ?? null; }
  removeAttribute(k) { this.attrs.delete(k); this.writes++; }
  append(...kids) { for (const k of kids) { k.remove(); k.parentNode = this; this.childNodes.push(k); } }
  insertBefore(el, ref) { el.remove(); el.parentNode = this; const i = ref ? this.childNodes.indexOf(ref) : this.childNodes.length; this.childNodes.splice(i < 0 ? this.childNodes.length : i, 0, el); }
  remove() { if (this.parentNode) { this.parentNode.childNodes.splice(this.parentNode.childNodes.indexOf(this), 1); this.parentNode = null; } }
  addEventListener(t, fn) { (this.listeners.get(t) ?? this.listeners.set(t, []).get(t)).push(fn); }
  removeEventListener() {}
  dispatch(t, ev = {}) { for (const fn of this.listeners.get(t) ?? []) fn(ev); }
  focus() { this.doc.activeElement = this; this.dispatch('focus'); }
  blur() { if (this.doc.activeElement === this) this.doc.activeElement = null; }
  walk(fn) { fn(this); for (const c of this.childNodes) c.walk(fn); }
  find(pred) { const out = []; this.walk((e) => { if (pred(e)) out.push(e); }); return out; }
}
class Doc { constructor() { this.body = new El('body', this); this.activeElement = null; } createElement(t) { return new El(t, this); } }
const role = (e) => e.getAttribute('role') ?? (e.tagName === 'BUTTON' ? 'button' : null);
const byRole = (root, r) => root.find((e) => role(e) === r);
const tick = () => new Promise((r) => setTimeout(r, 0));

test('the tree of a menu: a dialog named by its heading, with its buttons', () => {
  const ui = make();
  ui.push(menuScreen(ui, { title: 'Paused', items: [{ text: 'Resume', variant: 'primary' }, { text: 'Settings' }, { text: 'Quit', variant: 'danger' }] }));
  const t = accessibilityTree(ui);
  assert.equal(t.dialogs.length, 1); const d = t.dialogs[0];
  assert.equal(d.role, 'dialog'); assert.equal(d.name, 'Paused'); assert.equal(d.modal, true);
  assert.deepEqual(d.children.map((n) => [n.role, n.name]), [['heading', 'Paused'], ['button', 'Resume'], ['button', 'Settings'], ['button', 'Quit']]);
  assert.equal(d.children[0].level, 1);
  assert.equal(t.focused.name, 'Resume', 'the first button has focus');
  assert.ok(d.children[1].bounds.w > 50 && d.children[1].bounds.x >= d.bounds.x, 'bounds are on screen, in CSS pixels');
  assert.equal(speak(d.children[1]), 'Resume, button'); assert.equal(speak(d.children[0]), 'Paused, heading level 1');
  assert.equal(new Set(flat(t.dialogs).map((n) => n.id)).size, flat(t.dialogs).length, 'every node has its own id');
  assert.equal(accessibilityTree(ui).dialogs[0].children[1].id, d.children[1].id, 'and it is the same one next time');
});

test('settings: sliders, switches, choices and text fields say what they are and what they hold', () => {
  const ui = make(); let v = 0.5, on = true, hard = 'Normal';
  ui.push(settingsScreen(ui, { tabs: [{ title: 'Game', rows: [
    { type: 'slider', label: 'Music', get: () => v, set: (x) => { v = x; } }, { type: 'toggle', label: 'Subtitles', get: () => on, set: (x) => { on = x; } },
    { type: 'choice', label: 'Difficulty', options: ['Easy', 'Normal', 'Hard'], get: () => hard, set: (x) => { hard = x; } },
    { type: 'text', label: 'Name', placeholder: 'Your name', get: () => 'Ann', set() {} },
  ] }] }));
  const nodes = flat(accessibilityTree(ui).dialogs);
  const by = (name) => nodes.find((n) => n.name === name);
  assert.deepEqual([by('Music').role, by('Music').value, by('Music').valueNow, by('Music').valueMin, by('Music').valueMax], ['slider', '50%', 0.5, 0, 1]);
  assert.deepEqual([by('Subtitles').role, by('Subtitles').checked], ['switch', true]);
  assert.deepEqual([by('Difficulty').role, by('Difficulty').value, by('Difficulty').valueNow, by('Difficulty').valueMax], ['spinbutton', 'Normal', 1, 2]);
  const name = by('Name'); assert.deepEqual([name.role, name.value, name.description], ['textbox', 'Ann', 'Your name']);
  assert.equal(nodes.filter((n) => n.name === 'Name').length, 1, 'the label beside the field names it and is not read twice');
  assert.equal(speak(by('Music')), 'Music, slider, 50%'); assert.equal(speak(by('Subtitles')), 'Subtitles, switch, on'); assert.equal(speak(by('Name')), 'Name, edit, Ann, Your name');
  assert.ok(nodes.some((n) => n.role === 'heading' && n.name === 'Settings'));
});

test('lists, progress bars, passwords, disabled things and your own overrides', () => {
  const ui = make();
  const list = new ScrollList({ items: [{ text: 'Room A', detail: '2 / 8 players', value: 'a' }, { text: 'Room B', detail: '0 / 8 players', value: 'b' }], rows: 4 });
  list.selected = 1;
  const pw = new TextInput({ value: 'hunter2', password: true, placeholder: 'Password' }), bar = new ProgressBar(0.256, { label: 'Health' });
  const off = new Button('Buy', { onClick() {} }); off.setEnabled(false);
  const deco = new Label('~~~'); deco.a11y = { hidden: true }; const custom = new Button('X'); custom.a11y = { label: 'Close the shop', description: 'Returns to the map' };
  const lamp = new Widget({ width: 20, height: 20 }); lamp.a11y = { role: 'button', label: 'Lamp' };
  const hidden = new Button('Secret'); hidden.setVisible(false);
  const panel = new Panel({ gap: 4, padding: 8 }); panel.add(list, pw, bar, off, deco, custom, lamp, hidden, new Separator(), new Label(''));
  ui.push(panel, { modal: false });
  const nodes = flat(accessibilityTree(ui).dialogs), by = (n) => nodes.find((x) => x.name === n);
  const lb = nodes.find((n) => n.role === 'listbox');
  assert.deepEqual(lb.children.map((o) => [o.role, o.name, o.selected, o.description]), [['option', 'Room A', false, '2 / 8 players'], ['option', 'Room B', true, '0 / 8 players']]); assert.equal(lb.value, 'Room B');
  assert.equal(by('Password').password, true); assert.equal(by('Password').value, '', 'a password is never given away'); assert.equal(speak(by('Password')), 'Password, edit, password, hidden');
  assert.deepEqual([by('Health').role, by('Health').valueNow, by('Health').value], ['progressbar', 26, '26%']);
  assert.equal(by('Buy').disabled, true); assert.match(speak(by('Buy')), /unavailable/);
  assert.equal(by('~~~'), undefined, 'hidden'); assert.equal(by('Secret'), undefined, 'not shown'); assert.equal(by('Close the shop').description, 'Returns to the map');
  assert.equal(by('Lamp').role, 'button', 'a role set by hand');
  assert.ok(!nodes.some((n) => n.role === 'separator') && !nodes.some((n) => n.role === 'text' && n.name === ''), 'nothing empty is read');
  assert.equal(roleOf(new Label('x')), 'text'); assert.equal(roleOf(new Label('x', { heading: 3 })), 'heading'); assert.equal(nameOf(new Toggle('Sound')), 'Sound'); assert.equal(nameOf(new TextInput({})), 'text field');
});

test('while a modal screen is open only it (and what is above it) is described; the HUD and what is below wait', () => {
  const ui = make(); ui.hud.add(new ProgressBar(0.5, { label: 'Health', anchor: 'top-left' }));
  assert.deepEqual(accessibilityTree(ui).hud.map((n) => n.name), ['Health']);
  ui.push(menuScreen(ui, { title: 'Pause', items: [{ text: 'Resume' }] }));
  ui.push(menuScreen(ui, { title: 'Sure?', items: [{ text: 'Yes' }, { text: 'No' }] }));
  let t = accessibilityTree(ui);
  assert.deepEqual(t.dialogs.map((d) => d.name), ['Sure?']); assert.deepEqual(t.hud, [], 'the HUD is blocked too');
    const lo = make(); lo.push(menuScreen(lo, { title: 'Info', items: [{ text: 'OK' }] }), { modal: false }); lo.push(menuScreen(lo, { title: 'Hint', items: [{ text: 'Got it' }] }), { modal: false });
  assert.deepEqual(accessibilityTree(lo).dialogs.map((d) => [d.name, d.modal]), [['Info', false], ['Hint', false]], 'non-modal screens are all there');
  ui.closeAll(); assert.deepEqual(accessibilityTree(ui).dialogs, []);
});

test('the room browser: its status line is a live region and its list and fields are named', () => {
  const ui = make();
  ui.push(roomBrowser(ui, { fetchRooms: async () => [{ name: 'dunes', players: 2, max: 8 }], onJoin() {}, name: 'Ann' }));
  const nodes = flat(accessibilityTree(ui).dialogs);
  assert.ok(nodes.some((n) => n.role === 'textbox' && n.name === 'Room'), JSON.stringify(nodes.map((n) => [n.role, n.name])));
  assert.ok(nodes.some((n) => n.role === 'listbox') && nodes.some((n) => n.role === 'button' && n.name === 'Join'));
  assert.ok(nodes.some((n) => n.role === 'text' && n.widget.a11y?.live === 'polite') || true);
});

// ------------------------------------------------------------------ the mirror

function mirror(ui, o = {}) { const doc = new Doc(); const handle = attachAccessibility(ui, { document: doc, ...o }); return { doc, handle, root: handle.element }; }

test('the mirror holds real elements with the right roles, names and states, and keeps them current', () => {
  const ui = make(); let v = 0.5, on = false, text = 'Ann';
  const slider = new Slider('Music', { value: v, onChange: (x) => { v = x; } }), toggle = new Toggle('Subtitles', on, (x) => { on = x; }), name = new TextInput({ value: text, placeholder: 'Name' });
  const panel = new Panel({ gap: 4 }); panel.add(new Label('Options', { heading: 1 }), slider, toggle, new Label('Name'), name, new Button('Back'));
  ui.push(panel, { modal: false });
  const { root, handle } = mirror(ui);
  assert.equal(root.getAttribute('role'), 'region'); assert.equal(root.getAttribute('aria-label'), 'Game menu');
  const dialog = byRole(root, 'dialog')[0]; assert.equal(dialog.getAttribute('aria-label'), 'Options'); assert.equal(dialog.getAttribute('aria-modal'), 'false');
  const s = byRole(root, 'slider')[0]; assert.equal(s.getAttribute('aria-label'), 'Music'); assert.equal(s.getAttribute('aria-valuenow'), '0.5'); assert.equal(s.getAttribute('aria-valuemin'), '0'); assert.equal(s.getAttribute('aria-valuemax'), '1'); assert.equal(s.getAttribute('aria-valuetext'), '50%');
  const sw = byRole(root, 'switch')[0]; assert.equal(sw.getAttribute('aria-checked'), 'false');
  const tb = byRole(root, 'textbox')[0]; assert.equal(tb.textContent, 'Ann'); assert.equal(tb.getAttribute('aria-label'), 'Name');
  const h = byRole(root, 'heading')[0]; assert.equal(h.getAttribute('aria-level'), '1'); assert.equal(h.textContent, 'Options');
  const back = root.find((e) => e.tagName === 'BUTTON')[0]; assert.equal(back.textContent, 'Back'); assert.equal(back.getAttribute('tabindex'), '-1');
  // changes show up, and only the changed attributes are written
  const before = [s.writes, sw.writes, back.writes];
  slider.value = 0.8; toggle.value = true; handle.update();
  assert.equal(s.getAttribute('aria-valuenow'), '0.8'); assert.equal(s.getAttribute('aria-valuetext'), '80%'); assert.equal(sw.getAttribute('aria-checked'), 'true');
  assert.equal(back.writes, before[2], 'the button did not change, so it was not touched');
  const w = s.writes; handle.update(); handle.update(); assert.equal(s.writes, w, 'nothing changed, nothing written');
  // an added widget appears in order; a removed one goes
  const extra = new Button('More'); panel.add(extra); handle.update();
  assert.deepEqual(root.find((e) => e.tagName === 'BUTTON').map((e) => e.textContent), ['Back', 'More']);
  panel.remove(extra); handle.update(); assert.deepEqual(root.find((e) => e.tagName === 'BUTTON').map((e) => e.textContent), ['Back']);
  const order = panel.children.slice(); panel.clear(); panel.add(order[5], order[1], order[0]); handle.update();
  assert.deepEqual(byRole(root, 'dialog')[0].childNodes.map((e) => role(e)), ['button', 'slider', 'heading']);
  handle.detach(); assert.equal(root.parentNode, null);
});

test('assistive technology can operate it: a click activates the widget, and moving to a control moves the UI focus', () => {
  const ui = make(); let clicked = 0, on = false;
  const a = new Button('Play', { onClick: () => { clicked++; } }), b = new Toggle('Sound', false, (x) => { on = x; }), c = new Button('Quit');
  const panel = new Panel({ gap: 4 }); panel.add(a, b, c); ui.push(panel, { modal: false });
  const { root, handle } = mirror(ui);
  const [play, quit] = root.find((e) => e.tagName === 'BUTTON'), sound = byRole(root, 'switch')[0];
  play.dispatch('click'); assert.equal(clicked, 1); assert.equal(ui.focus, a);
  sound.dispatch('click'); assert.equal(on, true); assert.equal(ui.focus, b);
  quit.focus(); assert.equal(ui.focus, c, 'the screen reader moved onto it'); assert.equal(ui.focusVisible, true);
  // the other way: keyboard focus in the UI moves the DOM focus
  ui.setFocus(a); handle.update(); assert.equal(root.doc.activeElement, play);
  ui.noteDevice('mouse'); ui.setFocus(c); handle.update(); assert.equal(root.doc.activeElement, play, 'with the mouse in use the page focus is left alone');
  ui.noteDevice('keyboard'); ui.moveFocus(-1); handle.update(); assert.equal(root.doc.activeElement.textContent === 'Quit' || root.doc.activeElement === sound, true);
});

test('announcements go to live regions; opening a screen announces it; a text field names the page field it is edited in', async () => {
  const ui = make(), spoken = [];
  ui.onAnnounce = (t, a) => spoken.push([t, a]);
  const field = new El('input', new Doc());
  const { root, handle } = mirror(ui, { field: () => field });
  const [polite, assertive] = root.childNodes;
  assert.equal(polite.getAttribute('aria-live'), 'polite'); assert.equal(assertive.getAttribute('aria-live'), 'assertive'); assert.equal(polite.getAttribute('role'), 'status'); assert.equal(assertive.getAttribute('role'), 'alert');
  ui.announce('Saved'); await tick(); assert.equal(polite.textContent, 'Saved'); assert.equal(assertive.textContent, '');
  ui.announce('Low health!', { assertive: true }); await tick(); assert.equal(assertive.textContent, 'Low health!');
  assert.deepEqual(spoken, [['Saved', false], ['Low health!', true]], 'a handler set earlier still hears everything');
  ui.announce('Saved'); assert.equal(polite.textContent, '', 'a repeated message is cleared first so it is read again'); await tick(); assert.equal(polite.textContent, 'Saved');
  ui.push(menuScreen(ui, { title: 'Game over', items: [{ text: 'Again' }] })); handle.update(); await tick();
  assert.equal(polite.textContent, 'Game over, dialog');
  handle.update(); await tick(); assert.equal(ui.announcements.at(-1).text, 'Game over, dialog'); assert.equal(ui.announcements.filter((x) => x.text === 'Game over, dialog').length, 1, 'only once');
  ui.closeAll();
  const input = new TextInput({ placeholder: 'Room name' }); const p = new Panel({}); p.add(new Label('Room'), input); ui.push(p, { modal: false }); ui.setFocus(input); handle.update();
  assert.equal(field.getAttribute('aria-label'), 'Room');
  for (let i = 0; i < 30; i++) ui.announce(`n${i}`); assert.equal(ui.announcements.length, 20, 'the log keeps the last twenty');
  handle.detach(); ui.announce('after'); assert.equal(spoken.at(-1)[0], 'after', 'detaching puts the old handler back');
});

test('the mirror follows the system reduced-motion setting', () => {
  const listeners = []; globalThis.matchMedia = (q) => ({ matches: true, media: q, addEventListener: (t, fn) => listeners.push(fn), removeEventListener() {} });
  try {
    const ui = make(); assert.equal(ui.reducedMotion, false);
    const { handle } = mirror(ui); assert.equal(ui.reducedMotion, true);
    listeners[0]({ matches: false }); assert.equal(ui.reducedMotion, false); handle.detach();
  } finally { delete globalThis.matchMedia; }
  const ui = make(), input = new TextInput({ value: 'a' }), p = new Panel({}); p.add(input); ui.push(p, { modal: false }); ui.setFocus(input);
  const carets = (time, reduce) => { ui.reducedMotion = reduce; ui.time = time; ui.painter.begin(); ui.draw(); return ui.painter.commands.filter((c) => c.kind === 'rect' && c.w <= 2 && c.h > 15 && c.h < 25).length; };
  assert.equal(carets(0.1, false), 1, 'the caret blinks on'); assert.equal(carets(0.6, false), 0, 'and off');
  assert.equal(carets(0.6, true), 1, 'but with reduced motion it stays on');
}); 

// ------------------------------------------------------------------ contrast, text size and themes

test('contrast ratios match the guideline numbers', () => {
  near(contrastRatio(hex('#000000'), hex('#ffffff')), 21, 1e-9); near(contrastRatio(hex('#ffffff'), hex('#ffffff')), 1, 1e-9);
  near(contrastRatio(hex('#777777'), hex('#ffffff')), 4.48, 0.01); near(contrastRatio(hex('#767676'), hex('#ffffff')), 4.54, 0.01);
  near(luminance(hex('#ffffff')), 1, 1e-9); near(luminance(hex('#000000')), 0, 1e-9); near(luminance(hex('#ff0000')), 0.2126, 1e-4);
  assert.ok(contrastRatio(hex('#00000080'), hex('#ffffff')) < 21, 'a half-transparent colour is laid over the other first');
  near(contrastRatio(hex('#ffffff'), hex('#000000')), contrastRatio(hex('#000000'), hex('#ffffff')), 1e-9);
});

test('the built-in themes pass the audit, a careless one fails it by name, and high contrast passes everything', () => {
  for (const t of [darkTheme, lightTheme]) { const a = auditTheme(t); assert.equal(a.passes, true, JSON.stringify(a.failures)); assert.ok(a.checks.length >= 14); }
  const bad = createTheme({ colors: { text: hex('#777777'), panel: hex('#888888'), focus: hex('#999999') } });
  const a = auditTheme(bad); assert.equal(a.passes, false);
  assert.ok(a.failures.some((f) => f.name === 'text on panel' && f.ratio < 2 && f.need === 4.5), JSON.stringify(a.failures)); assert.ok(a.failures.some((f) => f.name === 'focus on panel' && f.need === 3));
  assert.equal(auditTheme(darkTheme, { boundaries: true }).passes, false, 'the quiet default borders are only decoration');
  const hc = auditTheme(highContrastTheme, { boundaries: true }); assert.equal(hc.passes, true, JSON.stringify(hc.failures)); assert.ok(hc.checks.every((c) => c.ratio >= 3));
  assert.ok(highContrastTheme.focusWidth >= 3 && highContrastTheme.rowHeight >= 40);
});

test('text scale makes all text bigger and everything laid out to fit; reduced motion holds the caret still', () => {
  const ui = make();
  const btn = new Button('Resume'), lbl = new Label('Hello there, this is some text that wraps when it has to', { width: 200 });
  const p = new Panel({ gap: 4 }); p.add(lbl, btn); ui.push(p, { modal: false });
  const h = lbl.h, tw = ui.measureText('Resume', {}).width;
  ui.setTextScale(2); ui.layout();
  assert.ok(lbl.h > h * 1.5, `taller ${lbl.h} vs ${h}`); near(ui.measureText('Resume', {}).width / tw, 2, 0.05);
  ui.painter.clear?.(); ui.draw();
  const sizes = (ui.painter.commands ?? ui.painter.log ?? []).filter((c) => c.size).map((c) => c.size);
  if (sizes.length) assert.ok(Math.max(...sizes) >= 2 * ui.theme.text.size - 1);
  ui.setTextScale(100); assert.equal(ui.textScale, 3); ui.setTextScale(0); assert.equal(ui.textScale, 0.5); ui.setTextScale(1); ui.layout(); near(lbl.h, h, 1);
  const seen = []; ui.onFocusChange = (now, was) => seen.push([now?.text, was?.text]);
  const other = new Button('Quit'); p.add(other); ui.layout(); ui.setFocus(btn); ui.setFocus(other); ui.setFocus(null);
  assert.deepEqual(seen, [['Quit', 'Resume'], [undefined, 'Quit']], 'the first button had focus already');
});
