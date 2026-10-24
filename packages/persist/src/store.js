// A key-value store with versions, the one thing the other persistence pieces are built on. Records live in a namespace (`profiles`, `matches`)
// under a key; every write bumps the record's version and can say which version it expects, so two servers writing the same record cannot
// silently overwrite each other. Anything with these five async methods will do: a database adapter implements the same contract.

/** A write expected an older version of the record than the one that exists. */
export class StoreConflictError extends Error {
  /** @param {string} ns @param {string} key @param {number} expected @param {number} actual */
  constructor(ns, key, expected, actual) {
    super(`${ns}/${key} changed since it was read (expected version ${expected}, it is ${actual})`);
    this.name = 'StoreConflictError'; this.ns = ns; this.key = key; this.expected = expected; this.actual = actual;
  }
}

const NAME = /^[A-Za-z0-9_.@:-]{1,128}$/;
/** Throw unless a namespace or key is one of the safe names every store accepts (letters, digits and `_ . @ : -`, up to 128). */
export function checkName(kind, name) {
  if (typeof name !== 'string' || !NAME.test(name) || name === '.' || name === '..') throw new Error(`${kind} "${String(name).slice(0, 40)}" is not allowed (letters, digits and _ . @ : - up to 128 characters)`);
}

const clone = (v) => JSON.parse(JSON.stringify(v));

/**
 * What every store provides. `ifVersion` on a write: omit it to write regardless, `0` to create only (fail if it exists), or the version you read.
 * @typedef {object} Store
 * @property {(ns: string, key: string) => Promise<{value: any, version: number} | null>} get
 * @property {(ns: string, key: string, value: any, o?: {ifVersion?: number}) => Promise<{version: number}>} put
 * @property {(ns: string, key: string, o?: {ifVersion?: number}) => Promise<boolean>} delete
 * @property {(ns: string, o?: {prefix?: string, limit?: number, after?: string}) => Promise<Array<{key: string, version: number}>>} list
 * @property {(ns: string, key: string, fn: (value: any, version: number) => any, o?: {retries?: number, create?: () => any}) => Promise<{value: any, version: number}>} update
 */

/**
 * Read, change and write a record, trying again if someone else wrote it in between (so concurrent updates never lose each other's changes).
 * `fn(value, version)` returns the new value (or changes `value` in place and returns nothing). Every store's `update` is this.
 * @param {Store} store @param {string} ns @param {string} key
 * @param {(value: any, version: number) => any} fn
 * @param {{retries?: number, create?: () => any}} [o] `create` makes the value when the record does not exist yet (without it, a missing record is an error).
 */
export async function updateRecord(store, ns, key, fn, { retries = 8, create } = {}) {
  for (let attempt = 0; ; attempt++) {
    const rec = await store.get(ns, key);
    if (!rec && !create) throw new Error(`${ns}/${key} does not exist`);
    const base = rec ? rec.value : create();
    const next = fn(base, rec?.version ?? 0) ?? base;
    try { const { version } = await store.put(ns, key, next, { ifVersion: rec?.version ?? 0 }); return { value: next, version }; }
    catch (e) { if (!(e instanceof StoreConflictError) || attempt >= retries) throw e; }
  }
}

/** Records in memory (tests, a single server that does not need to survive a restart). Values are copied in and out, so nothing aliases. */
export class MemoryStore {
  constructor() { /** @type {Map<string, Map<string, {value: string, version: number}>>} */ this.spaces = new Map(); }
  #ns(ns, create = false) { checkName('namespace', ns); let m = this.spaces.get(ns); if (!m && create) this.spaces.set(ns, m = new Map()); return m; }
  async get(ns, key) { checkName('key', key); const r = this.#ns(ns)?.get(key); return r ? { value: JSON.parse(r.value), version: r.version } : null; }
  async put(ns, key, value, { ifVersion } = {}) {
    checkName('key', key);
    const m = this.#ns(ns, true), cur = m.get(key), actual = cur?.version ?? 0;
    if (ifVersion !== undefined && ifVersion !== actual) throw new StoreConflictError(ns, key, ifVersion, actual);
    const version = actual + 1;
    m.set(key, { value: JSON.stringify(value), version });
    return { version };
  }
  async delete(ns, key, { ifVersion } = {}) {
    checkName('key', key);
    const m = this.#ns(ns), cur = m?.get(key);
    if (!cur) return false;
    if (ifVersion !== undefined && ifVersion !== cur.version) throw new StoreConflictError(ns, key, ifVersion, cur.version);
    m.delete(key); return true;
  }
  async list(ns, { prefix = '', limit = 100, after = '' } = {}) {
    const m = this.#ns(ns);
    if (!m) return [];
    return [...m.entries()].filter(([k]) => k.startsWith(prefix) && k > after).sort(([a], [b]) => (a < b ? -1 : 1)).slice(0, limit).map(([key, r]) => ({ key, version: r.version }));
  }
  update(ns, key, fn, o) { return updateRecord(this, ns, key, fn, o); }
  /** A deep copy of everything, for tests and backups: `{ ns: { key: value } }`. */
  dump() { return Object.fromEntries([...this.spaces].map(([ns, m]) => [ns, Object.fromEntries([...m].map(([k, r]) => [k, clone(JSON.parse(r.value))]))])); }
}
