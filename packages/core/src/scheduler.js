/**
 * @typedef {Object} SystemOptions
 * @property {string[]} [before] Run before these systems (absent names are ignored).
 * @property {string[]} [after] Run after these systems (absent names are ignored).
 */

/**
 * Orders systems by before/after constraints (stable: ties keep registration
 * order). Constraints naming systems that are not registered are ignored, so a
 * plugin can say "before render" and still work on a headless server.
 */
export class Scheduler {
  constructor() {
    /** @type {Map<string, {name: string, fn: Function, before: string[], after: string[]}>} */
    this.systems = new Map();
    /** @type {{name: string, fn: Function}[] | null} */
    this.sorted = null;
  }

  /**
   * @param {string} name Unique system name.
   * @param {Function} fn
   * @param {SystemOptions} [opts]
   */
  add(name, fn, { before = [], after = [] } = {}) {
    if (this.systems.has(name)) throw new Error(`duplicate system "${name}"`);
    this.systems.set(name, { name, fn, before, after });
    this.sorted = null;
  }

  /** @returns {string[]} System names in execution order. */
  order() {
    return this.#sort().map((s) => s.name);
  }

  /** Run every system once, in order, passing `...args`. */
  run(...args) {
    const list = this.#sort();
    for (let i = 0; i < list.length; i++) list[i].fn(...args);
  }

  #sort() {
    if (this.sorted) return this.sorted;
    const names = [...this.systems.keys()];
    const edges = new Map(names.map((n) => [n, new Set()]));
    const indegree = new Map(names.map((n) => [n, 0]));
    const link = (from, to) => {
      if (!edges.has(from) || !edges.has(to) || edges.get(from).has(to)) return;
      edges.get(from).add(to);
      indegree.set(to, indegree.get(to) + 1);
    };
    for (const s of this.systems.values()) {
      for (const b of s.before) link(s.name, b);
      for (const a of s.after) link(a, s.name);
    }
    const result = [];
    const ready = names.filter((n) => indegree.get(n) === 0);
    while (ready.length) {
      // Pick the earliest-registered ready system to keep ordering stable.
      ready.sort((a, b) => names.indexOf(a) - names.indexOf(b));
      const n = ready.shift();
      result.push(this.systems.get(n));
      for (const m of edges.get(n)) {
        indegree.set(m, indegree.get(m) - 1);
        if (indegree.get(m) === 0) ready.push(m);
      }
    }
    if (result.length !== names.length) {
      const stuck = names.filter((n) => indegree.get(n) > 0);
      throw new Error(`system ordering cycle involving: ${stuck.join(', ')}`);
    }
    return (this.sorted = result);
  }
}
