/**
 * A node in the UI tree. Containers lay their children out (see layout.js); leaf widgets (label, button, ...) measure and draw
 * themselves. Everything is in logical pixels; the `Ui` applies the scale.
 *
 * Style (all optional):
 * - `direction`: 'column' (default), 'row' or 'stack' (children overlap, placed by `anchor`).
 * - `gap`, `padding` (number, [vertical, horizontal] or [top, right, bottom, left]).
 * - `align`: cross axis, 'stretch' (default), 'start', 'center', 'end'. `justify`: main axis, 'start' (default), 'center', 'end', 'between'.
 * - `width` / `height`: a number, or 'fill' (take the free space); `grow`: share of free space along the parent's main axis;
 *   `minWidth`, `minHeight`, `maxWidth`, `maxHeight`; `alignSelf` overrides the parent's `align` for this child.
 * - `anchor` (children of a 'stack'): 'fill' (default), 'center', 'top', 'bottom', 'left', 'right', 'top-left', 'top-right', 'bottom-left', 'bottom-right'; `offsetX`, `offsetY`.
 * - `background`, `border`: packed colours (or true for the theme's panel colours); `radius`.
 */
export class Widget {
  /** @param {object} [style] */
  constructor(style = {}) {
    this.style = style;
    /** @type {Widget[]} */
    this.children = [];
    /** @type {Widget | null} */
    this.parent = null;
    // computed by layout (logical pixels, relative to the screen)
    this.x = 0; this.y = 0; this.w = 0; this.h = 0;
    this.visible = true;
    this.enabled = true;
    /** Can take keyboard / gamepad focus. */
    this.focusable = false;
    /** Reacts to the pointer (a button, a slider, ...). */
    this.interactive = false;
    this.hovered = false;
    this.pressed = false;
    this.focused = false;
    this.id = style.id ?? null;
    /** Set on a root widget when something below it changed size or content. */
    this.dirty = true;
    /** The `Ui` this widget's tree belongs to (set on the root by the Ui). */
    this.ui = null;
  }

  // ---------- tree ----------
  /** Add children (arrays and null/false are accepted, so `add(cond && widget)` works). */
  add(...kids) {
    for (const k of kids.flat()) {
      if (!k) continue;
      k.parent?.remove(k);
      k.parent = this;
      this.children.push(k);
    }
    this.invalidate();
    return this;
  }

  remove(kid) {
    const i = this.children.indexOf(kid);
    if (i >= 0) { this.children.splice(i, 1); kid.parent = null; this.invalidate(); }
    return this;
  }

  clear() { for (const k of this.children) k.parent = null; this.children.length = 0; this.invalidate(); return this; }

  root() { let w = this; while (w.parent) w = w.parent; return w; }

  /** Ask for a new layout (a size-affecting change happened). */
  invalidate() { this.root().dirty = true; }

  /** Visit this widget and every descendant (parents first); return false from `fn` to skip the children. */
  walk(fn) {
    if (fn(this) === false) return;
    for (const k of this.children) k.walk(fn);
  }

  find(id) {
    let found = null;
    this.walk((w) => { if (found) return false; if (w.id === id) found = w; return !found; });
    return found;
  }

  /** True when this widget and all its ancestors are shown. */
  get shown() { for (let w = this; w; w = w.parent) if (!w.visible) return false; return true; }

  setVisible(v) { if (this.visible !== v) { this.visible = v; this.invalidate(); } return this; }
  setEnabled(v) { this.enabled = v; return this; }

  /** Padding as {t, r, b, l}. */
  get pad() {
    const p = this.style.padding ?? 0;
    if (typeof p === 'number') return { t: p, r: p, b: p, l: p };
    if (p.length === 2) return { t: p[0], r: p[1], b: p[0], l: p[1] };
    return { t: p[0], r: p[1], b: p[2], l: p[3] };
  }

  /** Is the point inside this widget's box? */
  contains(px, py) { return px >= this.x && px < this.x + this.w && py >= this.y && py < this.y + this.h; }

  // ---------- to override ----------
  /** Natural size of the content (without padding) when it may be at most `maxWidth` wide. Containers need not override. */
  measure(ui, maxWidth) { return { w: 0, h: 0 }; }

  /** Draw this widget's own content (the background is already drawn). */
  paint(ui) {}

  /** Draw background, own content, children. */
  draw(ui) {
    if (!this.visible) return;
    const s = this.style, c = ui.theme.colors;
    if (s.background) ui.fill(this.x, this.y, this.w, this.h, s.background === true ? c.panel : s.background, s.radius ?? ui.theme.radius);
    if (s.border) ui.stroke(this.x, this.y, this.w, this.h, s.border === true ? c.border : s.border, ui.theme.borderWidth);
    this.paint(ui);
    for (const k of this.children) k.draw(ui);
  }

  /** Pointer pressed on this widget (coordinates are logical). */
  pointerDown(ui, x, y) {}
  /** The pointer moved while this widget has it captured. */
  pointerMove(ui, x, y) {}
  /** Released; `inside` says whether it is still over the widget (a click). */
  pointerUp(ui, x, y, inside) {}
  /** The mouse wheel turned over this widget; return true if it was used. */
  wheel(ui, dy) { return false; }
  /** A direction key / stick push while focused; return true if used (a slider takes left and right). */
  navigate(ui, dir) { return false; }
  /** Enter / Space / gamepad A while focused. */
  activate(ui) {}
  /** A key while focused; return true if used. */
  key(ui, code, mods) { return false; }
  /** Called when focus arrives or leaves. */
  onFocus(ui, focused) {}
}

/** A container that draws a panel behind its children. */
export class Panel extends Widget {
  /** @param {object} [style] `background` defaults to the theme's panel colour, `border` to its border colour. */
  constructor(style = {}) {
    super({ padding: 12, gap: 8, background: true, border: true, ...style });
  }
}

/** Empty space that takes the remaining room (or a fixed size). */
export class Spacer extends Widget {
  constructor(sizeOrStyle = {}) { super(typeof sizeOrStyle === 'number' ? { height: sizeOrStyle, width: sizeOrStyle } : { grow: 1, ...sizeOrStyle }); }
}
