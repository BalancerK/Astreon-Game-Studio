/**
 * Gestures from raw pointers: tap, double tap, long press, swipe, one- and two-finger pan, pinch and rotate. It works on plain numbers (an id, a position, a time in milliseconds), so a touch
 * screen, a pen, a mouse, a test and a replay all feed it the same way; `attachGestures` connects a page.
 *
 * One pointer: a short press without moving is a `tap` (a second one close in time and place is a tap with `count: 2`); held still it becomes a `longpress`; dragged it is a `pan`, and a
 * quick, long enough flick that ends the pan is also a `swipe`. Two pointers: a `pan` of their centre, a `pinch` (the scale of the distance between them) and a `rotate` (the turn of the line
 * between them). Putting a second finger down cancels a tap in progress.
 *
 * Gesture objects: `{type, x, y, ...}` where x and y are where it happened (the centre, for two fingers). `pan`, `pinch` and `rotate` carry a `phase` of `'start'`, `'move'` or `'end'`.
 * @typedef {{type: 'tap', x: number, y: number, count: number, pointerType: string} | {type: 'longpress', x: number, y: number, pointerType: string} | {type: 'swipe', x: number, y: number, direction: 'left' | 'right' | 'up' | 'down', dx: number, dy: number, distance: number, speed: number} | {type: 'pan', phase: string, x: number, y: number, dx: number, dy: number, totalX: number, totalY: number, velocityX: number, velocityY: number, pointers: number} | {type: 'pinch', phase: string, x: number, y: number, scale: number, delta: number} | {type: 'rotate', phase: string, x: number, y: number, angle: number, delta: number}} Gesture
 */
export class GestureRecognizer {
  /**
   * @param {object} [o]
   * @param {number} [o.tapMs] A press shorter than this, without moving, is a tap (250). @param {number} [o.tapSlop] How far (pixels) a finger may wander and still be a tap or a long press (10).
   * @param {number} [o.doubleTapMs] Longest gap between the two taps of a double tap (300). @param {number} [o.doubleTapSlop] How far apart they may be (30).
   * @param {number} [o.longPressMs] How long a finger held still becomes a long press (500).
   * @param {number} [o.swipeMinDistance] A flick shorter than this (pixels) is not a swipe (40). @param {number} [o.swipeMaxMs] A flick slower than this in total is not a swipe (500). @param {number} [o.swipeMinSpeed] Pixels per second at the end (250).
   * @param {number} [o.pinchSlop] How far the distance between two fingers must change (pixels) before a pinch starts (8). @param {number} [o.rotateSlop] How far the line between them must turn (radians) before a rotation starts (0.12).
   * @param {(g: Gesture) => void} [o.onGesture] Called for each gesture.
   */
  constructor({ tapMs = 250, tapSlop = 10, doubleTapMs = 300, doubleTapSlop = 30, longPressMs = 500, swipeMinDistance = 40, swipeMaxMs = 500, swipeMinSpeed = 250, pinchSlop = 8, rotateSlop = 0.12, onGesture = null } = {}) {
    Object.assign(this, { tapMs, tapSlop, doubleTapMs, doubleTapSlop, longPressMs, swipeMinDistance, swipeMaxMs, swipeMinSpeed, pinchSlop, rotateSlop, onGesture });
    /** @type {Map<number, {x: number, y: number, x0: number, y0: number, t0: number, t: number, type: string, vx: number, vy: number, moved: boolean}>} */
    this.pointers = new Map();
    this.lastTap = null;
    this.single = null;                                    // state of the one-finger gesture in progress
    this.multi = null;                                     // state of the two-finger gesture in progress
    this.listeners = new Map();
  }

