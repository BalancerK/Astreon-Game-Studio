// Behaviour trees: a tree of small decisions that is ticked every frame (or every few frames) and says what an agent should do now.
// A node returns SUCCESS, FAILURE or RUNNING. The tree itself is data shared by every agent; what a node remembers between ticks
// (which child is running, a timer) lives in the agent's own `BehaviorTree` instance, so a thousand agents can share one definition.
// Only + - * / and sqrt; randomness comes from the generator you give the tree.

/**
 * What a behaviour-tree node reports when it is ticked: `SUCCESS` (1), `FAILURE` (2), or `RUNNING` (3, still working: it is ticked
 * again next time and carries on).
 */
export const SUCCESS = 1, FAILURE = 2, RUNNING = 3;
/** The status numbers as readable names (`1: "success"`), for logs and debug views. */
export const STATUS_NAMES = { 1: 'success', 2: 'failure', 3: 'running' };

let nextNodeId = 1;

/** What a leaf function may return: a status, or a boolean (true = success), or nothing (success). */
const toStatus = (r) => (r === SUCCESS || r === FAILURE || r === RUNNING ? r : r === false ? FAILURE : SUCCESS);

/**
 * @typedef {object} TickContext
 * @property {number} dt Seconds since the last tick.
 * @property {Record<string, any>} bb The blackboard: the agent's facts ("target", "hp", "path").
 * @property {any} agent Whatever the game wants leaves to act on.
 * @property {() => number} rng 0..1
 * @property {Record<number, any>} mem Per-node memory (managed for you).
 */

/** Base class. Subclasses implement `tick(ctx)`; `reset(ctx)` clears memory when a node is abandoned. */
export class Node {
  constructor(name = '') { this.id = nextNodeId++; this.name = name; /** @type {Node[]} */ this.children = []; }
  /** @param {TickContext} ctx @returns {number} */
  tick(ctx) { return SUCCESS; }
  reset(ctx) { delete ctx.mem[this.id]; for (const c of this.children) c.reset(ctx); }
}

/** Runs a function: `(ctx) => status | boolean | void`. */
export class Action extends Node {
  constructor(fn, name = 'action') { super(name); this.fn = fn; }
  tick(ctx) { return toStatus(this.fn(ctx)); }
}

/** Asks a yes/no question: `(ctx) => boolean`. */
export class Condition extends Node {
  constructor(fn, name = 'condition') { super(name); this.fn = fn; }
  tick(ctx) { return this.fn(ctx) ? SUCCESS : FAILURE; }
}

/** Waits `seconds` (RUNNING until then, then SUCCESS). */
export class Wait extends Node {
  constructor(seconds, name = 'wait') { super(name); this.seconds = seconds; }
  tick(ctx) {
    const m = ctx.mem[this.id] ??= { t: 0 };
    m.t += ctx.dt;
    if (m.t >= this.seconds) { delete ctx.mem[this.id]; return SUCCESS; }
    return RUNNING;
  }
}

/** Runs children in order until one fails: all must succeed. With `memory` (default) a running child is resumed, not restarted. */
export class Sequence extends Node {
  constructor(children, { memory = true, name = 'sequence' } = {}) { super(name); this.children = children; this.memory = memory; }
  tick(ctx) {
    let i = this.memory ? (ctx.mem[this.id] ?? 0) : 0;
    for (; i < this.children.length; i++) {
      const s = this.children[i].tick(ctx);
      if (s === RUNNING) { if (this.memory) ctx.mem[this.id] = i; return RUNNING; }
      if (s === FAILURE) { delete ctx.mem[this.id]; return FAILURE; }
    }
    delete ctx.mem[this.id];
    return SUCCESS;
  }
}

/**
 * Tries children in order until one succeeds: the first that works wins. Without `memory` (default) it re-checks from the top every
 * tick, so a more important behaviour can interrupt a less important one that is still running.
 */
