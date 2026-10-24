/**
 * Bindings: what a physical control looks like to the input system, plain objects you can save, edit and show to the player.
 *
 *   { type: 'key', code: 'KeyW' }                          a keyboard key (KeyboardEvent.code: the physical key, whatever the layout)
 *   { type: 'mouseButton', button: 0 }                     0 left, 1 middle, 2 right
 *   { type: 'wheel', direction: 'up' | 'down' }            one wheel notch (as a button), or { type: 'wheel' } as an axis
 *   { type: 'gamepadButton', button: 'south' | 0..16 }     see GAMEPAD_BUTTONS
 *   { type: 'gamepadAxis', axis: 'leftX' | 0..3, direction: 1 | -1 | 0 }   a stick direction as a button, or the signed axis (0)
 *   { type: 'keys1d', negative: 'KeyA', positive: 'KeyD' } two keys making one axis
 *   { type: 'keys2d', up, down, left, right }              four keys making a vector
 *   { type: 'mouseDelta', sensitivity: 0.0025 }            mouse movement, in radians per pixel (a vector, per frame)
 *   { type: 'gamepadStick', stick: 'left' | 'right', sensitivity? }   a stick as a vector; with `sensitivity` it is a rate (radians per second at full tilt)
 *   { type: 'touchStick', id } / { type: 'touchLook', id, sensitivity } / { type: 'touchButton', id }   on-screen controls (see touch.js)
 *   { type: 'penPressure' }   how hard a pen presses, 0 to 1 (an axis)      { type: 'penTilt' }   which way a pen leans (a vector, each way -1 to 1 for -90 to 90 degrees)
 *   { type: 'penContact' } / { type: 'penBarrel' } / { type: 'penEraser' }   the pen touching the screen, its side button, its eraser end (buttons)
 *
 * Vectors point right (+x) and up or forward (+y), like a map seen from above: pushing a stick away from you is +y.
 */

/** Standard-mapping gamepad button names (the W3C layout used by Xbox, PlayStation and most pads). */
export const GAMEPAD_BUTTONS = Object.freeze({
  south: 0, east: 1, west: 2, north: 3, leftBumper: 4, rightBumper: 5, leftTrigger: 6, rightTrigger: 7,
  back: 8, start: 9, leftStick: 10, rightStick: 11, dpadUp: 12, dpadDown: 13, dpadLeft: 14, dpadRight: 15, home: 16,
});
/** Axis numbers of the standard gamepad layout: `leftX`, `leftY`, `rightX`, `rightY`. */
export const GAMEPAD_AXES = Object.freeze({ leftX: 0, leftY: 1, rightX: 2, rightY: 3 });

const BUTTON_NAMES = Object.fromEntries(Object.entries(GAMEPAD_BUTTONS).map(([k, v]) => [v, k]));
const AXIS_NAMES = Object.fromEntries(Object.entries(GAMEPAD_AXES).map(([k, v]) => [v, k]));

/** Which binding types each kind of action accepts. */
export const ACCEPTS = Object.freeze({
  button: ['key', 'mouseButton', 'wheel', 'gamepadButton', 'gamepadAxis', 'touchButton', 'penContact', 'penBarrel', 'penEraser'],
  axis: ['keys1d', 'gamepadAxis', 'wheel', 'penPressure'],
  vector2: ['keys2d', 'mouseDelta', 'gamepadStick', 'touchStick', 'touchLook', 'penTilt'],
});

export const buttonIndex = (b) => (typeof b === 'number' ? b : GAMEPAD_BUTTONS[b]);
export const axisIndex = (a) => (typeof a === 'number' ? a : GAMEPAD_AXES[a]);

const isCode = (c) => typeof c === 'string' && c.length > 0 && c.length < 24;
const isNum = (n) => typeof n === 'number' && Number.isFinite(n);

/**
 * Check a binding for an action type. @returns {string | null} what is wrong, or null
 * @param {'button' | 'axis' | 'vector2'} actionType
 * @param {any} b
 */
