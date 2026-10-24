// A hierarchical finite state machine: named states with enter / update / exit, transitions guarded by conditions, timers or events,
// "from any state" transitions, nested machines inside states, history, and saving / restoring. The machine is data plus small functions;
// the thing it controls is whatever `ctx` you pass in. Only + - * / (no maths functions), so it may run in shared simulation code.

/**
 * @typedef {object} Transition
 * @property {string} to Target state: a sibling name, "combat/aiming" (a state inside a sibling), or "../dead" (a sibling of the machine this one is nested in).
 * @property {(ctx: any, m: StateMachine) => boolean} [when] Taken when this returns true (checked every update).
 * @property {number} [after] Taken once the state has lasted this many seconds.
 * @property {string} [event] Taken when `send(event)` arrives while in the state (and `when`, if given, holds).
 * @property {number} [minTime] Not before the state has lasted this long.
 * @property {number} [priority] Higher goes first when several are possible (default 0).
 * @property {(ctx: any, m: StateMachine) => void} [action] Runs between exit and enter.
 * @property {boolean} [reenter] A transition to the state you are in leaves and enters it again (default: it is ignored).
 * @property {boolean} [history] Enter the nested state that was active last time instead of the initial one.
 *
 * @typedef {object} StateConfig
 * @property {(ctx: any, m: StateMachine, from: string | null) => void} [enter]
 * @property {(ctx: any, dt: number, m: StateMachine) => void} [update]
 * @property {(ctx: any, m: StateMachine, to: string | null) => void} [exit]
 * @property {Transition[]} [transitions]
 * @property {Record<string, string | Omit<Transition, 'event'>>} [on] Shorthand for event transitions: `{ hit: 'stunned' }`.
 * @property {{initial: string, states: Record<string, StateConfig>, any?: Transition[]}} [machine] A machine inside this state; it is active exactly while the state is.
 */

const MAX_CHAIN = 16; // transitions followed in one update before a loop is assumed

/**
 * A hierarchical state machine: states with enter / update / exit, transitions on events, conditions and timers with priorities,
 * "from any" transitions, nested machines inside states (with history), loop detection and save / load. Can be defined from plain
 * data.
 */
export class StateMachine {
  /**
   * @param {{initial: string, states: Record<string, StateConfig>, any?: Transition[]}} config
   * @param {{name?: string}} [o]
   */
  constructor(config, { name = 'machine' } = {}) {
    if (!config.states[config.initial]) throw new Error(`${name}: the initial state "${config.initial}" is not one of ${Object.keys(config.states).join(', ')}`);
    this.name = name;
    this.config = config;
    /** The state this machine is in (a name; for nested machines the top-level one). */
    this.state = null;
    /** Seconds in the current state. */
    this.time = 0;
    /** Free-form place for the machine's own memory. */
    this.data = {};
    /** @type {StateMachine | null} the machine inside the current state, if it has one */ this.child = null;
    this.parent = null;
    this.history = new Map();
    this.onTransition = null;
    this.queue = [];
    this.started = false;
    this.lastEvent = null;
    this.#validate(config, name);
  }

