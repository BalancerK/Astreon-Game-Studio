import { Widget } from './widget.js';
import { arrange } from './layout.js';
import { darkTheme } from './theme.js';

const BLOCK = { block: true }; // what a hit test returns for "inside a modal screen's backdrop"
const ENTER = new Set(['Enter', 'NumpadEnter', 'Space']);
const DIRS = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
const VEC = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

/**
 * @typedef {object} Painter What the UI draws with (see painter.js for ready-made ones). Sizes and positions are in screen pixels.
 * @property {(x: number, y: number, w: number, h: number, color: number, radius: number) => void} rect
 * @property {(text: string, x: number, y: number, o: {size: number, color: number, align: string, maxWidth?: number, shadow?: boolean}) => void} text  `y` is the top of the first line
 * @property {(text: string, o: {size: number, maxWidth?: number}) => {width: number, height: number}} measure
 */

/**
 * Immediate-feeling, retained-mode UI: build a tree of widgets once, change their state when something happens, and call
 * `update(dt)` and `draw()` every frame. Screens (menus, dialogs) stack on top of the game; a `hud` layer holds permanent widgets.
 *
 * Input comes from `pointerDown/Move/Up`, `wheel`, `key`, `text` and the gamepad-style `navigate / activate / cancel`; every one
 * returns whether the UI used it, so the game can ignore what the UI took. `attachDom` wires all this to a page.
 */
export class Ui {
  /**
   * @param {object} o
   * @param {Painter} o.painter
   * @param {import('./theme.js').Theme} [o.theme]
   * @param {number} [o.width] Viewport in CSS pixels.
   * @param {number} [o.height]
   * @param {number} [o.scale] UI zoom: 1.25 makes everything a quarter bigger (touch screens).
   */
  constructor({ painter, theme = darkTheme, width = 1280, height = 720, scale = 1 } = {}) {
    this.painter = painter;
    this.theme = theme;
    this.time = 0;
    this.scale = scale;
    this.width = width; this.height = height;
    this.insets = { top: 0, right: 0, bottom: 0, left: 0 };
    /** Permanent widgets (health bars, minimaps, a menu button); add children with an `anchor`. */
    this.hud = new Widget({ direction: 'stack' });
    this.hud.ui = this;
    /** @type {{root: Widget, widget: Widget, modal: boolean, dim: boolean, dismissable: boolean, dismissOnBackdrop: boolean, onClose?: Function, onCancel?: Function, restoreFocus: Widget | null}[]} */
    this.screens = [];
    /** @type {Widget | null} */ this.focus = null;
    /** Show the focus ring (keyboard / gamepad in use) or hide it (mouse / touch). */
    this.focusVisible = false;
    this.hover = null; this.captured = null; this.capturedId = null;
    this.lineHeights = new Map();
    /** While true the UI lets keys and pointer events through untouched (the game is waiting for "press a key to bind"). */
    this.captureKeys = false;
    /** Set by whoever turned `captureKeys` on: called when a pointer press should end the capture. */
    this.cancelCapture = null;
    /** Called with true when the first screen opens and false when the last closes (pause the game, swap input contexts). */
    this.onActiveChange = null;
    /** Called with the focused TextInput, or null (show / hide a soft keyboard). */
    this.onTextTarget = null;
    /** Called with the newly focused widget (or null) and the one that had focus, whenever focus moves. */
    this.onFocusChange = null;
    /** How much bigger than normal text is drawn (1.5 for players who need large print). Set with `setTextScale`. */
    this.textScale = 1;
    /** Players who ask for less movement: widgets that animate (a blinking caret) hold still. `attachAccessibility` sets it from the system setting. */
    this.reducedMotion = false;
    /** Called with `(text, assertive)` when something should be spoken (see `announce`). */
    this.onAnnounce = null;
    /** @type {{text: string, assertive: boolean}[]} The most recent announcements (the last 20), for a front end that has no `onAnnounce`. */
    this.announcements = [];
  }

  /** Draw all text this much bigger (and lay the screens out again to fit it). 1 is normal; 1.25, 1.5 and 2 are common choices. */
  setTextScale(k) {
    k = Math.max(0.5, Math.min(3, k));
    if (k === this.textScale) return;
    this.textScale = k;
    this.lineHeights.clear();
    this.hud.dirty = true;
    for (const sc of this.screens) sc.root.dirty = true;
  }

  /** Say something to players who cannot see the screen (a screen reader, or whatever `onAnnounce` speaks with). `assertive` interrupts what is being said (use it for danger, not for news). */
  announce(text, { assertive = false } = {}) {
    if (!text) return;
    this.announcements.push({ text: String(text), assertive });
    if (this.announcements.length > 20) this.announcements.shift();
    this.onAnnounce?.(String(text), assertive);
  }

