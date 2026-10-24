// The States panel's logic: a thing's states (idle, walk, hurt...) as a graph, kept in `src/states.js` as plain JSON, one machine for each kind of thing:
//
//   export default { "hero": { "initial": "idle", "states": { "idle": { "animation": "idle", "transitions": [ { "to": "walk", "when": {...} } ] } },
//                              "layout": { "idle": [40, 60] } } };
//
// `layout` is where each state sits in the editor (the game ignores it). This builds and changes machines, finds a place for new states, and reads and writes the file.
// Judging a machine (what is unreachable, stuck...) is the kit's own `machineProblems`, so the panel and the game agree.
import { machineProblems, describe, eventsOf, fieldsOf, conditionsOf, OPS } from '../../../packages/arcade/src/states.js';

export { machineProblems, describe, eventsOf, fieldsOf, conditionsOf, OPS };

const clone = (x) => JSON.parse(JSON.stringify(x));
export const NAME = /^[a-z][\w-]{0,31}$/i;
export const ANY = '*';                                  // the pseudo-state "from any state"
export const NODE = { w: 112, h: 44 };

/** A starter machine for a character: idle, walk and hurt. */
export function starterMachine() {
  return {
    initial: 'idle',
    states: {
      idle: { animation: 'idle', transitions: [{ to: 'walk', when: { field: 'vx', op: '!=', value: 0 } }, { to: 'hurt', event: 'hit' }] },
      walk: { animation: 'walk', transitions: [{ to: 'idle', when: { field: 'vx', op: '==', value: 0 } }, { to: 'hurt', event: 'hit' }] },
      hurt: { animation: 'hurt', transitions: [{ to: 'idle', after: 0.5 }] },
    },
    layout: { idle: [30, 30], walk: [230, 30], hurt: [130, 150] },
  };
}

/** A blank machine with one state. */
export function newMachine() {
  return { initial: 'idle', states: { idle: { transitions: [] } }, layout: { idle: [30, 30] } };
}

// ---------- the file ----------

/** The machines as the text of a file. */
export function serializeStates(machines) {
  const body = Object.entries(machines).map(([name, m]) => `  ${JSON.stringify(name)}: ${JSON.stringify(m)}`).join(',\n');
  const note = '// Made with the studio\'s States panel. Each machine says which animation a thing plays in each state, '
    + 'and when it moves to another state.';
  return `${note}\n// Use them with stepState(thing, states.hero, dt, events) from @engine/arcade.\nexport default {\n${body}\n};\n`;
}

