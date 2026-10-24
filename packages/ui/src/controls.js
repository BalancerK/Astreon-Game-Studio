import { Widget } from './widget.js';
import { Control } from './widgets.js';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** A value between `min` and `max`: drag it, or use left / right. */
export class Slider extends Control {
  /**
   * @param {string} label
   * @param {{min?: number, max?: number, step?: number, value?: number, format?: (v: number) => string, onChange?: (v: number, s: Slider) => void}} [o]
   */
  constructor(label, { min = 0, max = 1, step = 0.05, value = min, format = null, onChange = null, ...style } = {}) {
    super(label, style);
    this.min = min; this.max = max; this.step = step;
    this.format = format ?? ((v) => (step >= 1 ? String(Math.round(v)) : `${Math.round(((v - min) / (max - min)) * 100)}%`));
    this.onChange = onChange;
    this._value = clamp(value, min, max);
    this.dragging = false;
  }
  get value() { return this._value; }
  set value(v) { this.set(v, false); }
  /** Set the value (snapped to `step`); `notify` false changes it without calling `onChange`. */
  set(v, notify = true) {
    v = clamp(this.step > 0 ? this.min + Math.round((v - this.min) / this.step) * this.step : v, this.min, this.max);
    v = +v.toFixed(6);
    if (v === this._value) return;
    this._value = v;
    if (notify) this.onChange?.(v, this);
  }
  /** Where the track and its value text are. */
  track() {
    const a = this.area(), valueW = 54;
    return { x: a.x, y: a.y + a.h / 2 - 3, w: Math.max(10, a.w - valueW - 10), h: 6, valueX: a.x + a.w - valueW + 4, cy: a.y + a.h / 2, area: a };
  }
  paint(ui) {
    const c = ui.theme.colors, t = this.track();
    this.paintLabel(ui);
    const k = (this._value - this.min) / (this.max - this.min || 1);
    ui.fill(t.x, t.y, t.w, t.h, c.track, 3);
    ui.fill(t.x, t.y, t.w * k, t.h, this.enabled ? c.accent : c.controlDisabled, 3);
    const knob = this.dragging || this.hovered || (this.focused && ui.focusVisible) ? 18 : 16;
    ui.fill(t.x + t.w * k - knob / 2, t.cy - knob / 2, knob, knob, this.enabled ? c.text : c.textDim, 4);
    ui.text(this.format(this._value), t.valueX, t.cy - ui.lineHeight(this.style.size) / 2, { size: this.style.size, color: c.textDim });
    ui.focusRing(this);
  }
  fromPointer(x) { const t = this.track(); this.set(this.min + clamp((x - t.x) / t.w, 0, 1) * (this.max - this.min)); }
  pointerDown(ui, x) { if (this.enabled) { this.dragging = true; this.fromPointer(x); } }
  pointerMove(ui, x) { if (this.dragging) this.fromPointer(x); }
  pointerUp() { this.dragging = false; }
  wheel(ui, dy) { if (!this.enabled) return false; this.set(this._value - Math.sign(dy) * (this.step || (this.max - this.min) / 20)); return true; }
  navigate(ui, dir) {
    if (!this.enabled || (dir !== 'left' && dir !== 'right')) return false;
    this.set(this._value + (dir === 'right' ? 1 : -1) * (this.step || (this.max - this.min) / 20));
    return true;
  }
}

/**
 * A single line of editable text with a caret and selection. In a browser the page's own text field does the typing (so mobile
 * keyboards, IME, paste and accents work; see `attachDom`); the widget just shows the state and also accepts `ui.text()` / `ui.key()`
 * from tests and bots.
 */
