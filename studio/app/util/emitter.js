// A tiny event emitter: `on(name, fn)` returns a function that removes the listener. A listener that throws does not stop the others.
export class Emitter {
  /** Where a listener's error goes. By default it is thrown a moment later, so the browser's console shows it with its own location. */
  static onError = (error) => queueMicrotask(() => { throw error; });

  #listeners = new Map();

  /** @param {string} name @param {(...args: any[]) => void} fn @returns {() => void} a function that removes this listener */
  on(name, fn) {
    if (!this.#listeners.has(name)) this.#listeners.set(name, new Set());
    this.#listeners.get(name).add(fn);
    return () => this.#listeners.get(name)?.delete(fn);
  }

  /** Like `on`, but the listener runs once. */
  once(name, fn) {
    const off = this.on(name, (...args) => { off(); fn(...args); });
    return off;
  }

  emit(name, ...args) {
    for (const fn of [...(this.#listeners.get(name) ?? [])]) {
      try {
        fn(...args);
      } catch (error) {
        Emitter.onError(error);                         // reported, but the other listeners still run
      }
    }
  }
}
