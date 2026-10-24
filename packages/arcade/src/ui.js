// Menus and HUDs as data: a screen is a list of widgets (labels, panels, buttons, bars, pictures), each pinned to a corner, an edge or the middle of the screen so it stays
// in the right place at any screen size. Made in the studio's UI panel and kept in `src/ui.js`; the game draws it with `drawUi` (the same code the panel uses, so what you
// see there is what you get). Text can show the game's numbers (`Score: {score}`), and `@key` shows a word from the language table (see text.js).
//
//   drawUi(g, ui.hud, game);                                   // a HUD
//   drawUi(g, ui.menu, game, { focus });                       // a menu, with the button that has the keyboard focus lit
//   const id = uiHit(ui.menu, mouse.x, mouse.y);               // which button was clicked ('play', 'quit'...), or null
//   focus = uiNext(ui.menu, focus, +1);                        // arrow keys: the next button
import { screen } from './screen.js';
import { t as word } from './text.js';
import { drawSprite } from './art.js';
import { getSetting } from './settings.js';

/**
 * @typedef {object} Widget
 * @property {string} id a name; a button's id is what `uiHit` tells you
 * @property {'label' | 'panel' | 'button' | 'bar' | 'image'} type
 * @property {string} [anchor] where it is pinned: 'top-left', 'top', 'top-right', 'left', 'center', 'right', 'bottom-left', 'bottom', 'bottom-right'
 * @property {number} [x] pixels in from that edge (or right of the middle, when centred)
 * @property {number} [y]
 * @property {number} [w]
 * @property {number} [h]
 * @property {string} [text] words; `{score}` shows a number of the game, `@key` a word from the language table
 * @property {string} [showIf] a number or flag of the game that must be set (`lives`), or `!lives` for when it is not
 * @property {string} [value] for a bar: the number of the game it shows (`player.hp`)
 * @property {string | number} [max] for a bar: what full is, a number or a number of the game
 * @property {string} [sprite] for a picture: the sprite's name
 */

