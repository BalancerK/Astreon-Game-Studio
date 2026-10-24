// The studio's settings: a small list of named values with a type, a default and a range. A value that is wrong (hand-edited, or saved by an older or
// newer studio) is replaced by something valid instead of breaking anything. Storage is passed in (the browser's localStorage, or a plain object in tests).
import { Emitter } from '../util/emitter.js';
import { EDITOR_THEMES, EDITOR_THEME_NAMES, ACCENT_NAMES, FONT_NAMES } from '../ui/themes.js';

/**
 * @typedef {{type: 'choice', default: string, choices: string[], label: string}
 *   | {type: 'number', default: number, min: number, max: number, step?: number, label: string}
 *   | {type: 'boolean', default: boolean, label: string}} Setting
 */

/** @type {Record<string, Setting>} */
export const SCHEMA = {
  theme: { type: 'choice', default: 'system', choices: ['system', 'light', 'dark', 'contrast'], label: 'Colour theme (contrast = high contrast)' },
  editorTheme: {
    type: 'choice', default: 'auto', choices: ['auto', ...Object.keys(EDITOR_THEMES)], names: EDITOR_THEME_NAMES, label: 'Code colours',
  },
  accent: {
    type: 'choice', default: 'indigo', choices: Object.keys(ACCENT_NAMES), names: ACCENT_NAMES, label: 'Accent colour (buttons and selections)',
  },
  fontFamily: {
    type: 'choice', default: 'system', choices: Object.keys(FONT_NAMES), names: FONT_NAMES, label: 'Code font (used if it is on this computer)',
  },
  fontSize: { type: 'number', default: 14, min: 11, max: 28, step: 1, label: 'Code font size' },
  lineHeight: { type: 'number', default: 1.45, min: 1.2, max: 2, step: 0.05, label: 'Space between lines of code (1.45 is usual)' },
  ligatures: { type: 'boolean', default: false, label: 'Join signs like => into one (fonts that have it)' },
  highlightLine: { type: 'boolean', default: true, label: 'Shade the line the cursor is on' },
  indentGuides: { type: 'boolean', default: true, label: 'Thin lines showing how far code is indented' },
  minimap: { type: 'boolean', default: true, label: 'A small overview of the whole file beside long code' },
  wrapLines: { type: 'boolean', default: true, label: 'Wrap long lines in the editor' },
  tabSize: { type: 'number', default: 2, min: 1, max: 8, step: 1, label: 'Spaces per tab' },
  uiScale: { type: 'number', default: 100, min: 80, max: 200, step: 10, label: 'Interface size (%)' },
  reduceMotion: { type: 'boolean', default: false, label: 'Reduce motion' },
  autoRun: { type: 'boolean', default: true, label: 'Run the game when the code changes' },
  autoRunDelay: { type: 'number', default: 150, min: 0, max: 2000, step: 50, label: 'Wait after typing before running (ms)' },
  autoSnapshotMinutes: { type: 'number', default: 5, min: 1, max: 60, step: 1, label: 'Save a restore point every (minutes of work)' },
  language: { type: 'choice', default: 'en', choices: ['en'], label: 'Language' },
};

/** Make any value fit a setting's type and range. */
export function clean(setting, value) {
  if (setting.type === 'boolean') return typeof value === 'boolean' ? value : setting.default;
  if (setting.type === 'choice') return setting.choices.includes(value) ? value : setting.default;
  const n = typeof value === 'number' && Number.isFinite(value) ? value : setting.default;
  const stepped = setting.step ? Math.round(n / setting.step) * setting.step : n;
  return Math.min(setting.max, Math.max(setting.min, stepped));
}

const KEY = 'studio.settings';

export class Settings extends Emitter {
  #values = {};
  #storage;
  #schema;

  /** @param {{getItem(k: string): string | null, setItem(k: string, v: string): void} | null} storage @param {Record<string, Setting>} [schema] */
  constructor(storage, schema = SCHEMA) {
    super();
    this.#storage = storage;
    this.#schema = schema;
    for (const [name, s] of Object.entries(schema)) this.#values[name] = s.default;
    this.#load();
  }

  #load() {
    let saved = {};
    try { saved = JSON.parse(this.#storage?.getItem(KEY) ?? '{}') ?? {}; } catch { /* unreadable: use the defaults */ }
    for (const [name, s] of Object.entries(this.#schema)) if (name in saved) this.#values[name] = clean(s, saved[name]);
  }

  #save() {
    try {
      this.#storage?.setItem(KEY, JSON.stringify(this.#values));
    } catch {
      /* storage full or blocked: the settings last until the page closes */
    }
  }

  get schema() { return this.#schema; }

  get(name) {
    if (!(name in this.#schema)) throw new Error(`no setting "${name}"`);
    return this.#values[name];
  }

  /** Change a setting. Returns the value that was really stored (it may have been adjusted to fit). */
  set(name, value) {
    if (!(name in this.#schema)) throw new Error(`no setting "${name}"`);
    const v = clean(this.#schema[name], value);
    if (v === this.#values[name]) return v;
    this.#values[name] = v;
    this.#save();
    this.emit('change', name, v);
    return v;
  }

  reset(name) {
    for (const n of name ? [name] : Object.keys(this.#schema)) this.set(n, this.#schema[n].default);
  }

  /** Everything, as plain data. */
  toJSON() { return { ...this.#values }; }
}
