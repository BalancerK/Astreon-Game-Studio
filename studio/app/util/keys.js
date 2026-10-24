// Keyboard shortcuts as text ("Mod+K", "Ctrl+Shift+P", "F1") and what to do with them: read them, match them to a key press, and show them the way the
// person's computer writes them (Ctrl+K on Windows and Linux, ⌘K on a Mac). "Mod" means the platform's main modifier key.

const NAMES = {
  esc: 'escape', escape: 'escape', enter: 'enter', return: 'enter', tab: 'tab', space: ' ', spacebar: ' ',
  up: 'arrowup', down: 'arrowdown', left: 'arrowleft', right: 'arrowright',
  del: 'delete', delete: 'delete', backspace: 'backspace', home: 'home', end: 'end', pageup: 'pageup', pagedown: 'pagedown', plus: '+',
};
const SHOW = {
  escape: 'Esc', enter: 'Enter', tab: 'Tab', ' ': 'Space', arrowup: '↑', arrowdown: '↓', arrowleft: '←', arrowright: '→',
  delete: 'Del', backspace: 'Backspace', pageup: 'PgUp', pagedown: 'PgDn',
};

/** @param {{platform?: string, userAgent?: string} | undefined} nav the browser's `navigator` (or anything like it) @returns {boolean} */
export const isMac = (nav = globalThis.navigator) => /mac|iphone|ipad/i.test(`${nav?.platform ?? ''} ${nav?.userAgent ?? ''}`);

/**
 * Read a shortcut.
 * @param {string} text for example "Mod+Shift+P"
 * @param {boolean} [mac]
 * @returns {{ctrl: boolean, alt: boolean, shift: boolean, meta: boolean, key: string}}
 */
export function parseCombo(text, mac = false) {
  const parts = String(text).split('+').map((p) => p.trim()).filter(Boolean);
  if (String(text).trim().endsWith('++') || String(text).trim() === '+') parts.push('+');
  const combo = { ctrl: false, alt: false, shift: false, meta: false, key: '' };
  for (const raw of parts) {
    const p = raw.toLowerCase();
    if (p === 'mod') { if (mac) combo.meta = true; else combo.ctrl = true; }
    else if (p === 'ctrl' || p === 'control') combo.ctrl = true;
    else if (p === 'alt' || p === 'option') combo.alt = true;
    else if (p === 'shift') combo.shift = true;
    else if (p === 'meta' || p === 'cmd' || p === 'command' || p === 'win') combo.meta = true;
    else combo.key = NAMES[p] ?? p;
  }
  if (!combo.key) throw new Error(`"${text}" is not a shortcut: it needs a key, like Mod+K`);
  return combo;
}

const isLetterOrDigit = (k) => /^[a-z0-9]$/.test(k);

/** Does this key press (a KeyboardEvent, or anything with its fields) match the shortcut? */
export function comboMatches(combo, e, mac = false) {
  const want = typeof combo === 'string' ? parseCombo(combo, mac) : combo;
  if (String(e.key ?? '').toLowerCase() !== want.key) return false;
  if (!!e.ctrlKey !== want.ctrl || !!e.altKey !== want.alt || !!e.metaKey !== want.meta) return false;
  // symbols such as "?" or "+" need Shift on some keyboards and not on others: for them Shift is not compared
  const symbol = !isLetterOrDigit(want.key) && want.key.length === 1;
  return symbol || !!e.shiftKey === want.shift;
}

/** A shortcut as a person on this kind of computer would write it. */
export function formatCombo(text, mac = false) {
  const c = parseCombo(text, mac);
  const parts = [];
  if (mac) {
    if (c.ctrl) parts.push('⌃');
    if (c.alt) parts.push('⌥');
    if (c.shift) parts.push('⇧');
    if (c.meta) parts.push('⌘');
    parts.push(SHOW[c.key] ?? c.key.toUpperCase());
    return parts.join('');
  }
  if (c.ctrl) parts.push('Ctrl');
  if (c.alt) parts.push('Alt');
  if (c.shift) parts.push('Shift');
  if (c.meta) parts.push('Win');
  parts.push(SHOW[c.key] ?? c.key.toUpperCase());
  return parts.join('+');
}

/** The canonical text of a shortcut (used to compare two shortcuts, for example to find clashes). */
export function normalizeCombo(text, mac = false) {
  const c = parseCombo(text, mac);
  return [c.ctrl && 'ctrl', c.alt && 'alt', c.shift && 'shift', c.meta && 'meta', c.key].filter(Boolean).join('+');
}