export function validateBinding(actionType, b) {
  if (!b || typeof b !== 'object') return 'a binding is an object';
  if (!ACCEPTS[actionType]) return `unknown action type "${actionType}"`;
  if (!ACCEPTS[actionType].includes(b.type)) return `a ${actionType} action cannot use a "${b.type}" binding (it takes ${ACCEPTS[actionType].join(', ')})`;
  switch (b.type) {
    case 'key': return isCode(b.code) ? null : 'key needs a code like "KeyW"';
    case 'mouseButton': return Number.isInteger(b.button) && b.button >= 0 && b.button <= 4 ? null : 'mouseButton needs button 0..4';
    case 'wheel': return actionType === 'axis' || b.direction === 'up' || b.direction === 'down' ? null : 'a wheel button needs direction "up" or "down"';
    case 'gamepadButton': { const i = buttonIndex(b.button); return Number.isInteger(i) && i >= 0 && i <= 16 ? null : `unknown gamepad button "${b.button}"`; }
    case 'gamepadAxis': {
      const i = axisIndex(b.axis);
      if (!Number.isInteger(i) || i < 0 || i > 3) return `unknown gamepad axis "${b.axis}"`;
      if (![1, -1, 0].includes(b.direction ?? 0)) return 'direction is 1, -1 or 0';
      if (actionType === 'button' && !b.direction) return 'an axis used as a button needs direction 1 or -1';
      return null;
    }
    case 'keys1d': return isCode(b.negative) && isCode(b.positive) ? null : 'keys1d needs negative and positive key codes';
    case 'keys2d': return ['up', 'down', 'left', 'right'].every((k) => isCode(b[k])) ? null : 'keys2d needs up, down, left and right key codes';
    case 'mouseDelta': return b.sensitivity === undefined || (isNum(b.sensitivity) && b.sensitivity > 0) ? null : 'sensitivity must be positive';
    case 'gamepadStick': return (b.stick === 'left' || b.stick === 'right') && (b.sensitivity === undefined || (isNum(b.sensitivity) && b.sensitivity > 0)) ? null : 'gamepadStick needs stick "left" or "right"';
    case 'touchStick': case 'touchButton': return typeof b.id === 'string' && b.id ? null : `${b.type} needs an id`;
    case 'touchLook': return typeof b.id === 'string' && b.id && (b.sensitivity === undefined || (isNum(b.sensitivity) && b.sensitivity > 0)) ? null : 'touchLook needs an id (and a positive sensitivity)';
    case 'penPressure': case 'penTilt': case 'penContact': case 'penBarrel': case 'penEraser': return null;
    default: return `unknown binding type "${b.type}"`;
  }
}

/** Two bindings that read the same control (for finding clashes when rebinding). */
export function sameControl(a, b) {
  if (a.type !== b.type) return false;
  switch (a.type) {
    case 'key': return a.code === b.code;
    case 'mouseButton': return a.button === b.button;
    case 'wheel': return a.direction === b.direction;
    case 'gamepadButton': return buttonIndex(a.button) === buttonIndex(b.button);
    case 'gamepadAxis': return axisIndex(a.axis) === axisIndex(b.axis) && (a.direction ?? 0) === (b.direction ?? 0);
    case 'keys1d': return a.negative === b.negative && a.positive === b.positive;
    case 'keys2d': return ['up', 'down', 'left', 'right'].every((k) => a[k] === b[k]);
    case 'mouseDelta': return true;
    case 'gamepadStick': return a.stick === b.stick;
    case 'touchStick': case 'touchLook': case 'touchButton': return a.id === b.id;
    case 'penPressure': case 'penTilt': case 'penContact': case 'penBarrel': case 'penEraser': return true;
    default: return false;
  }
}

/** Which device a binding belongs to. */
export function deviceOf(b) {
  switch (b.type) {
    case 'key': case 'keys1d': case 'keys2d': return 'keyboard';
    case 'mouseButton': case 'wheel': case 'mouseDelta': return 'mouse';
    case 'gamepadButton': case 'gamepadAxis': case 'gamepadStick': return 'gamepad';
    default: return 'touch';
  }
}

