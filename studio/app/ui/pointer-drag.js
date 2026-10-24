// Dragging things about with the pointer (mouse, pen or finger): a tab to another place in its row or to another editor, a file out of a list into an editor.
// It works the same everywhere because it uses pointer events instead of the browser's own drag and drop (which does not exist for touch and is hard to test),
// and it starts only after the pointer has moved a few pixels, so a plain click is still a click. Escape cancels.
import { h } from './dom.js';

const THRESHOLD = 5;
const HOLD_MS = 350;             // how long a finger rests before a drag can begin
const TOUCH_SLOP = 10;           // how far it may wander meanwhile
const targets = new Set();

/**
 * Places things can be dropped. `accepts(item)` says whether it wants this thing; `over(item, x, y)` is called as the pointer moves over it (return false to
 * say it is not a place to drop after all, here); `out()` when the pointer leaves; `drop(item, x, y)` when it is let go there.
 * @param {{el: HTMLElement, accepts: (item: any) => boolean, over: (item: any, x: number, y: number) => boolean | void, out: () => void, drop: (item: any, x: number, y: number) => void}} target
 * @returns {() => void}
 */
export function addDropTarget(target) {
  targets.add(target);
  return () => targets.delete(target);
}

let hot = null;
function pointOver(item, x, y) {
  const found = [...targets].filter((t) => t.accepts(item)).find((t) => {
    const r = t.el.getBoundingClientRect();
    return r.width > 0 && x >= r.left && x < r.right && y >= r.top && y < r.bottom && t.el.offsetParent !== null;
  });
  const ok = found && found.over(item, x, y) !== false ? found : null;
  if (hot && hot !== ok) hot.out();
  hot = ok;
  return ok;
}

/**
 * Make an element draggable.
 * @param {HTMLElement} el
 * @param {Object} o
 * @param {(e: PointerEvent) => any} o.payload what is being dragged (null: this press does not start a drag)
 * @param {string | ((payload: any) => string)} o.label the text on the little label that follows the pointer
 * @param {(payload: any) => void} [o.cancel] called when it is cancelled (Escape), or let go where nothing wants it
 * @param {(e: PointerEvent, payload: any) => boolean | void} [o.drop] called when it is let go where nothing wants it (return true if you used it)
 * @returns {() => void} a function that removes it
 */
export function makeDraggable(el, { payload, label, drop = () => false, cancel = () => {} }) {
  const onDown = (e) => {
    if (e.button !== 0 || e.target.closest('button, input, select, textarea') && e.target !== el) return;
    const item = payload(e);
    if (item === null || item === undefined) return;
    const from = { x: e.clientX, y: e.clientY };
    let ghost = null;
    let started = false;
    // a finger needs to rest on the thing for a moment first (a quick swipe scrolls, as it should); after that it drags
    const touch = e.pointerType === 'touch';
    let armed = !touch;
    let hold = 0;
    const noScroll = (ev) => { if (armed) ev.preventDefault(); };
    if (touch) {
      hold = setTimeout(() => { armed = true; navigator.vibrate?.(12); document.documentElement.classList.add('dragging-armed'); }, HOLD_MS);
      addEventListener('touchmove', noScroll, { passive: false, capture: true });
    }
    const finish = (how, ev) => {
      clearTimeout(hold);
      removeEventListener('touchmove', noScroll, true);
      document.documentElement.classList.remove('dragging-armed');
      removeEventListener('pointermove', onMove, true);
      removeEventListener('pointerup', onUp, true);
      removeEventListener('pointercancel', onCancel, true);
      removeEventListener('keydown', onKey, true);
      ghost?.remove();
      document.documentElement.classList.remove('dragging-item');
      const target = hot;
      if (hot) { hot.out(); hot = null; }
      if (!started) return;
      if (how === 'drop' && target) target.drop(item, ev.clientX, ev.clientY);
      else if (how === 'drop' && drop(ev, item)) { /* used */ } else cancel(item);
      // a click that ends a drag must not also activate whatever is under the pointer
      const stop = (c) => { c.stopPropagation(); c.preventDefault(); };
      addEventListener('click', stop, { capture: true, once: true });
      setTimeout(() => removeEventListener('click', stop, true), 0);
    };
    const onMove = (ev) => {
      if (!started) {
        const moved = Math.hypot(ev.clientX - from.x, ev.clientY - from.y);
        if (!armed) { if (moved > TOUCH_SLOP) finish('cancel', ev); return; }          // moved before the hold was up: it is a scroll, not a drag
        if (moved < THRESHOLD) return;
        started = true;
        ghost = h('div', { class: 'drag-ghost', text: typeof label === 'function' ? label(item) : label, aria: { hidden: true } });
        document.body.append(ghost);
        document.documentElement.classList.add('dragging-item');
        getSelection()?.removeAllRanges();
      }
      ghost.style.transform = `translate(${ev.clientX + 12}px, ${ev.clientY + 12}px)`;
      pointOver(item, ev.clientX, ev.clientY);
    };
    const onUp = (ev) => finish('drop', ev);
    const onCancel = (ev) => finish('cancel', ev);
    const onKey = (ev) => { if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); finish('cancel', ev); } };
    addEventListener('pointermove', onMove, true);
    addEventListener('pointerup', onUp, true);
    addEventListener('pointercancel', onCancel, true);
    addEventListener('keydown', onKey, true);
  };
  el.addEventListener('pointerdown', onDown);
  return () => el.removeEventListener('pointerdown', onDown);
}