export class TextInput extends Widget {
  /** @param {{value?: string, placeholder?: string, maxLength?: number, filter?: RegExp, password?: boolean, onChange?: (v: string) => void, onSubmit?: (v: string) => void}} [o] */
  constructor({ value = '', placeholder = '', maxLength = 200, filter = null, password = false, onChange = null, onSubmit = null, ...style } = {}) {
    super({ padding: [0, 8], ...style });
    this.placeholder = placeholder; this.maxLength = maxLength; this.filter = filter; this.password = password;
    this.onChange = onChange; this.onSubmit = onSubmit;
    this._value = ''; this.anchor = 0; this.caret = 0; this.first = 0;
    this.focusable = true; this.interactive = true; this.isText = true;
    this.set(value, false);
  }
  get value() { return this._value; }
  set value(v) { this.set(v, false); }
  /** Replace the text (and put the caret at the end, or at `caret`). */
  set(v, notify = true, caret = null, anchor = null) {
    v = String(v);
    if (this.filter) v = [...v].filter((ch) => this.filter.test(ch)).join('');
    if (v.length > this.maxLength) v = v.slice(0, this.maxLength);
    const changed = v !== this._value;
    this._value = v;
    this.caret = clamp(caret ?? v.length, 0, v.length);
    this.anchor = clamp(anchor ?? this.caret, 0, v.length);
    if (changed && notify) this.onChange?.(v, this);
  }
  /** Select a range (anchor and caret are character positions). */
  select(anchor, caret = anchor) { this.anchor = clamp(anchor, 0, this._value.length); this.caret = clamp(caret, 0, this._value.length); }
  get selection() { return this.anchor === this.caret ? '' : this._value.slice(Math.min(this.anchor, this.caret), Math.max(this.anchor, this.caret)); }
  /** Type text at the caret, replacing the selection. */
  insert(str) {
    const lo = Math.min(this.anchor, this.caret), hi = Math.max(this.anchor, this.caret);
    let add = this.filter ? [...String(str)].filter((ch) => this.filter.test(ch)).join('') : String(str).replace(/[\r\n]+/g, ' ');
    add = add.slice(0, Math.max(0, this.maxLength - (this._value.length - (hi - lo))));
    this.set(this._value.slice(0, lo) + add + this._value.slice(hi), true, lo + add.length);
  }
  measure(ui) { return { w: this.style.preferredWidth ?? 240, h: ui.theme.rowHeight }; }
  shown_(ui) { return this.password ? '•'.repeat(this._value.length) : this._value; }

  /** First and last visible character so the caret stays inside the box. */
  window(ui) {
    const text = this.shown_(ui), p = this.pad, avail = this.w - p.l - p.r - 2;
    const wd = (a, b) => ui.measureText(text.slice(a, b), { maxWidth: Infinity }).width;
    this.first = clamp(this.first, 0, text.length);
    if (this.caret < this.first) this.first = this.caret;
    while (this.first < this.caret && wd(this.first, this.caret) > avail) this.first++;
    let end = text.length;
    while (end > this.caret && wd(this.first, end) > avail) end--;
    return { text, first: this.first, end, wd };
  }

  paint(ui) {
    const c = ui.theme.colors, p = this.pad;
    ui.fill(this.x, this.y, this.w, this.h, this.enabled ? c.track : c.controlDisabled, ui.theme.radius);
    ui.stroke(this.x, this.y, this.w, this.h, this.focused ? c.accent : c.border, this.focused ? 2 : 1);
    const lh = ui.lineHeight(this.style.size), ty = this.y + (this.h - lh) / 2, left = this.x + p.l;
    if (this._value === '' && !this.focused) { ui.text(this.placeholder, left, ty, { size: this.style.size, color: c.textDim, maxWidth: this.w - p.l - p.r }); return; }
    const { text, first, end, wd } = this.window(ui);
    if (this.focused && this.anchor !== this.caret) {
      const lo = clamp(Math.min(this.anchor, this.caret), first, end), hi = clamp(Math.max(this.anchor, this.caret), first, end);
      ui.fill(left + wd(first, lo), ty - 1, wd(lo, hi), lh + 2, c.selection);
    }
    ui.text(text.slice(first, end), left, ty, { size: this.style.size, color: c.text });
    if (this.focused && (ui.reducedMotion || Math.floor(ui.time * 1.9) % 2 === 0)) ui.fill(left + wd(first, clamp(this.caret, first, end)), ty - 1, 1.5, lh + 2, c.text);
  }

