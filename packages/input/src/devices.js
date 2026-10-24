/**
 * Browser adapters: they listen to the page and feed an `InputCore`. Each returns a function that removes its listeners.
 */
import { TouchController, createTouchOverlay } from './touch.js';

const typing = (e) => { const t = e.target; return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable); };

/**
 * Keyboard. Keys the game uses are kept from scrolling the page or triggering browser shortcuts (Space, arrows, Tab...), except
 * while the player is typing in a text field. Losing focus lets go of everything, so no key stays stuck.
 * @param {import('./core.js').InputCore} core
 * @param {EventTarget} [target]
 */
export function attachKeyboard(core, target = globalThis) {
  const used = () => {
    const codes = new Set();
    for (const a of core.actions.values()) for (const b of a.bindings) {
      if (b.type === 'key') codes.add(b.code);
      else if (b.type === 'keys1d') { codes.add(b.negative); codes.add(b.positive); } else if (b.type === 'keys2d') { codes.add(b.up); codes.add(b.down); codes.add(b.left); codes.add(b.right); }
    }
    return codes;
  };
  const down = (e) => {
    if (typing(e)) return;
    if (!e.repeat) core.keyDown(e.code);
    if (core.capture || used().has(e.code)) e.preventDefault?.();
  };
  const up = (e) => { core.keyUp(e.code); };
  const blur = () => core.releaseAll();
  target.addEventListener('keydown', down);
  target.addEventListener('keyup', up);
  globalThis.addEventListener?.('blur', blur);
  return () => { target.removeEventListener('keydown', down); target.removeEventListener('keyup', up); globalThis.removeEventListener?.('blur', blur); };
}

/**
 * Mouse: buttons, wheel and movement. With `pointerLock`, movement counts only while the pointer is locked (an endless turn: what a
 * first-person game wants); `lock()` asks for the lock, which browsers only grant in answer to a click.
 * @param {import('./core.js').InputCore} core
 * @param {HTMLElement} element
 * @param {{pointerLock?: boolean, requireLock?: boolean}} [o]
 *   `requireLock`: ignore buttons and wheel until the pointer is locked (so the click that locks it does not also fire).
 * @returns {{detach: () => void, lock: () => Promise<boolean>, options: {pointerLock: boolean, requireLock: boolean}, readonly locked: boolean}}
 */
export function attachMouse(core, element, { pointerLock = false, requireLock = false } = {}) {
  const options = { pointerLock, requireLock }; // changeable while running (see `options` on the result)
  const isLocked = () => globalThis.document?.pointerLockElement === element;
  const accepting = () => !options.requireLock || isLocked();
  const move = (e) => {
    if (options.pointerLock && !isLocked()) { core.mouseMove(0, 0, e.clientX, e.clientY); return; } // a free pointer only reports where it is: it does not turn the view
    core.mouseMove(e.movementX ?? 0, e.movementY ?? 0, e.clientX, e.clientY);
  };
  const down = (e) => { if (e.pointerType === 'touch') return; if (accepting()) core.mouseButtonDown(e.button); };
  const up = (e) => { if (e.pointerType === 'touch') return; core.mouseButtonUp(e.button); };
  const wheel = (e) => { if (accepting()) { core.mouseWheel(e.deltaY); e.preventDefault?.(); } };
  const menu = (e) => e.preventDefault?.();
  element.addEventListener('mousemove', move);
  element.addEventListener('pointerdown', down);
  globalThis.addEventListener?.('pointerup', up);
  element.addEventListener('wheel', wheel, { passive: false });
  element.addEventListener('contextmenu', menu);
  const lockLost = () => { if (!isLocked()) for (const b of [0, 1, 2]) core.mouseButtonUp(b); };
  globalThis.document?.addEventListener?.('pointerlockchange', lockLost);
  return {
    detach() {
      element.removeEventListener('mousemove', move); element.removeEventListener('pointerdown', down); globalThis.removeEventListener?.('pointerup', up);
      element.removeEventListener('wheel', wheel); element.removeEventListener('contextmenu', menu); globalThis.document?.removeEventListener?.('pointerlockchange', lockLost);
    },
    /** Ask for the pointer lock. Resolves to whether it was granted: if it cannot be (an embedded page, a restricted browser) the caller can fall back by clearing `options.pointerLock` and `options.requireLock`. */
    async lock() {
      try { await element.requestPointerLock?.(); return isLocked(); } catch { return false; }
    },
    options,
    get locked() { return isLocked(); },
  };
}

/**
 * A pen (stylus) on a touch screen or a tablet: pressure, tilt, twist, the side button and the eraser end go to `core.penUpdate`, where `penPressure`, `penTilt`, `penContact`, `penBarrel` and
 * `penEraser` bindings read them. A pen also still counts as the mouse's left button, so menus and clicks work with it. Only pen pointers are used.
 * @param {import('./core.js').InputCore} core @param {HTMLElement} element
 */
