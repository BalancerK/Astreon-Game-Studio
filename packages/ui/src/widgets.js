import { Widget } from './widget.js';
import { mix, withAlpha } from './color.js';

const clamp01 = (v) => Math.min(1, Math.max(0, v));

/** Static text. Wraps to the width it is given unless `wrap: false`. Style: `size`, `color`, `align` ('left' | 'center' | 'right'). */
export class Label extends Widget {
  /** @param {string} text @param {object} [style] */
  constructor(text = '', style = {}) { super(style); this._text = String(text); }
  get text() { return this._text; }
  set text(t) { t = String(t); if (t !== this._text) { this._text = t; this.invalidate(); } }
  measure(ui, maxWidth) {
    const m = ui.measureText(this._text, { size: this.style.size, maxWidth: this.style.wrap === false ? Infinity : maxWidth });
    return { w: Math.ceil(m.width), h: Math.ceil(m.height) };
  }
  paint(ui) {
    const s = this.style, p = this.pad, align = s.align ?? 'left';
    const x = align === 'center' ? this.x + this.w / 2 : align === 'right' ? this.x + this.w - p.r : this.x + p.l;
    ui.text(this._text, x, this.y + p.t, { size: s.size, color: s.color ?? ui.theme.colors.text, align, maxWidth: s.wrap === false ? undefined : this.w - p.l - p.r, shadow: s.shadow });
  }
}

/** A clickable button. Variants: 'normal', 'primary' (the main choice), 'danger'. */
export class Button extends Widget {
  /** @param {string} text @param {{onClick?: (b: Button) => void, variant?: string} & object} [o] style keys work too */
  constructor(text = '', { onClick = null, variant = 'normal', ...style } = {}) {
    super({ padding: [0, 14], ...style });
    this._text = String(text);
    this.variant = variant;
    this.onClick = onClick;
    this.focusable = true;
    this.interactive = true;
  }
  get text() { return this._text; }
  set text(t) { t = String(t); if (t !== this._text) { this._text = t; this.invalidate(); } }
  measure(ui, maxWidth) {
    const m = ui.measureText(this._text, { size: this.style.size, maxWidth: Infinity });
    return { w: Math.ceil(m.width), h: Math.max(ui.theme.rowHeight, Math.ceil(m.height) + 10) };
  }
  paint(ui) {
    const c = ui.theme.colors, v = this.variant;
    const base = v === 'primary' ? c.accent : v === 'danger' ? c.danger : c.control;
    const hot = v === 'primary' ? c.accentHover : v === 'danger' ? c.dangerHover : c.controlHover;
    const down = v === 'primary' ? c.accentDown : v === 'danger' ? c.danger : c.controlDown;
    const fill = !this.enabled ? c.controlDisabled : this.pressed ? down : this.hovered || (this.focused && ui.focusVisible) ? hot : base;
    ui.fill(this.x, this.y, this.w, this.h, fill, ui.theme.radius);
    const on = v === 'primary' ? c.textOnAccent : v === 'danger' ? c.textOnDanger : c.text;
    ui.textCentered(this._text, this.x + this.w / 2, this.y + this.h / 2, { size: this.style.size, color: this.enabled ? on : c.textDim });
    ui.focusRing(this);
  }
  pointerUp(ui, x, y, inside) { if (inside && this.enabled) this.activate(ui); }
  activate(ui) { if (this.enabled) this.onClick?.(this); }
}

/** Shared look of a labelled row: the label on the left, the control in the rest. */
export class Control extends Widget {
  constructor(label, style = {}) { super(style); this._label = label; this.focusable = true; this.interactive = true; }
  get label() { return this._label; }
  set label(t) { if (t !== this._label) { this._label = t; this.invalidate(); } }
  /** Width of the label column. */
  labelWidth() { return this.style.labelWidth ?? Math.round(this.w * 0.42); }
  measure(ui, maxWidth) {
    const w = Number.isFinite(maxWidth) ? maxWidth : this.style.preferredWidth ?? 360;
    const lw = this.style.labelWidth ?? Math.round(w * 0.42);
    const m = this._label ? ui.measureText(this._label, { size: this.style.size, maxWidth: lw - 8 }) : { height: 0 };
    return { w, h: Math.max(ui.theme.rowHeight, Math.ceil(m.height) + 6) };
  }
  paintLabel(ui) {
    if (!this._label) return;
    const c = ui.theme.colors;
    ui.textCentered(this._label, this.x, this.y + this.h / 2, { size: this.style.size, color: this.enabled ? c.text : c.textDim, align: 'left', maxWidth: this.labelWidth() - 8 });
  }
  /** The box the control itself (not the label) occupies. */
  area() { const lw = this._label ? this.labelWidth() : 0; return { x: this.x + lw, y: this.y, w: this.w - lw, h: this.h }; }
}

