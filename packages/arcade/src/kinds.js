// Kinds with their own fields. A kind of thing ("door", "button", "enemy") can say what it looks like when it is first placed (its template) and which fields its things have,
// each with a type: a number (with a smallest and a largest), some text, a yes-or-no, one choice from a list, or a pointer to another thing by its name (a button that opens THAT
// door). Plain data, made in the studio's Kinds panel and kept in `src/kinds.js`:
//
//   const kinds = { door:   { template: { w: 32, h: 48, color: '#c8a064' }, fields: { locked: { type: 'flag', default: true } } },
//                   button: { fields: { opens: { type: 'ref', to: 'door' }, delay: { type: 'number', default: 0, min: 0, max: 10, step: 0.5 } } } };
//   const world = loadScene(game, scene, kinds);           // every door gets `locked`, every button `opens` and `delay`, with the defaults filled in
//   const door = refOf(game, button, 'opens');             // the door that this button points at (or undefined)

import { all } from './things.js';

/** What each type of field is. */
export const FIELD_TYPES = {
  number: 'A number, with a smallest and a largest',
  text: 'Some words',
  flag: 'Yes or no',
  choice: 'One choice from a list',
  ref: 'A pointer to another thing, by its name',
};

/** The limits a kinds file is held to. */
export const KIND_LIMITS = { kinds: 64, fields: 24, choices: 16, name: 32, text: 200 };

const NAME = /^[A-Za-z_][\w-]{0,31}$/;
const FIELD = /^[a-z_$][\w$]{0,31}$/i;
const RESERVED = new Set(['kind', 'x', 'y', 'w', 'h', 'color', 'emoji', 'image', 'id', 'extra', 'hidden', 'alpha', 'flip', 'sprite', 'frame', 'bs']);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** Is this word one that a field cannot be called, because things already have it? */
export const isReservedField = (name) => RESERVED.has(name);

/**
 * Make one field safe: a known type, its settings there and in range, and a default that fits.
 * @param {unknown} spec
 * @returns {object | null}
 */
export function cleanField(spec) {
  const type = spec?.type;
  if (!FIELD_TYPES[type]) return null;
  if (type === 'number') {
    const min = Number.isFinite(spec.min) ? spec.min : -100000;
    const max = Number.isFinite(spec.max) ? Math.max(min, spec.max) : Math.max(min, 100000);
    const step = Number.isFinite(spec.step) && spec.step > 0 ? spec.step : 1;
    return { type, default: clamp(Number.isFinite(spec.default) ? spec.default : clamp(0, min, max), min, max), min, max, step };
  }
  if (type === 'flag') return { type, default: spec.default === true };
  if (type === 'choice') {
    const choices = [...new Set((Array.isArray(spec.choices) ? spec.choices : []).filter((c) => typeof c === 'string' && c && c.length <= KIND_LIMITS.name))]
      .slice(0, KIND_LIMITS.choices);
    const list = choices.length ? choices : ['a', 'b'];
    return { type, choices: list, default: list.includes(spec.default) ? spec.default : list[0] };
  }
  if (type === 'ref') return { type, to: typeof spec.to === 'string' && NAME.test(spec.to) ? spec.to : '' };
  return { type, default: typeof spec.default === 'string' ? spec.default.slice(0, KIND_LIMITS.text) : '' };
}

/**
 * Make a kinds table safe: every kind with a name that fits, a template that is plain (a size, a colour, an emoji or a picture) and fields that are clean.
 * @param {unknown} table
 * @returns {Object<string, {template: object, fields: Object<string, object>}>}
 */
export function cleanKinds(table) {
  const out = {};
  for (const [kind, def] of Object.entries(table && typeof table === 'object' ? table : {}).slice(0, KIND_LIMITS.kinds)) {
    if (!NAME.test(kind) || !def || typeof def !== 'object') continue;
    const template = {};
    const t = def.template ?? {};
    for (const k of ['w', 'h']) if (Number.isFinite(t[k]) && t[k] > 0 && t[k] <= 8192) template[k] = Math.round(t[k]);
    for (const k of ['color', 'emoji', 'image']) if (typeof t[k] === 'string' && t[k] && t[k].length <= 80) template[k] = t[k];
    const fields = {};
    for (const [name, spec] of Object.entries(def.fields ?? {}).slice(0, KIND_LIMITS.fields)) {
      const clean = FIELD.test(name) && !RESERVED.has(name) ? cleanField(spec) : null;
      if (clean) fields[name] = clean;
    }
    out[kind] = { template, fields };
  }
  return out;
}

/**
 * The starting values of a kind's fields, as `{ locked: true, delay: 0 }` (a pointer starts with nothing).
 * @param {Object<string, object>} kinds
 * @param {string} kind
 */
export function fieldDefaults(kinds, kind) {
  const out = {};
  for (const [name, f] of Object.entries(kinds?.[kind]?.fields ?? {})) if (f.type !== 'ref' && f.default !== undefined) out[name] = f.default;
  return out;
}

/**
 * Make a value fit a field: a number is held between its smallest and largest, a choice must be one of the list, a flag is yes or no.
 * @param {object} field
 * @param {unknown} value
 */
