import { ACCEPTS, validateBinding, sameControl, buttonIndex, axisIndex, deviceOf, describeBinding, GAMEPAD_BUTTONS, GAMEPAD_AXES } from './bindings.js';

/** Radial dead zone with the remaining range stretched back to 0..1, then an optional response curve (exponent 2 = finer control near the centre). */
export function applyDeadzone2d(x, y, deadzone = 0.15, curve = 1, out = { x: 0, y: 0 }) {
  const len = Math.hypot(x, y);
  if (len <= deadzone) { out.x = 0; out.y = 0; return out; }
  const scaled = Math.min(1, (len - deadzone) / (1 - deadzone)), k = Math.pow(scaled, curve) / len;
  out.x = x * k; out.y = y * k;
  return out;
}

/** The one-axis version of `applyDeadzone2d`. */
export function applyDeadzone1d(v, deadzone = 0.15, curve = 1) {
  const a = Math.abs(v);
  if (a <= deadzone) return 0;
  return Math.sign(v) * Math.pow(Math.min(1, (a - deadzone) / (1 - deadzone)), curve);
}

const BUTTON_THRESHOLD = 0.5; // an analog button or a stick direction counts as pressed beyond this
const LISTEN_AXIS = 0.7;
const FORMAT_VERSION = 1;

/**
 * @typedef {Object} ActionDefinition
 * @property {'button' | 'axis' | 'vector2'} type
 * @property {object[]} bindings See bindings.js
 * @property {string} [context] Which context the action lives in (default 'gameplay')
 * @property {boolean} [invertY] Flip the vertical part of a vector (look controls)
 * @property {number} [deadzone] Dead zone for sticks and analog axes (default: the core's)
 * @property {number} [curve] Response exponent for sticks (default 1: linear)
 *
 * @typedef {Object} ActionState The current frame's reading of an action (a live object: read it, do not keep it)
 * @property {boolean} held Button: down right now
 * @property {boolean} pressed Button: went down since the last update (a tap shorter than a frame still counts)
 * @property {boolean} released Button: went up since the last update
 * @property {number} value Button: 0..1 (analog triggers); axis: -1..1
 * @property {number} x Vector: right is +
 * @property {number} y Vector: up or forward is +
 */

/**
 * Device-independent input. You describe what the player can DO (actions: jump, fire, move, look) and what controls do it
 * (bindings: a key, a button, a stick, an on-screen control); the game reads actions once per frame. The core knows nothing
 * about the browser: adapters (see devices.js) feed it raw events, and tests can feed it directly.
 *
 * Reading: call `update(dt)` once per frame, then `held('fire')`, `pressed('jump')`, `released(...)`, `value('zoom')`, `vector('move')`.
 * Vectors from a pointing device or a stick-as-look are per-frame turns in radians (right and up are +); vectors from keys or
 * sticks are unit vectors (length at most 1).
 */
export class InputCore {
  /**
   * @param {object} [o]
   * @param {Record<string, ActionDefinition>} [o.actions]
   * @param {Record<string, {blocking?: boolean}>} [o.contexts] A blocking context hides the ones below it while it is on top (a menu over the game)
   * @param {number} [o.deadzone] Default dead zone (default 0.15)
   * @param {() => ArrayLike<any>} [o.gamepadProvider] Returns the connected gamepads (`navigator.getGamepads` in a browser)
   */
  constructor({ actions = {}, contexts = {}, deadzone = 0.15, gamepadProvider = null } = {}) {
    this.deadzone = deadzone;
    this.gamepadProvider = gamepadProvider;
    /** @type {Map<string, {name: string, type: string, context: string, invertY: boolean, deadzone?: number, curve: number, bindings: object[], defaults: object[], state: ActionState, prevHeld: boolean}>} */
    this.actions = new Map();
    this.contexts = new Map([['gameplay', { blocking: false }]]);
    for (const [name, c] of Object.entries(contexts)) this.contexts.set(name, { blocking: !!c.blocking });
    this.contextStack = ['gameplay'];

    this.keys = new Map();          // code -> {down, press, release}
    this.mouseButtons = new Map();  // button -> {down, press, release}
    this.mouse = { x: 0, y: 0, dx: 0, dy: 0, wheel: 0 };
    this.pads = [];                 // snapshots of the connected gamepads, refreshed every update
    this.padObjects = [];
    this.touchSticks = new Map();   // id -> {x, y, active}
    this.touchButtons = new Map();  // id -> {down, press, release}
    this.touchLooks = new Map();    // id -> {dx, dy}
    this.penButtons = new Map();    // 'contact' | 'barrel' | 'eraser' -> {down, press, release}
    this.pen = { x: 0, y: 0, pressure: 0, tiltX: 0, tiltY: 0, twist: 0, inContact: false, hovering: false };
    this.prevPadButtons = [];
    /** @type {'keyboard' | 'mouse' | 'gamepad' | 'touch'} The device used last (for showing the right prompts). */
    this.lastDevice = 'keyboard';
    /** @type {((device: string) => void) | null} */
    this.onDeviceChange = null;
    this.capture = null;
    this.scratch = { x: 0, y: 0 };

    for (const [name, def] of Object.entries(actions)) this.defineAction(name, def);
  }