export class Selector extends Node {
  constructor(children, { memory = false, name = 'selector' } = {}) { super(name); this.children = children; this.memory = memory; }
  tick(ctx) {
    let i = this.memory ? (ctx.mem[this.id] ?? 0) : 0;
    for (; i < this.children.length; i++) {
      const s = this.children[i].tick(ctx);
      if (s === RUNNING) {
        if (!this.memory) { const prev = ctx.mem[this.id]; if (prev !== undefined && prev !== i) this.children[prev].reset(ctx); ctx.mem[this.id] = i; } else ctx.mem[this.id] = i;
        return RUNNING;
      }
      if (s === SUCCESS) { this.#left(ctx, i); return SUCCESS; }
    }
    this.#left(ctx, -1);
    return FAILURE;
  }
  #left(ctx, winner) { const prev = ctx.mem[this.id]; if (prev !== undefined && prev !== winner) this.children[prev].reset(ctx); delete ctx.mem[this.id]; }
}

/** Runs all children every tick. `policy: 'all'` succeeds when all succeed (fails when any fails); `'one'` succeeds when any succeeds. */
export class Parallel extends Node {
  constructor(children, { policy = 'all', name = 'parallel' } = {}) { super(name); this.children = children; this.policy = policy; }
  tick(ctx) {
    let ok = 0, fail = 0, running = 0;
    for (const c of this.children) { const s = c.tick(ctx); if (s === SUCCESS) ok++; else if (s === FAILURE) fail++; else running++; }
    if (this.policy === 'one') return ok > 0 ? SUCCESS : running > 0 ? RUNNING : FAILURE;
    return fail > 0 ? FAILURE : running > 0 ? RUNNING : SUCCESS;
  }
}

/** Swaps success and failure. */
export class Inverter extends Node {
  constructor(child, name = 'not') { super(name); this.children = [child]; }
  tick(ctx) { const s = this.children[0].tick(ctx); return s === SUCCESS ? FAILURE : s === FAILURE ? SUCCESS : RUNNING; }
}
/** Always succeeds (unless still running). */
export class Succeeder extends Node {
  constructor(child, name = 'always') { super(name); this.children = [child]; }
  tick(ctx) { return this.children[0].tick(ctx) === RUNNING ? RUNNING : SUCCESS; }
}

/** Repeats its child `times` times (Infinity: forever, always RUNNING); stops early with FAILURE if the child fails. */
export class Repeater extends Node {
  constructor(child, times = Infinity, name = 'repeat') { super(name); this.children = [child]; this.times = times; }
  tick(ctx) {
    const m = ctx.mem[this.id] ??= { n: 0 };
    const s = this.children[0].tick(ctx);
    if (s === RUNNING) return RUNNING;
    if (s === FAILURE) { delete ctx.mem[this.id]; return FAILURE; }
    if (++m.n >= this.times) { delete ctx.mem[this.id]; return SUCCESS; }
    return RUNNING;
  }
}

/** Tries the child up to `times` times until it succeeds. */
export class Retry extends Node {
  constructor(child, times = 3, name = 'retry') { super(name); this.children = [child]; this.times = times; }
  tick(ctx) {
    const m = ctx.mem[this.id] ??= { n: 0 };
    const s = this.children[0].tick(ctx);
    if (s === RUNNING) return RUNNING;
    if (s === SUCCESS) { delete ctx.mem[this.id]; return SUCCESS; }
    if (++m.n >= this.times) { delete ctx.mem[this.id]; return FAILURE; }
    return RUNNING;
  }
}

/** After the child has run (to success or failure), refuses to run it again for `seconds`. */
export class Cooldown extends Node {
  constructor(child, seconds, name = 'cooldown') { super(name); this.children = [child]; this.seconds = seconds; }
  tick(ctx) {
    const m = ctx.mem[this.id] ??= { left: 0, running: false };
    if (!m.running && m.left > 0) { m.left -= ctx.dt; if (m.left > 0) return FAILURE; }
    const s = this.children[0].tick(ctx);
    if (s === RUNNING) { m.running = true; return RUNNING; }
    m.running = false; m.left = this.seconds;
    return s;
  }
}

/** Fails the child if it is still running after `seconds`. */
export class Timeout extends Node {
  constructor(child, seconds, name = 'timeout') { super(name); this.children = [child]; this.seconds = seconds; }
  tick(ctx) {
    const m = ctx.mem[this.id] ??= { t: 0 };
    m.t += ctx.dt;
    const s = this.children[0].tick(ctx);
    if (s !== RUNNING) { delete ctx.mem[this.id]; return s; }
    if (m.t >= this.seconds) { this.children[0].reset(ctx); delete ctx.mem[this.id]; return FAILURE; }
    return RUNNING;
  }
}

/** Picks one child at random (by weight) when started and keeps running it until it finishes. */
export class RandomSelector extends Node {
  constructor(children, weights = null, name = 'random') { super(name); this.children = children; this.weights = weights ?? children.map(() => 1); }
  tick(ctx) {
    let m = ctx.mem[this.id];
    if (!m) {
      let total = 0; for (const w of this.weights) total += w;
      let r = ctx.rng() * total, i = 0;
      for (; i < this.children.length - 1; i++) { r -= this.weights[i]; if (r < 0) break; }
      m = ctx.mem[this.id] = { i };
    }
    const s = this.children[m.i].tick(ctx);
    if (s !== RUNNING) delete ctx.mem[this.id];
    return s;
  }
}

/** Runs `child` only while `condition` holds; if the condition stops holding the child is abandoned (FAILURE). */
export class Guard extends Node {
  constructor(condition, child, name = 'guard') { super(name); this.condition = condition; this.children = [child]; }
  tick(ctx) {
    if (!this.condition(ctx)) { this.children[0].reset(ctx); return FAILURE; }
    return this.children[0].tick(ctx);
  }
}

/** One agent's instance of a tree: its blackboard, its memory, its random generator. */
export class BehaviorTree {
  /** @param {Node} root @param {{bb?: object, agent?: any, rng?: () => number}} [o] */
  constructor(root, { bb = {}, agent = null, rng = () => 0.5 } = {}) {
    this.root = root;
    /** @type {TickContext} */ this.ctx = { dt: 0, bb, agent, rng, mem: {} };
    this.status = SUCCESS;
  }
  get bb() { return this.ctx.bb; }
  /** Run the tree once. @returns {number} the root's status */
  tick(dt) {
    this.ctx.dt = dt;
    this.status = this.root.tick(this.ctx);
    return this.status;
  }
  /**
   * What the tree is in the middle of, as plain data: which child is running, timers, counters, and the blackboard entries you name.
   * Nodes are identified by their position in the tree, so a save loads into any tree built the same way (node numbers are not stable between sessions).
   * @param {string[]} [bbKeys] Blackboard entries to keep (only plain data).
   */
  save(bbKeys = []) {
    const index = new Map(); let n = 0;
    const walk = (node) => { index.set(node.id, n++); for (const c of node.children) walk(c); };
    walk(this.root);
    const mem = {};
    for (const [id, state] of Object.entries(this.ctx.mem)) { const i = index.get(Number(id)); if (i !== undefined) mem[i] = state; }
    const bb = {}; for (const k of bbKeys) if (k in this.ctx.bb) bb[k] = this.ctx.bb[k];
    return JSON.parse(JSON.stringify({ mem, bb, status: this.status }));
  }
  /** Put the tree back where `save()` found it (into a tree of the same shape). */
  load(data) {
    const nodes = []; const walk = (node) => { nodes.push(node); for (const c of node.children) walk(c); }; walk(this.root);
    this.ctx.mem = {};
    for (const [i, state] of Object.entries(data.mem)) { const node = nodes[Number(i)]; if (!node) throw new Error(`behaviour tree save does not fit this tree (no node number ${i})`); this.ctx.mem[node.id] = JSON.parse(JSON.stringify(state)); }
    Object.assign(this.ctx.bb, data.bb);
    this.status = data.status ?? SUCCESS;
    return this;
  }