export const ANCHORS = ['top-left', 'top', 'top-right', 'left', 'center', 'right', 'bottom-left', 'bottom', 'bottom-right'];
export const WIDGET_TYPES = {
  label: { label: 'Text', make: () => ({ type: 'label', text: 'Hello', size: 18, color: '#ffffff', align: 'left', w: 120, h: 24 }) },
  panel: { label: 'Panel', make: () => ({ type: 'panel', bg: '#1d2333', border: '#3a4466', radius: 8, w: 160, h: 80 }) },
  button: {
    label: 'Button',
    make: () => ({ type: 'button', text: 'Play', size: 18, color: '#ffffff', bg: '#3a4466', bgFocus: '#6c63ff', border: '#8b8bff', radius: 8, w: 140, h: 36 }),
  },
  bar: { label: 'Bar', make: () => ({ type: 'bar', value: 'hp', max: 10, bg: '#1d2333', color: '#4ade80', lowColor: '#e84a5f', border: '#3a4466', radius: 4, w: 140, h: 14 }) },
  image: { label: 'Picture', make: () => ({ type: 'image', sprite: '', w: 32, h: 32 }) },
};
export const UI_LIMITS = { widgets: 60, text: 120, w: 2000, h: 2000 };

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const num = (v, fallback) => (Number.isFinite(v) ? v : fallback);
const COLOR = /^#[0-9a-f]{3,8}$/i;
const PATH = /^!?[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/;
const color = (v, fallback) => (typeof v === 'string' && COLOR.test(v) ? v : fallback);

/**
 * Make one widget safe: a known type, an anchor from the list, numbers kept in range, colors that are colors, short text, paths that look like paths.
 * @param {unknown} spec
 * @returns {Widget | null}
 */
export function cleanWidget(spec) {
  const kind = WIDGET_TYPES[spec?.type];
  if (!kind) return null;
  const base = kind.make();
  const out = {
    id: typeof spec.id === 'string' && /^[A-Za-z][\w-]{0,31}$/.test(spec.id) ? spec.id : '',
    type: spec.type,
    anchor: ANCHORS.includes(spec.anchor) ? spec.anchor : 'top-left',
    x: clamp(num(spec.x, 0), -UI_LIMITS.w, UI_LIMITS.w),
    y: clamp(num(spec.y, 0), -UI_LIMITS.h, UI_LIMITS.h),
    w: clamp(num(spec.w, base.w), 1, UI_LIMITS.w),
    h: clamp(num(spec.h, base.h), 1, UI_LIMITS.h),
  };
  if (typeof spec.showIf === 'string' && PATH.test(spec.showIf)) out.showIf = spec.showIf;
  if (spec.type === 'label' || spec.type === 'button') {
    out.text = typeof spec.text === 'string' ? spec.text.slice(0, UI_LIMITS.text) : base.text;
    out.size = clamp(num(spec.size, base.size), 6, 200);
    out.color = color(spec.color, base.color);
    out.align = ['left', 'center', 'right'].includes(spec.align) ? spec.align : spec.type === 'button' ? 'center' : 'left';
  }
  if (spec.type === 'panel' || spec.type === 'button' || spec.type === 'bar') {
    out.bg = color(spec.bg, base.bg);
    out.border = typeof spec.border === 'string' && spec.border === '' ? '' : color(spec.border, base.border);
    out.radius = clamp(num(spec.radius, base.radius), 0, 100);
  }
  if (spec.type === 'button') out.bgFocus = color(spec.bgFocus, base.bgFocus);
  if (spec.type === 'bar') {
    out.value = typeof spec.value === 'string' && PATH.test(spec.value) ? spec.value : base.value;
    out.max = typeof spec.max === 'string' && PATH.test(spec.max) ? spec.max : clamp(num(spec.max, base.max), 0.001, 1e9);
    out.color = color(spec.color, base.color);
    out.lowColor = color(spec.lowColor, base.lowColor);
  }
  if (spec.type === 'image') out.sprite = typeof spec.sprite === 'string' && /^[\w-]{0,32}$/.test(spec.sprite) ? spec.sprite : '';
  return out;
}

/**
 * Make a whole screen safe (at most 60 widgets).
 * @param {unknown} spec
 * @returns {{size?: [number, number], widgets: Widget[]}}
 */
export function cleanUi(spec) {
  const widgets = (Array.isArray(spec?.widgets) ? spec.widgets : []).map(cleanWidget).filter(Boolean).slice(0, UI_LIMITS.widgets);
  const out = { widgets };
  if (Array.isArray(spec?.size) && spec.size.length === 2 && spec.size.every((n) => Number.isFinite(n) && n >= 64 && n <= 4096)) out.size = [spec.size[0], spec.size[1]];
  return out;
}

const read = (game, path) => String(path).replace(/^!/, '').split('.').reduce((o, k) => (o == null ? undefined : o[k]), game);

/** Whether a widget shows: it has no condition, or the game's number or flag is set (or, with `!`, is not set). */
export function visible(widget, game) {
  if (!widget.showIf) return true;
  const set = Boolean(read(game ?? {}, widget.showIf));
  return widget.showIf.startsWith('!') ? !set : set;
}

/** The words a widget shows: `{score}` filled from the game, `@key` looked up in the language table. */
export function textOf(widget, game) {
  const raw = String(widget.text ?? '');
  if (raw.startsWith('@')) return word(raw.slice(1), game && typeof game === 'object' ? game : undefined);
  return raw.replace(/\{([A-Za-z_$][\w$.]*)\}/g, (all, path) => {
    const v = read(game ?? {}, path);
    return v === undefined ? all : typeof v === 'number' ? String(Math.round(v * 100) / 100) : String(v);
  });
}

/** Where a widget is on a screen of this size: the corner, edge or middle it is pinned to, then pushed in by x and y. */
export function placeOf(widget, size) {
  const a = widget.anchor ?? 'top-left';
  const col = a.includes('left') ? 'l' : a.includes('right') ? 'r' : 'c';
  const row = a.startsWith('top') ? 't' : a.startsWith('bottom') ? 'b' : 'c';
  const x = col === 'l' ? widget.x : col === 'r' ? size.width - widget.w - widget.x : (size.width - widget.w) / 2 + widget.x;
  const y = row === 't' ? widget.y : row === 'b' ? size.height - widget.h - widget.y : (size.height - widget.h) / 2 + widget.y;
  return { x, y, w: widget.w, h: widget.h };
}

/** The offsets that keep a widget where it is on screen when it is pinned to a different anchor (so changing the anchor does not make it jump). */
export function offsetsFor(widget, anchor, size) {
  const box = placeOf(widget, size);
  const moved = { ...widget, anchor, x: 0, y: 0 };
  const zero = placeOf(moved, size);
  const col = anchor.includes('left') ? 'l' : anchor.includes('right') ? 'r' : 'c';
  const row = anchor.startsWith('top') ? 't' : anchor.startsWith('bottom') ? 'b' : 'c';
  return { x: Math.round(col === 'r' ? zero.x - box.x : box.x - zero.x), y: Math.round(row === 'b' ? zero.y - box.y : box.y - zero.y) };
}

const sizeOf = (opts) => {
  const s = opts?.size ?? screen();
  return { width: s.width, height: s.height };
};

/** Every widget of a screen with the box it covers: `[{ widget, x, y, w, h }]`, in drawing order (the last is on top). */
export function layoutUi(spec, game, opts) {
  const size = sizeOf(opts);
  return (spec?.widgets ?? []).filter((w) => visible(w, game)).map((widget) => ({ widget, ...placeOf(widget, size) }));
}

function round(g, x, y, w, h, r) {
  g.beginPath();
  if (g.roundRect && r > 0) g.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2)); else g.rect(x, y, w, h);
}

