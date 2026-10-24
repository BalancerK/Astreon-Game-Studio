// The UI panel's logic: menus and HUDs as screens of widgets (text, panels, buttons, bars, pictures) pinned to the screen, kept in `src/ui.js` as plain JSON:
//
//   export default { "hud": { "widgets": [ { "id": "score", "type": "label", "anchor": "top-left", "x": 10, "y": 8, "text": "Score: {score}", ... } ] }, "menu": { ... } };
//
// This builds and changes screens, moves and resizes widgets in screen pixels while keeping them pinned the way they are (so the same layout works at any screen size),
// finds the numbers a screen shows so the panel can offer test values, and reads and writes the file. What a widget is, how it is placed and drawn, and what is wrong with
// a screen are the kit's own (`ui.js`), so the panel and the game agree.
import {
  cleanUi, cleanWidget, placeOf, offsetsFor, uiProblems, WIDGET_TYPES, ANCHORS, UI_LIMITS,
} from '../../../packages/arcade/src/ui.js';

export { cleanUi, cleanWidget, placeOf, offsetsFor, uiProblems, WIDGET_TYPES, ANCHORS, UI_LIMITS };

const clone = (x) => JSON.parse(JSON.stringify(x));
const round = (n) => Math.round(n);
export const NAME = /^[a-z][\w-]{0,31}$/i;
export const SIZES = [[480, 320], [640, 360], [800, 450], [320, 480], [960, 540]];

/** Ready-made screens. */
export const STARTERS = {
  hud: () => cleanUi({
    widgets: [
      { type: 'label', id: 'score', anchor: 'top-left', x: 10, y: 8, w: 140, h: 24, text: 'Score: {score}', size: 18 },
      { type: 'bar', id: 'health', anchor: 'top-right', x: 10, y: 12, w: 120, h: 14, value: 'hp', max: 10 },
      { type: 'label', id: 'lives', anchor: 'top-right', x: 10, y: 32, w: 120, h: 20, text: 'Lives: {lives}', size: 14, align: 'right' },
    ],
  }),
  menu: () => cleanUi({
    widgets: [
      { type: 'label', id: 'title', anchor: 'top', x: 0, y: 40, w: 300, h: 50, text: 'My game', size: 40, align: 'center' },
      { type: 'button', id: 'play', anchor: 'center', x: 0, y: -10, w: 160, h: 38, text: 'Play' },
      { type: 'button', id: 'options', anchor: 'center', x: 0, y: 40, w: 160, h: 38, text: 'Options' },
      { type: 'button', id: 'quit', anchor: 'center', x: 0, y: 90, w: 160, h: 38, text: 'Quit' },
    ],
  }),
  gameover: () => cleanUi({
    widgets: [
      { type: 'panel', id: 'card', anchor: 'center', x: 0, y: 0, w: 280, h: 160 },
      { type: 'label', id: 'headline', anchor: 'center', x: 0, y: -50, w: 260, h: 40, text: 'Game over', size: 32, align: 'center' },
      { type: 'label', id: 'final', anchor: 'center', x: 0, y: -8, w: 260, h: 24, text: 'You scored {score}', size: 18, align: 'center' },
      { type: 'button', id: 'again', anchor: 'center', x: 0, y: 44, w: 150, h: 36, text: 'Play again' },
    ],
  }),
  pause: () => cleanUi({
    widgets: [
      { type: 'panel', id: 'veil', anchor: 'center', x: 0, y: 0, w: 220, h: 150, bg: '#12161fd9' },
      { type: 'label', id: 'paused', anchor: 'center', x: 0, y: -46, w: 200, h: 30, text: 'Paused', size: 26, align: 'center' },
      { type: 'button', id: 'resume', anchor: 'center', x: 0, y: -4, w: 150, h: 34, text: 'Resume' },
      { type: 'button', id: 'quit', anchor: 'center', x: 0, y: 40, w: 150, h: 34, text: 'Quit' },
    ],
  }),
};

// ---------- the file ----------

/** The screens as the text of a file. */
export function serializeUi(screens) {
  const body = Object.entries(screens).map(([name, s]) => `  ${JSON.stringify(name)}: ${JSON.stringify(s)}`).join(',\n');
  const note = '// Made with the studio\'s UI panel. Each screen is a list of widgets pinned to the screen: '
    + 'text, panels, buttons, bars and pictures.';
  return `${note}\n// Use them with drawUi(g, ui.hud, game) and uiHit(ui.menu, x, y) from @engine/arcade.\nexport default {\n${body}\n};\n`;
}

