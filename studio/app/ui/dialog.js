// Questions the studio asks and messages it shows: a dialog (confirm, ask for a text, choose) and small toast messages. Dialogs trap the keyboard, close with
// Esc, return focus to where it was, and are announced to screen readers.
import { h, trapFocus, button } from './dom.js';

/**
 * Show a dialog and wait for the answer.
 * @param {{
 *   title: string, body?: Node | string, buttons: {label: string, value: any, primary?: boolean, danger?: boolean}[],
 *   initialFocus?: () => HTMLElement | null, beforeClose?: (value: any, button: object) => boolean | void,
 * }} o
 * @returns {Promise<any>} the `value` of the button pressed; `undefined` if the dialog was cancelled with Esc or a click outside
 */
export function showDialog({ title, body, buttons, initialFocus, beforeClose }) {
  const previous = document.activeElement;
  return new Promise((resolve) => {
    const titleId = `dialog-title-${Math.random().toString(36).slice(2, 7)}`;
    const box = h('div', { class: 'dialog', role: 'dialog', aria: { modal: true, labelledby: titleId } },
      h('h2', { id: titleId, text: title }),
      typeof body === 'string' ? h('p', { text: body }) : body,
      h('div', { class: 'buttons' }, buttons.map((b) => button({
        text: b.label, class: b.primary ? 'primary' : b.danger ? 'danger' : '', onClick: () => finish(b.value, b),
      }))));
    const overlay = h('div', { class: 'overlay', on: { mousedown: (e) => { if (e.target === overlay) finish(undefined) } } }, box);
    const untrap = trapFocus(overlay);
    const finish = (value, b) => {
      if (b && beforeClose && beforeClose(value, b) === false) return;
      untrap();
      overlay.remove();
      previous?.focus?.();
      resolve(value);
    };
    overlay.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); finish(undefined); }
      else if (e.key === 'Enter' && e.target.tagName !== 'BUTTON' && e.target.tagName !== 'TEXTAREA') {
        const primary = buttons.find((b) => b.primary);
        if (primary) { e.preventDefault(); finish(primary.value, primary); }
      }
    });
    document.body.append(overlay);
    (initialFocus?.() ?? box.querySelector('input, select') ?? box.querySelector('.btn.primary, .btn'))?.focus();
  });
}

/** Ask yes or no. Resolves true only for the confirming button. */
export async function confirm({ title, message, confirmLabel = 'OK', danger = false }) {
  const answer = await showDialog({
    title, body: message,
    buttons: [{ label: 'Cancel', value: false }, { label: confirmLabel, value: true, primary: !danger, danger }],
  });
  return answer === true;
}

/**
 * Ask for a line of text. The answer is checked by `validate` (which returns the reason it is not acceptable, or null) before the dialog closes.
 * @returns {Promise<string | undefined>} the text, or undefined if cancelled
 */
export function promptText({ title, label, value = '', confirmLabel = 'OK', validate, placeholder = '' }) {
  const input = h('input', { type: 'text', value, placeholder, spellcheck: false, aria: { label } });
  const error = h('div', { class: 'error', role: 'alert' });
  const body = h('div', {}, h('label', { text: label, style: { display: 'block', marginBottom: '4px' } }), input, error);
  input.addEventListener('input', () => { error.textContent = ''; });
  return showDialog({
    title, body,
    buttons: [{ label: 'Cancel', value: undefined }, { label: confirmLabel, value: 'ok', primary: true }],
    initialFocus: () => { input.select(); return input; },
    beforeClose: (v) => {
      if (v !== 'ok') return true;
      const problem = validate?.(input.value);
      if (problem) { error.textContent = problem; input.focus(); return false; }
      return true;
    },
  }).then((v) => (v === 'ok' ? input.value : undefined));
}

/** Small messages in a corner. `action` adds a button (for example "Undo"). */
export class Toasts {
  constructor() {
    this.el = h('div', { class: 'toasts', role: 'status', aria: { live: 'polite', atomic: false } });
    document.body.append(this.el);
  }

  /** @param {string} text @param {{kind?: 'info' | 'success' | 'error', action?: {label: string, run: () => void}, ms?: number}} [o] @returns {() => void} a function that removes it */
  show(text, { kind = 'info', action, ms = kind === 'error' ? 9000 : 4500 } = {}) {
    const toast = h('div', { class: `toast ${kind}` }, h('span', { text }),
      action ? button({ text: action.label, class: 'small', onClick: () => { action.run(); remove(); } }) : null);
    const remove = () => { clearTimeout(timer); toast.remove(); };
    const timer = setTimeout(remove, ms);
    this.el.append(toast);
    while (this.el.children.length > 4) this.el.firstChild.remove();
    return remove;
  }
}