  /** Forget what every node was doing (start over). */
  reset() { this.root.reset(this.ctx); this.ctx.mem = {}; }
}

// ---- building trees without `new` ----
/** Short builders: `bt.sequence(bt.condition(canSee), bt.action(shoot))`. */
export const bt = {
  action: (fn, name) => new Action(fn, name),
  condition: (fn, name) => new Condition(fn, name),
  wait: (s) => new Wait(s),
  sequence: (...c) => new Sequence(c),
  reactiveSequence: (...c) => new Sequence(c, { memory: false }),
  selector: (...c) => new Selector(c),
  memorySelector: (...c) => new Selector(c, { memory: true }),
  parallel: (policy, ...c) => new Parallel(c, { policy }),
  not: (c) => new Inverter(c),
  always: (c) => new Succeeder(c),
  repeat: (c, n) => new Repeater(c, n),
  retry: (c, n) => new Retry(c, n),
  cooldown: (c, s) => new Cooldown(c, s),
  timeout: (c, s) => new Timeout(c, s),
  random: (weights, ...c) => new RandomSelector(c, weights),
  guard: (cond, c) => new Guard(cond, c),
};

/**
 * Build a tree from plain data (so a tree can live in a JSON file, be edited, or come from a mod). Leaves name functions in `registry`.
 * `{ type: 'selector', children: [ { type: 'sequence', children: [ { type: 'condition', name: 'canSeeEnemy' }, { type: 'action', name: 'shoot' } ] }, { type: 'action', name: 'patrol' } ] }`
 * @param {object} spec @param {Record<string, (ctx: TickContext) => any>} registry
 */
export function fromData(spec, registry) {
  const kids = () => (spec.children ?? []).map((c) => fromData(c, registry));
  const fn = () => { const f = registry[spec.name]; if (!f) throw new Error(`behaviour tree: no function named "${spec.name}" in the registry`); return f; };
  switch (spec.type) {
    case 'action': return new Action(fn(), spec.name);
    case 'condition': return new Condition(fn(), spec.name);
    case 'wait': return new Wait(spec.seconds ?? 1);
    case 'sequence': return new Sequence(kids(), { memory: spec.memory ?? true });
    case 'selector': return new Selector(kids(), { memory: spec.memory ?? false });
    case 'parallel': return new Parallel(kids(), { policy: spec.policy ?? 'all' });
    case 'not': return new Inverter(kids()[0]);
    case 'always': return new Succeeder(kids()[0]);
    case 'repeat': return new Repeater(kids()[0], spec.times ?? Infinity);
    case 'retry': return new Retry(kids()[0], spec.times ?? 3);
    case 'cooldown': return new Cooldown(kids()[0], spec.seconds ?? 1);
    case 'timeout': return new Timeout(kids()[0], spec.seconds ?? 1);
    case 'random': return new RandomSelector(kids(), spec.weights ?? null);
    case 'guard': return new Guard(fn(), kids()[0]);
    default: throw new Error(`behaviour tree: unknown node type "${spec.type}"`);
  }
}

/** A readable outline of a tree (for debugging). */
export function describe(node, depth = 0) {
  const line = `${'  '.repeat(depth)}${node.constructor.name}${node.name && node.name !== node.constructor.name.toLowerCase() ? ` ${node.name}` : ''}`;
  return [line, ...node.children.map((c) => describe(c, depth + 1))].join('\n');
}