  // ---------- size ----------
  /** @param {number} width CSS pixels @param {number} height @param {number} [scale] @param {{top?: number, right?: number, bottom?: number, left?: number}} [insets] safe area (notches) */
  setViewport(width, height, scale = this.scale, insets = this.insets) {
    this.width = width; this.height = height; this.scale = scale;
    this.insets = { top: 0, right: 0, bottom: 0, left: 0, ...insets };
    this.lineHeights.clear();
    this.hud.dirty = true;
    for (const s of this.screens) s.root.dirty = true;
  }
  get logicalWidth() { return this.width / this.scale; }
  get logicalHeight() { return this.height / this.scale; }

  // ---------- screens ----------
  /** True while any screen is open. */
  get isOpen() { return this.screens.length > 0; }
  /** True while a modal screen is open: the game should not react to input. */
  get isModal() { return this.screens.some((s) => s.modal); }

  /**
   * Open a screen on top of everything.
   * @param {Widget} widget Its `anchor` style places it ('center' by default).
   * @param {object} [o]
   * @param {boolean} [o.modal] Blocks input to everything below (default true).
   * @param {boolean} [o.dim] Darken what is behind (default true when modal).
   * @param {boolean} [o.dismissable] Escape / B / cancel closes it (default true).
   * @param {boolean} [o.dismissOnBackdrop] A click outside the screen closes it.
   * @param {() => (boolean | void)} [o.onCancel] Called before a dismissal; return false to keep the screen open.
   * @param {() => void} [o.onClose]
   * @param {Widget} [o.focus] Initially focused widget (default: the first focusable one).
   * @returns {{close: () => void, widget: Widget}}
   */
  push(widget, { modal = true, dim = modal, dismissable = true, dismissOnBackdrop = false, onCancel, onClose, focus } = {}) {
    const root = new Widget({ direction: 'stack' });
    root.ui = this;
    widget.style.anchor ??= 'center';
    root.add(widget);
    const entry = { root, widget, modal, dim, dismissable, dismissOnBackdrop, onCancel, onClose, restoreFocus: this.focus };
    const wasOpen = this.isOpen;
    this.screens.push(entry);
    this.#clearPointer();
    this.layout();
    this.setFocus(focus ?? this.#focusables(root)[0] ?? null);
    if (!wasOpen) this.onActiveChange?.(true);
    return { widget, close: () => this.close(widget) };
  }

  /** Close the top screen (or the one holding `widget`). */
  close(widget) {
    const i = widget ? this.screens.findIndex((s) => s.widget === widget || s.root === widget) : this.screens.length - 1;
    if (i < 0) return;
    const [entry] = this.screens.splice(i, 1);
    this.#clearPointer();
    if (this.focus && !this.focus.shown) this.setFocus(null);
    const restore = i === this.screens.length ? entry.restoreFocus : null; // it was on top
    if (restore?.shown && restore.parent) this.setFocus(restore);
    entry.onClose?.();
    if (!this.isOpen) this.onActiveChange?.(false);
  }
  closeAll() { while (this.isOpen) this.close(); }

  #clearPointer() {
    if (this.hover) this.hover.hovered = false;
    if (this.captured) this.captured.pressed = false;
    this.hover = this.captured = null;
  }

  // ---------- frame ----------
  /** Advance time and lay out whatever changed. */
  update(dt) {
    this.time += dt;
    this.layout();
  }

  layout() {
    const lw = this.logicalWidth - (this.insets.left + this.insets.right) / this.scale, lh = this.logicalHeight - (this.insets.top + this.insets.bottom) / this.scale;
    const x = this.insets.left / this.scale, y = this.insets.top / this.scale;
    for (const root of [this.hud, ...this.screens.map((s) => s.root)]) {
      if (!root.dirty) continue;
      root.dirty = false;
      arrange(this, root, x, y, lw, lh);
    }
  }

  /** Draw everything into the painter. */
  draw() {
    this.layout();
    this.painter.begin?.();
    this.hud.draw(this);
    for (const s of this.screens) {
      if (s.dim) this.fill(0, 0, this.logicalWidth, this.logicalHeight, this.theme.colors.dim);
      s.root.draw(this);
    }
    this.painter.end?.();
  }

