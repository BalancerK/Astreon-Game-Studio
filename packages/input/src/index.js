import { InputCore } from './core.js';
import { attachKeyboard, attachMouse, attachGamepads, attachTouch, attachPen } from './devices.js';

export { InputCore, applyDeadzone1d, applyDeadzone2d } from './core.js';
export { GAMEPAD_BUTTONS, GAMEPAD_AXES, ACCEPTS, validateBinding, sameControl, deviceOf, describeBinding, keyLabel } from './bindings.js';
export { TouchController, createTouchOverlay, shooterTouchLayout } from './touch.js';
export { attachKeyboard, attachMouse, attachGamepads, attachTouch, attachPen } from './devices.js';
export { GestureRecognizer, attachGestures } from './gestures.js';
export { StrokeRecorder, attachPenStrokes, penWidth } from './pen.js';

/**
 * Everything in one call for a browser game: an `InputCore` with keyboard, mouse, gamepads and (optionally) on-screen touch controls attached.
 * @param {object} o
 * @param {Record<string, import('./core.js').ActionDefinition>} o.actions
 * @param {HTMLElement} o.element The game's element (mouse and touch listen here)
 * @param {Record<string, {blocking?: boolean}>} [o.contexts]
 * @param {boolean} [o.pointerLock] Mouse look uses a locked pointer: the view turns only while it is locked
 * @param {boolean} [o.requireLock] Mouse buttons and wheel count only while it is locked (so the click that locks it is not also a shot)
 * @param {((w: number, h: number) => import('./touch.js').TouchControl[]) | false} [o.touch] A touch layout, or false for none (default: none)
 * @param {boolean} [o.touchOverlay] Draw the touch controls (default true)
 * @param {boolean} [o.pen] Read a pen's pressure, tilt and buttons (default false): see `penPressure` and the other `pen...` bindings
 * @param {number} [o.deadzone]
 * @returns {{input: InputCore, mouse: ReturnType<typeof attachMouse>, touch: ReturnType<typeof attachTouch> | null, detach: () => void}}
 */
export function createInput({ actions, element, contexts, pointerLock = false, requireLock = false, touch = false, touchOverlay = true, pen = false, deadzone } = {}) {
  const input = new InputCore({ actions, contexts, deadzone });
  const detachKeys = attachKeyboard(input);
  const mouse = attachMouse(input, element, { pointerLock, requireLock });
  const detachPads = attachGamepads(input);
  const touchHandle = touch ? attachTouch(input, element, touch, { overlay: touchOverlay }) : null;
  const penHandle = pen ? attachPen(input, element) : null;
  return {
    input, mouse, touch: touchHandle,
    detach() { detachKeys(); mouse.detach(); detachPads(); touchHandle?.detach(); penHandle?.detach(); },
  };
}
