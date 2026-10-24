// Keyboard shortcuts: "ctrl+z", "ctrl+shift+z", "delete", "f", "ctrl+s". The page passes key events in; typing in a text box is never hijacked.

/** The shortcut text for an event, e.g. 'ctrl+shift+z'. `ctrl` also means the Command key. */
export function describeKey(e) {
  const key = (e.key ?? '').length === 1 ? e.key.toLowerCase() : (e.key ?? '').toLowerCase();
  const names = { ' ': 'space', escape: 'esc', arrowup: 'up', arrowdown: 'down', arrowleft: 'left', arrowright: 'right' };
  const parts = [];
  if (e.ctrlKey || e.metaKey) parts.push('ctrl');
  if (e.altKey) parts.push('alt');
  if (e.shiftKey && key.length > 1 || (e.shiftKey && key.length === 1 && (e.ctrlKey || e.metaKey || e.altKey))) parts.push('shift');
  if (!['control', 'shift', 'alt', 'meta'].includes(key)) parts.push(names[key] ?? key);
  return parts.join('+');
}

/**
 * Keyboard shortcuts such as `ctrl+z` or `delete`. Pass key events to `handle(e)`; typing in a text box is never hijacked (except
 * save).
 */
export class Shortcuts {
  constructor() { this.map = new Map(); }
  /** `bind('ctrl+z', fn, 'Undo')`; several keys at once with an array. */
  bind(keys, fn, label = '') { for (const k of [].concat(keys)) this.map.set(k.toLowerCase(), { fn, label }); return this; }
  /** Returns true if the event was handled (and then its default is prevented). */
  handle(e) {
    const t = e.target;
    const typing = t && (t.isContentEditable || /^(input|textarea|select)$/i.test(t.tagName ?? ''));
    const k = describeKey(e);
    const hit = this.map.get(k);
    if (!hit) return false;
    if (typing && !/^ctrl\+(s)$/.test(k)) return false; // inside a text box, only save passes through
    e.preventDefault?.();
    hit.fn(e);
    return true;
  }
  /** A list for a help panel: [{keys, label}]. */
  list() { return [...this.map].map(([keys, { label }]) => ({ keys, label })).filter((x) => x.label); }
}