  /** Character position nearest to x. */
  indexAt(ui, x) {
    const { text, first, end, wd } = this.window(ui), px = x - (this.x + this.pad.l);
    let best = first;
    for (let i = first; i <= end; i++) if (Math.abs(wd(first, i) - px) < Math.abs(wd(first, best) - px)) best = i;
    return best;
  }
  pointerDown(ui, x) { if (!this.enabled) return; this.caret = this.anchor = this.indexAt(ui, x); this.dragging = true; }
  pointerMove(ui, x) { if (this.dragging) this.caret = this.indexAt(ui, x); }
  pointerUp() { this.dragging = false; }
  onFocus(ui, focused) { if (focused) { this.first = 0; } else this.dragging = false; }

  key(ui, code, mods = {}) {
    const n = this._value.length, move = (to) => { this.caret = clamp(to, 0, n); if (!mods.shift) this.anchor = this.caret; return true; };
    const wordLeft = () => { let i = this.caret; while (i > 0 && this._value[i - 1] === ' ') i--; while (i > 0 && this._value[i - 1] !== ' ') i--; return i; };
    const wordRight = () => { let i = this.caret; while (i < n && this._value[i] === ' ') i++; while (i < n && this._value[i] !== ' ') i++; return i; };
    switch (code) {
      case 'ArrowLeft': return move(this.anchor !== this.caret && !mods.shift ? Math.min(this.anchor, this.caret) : mods.ctrl ? wordLeft() : this.caret - 1);
      case 'ArrowRight': return move(this.anchor !== this.caret && !mods.shift ? Math.max(this.anchor, this.caret) : mods.ctrl ? wordRight() : this.caret + 1);
      case 'Home': return move(0);
      case 'End': return move(n);
      case 'Backspace': case 'Delete': {
        if (this.anchor === this.caret) {
          if (code === 'Backspace') this.anchor = mods.ctrl ? wordLeft() : Math.max(0, this.caret - 1);
          else this.anchor = mods.ctrl ? wordRight() : Math.min(n, this.caret + 1);
        }
        this.insert('');
        return true;
      }
      case 'KeyA': if (mods.ctrl) { this.select(0, n); return true; } return false;
      case 'Enter': case 'NumpadEnter': this.onSubmit?.(this._value, this); return true;
      case 'Escape': ui.setFocus(null); return true;
      default: return false;
    }
  }
}

