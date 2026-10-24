// The Controls panel's logic: the actions a game has (jump, fire, pause...), the keys each starts with, what the settings start as, and which settings the menu offers. Kept in
// `src/controls.js` as plain JSON:
//
//   export default { "actions": { "fire": ["KeyX"] }, "settings": { "musicVolume": 0.6 }, "offer": ["masterVolume", "musicVolume", "textScale"] };
//
// The game reads it with `controls(setup.actions)`, `settings(setup.settings)` and `openSettingsMenu(game, { offer: setup.offer })`. What the built-in actions are, what a
// setting may be, and how a key code reads are the kit's own, so the panel and the game agree.
import { SETTING_SPEC, SETTING_NAMES, BUILT_IN_ACTIONS, BINDING_LIMITS, cleanSetting, keyName } from '../../../packages/arcade/src/settings.js';

export { SETTING_SPEC, SETTING_NAMES, BUILT_IN_ACTIONS, BINDING_LIMITS, keyName };

const clone = (x) => JSON.parse(JSON.stringify(x));
export const ACTION = /^[A-Za-z][\w-]{0,23}$/;
export const CODE = /^[A-Za-z][A-Za-z0-9]{0,23}$/;

/** The actions that need no setting up (the arrow keys, WASD, jump...). The panel shows them, and a game can change their usual keys. */
export const BUILT_IN_NAMES = Object.keys(BUILT_IN_ACTIONS).filter((a) => !['click', 'rightClick', 'space'].includes(a));

/** A starting file: no actions of its own, every setting offered. */
export function newControls() {
  return { actions: {}, settings: {}, offer: [...SETTING_NAMES] };
}

// ---------- the file ----------

/** The controls as the text of a file. */
export function serializeControls(c) {
  const note = '// Made with the studio\'s Controls panel. Actions are what the player can do; each has the keys it starts with, '
    + 'and the player can change them.';
  const use = '// Use it with controls(setup.actions), settings(setup.settings) and openSettingsMenu(game, { offer: setup.offer }) '
    + 'from @engine/arcade.';
  return `${note}\n${use}\nexport default ${JSON.stringify(c, null, 2)};\n`;
}

/** Make anything read from a file into controls that are safe to use. */
export function cleanControls(raw) {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const actions = {};
  for (const [name, codes] of Object.entries(r.actions && typeof r.actions === 'object' ? r.actions : {})) {
    const keys = [...new Set((Array.isArray(codes) ? codes : []).filter((k) => typeof k === 'string' && CODE.test(k)))].slice(0,
      BINDING_LIMITS.codes);
    if (ACTION.test(name) && keys.length && Object.keys(actions).length < BINDING_LIMITS.actions) actions[name] = keys;
  }
  const settings = {};
  for (const [name, v] of Object.entries(r.settings && typeof r.settings === 'object' ? r.settings : {})) {
    const spec = SETTING_SPEC[name];
    if (spec && (spec.kind === 'flag' ? typeof v === 'boolean' : Number.isFinite(v))) settings[name] = cleanSetting(name, v);
  }
  const offer = Array.isArray(r.offer) ? [...new Set(r.offer.filter((n) => SETTING_SPEC[n]))] : [...SETTING_NAMES];
  return { actions, settings, offer };
}

/** Read a controls file. Throws an Error that says what is wrong. */
export function parseControls(text) {
  const m = /export\s+default\s+([\s\S]*?);?\s*$/.exec(String(text ?? ''));
  if (!m) throw new Error('This file is not a set of controls: it should say "export default { ... }".');
  let data;
  try {
    data = JSON.parse(m[1]);
  } catch {
    throw new Error('This controls file has been edited into something the Controls panel cannot read. '
      + 'Keep the part after "export default" as plain JSON.');
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('The controls file should hold an object with actions, settings and offer.');
  }
  return cleanControls(data);
}

// ---------- changing the controls ----------

/** Why an action name cannot be used, or null. */
export function actionProblem(c, name) {
  if (!ACTION.test(name)) return 'Use letters and numbers, starting with a letter (up to 24)';
  if (name in c.actions || BUILT_IN_NAMES.includes(name) || ['space', 'click',
    'rightClick'].includes(name)) return 'There is already an action with that name';
  if (Object.keys(c.actions).length >= BINDING_LIMITS.actions) return `At most ${BINDING_LIMITS.actions} actions`;
  return null;
}

/** The keys an action starts with: the game's own, else the built-in ones. */
export const keysOf = (c, action) => c.actions[action] ?? BUILT_IN_ACTIONS[action] ?? [];

/** An action added with its first key. */
export function addAction(c, name, code) {
  const out = clone(c);
  out.actions[name] = [code];
  return out;
}

/** An action taken away (a built-in one just goes back to its usual keys). */
export function removeAction(c, name) {
  const out = clone(c);
  delete out.actions[name];
  return out;
}

/** A key added to an action (up to three; one that is already there is not repeated). */
export function addKey(c, action, code) {
  if (!CODE.test(code)) return c;
  const keys = keysOf(c, action);
  if (keys.includes(code) || keys.length >= BINDING_LIMITS.codes) return c;
  const out = clone(c);
  out.actions[action] = [...keys, code];
  return out;
}

/** A key taken from an action (the last one cannot go: an action always has a key). */
export function removeKey(c, action, code) {
  const keys = keysOf(c, action).filter((k) => k !== code);
  if (!keys.length) return c;
  const out = clone(c);
  out.actions[action] = keys;
  // the usual keys again: nothing to say in the file
  if (JSON.stringify(keys) === JSON.stringify(BUILT_IN_ACTIONS[action])) delete out.actions[action];
  return out;
}

/** The other actions that start with a key. */
export function clashes(c, action, code) {
  const names = [...BUILT_IN_NAMES, ...Object.keys(c.actions)];
  return [...new Set(names)].filter((a) => a !== action && keysOf(c, a).includes(code));
}

/** What a setting starts as (the game's choice, or the kit's). */
export const startOf = (c, name) => (name in c.settings ? c.settings[name] : SETTING_SPEC[name].default);

/** A setting's starting value changed (kept in range). Setting it to what the kit would use anyway takes it out of the file. */
export function setStart(c, name, value) {
  const out = clone(c);
  const v = cleanSetting(name, value, SETTING_SPEC[name].default);
  if (v === SETTING_SPEC[name].default) delete out.settings[name]; else out.settings[name] = v;
  return out;
}

/** Whether the menu offers a setting. */
export function setOffered(c, name, on) {
  const out = clone(c);
  out.offer = SETTING_NAMES.filter((n) => (n === name ? on : out.offer.includes(n)));
  return out;
}
