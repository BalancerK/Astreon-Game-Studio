/**
 * On-screen touch controls: virtual sticks, buttons and look areas. The geometry and the finger tracking are plain code (testable
 * without a browser); `attachTouch` in devices.js connects them to pointer events, and `createTouchOverlay` draws them.
 *
 * A layout is a function of the screen size, so it adapts to rotation and resizing:
 *
 *   (w, h) => [
 *     { type: 'stick', id: 'move', region: { x: 0, y: h * 0.3, w: w * 0.45, h: h * 0.7 }, radius: 70, mode: 'floating' },
 *     { type: 'look', id: 'look', region: { x: w * 0.45, y: 0, w: w * 0.55, h } },
 *     { type: 'button', id: 'fire', cx: w - 110, cy: h - 120, r: 55, label: 'FIRE' },
 *   ]
 *
 * Buttons win over sticks, which win over look areas where they overlap. Each finger drives one control until it lifts.
 */

/**
 * @typedef {{type: 'stick', id: string, region: {x: number, y: number, w: number, h: number}, radius?: number, mode?: 'floating' | 'fixed', label?: string}
 *   | {type: 'look', id: string, region: {x: number, y: number, w: number, h: number}}
 *   | {type: 'button', id: string, cx: number, cy: number, r: number, label?: string}} TouchControl
 */

const inRect = (r, x, y) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;

/** A ready-made layout for a first-person game: a floating stick on the left, drag-to-look on the right, buttons fire / jump / run. */
export function shooterTouchLayout(w, h) {
  const unit = Math.max(48, Math.min(w, h) * 0.11);
  return [
    { type: 'look', id: 'look', region: { x: w * 0.4, y: 0, w: w * 0.6, h } },
    { type: 'stick', id: 'move', region: { x: 0, y: h * 0.25, w: w * 0.4, h: h * 0.75 }, radius: unit * 1.4, mode: 'floating' },
    { type: 'button', id: 'fire', cx: w - unit * 1.6, cy: h - unit * 2.4, r: unit * 0.95, label: 'FIRE' },
    { type: 'button', id: 'jump', cx: w - unit * 3.3, cy: h - unit * 1.3, r: unit * 0.8, label: 'JUMP' },
    { type: 'button', id: 'run', cx: w - unit * 0.9, cy: h - unit * 4.3, r: unit * 0.65, label: 'RUN' },
  ];
}

/**
 * Tracks fingers against a layout and reports to an InputCore (`touchStick`, `touchButton`, `touchLook`).
 */
export class TouchController {
  /**
   * @param {import('./core.js').InputCore} core
   * @param {(w: number, h: number) => TouchControl[]} layout
   */
  constructor(core, layout = shooterTouchLayout) {
    this.core = core;
    this.layoutFn = layout;
    this.width = 0; this.height = 0;
    /** @type {TouchControl[]} */
    this.controls = [];
    /** @type {Map<number, {control: TouchControl, last: {x: number, y: number}, origin?: {x: number, y: number}}>} */
    this.fingers = new Map();
    /** @type {(() => void) | null} */
    this.onChange = null;
  }

  /** Lay the controls out for a screen size (call on resize and rotation). Fingers already down keep their control. */
  resize(w, h) {
    this.width = w; this.height = h;
    this.controls = this.layoutFn(w, h);
    this.onChange?.();
  }

  setLayout(layout) { this.layoutFn = layout; if (this.width) this.resize(this.width, this.height); }

