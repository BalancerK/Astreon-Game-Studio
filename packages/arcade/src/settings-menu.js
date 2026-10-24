// A ready-made settings menu: volumes, text size, captions, less screen shake, high contrast, and a page where the player picks the keys for each action. It works with the
// keyboard (arrows, Enter, Esc) and, if you pass it the mouse, with clicks. It is drawn by the kit's own UI code, so it follows the player's text size and high contrast too.
//
//   openSettingsMenu(game);                                     // when the player picks "Settings"
//   if (settingsMenuOpen(game)) { if (stepSettingsMenu(game, keys, mouse) === 'back') ...; }       // in update: true answer 'back' means they left it
//   if (settingsMenuOpen(game)) drawSettingsMenu(g, game);       // in render, over the game
import { screen } from './screen.js';
import { drawUi, uiHit, cleanUi } from './ui.js';
import {
  SETTING_SPEC, SETTING_NAMES, getSetting, setSetting, resetSettings, actionsList, setBinding, resetBindings, conflictsFor, newKey, keyName,
} from './settings.js';

const ROW = 24;
const PER_PAGE = 7;
const NAV = { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight', go: 'Enter', back: 'Escape', alt: 'Space' };

/**
 * Open the menu.
 * @param {object} game
 * @param {{offer?: string[], title?: string}} [o] `offer` which settings to show (default: all of them)
 */
export function openSettingsMenu(game, { offer = SETTING_NAMES, title = 'Settings' } = {}) {
  game.settingsMenu = {
    page: 'main', focus: 0, offer: offer.filter((n) => n in SETTING_SPEC), title, rebinding: null, note: '', paging: 0, prev: [], armed: false,
  };
}

/** Is the menu open? */
export const settingsMenuOpen = (game) => Boolean(game.settingsMenu);

/** Close the menu. */
export function closeSettingsMenu(game) {
  delete game.settingsMenu;
}

const valueWords = (name) => {
  const v = getSetting(name);
  const spec = SETTING_SPEC[name];
  if (spec.kind === 'flag') return v ? 'On' : 'Off';
  return name === 'textScale' ? `${Math.round(v * 100)}%` : `${Math.round(v * 100)}`;
};

/** The rows the keyboard can move between on the page the menu is on, as ids. */
export function menuItems(game) {
  const m = game.settingsMenu;
  if (!m) return [];
  if (m.page === 'main') return [...m.offer.map((n) => `row-${n}`), 'go-controls', 'reset', 'back'];
  const list = actionsList();
  const from = m.paging * PER_PAGE;
  return [...list.slice(from, from + PER_PAGE).map((a) => `bind-${a.action}`),
    ...(list.length > PER_PAGE ? ['page'] : []), 'resetkeys', 'back'];
}

const at = (left, w) => left + w / 2;                       // x for a widget whose left edge is `left` from the middle of the screen

/** The menu as a UI screen (plain data), for drawing and for finding what was clicked. */
export function settingsMenuScreen(game) {
  const m = game.settingsMenu;
  const size = screen();
  const items = menuItems(game);
  const widgets = [];
  const rows = m.page === 'main' ? m.offer.length : Math.min(PER_PAGE, actionsList().length);
  const top = 40;
  const panelH = top + rows * ROW + 72;
  widgets.push({ type: 'panel', id: 'frame', anchor: 'top', x: 0, y: Math.max(4, (size.height - panelH) / 2), w: 420, h: panelH, bg: '#12161f', border: '#8b8bff' });
  const y0 = Math.max(4, (size.height - panelH) / 2);
  widgets.push({ type: 'label', id: 'title', anchor: 'top', x: 0, y: y0 + 8, w: 380, h: 26, text: m.page === 'main' ? m.title : 'Controls', size: 20, align: 'center' });
  const focus = items[m.focus];
  const hi = (i) => widgets.push({ type: 'panel', id: `hi${i}`, anchor: 'top', x: 0, y: y0 + top + i * ROW - 2, w: 408, h: ROW, bg: '#2a3150', border: '' });
  if (m.page === 'main') {
    m.offer.forEach((name, i) => {
      const y = y0 + top + i * ROW;
      if (focus === `row-${name}`) hi(i);
      widgets.push({ type: 'label', id: `l-${name}`, anchor: 'top', x: at(-196, 170), y, w: 170, h: 22, text: SETTING_SPEC[name].label, size: 14 });
      if (SETTING_SPEC[name].kind === 'flag') {
        widgets.push({ type: 'button', id: `flip-${name}`, anchor: 'top', x: at(-20, 96), y, w: 96, h: 22, text: valueWords(name), size: 14 });
      } else {
        widgets.push({ type: 'button', id: `dec-${name}`, anchor: 'top', x: at(-20, 28), y, w: 28, h: 22, text: '−', size: 16 });
        widgets.push({ type: 'label', id: `v-${name}`, anchor: 'top', x: at(14, 56), y, w: 56, h: 22, text: valueWords(name), size: 14, align: 'center' });
        widgets.push({ type: 'button', id: `inc-${name}`, anchor: 'top', x: at(76, 28), y, w: 28, h: 22, text: '+', size: 16 });
      }
    });
  } else {
    const list = actionsList().slice(m.paging * PER_PAGE, m.paging * PER_PAGE + PER_PAGE);
    list.forEach((a, i) => {
      const y = y0 + top + i * ROW;
      if (focus === `bind-${a.action}`) hi(i);
      widgets.push({ type: 'label', id: `l-${a.action}`, anchor: 'top', x: at(-196, 120), y, w: 120, h: 22, text: a.action, size: 14 });
      widgets.push({
        type: 'button', id: `bind-${a.action}`, anchor: 'top', x: at(-70, 270), y, w: 270, h: 22, size: 13,
        text: m.rebinding === a.action ? 'Press the key you want…  (Esc: cancel)' : a.keys.map(keyName).join(', '),
      });
    });
  }
  const by = y0 + top + rows * ROW + 10;
  if (m.note) widgets.push({ type: 'label', id: 'note', anchor: 'top', x: 0, y: by, w: 400, h: 18, text: m.note, size: 12, align: 'center', color: '#ffd23c' });
  const buttons = m.page === 'main'
    ? [['go-controls', 'Controls…'], ['reset', 'Reset'], ['back', 'Back']]
    : [...(actionsList().length > PER_PAGE ? [['page', 'More…']] : []), ['resetkeys', 'Reset keys'], ['back', 'Back']];
  const w = 118;
  const total = buttons.length * w + (buttons.length - 1) * 8;
  buttons.forEach(([id, text], i) => widgets.push({
    type: 'button', id, anchor: 'top', x: at(-total / 2 + i * (w + 8), w), y: by + 20, w, h: 30, text, size: 14,
  }));
  return { screen: cleanUi({ size: [size.width, size.height], widgets }), focus };
}

function adjust(name, dir) {
  const spec = SETTING_SPEC[name];
  if (spec.kind === 'flag') setSetting(name, !getSetting(name));
  else setSetting(name, getSetting(name) + dir * spec.step);
}

function activate(game, id) {
  const m = game.settingsMenu;
  if (id === 'back') {
    if (m.page === 'controls') { m.page = 'main'; m.focus = m.offer.length; m.rebinding = null; m.note = ''; return null; }
    closeSettingsMenu(game);
    return 'back';
  }
  if (id === 'go-controls') { m.page = 'controls'; m.focus = 0; m.paging = 0; m.note = ''; return null; }
  if (id === 'reset') { resetSettings(); m.note = 'Everything is back to how it started.'; return null; }
  if (id === 'resetkeys') { resetBindings(); m.note = 'The keys are back to how they started.'; return null; }
  if (id === 'page') { m.paging = (m.paging + 1) % Math.ceil(actionsList().length / PER_PAGE); m.focus = 0; return null; }
  const kind = id.slice(0, id.indexOf('-'));
  const name = id.slice(id.indexOf('-') + 1);
  if (kind === 'bind') { m.rebinding = name; m.note = ''; return null; }
  if (kind === 'dec') adjust(name, -1);
  else if (kind === 'inc') adjust(name, 1);
  else if (kind === 'flip' || kind === 'row') adjust(name, 1);
  return null;
}

/**
 * Handle the keys (and the mouse) for one tick.
 * @param {object} game
 * @param {Set<string>} keys the keys held
 * @param {{x: number, y: number, clicked?: boolean}} [mouse] where the mouse is, and whether it was just clicked
 * @returns {'back' | null} 'back' when the player has left the menu
 */
export function stepSettingsMenu(game, keys, mouse) {
  const m = game.settingsMenu;
  if (!m) return null;
  const before = new Set(m.prev);
  m.prev = [...keys];
  const pressed = (code) => keys.has(code) && !before.has(code);
  if (!m.armed) { m.armed = true; return null; }                       // the key that opened the menu must not also press something in it
  if (m.rebinding) {
    if (pressed(NAV.back)) { m.rebinding = null; m.note = ''; return null; }
    const code = newKey(m, keys);
    if (code && !before.has(code)) {
      const clash = conflictsFor(m.rebinding, code);
      setBinding(m.rebinding, [code]);
      m.note = clash.length ? `${keyName(code)} is also used for ${clash.join(', ')}.` : '';
      m.rebinding = null;
    }
    return null;
  }
  const items = menuItems(game);
  if (m.focus >= items.length) m.focus = items.length - 1;
  if (pressed(NAV.up)) m.focus = (m.focus + items.length - 1) % items.length;
  if (pressed(NAV.down)) m.focus = (m.focus + 1) % items.length;
  const id = items[m.focus];
  if (pressed(NAV.left) && id.startsWith('row-')) adjust(id.slice(4), -1);
  if (pressed(NAV.right) && id.startsWith('row-')) adjust(id.slice(4), 1);
  if (pressed(NAV.go) || pressed(NAV.alt)) return activate(game, id);
  if (pressed(NAV.back)) return activate(game, 'back');
  if (mouse?.clicked) {
    const hit = uiHit(settingsMenuScreen(game).screen, mouse.x, mouse.y, {}, { size: screen() });
    if (hit) {
      const at2 = items.findIndex((i) => i === hit || i === `row-${hit.slice(hit.indexOf('-') + 1)}`);
      if (at2 >= 0) m.focus = at2;
      return activate(game, hit);
    }
  }
  return null;
}

/** Draw the menu over the game. */
export function drawSettingsMenu(g, game) {
  if (!game.settingsMenu) return;
  const { screen: spec, focus } = settingsMenuScreen(game);
  g.save();
  g.fillStyle = 'rgba(0,0,0,0.55)';
  const size = screen();
  g.fillRect(0, 0, size.width, size.height);
  g.restore();
  drawUi(g, spec, game, { focus: focus?.includes('-') ? focus.replace(/^row-(.*)$/, (all, n) => (SETTING_SPEC[n].kind === 'flag' ? `flip-${n}` : `inc-${n}`)) : focus, size });
}