/** Read a UI file. Throws an Error that says what is wrong. */
export function parseUi(text) {
  const m = /export\s+default\s+([\s\S]*?);?\s*$/.exec(String(text ?? ''));
  if (!m) throw new Error('This file is not a set of screens: it should say "export default { ... }".');
  let data;
  try {
    data = JSON.parse(m[1]);
  } catch {
    throw new Error('This UI file has been edited into something the UI panel cannot read. Keep the part after "export default" as plain JSON.');
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('The UI file should hold an object of named screens.');
  const out = {};
  for (const [name, s] of Object.entries(data)) {
    if (!NAME.test(name) || !s || typeof s !== 'object' || !Array.isArray(s.widgets)) {
      throw new Error(`The screen "${name.slice(0, 32)}" is not usable: it needs a name and a list of widgets.`);
    }
    out[name] = cleanUi(s);
  }
  return out;
}

/** A name for a new screen that is not taken. */
export function freeName(taken, wanted) {
  const base = String(wanted).replace(/[^\w-]/g, '').replace(/^[^a-z]+/i, '') || 'screen';
  if (!(base in taken)) return base;
  for (let n = 2; n < 1000; n++) if (!(`${base}${n}` in taken)) return `${base}${n}`;
  return `${base}${Date.now()}`;
}

/** Why a name cannot be used, or null. */
export function nameProblem(name, taken) {
  if (!NAME.test(name)) return 'Use letters and numbers, starting with a letter';
  return taken(name) ? 'There is already a screen with that name' : null;
}

/** The size a screen is edited at (its own, or the usual 480 by 320). */
export const sizeOf = (screen) => ({ width: screen.size?.[0] ?? 480, height: screen.size?.[1] ?? 320 });

// ---------- changing a screen ----------

/** An id for a new widget that no other widget has (`button`, `button2`...). */
export function freeId(screen, base) {
  const taken = new Set(screen.widgets.map((w) => w.id));
  if (!taken.has(base)) return base;
  for (let n = 2; n < 1000; n++) if (!taken.has(`${base}${n}`)) return `${base}${n}`;
  return `${base}${Date.now()}`;
}

/** A widget added in the middle of the screen with its starting look. Returns the screen and the new widget's index. */
export function addWidget(screen, type) {
  if (screen.widgets.length >= UI_LIMITS.widgets) throw new Error(`At most ${UI_LIMITS.widgets} widgets on a screen.`);
  const widget = cleanWidget({ ...WIDGET_TYPES[type].make(), id: freeId(screen, type), anchor: 'center', x: 0, y: 0 });
  return { screen: { ...clone(screen), widgets: [...clone(screen.widgets), widget] }, index: screen.widgets.length };
}

/** Settings of a widget changed (kept within their ranges). */
export function updateWidget(screen, index, patch) {
  const next = clone(screen);
  next.widgets[index] = cleanWidget({ ...next.widgets[index], ...patch });
  for (const k of Object.keys(patch)) if (patch[k] === undefined) delete next.widgets[index][k];
  return next;
}

/** A widget taken away. */
export function removeWidget(screen, index) {
  const next = clone(screen);
  next.widgets.splice(index, 1);
  return next;
}

/** A copy of a widget, a little to one side, with its own id. Returns the screen and the copy's index. */
export function duplicateWidget(screen, index) {
  if (screen.widgets.length >= UI_LIMITS.widgets) throw new Error(`At most ${UI_LIMITS.widgets} widgets on a screen.`);
  const next = clone(screen);
  const copy = { ...clone(next.widgets[index]), x: next.widgets[index].x + 12, y: next.widgets[index].y + 12 };
  copy.id = freeId(next, copy.id.replace(/\d+$/, '') || copy.type);
  next.widgets.splice(index + 1, 0, copy);
  return { screen: next, index: index + 1 };
}

/** A widget moved forward or back in the drawing order (the last is on top). Returns the screen and its new index. */
export function moveWidgetOrder(screen, index, by) {
  const j = index + by;
  if (j < 0 || j >= screen.widgets.length) return { screen, index };
  const next = clone(screen);
  [next.widgets[index], next.widgets[j]] = [next.widgets[j], next.widgets[index]];
  return { screen: next, index: j };
}

/** The offsets that put a widget's top-left corner at a place on the screen (snapped to a grid, if given), whatever it is pinned to. */
export function offsetsForCorner(widget, bx, by, size, grid = 1) {
  const snap = (n) => (grid > 1 ? Math.round(n / grid) * grid : round(n));
  const x = snap(bx);
  const y = snap(by);
  const a = widget.anchor;
  const col = a.includes('left') ? 'l' : a.includes('right') ? 'r' : 'c';
  const row = a.startsWith('top') ? 't' : a.startsWith('bottom') ? 'b' : 'c';
  return {
    x: col === 'l' ? x : col === 'r' ? size.width - widget.w - x : round(x - (size.width - widget.w) / 2),
    y: row === 't' ? y : row === 'b' ? size.height - widget.h - y : round(y - (size.height - widget.h) / 2),
  };
}

/** A widget dragged so its top-left corner is at a place on the screen. */
export function moveWidgetTo(screen, index, bx, by, grid = 1) {
  return updateWidget(screen, index, offsetsForCorner(screen.widgets[index], bx, by, sizeOf(screen), grid));
}

/** A widget moved by a number of pixels in screen directions (arrow keys). */
export function nudgeWidget(screen, index, dx, dy) {
  const size = sizeOf(screen);
  const b = placeOf(screen.widgets[index], size);
  return moveWidgetTo(screen, index, b.x + dx, b.y + dy);
}

/** A widget resized so its bottom-right corner is at a place on the screen (its top-left corner stays where it is on screen). */
export function resizeWidgetTo(screen, index, rx, ry, grid = 1) {
  const size = sizeOf(screen);
  const widget = screen.widgets[index];
  const b = placeOf(widget, size);
  const snap = (n) => (grid > 1 ? Math.round(n / grid) * grid : round(n));
  const w = Math.max(4, snap(rx - b.x));
  const h = Math.max(4, snap(ry - b.y));
  const resized = { ...widget, w, h };
  return updateWidget(screen, index, { w, h, ...offsetsForCorner(resized, b.x, b.y, size) });
}

/** A widget pinned to another place without moving on screen. */
export function setAnchor(screen, index, anchor) {
  const widget = screen.widgets[index];
  return updateWidget(screen, index, { anchor, ...offsetsFor(widget, anchor, sizeOf(screen)) });
}

/** The size the screen is edited at. */
export function setSize(screen, width, height) {
  const next = clone(screen);
  next.size = [width, height];
  return cleanUi(next);
}

// ---------- the numbers a screen shows ----------

const PLACES = /\{([A-Za-z_$][\w$.]*)\}/g;

/** The numbers of the game a screen looks at (in its text, bars and conditions), in the order they appear. */
export function pathsOf(screen) {
  const out = new Set();
  for (const w of screen.widgets) {
    if (typeof w.text === 'string' && !w.text.startsWith('@')) for (const m of w.text.matchAll(PLACES)) out.add(m[1]);
    if (w.showIf) out.add(w.showIf.replace(/^!/, ''));
    if (w.type === 'bar') for (const p of [w.value, typeof w.max === 'string' ? w.max : null]) if (p) out.add(p);
  }
  return [...out];
}

/**
 * A pretend game with a value for each number a screen looks at (the test values given, else a middling number), so the picture has something to show. A number that
 * only decides whether a widget shows is set so that the widget shows (set for `lives`, not set for `!paused`).
 */
export function sampleGame(screen, values = {}) {
  const game = {};
  const flags = new Map(screen.widgets.filter((w) => w.showIf).map((w) => [w.showIf.replace(/^!/, ''), !w.showIf.startsWith('!')]));
  const shown = new Set(screen.widgets.flatMap((w) => [w.type === 'bar' ? w.value : null, typeof w.max === 'string' ? w.max : null,
    ...(typeof w.text === 'string' ? [...w.text.matchAll(PLACES)].map((m) => m[1]) : [])]).filter(Boolean));
  for (const path of pathsOf(screen)) {
    const keys = path.split('.');
    let at = game;
    keys.slice(0, -1).forEach((k) => { at = at[k] ??= {}; });
    const middling = /(^|\.)(max|full|total)/i.test(path) ? 10 : /(^|\.)(hp|health|lives)$/i.test(path) ? 7 : 120;
    at[keys.at(-1)] = path in values ? values[path] : flags.has(path) && !shown.has(path) ? flags.get(path) : middling;
  }
  return game;
}
