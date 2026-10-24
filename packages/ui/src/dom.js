// The browser side of the UI: page events in, `Ui` calls out. The core never touches the DOM, so tests and bots feed it directly.

/**
 * Safe-area insets (notches, rounded corners, home bars) in CSS pixels, read from `env(safe-area-inset-*)`.
 * Needs `<meta name="viewport" content="..., viewport-fit=cover">` to be non-zero.
 */
export function readSafeAreaInsets(doc = globalThis.document) {
  try {
    const probe = doc.createElement('div');
    probe.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)';
    doc.body.append(probe);
    const cs = getComputedStyle(probe);
    const out = { top: parseFloat(cs.paddingTop) || 0, right: parseFloat(cs.paddingRight) || 0, bottom: parseFloat(cs.paddingBottom) || 0, left: parseFloat(cs.paddingLeft) || 0 };
    probe.remove();
    return out;
  } catch { return { top: 0, right: 0, bottom: 0, left: 0 }; }
}

/**
 * Connect a `Ui` to a page: pointer, touch, wheel and keyboard events go to the UI, and what the UI uses is kept from the game
 * (so a click on a menu button is not also a shot). Typing goes through a hidden `<input>` so soft keyboards, paste, IME and accents work.
 * @param {import('./ui.js').Ui} ui
 * @param {HTMLElement} element The element the UI covers (events are taken from it; its size is the viewport).
 * @param {object} [o]
 * @param {number | ((width: number, height: number) => number)} [o.scale] UI zoom, fixed or from the viewport size (bigger on touch screens).
 * @param {boolean} [o.safeArea] Keep the UI inside notches and home bars (default true).
 * @param {Window} [o.window]
 * @returns {{detach: () => void, resize: () => void, sync: () => void, input: HTMLInputElement | null}}
 */