/** An on / off switch. */
export class Toggle extends Control {
  /** @param {string} label @param {boolean} value @param {(value: boolean, t: Toggle) => void} [onChange] */
  constructor(label, value = false, onChange = null, style = {}) { super(label, style); this.value = !!value; this.onChange = onChange; }
  set(v) { v = !!v; if (v !== this.value) { this.value = v; this.onChange?.(v, this); } }
  paint(ui) {
    const c = ui.theme.colors, a = this.area();
    this.paintLabel(ui);
    const w = 44, h = 22, x = a.x, y = a.y + (a.h - h) / 2;
    ui.fill(x, y, w, h, !this.enabled ? c.controlDisabled : this.value ? c.accent : this.hovered ? c.controlHover : c.control, h / 2 > 3 ? 3 : h / 2);
    const k = h - 6;
    ui.fill(this.value ? x + w - k - 3 : x + 3, y + 3, k, k, this.enabled ? c.text : c.textDim, 2);
    ui.text(this.value ? 'On' : 'Off', x + w + 10, a.y + (a.h - ui.lineHeight(this.style.size)) / 2, { size: this.style.size, color: c.textDim });
    ui.focusRing(this);
  }
  pointerUp(ui, x, y, inside) { if (inside) this.activate(ui); }
  activate() { if (this.enabled) this.set(!this.value); }
  navigate(ui, dir) { if (!this.enabled || (dir !== 'left' && dir !== 'right')) return false; this.set(dir === 'right'); return true; }
}

/** Pick one of several options with the arrow keys, a stick, or by clicking the arrows. */
export class Choice extends Control {
  /** @param {string} label @param {(string | {value: any, label: string})[]} options @param {number} index @param {(value: any, index: number, c: Choice) => void} [onChange] */
  constructor(label, options, index = 0, onChange = null, style = {}) {
    super(label, style);
    this.options = options.map((o) => (typeof o === 'object' ? o : { value: o, label: String(o) }));
    this.index = Math.min(Math.max(0, index), this.options.length - 1);
    this.onChange = onChange;
    this.wrapAround = style.wrapAround ?? true;
  }
  get value() { return this.options[this.index]?.value; }
  select(i) {
    const n = this.options.length;
    if (n === 0) return;
    i = this.wrapAround ? ((i % n) + n) % n : Math.min(n - 1, Math.max(0, i));
    if (i !== this.index) { this.index = i; this.onChange?.(this.value, i, this); }
  }
  paint(ui) {
    const c = ui.theme.colors, a = this.area();
    this.paintLabel(ui);
    const box = 26;
    const arrow = (x, text, hot) => {
      ui.fill(x, a.y + (a.h - box) / 2, box, box, !this.enabled ? c.controlDisabled : hot ? c.controlHover : c.control, ui.theme.radius);
      ui.textCentered(text, x + box / 2, a.y + a.h / 2, { size: this.style.size, color: c.text });
    };
    arrow(a.x, '<', this.hoverZone === 'prev'); arrow(a.x + a.w - box, '>', this.hoverZone === 'next');
    ui.textCentered(this.options[this.index]?.label ?? '', a.x + a.w / 2, a.y + a.h / 2, { size: this.style.size, color: c.text, maxWidth: a.w - box * 2 - 8 });
    ui.focusRing(this);
  }
  zoneAt(x) { const a = this.area(); return x < a.x + a.w * 0.3 ? 'prev' : 'next'; }
  pointerMove(ui, x) { this.hoverZone = this.zoneAt(x); }
  pointerDown(ui, x) { this.hoverZone = this.zoneAt(x); }
  pointerUp(ui, x, y, inside) { if (inside && this.enabled) this.select(this.index + (this.zoneAt(x) === 'prev' ? -1 : 1)); }
  navigate(ui, dir) { if (!this.enabled || (dir !== 'left' && dir !== 'right')) return false; this.select(this.index + (dir === 'left' ? -1 : 1)); return true; }
  activate() { if (this.enabled) this.select(this.index + 1); }
}

/** A bar for health, loading, cooldowns. `value` is 0..1. */
export class ProgressBar extends Widget {
  constructor(value = 0, { label = '', color = null, ...style } = {}) { super({ height: 16, ...style }); this.value = value; this.label = label; this.color = color; }
  measure() { return { w: 120, h: 16 }; }
  paint(ui) {
    const c = ui.theme.colors, v = clamp01(this.value);
    ui.fill(this.x, this.y, this.w, this.h, c.track, ui.theme.radius);
    if (v > 0) ui.fill(this.x, this.y, Math.max(2, this.w * v), this.h, this.color ?? mix(c.danger, c.good, v), ui.theme.radius);
    if (this.label) ui.textCentered(this.label, this.x + this.w / 2, this.y + this.h / 2, { size: ui.theme.text.small, color: c.text, shadow: true });
  }
}

/** A thin dividing line. */
export class Separator extends Widget {
  constructor(style = {}) { super({ height: 1, ...style }); }
  paint(ui) { ui.fill(this.x, this.y, this.w, 1, withAlpha(ui.theme.colors.border, 0.9)); }
}
