// The Kinds panel's logic: what each kind of thing looks like when it is first placed (its template) and which fields its things have (a number, some text, a yes-or-no, one choice, or
// a pointer to another thing), kept in `src/kinds.js` as plain JSON:
//
//   export default { "door": { "template": { "w": 32, "h": 48, "color": "#c8a064" }, "fields": { "locked": { "type": "flag", "default": true } } } };
//
// This builds and changes the table, holds every setting to what the kit accepts (the kit's own `cleanField` and `cleanKinds`), and reads and writes the file.
import { cleanField, cleanKinds, kindProblems, FIELD_TYPES, KIND_LIMITS, isReservedField,
  fieldDefaults } from '../../../packages/arcade/src/kinds.js';

export { cleanField, cleanKinds, kindProblems, FIELD_TYPES, KIND_LIMITS, fieldDefaults };

const clone = (x) => JSON.parse(JSON.stringify(x));
export const NAME = /^[A-Za-z_][\w-]{0,31}$/;
export const FIELD = /^[a-z_$][\w$]{0,31}$/i;

/** Ready-made kinds to start from. */
export const STARTERS = {
  door: () => ({ template: { w: 32, h: 48, color: '#c8a064' }, fields: { locked: { type: 'flag', default: true } } }),
  button: () => ({ template: { w: 24, h: 12, color: '#d94f4f' }, fields: {
    opens: { type: 'ref', to: 'door' }, delay: { type: 'number', default: 0, min: 0, max: 10, step: 0.5 },
  } }),
  enemy: () => ({ template: { w: 28, h: 28, color: '#e84a5f' }, fields: {
    hp: { type: 'number', default: 2, min: 1, max: 99, step: 1 }, mood: { type: 'choice', choices: ['calm', 'angry', 'asleep'], default: 'calm' },
  } }),
  sign: () => ({ template: { w: 24, h: 28, emoji: '🪧' }, fields: { text: { type: 'text', default: 'Hello!' } } }),
};

/** A name for a new kind that is not taken. */
export function freeName(taken, wanted) {
  const base = String(wanted).replace(/[^\w-]/g, '').replace(/^[^A-Za-z_]+/, '') || 'kind';
  if (!(base in taken)) return base;
  for (let n = 2; n < 1000; n++) if (!(`${base}${n}` in taken)) return `${base}${n}`;
  return `${base}${Date.now()}`;
}

/** Why a kind name cannot be used, or null. */
export function nameProblem(name, table) {
  if (!NAME.test(name)) return 'Use letters, numbers, - and _, starting with a letter';
  return name in table ? 'There is already a kind with that name' : null;
}

/** Why a field name cannot be used for a kind, or null. */
export function fieldNameProblem(table, kind, name) {
  if (!FIELD.test(name)) return 'Use a name like speed or opensDoor: letters and numbers, starting with a letter';
  if (isReservedField(name)) return `Every thing already has "${name}": pick another name`;
  if (name in (table[kind]?.fields ?? {})) return 'This kind already has a field with that name';
  if (Object.keys(table[kind]?.fields ?? {}).length >= KIND_LIMITS.fields) return `At most ${KIND_LIMITS.fields} fields`;
  return null;
}

// ---------- the file ----------

/** The table as the text of a file. */
export function serializeKinds(table) {
  const body = Object.entries(table).map(([name, d]) => `  ${JSON.stringify(name)}: ${JSON.stringify(d)}`).join(',\n');
  const note = '// Made with the studio\'s Kinds panel. Each kind has a template (how it looks when placed) and fields (a type for each).';
  const use = '// Use it with loadScene(game, scene, kinds) from @engine/arcade: every thing gets the fields of its kind.';
  return `${note}\n${use}\nexport default {\n${body}\n};\n`;
}

/** Read a kinds file. Throws an Error that says what is wrong. */
export function parseKinds(text) {
  const m = /export\s+default\s+([\s\S]*?);?\s*$/.exec(String(text ?? ''));
  if (!m) throw new Error('This file is not a set of kinds: it should say "export default { ... }".');
  let data;
  try {
    data = JSON.parse(m[1]);
  } catch {
    throw new Error('This kinds file has been edited into something the Kinds panel cannot read. '
      + 'Keep the part after "export default" as plain JSON.');
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('The kinds file should hold an object of named kinds.');
  return cleanKinds(data);
}

// ---------- changing it ----------

/** A kind added (from a starter, or empty). */
export function addKind(table, name, starter) {
  if (nameProblem(name, table)) throw new Error(nameProblem(name, table));
  if (Object.keys(table).length >= KIND_LIMITS.kinds) throw new Error(`At most ${KIND_LIMITS.kinds} kinds.`);
  return { ...clone(table), [name]: starter ? STARTERS[starter]() : { template: { w: 32, h: 32, color: '#5ac8ff' }, fields: {} } };
}

/** A kind taken away. */
export function removeKind(table, name) {
  const out = clone(table);
  delete out[name];
  return out;
}

/** Change a kind's template (size, colour, emoji, picture); an empty value takes that part out. */
export function setTemplate(table, kind, props) {
  const out = clone(table);
  const t = { ...out[kind].template };
  for (const [k, v] of Object.entries(props)) {
    if (!['w', 'h', 'color', 'emoji', 'image'].includes(k)) throw new Error(`"${k}" is not part of a template.`);
    if (v === '' || v === undefined || v === null) delete t[k]; else t[k] = v;
  }
  out[kind].template = cleanKinds({ [kind]: { template: t, fields: {} } })[kind].template;
  return out;
}

/** A field added to a kind, as its type starts. */
export function addField(table, kind, name, type) {
  const problem = fieldNameProblem(table, kind, name);
  if (problem) throw new Error(problem);
  const field = cleanField({ type });
  if (!field) throw new Error(`There is no type of field called "${type}".`);
  const out = clone(table);
  out[kind].fields[name] = field;
  return out;
}

/** A field taken away. */
export function removeField(table, kind, name) {
  const out = clone(table);
  delete out[kind].fields[name];
  return out;
}

/** Change a field's settings (its type, default, smallest, largest, choices, or the kind a pointer must point at), kept to what the kit accepts. */
export function setField(table, kind, name, props) {
  const out = clone(table);
  const merged = { ...out[kind].fields[name], ...props };
  if (props.type && props.type !== out[kind].fields[name].type) for (const k of ['default', 'min', 'max', 'step', 'choices',
    'to']) if (!(k in props)) delete merged[k];
  if (typeof props.choices === 'string') merged.choices = props.choices.split(',').map((c) => c.trim()).filter(Boolean);
  const clean = cleanField(merged);
  if (!clean) throw new Error('That is not a type of field.');
  out[kind].fields[name] = clean;
  return out;
}

/** A field moved up or down in the list. */
export function moveField(table, kind, name, by) {
  const out = clone(table);
  const names = Object.keys(out[kind].fields);
  const at = names.indexOf(name);
  const to = Math.max(0, Math.min(names.length - 1, at + by));
  names.splice(to, 0, names.splice(at, 1)[0]);
  out[kind].fields = Object.fromEntries(names.map((n) => [n, out[kind].fields[n]]));
  return out;
}

/** What a thing of this kind starts with when it is placed in a scene: its template, and an `extra` with the starting value of each field. */
export function placement(table, kind) {
  const def = table[kind];
  if (!def) return {};
  const extra = fieldDefaults(table, kind);
  return { ...clone(def.template), ...(Object.keys(extra).length ? { extra } : {}) };
}