  // ---------- drawing helpers (logical pixels in, screen pixels out) ----------
  fill(x, y, w, h, color, radius = 0) {
    const s = this.scale, l = Math.round(x * s), t = Math.round(y * s), r = Math.round((x + w) * s), b = Math.round((y + h) * s);
    if (r > l && b > t && (color >>> 24) > 0) this.painter.rect(l, t, r - l, b - t, color, Math.min(radius * s, (r - l) / 2, (b - t) / 2));
  }
  /** An outline drawn inside the box. */
  stroke(x, y, w, h, color, thickness = 1) {
    this.fill(x, y, w, thickness, color); this.fill(x, y + h - thickness, w, thickness, color);
    this.fill(x, y + thickness, thickness, h - thickness * 2, color); this.fill(x + w - thickness, y + thickness, thickness, h - thickness * 2, color);
  }
  /** Text with its top-left (or top-centre / top-right, per `align`) at (x, y). */
  text(str, x, y, { size = this.theme.text.size, color = this.theme.colors.text, align = 'left', maxWidth, shadow = false } = {}) {
    if (!str) return;
    const s = this.scale;
    this.painter.text(str, x * s, y * s, { size: size * s * this.textScale, color, align, maxWidth: maxWidth === undefined ? undefined : maxWidth * s, shadow });
  }
  /** Text vertically centred on `cy`; horizontally centred on `cx` unless `align` says `cx` is the left or right edge. */
  textCentered(str, cx, cy, o = {}) {
    if (!str) return;
    const m = this.measureText(str, o);
    this.text(str, cx, cy - m.height / 2, { align: 'center', ...o });
  }
  measureText(str, { size = this.theme.text.size, maxWidth = Infinity } = {}) {
    const s = this.scale, m = this.painter.measure(String(str), { size: size * s * this.textScale, maxWidth: maxWidth * s });
    return { width: m.width / s, height: m.height / s };
  }
  lineHeight(size = this.theme.text.size) {
    let h = this.lineHeights.get(size);
    if (h === undefined) { h = this.measureText('Mg', { size }).height; this.lineHeights.set(size, h); }
    return h;
  }
  focusRing(w) {
    if (w.focused && this.focusVisible) this.stroke(w.x - 2, w.y - 2, w.w + 4, w.h + 4, this.theme.colors.focus, this.theme.focusWidth);
  }

  // ---------- focus ----------
  setFocus(w) {
    if (w === this.focus) return;
    const old = this.focus;
    if (old) { old.focused = false; old.onFocus(this, false); }
    this.focus = w;
    if (w) { w.focused = true; w.onFocus(this, true); }
    if (!!old?.isText || !!w?.isText) this.onTextTarget?.(w?.isText ? w : null);
    this.onFocusChange?.(w, old);
  }
  /** Tell the UI which kind of device the player is using: keyboard and gamepad show the focus ring. */
  noteDevice(device) { this.focusVisible = device === 'keyboard' || device === 'gamepad'; }
  get textTarget() { return this.focus?.isText ? this.focus : null; }