export function fitValue(field, value) {
  if (field.type === 'number') return clamp(Number.isFinite(+value) ? +value : field.default, field.min, field.max);
  if (field.type === 'flag') return value === true || value === 'true';
  if (field.type === 'choice') return field.choices.includes(value) ? value : field.default;
  if (field.type === 'ref') return typeof value === 'string' ? value : '';
  return typeof value === 'string' ? value.slice(0, KIND_LIMITS.text) : String(value ?? '').slice(0, KIND_LIMITS.text);
}

/**
 * The first thing in the game with this name (`thing.name`), or undefined.
 * @param {{things: import('./things.js').Thing[]}} game
 * @param {string} name
 * @returns {import('./things.js').Thing | undefined}
 */
export function named(game, name) {
  return name ? all(game).find((t) => t.name === name) : undefined;
}

/**
 * The thing that one of a thing's pointer fields points at: `refOf(game, button, 'opens')` is the door the button opens, or undefined if it points at nothing or the thing is gone.
 * @param {{things: import('./things.js').Thing[]}} game
 * @param {import('./things.js').Thing} thing
 * @param {string} field
 * @returns {import('./things.js').Thing | undefined}
 */
export function refOf(game, thing, field) {
  return named(game, thing?.[field]);
}

/**
 * Say what is wrong with a kinds table, in plain words.
 * @param {Object<string, object>} table
 * @returns {{kind: string, field: string, message: string}[]}
 */
export function kindProblems(table) {
  const out = [];
  const add = (kind, field, message) => out.push({ kind, field, message });
  const entries = Object.entries(table ?? {});
  if (entries.length > KIND_LIMITS.kinds) add('', '', `At most ${KIND_LIMITS.kinds} kinds.`);
  for (const [kind, def] of entries) {
    if (!NAME.test(kind)) { add(kind, '', `"${kind}" is not a name for a kind (letters, digits, - and _, starting with a letter).`); continue; }
    const fields = Object.entries(def?.fields ?? {});
    if (fields.length > KIND_LIMITS.fields) add(kind, '', `"${kind}" has more than ${KIND_LIMITS.fields} fields.`);
    for (const [name, f] of fields) {
      if (!FIELD.test(name)) add(kind, name, `"${name}" is not a name for a field (letters, digits, _ and $).`);
      else if (RESERVED.has(name)) add(kind, name, `"${name}" is already something every thing has: pick another name for the field.`);
      else if (!FIELD_TYPES[f?.type]) add(kind, name,
        `The field "${name}" of "${kind}" has no type the kit knows (use ${Object.keys(FIELD_TYPES).join(', ')}).`);
      else if (f.type === 'number' && !(f.min <= f.max)) add(kind, name, `The field "${name}" of "${kind}" has a smallest above its largest.`);
      else if (f.type === 'choice' && !(Array.isArray(f.choices) && f.choices.length)) add(kind, name,
        `The field "${name}" of "${kind}" has nothing to choose from.`);
      else if (f.type === 'ref' && f.to && !(f.to in table)) add(kind, name,
        `The field "${name}" of "${kind}" points at "${f.to}", which is not a kind.`);
    }
  }
  return out;
}

/**
 * Look over a scene against the kinds and say what is wrong with its things' fields: a pointer to a name nothing has, to a thing of the wrong kind, a name used twice, a number out of its range.
 * @param {{things: Array<{kind: string, extra?: object}>}} scene
 * @param {Object<string, object>} kinds
 * @returns {{index: number, message: string}[]}
 */
export function sceneFieldProblems(scene, kinds) {
  const out = [];
  const things = scene?.things ?? [];
  const byName = new Map();
  things.forEach((t, index) => {
    const name = t.extra?.name;
    if (!name) return;
    if (byName.has(name)) out.push({ index,
      message: `Thing ${index + 1} (${t.kind}) has the name "${name}", which thing ${byName.get(name) + 1} has too.` });
    else byName.set(name, index);
  });
  things.forEach((t, index) => {
    for (const [field, f] of Object.entries(kinds?.[t.kind]?.fields ?? {})) {
      const v = t.extra?.[field];
      if (f.type === 'ref' && v) {
        const to = byName.get(v);
        if (to === undefined) out.push({ index,
          message: `Thing ${index + 1} (${t.kind}): "${field}" points at "${v}", but nothing in the scene has that name.` });
        else if (f.to && things[to].kind !== f.to) out.push({ index,
          message: `Thing ${index + 1} (${t.kind}): "${field}" should point at a ${f.to}, but "${v}" is a ${things[to].kind}.` });
      } else if (v !== undefined && f.type === 'number' && !(v >= f.min && v <= f.max)) {
        out.push({ index, message: `Thing ${index + 1} (${t.kind}): "${field}" is ${v}, outside ${f.min} to ${f.max}.` });
      } else if (v !== undefined && f.type === 'choice' && !f.choices.includes(v)) {
        out.push({ index, message: `Thing ${index + 1} (${t.kind}): "${field}" is "${v}", which is not one of ${f.choices.join(', ')}.` });
      }
    }
  });
  return out;
}
