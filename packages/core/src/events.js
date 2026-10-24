/** Synchronous event bus. Plugins communicate through events, not each other's internals. */
export class EventBus {
  constructor() {
    /** @type {Map<string, Set<Function>>} */
    this.handlers = new Map();
  }

  /**
   * @param {string} name Namespaced event name, e.g. `engine:entity-spawned`.
   * @param {(payload: any) => void} fn
   * @returns {() => void} Unsubscribe function.
   */
  on(name, fn) {
    let set = this.handlers.get(name);
    if (!set) this.handlers.set(name, (set = new Set()));
    set.add(fn);
    return () => set.delete(fn);
  }

  /**
   * @param {string} name
   * @param {any} [payload]
   */
  emit(name, payload) {
    const set = this.handlers.get(name);
    if (set) for (const fn of [...set]) fn(payload);
  }
}