  #validate(config, where) {
    for (const [sn, s] of Object.entries(config.states)) {
      const check = (t, how) => { if (typeof t.to !== 'string') throw new Error(`${where}/${sn}: a ${how} transition needs "to"`); };
      for (const t of s.transitions ?? []) check(t, 'listed');
      for (const t of config.any ?? []) check(t, 'any-state');
      if (s.machine) this.#validate(s.machine, `${where}/${sn}`);
    }
  }

  /** The active state path: "combat/aiming". */
  get path() { return this.child ? `${this.state}/${this.child.path}` : this.state; }
  /** Is the machine in this state (a name, or a path prefix like "combat" while in "combat/aiming")? */
  is(path) { const p = this.path; return p === path || p.startsWith(`${path}/`); }

  /** Enter the initial state. Called for you by the first `update` or `send`. */
  start(ctx) {
    if (this.started) return this;
    this.started = true;
    this.#enter(ctx, this.config.initial, null, false);
    return this;
  }

  #enter(ctx, name, from, useHistory) {
    const cfg = this.config.states[name];
    this.state = name; this.time = 0;
    cfg.enter?.(ctx, this, from);
    this.child = null;
    if (cfg.machine) {
      const sub = new StateMachine(cfg.machine, { name: `${this.name}/${name}` });
      sub.parent = this; sub.onTransition = this.onTransition; sub.data = this.history.get(`${name}:data`) ?? {};
      this.child = sub; sub.started = true;
      const remembered = useHistory ? this.history.get(name) : undefined;
      sub.#enter(ctx, remembered && cfg.machine.states[remembered] ? remembered : cfg.machine.initial, null, useHistory);
    }
  }

  #exit(ctx, to) {
    if (this.child) { this.history.set(this.state, this.child.state); this.history.set(`${this.state}:data`, this.child.data); this.child.#exit(ctx, null); this.child = null; }
    this.config.states[this.state].exit?.(ctx, this, to);
  }

  /**
   * Move to another state now. `to` is relative to this machine: a sibling ("run"), a state inside a sibling ("combat/aiming"), or up
   * through the machines around it ("../dead" from inside "combat").
   * @param {{action?: Function, history?: boolean, event?: string | null}} [o]
   */
  go(ctx, to, { action, history = false, event = null } = {}) {
    const parts = to.split('/');
    let m = this;
    while (parts[0] === '..') { parts.shift(); m = m.parent; if (!m) throw new Error(`${this.name}: "${to}" goes above the top machine`); }
    m.#descend(ctx, parts, { action, history, event });
  }
  #descend(ctx, parts, o) {
    const [head, ...rest] = parts;
    if (head === this.state && rest.length > 0 && this.child) { this.child.#descend(ctx, rest, o); return; } // already inside it: just move within
    this.#goHere(ctx, head, o.action, rest.length === 0 && o.history, o.event);
    if (rest.length > 0) {
      if (!this.child) throw new Error(`${this.name}: state "${head}" has no machine inside it to go to "${rest.join('/')}"`);
      this.child.#descend(ctx, rest, { ...o, action: undefined });
    }
  }
  #goHere(ctx, to, action, history, event) {
    if (!this.config.states[to]) throw new Error(`${this.name}: no state "${to}" (states: ${Object.keys(this.config.states).join(', ')})`);
    const from = this.state;
    this.#exit(ctx, to);
    action?.(ctx, this);
    this.#enter(ctx, to, from, history);
    this.onTransition?.(from, to, event, this);
  }

  /** The transitions to look at in this machine right now, best first. */
  #candidates() {
    const cfg = this.config.states[this.state], list = [];
    for (const t of this.config.any ?? []) list.push(t);
    for (const t of cfg.transitions ?? []) list.push(t);
    for (const [ev, v] of Object.entries(cfg.on ?? {})) list.push(typeof v === 'string' ? { to: v, event: ev } : { ...v, event: ev });
    return list.map((t, i) => [t, i]).sort((a, b) => (b[0].priority ?? 0) - (a[0].priority ?? 0) || a[1] - b[1]).map((x) => x[0]);
  }

  #ready(t, ctx, event) {
    if (t.event !== undefined && t.event !== event) return false;
    if (t.event === undefined && event !== null) return false; // events only fire event transitions
    if (t.minTime !== undefined && this.time < t.minTime) return false;
    if (t.after !== undefined && this.time < t.after) return false;
    if (t.when && !t.when(ctx, this)) return false;
    if (t.event === undefined && t.after === undefined && !t.when) return false; // nothing says when
    return true;
  }

  /** Take the first transition that applies (here, or in the machine below if none does). @returns {boolean} whether one was taken */
  #step(ctx, event) {
    for (const t of this.#candidates()) {
      if (!this.#ready(t, ctx, event)) continue;
      if (!t.reenter && t.to === this.state) continue;
      this.go(ctx, t.to, { action: t.action, history: t.history, event });
      return true;
    }
    return this.child ? this.child.#step(ctx, event) : false;
  }

  /** Advance time, follow transitions that are due, and run the current states' updates (parents first). */
  update(dt, ctx) {
    this.start(ctx);
    this.time += dt;
    for (let m = this.child; m; m = m.child) m.time += dt;
    let guard = 0;
    while (this.#step(ctx, null)) {
      if (++guard > MAX_CHAIN) throw new Error(`${this.name}: more than ${MAX_CHAIN} transitions in one update (a loop between ${this.path}?)`);
    }
    for (let m = this; m; m = m.child) m.config.states[m.state].update?.(ctx, dt, m);
    // events queued with `post` are handled at the end of the update, in order
    while (this.queue.length) this.send(this.queue.shift(), ctx);
  }

  /**
   * Tell the machine something happened. The deepest state that has a transition for it handles it.
   * @returns {boolean} whether a transition was taken
   */
  send(event, ctx) {
    this.start(ctx);
    // the deepest machine first, so a nested state can handle its own events before its parents do
    const chain = []; for (let m = this; m; m = m.child) chain.push(m);
    for (let i = chain.length - 1; i >= 0; i--) {
      const m = chain[i];
      for (const t of m.#candidates()) {
        if (t.event !== event || !m.#ready(t, ctx, event)) continue;
        if (!t.reenter && t.to === m.state) continue;
        m.go(ctx, t.to, { action: t.action, history: t.history, event });
        return true;
      }
    }
    return false;
  }

  /** Remember an event to be handled at the end of the next `update` (for code that runs mid-frame). */
  post(event) { this.queue.push(event); }

  // ---- saving ----
  /** Where the machine is, as plain data (state path, time in each level, remembered history, memory). */
  save() {
    const levels = [];
    for (let m = this; m; m = m.child) levels.push({ state: m.state, time: m.time, data: m.data });
    const history = {}; for (const [k, v] of this.history) if (!k.endsWith(':data')) history[k] = v;
    return JSON.parse(JSON.stringify({ levels, history }));
  }
  /** Put the machine back where `save()` found it. Enter / exit functions are not called (the world is restored separately). */
  load(data) {
    this.started = true;
    let m = this;
    data.levels.forEach((lv, i) => {
      if (!m.config.states[lv.state]) throw new Error(`${m.name}: saved state "${lv.state}" does not exist (any more)`);
      m.state = lv.state; m.time = lv.time; m.data = lv.data ?? {};
      const cfg = m.config.states[lv.state];
      if (cfg.machine && i < data.levels.length - 1) { const sub = new StateMachine(cfg.machine, { name: `${m.name}/${lv.state}` }); sub.parent = m; sub.started = true; sub.onTransition = m.onTransition; m.child = sub; m = sub; } else m.child = null;
    });
    this.history = new Map(Object.entries(data.history ?? {}));
    return this;
  }

  /** A readable outline of the machine's states and transitions. */
  describe() {
    const lines = [];
    const walk = (cfg, indent) => {
      for (const [n, s] of Object.entries(cfg.states)) {
        const outs = [...(s.transitions ?? []).map((t) => `${t.to}${t.event ? ` on ${t.event}` : t.after !== undefined ? ` after ${t.after}s` : ''}`), ...Object.entries(s.on ?? {}).map(([e, v]) => `${typeof v === 'string' ? v : v.to} on ${e}`)];
        lines.push(`${indent}${n}${cfg.initial === n ? ' (initial)' : ''}${outs.length ? ` -> ${outs.join(', ')}` : ''}`);
        if (s.machine) walk(s.machine, `${indent}  `);
      }
      if (cfg.any?.length) lines.push(`${indent}from any: ${cfg.any.map((t) => t.to).join(', ')}`);
    };
    walk(this.config, '');
    return lines.join('\n');
  }
}