function box(g, widget, b, fill) {
  if (getSetting('highContrast')) { fill = fill && '#000000'; widget = { ...widget, border: '#ffffff' }; }
  if (fill) { g.fillStyle = fill; round(g, b.x, b.y, b.w, b.h, widget.radius ?? 0); g.fill(); }
  if (widget.border) { g.strokeStyle = widget.border; g.lineWidth = 1.5; round(g, b.x + 0.5, b.y + 0.5, b.w - 1, b.h - 1, widget.radius ?? 0); g.stroke(); }
}

function words(g, widget, b, text) {
  g.fillStyle = getSetting('highContrast') ? '#ffffff' : widget.color;
  g.font = `${Math.round(widget.size * getSetting('textScale'))}px system-ui, sans-serif`;       // the player's text size applies
  g.textBaseline = 'middle';
  const align = widget.align ?? 'left';
  g.textAlign = align;
  const pad = widget.type === 'button' ? 6 : 0;
  g.fillText(text, align === 'left' ? b.x + pad : align === 'right' ? b.x + b.w - pad : b.x + b.w / 2, b.y + b.h / 2 + 1, Math.max(1, b.w - pad * 2));
}

/**
 * Draw a screen. It does not move with the camera. `opts.focus` is the id of the button that has the keyboard focus, `opts.art` the game's sprites (for pictures), and
 * `opts.size` the screen size (default: the game's).
 * @param {CanvasRenderingContext2D} g
 * @param {{widgets: Widget[]}} spec
 * @param {object} [game] the game's state, for numbers in text and bars
 * @param {{focus?: string | null, art?: object, size?: {width: number, height: number}}} [opts]
 */