const KEY_LABELS = {
  Space: 'Space', Enter: 'Enter', Escape: 'Esc', Tab: 'Tab', Backspace: 'Backspace', ShiftLeft: 'Left Shift', ShiftRight: 'Right Shift',
  ControlLeft: 'Left Ctrl', ControlRight: 'Right Ctrl', AltLeft: 'Left Alt', AltRight: 'Right Alt', ArrowUp: 'Up', ArrowDown: 'Down',
  ArrowLeft: 'Left', ArrowRight: 'Right', Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Semicolon: ';',
  Quote: "'", Comma: ',', Period: '.', Slash: '/', Backslash: '\\', CapsLock: 'Caps Lock', Delete: 'Del', Insert: 'Ins', PageUp: 'Page Up', PageDown: 'Page Down',
};

/** A short readable name for a key code: 'KeyW' is 'W', 'Digit1' is '1', 'ArrowUp' is 'Up'. */
export function keyLabel(code) {
  if (KEY_LABELS[code]) return KEY_LABELS[code];
  let m = /^Key([A-Z])$/.exec(code); if (m) return m[1];
  m = /^Digit(\d)$/.exec(code); if (m) return m[1];
  m = /^Numpad(.+)$/.exec(code); if (m) return `Num ${m[1]}`;
  return code;
}

const MOUSE_LABELS = ['Left Click', 'Middle Click', 'Right Click', 'Mouse 4', 'Mouse 5'];
const PAD_LABELS = {
  south: 'A', east: 'B', west: 'X', north: 'Y', leftBumper: 'LB', rightBumper: 'RB', leftTrigger: 'LT', rightTrigger: 'RT', back: 'Back', start: 'Start',
  leftStick: 'L3', rightStick: 'R3', dpadUp: 'D-pad Up', dpadDown: 'D-pad Down', dpadLeft: 'D-pad Left', dpadRight: 'D-pad Right', home: 'Home',
};

/** What to show the player for a binding ("W", "Left Click", "Gamepad A", "Left stick"). */
export function describeBinding(b) {
  switch (b.type) {
    case 'key': return keyLabel(b.code);
    case 'mouseButton': return MOUSE_LABELS[b.button] ?? `Mouse ${b.button + 1}`;
    case 'wheel': return b.direction ? `Wheel ${b.direction}` : 'Mouse wheel';
    case 'gamepadButton': return `Gamepad ${PAD_LABELS[BUTTON_NAMES[buttonIndex(b.button)]] ?? b.button}`;
    case 'gamepadAxis': { const n = AXIS_NAMES[axisIndex(b.axis)] ?? b.axis; return `Gamepad ${n.startsWith('left') ? 'left' : 'right'} stick ${n.endsWith('X') ? (b.direction > 0 ? 'right' : b.direction < 0 ? 'left' : 'horizontal') : (b.direction > 0 ? 'down' : b.direction < 0 ? 'up' : 'vertical')}`; }
    case 'keys1d': return `${keyLabel(b.negative)} / ${keyLabel(b.positive)}`;
    case 'keys2d': return `${keyLabel(b.up)} ${keyLabel(b.left)} ${keyLabel(b.down)} ${keyLabel(b.right)}`;
    case 'mouseDelta': return 'Mouse';
    case 'gamepadStick': return `${b.stick === 'left' ? 'Left' : 'Right'} stick`;
    case 'touchStick': return 'Touch stick';
    case 'penPressure': return 'Pen pressure';
    case 'penTilt': return 'Pen tilt';
    case 'penContact': return 'Pen tip';
    case 'penBarrel': return 'Pen side button';
    case 'penEraser': return 'Pen eraser';
    case 'touchLook': return 'Touch drag';
    case 'touchButton': return `Touch ${b.id}`;
    default: return b.type;
  }
}
