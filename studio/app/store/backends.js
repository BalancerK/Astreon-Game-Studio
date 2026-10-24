// Where a project's bytes live. The project store talks to a "backend" with five small methods, so the same store runs on the browser's IndexedDB (a
// person's real projects) and on a plain Map (tests, and a fallback when the browser refuses to store anything). Values are plain data that can be cloned.
//
//   get(store, key) -> value | undefined     put(store, key, value)     delete(store, key)
//   keys(store, prefix) -> string[]          clear()

export const STORES = ['projects', 'files', 'snapshots', 'blobs', 'meta'];

export class MemoryBackend {
  #data = new Map(STORES.map((s) => [s, new Map()]));

  async get(store, key) {
    const v = this.#data.get(store).get(key);
    return v === undefined ? undefined : structuredClone(v);
  }

  async put(store, key, value) { this.#data.get(store).set(key, structuredClone(value)); }

  async delete(store, key) { this.#data.get(store).delete(key); }

  async keys(store, prefix = '') { return [...this.#data.get(store).keys()].filter((k) => k.startsWith(prefix)).sort(); }

  async clear() { for (const m of this.#data.values()) m.clear(); }
}

/** The browser's IndexedDB. `open()` fails (rejects) where the browser does not allow it, for example in some private windows. */
export class IdbBackend {
  #db;

  constructor(db) { this.#db = db; }

  static open(name = 'studio') {
    return new Promise((resolve, reject) => {
      if (!globalThis.indexedDB) { reject(new Error('this browser has no IndexedDB')); return; }
      const request = indexedDB.open(name, 1);
      request.onupgradeneeded = () => { for (const s of STORES) request.result.createObjectStore(s); };
      request.onsuccess = () => resolve(new IdbBackend(request.result));
      request.onerror = () => reject(request.error ?? new Error('could not open the project database'));
      request.onblocked = () => reject(new Error('the project database is open in another version of the studio'));
    });
  }

  #run(store, mode, fn) {
    return new Promise((resolve, reject) => {
      const tx = this.#db.transaction(store, mode);
      const result = fn(tx.objectStore(store));
      tx.oncomplete = () => resolve(result?.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error('the save was cancelled'));
    });
  }

  get(store, key) { return this.#run(store, 'readonly', (s) => s.get(key)); }

  put(store, key, value) { return this.#run(store, 'readwrite', (s) => s.put(value, key)); }

  delete(store, key) { return this.#run(store, 'readwrite', (s) => s.delete(key)); }

  async keys(store, prefix = '') {
    const all = await this.#run(store, 'readonly', (s) => s.getAllKeys());
    return all.filter((k) => String(k).startsWith(prefix)).map(String).sort();
  }

  async clear() { for (const s of STORES) await this.#run(s, 'readwrite', (os) => os.clear()); }
}
