// What players can change: which keys do what, how loud things are, how big the text is, whether there are captions, whether the screen shakes, whether the colours are
// high contrast. These are the things players of games complain about most when they are missing, so the kit makes each of them one line:
//
//   controls({ fire: ['KeyX'], pause: ['Escape'] });     // your own actions, with their usual keys (the built-in ones: left, right, up, down, jump, action...)
//   settings();                                           // once: loads what the player chose last time
//   if (held(keys, 'fire')) ...                           // works with whatever keys the player picked
//   caption(game, '[door creaks]');                       // words for a sound, shown when the player has captions on
//
// Choices are saved with the game's progress (under its own name, so `saveProgress` never loses them). Nothing here touches the page.
import { loadProgress, saveProgress } from './progress.js';

/** The settings: what each is called, what it can be, and what it starts as. */
export const SETTING_SPEC = {
  masterVolume: { label: 'Master volume', kind: 'number', min: 0, max: 1, step: 0.1, default: 1 },
  effectsVolume: { label: 'Sound effects', kind: 'number', min: 0, max: 1, step: 0.1, default: 1 },
  musicVolume: { label: 'Music', kind: 'number', min: 0, max: 1, step: 0.1, default: 1 },
  textScale: { label: 'Text size', kind: 'number', min: 0.75, max: 2, step: 0.25, default: 1 },
  subtitles: { label: 'Captions for sounds', kind: 'flag', default: true },
  reducedMotion: { label: 'Reduce screen shake', kind: 'flag', default: false },
  highContrast: { label: 'High contrast', kind: 'flag', default: false },
};
export const SETTING_NAMES = Object.keys(SETTING_SPEC);
export const BINDING_LIMITS = { codes: 3, actions: 32 };

/** The keys the built-in actions use, before the game or the player changes anything. */
const BUILT_IN = {
  left: ['ArrowLeft', 'KeyA'], right: ['ArrowRight', 'KeyD'], up: ['ArrowUp', 'KeyW'], down: ['ArrowDown', 'KeyS'], space: ['Space'],
  jump: ['Space', 'ArrowUp', 'KeyW'], action: ['KeyX', 'KeyZ', 'Enter'], click: ['Mouse0'], rightClick: ['Mouse2'],
};
const ACTION = /^[A-Za-z][\w-]{0,23}$/;
const CODE = /^[A-Za-z][A-Za-z0-9]{0,23}$/;

/** The built-in actions and their usual keys (for the studio's Controls panel). */
export const BUILT_IN_ACTIONS = Object.freeze(Object.fromEntries(Object.entries(BUILT_IN).map(([k, v]) => [k, Object.freeze([...v])])));

let defaults = { ...BUILT_IN };           // action -> the keys the game gives it
let chosen = {};                          // action -> the keys the player picked
let values = Object.fromEntries(SETTING_NAMES.map((n) => [n, SETTING_SPEC[n].default]));
let gameDefaults = {};                    // what the game says the settings start as
let listeners = [];

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const cleanCodes = (list) => [...new Set((Array.isArray(list) ? list : []).filter((c) => typeof c === 'string' && CODE.test(c)))].slice(0, BINDING_LIMITS.codes);

/** One setting made safe: a number kept in range (to its step), a flag true or false, anything else its starting value. */
export function cleanSetting(name, value, base = gameDefaults[name] ?? SETTING_SPEC[name]?.default) {
  const spec = SETTING_SPEC[name];
  if (!spec) return undefined;
  if (spec.kind === 'flag') return typeof value === 'boolean' ? value : base;
  if (!Number.isFinite(value)) return base;
  const stepped = Math.round(value / spec.step) * spec.step;
  return Math.round(clamp(stepped, spec.min, spec.max) * 1000) / 1000;
}

function persist() {
  const progress = loadProgress();
  progress.__settings = { values: { ...values }, keys: structuredClone(chosen) };
  saveProgress(progress);
}
const notify = (what) => { for (const fn of listeners) fn(what); };

/**
 * Give the game its own actions, each with the keys it uses by default. A player can still change them.
 * @param {Object<string, string[]>} actions for example `{ fire: ['KeyX'], pause: ['Escape'] }`
 */
export function controls(actions) {
  defaults = { ...BUILT_IN };
  for (const [name, codes] of Object.entries(actions ?? {})) {
    if (Object.keys(defaults).length >= BINDING_LIMITS.actions) break;
    if (ACTION.test(name) && cleanCodes(codes).length) defaults[name] = cleanCodes(codes);
  }
}

/**
 * Start the settings: loads what the player chose last time, and sets what the game would like as the starting values.
 * @param {Object<string, number | boolean>} [start] for example `{ musicVolume: 0.6 }`
 * @returns {Object<string, number | boolean>} the values now
 */
export function settings(start = {}) {
  gameDefaults = {};
  for (const n of SETTING_NAMES) if (n in start) gameDefaults[n] = cleanSetting(n, start[n], SETTING_SPEC[n].default);
  const saved = loadProgress().__settings;
  values = Object.fromEntries(SETTING_NAMES.map((n) => [n, cleanSetting(n, saved?.values?.[n])]));
  chosen = {};
  for (const [action, codes] of Object.entries(saved?.keys ?? {})) if (ACTION.test(action) && cleanCodes(codes).length) chosen[action] = cleanCodes(codes);
  notify('all');
  return { ...values };
}

/** The value of a setting. */
export const getSetting = (name) => values[name];

/** Every setting's value. */
export const settingsValues = () => ({ ...values });

