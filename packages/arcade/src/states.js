// States for a thing: idle, walking, jumping, hurt... Each state says which animation to play and when to move on to another state. It is plain data (made in the
// studio's States panel and kept in `src/states.js`), and the state lives on the thing itself (`thing.state`, `thing.stateTime`), so saving, hot reload and rewinding
// just work. Nothing is evaluated: a condition is a small record such as `{ field: 'vx', op: '!=', value: 0 }`.
//
//   const hero = { initial: 'idle', states: {
//     idle: { animation: 'idle', transitions: [{ to: 'walk', when: { field: 'vx', op: '!=', value: 0 } }, { to: 'hurt', event: 'hit' }] },
//     walk: { animation: 'walk', transitions: [{ to: 'idle', when: { field: 'vx', op: '==', value: 0 } }] },
//     hurt: { animation: 'hurt', transitions: [{ to: 'idle', after: 0.5 }] },
//   } };
//   stepState(thing, hero, dt, ['hit']);       // every tick; the events are what happened this tick

/**
 * @typedef {{field: string, op: '==' | '!=' | '<' | '<=' | '>' | '>=', value: number | string | boolean}} Condition
 * @typedef {{to: string, event?: string, after?: number, when?: Condition | Condition[]}} StateTransition
 * @typedef {{animation?: string, transitions?: StateTransition[]}} ThingState
 * @typedef {{initial: string, states: Object<string, ThingState>, any?: StateTransition[]}} StateMachineSpec
 */

export const OPS = ['==', '!=', '<', '<=', '>', '>='];
const MAX_CHAIN = 8;

const read = (thing, path) => String(path).split('.').reduce((o, k) => (o == null ? undefined : o[k]), thing);

/** Whether one condition holds for a thing. A field the thing does not have is undefined, so `!=` holds and the others do not (except `== undefined`-free ones). */
export function holds(thing, c) {
  const v = read(thing, c.field);
  switch (c.op) {
    case '==': return v === c.value;
    case '!=': return v !== c.value;
    case '<': return typeof v === 'number' && v < c.value;
    case '<=': return typeof v === 'number' && v <= c.value;
    case '>': return typeof v === 'number' && v > c.value;
    case '>=': return typeof v === 'number' && v >= c.value;
    default: return false;
  }
}

/** Whether a transition can be taken now: its event arrived (if it has one), the state has lasted long enough (if `after`), and every condition holds. */
export function ready(thing, tr, events = []) {
  if (tr.event !== undefined && !events.includes(tr.event)) return false;
  if (tr.after !== undefined && (thing.stateTime ?? 0) < tr.after) return false;
  const when = tr.when === undefined ? [] : Array.isArray(tr.when) ? tr.when : [tr.when];
  return when.every((c) => holds(thing, c));
}

/** Put a thing into a state: sets `state`, restarts `stateTime`, and starts the state's animation. */
export function enterState(thing, machine, name) {
  const state = machine.states[name];
  if (!state) return false;
  thing.state = name;
  thing.stateTime = 0;
  if (state.animation !== undefined) thing.anim = state.animation;
  return true;
}

/**
 * Move a thing along its machine: call it every tick. A thing without a state starts in the machine's `initial` one. The first transition of the state that can be
 * taken wins (the state's own, in order, then the machine's `any`), and the new state may move on again in the same tick (up to 8 times, so a loop cannot hang).
 * @param {object} thing
 * @param {StateMachineSpec} machine
 * @param {number} dt seconds since the last tick
 * @param {string[]} [events] what happened this tick (`['hit']`)
 * @returns {string} the state the thing is in now
 */
export function stepState(thing, machine, dt, events = []) {
  if (!machine?.states) return thing.state;
  if (!(thing.state in machine.states)) enterState(thing, machine, machine.initial in machine.states ? machine.initial : Object.keys(machine.states)[0]);
  thing.stateTime = (thing.stateTime ?? 0) + dt;
  for (let i = 0; i < MAX_CHAIN; i++) {
    const state = machine.states[thing.state];
    const hit = [...(state.transitions ?? []), ...(machine.any ?? [])].find((tr) => tr.to in machine.states && tr.to !== thing.state && ready(thing, tr, events));
    if (!hit) break;
    enterState(thing, machine, hit.to);
    events = [];                                       // an event is used up by the move it caused
  }
  return thing.state;
}

/** The event names a machine reacts to, in the order they appear. */
export function eventsOf(machine) {
  const out = new Set();
  for (const tr of allTransitions(machine)) if (tr.event !== undefined) out.add(tr.event);
  return [...out];
}

/** The thing fields a machine looks at in its conditions, in the order they appear. */
export function fieldsOf(machine) {
  const out = new Set();
  for (const tr of allTransitions(machine)) for (const c of conditionsOf(tr)) out.add(c.field);
  return [...out];
}

export const conditionsOf = (tr) => (tr.when === undefined ? [] : Array.isArray(tr.when) ? tr.when : [tr.when]);
const allTransitions = (m) => [...Object.values(m?.states ?? {}).flatMap((s) => s.transitions ?? []), ...(m?.any ?? [])];

/** A transition in plain words: "when vx != 0", "after 0.5 s", "on hit", or several joined with "and". */
export function describe(tr) {
  const parts = [];
  if (tr.event !== undefined) parts.push(`on ${tr.event}`);
  if (tr.after !== undefined) parts.push(`after ${tr.after} s`);
  for (const c of conditionsOf(tr)) parts.push(`${c.field} ${c.op} ${c.value}`);
  return parts.length ? parts.join(' and ') : 'always';
}

/**
 * Look a machine over and say what is wrong, in plain words: no states, an initial state that is not there, transitions to states that do not exist, a transition with
 * nothing to wait for (it would be taken at once), states that nothing leads to, and states with no way out.
 * @param {StateMachineSpec} machine
 * @returns {{state: string, kind: 'initial' | 'target' | 'always' | 'unreachable' | 'stuck' | 'shape', message: string}[]}
 */
export function machineProblems(machine) {
  const out = [];
  const add = (state, kind, message) => out.push({ state, kind, message });
  const names = Object.keys(machine?.states ?? {});
  if (!names.length) { add('', 'shape', 'This machine has no states.'); return out; }
  if (!(machine.initial in machine.states)) add(machine.initial ?? '', 'initial', `The first state "${machine.initial}" does not exist.`);
  const reachable = new Set([machine.initial]);
  const anyTargets = (machine.any ?? []).map((t) => t.to);
  for (const to of anyTargets) reachable.add(to);
  for (const [name, state] of Object.entries(machine.states)) {
    for (const tr of state.transitions ?? []) {
      if (!(tr.to in machine.states)) add(name, 'target', `"${name}" goes to "${tr.to}", which does not exist.`);
      else reachable.add(tr.to);
      if (describe(tr) === 'always') add(name, 'always', `A transition from "${name}" to "${tr.to}" has nothing to wait for, so it happens at once.`);
    }
  }
  for (const name of names) {
    if (!reachable.has(name)) add(name, 'unreachable', `Nothing leads to "${name}".`);
    if (!(machine.states[name].transitions ?? []).length && !(machine.any ?? []).length && names.length > 1) add(name, 'stuck', `"${name}" has no way out: once there, the thing stays.`);
  }
  return out;
}
