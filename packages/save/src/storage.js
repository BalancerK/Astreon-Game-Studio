// Where saves are kept. A storage is four async functions over text; slots are just keys. Memory (tests, a session), the browser's
// localStorage and IndexedDB, and a server over HTTP are here; files on disk are in `node.js`.

/** Keys in memory (nothing survives the process). */
export class MemoryStorage {
  constructor() { this.map = new Map(); }
  async get(key) { return this.map.get(key) ?? null; }
  async set(key, text) { this.map.set(key, text); }
  async delete(key) { this.map.delete(key); }
  async keys(prefix = '') { return [...this.map.keys()].filter((k) => k.startsWith(prefix)).sort(); }
}

/** The browser's `localStorage` (about 5 MB in all: compress, or use IndexedDB, for big saves). A full or blocked store reports 'storage'. */
export class LocalStorageStorage {
  /** @param {string} [namespace] Prefix for every key, so games on one origin do not mix. @param {Storage} [store] */
  constructor(namespace = 'save:', store = globalThis.localStorage) { this.ns = namespace; this.store = store; }
  async get(key) { return this.store.getItem(this.ns + key); }
  async set(key, text) { this.store.setItem(this.ns + key, text); }
  async delete(key) { this.store.removeItem(this.ns + key); }
  async keys(prefix = '') { const out = []; for (let i = 0; i < this.store.length; i++) { const k = this.store.key(i); if (k.startsWith(this.ns + prefix)) out.push(k.slice(this.ns.length)); } return out.sort(); }
}

/** The browser's IndexedDB: much more room than localStorage. */
export class IndexedDbStorage {
  constructor(name = 'saves', idb = globalThis.indexedDB) { this.name = name; this.idb = idb; this.db = null; }
  #open() {
    if (this.db) return Promise.resolve(this.db);
    return new Promise((resolve, reject) => {
      const req = this.idb.open(this.name, 1);
      req.onupgradeneeded = () => req.result.createObjectStore('files');
      req.onsuccess = () => resolve(this.db = req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async #tx(mode, fn) {
    const db = await this.#open();
    return new Promise((resolve, reject) => {
      const t = db.transaction('files', mode), store = t.objectStore('files'), req = fn(store);
      t.oncomplete = () => resolve(req.result ?? null);
      t.onerror = () => reject(t.error); t.onabort = () => reject(t.error);
    });
  }
  get(key) { return this.#tx('readonly', (s) => s.get(key)); }
  async set(key, text) { await this.#tx('readwrite', (s) => s.put(text, key)); }
  async delete(key) { await this.#tx('readwrite', (s) => s.delete(key)); }
  async keys(prefix = '') { const all = await this.#tx('readonly', (s) => s.getAllKeys()); return all.filter((k) => k.startsWith(prefix)).sort(); }
}

/**
 * Saves on a server (see `createSaveHandler` in node.js): `GET {base}/{key}`, `PUT`, `DELETE`, `GET {base}?prefix=` (a JSON list of keys).
 * Writes carry `If-Match` with the checksum of what you last read, so two devices cannot silently overwrite each other (a 412 is a 'conflict').
 */
export class HttpStorage {
  /** @param {string} base @param {{headers?: Record<string, string>, fetch?: typeof fetch}} [o] */
  constructor(base, { headers = {}, fetch: f = globalThis.fetch?.bind(globalThis) } = {}) { this.base = base.replace(/\/$/, ''); this.headers = headers; this.fetch = f; this.etags = new Map(); }
  async get(key) {
    const r = await this.fetch(`${this.base}/${encodeURIComponent(key)}`, { headers: this.headers });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`server said ${r.status}`);
    const etag = r.headers.get('etag'); if (etag) this.etags.set(key, etag);
    return r.text();
  }
  async set(key, text) {
    const headers = { ...this.headers, 'content-type': 'text/plain' };
    if (this.etags.has(key)) headers['if-match'] = this.etags.get(key);
    const r = await this.fetch(`${this.base}/${encodeURIComponent(key)}`, { method: 'PUT', headers, body: text });
    if (r.status === 412) { const e = new Error('the save changed on the server since it was read'); e.conflict = true; throw e; }
    if (!r.ok) throw new Error(`server said ${r.status}`);
    const etag = r.headers.get('etag'); if (etag) this.etags.set(key, etag);
  }
  async delete(key) { this.etags.delete(key); const r = await this.fetch(`${this.base}/${encodeURIComponent(key)}`, { method: 'DELETE', headers: this.headers }); if (!r.ok && r.status !== 404) throw new Error(`server said ${r.status}`); }
  async keys(prefix = '') { const r = await this.fetch(`${this.base}?prefix=${encodeURIComponent(prefix)}`, { headers: this.headers }); if (!r.ok) throw new Error(`server said ${r.status}`); return r.json(); }
}