  #hit(x, y) {
    let best = null;
    for (const c of this.controls) {
      const inside = c.type === 'button' ? (x - c.cx) ** 2 + (y - c.cy) ** 2 <= c.r * c.r : inRect(c.region, x, y);
      if (!inside) continue;
      const rank = c.type === 'button' ? 0 : c.type === 'stick' ? 1 : 2;
      if (!best || rank < best.rank) best = { c, rank };
    }
    return best?.c ?? null;
  }

  /** A finger touched the screen at (x, y) (pixels from the top left). @returns {boolean} whether it landed on a control */
  pointerDown(id, x, y) {
    if (this.fingers.has(id)) this.pointerUp(id);
    const c = this.#hit(x, y);
    if (!c) return false;
    // one finger per control: a second finger on a taken stick or look area does nothing
    for (const f of this.fingers.values()) if (f.control.id === c.id && c.type !== 'button') return false;
    const finger = { control: c, last: { x, y } };
    if (c.type === 'stick') {
      finger.origin = c.mode === 'fixed' ? { x: c.region.x + c.region.w / 2, y: c.region.y + c.region.h / 2 } : { x, y };
      this.fingers.set(id, finger);
      this.#moveStick(finger, x, y);
    } else if (c.type === 'button') {
      this.fingers.set(id, finger);
      this.core.touchButton(c.id, true);
    } else this.fingers.set(id, finger);
    this.onChange?.();
    return true;
  }

  #moveStick(f, x, y) {
    const c = f.control, radius = c.radius ?? 70;
    let dx = (x - f.origin.x) / radius, dy = (f.origin.y - y) / radius; // up the screen is +y
    const len = Math.hypot(dx, dy);
    if (len > 1) { dx /= len; dy /= len; }
    f.vector = { x: dx, y: dy };
    this.core.touchStick(c.id, dx, dy, true);
  }

  pointerMove(id, x, y) {
    const f = this.fingers.get(id);
    if (!f) return;
    if (f.control.type === 'stick') this.#moveStick(f, x, y);
    else if (f.control.type === 'look') this.core.touchLook(f.control.id, x - f.last.x, y - f.last.y);
    f.last.x = x; f.last.y = y;
    this.onChange?.();
  }

  pointerUp(id) {
    const f = this.fingers.get(id);
    if (!f) return;
    this.fingers.delete(id);
    if (f.control.type === 'stick') this.core.touchStick(f.control.id, 0, 0, false);
    else if (f.control.type === 'button') this.core.touchButton(f.control.id, false);
    this.onChange?.();
  }

  /** Lift every finger (the page lost focus). */
  cancelAll() { for (const id of [...this.fingers.keys()]) this.pointerUp(id); }

  /** What to draw: for each control its geometry and state. */
  visuals() {
    return this.controls.map((c) => {
      const finger = [...this.fingers.values()].find((f) => f.control.id === c.id);
      if (c.type === 'button') return { ...c, down: !!finger };
      if (c.type === 'stick') {
        const radius = c.radius ?? 70, fixed = c.mode === 'fixed';
        const origin = finger?.origin ?? { x: c.region.x + c.region.w / 2, y: c.region.y + c.region.h / 2 };
        const v = finger?.vector ?? { x: 0, y: 0 };
        return { ...c, radius, active: !!finger, base: origin, knob: { x: origin.x + v.x * radius, y: origin.y - v.y * radius }, visible: fixed || !!finger };
      }
      return { ...c, active: !!finger };
    });
  }
}

/**
 * Draw the controls with plain DOM elements over a container (so it needs no renderer). Returns an object with `update()` (called
 * automatically on changes) and `destroy()`.
 * @param {HTMLElement} container Positioned element the controls are placed in (their coordinates are relative to it)
 * @param {TouchController} controller
 */
export function createTouchOverlay(container, controller) {
  const root = document.createElement('div');
  root.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:5;font:600 12px system-ui,sans-serif;color:#fff;';
  container.append(root);
  const els = new Map();
  const circle = (cx, cy, r, bg, border) => {
    const e = document.createElement('div');
    e.style.cssText = `position:absolute;border-radius:50%;box-sizing:border-box;border:2px solid ${border};background:${bg};display:flex;align-items:center;justify-content:center;width:${r * 2}px;height:${r * 2}px;left:${cx - r}px;top:${cy - r}px;`;
    return e;
  };
  const update = () => {
    for (const v of controller.visuals()) {
      let set = els.get(v.id);
      if (!set) { set = {}; els.set(v.id, set); }
      if (v.type === 'button') {
        if (!set.main) { set.main = circle(v.cx, v.cy, v.r, 'rgba(255,255,255,0.12)', 'rgba(255,255,255,0.45)'); set.main.textContent = v.label ?? ''; root.append(set.main); }
        Object.assign(set.main.style, { left: `${v.cx - v.r}px`, top: `${v.cy - v.r}px`, width: `${v.r * 2}px`, height: `${v.r * 2}px`, background: v.down ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.12)' });
      } else if (v.type === 'stick') {
        if (!set.main) {
          set.main = circle(0, 0, v.radius, 'rgba(255,255,255,0.08)', 'rgba(255,255,255,0.35)');
          set.knob = circle(0, 0, v.radius * 0.45, 'rgba(255,255,255,0.35)', 'rgba(255,255,255,0.6)');
          root.append(set.main, set.knob);
        }
        const show = v.visible ? 'flex' : 'none';
        Object.assign(set.main.style, { display: show, left: `${v.base.x - v.radius}px`, top: `${v.base.y - v.radius}px`, width: `${v.radius * 2}px`, height: `${v.radius * 2}px` });
        Object.assign(set.knob.style, { display: show, left: `${v.knob.x - v.radius * 0.45}px`, top: `${v.knob.y - v.radius * 0.45}px`, width: `${v.radius * 0.9}px`, height: `${v.radius * 0.9}px` });
      }
    }
  };
  controller.onChange = update;
  update();
  return { update, destroy() { controller.onChange = null; root.remove(); }, root };
}
