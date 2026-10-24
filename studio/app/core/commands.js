// Every action in the studio is a command: it has a name people can search for, a place in a category, optional keywords and an optional shortcut.
// Menus, the search box (Ctrl+K), shortcuts, lessons and plugins all use the same list, so nothing exists that cannot be found and nothing is reachable
// only with a mouse.
import { Emitter } from '../util/emitter.js';
import { comboMatches, normalizeCombo, formatCombo, parseCombo } from '../util/keys.js';

/**
 * @typedef {Object} Command
 * @property {string} id Unique, like "file.new"
 * @property {string} title What it is called in the search box: "New file"
 * @property {string} [category] A group name shown with it: "File"
 * @property {string[]} [keywords] Other words that should find it: ["create", "add"]
 * @property {string} [shortcut] Default shortcut, like "Mod+Shift+P"
 * @property {string} [description] One sentence for the shortcut list and help
 * @property {(args?: any) => any} run What it does (may return a promise)
 * @property {() => boolean} [enabled] False while it cannot be used (it is then hidden from search and its shortcut does nothing)
 */

export class CommandRegistry extends Emitter {
  /** @type {Map<string, Command>} */
  #commands = new Map();
  /** @type {Map<string, string | null>} id -> shortcut chosen by the user (null: no shortcut) */
  #overrides = new Map();
  #mac;
  #recent = [];

  /** @param {{mac?: boolean}} [o] */
  constructor({ mac = false } = {}) {
    super();
    this.#mac = mac;
  }

  /** Add a command. Returns a function that removes it again (plugins use this when they are unloaded). */
  register(command) {
    if (!command?.id || !command.title || typeof command.run !== 'function') throw new Error('a command needs an id, a title and a run function');
    if (this.#commands.has(command.id)) throw new Error(`there is already a command "${command.id}"`);
    if (command.shortcut) parseCombo(command.shortcut, this.#mac);       // refuse a shortcut that cannot be read
    this.#commands.set(command.id, command);
    this.emit('change');
    return () => this.unregister(command.id);
  }

  unregister(id) {
    if (this.#commands.delete(id)) this.emit('change');
  }

  get(id) { return this.#commands.get(id); }

  /** The commands that can be used right now. */
  list({ includeDisabled = false } = {}) {
    return [...this.#commands.values()].filter((c) => includeDisabled || !c.enabled || c.enabled());
  }

  /** The shortcut a command responds to now: the user's choice, else its own default, else none. */
  shortcutOf(id) {
    if (this.#overrides.has(id)) return this.#overrides.get(id) ?? undefined;
    return this.#commands.get(id)?.shortcut;
  }

  /** How the shortcut is written on this computer, or an empty text. */
  shortcutLabel(id) {
    const s = this.shortcutOf(id);
    return s ? formatCombo(s, this.#mac) : '';
  }

  /** Choose a different shortcut for a command (or `null` for none). Returns the other commands that already use it. */
  rebind(id, shortcut) {
    if (!this.#commands.has(id)) throw new Error(`no command "${id}"`);
    if (shortcut) parseCombo(shortcut, this.#mac);
    this.#overrides.set(id, shortcut);
    this.emit('change');
    return shortcut ? this.conflictsOf(id) : [];
  }

  /** Put every shortcut back to its default. */
  resetShortcuts() {
    this.#overrides.clear();
    this.emit('change');
  }

  /** The user's shortcut choices, as plain data to be saved. */
  get overrides() { return Object.fromEntries(this.#overrides); }

  /** Load saved shortcut choices (ones for commands that no longer exist, or that cannot be read, are ignored). */
  loadOverrides(saved) {
    this.#overrides.clear();
    for (const [id, shortcut] of Object.entries(saved ?? {})) {
      try {
        if (shortcut) parseCombo(shortcut, this.#mac);
        this.#overrides.set(id, shortcut || null);
      } catch { /* an unreadable saved shortcut is dropped */ }
    }
    this.emit('change');
  }

  /** Other commands that respond to the same shortcut as this one. */
  conflictsOf(id) {
    const mine = this.shortcutOf(id);
    if (!mine) return [];
    const key = normalizeCombo(mine, this.#mac);
    const same = (other) => other !== id && this.shortcutOf(other) && normalizeCombo(this.shortcutOf(other), this.#mac) === key;
    return [...this.#commands.keys()].filter(same);
  }

  /** Every shortcut that two or more commands share. */
  allConflicts() {
    const byKey = new Map();
    for (const id of this.#commands.keys()) {
      const s = this.shortcutOf(id);
      if (!s) continue;
      const key = normalizeCombo(s, this.#mac);
      byKey.set(key, [...(byKey.get(key) ?? []), id]);
    }
    return [...byKey.entries()].filter(([, ids]) => ids.length > 1).map(([shortcut, ids]) => ({ shortcut, ids }));
  }

  /** Run a command by id. Resolves with whatever it returns; refuses (rejects) for an unknown or currently disabled command. */
  async execute(id, args) {
    const c = this.#commands.get(id);
    if (!c) throw new Error(`no command "${id}"`);
    if (c.enabled && !c.enabled()) throw new Error(`"${c.title}" cannot be used right now`);
    this.#recent = [id, ...this.#recent.filter((r) => r !== id)].slice(0, 20);
    this.emit('run', id);
    return c.run(args);
  }

  /** Command ids, the most recently run first (for the search box and "run the last command"). */
  get recent() { return [...this.#recent]; }
  set recent(ids) { this.#recent = [...ids].slice(0, 20); }

  /**
   * Offer a key press to the commands. Runs the first enabled command whose shortcut matches.
   * @param {KeyboardEvent | {key: string, ctrlKey?: boolean, altKey?: boolean, shiftKey?: boolean, metaKey?: boolean}} e
   * @returns {boolean} true if a command took it (the caller should then stop the browser's own handling)
   */
  handleKey(e) {
    for (const c of this.#commands.values()) {
      const shortcut = this.shortcutOf(c.id);
      if (!shortcut || (c.enabled && !c.enabled())) continue;
      if (comboMatches(shortcut, e, this.#mac)) {
        this.execute(c.id).catch((error) => this.emit('error', error, c.id));
        return true;
      }
    }
    return false;
  }
}