  /** Listen for one kind of gesture (`'tap'`, `'swipe'`, ...), or `'*'` for all. Returns a function that stops listening. */
  on(type, fn) {
    const list = this.listeners.get(type) ?? []; list.push(fn); this.listeners.set(type, list);
    return () => { const l = this.listeners.get(type); const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); };
  }

  #emit(g) { this.onGesture?.(g); for (const fn of this.listeners.get(g.type) ?? []) fn(g); for (const fn of this.listeners.get('*') ?? []) fn(g); }

  /** A pointer went down. `type` is `'touch'`, `'pen'` or `'mouse'`. */
  pointerDown(id, x, y, t, type = 'touch') {
    this.pointers.set(id, { x, y, x0: x, y0: y, t0: t, t, type, vx: 0, vy: 0, moved: false });
    if (this.pointers.size === 1) this.single = { id, longFired: false, panning: false, totalX: 0, totalY: 0, cancelled: false };
    else if (this.pointers.size === 2) this.#beginMulti();
  }

  #beginMulti() {
    if (this.single) { if (this.single.panning) this.#pan('end', this.pointers.get(this.single.id), 1); this.single.cancelled = true; }
    const [a, b] = [...this.pointers.values()];
    const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
    this.multi = { d0: Math.hypot(b.x - a.x, b.y - a.y) || 1, a0: Math.atan2(b.y - a.y, b.x - a.x), cx, cy, startCx: cx, startCy: cy, pinching: false, rotating: false, panning: false, scale: 1, angle: 0, lastAngleRaw: Math.atan2(b.y - a.y, b.x - a.x), totalX: 0, totalY: 0, t: Math.max(a.t, b.t) };
  }

  #pan(phase, p, pointers, dx = 0, dy = 0) {
    const s = this.single;
    this.#emit({ type: 'pan', phase, x: p.x, y: p.y, dx, dy, totalX: s ? s.totalX : 0, totalY: s ? s.totalY : 0, velocityX: p.vx, velocityY: p.vy, pointers });
  }

  /** A pointer moved. */
  pointerMove(id, x, y, t) {
    const p = this.pointers.get(id); if (!p) return;
    const dx = x - p.x, dy = y - p.y, dt = t - p.t;
    if (dt > 0) { const k = Math.min(1, dt / 100); p.vx = p.vx * (1 - k) + (dx / dt * 1000) * k; p.vy = p.vy * (1 - k) + (dy / dt * 1000) * k; }   // pixels per second, smoothed over about 100 ms
    p.x = x; p.y = y; p.t = t;
    if (Math.hypot(x - p.x0, y - p.y0) > this.tapSlop) p.moved = true;
    if (this.multi && this.pointers.size === 2) return this.#moveMulti(t);
    const s = this.single;
    if (!s || s.cancelled || s.id !== id) return;
    if (!s.panning && p.moved && !s.longFired) { s.panning = true; this.#pan('start', p, 1); }
    if (s.panning) { s.totalX = x - p.x0; s.totalY = y - p.y0; this.#pan('move', p, 1, dx, dy); }
  }

  #moveMulti(t) {
    const m = this.multi, [a, b] = [...this.pointers.values()];
    const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2, d = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const raw = Math.atan2(b.y - a.y, b.x - a.x);
    let step = raw - m.lastAngleRaw; if (step > Math.PI) step -= 2 * Math.PI; else if (step < -Math.PI) step += 2 * Math.PI;    // unwrapped, so a turn can pass half a circle
    m.lastAngleRaw = raw; const prevAngle = m.angle; m.angle += step;
    const scale = d / m.d0;
    if (!m.pinching && Math.abs(d - m.d0) > this.pinchSlop) { m.pinching = true; m.scale = 1; this.#emit({ type: 'pinch', phase: 'start', x: cx, y: cy, scale: 1, delta: 1 }); }
    if (m.pinching) { const delta = scale / m.scale; m.scale = scale; this.#emit({ type: 'pinch', phase: 'move', x: cx, y: cy, scale, delta }); }
    if (!m.rotating && Math.abs(m.angle) > this.rotateSlop) { m.rotating = true; this.#emit({ type: 'rotate', phase: 'start', x: cx, y: cy, angle: m.angle, delta: m.angle - prevAngle }); }
    else if (m.rotating) this.#emit({ type: 'rotate', phase: 'move', x: cx, y: cy, angle: m.angle, delta: step });
    const dx = cx - m.cx, dy = cy - m.cy;
    if (dx !== 0 || dy !== 0) {
      m.totalX = cx - m.startCx; m.totalY = cy - m.startCy;
      if (!m.panning) { m.panning = true; this.#emit({ type: 'pan', phase: 'start', x: cx, y: cy, dx: 0, dy: 0, totalX: 0, totalY: 0, velocityX: 0, velocityY: 0, pointers: 2 }); }
      this.#emit({ type: 'pan', phase: 'move', x: cx, y: cy, dx, dy, totalX: m.totalX, totalY: m.totalY, velocityX: (a.vx + b.vx) / 2, velocityY: (a.vy + b.vy) / 2, pointers: 2 });
    }
    m.cx = cx; m.cy = cy; m.t = t;
  }

  /** A pointer lifted. */
  pointerUp(id, x, y, t) {
    const p = this.pointers.get(id); if (!p) return;
    if (x !== undefined) { p.x = x; p.y = y; }
    p.t = t;
    if (this.multi && this.pointers.size === 2) { this.#endMulti(); this.pointers.delete(id); this.single = null; return; }
    this.pointers.delete(id);
    const s = this.single;
    if (!s || s.id !== id) { if (this.pointers.size === 0) { this.single = null; this.multi = null; } return; }
    this.single = null;
    if (s.cancelled) return;
    const held = t - p.t0, moved = Math.hypot(p.x - p.x0, p.y - p.y0);
    if (s.panning) {
      this.#pan('end', p, 1, 0, 0);
      const speed = Math.hypot(p.vx, p.vy), ex = p.x - p.x0, ey = p.y - p.y0;
      if (moved >= this.swipeMinDistance && held <= this.swipeMaxMs && speed >= this.swipeMinSpeed) {
        const horizontal = Math.abs(ex) >= Math.abs(ey);
        this.#emit({ type: 'swipe', x: p.x, y: p.y, direction: horizontal ? (ex < 0 ? 'left' : 'right') : (ey < 0 ? 'up' : 'down'), dx: ex, dy: ey, distance: moved, speed });
      }
      return;
    }
    if (s.longFired || p.moved || held > this.tapMs) return;
    const prev = this.lastTap;
    if (prev && t - prev.t <= this.doubleTapMs && Math.hypot(p.x - prev.x, p.y - prev.y) <= this.doubleTapSlop) {
      this.lastTap = null;
      this.#emit({ type: 'tap', x: p.x, y: p.y, count: 2, pointerType: p.type });
    } else {
      this.lastTap = { x: p.x, y: p.y, t };
      this.#emit({ type: 'tap', x: p.x, y: p.y, count: 1, pointerType: p.type });
    }
  }

  #endMulti() {
    const m = this.multi, [a, b] = [...this.pointers.values()], cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
    if (m.pinching) this.#emit({ type: 'pinch', phase: 'end', x: cx, y: cy, scale: m.scale, delta: 1 });
    if (m.rotating) this.#emit({ type: 'rotate', phase: 'end', x: cx, y: cy, angle: m.angle, delta: 0 });
    if (m.panning) this.#emit({ type: 'pan', phase: 'end', x: cx, y: cy, dx: 0, dy: 0, totalX: m.totalX, totalY: m.totalY, velocityX: 0, velocityY: 0, pointers: 2 });
    this.multi = null;
  }

  /** The pointer was taken away (a call, the page lost focus): whatever was in progress ends without a tap or a swipe. */
  pointerCancel(id) {
    if (!this.pointers.has(id)) return;
    if (this.multi && this.pointers.size === 2) this.#endMulti();
    const s = this.single;
    if (s && s.id === id && s.panning) this.#pan('end', this.pointers.get(id), 1);
    this.pointers.delete(id);
    if (this.pointers.size === 0) { this.single = null; this.multi = null; } else if (s?.id === id) this.single = null;
  }

  /** Call with the current time (milliseconds) now and then (each frame, or from a timer): a finger held still for `longPressMs` becomes a long press. Returns the earliest time it needs calling again, or Infinity. */
  update(t) {
    const s = this.single;
    if (!s || s.cancelled || s.longFired || s.panning) return Infinity;
    const p = this.pointers.get(s.id);
    if (!p || p.moved) return Infinity;
    if (t - p.t0 >= this.longPressMs) { s.longFired = true; this.#emit({ type: 'longpress', x: p.x, y: p.y, pointerType: p.type }); return Infinity; }
    return p.t0 + this.longPressMs;
  }
}

/**
 * Feed a page's pointer events to a recognizer (touch, pen and, with `includeMouse`, mouse), keep the browser from scrolling or zooming the element (`touch-action: none`), and run its
 * long-press timer. Returns `{detach}`.
 * @param {HTMLElement} element @param {GestureRecognizer} recognizer @param {{includeMouse?: boolean, preventDefault?: boolean}} [o]
 */
export function attachGestures(element, recognizer, { includeMouse = false, preventDefault = true } = {}) {
  const wants = (e) => e.pointerType !== 'mouse' || includeMouse;
  const rect = () => element.getBoundingClientRect?.() ?? { left: 0, top: 0 };
  const at = (e) => { const r = rect(); return [e.clientX - r.left, e.clientY - r.top]; };
  const now = (e) => e.timeStamp ?? performance.now();
  let timer = 0;
  const arm = () => { clearTimeout(timer); const next = recognizer.update(performance.now()); if (Number.isFinite(next)) timer = setTimeout(arm, Math.max(10, next - performance.now() + 5)); };
  const down = (e) => { if (!wants(e)) return; const [x, y] = at(e); recognizer.pointerDown(e.pointerId, x, y, now(e), e.pointerType); if (preventDefault) e.preventDefault?.(); try { element.setPointerCapture?.(e.pointerId); } catch { /* the pointer is gone */ } arm(); };
  const move = (e) => { if (!wants(e) || !recognizer.pointers.has(e.pointerId)) return; const [x, y] = at(e); recognizer.pointerMove(e.pointerId, x, y, now(e)); if (preventDefault) e.preventDefault?.(); };
  const up = (e) => { if (!wants(e)) return; const [x, y] = at(e); recognizer.pointerUp(e.pointerId, x, y, now(e)); clearTimeout(timer); };
  const cancel = (e) => { recognizer.pointerCancel(e.pointerId); clearTimeout(timer); };
  const previous = element.style?.touchAction;
  if (preventDefault && element.style) element.style.touchAction = 'none';
  element.addEventListener('pointerdown', down); element.addEventListener('pointermove', move); element.addEventListener('pointerup', up); element.addEventListener('pointercancel', cancel);
  return {
    detach() {
      clearTimeout(timer);
      element.removeEventListener('pointerdown', down); element.removeEventListener('pointermove', move); element.removeEventListener('pointerup', up); element.removeEventListener('pointercancel', cancel);
      if (preventDefault && element.style) element.style.touchAction = previous ?? '';
    },
  };
}
