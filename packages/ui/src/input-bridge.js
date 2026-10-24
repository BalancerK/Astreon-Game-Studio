// Menus with a gamepad: keyboard and mouse reach the UI through the DOM (dom.js), but a gamepad arrives through the input layer.
// `menuActions` are input-layer actions (in their own, blocking context) for the d-pad, left stick, A, B and bumpers;
// `createMenuPump` turns them into UI navigation, with key-repeat while a direction is held.

/**
 * Actions to add to `InputCore` / `createInput({ actions })`. They live in the `menu` context (declare it with `contexts: { menu: { blocking: true } }`
 * and push it while a screen is open).
 * @param {string} [context]
 */
export function menuActions(context = 'menu') {
  const pad = (button) => ({ type: 'gamepadButton', button });
  const axis = (a, direction) => ({ type: 'gamepadAxis', axis: a, direction });
  return {
    uiUp: { type: 'button', context, bindings: [pad('dpadUp'), axis('leftY', -1)] },
    uiDown: { type: 'button', context, bindings: [pad('dpadDown'), axis('leftY', 1)] },
    uiLeft: { type: 'button', context, bindings: [pad('dpadLeft'), axis('leftX', -1)] },
    uiRight: { type: 'button', context, bindings: [pad('dpadRight'), axis('leftX', 1)] },
    uiAccept: { type: 'button', context, bindings: [pad('south')] },
    uiCancel: { type: 'button', context, bindings: [pad('east')] },
    uiPrev: { type: 'button', context, bindings: [pad('leftBumper')] },
    uiNext: { type: 'button', context, bindings: [pad('rightBumper')] },
  };
}

/**
 * Call `pump.update(dt)` every frame after `input.update(dt)`. Presses become `ui.navigate / activate / cancel`; a held direction repeats.
 * @param {import('./ui.js').Ui} ui
 * @param {{pressed(a: string): boolean, held(a: string): boolean}} input An `InputCore`.
 * @param {{repeatDelay?: number, repeatRate?: number, onPrev?: () => void, onNext?: () => void}} [o]
 */
export function createMenuPump(ui, input, { repeatDelay = 0.4, repeatRate = 0.11, onPrev, onNext } = {}) {
  const dirs = { uiUp: 'up', uiDown: 'down', uiLeft: 'left', uiRight: 'right' };
  const holding = new Map(); // action -> seconds until the next repeat
  return {
    update(dt) {
      if (!ui.isOpen) { holding.clear(); return; }
      const use = (fn) => { ui.noteDevice('gamepad'); fn(); };
      for (const [action, dir] of Object.entries(dirs)) {
        if (input.pressed(action)) { holding.set(action, repeatDelay); use(() => ui.navigate(dir)); }
        else if (input.held(action) && holding.has(action)) {
          const left = holding.get(action) - dt;
          if (left <= 0) { holding.set(action, repeatRate); use(() => ui.navigate(dir)); } else holding.set(action, left);
        } else holding.delete(action);
      }
      if (input.pressed('uiAccept')) use(() => ui.activate());
      if (input.pressed('uiCancel')) use(() => ui.cancel());
      if (input.pressed('uiPrev')) use(() => onPrev?.());
      if (input.pressed('uiNext')) use(() => onNext?.());
    },
  };
}