export function attachPen(core, element) {
  const where = (e) => { const r = element.getBoundingClientRect?.() ?? { left: 0, top: 0 }; return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const read = (e) => ({ ...where(e), pressure: e.pressure ?? 0, tiltX: e.tiltX ?? 0, tiltY: e.tiltY ?? 0, twist: e.twist ?? 0, barrel: (e.buttons & 2) !== 0, eraser: (e.buttons & 32) !== 0 });
  const touching = (e) => (e.buttons & 1) !== 0 || (e.buttons & 32) !== 0;
  const down = (e) => { if (e.pointerType === 'pen') core.penUpdate({ ...read(e), inContact: true, hovering: false }); };
  const move = (e) => { if (e.pointerType === 'pen') { const c = touching(e); core.penUpdate({ ...read(e), inContact: c, hovering: !c }); } };
  const up = (e) => { if (e.pointerType === 'pen') core.penUpdate({ ...where(e), inContact: false, hovering: true, barrel: false, eraser: false, pressure: 0 }); };
  const leave = (e) => { if (e.pointerType === 'pen') core.penUpdate({ inContact: false, hovering: false, barrel: false, eraser: false, pressure: 0 }); };
  const previous = element.style?.touchAction;
  if (element.style) element.style.touchAction = 'none';
  element.addEventListener('pointerdown', down); element.addEventListener('pointermove', move); element.addEventListener('pointerup', up);
  element.addEventListener('pointercancel', leave); element.addEventListener('pointerleave', leave);
  return {
    detach() {
      element.removeEventListener('pointerdown', down); element.removeEventListener('pointermove', move); element.removeEventListener('pointerup', up);
      element.removeEventListener('pointercancel', leave); element.removeEventListener('pointerleave', leave);
      if (element.style) element.style.touchAction = previous ?? '';
    },
  };
}

/**
 * Gamepads: nothing to listen to, the browser is polled once per `core.update()`.
 * @param {import('./core.js').InputCore} core
 * @param {{getGamepads?: () => ArrayLike<any>}} [nav]
 */
export function attachGamepads(core, nav = globalThis.navigator) {
  core.gamepadProvider = () => nav?.getGamepads?.() ?? [];
  return () => { core.gamepadProvider = null; };
}

/**
 * On-screen touch controls. Only touch and pen pointers drive them (a mouse does not), unless `includeMouse` is set (for trying a
 * layout on a desktop).
 * @param {import('./core.js').InputCore} core
 * @param {HTMLElement} element The area the controls live in (usually the game's container)
 * @param {(w: number, h: number) => import('./touch.js').TouchControl[]} [layout]
 * @param {{overlay?: boolean, includeMouse?: boolean}} [o] `overlay`: draw the controls (default true)
 * @returns {{controller: TouchController, detach: () => void}}
 */
export function attachTouch(core, element, layout, { overlay = true, includeMouse = false } = {}) {
  const controller = new TouchController(core, layout);
  const rect = () => element.getBoundingClientRect();
  const size = () => { const r = rect(); controller.resize(r.width, r.height); };
  size();
  const prevAction = element.style.touchAction;
  element.style.touchAction = 'none';
  const accept = (e) => e.pointerType === 'touch' || e.pointerType === 'pen' || includeMouse;
  const pos = (e) => { const r = rect(); return [e.clientX - r.left, e.clientY - r.top]; };
  const down = (e) => { if (accept(e) && controller.pointerDown(e.pointerId, ...pos(e))) { element.setPointerCapture?.(e.pointerId); e.preventDefault?.(); } };
  const move = (e) => { if (accept(e)) controller.pointerMove(e.pointerId, ...pos(e)); };
  const up = (e) => { if (accept(e)) controller.pointerUp(e.pointerId); };
  element.addEventListener('pointerdown', down);
  element.addEventListener('pointermove', move);
  element.addEventListener('pointerup', up);
  element.addEventListener('pointercancel', up);
  const resize = () => size();
  globalThis.addEventListener?.('resize', resize);
  globalThis.addEventListener?.('orientationchange', resize);
  const blur = () => controller.cancelAll();
  globalThis.addEventListener?.('blur', blur);
  const drawn = overlay ? createTouchOverlay(element, controller) : null;
  return {
    controller,
    detach() {
      element.removeEventListener('pointerdown', down); element.removeEventListener('pointermove', move);
      element.removeEventListener('pointerup', up); element.removeEventListener('pointercancel', up);
      globalThis.removeEventListener?.('resize', resize); globalThis.removeEventListener?.('orientationchange', resize); globalThis.removeEventListener?.('blur', blur);
      element.style.touchAction = prevAction;
      controller.cancelAll();
      drawn?.destroy();
    },
  };
}
