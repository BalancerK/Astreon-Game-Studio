// Playing without a keyboard: on-screen buttons for touch screens and the buttons and sticks of a game controller. Both do exactly what a keyboard does: they press
// and release key codes (ArrowLeft, Space, KeyX…), so a game written for the keyboard works unchanged, and the Time Machine records them like any other key.
// Shared by the studio's game page and by exported games (it is copied into the export). Plain JavaScript with no imports.

/** What a controller button or stick means as keys. */
export const PAD = {
  buttons: { 0: 'Space', 1: 'KeyX', 2: 'KeyX', 3: 'KeyX', 4: 'Space', 5: 'Space', 9: 'Enter', 12: 'ArrowUp', 13: 'ArrowDown', 14: 'ArrowLeft',
    15: 'ArrowRight' },
  deadzone: 0.4,
};

/**
 * The key codes a controller is pressing right now.
 * @param {{buttons: {pressed: boolean}[], axes: number[]} | null | undefined} pad
 * @returns {Set<string>}
 */
export function gamepadCodes(pad) {
  const codes = new Set();
  if (!pad) return codes;
  (pad.buttons ?? []).forEach((b, i) => { if (b?.pressed && PAD.buttons[i]) codes.add(PAD.buttons[i]); });
  const [x = 0, y = 0] = pad.axes ?? [];
  if (x < -PAD.deadzone) codes.add('ArrowLeft');
  if (x > PAD.deadzone) codes.add('ArrowRight');
  if (y < -PAD.deadzone) codes.add('ArrowUp');
  if (y > PAD.deadzone) codes.add('ArrowDown');
  return codes;
}

/** Watches the connected controllers and reports changes as `press(code)` and `release(code)`. Call `poll()` once per frame. */
export class GamepadReader {
  /** @param {{press: (code: string) => void, release: (code: string) => void, getPads?: () => any[]}} o */
  constructor({ press, release, getPads = () => (typeof navigator !== 'undefined' && navigator.getGamepads ? [...navigator.getGamepads()] : []) }) {
    this.press = press;
    this.release = release;
    this.getPads = getPads;
    this.held = new Set();
  }

  poll() {
    const now = new Set();
    for (const pad of this.getPads()) for (const code of gamepadCodes(pad)) now.add(code);
    for (const code of now) if (!this.held.has(code)) this.press(code);
    for (const code of this.held) if (!now.has(code)) this.release(code);
    this.held = now;
    return this.held.size > 0;
  }

  releaseAll() {
    for (const code of this.held) this.release(code);
    this.held.clear();
  }
}

const BUTTONS = [
  { code: 'ArrowUp', label: '▲', name: 'Up', cls: 'dpad up' },
  { code: 'ArrowLeft', label: '◀', name: 'Left', cls: 'dpad left' },
  { code: 'ArrowRight', label: '▶', name: 'Right', cls: 'dpad right' },
  { code: 'ArrowDown', label: '▼', name: 'Down', cls: 'dpad down' },
  { code: 'KeyX', label: 'B', name: 'Action', cls: 'act b' },
  { code: 'Space', label: 'A', name: 'Jump', cls: 'act a' },
];

const STYLE = `
.touch-controls { position: fixed; inset: auto 0 0 0; height: 40vmin; pointer-events: none; z-index: 5; font: 600 5vmin system-ui,
  sans-serif; user-select: none; -webkit-user-select: none; touch-action: none; }
.touch-controls[hidden] { display: none; }
.touch-controls button { position: absolute; width: 14vmin; height: 14vmin; border-radius: 50%; border: 2px solid rgba(255, 255, 255,
  .35); background: rgba(20, 24, 34, .55); color: rgba(255, 255, 255, .8);
  pointer-events: auto; touch-action: none; padding: 0; font: inherit; -webkit-tap-highlight-color: transparent; }
.touch-controls button.down-now { background: rgba(120,130,255,.65); border-color: #fff; }
.touch-controls .left { left: 2vmin; bottom: 12vmin; } .touch-controls .right { left: 18vmin; bottom: 12vmin; }
.touch-controls .up { left: 10vmin; bottom: 24vmin; width: 11vmin; height: 11vmin; }
.touch-controls .down { left: 10vmin; bottom: 1vmin; width: 11vmin; height: 11vmin; }
.touch-controls .a { right: 3vmin; bottom: 12vmin; width: 17vmin; height: 17vmin; } .touch-controls .b { right: 22vmin; bottom: 7vmin; }
`;

/**
 * On-screen buttons. They appear when the device has a touch screen (or after the first touch) and are pressed with any number of fingers; sliding a finger from one
 * button to the next works like a real d-pad.
 * @param {Document} doc
 * @param {{press: (code: string) => void, release: (code: string) => void, force?: boolean}} o `force` shows them even without touch (for testing)
 */