export function drawUi(g, spec, game = {}, opts = {}) {
  g.save();
  g.globalAlpha = 1;
  for (const { widget, ...b } of layoutUi(spec, game, opts)) {
    switch (widget.type) {
      case 'panel': box(g, widget, b, widget.bg); break;
      case 'button': box(g, widget, b, opts.focus && opts.focus === widget.id ? widget.bgFocus : widget.bg); words(g, widget, b, textOf(widget, game)); break;
      case 'label': words(g, widget, b, textOf(widget, game)); break;
      case 'bar': {
        const max = typeof widget.max === 'string' ? Number(read(game, widget.max)) || 1 : widget.max;
        const v = clamp((Number(read(game, widget.value)) || 0) / (max || 1), 0, 1);
        box(g, widget, b, widget.bg);
        if (v > 0) { g.fillStyle = v < 0.25 ? widget.lowColor : widget.color; round(g, b.x + 1, b.y + 1, Math.max(0, (b.w - 2) * v), b.h - 2, widget.radius ?? 0); g.fill(); }
        break;
      }
      case 'image': {
        const sprite = opts.art?.[widget.sprite];
        if (sprite) drawSprite(g, sprite, 0, b.x, b.y, b.w, b.h);
        else { g.strokeStyle = '#5b6378'; g.setLineDash([4, 3]); g.strokeRect(b.x + 0.5, b.y + 0.5, b.w - 1, b.h - 1); g.setLineDash([]); }
        break;
      }
      default: break;
    }
  }
  g.restore();
}

/** The id of the top-most button under a point, or null. */
export function uiHit(spec, x, y, game, opts) {
  const hits = layoutUi(spec, game, opts).filter(({ widget, ...b }) => widget.type === 'button' && x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h);
  return hits.length ? hits[hits.length - 1].widget.id || null : null;
}

/** The ids of the buttons that show, in the order they are listed. */
export const uiButtons = (spec, game) => (spec?.widgets ?? []).filter((w) => w.type === 'button' && w.id && visible(w, game)).map((w) => w.id);

/** The button after (or before) the focused one, going round; with nothing focused it is the first (or last). */
export function uiNext(spec, focus, step = 1, game) {
  const ids = uiButtons(spec, game);
  if (!ids.length) return null;
  const at = ids.indexOf(focus);
  if (at < 0) return step > 0 ? ids[0] : ids[ids.length - 1];
  return ids[(at + step + ids.length) % ids.length];
}

/**
 * Say what is wrong with a screen, in plain words: two widgets with the same id, a button with no id, widgets off the screen, words that probably will not fit, a bar with
 * nothing to show.
 * @param {{widgets: Widget[]}} spec
 * @param {{width: number, height: number}} [size]
 * @returns {{id: string, kind: 'id' | 'button' | 'off' | 'fit' | 'bar', message: string}[]}
 */
export function uiProblems(spec, size = { width: 480, height: 320 }) {
  const out = [];
  const add = (id, kind, message) => out.push({ id, kind, message });
  const seen = new Set();
  for (const w of spec?.widgets ?? []) {
    const name = w.id || `(${w.type})`;
    if (w.id) { if (seen.has(w.id)) add(w.id, 'id', `Two widgets are called "${w.id}". A click would not know which one you mean.`); seen.add(w.id); }
    if (w.type === 'button' && !w.id) add(name, 'button', 'A button needs an id (a name such as play), so the game knows which button was pressed.');
    const b = placeOf(w, size);
    if (b.x < 0 || b.y < 0 || b.x + b.w > size.width || b.y + b.h > size.height) add(name, 'off', `${name} reaches outside the screen (${size.width} by ${size.height}).`);
    if ((w.type === 'label' || w.type === 'button') && w.text && !/[{@]/.test(w.text) && w.text.length * w.size * 0.55 > w.w) {
      add(name, 'fit', `The words of ${name} are probably wider than the widget. Make it wider or the text smaller.`);
    }
    if (w.type === 'bar' && !w.value) add(name, 'bar', `The bar ${name} has no number to show.`);
  }
  return out;
}