/** Change a setting (kept in range) and keep it for next time. Returns the value it now has. */
export function setSetting(name, value) {
  if (!SETTING_SPEC[name]) throw new Error(`There is no setting called "${name}" (they are: ${SETTING_NAMES.join(', ')}).`);
  values[name] = cleanSetting(name, value);
  persist();
  notify(name);
  return values[name];
}

/** Put every setting (and every key) back to what the game started with. */
export function resetSettings() {
  values = Object.fromEntries(SETTING_NAMES.map((n) => [n, cleanSetting(n, undefined)]));
  chosen = {};
  persist();
  notify('all');
}

/** Be told when a setting changes (the kit's music uses this to follow the volume). */
export function onSettingChange(fn) {
  listeners.push(fn);
  return () => { listeners = listeners.filter((f) => f !== fn); };
}

/** The sound effects level: master times effects. */
export const effectsLevel = () => values.masterVolume * values.effectsVolume;
/** The music level: master times music. */
export const musicLevel = () => values.masterVolume * values.musicVolume;

// ---------- keys ----------

/** The keys an action uses now: what the player picked, else what the game gave it, else the key code itself (so `held(keys, 'KeyP')` works). */
export const keysFor = (action) => chosen[action] ?? defaults[action] ?? [action];

/** Every action the game has, with its keys now and its usual keys. */
export function actionsList() {
  return Object.keys(defaults).filter((a) => !['click', 'rightClick', 'space'].includes(a)).map((action) => ({
    action, keys: keysFor(action), usual: defaults[action], changed: Boolean(chosen[action]),
  }));
}

/** The other actions that already use a key. */
export function conflictsFor(action, code) {
  return Object.keys(defaults).filter((a) => a !== action && !['click', 'rightClick', 'space'].includes(a) && keysFor(a).includes(code));
}

/** Choose the keys for an action (up to three) and keep them for next time. */
export function setBinding(action, codes) {
  if (!(action in defaults)) throw new Error(`There is no action called "${action}" (they are: ${Object.keys(defaults).join(', ')}).`);
  const clean = cleanCodes(codes);
  if (!clean.length) { delete chosen[action]; } else chosen[action] = clean;
  persist();
  return keysFor(action);
}

/** Put one action (or all) back to the game's usual keys. */
export function resetBindings(action) {
  if (action === undefined) chosen = {}; else delete chosen[action];
  persist();
}

/**
 * The key that was pressed since the last time this was asked (for "press the key you want"), or null. Keep calling it every tick while you wait.
 * @param {object} game where it remembers the keys of the last tick
 * @param {Set<string>} keys the keys held now
 */
export function newKey(game, keys) {
  const before = new Set(game.__prevKeys ?? []);
  game.__prevKeys = [...keys];
  for (const code of keys) if (!before.has(code) && !code.startsWith('Mouse')) return code;
  return null;
}

/** A key code in plain words: "Left arrow", "A", "Space", "Enter", "Shift (left)". */
export function keyName(code) {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  const words = {
    ArrowLeft: 'Left arrow', ArrowRight: 'Right arrow', ArrowUp: 'Up arrow', ArrowDown: 'Down arrow', Space: 'Space', Enter: 'Enter', Escape: 'Esc', Tab: 'Tab',
    ShiftLeft: 'Left Shift', ShiftRight: 'Right Shift', ControlLeft: 'Left Ctrl', ControlRight: 'Right Ctrl', AltLeft: 'Left Alt', AltRight: 'Right Alt', Backspace: 'Backspace',
    Mouse0: 'Left click', Mouse2: 'Right click',
  };
  return words[code] ?? code.replace(/([a-z])([A-Z0-9])/g, '$1 $2');
}

// ---------- captions ----------

/**
 * Words for a sound or something only heard, shown for a moment when the player has captions on. Call `stepCaptions` every tick and `drawCaptions` when drawing.
 * @param {object} game
 * @param {string} text for example `[door creaks]` or `Sam: Watch out!`
 * @param {number} [seconds]
 */
export function caption(game, text, seconds = 2.5) {
  if (!values.subtitles) return;
  game.captions ??= [];
  game.captions.push({ text: String(text).slice(0, 120), left: clamp(Number(seconds) || 2.5, 0.5, 20) });
  if (game.captions.length > 3) game.captions.shift();
}

/** Age the captions and remove the ones that are done. */
export function stepCaptions(game, dt) {
  if (!game.captions) return;
  for (const c of game.captions) c.left -= dt;
  game.captions = game.captions.filter((c) => c.left > 0);
}

/** Draw the captions at the bottom of the screen, as big as the player's text size says. */
export function drawCaptions(g, game, size = { width: 480, height: 320 }) {
  const list = game.captions ?? [];
  if (!list.length || !values.subtitles) return;
  const px = Math.round(16 * values.textScale);
  g.save();
  g.font = `${px}px system-ui, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  list.forEach((c, i) => {
    const w = Math.min(size.width - 20, g.measureText(c.text).width + 20);
    const y = size.height - 24 - (list.length - 1 - i) * (px + 14);
    g.fillStyle = values.highContrast ? '#000000' : 'rgba(0,0,0,0.75)';
    g.fillRect(size.width / 2 - w / 2, y - px / 2 - 5, w, px + 10);
    g.fillStyle = '#ffffff';
    g.fillText(c.text, size.width / 2, y, size.width - 30);
  });
  g.restore();
}

/** For tests: forget the settings and keys (the kit's own listeners, such as the music following the volume, stay). */
export function resetForTests() {
  defaults = { ...BUILT_IN };
  chosen = {};
  gameDefaults = {};
  values = Object.fromEntries(SETTING_NAMES.map((n) => [n, SETTING_SPEC[n].default]));
}