export function createTouchControls(doc, { press, release, force = false }) {
  const style = doc.createElement('style');
  style.textContent = STYLE;
  const el = doc.createElement('div');
  el.className = 'touch-controls';
  el.setAttribute('role', 'group');
  el.setAttribute('aria-label', 'On-screen game controls');
  const pads = new Map();               // code -> button
  for (const b of BUTTONS) {
    const btn = doc.createElement('button');
    btn.type = 'button';
    btn.className = b.cls;
    btn.textContent = b.label;
    btn.setAttribute('aria-label', b.name);
    btn.dataset.code = b.code;
    pads.set(b.code, btn);
    el.append(btn);
  }
  const fingers = new Map();            // pointer id -> code it is pressing
  const down = (id, code) => {
    if (fingers.get(id) === code) return;
    up(id);
    if (!code) return;
    fingers.set(id, code);
    if (![...fingers.entries()].some(([other, c]) => other !== id && c === code)) press(code);
    pads.get(code)?.classList.add('down-now');
  };
  function up(id) {
    const code = fingers.get(id);
    if (!code) return;
    fingers.delete(id);
    if (![...fingers.values()].includes(code)) { release(code); pads.get(code)?.classList.remove('down-now'); }
  }
  const under = (e) => doc.elementFromPoint(e.clientX, e.clientY)?.closest?.('.touch-controls button')?.dataset.code ?? null;
  el.addEventListener('pointerdown', (e) => {
    const code = under(e) ?? e.target.closest?.('button')?.dataset.code ?? null;
    if (!code) return;
    e.preventDefault();
    try { el.setPointerCapture(e.pointerId); } catch { /* the pointer may already be gone */ }
    down(e.pointerId, code);
  });
  el.addEventListener('pointermove', (e) => { if (fingers.has(e.pointerId)) down(e.pointerId, under(e)); });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) el.addEventListener(type, (e) => up(e.pointerId));
  el.addEventListener('contextmenu', (e) => e.preventDefault());

  const show = () => { el.hidden = false; };
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  el.hidden = !(force || coarse);
  doc.addEventListener('touchstart', show, { once: true, passive: true });
  doc.head.append(style);
  doc.body.append(el);
  return {
    el,
    show,
    hide() { el.hidden = true; },
    releaseAll() { for (const id of [...fingers.keys()]) up(id); },
    get visible() { return !el.hidden; },
    dispose() { this.releaseAll(); el.remove(); style.remove(); },
  };
}

/**
 * The mouse, for games that want it (a first-person view): a click on the game takes hold of the mouse (the pointer disappears and moving it turns you; Esc lets
 * go), the buttons are the key codes `Mouse0`, `Mouse1` and `Mouse2`, and the movement is one more held key, `Mouse:<x>:<y>`, the whole distance the mouse has
 * moved so far. Because it is a held key like any other, the Time Machine records it and a replay turns the same way. The game reads it with the kit's
 * `mouseDelta` or `mouseLook3d`. Nothing happens until a game asks (`want(true)`), so games that do not use the mouse never lose their pointer.
 * @param {Document} doc
 * @param {() => HTMLElement | null} getCanvas the game's picture (it can be replaced when the game restarts): a click on it takes the mouse
 * @param {{press: (code: string) => void, release: (code: string) => void}} sink
 */
export function createMouseControls(doc, getCanvas, { press, release, onLock = () => {} }) {   // onLock(locked, problem?)
  let wanted = false;
  let tx = 0;
  let ty = 0;
  let shown = null;                      // the movement key currently held
  let scheduled = false;
  const hint = doc.createElement('div');
  hint.className = 'mouse-hint';
  hint.hidden = true;
  hint.textContent = 'Click the game to look around with the mouse. Esc lets go.';
  hint.setAttribute('role', 'status');
  Object.assign(hint.style, {
    position: 'fixed', left: '50%', bottom: '14px', transform: 'translateX(-50%)', padding: '6px 12px', borderRadius: '8px', zIndex: 8,
    pointerEvents: 'none',
    background: 'rgba(10, 14, 22, .78)', color: '#eef2ff', font: '600 13px system-ui, sans-serif', textAlign: 'center',
  });
  doc.body.append(hint);
  const locked = () => !!doc.pointerLockElement && doc.pointerLockElement === getCanvas();
  const drawHint = () => { hint.hidden = !wanted || locked(); };
  const flush = () => {
    scheduled = false;
    const code = `Mouse:${tx}:${ty}`;
    if (code === shown) return;
    if (shown) release(shown);
    shown = code;
    press(code);
  };
  const api = {
    /** Does the game want the mouse? (A game says so by calling the kit's `mouseLook3d`.) */
    want(on = true) { wanted = !!on; drawHint(); },
    get wanted() { return wanted; },
    get locked() { return locked(); },
    /** The mouse moved by this much (what a mouse move does while the mouse is held; also used by tests). */
    move(dx, dy) {
      tx += Math.max(-500, Math.min(500, Math.round(dx)));
      ty += Math.max(-500, Math.min(500, Math.round(dy)));
      if (!scheduled) { scheduled = true; requestAnimationFrame(flush); }
    },
    /** Let go of the mouse. */
    unlock() { if (locked()) doc.exitPointerLock?.(); },
    releaseAll() { for (const b of [0, 1, 2]) release(`Mouse${b}`); },
  };
  doc.addEventListener('mousedown', (e) => {
    const canvas = getCanvas();
    if (!canvas || e.target !== canvas) return;
    press(`Mouse${e.button}`);
    if (wanted && !locked()) Promise.resolve(canvas.requestPointerLock?.()).catch((error) => onLock(false, String(error?.message ?? error)));
  });
  doc.addEventListener('mouseup', (e) => release(`Mouse${e.button}`));
  doc.addEventListener('mousemove', (e) => { if (locked()) api.move(e.movementX, e.movementY); });
  doc.addEventListener('pointerlockerror', () => onLock(false, 'the browser did not allow the mouse to be held'));
  doc.addEventListener('pointerlockchange', () => { drawHint(); if (!locked()) api.releaseAll(); onLock(locked()); });
  doc.addEventListener('contextmenu', (e) => { if (wanted && e.target === getCanvas()) e.preventDefault(); });
  return api;
}