export function attachDom(ui, element, { scale = 1, safeArea = true, window: win = globalThis.window } = {}) {
  const doc = win.document;
  const cleanups = [];
  const on = (target, type, fn, opts) => { target.addEventListener(type, fn, opts); cleanups.push(() => target.removeEventListener(type, fn, opts)); };
  const point = (e) => { const r = element.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  const consume = (e) => { e.preventDefault?.(); e.stopImmediatePropagation?.(); };

  const resize = () => {
    const w = element.clientWidth || win.innerWidth, h = element.clientHeight || win.innerHeight;
    ui.setViewport(w, h, typeof scale === 'function' ? scale(w, h) : scale, safeArea ? readSafeAreaInsets(doc) : undefined);
  };
  resize();
  on(win, 'resize', resize);
  on(win, 'orientationchange', resize);

  // ---- pointer ----
  let lastDownAt = -1e9, lastConsumedDown = false;
  on(element, 'pointerdown', (e) => {
    const [x, y] = point(e);
    lastDownAt = performance.now();
    lastConsumedDown = ui.pointerDown(x, y, e.pointerId, e.pointerType);
    if (lastConsumedDown) { consume(e); try { element.setPointerCapture?.(e.pointerId); } catch { /* the pointer is gone */ } sync(); }
  }, { capture: true });
  on(element, 'mousedown', (e) => { if (lastConsumedDown) e.preventDefault(); }, { capture: true }); // keep the text field focused
  on(element, 'pointermove', (e) => {
    const [x, y] = point(e);
    const used = ui.pointerMove(x, y, e.pointerId);
    if (ui.captured) { consume(e); sync(); } else if (used && ui.isModal) e.stopImmediatePropagation?.();
  }, { capture: true });
  const up = (e) => {
    const [x, y] = point(e);
    if (ui.pointerUp(x, y, e.pointerId)) { consume(e); sync(); }
  };
  on(element, 'pointerup', up, { capture: true });
  on(win, 'pointerup', up, { capture: true });
  on(element, 'pointercancel', (e) => ui.pointerCancel(e.pointerId), { capture: true });
  on(element, 'wheel', (e) => {
    const [x, y] = point(e);
    if (ui.wheel(x, y, e.deltaY)) consume(e);
  }, { capture: true, passive: false });
  on(element, 'contextmenu', (e) => { const [x, y] = point(e); if (ui.wantsPointer(x, y)) e.preventDefault(); });

  // ---- keyboard (typing is the hidden field's job) ----
  on(win, 'keydown', (e) => {
    if (e.target === field) return;
    if (ui.key(e.code, { shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey, alt: e.altKey })) consume(e);
  }, { capture: true });

  // ---- the hidden text field ----
  /** @type {HTMLInputElement | null} */
  let field = null;
  let target = null;
  const makeField = () => {
    const el = doc.createElement('input');
    el.type = 'text';
    el.setAttribute('autocomplete', 'off'); el.setAttribute('autocorrect', 'off'); el.setAttribute('autocapitalize', 'off'); el.spellcheck = false;
    el.setAttribute('aria-label', 'text input');
    // 16px or more stops iOS zooming into the field; it is invisible, not display:none, because hidden fields cannot be focused
    el.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;border:0;padding:0;margin:0;font-size:16px;pointer-events:none;z-index:-1';
    doc.body.append(el);
    cleanups.push(() => el.remove());
    el.addEventListener('input', () => {
      if (!target) return;
      const a = el.selectionStart ?? el.value.length;
      target.set(el.value, true, a, a);
      if (target.value !== el.value) sync(); // the widget refused some characters (filter, max length)
    });
    const caret = () => {
      if (!target) return;
      const s = el.selectionStart ?? 0, e = el.selectionEnd ?? s;
      if (el.selectionDirection === 'backward') target.select(e, s); else target.select(s, e);
    };
    for (const type of ['keyup', 'select', 'click']) el.addEventListener(type, caret);
    on(doc, 'selectionchange', () => { if (doc.activeElement === el) caret(); });
    el.addEventListener('keydown', (e) => {
      if (['Enter', 'NumpadEnter', 'Escape', 'Tab', 'ArrowUp', 'ArrowDown'].includes(e.code)) {
        e.preventDefault();
        ui.key(e.code, { shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey, alt: e.altKey });
      }
      e.stopPropagation(); // typing must not reach the game's key handling
    });
    el.addEventListener('keyup', (e) => e.stopPropagation());
    el.addEventListener('blur', () => {
      // a tap on the field's own widget moves focus away for a moment; anything else (the keyboard was dismissed) ends editing
      if (target && performance.now() - lastDownAt > 400) ui.setFocus(null);
      else if (target) setTimeout(() => { if (target && doc.activeElement !== el) el.focus({ preventScroll: true }); }, 0);
    });
    return el;
  };
  /** Copy the widget's text and selection into the field (after the UI changed them itself). */
  function sync() {
    if (!target || !field) return;
    if (field.value !== target.value) field.value = target.value;
    const lo = Math.min(target.anchor, target.caret), hi = Math.max(target.anchor, target.caret);
    if (field.selectionStart !== lo || field.selectionEnd !== hi) field.setSelectionRange(lo, hi, target.caret < target.anchor ? 'backward' : 'forward');
  }
  ui.onTextTarget = (w) => {
    target = w;
    if (w) {
      field ??= makeField();
      field.type = w.password ? 'password' : 'text';
      field.maxLength = w.maxLength;
      field.inputMode = w.style.inputMode ?? 'text';
      field.enterKeyHint = w.onSubmit ? 'go' : 'enter';
      sync();
      field.focus({ preventScroll: true });
    } else if (field) {
      const el = field;
      target = null;
      el.blur();
    }
  };
  cleanups.push(() => { ui.onTextTarget = null; });

  return {
    detach() { for (const c of cleanups.reverse()) c(); },
    resize, sync,
    get input() { return field; },
  };
}