/** Read a states file. Throws an Error that says what is wrong. */
export function parseStates(text) {
  const m = /export\s+default\s+([\s\S]*?);?\s*$/.exec(String(text ?? ''));
  if (!m) throw new Error('This file is not a set of state machines: it should say "export default { ... }".');
  let data;
  try {
    data = JSON.parse(m[1]);
  } catch {
    throw new Error('This states file has been edited into something the States panel cannot read. '
      + 'Keep the part after "export default" as plain JSON.');
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('The states file should hold an object of named machines.');
  for (const [name, machine] of Object.entries(data)) {
    const states = machine && typeof machine === 'object' ? machine.states : null;
    const usable = NAME.test(name) && states && typeof states === 'object' && Object.keys(states).length;
    if (!usable) throw new Error(`The machine "${name.slice(0, 32)}" is not usable (it needs a name and at least one state).`);
    for (const [state, spec] of Object.entries(machine.states)) {
      if (!NAME.test(state) || !spec || typeof spec !== 'object') throw new Error(`In "${name}", "${state.slice(0, 32)}" is not a usable state.`);
      spec.transitions = Array.isArray(spec.transitions) ? spec.transitions : [];
    }
    if (!(machine.initial in machine.states)) machine.initial = Object.keys(machine.states)[0];
    machine.layout = machine.layout && typeof machine.layout === 'object' ? machine.layout : {};
  }
  return data;
}

/** A name for a new machine or state that is not taken. */
export function freeName(taken, wanted) {
  const base = String(wanted).replace(/[^\w-]/g, '').replace(/^[^a-z]+/i, '') || 'state';
  if (!(base in taken)) return base;
  for (let n = 2; n < 1000; n++) if (!(`${base}${n}` in taken)) return `${base}${n}`;
  return `${base}${Date.now()}`;
}

/** Why a name cannot be used, or null. */
export function nameProblem(name, taken) {
  if (!NAME.test(name)) return 'Use letters and numbers, starting with a letter';
  return taken(name) ? 'There is already one with that name' : null;
}

// ---------- changing a machine ----------

/** Where states sit: the saved place, or a free place in a grid for the ones that have none yet. */
export function layoutOf(m) {
  const out = {};
  let slot = 0;
  for (const name of Object.keys(m.states)) {
    const at = m.layout?.[name];
    if (Array.isArray(at) && at.length === 2 && at.every(Number.isFinite)) { out[name] = at; continue; }
    out[name] = gridSpot(slot++);
  }
  return out;
}
const gridSpot = (i) => [30 + (i % 3) * 200, 30 + Math.floor(i / 3) * 120];

/** A free place for the next state: the first grid spot not on top of another state. */
export function freeSpot(m) {
  const taken = Object.values(layoutOf(m));
  for (let i = 0; i < 60; i++) {
    const [x, y] = gridSpot(i);
    if (!taken.some(([tx, ty]) => Math.abs(tx - x) < NODE.w && Math.abs(ty - y) < NODE.h + 20)) return [x, y];
  }
  return [30, 30];
}

/** A state added. */
export function addState(m, name, at = freeSpot(m)) {
  const out = clone(m);
  out.states[name] = { transitions: [] };
  out.layout = { ...layoutOf(m), [name]: at };
  return out;
}

/** A state taken away, with every transition that went to it. */
export function removeState(m, name) {
  if (Object.keys(m.states).length <= 1) throw new Error('A machine needs at least one state.');
  const out = clone(m);
  delete out.states[name];
  delete out.layout?.[name];
  for (const s of Object.values(out.states)) s.transitions = s.transitions.filter((t) => t.to !== name);
  out.any = (out.any ?? []).filter((t) => t.to !== name);
  if (!out.any.length) delete out.any;
  if (out.initial === name) out.initial = Object.keys(out.states)[0];
  return out;
}

/** A state renamed, everywhere it is mentioned. */
export function renameState(m, from, to) {
  const out = { ...clone(m), states: {}, layout: {} };
  const fix = (t) => (t.to === from ? { ...t, to } : t);
  for (const [name, s] of Object.entries(m.states)) out.states[name === from ? to : name] = { ...clone(s), transitions: s.transitions.map(fix) };
  for (const [name, at] of Object.entries(layoutOf(m))) out.layout[name === from ? to : name] = at;
  if (m.any) out.any = m.any.map(fix);
  if (out.initial === from) out.initial = to;
  return out;
}

/** The state a thing starts in. */
export function setInitial(m, name) {
  return name in m.states ? { ...clone(m), initial: name } : m;
}

/** The animation a state plays (empty: it leaves the animation as it was). */
export function setAnimation(m, name, animation) {
  const out = clone(m);
  if (animation) out.states[name].animation = animation; else delete out.states[name].animation;
  return out;
}

/** Where one state sits. */
export function moveState(m, name, x, y) {
  return { ...clone(m), layout: { ...layoutOf(m), [name]: [Math.max(0, Math.round(x)), Math.max(0, Math.round(y))] } };
}

/** The transitions leaving a state (or the "from any state" ones). */
export const listOf = (m, from) => (from === ANY ? m.any ?? [] : m.states[from]?.transitions ?? []);

function withList(m, from, change) {
  const out = clone(m);
  if (from === ANY) {
    out.any = change(out.any ?? []);
    if (!out.any.length) delete out.any;
  } else out.states[from].transitions = change(out.states[from].transitions);
  return out;
}

/** A transition added (it starts as "on" an event, which the panel then lets you change). */
export function addTransition(m, from, to, trigger = { event: 'go' }) {
  return withList(m, from, (list) => [...list, { to, ...trigger }]);
}

/** A transition changed: `patch` fields replace the old ones, and a field set to undefined is removed. */
export function updateTransition(m, from, index, patch) {
  return withList(m, from, (list) => list.map((t, i) => {
    if (i !== index) return t;
    const next = { ...t, ...patch };
    for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
    return next;
  }));
}

/** A transition taken away. */
export function removeTransition(m, from, index) {
  return withList(m, from, (list) => list.filter((_, i) => i !== index));
}

/** A transition moved up or down the list (the first one that can be taken wins, so the order matters). */
export function moveTransition(m, from, index, by) {
  return withList(m, from, (list) => {
    const j = index + by;
    if (j < 0 || j >= list.length) return list;
    const next = [...list];
    [next[index], next[j]] = [next[j], next[index]];
    return next;
  });
}

/** Add a condition to a transition (`vx != 0` to begin with). */
export function addCondition(m, from, index, field = 'vx') {
  const t = listOf(m, from)[index];
  const next = [...conditionsOf(t), { field, op: '!=', value: 0 }];
  return updateTransition(m, from, index, { when: next.length === 1 ? next[0] : next });
}

/** Change one condition of a transition. */
export function setCondition(m, from, index, which, patch) {
  const t = listOf(m, from)[index];
  const next = conditionsOf(t).map((c, i) => (i === which ? { ...c, ...patch } : c));
  return updateTransition(m, from, index, { when: next.length === 1 ? next[0] : next });
}

/** Take one condition away. */
export function removeCondition(m, from, index, which) {
  const t = listOf(m, from)[index];
  const next = conditionsOf(t).filter((_, i) => i !== which);
  return updateTransition(m, from, index, { when: next.length === 0 ? undefined : next.length === 1 ? next[0] : next });
}

/** Read what was typed as a condition's value: a number, true, false, or else the words. */
export function parseValue(text) {
  const s = String(text).trim();
  if (s === 'true') return true;
  if (s === 'false') return false;
  return s !== '' && Number.isFinite(Number(s)) ? Number(s) : s;
}

// ---------- the picture of the graph ----------

/**
 * Where to draw each arrow: from the edge of one state to the edge of the other, bent a little so arrows between the same two states do not sit on each other.
 * (A transition to the state itself is never taken, so it has no arrow; the check lists nothing for it.)
 * @returns {{from: string, index: number, to: string, label: string, path: string, at: [number, number]}[]}
 */
export function edgesOf(m) {
  const place = layoutOf(m);
  const mid = (n) => [place[n][0] + NODE.w / 2, place[n][1] + NODE.h / 2];
  const edges = [];
  const seen = new Map();
  const add = (from, tr, index) => {
    if (!(tr.to in place) || (from !== ANY && !(from in place))) return;
    const pair = `${from}>${tr.to}`;
    const n = seen.get(pair) ?? 0;
    seen.set(pair, n + 1);
    const a = from === ANY ? [place[tr.to][0] - 50, place[tr.to][1] - 36] : mid(from);
    const b = mid(tr.to);
    if (from === tr.to) return;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    const bend = 18 + n * 28;                      // a bend each way, so an arrow back does not sit on the arrow there
    const cx = (a[0] + b[0]) / 2 - (dy / len) * bend;
    const cy = (a[1] + b[1]) / 2 + (dx / len) * bend;
    const start = clip(a, [cx, cy], from === ANY ? 0 : 1);
    const end = clip(b, [cx, cy], 1);
    edges.push({ from, index, to: tr.to, label: describe(tr), path: `M${start[0]},${start[1]} Q${cx},${cy} ${end[0]},${end[1]}`, at: [cx, cy] });
  };
  for (const [name, s] of Object.entries(m.states)) s.transitions.forEach((t, i) => add(name, t, i));
  (m.any ?? []).forEach((t, i) => add(ANY, t, i));
  return edges;
}

/** The point where a line from the middle of a state toward `toward` leaves the state's box (or the middle itself when `pad` is 0). */
function clip(center, toward, pad) {
  if (!pad) return center;
  const dx = toward[0] - center[0];
  const dy = toward[1] - center[1];
  const k = Math.min(dx ? NODE.w / 2 / Math.abs(dx) : Infinity, dy ? NODE.h / 2 / Math.abs(dy) : Infinity);
  return [Math.round(center[0] + dx * k), Math.round(center[1] + dy * k)];
}