/**
 * Build a machine from plain data (JSON), naming functions from a registry: `{ initial: 'idle', states: { idle: { enter: 'playIdle', transitions: [{ to: 'run', when: 'isMoving' }] } } }`.
 * Any of enter, update, exit, when, action may be a name.
 * @param {object} spec @param {Record<string, Function>} registry
 */
export function machineFromData(spec, registry) {
  const fn = (v, where) => { if (v === undefined || typeof v === 'function') return v; const f = registry[v]; if (!f) throw new Error(`state machine: no function named "${v}" in the registry (${where})`); return f; };
  const trans = (t, where) => ({ ...t, when: fn(t.when, where), action: fn(t.action, where) });
  const conv = (cfg, where) => ({
    initial: cfg.initial,
    any: cfg.any?.map((t) => trans(t, `${where} any`)),
    states: Object.fromEntries(Object.entries(cfg.states).map(([n, s]) => [n, {
      enter: fn(s.enter, `${where}/${n}`), update: fn(s.update, `${where}/${n}`), exit: fn(s.exit, `${where}/${n}`),
      transitions: s.transitions?.map((t) => trans(t, `${where}/${n}`)),
      on: s.on ? Object.fromEntries(Object.entries(s.on).map(([e, v]) => [e, typeof v === 'string' ? v : trans(v, `${where}/${n}`)])) : undefined,
      machine: s.machine ? conv(s.machine, `${where}/${n}`) : undefined,
    }])),
  });
  return new StateMachine(conv(spec, 'root'));
}
