// The Behaviours panel's logic: what each kind of thing does by itself (enemies pace and chase, coins are collected, turrets shoot), kept in `src/behaviors.js` as plain JSON:
//
//   export default { "enemy": [ { "type": "pace", "speed": 40, "distance": 80 }, { "type": "health", "hp": 2, ... } ], "coin": [ { "type": "collect", ... } ] };
//
// This builds and changes the lists, starts you from ready-made kinds, and reads and writes the file. What each behaviour is and its settings come from the kit's own
// `BEHAVIORS` table, and every list is cleaned by the kit's `cleanBehavior`, so the panel and the game agree.
import { BEHAVIORS, BEHAVIOR_LIMITS, cleanBehavior, behaviorProblems } from '../../../packages/arcade/src/behaviors.js';

export { BEHAVIORS, BEHAVIOR_LIMITS, cleanBehavior, behaviorProblems };

const clone = (x) => JSON.parse(JSON.stringify(x));
export const NAME = /^[a-z][\w-]{0,31}$/i;

/** Ready-made kinds to start from. */
export const STARTERS = {
  enemy: () => [
    { type: 'pace', speed: 40, distance: 80 }, { type: 'follow', target: 'hero', speed: 60, range: 120, stopAt: 10 },
    { type: 'health', hp: 2, safeFor: 0.4 }, { type: 'hurtOnTouch', target: 'hero', amount: 1 },
  ].map(cleanBehavior),
  coin: () => [{ type: 'collect', by: 'hero', score: 1 }].map(cleanBehavior),
  turret: () => [{ type: 'shoot', bullet: 'bullet', every: 1, aim: 'target', target: 'hero', speed: 160, life: 2 }].map(cleanBehavior),
  bouncer: () => [{ type: 'bounce', speed: 140, angle: 40 }, { type: 'hurtOnTouch', target: 'hero', amount: 1 }].map(cleanBehavior),
  ghost: () => [{ type: 'wander', speed: 50, changeEvery: 1.2 }, { type: 'follow', target: 'hero', speed: 35, range: 160,
    stopAt: 6 }].map(cleanBehavior),
  hunter: () => [{ type: 'goTo', target: 'hero', speed: 70, stopAt: 10 }, { type: 'hurtOnTouch', target: 'hero', amount: 1 }].map(cleanBehavior),
  mouse: () => [{ type: 'keepAway', from: 'hero', speed: 90, range: 140 }].map(cleanBehavior),
  hero: () => [{ type: 'health', hp: 5, safeFor: 1 }].map(cleanBehavior),
};

// ---------- the file ----------

/** The kinds as the text of a file. */
export function serializeBehaviors(table) {
  const body = Object.entries(table).map(([kind, list]) => `  ${JSON.stringify(kind)}: ${JSON.stringify(list)}`).join(',\n');
  const note = '// Made with the studio\'s Behaviours panel. Each kind of thing has a list of behaviours: ready-made things it does by itself.';
  return `${note}\n// Use them with behaviors(...) once and behave(game, dt, keys) every tick, from @engine/arcade.\nexport default {\n${body}\n};\n`;
}

/** Read a behaviours file. Throws an Error that says what is wrong. */
export function parseBehaviors(text) {
  const m = /export\s+default\s+([\s\S]*?);?\s*$/.exec(String(text ?? ''));
  if (!m) throw new Error('This file is not a set of behaviours: it should say "export default { ... }".');
  let data;
  try {
    data = JSON.parse(m[1]);
  } catch {
    throw new Error('This behaviours file has been edited into something the Behaviours panel cannot read. '
      + 'Keep the part after "export default" as plain JSON.');
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('The behaviours file should hold an object with a list for each kind.');
  }
  const out = {};
  for (const [kind, list] of Object.entries(data)) {
    if (!NAME.test(kind) || !Array.isArray(list)) {
      throw new Error(`The kind "${kind.slice(0, 32)}" is not usable: it needs a name and a list of behaviours.`);
    }
    out[kind] = list.map(cleanBehavior).filter(Boolean).slice(0, BEHAVIOR_LIMITS.perKind);
  }
  return out;
}

/** A name for a new kind that is not taken. */
export function freeName(taken, wanted) {
  const base = String(wanted).replace(/[^\w-]/g, '').replace(/^[^a-z]+/i, '') || 'thing';
  if (!(base in taken)) return base;
  for (let n = 2; n < 1000; n++) if (!(`${base}${n}` in taken)) return `${base}${n}`;
  return `${base}${Date.now()}`;
}

/** Why a name cannot be used, or null. */
export function nameProblem(name, taken) {
  if (!NAME.test(name)) return 'Use letters and numbers, starting with a letter';
  return taken(name) ? 'There is already a kind with that name' : null;
}

// ---------- changing a list ----------

/** A behaviour added with its starting settings (at most 12 to a kind). */
export function addBehavior(list, type) {
  if (list.length >= BEHAVIOR_LIMITS.perKind) throw new Error(`At most ${BEHAVIOR_LIMITS.perKind} behaviours for one kind.`);
  return [...clone(list), cleanBehavior({ type })];
}

/** A behaviour taken away. */
export function removeBehavior(list, index) {
  return clone(list).filter((_, i) => i !== index);
}

/** A behaviour moved up or down (the order they run in). */
export function moveBehavior(list, index, by) {
  const j = index + by;
  if (j < 0 || j >= list.length) return list;
  const next = clone(list);
  [next[index], next[j]] = [next[j], next[index]];
  return next;
}

/** One setting changed (kept within its range). */
export function setParam(list, index, name, value) {
  const next = clone(list);
  const kind = BEHAVIORS[next[index].type].params[name];
  next[index] = cleanBehavior({ ...next[index], [name]: kind.kind === 'number' ? Number(value) : value });
  return next;
}

/** What a kind's list does, in one plain line. */
export function summarize(list) {
  return list.length ? list.map((b) => BEHAVIORS[b.type].label.toLowerCase()).join(', ') : 'nothing yet';
}

/** The names of the other kinds the list points at (follows, hurts, is collected by...), so the panel can say which kinds a thing is aware of. */
export function mentions(list) {
  const out = new Set();
  for (const b of list) for (const k of ['target', 'by', 'bullet', 'from']) if (typeof b[k] === 'string' && b[k]) out.add(b[k]);
  return [...out];
}
