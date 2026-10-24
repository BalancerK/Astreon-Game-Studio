// Names and typed fields of the things in a scene, with no page in it. A thing's name and its fields live in its `extra` (so `loadScene` hands them to the game as `thing.name` and
// `thing.locked`), which keeps the scene file as it was. These are the functions the Scene panel uses; each returns a new scene.
import { fitValue } from '../../../packages/arcade/src/kinds.js';

const clone = (x) => JSON.parse(JSON.stringify(x));
const NAME = /^[A-Za-z_][\w-]{0,31}$/;

/** The name of a thing, or an empty text. */
export const nameOf = (thing) => thing?.extra?.name ?? '';

/** Why this name cannot be used for this thing, or null. A thing may keep its own name. */
export function nameProblem(scene, index, name) {
  if (!name) return null;
  if (!NAME.test(name)) return 'A name is letters, numbers, - and _, starting with a letter';
  if (scene.things.some((t, i) => i !== index && nameOf(t) === name)) return `Another thing is already called "${name}"`;
  return null;
}

/** A name for a new thing that nothing has: "door", then "door2". */
export function freeThingName(scene, base) {
  const taken = new Set(scene.things.map(nameOf));
  const start = String(base).replace(/[^\w-]/g, '') || 'thing';
  if (!taken.has(start)) return start;
  for (let n = 2; ; n++) if (!taken.has(`${start}${n}`)) return `${start}${n}`;
}

/**
 * Give a thing a name (an empty name takes it away). Everything that pointed at its old name, in any pointer field of any kind, now points at the new one, so renaming never breaks
 * a link. Throws an Error that says why when the name cannot be used.
 * @param {object} scene
 * @param {number} index
 * @param {string} name
 * @param {Object<string, {fields: object}>} [kinds]
 */
export function setName(scene, index, name, kinds = {}) {
  const problem = nameProblem(scene, index, name);
  if (problem) throw new Error(problem);
  const next = clone(scene);
  const t = next.things[index];
  const before = nameOf(t);
  const extra = { ...(t.extra ?? {}) };
  if (name) extra.name = name; else delete extra.name;
  t.extra = extra;
  if (!Object.keys(t.extra).length) delete t.extra;
  if (before && before !== name) {
    for (const other of next.things) {
      for (const [field, f] of Object.entries(kinds[other.kind]?.fields ?? {})) {
        if (f.type === 'ref' && other.extra?.[field] === before) {
          if (name) other.extra[field] = name; else delete other.extra[field];
        }
      }
    }
  }
  return next;
}

/** Set one field of a thing, made to fit its type. An empty text, a pointer to nothing or the field's own default are all kept as written (the game fills in defaults itself). */
export function setFieldValue(scene, index, kinds, field, value) {
  const def = kinds[scene.things[index]?.kind]?.fields?.[field];
  if (!def) throw new Error(`This kind has no field called "${field}".`);
  const next = clone(scene);
  const t = next.things[index];
  const fitted = fitValue(def, value);
  t.extra = { ...(t.extra ?? {}) };
  if (def.type === 'ref' && !fitted) delete t.extra[field]; else t.extra[field] = fitted;
  if (!Object.keys(t.extra).length) delete t.extra;
  return next;
}

/** The value of a field of a thing as the inspector shows it: what it has, or the field's default. */
export function fieldValue(thing, kinds, field) {
  const def = kinds[thing.kind]?.fields?.[field];
  if (!def) return undefined;
  return thing.extra?.[field] ?? (def.type === 'ref' ? '' : def.default);
}

/** The named things a pointer field may point at: those of the kind it asks for (any kind when it does not say), never the thing itself. */
export function targetsFor(scene, index, def) {
  return scene.things.map((t, i) => ({ t, i })).filter(({ t,
    i }) => i !== index && nameOf(t) && (!def.to || t.kind === def.to)).map(({ t }) => nameOf(t));
}

/** The lines to draw from a thing to the things its pointer fields point at: `{ from, to, field }` as places in the scene's list. */
export function linksFrom(scene, index, kinds) {
  const t = scene.things[index];
  const out = [];
  for (const [field, f] of Object.entries(kinds[t?.kind]?.fields ?? {})) {
    if (f.type !== 'ref') continue;
    const name = t.extra?.[field];
    const to = name ? scene.things.findIndex((o) => nameOf(o) === name) : -1;
    if (to >= 0) out.push({ from: index, to, field });
  }
  return out;
}

/** Make the values the things hold fit the fields of their kind (a number held between its smallest and largest, a choice one of the list). */
export function tidyFields(scene, kinds) {
  const next = clone(scene);
  for (const t of next.things) {
    const defs = kinds[t.kind]?.fields;
    if (!defs || !t.extra) continue;
    for (const [field, f] of Object.entries(defs)) if (t.extra[field] !== undefined) t.extra[field] = fitValue(f, t.extra[field]);
  }
  return next;
}