/** A list of rows to pick from (rooms, saves, servers). Scrolls by whole rows, so nothing is ever cut in half. */
export class ScrollList extends Widget {
  /**
   * @param {{items?: {text: string, detail?: string, value?: any}[], rows?: number, rowHeight?: number, empty?: string, onSelect?: (item: object, index: number) => void, onActivate?: (item: object, index: number) => void}} [o]
   */
  constructor({ items = [], rows = 6, rowHeight = 0, empty = 'Nothing here yet', onSelect = null, onActivate = null, ...style } = {}) {
    super(style);
    this.visibleRows = rows; this.fixedRowHeight = rowHeight; this.empty = empty;
    this.onSelect = onSelect; this.onActivate = onActivate;
    this.items = []; this.selected = -1; this.top = 0;
    this.focusable = true; this.interactive = true;
    this.setItems(items);
  }
  rowHeight(ui) { return this.fixedRowHeight || ui.theme.rowHeight; }
  setItems(items, keepSelection = true) {
    const prev = keepSelection ? this.items[this.selected]?.value : undefined;
    this.items = items;
    const again = prev === undefined ? -1 : items.findIndex((i) => i.value === prev);
    this.selected = again >= 0 ? again : (items.length ? Math.min(Math.max(this.selected, 0), items.length - 1) : -1);
    this.top = clamp(this.top, 0, Math.max(0, items.length - this.visibleRows));
    this.reveal();
  }
  get selectedItem() { return this.items[this.selected] ?? null; }
  measure(ui, maxWidth) { return { w: Number.isFinite(maxWidth) ? maxWidth : 300, h: this.visibleRows * this.rowHeight(ui) }; }
  reveal() {
    if (this.selected < 0) return;
    if (this.selected < this.top) this.top = this.selected;
    if (this.selected >= this.top + this.visibleRows) this.top = this.selected - this.visibleRows + 1;
  }
  select(i, notify = true) {
    i = clamp(i, 0, this.items.length - 1);
    if (this.items.length === 0 || i === this.selected) return;
    this.selected = i; this.reveal();
    if (notify) this.onSelect?.(this.items[i], i);
  }
  scrollBy(rows) { this.top = clamp(this.top + rows, 0, Math.max(0, this.items.length - this.visibleRows)); }
  paint(ui) {
    const c = ui.theme.colors, rh = this.rowHeight(ui);
    ui.fill(this.x, this.y, this.w, this.h, c.track, ui.theme.radius);
    if (this.items.length === 0) { ui.textCentered(this.empty, this.x + this.w / 2, this.y + this.h / 2, { size: this.style.size, color: c.textDim }); }
    const scrollbar = this.items.length > this.visibleRows ? 6 : 0;
    for (let r = 0; r < this.visibleRows; r++) {
      const i = this.top + r, it = this.items[i];
      if (!it) break;
      const y = this.y + r * rh;
      if (i === this.selected) ui.fill(this.x + 2, y + 1, this.w - 4 - scrollbar, rh - 2, this.focused && ui.focusVisible ? c.accent : c.controlHover, ui.theme.radius);
      else if (i === this.hoverRow) ui.fill(this.x + 2, y + 1, this.w - 4 - scrollbar, rh - 2, c.control, ui.theme.radius);
      const color = i === this.selected && this.focused && ui.focusVisible ? c.textOnAccent : c.text;
      ui.textCentered(it.text, this.x + 10, y + rh / 2, { size: this.style.size, color, align: 'left', maxWidth: this.w * 0.62 });
      if (it.detail) ui.textCentered(it.detail, this.x + this.w - 10 - scrollbar, y + rh / 2, { size: this.style.size, color: i === this.selected && this.focused && ui.focusVisible ? color : c.textDim, align: 'right' });
    }
    if (scrollbar) {
      const n = this.items.length, th = Math.max(16, this.h * (this.visibleRows / n));
      ui.fill(this.x + this.w - 6, this.y + 2 + (this.h - 4 - th) * (this.top / (n - this.visibleRows)), 4, th, c.border, 2);
    }
    ui.focusRing(this);
  }
  rowAt(ui, y) { const r = Math.floor((y - this.y) / this.rowHeight(ui)), i = this.top + r; return r >= 0 && r < this.visibleRows && i < this.items.length ? i : -1; }
  pointerDown(ui, x, y) { this.downY = y; this.downTop = this.top; this.moved = false; this.downRow = this.rowAt(ui, y); }
  pointerMove(ui, x, y) {
    this.hoverRow = this.rowAt(ui, y);
    if (this.downY === undefined) return;
    const dRows = Math.round((this.downY - y) / this.rowHeight(ui));
    if (Math.abs(this.downY - y) > 8) this.moved = true; // a drag scrolls (touch); it is not a click
    if (this.moved) this.top = clamp(this.downTop + dRows, 0, Math.max(0, this.items.length - this.visibleRows));
  }
  pointerUp(ui, x, y, inside) {
    const row = this.downRow; this.downY = undefined;
    if (this.moved || !inside || row < 0) return;
    if (row === this.selected && this.selectedAt !== undefined && ui.time - this.selectedAt < 0.5) this.activate(ui);
    else { this.select(row); this.selectedAt = ui.time; }
  }
  wheel(ui, dy) { if (this.items.length <= this.visibleRows) return false; this.scrollBy(Math.sign(dy)); return true; }
  navigate(ui, dir) {
    if (dir !== 'up' && dir !== 'down') return false;
    const to = this.selected + (dir === 'up' ? -1 : 1);
    if (to < 0 || to >= this.items.length) return false; // at the end: let focus move on
    this.select(to);
    return true;
  }
  activate() { const it = this.selectedItem; if (it) this.onActivate?.(it, this.selected); }
}