  // ---------- actions ----------

  /** Add an action. @param {string} name @param {ActionDefinition} def */
  defineAction(name, def) {
    if (this.actions.has(name)) throw new Error(`action "${name}" is already defined`);
    if (!ACCEPTS[def.type]) throw new Error(`action "${name}": type must be button, axis or vector2 (got ${def.type})`);
    const bindings = (def.bindings ?? []).map((b) => structuredClone(b));
    for (const b of bindings) { const err = validateBinding(def.type, b); if (err) throw new Error(`action "${name}": ${err}`); }
    const context = def.context ?? 'gameplay';
    if (!this.contexts.has(context)) this.contexts.set(context, { blocking: false });
    this.actions.set(name, {
      name, type: def.type, context, invertY: !!def.invertY, deadzone: def.deadzone, curve: def.curve ?? 1,
      bindings, defaults: bindings.map((b) => structuredClone(b)), prevHeld: false,
      state: { held: false, pressed: false, released: false, value: 0, x: 0, y: 0 },
    });
  }

  #action(name) {
    const a = this.actions.get(name);
    if (!a) throw new Error(`no action named "${name}" (have: ${[...this.actions.keys()].join(', ')})`);
    return a;
  }

  /** The reading of an action (live object). */
  action(name) { return this.#action(name).state; }
  held(name) { return this.#action(name).state.held; }
  pressed(name) { return this.#action(name).state.pressed; }
  released(name) { return this.#action(name).state.released; }
  value(name) { return this.#action(name).state.value; }
  /** A vector action as `out` (default: a new object): {x, y}. */
  vector(name, out = { x: 0, y: 0 }) { const s = this.#action(name).state; out.x = s.x; out.y = s.y; return out; }

  /** Every action's current reading as plain numbers (a button is 0 or 1 or an analog value, an axis a number, a vector [x, y]): handy for sending to a server. */
  sample() {
    const out = {};
    for (const a of this.actions.values()) out[a.name] = a.type === 'vector2' ? [a.state.x, a.state.y] : a.type === 'button' ? (a.state.held ? Math.max(a.state.value, 0.001) : 0) : a.state.value;
    return out;
  }

  // ---------- contexts ----------

  defineContext(name, { blocking = false } = {}) { this.contexts.set(name, { blocking }); }
  pushContext(name) {
    if (!this.contexts.has(name)) throw new Error(`no context named "${name}"`);
    this.contextStack.push(name);
  }
  popContext() { if (this.contextStack.length > 1) this.contextStack.pop(); }
  /** Replace the whole stack with one context. */
  setContext(name) {
    if (!this.contexts.has(name)) throw new Error(`no context named "${name}"`);
    this.contextStack = [name];
  }
  get context() { return this.contextStack[this.contextStack.length - 1]; }

  #activeContexts() {
    const active = new Set();
    for (let i = this.contextStack.length - 1; i >= 0; i--) {
      const name = this.contextStack[i];
      active.add(name);
      if (this.contexts.get(name)?.blocking) break;
    }
    return active;
  }

  // ---------- raw input, fed by the adapters (or by tests) ----------

  #device(d) { if (this.lastDevice !== d) { this.lastDevice = d; this.onDeviceChange?.(d); } }

  #latch(map, key, down) {
    let s = map.get(key);
    if (!s) { s = { down: false, press: false, release: false }; map.set(key, s); }
    if (down && !s.down) s.press = true;
    if (!down && s.down) s.release = true;
    s.down = down;
  }

  keyDown(code) {
    if (this.capture?.('keyboard', { type: 'key', code })) return;
    this.#device('keyboard'); this.#latch(this.keys, code, true);
  }
  keyUp(code) { this.#latch(this.keys, code, false); }
  mouseButtonDown(button) {
    if (this.capture?.('mouse', { type: 'mouseButton', button })) return;
    this.#device('mouse'); this.#latch(this.mouseButtons, button, true);
  }
  mouseButtonUp(button) { this.#latch(this.mouseButtons, button, false); }
  /** Mouse moved by (dx, dy) pixels (use the pointer-lock movement for a look action) to the position (x, y). */
  mouseMove(dx, dy, x = this.mouse.x, y = this.mouse.y) {
    this.mouse.dx += dx; this.mouse.dy += dy; this.mouse.x = x; this.mouse.y = y;
    if (dx !== 0 || dy !== 0) this.#device('mouse');
  }
  /** Wheel scrolled: negative `dy` is up (away from you). */
  mouseWheel(dy) {
    if (dy !== 0) {
      if (this.capture?.('mouse', { type: 'wheel', direction: dy < 0 ? 'up' : 'down' })) return;
      this.#device('mouse');
    }
    this.mouse.wheel += dy;
  }
  /**
   * A pen moved, pressed or lifted. `pressure` 0..1, `tiltX` and `tiltY` in degrees (-90..90), `twist` in degrees, `inContact` whether the tip touches, `hovering` whether it is near the screen,
   * `barrel` the side button, `eraser` the eraser end. Everything not given keeps its last value.
   */
  penUpdate({ x, y, pressure, tiltX, tiltY, twist, inContact, hovering, barrel, eraser } = {}) {
    const p = this.pen;
    if (x !== undefined) p.x = x; if (y !== undefined) p.y = y;
    if (pressure !== undefined) p.pressure = pressure;
    if (tiltX !== undefined) p.tiltX = tiltX; if (tiltY !== undefined) p.tiltY = tiltY; if (twist !== undefined) p.twist = twist;
    if (hovering !== undefined) p.hovering = hovering;
    if (inContact !== undefined) { p.inContact = inContact; if (!inContact) p.pressure = 0; }
    this.#device('touch');
    if (inContact !== undefined) this.#latch(this.penButtons, 'contact', inContact);
    if (barrel !== undefined) this.#latch(this.penButtons, 'barrel', barrel);
    if (eraser !== undefined) this.#latch(this.penButtons, 'eraser', eraser);
  }

  /** Drive an on-screen stick: x and y in -1..1, y up. */
  touchStick(id, x, y, active) {
    let s = this.touchSticks.get(id);
    if (!s) { s = { x: 0, y: 0, active: false }; this.touchSticks.set(id, s); }
    s.x = x; s.y = y; s.active = active;
    if (active) this.#device('touch');
  }
  touchButton(id, down) { this.#device('touch'); this.#latch(this.touchButtons, id, down); }
  /** Dragging on a look area: (dx, dy) pixels moved, dy down is +. */
  touchLook(id, dx, dy) {
    let s = this.touchLooks.get(id);
    if (!s) { s = { dx: 0, dy: 0 }; this.touchLooks.set(id, s); }
    s.dx += dx; s.dy += dy;
    this.#device('touch');
  }

  /** Let go of everything (the window lost focus, a menu opened): no key stays stuck down. */
  releaseAll() {
    for (const s of this.keys.values()) { if (s.down) s.release = true; s.down = false; }
    for (const s of this.mouseButtons.values()) { if (s.down) s.release = true; s.down = false; }
    for (const s of this.touchButtons.values()) { if (s.down) s.release = true; s.down = false; }
    for (const s of this.penButtons.values()) { if (s.down) s.release = true; s.down = false; }
    for (const s of this.touchSticks.values()) { s.x = 0; s.y = 0; s.active = false; }
  }

  // ---------- gamepads ----------

  #pollPads() {
    const raw = this.gamepadProvider ? this.gamepadProvider() : null;
    this.pads = [];
    this.padObjects = [];
    if (!raw) return;
    for (const p of raw) {
      if (!p || p.connected === false) continue;
      this.padObjects.push(p);
      this.pads.push({ index: p.index, buttons: Array.from(p.buttons ?? [], (b) => ({ pressed: !!b.pressed, value: b.value ?? (b.pressed ? 1 : 0) })), axes: Array.from(p.axes ?? []) });
    }
    // activity: switch the "last device", and feed rebinding capture
    for (const p of this.pads) {
      const prev = this.prevPadButtons[p.index] ?? [];
      p.buttons.forEach((b, i) => {
        if (b.pressed && !prev[i]) {
          if (this.capture?.('gamepad', { type: 'gamepadButton', button: Object.keys(GAMEPAD_BUTTONS).find((k) => GAMEPAD_BUTTONS[k] === i) ?? i })) return;
          this.#device('gamepad');
        }
      });
      p.axes.forEach((v, i) => {
        if (i > 3 || Math.abs(v) < LISTEN_AXIS) return;
        if (this.capture?.('gamepad', { type: 'gamepadAxis', axis: Object.keys(GAMEPAD_AXES).find((k) => GAMEPAD_AXES[k] === i), direction: Math.sign(v) })) return;
        if (Math.abs(v) > 0.5) this.#device('gamepad');
      });
      this.prevPadButtons[p.index] = p.buttons.map((b) => b.pressed);
    }
  }

  /** Rumble the first pad that can (a hit, an explosion). Strengths 0..1. */
  vibrate(durationMs = 100, strong = 0.5, weak = 0.5) {
    for (const p of this.padObjects) {
      const act = p.vibrationActuator;
      if (act?.playEffect) { act.playEffect('dual-rumble', { startDelay: 0, duration: durationMs, strongMagnitude: strong, weakMagnitude: weak }).catch?.(() => {}); return true; }
    }
    return false;
  }

  // ---------- the per-frame update ----------

  /**
   * Work out every action from the raw state. Call once per frame, before the game reads input.
   * @param {number} [dt] Seconds since the last update (for stick-driven look rates)
   */
  update(dt = 1 / 60) {
    this.#pollPads();
    const active = this.#activeContexts();
    const listening = this.capture !== null;
    for (const a of this.actions.values()) {
      if (listening || !active.has(a.context)) this.#neutral(a);
      else if (a.type === 'button') this.#button(a);
      else if (a.type === 'axis') this.#axis(a);
      else this.#vector(a, dt);
    }
    // the frame is over: forget one-frame events
    for (const s of this.keys.values()) { s.press = false; s.release = false; }
    for (const s of this.mouseButtons.values()) { s.press = false; s.release = false; }
    for (const s of this.touchButtons.values()) { s.press = false; s.release = false; }
    for (const s of this.penButtons.values()) { s.press = false; s.release = false; }
    for (const s of this.touchLooks.values()) { s.dx = 0; s.dy = 0; }
    this.mouse.dx = 0; this.mouse.dy = 0; this.mouse.wheel = 0;
  }

  #neutral(a) {
    const s = a.state;
    s.held = false; s.pressed = false; s.released = false; s.value = 0; s.x = 0; s.y = 0;
    // keep watching what is held, so that coming back (a menu closes) with a key still down is not a fresh press
    a.prevHeld = a.type === 'button' ? this.#readButton(a).held : false;
  }

  #padButton(b) { // the strongest reading of a gamepad button across the connected pads
    const i = buttonIndex(b.button);
    let v = 0;
    for (const p of this.pads) v = Math.max(v, p.buttons[i]?.value ?? 0);
    return v;
  }

  #padAxis(b) { // the signed axis with the most movement across the pads
    const i = axisIndex(b.axis);
    let best = 0;
    for (const p of this.pads) { const v = p.axes[i] ?? 0; if (Math.abs(v) > Math.abs(best)) best = v; }
    return best;
  }

  #readButton(a) {
    let held = false, press = false, release = false, value = 0;
    for (const b of a.bindings) {
      switch (b.type) {
        case 'key': { const k = this.keys.get(b.code); if (k) { if (k.down) { held = true; value = 1; } press ||= k.press; release ||= k.release; } break; }
        case 'mouseButton': { const k = this.mouseButtons.get(b.button); if (k) { if (k.down) { held = true; value = 1; } press ||= k.press; release ||= k.release; } break; }
        case 'penContact': case 'penBarrel': case 'penEraser': { const k = this.penButtons.get(b.type === 'penContact' ? 'contact' : b.type === 'penBarrel' ? 'barrel' : 'eraser'); if (k) { if (k.down) { held = true; value = 1; } press ||= k.press; release ||= k.release; } break; }
        case 'touchButton': { const k = this.touchButtons.get(b.id); if (k) { if (k.down) { held = true; value = 1; } press ||= k.press; release ||= k.release; } break; }
        case 'wheel': if (b.direction === 'up' ? this.mouse.wheel < 0 : this.mouse.wheel > 0) { press = true; release = true; value = 1; } break; // a notch is a tap: pressed and released in one frame
        case 'gamepadButton': { const v = this.#padButton(b); if (v > BUTTON_THRESHOLD || (v > 0 && this.pads.some((p) => p.buttons[buttonIndex(b.button)]?.pressed))) { held = true; value = Math.max(value, v); } break; }
        case 'gamepadAxis': { const v = this.#padAxis(b) * b.direction; if (v > BUTTON_THRESHOLD) { held = true; value = Math.max(value, v); } break; }
        default: break;
      }
    }
    return { held, press, release, value };
  }

  #button(a) {
    const s = a.state, { held, press, release, value } = this.#readButton(a);
    // pressed: the action went from up to down (a second control joining one already held does not count); released: it went from down to up
    s.pressed = !a.prevHeld && (press || held);
    s.released = !held && (a.prevHeld || release);
    s.held = held; s.value = held ? Math.max(value, 0.001) : 0; s.x = 0; s.y = 0;
    a.prevHeld = held;
  }

  #axis(a) {
    let v = 0;
    const dz = a.deadzone ?? this.deadzone;
    for (const b of a.bindings) {
      if (b.type === 'keys1d') v += (this.keys.get(b.positive)?.down ? 1 : 0) - (this.keys.get(b.negative)?.down ? 1 : 0);
      else if (b.type === 'gamepadAxis') v += applyDeadzone1d(this.#padAxis(b), dz, a.curve) * (b.direction === 0 ? 1 : b.direction);
      else if (b.type === 'wheel') v += this.mouse.wheel / 100; // one notch is about 100 units
      else if (b.type === 'penPressure') v += this.pen.inContact ? this.pen.pressure : 0;
    }
    const s = a.state;
    s.value = Math.max(-1, Math.min(1, v));
    s.held = s.value !== 0; s.pressed = s.held && !a.prevHeld; s.released = !s.held && a.prevHeld;
    s.x = 0; s.y = 0;
    a.prevHeld = s.held;
  }

  #vector(a, dt) {
    const dz = a.deadzone ?? this.deadzone, sc = this.scratch;
    let ux = 0, uy = 0, tx = 0, ty = 0; // unit contributions and turn (per-frame delta) contributions
    for (const b of a.bindings) {
      switch (b.type) {
        case 'keys2d':
          ux += (this.keys.get(b.right)?.down ? 1 : 0) - (this.keys.get(b.left)?.down ? 1 : 0);
          uy += (this.keys.get(b.up)?.down ? 1 : 0) - (this.keys.get(b.down)?.down ? 1 : 0);
          break;
        case 'mouseDelta': { const k = b.sensitivity ?? 0.0025; tx += this.mouse.dx * k; ty -= this.mouse.dy * k; break; }
        case 'penTilt': if (this.pen.inContact || this.pen.hovering) { ux += Math.max(-1, Math.min(1, this.pen.tiltX / 90)); uy -= Math.max(-1, Math.min(1, this.pen.tiltY / 90)); } break;
        case 'gamepadStick': {
          const ax = b.stick === 'left' ? 0 : 2;
          let bx = 0, by = 0;
          for (const p of this.pads) { const x = p.axes[ax] ?? 0, y = p.axes[ax + 1] ?? 0; if (Math.hypot(x, y) > Math.hypot(bx, by)) { bx = x; by = y; } }
          applyDeadzone2d(bx, by, dz, a.curve, sc);
          if (b.sensitivity) { tx += sc.x * b.sensitivity * dt; ty -= sc.y * b.sensitivity * dt; } else { ux += sc.x; uy -= sc.y; }
          break;
        }
        case 'touchStick': { const st = this.touchSticks.get(b.id); if (st?.active) { applyDeadzone2d(st.x, st.y, 0.08, a.curve, sc); ux += sc.x; uy += sc.y; } break; }
        case 'touchLook': { const l = this.touchLooks.get(b.id); if (l) { const k = b.sensitivity ?? 0.006; tx += l.dx * k; ty -= l.dy * k; } break; }
        default: break;
      }
    }
    const len = Math.hypot(ux, uy);
    if (len > 1) { ux /= len; uy /= len; }
    const s = a.state;
    s.x = ux + tx; s.y = (uy + ty) * (a.invertY ? -1 : 1);
    s.held = s.x !== 0 || s.y !== 0; s.value = Math.hypot(s.x, s.y);
    s.pressed = s.held && !a.prevHeld; s.released = !s.held && a.prevHeld;
    a.prevHeld = s.held;
  }

  // ---------- rebinding ----------

  /** A copy of an action's bindings. */
  bindings(action) { return this.#action(action).bindings.map((b) => structuredClone(b)); }

  /** Replace the bindings of an action (validated). */
  setBindings(action, list) {
    const a = this.#action(action);
    for (const b of list) { const err = validateBinding(a.type, b); if (err) throw new Error(`action "${action}": ${err}`); }
    a.bindings = list.map((b) => structuredClone(b));
  }

  /** Replace one binding. @param {number} index */
  rebind(action, index, binding) {
    const a = this.#action(action);
    if (!(index >= 0 && index < a.bindings.length)) throw new Error(`action "${action}" has no binding number ${index}`);
    const err = validateBinding(a.type, binding);
    if (err) throw new Error(`action "${action}": ${err}`);
    a.bindings[index] = structuredClone(binding);
  }

  addBinding(action, binding) {
    const a = this.#action(action);
    const err = validateBinding(a.type, binding);
    if (err) throw new Error(`action "${action}": ${err}`);
    a.bindings.push(structuredClone(binding));
  }

  removeBinding(action, index) {
    const a = this.#action(action);
    if (index >= 0 && index < a.bindings.length) a.bindings.splice(index, 1);
  }

  /** Back to the bindings the action was defined with (one action, or all). */
  resetBindings(action) {
    for (const a of action ? [this.#action(action)] : this.actions.values()) a.bindings = a.defaults.map((b) => structuredClone(b));
  }

  /**
   * Other actions in the same context that already use a control: for warning before a rebind steals it.
   * @returns {{action: string, index: number}[]}
   */
  findConflicts(binding, exceptAction) {
    const mine = exceptAction ? this.#action(exceptAction).context : null;
    const out = [];
    for (const a of this.actions.values()) {
      if (a.name === exceptAction || (mine !== null && a.context !== mine)) continue;
      a.bindings.forEach((b, index) => { if (sameControl(b, binding)) out.push({ action: a.name, index }); });
    }
    return out;
  }

  /**
   * Wait for the player to press something and hand it back as a binding: the "press a key to bind" step of a settings screen.
   * While listening, no action fires. Escape cancels (the callback gets null).
   * @param {(binding: object | null) => void} callback
   * @param {{devices?: ('keyboard' | 'mouse' | 'gamepad')[], cancelKey?: string}} [o]
   * @returns {() => void} cancel
   */
  listen(callback, { devices = ['keyboard', 'mouse', 'gamepad'], cancelKey = 'Escape' } = {}) {
    const finish = (b) => { this.capture = null; this.releaseAll(); for (const m of [this.keys, this.mouseButtons]) for (const s of m.values()) { s.press = false; s.release = false; } callback(b); };
    this.capture = (device, binding) => {
      if (binding.type === 'key' && binding.code === cancelKey) { finish(null); return true; }
      if (!devices.includes(device)) return false;
      finish(binding);
      return true;
    };
    return () => { if (this.capture) { this.capture = null; } };
  }

  /** What to show the player for an action: the label of its first binding on `device` (default: the device used last). */
  promptFor(action, device = this.lastDevice) {
    const a = this.#action(action);
    const b = a.bindings.find((x) => deviceOf(x) === device) ?? a.bindings[0];
    return b ? describeBinding(b) : '';
  }

  /** Labels of every binding of an action. */
  describe(action) { return this.#action(action).bindings.map(describeBinding); }

  // ---------- saving ----------

  /** The player's bindings as plain data (save it in localStorage or on a server). */
  serialize() {
    const bindings = {};
    for (const a of this.actions.values()) bindings[a.name] = a.bindings.map((b) => structuredClone(b));
    return { version: FORMAT_VERSION, bindings };
  }

  /**
   * Restore saved bindings. Unknown actions and invalid bindings are skipped, not fatal (a game update may rename things).
   * @returns {{loaded: string[], problems: string[]}}
   */
  load(data) {
    const loaded = [], problems = [];
    if (!data || data.version !== FORMAT_VERSION || typeof data.bindings !== 'object') return { loaded, problems: ['not saved bindings of this version'] };
    for (const [name, list] of Object.entries(data.bindings)) {
      const a = this.actions.get(name);
      if (!a) { problems.push(`unknown action "${name}"`); continue; }
      if (!Array.isArray(list)) { problems.push(`"${name}": bindings must be a list`); continue; }
      const good = list.filter((b) => { const err = validateBinding(a.type, b); if (err) problems.push(`"${name}": ${err}`); return !err; });
      a.bindings = good.map((b) => structuredClone(b));
      loaded.push(name);
    }
    return { loaded, problems };
  }
}