  /** Focusable, shown, enabled widgets under `root` in tree order. */
  #focusables(root) {
    const out = [];
    root.walk((w) => {
      if (!w.visible) return false;
      if (w.focusable && w.enabled) out.push(w);
    });
    return out;
  }
  /** The part of the tree that keyboard / gamepad navigation works on: the top modal screen, else everything. */
  #navRoots() {
    for (let i = this.screens.length - 1; i >= 0; i--) if (this.screens[i].modal) return this.screens.slice(i).map((s) => s.root);
    return [this.hud, ...this.screens.map((s) => s.root)];
  }
  #navigables() { return this.#navRoots().flatMap((r) => this.#focusables(r)); }

  moveFocus(step) {
    const list = this.#navigables();
    if (list.length === 0) return false;
    const i = list.indexOf(this.focus);
    this.setFocus(list[i < 0 ? (step > 0 ? 0 : list.length - 1) : (i + step + list.length) % list.length]);
    return true;
  }

  // ---------- keyboard / gamepad style input ----------
  /** Move focus (or adjust the focused widget) in a direction: 'up' | 'down' | 'left' | 'right'. Returns true if anything happened. */
  navigate(dir) {
    const f = this.focus;
    if (f?.shown && f.enabled && f.navigate(this, dir)) return true;
    const list = this.#navigables();
    if (list.length === 0) return false;
    if (!f || !f.shown) { this.setFocus(list[0]); return true; }
    const [dx, dy] = VEC[dir], cx = f.x + f.w / 2, cy = f.y + f.h / 2;
    let best = null, bestScore = Infinity;
    for (const w of list) {
      if (w === f) continue;
      const px = w.x + w.w / 2 - cx, py = w.y + w.h / 2 - cy;
      const along = px * dx + py * dy;
      if (along <= 1) continue;
      const across = Math.abs(px * dy - py * dx);
      const score = along + across * 2.5;
      if (score < bestScore) { bestScore = score; best = w; }
    }
    if (best) { this.setFocus(best); return true; }
    return this.isModal; // nowhere to go, but the screen still owns the input
  }

  /** Enter / Space / gamepad A on the focused widget. */
  activate() {
    const f = this.focus;
    if (!f?.shown) { return this.isOpen && this.moveFocus(1); }
    if (!f.enabled) return true;
    f.activate(this);
    return true;
  }

  /** Escape / gamepad B: close the top screen, if it may be dismissed. */
  cancel() {
    const s = this.screens[this.screens.length - 1];
    if (!s) return false;
    if (s.dismissable && s.onCancel?.() !== false) this.close(s.widget);
    return true;
  }

  /**
   * A key press (a `KeyboardEvent.code`). Returns true if the UI used it. While a modal screen is open the UI keeps all keys.
   * @param {string} code
   * @param {{shift?: boolean, ctrl?: boolean, alt?: boolean}} [mods]
   */
  key(code, mods = {}) {
    if (this.captureKeys || (!this.isOpen && !this.focus)) return false;
    this.focusVisible = true;
    const f = this.focus;
    if (f?.shown && f.enabled && f.key(this, code, mods)) return true;
    if (code === 'Tab') return this.moveFocus(mods.shift ? -1 : 1) || this.isModal;
    if (DIRS[code]) return this.navigate(DIRS[code]) || this.isModal;
    if (f?.isText) return this.isModal; // typing keys belong to the text field (they arrive through text())
    if (ENTER.has(code)) return this.activate() || this.isModal;
    if (code === 'Escape') return this.cancel();
    return this.isModal;
  }

  /** Typed text for the focused text field. */
  insertText(str) {
    const f = this.focus;
    if (!f?.isText || !f.enabled) return false;
    f.insert(str);
    return true;
  }

  // ---------- pointer ----------
  #hitTest(w, x, y) {
    if (!w.visible || !w.contains(x, y)) return null;
    for (let i = w.children.length - 1; i >= 0; i--) { const h = this.#hitTest(w.children[i], x, y); if (h) return h; }
    return w.interactive || w.style.background ? w : null;
  }
  #hit(x, y) {
    for (let i = this.screens.length - 1; i >= 0; i--) {
      const h = this.#hitTest(this.screens[i].root, x, y);
      if (h) return h;
      if (this.screens[i].modal) return BLOCK;
    }
    return this.#hitTest(this.hud, x, y);
  }

  /** Would a pointer at this CSS-pixel position land on the UI (so the game should leave it alone)? */
  wantsPointer(x, y) { return this.#hit(x / this.scale, y / this.scale) !== null; }

  /** @returns {boolean} true if the UI used it */
  pointerDown(x, y, id = 0, type = 'mouse') {
    x /= this.scale; y /= this.scale;
    if (this.captureKeys) this.cancelCapture?.(); // a click ends "press a key to bind"
    if (this.captured) return true; // a second finger while one is down
    this.focusVisible = false;
    const h = this.#hit(x, y);
    if (!h) { if (this.focus?.isText) this.setFocus(null); return false; }
    if (h === BLOCK) {
      const s = this.screens[this.screens.length - 1];
      if (s?.dismissOnBackdrop && s.dismissable) this.close(s.widget);
      else if (this.focus?.isText) this.setFocus(null);
      return true;
    }
    if (!h.interactive || !h.enabled) { if (this.focus?.isText) this.setFocus(null); return true; }
    this.captured = h; this.capturedId = id; this.pointerType = type;
    h.pressed = true;
    if (h.focusable) this.setFocus(h); else if (this.focus?.isText) this.setFocus(null);
    h.pointerDown(this, x, y);
    return true;
  }

  pointerMove(x, y, id = 0) {
    x /= this.scale; y /= this.scale;
    if (this.captured) {
      if (id === this.capturedId) this.captured.pointerMove(this, x, y);
      return true;
    }
    const h = this.#hit(x, y);
    const target = h && h !== BLOCK && h.interactive ? h : null;
    if (target !== this.hover) {
      if (this.hover) this.hover.hovered = false;
      this.hover = target;
      if (target) target.hovered = true;
    }
    target?.pointerMove(this, x, y);
    return h !== null;
  }

  pointerUp(x, y, id = 0) {
    x /= this.scale; y /= this.scale;
    const w = this.captured;
    if (!w || id !== this.capturedId) return false;
    this.captured = null;
    w.pressed = false;
    w.pointerUp(this, x, y, w.contains(x, y));
    if (this.pointerType === 'touch' || this.pointerType === 'pen') { w.hovered = false; if (this.hover === w) this.hover = null; }
    return true;
  }

  pointerCancel(id = 0) {
    const w = this.captured;
    if (!w || id !== this.capturedId) return;
    this.captured = null;
    w.pressed = false;
    w.pointerUp(this, -1e9, -1e9, false);
  }

  /** The wheel turned at a position; the widget under it (or a parent) may use it. */
  wheel(x, y, dy) {
    x /= this.scale; y /= this.scale;
    const h = this.#hit(x, y);
    if (!h) return false;
    for (let w = h === BLOCK ? null : h; w; w = w.parent) if (w.wheel(this, dy)) return true;
    return true;
  }
}
