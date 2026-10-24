// Loading, caching and reloading game files. You ask for an asset by type and logical path ('texture', 'tex/bricks.png'); the manager
// finds its (possibly content-hashed) URL in the manifest, fetches it once however many ask, decodes it with the loader for that type,
// counts who is using it, frees it when nobody is, and swaps in a new version when the file changes (hot reload).

/**
 * An asset could not be fetched or decoded. `type` and `path` say which one; the message says why, and `cause` holds the original
 * error.
 */
export class AssetError extends Error {
  constructor(type, path, message, cause) { super(`asset ${type}:${path}: ${message}`); this.name = 'AssetError'; this.type = type; this.path = path; if (cause) this.cause = cause; }
}

/**
 * A reference to an asset. It stays valid across hot reloads: read `.value` each time you need it (do not keep the value).
 * @template T
 */
export class AssetHandle {
  constructor(manager, type, path) {
    this.manager = manager; this.type = type; this.path = path;
    /** @type {T | undefined} */ this.value = undefined;
    /** 'loading' | 'ready' | 'failed' */ this.status = 'loading';
    /** Counts up each time a (re)load replaces the value. */ this.version = 0;
    /** @type {Error | null} */ this.error = null;
    this.refs = 0;
    this.deps = new Set();   // handles this asset's loader used
    this.bytes = 0;
    this.promise = null;
    this.hash = null;
  }
  get ready() { return this.status === 'ready'; }
}

/**
 * @typedef {object} LoadContext
 * @property {string} url Where it is being fetched from.
 * @property {string} path The logical path.
 * @property {() => Promise<ArrayBuffer>} bytes
 * @property {() => Promise<string>} text
 * @property {() => Promise<any>} json
 * @property {(type: string, path: string) => Promise<any>} load Load another asset this one needs (it is released with this one).
 * @property {(relative: string) => string} sibling The logical path of a file referred to relative to this one ('model.bin' next to 'models/tree.gltf').
 * @property {AbortSignal} signal
 */
/**
 * @typedef {object} Loader
 * @property {(ctx: LoadContext) => Promise<any> | any} load
 * @property {(value: any) => void} [dispose] Free GPU memory, close handles.
 * @property {string[]} [extensions] File extensions (without dot) this type is guessed from.
 */

/**
 * Loads, caches and reloads game files. Ask for an asset by type and logical path (`load("image", "tex/bricks.png")`); it finds
 * the real (possibly content-hashed) URL in the manifest, fetches it once however many ask, decodes it with the loader for its
 * type, counts who uses it, frees it with `collect()` when nobody does, and swaps in new versions when files change
 * (`update(manifest)`).
 */
export class AssetManager {
  /**
   * @param {object} [o]
   * @param {string} [o.base] Prefix for every URL ('/assets/').
   * @param {{assets: Record<string, {url?: string, hash?: string, bytes?: number}>}} [o.manifest] From the build step: logical path -> hashed file.
   * @param {typeof fetch} [o.fetch]
   * @param {number} [o.retries] Extra tries for network failures (2), with growing waits.
   * @param {(ms: number) => Promise<void>} [o.sleep] Injected for tests.
   */
  constructor({ base = '', manifest = { assets: {} }, fetch: f = globalThis.fetch?.bind(globalThis), retries = 2, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
    this.base = base; this.manifest = manifest; this.fetch = f; this.retries = retries; this.sleep = sleep;
    /** @type {Map<string, Loader>} */ this.loaders = new Map();
    /** @type {Map<string, AssetHandle>} */ this.handles = new Map();
    this.listeners = new Map();
    this.pendingBytes = 0;
    this.stats = { fetches: 0, bytes: 0, reloads: 0, failures: 0 };
  }

  /** Teach the manager a type. */
  register(type, loader) { this.loaders.set(type, loader); return this; }
  /** Register many: `{ json, text, ... }`. */
  registerAll(loaders) { for (const [t, l] of Object.entries(loaders)) this.register(t, l); return this; }

  on(event, fn) { let l = this.listeners.get(event); if (!l) this.listeners.set(event, l = []); l.push(fn); return () => { l.splice(l.indexOf(fn), 1); }; }
  #emit(event, ...args) { for (const fn of [...(this.listeners.get(event) ?? [])]) { try { fn(...args); } catch (e) { console.error(`asset listener for "${event}" failed:`, e); } } }

  /** Which type a file is, from its extension (null if no registered type claims it). */
  typeOf(path) {
    const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
    for (const [t, l] of this.loaders) if (l.extensions?.includes(ext)) return t;
    return null;
  }

  /** The URL a logical path is fetched from. */
  urlOf(path) {
    const entry = this.manifest.assets?.[path];
    const file = entry?.url ?? path;
    return /^([a-z]+:)?\/\//i.test(file) || file.startsWith('/') || file.startsWith('data:') || file.startsWith('blob:') ? file : this.base + file;
  }

  #key(type, path) { return `${type}:${path}`; }

  /** The handle for an asset, starting the load if it is new. It counts as one use: call `release` when you are done. */
  acquire(type, path) {
    if (!type) { type = this.typeOf(path); if (!type) throw new AssetError('?', path, 'no loader claims this file type (register one, or pass the type)'); }
    const loader = this.loaders.get(type);
    if (!loader) throw new AssetError(type, path, `unknown asset type (registered: ${[...this.loaders.keys()].join(', ') || 'none'})`);
    const key = this.#key(type, path);
    let h = this.handles.get(key);
    if (!h) { h = new AssetHandle(this, type, path); this.handles.set(key, h); h.promise = this.#run(h, loader); }
    else if (h.status === 'failed') { h.status = 'loading'; h.error = null; h.promise = this.#run(h, loader); } // asking again retries
    h.refs++;
    return h;
  }

  /** Load an asset and resolve with its value (it counts as one use). */
  async load(type, path) {
    const h = this.acquire(type, path);
    try { await h.promise; } catch (e) { this.release(h); throw e; }
    return h.value;
  }

  /**
   * Load many at once. `list` entries are `{type?, path}` or just a path. Progress is reported as each finishes.
   * @param {Array<string | {type?: string, path: string}>} list
   * @param {{onProgress?: (p: {loaded: number, total: number, path: string, failed: number}) => void, failFast?: boolean}} [o]
   * @returns {Promise<AssetHandle[]>} the handles (all of them, or it throws the first failure with `failFast`; otherwise failures are listed in the error of `AggregateError`)
   */
  async loadAll(list, { onProgress, failFast = false } = {}) {
    const items = list.map((i) => (typeof i === 'string' ? { path: i } : i));
    let loaded = 0, failed = 0;
    const handles = items.map((i) => { try { return this.acquire(i.type, i.path); } catch (e) { return e; } });
    const errors = [];
    await Promise.all(handles.map(async (h, n) => {
      try {
        if (h instanceof Error) throw h;
        await h.promise;
      } catch (e) { failed++; errors.push(e); if (failFast) throw e; }
      loaded++;
      onProgress?.({ loaded, total: items.length, path: items[n].path, failed });
    }));
    if (errors.length) { for (const h of handles) if (!(h instanceof Error)) this.release(h); throw new AggregateError(errors, `${errors.length} of ${items.length} assets failed to load: ${errors.map((e) => e.message).join('; ')}`); }
    return handles;
  }

  /** One fewer user. At zero the asset stays cached until `collect()`. */
  release(handle) { if (handle.refs > 0) handle.refs--; }

  /** The value of an asset that is already loaded (throws if it is not; use `load` first). */
  get(type, path) {
    const h = this.handles.get(this.#key(type, path));
    if (!h || h.status !== 'ready') throw new AssetError(type, path, h ? `is ${h.status}` : 'was never loaded');
    return h.value;
  }
  /** The handle if it exists, without using it. */
  peek(type, path) { return this.handles.get(this.#key(type, path)) ?? null; }

  /** Dispose every asset nobody uses (and the dependencies only they used). @returns {number} how many were freed */
  collect() {
    let freed = 0, again = true;
    while (again) {
      again = false;
      for (const [key, h] of this.handles) {
        if (h.refs > 0 || h.status === 'loading') continue;
        // an asset that another loaded asset depends on stays while that one is cached
        let needed = false; for (const o of this.handles.values()) if (o !== h && o.deps.has(h)) { needed = true; break; }
        if (needed) continue;
        this.#dispose(h); this.handles.delete(key); freed++; again = true;
        for (const d of h.deps) this.release(d);
      }
    }
    return freed;
  }
  #dispose(h) { if (h.status === 'ready') { try { this.loaders.get(h.type).dispose?.(h.value); } catch (e) { console.error(`dispose of ${h.type}:${h.path} failed:`, e); } } h.value = undefined; }

  async #fetchBytes(url, path, type, signal) {
    let lastError;
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      try {
        this.stats.fetches++;
        const res = await this.fetch(url, { signal });
        if (!res.ok) { const e = new Error(`HTTP ${res.status}`); e.status = res.status; throw e; }
        const buf = await res.arrayBuffer();
        this.stats.bytes += buf.byteLength;
        return buf;
      } catch (e) {
        lastError = e;
        if (e.name === 'AbortError' || (e.status && e.status < 500 && e.status !== 408 && e.status !== 429)) break; // not worth retrying
        if (attempt < this.retries) await this.sleep(100 * 2 ** attempt);
      }
    }
    throw new AssetError(type, path, `could not be fetched from ${url} (${lastError?.message})`, lastError);
  }

  async #run(h, loader) {
    const { type, path } = h;
    const controller = new AbortController();
    const url = this.urlOf(path);
    const entry = this.manifest.assets?.[path];
    const deps = new Set();
    let cached;
    const bytes = () => (cached ??= this.#fetchBytes(url, path, type, controller.signal));
    const ctx = {
      url, path, signal: controller.signal, bytes,
      text: async () => new TextDecoder().decode(await bytes()),
      json: async () => { const t = new TextDecoder().decode(await bytes()); try { return JSON.parse(t); } catch (e) { throw new AssetError(type, path, `is not valid JSON (${e.message})`, e); } },
      load: async (t, p) => { const d = this.acquire(t, p); deps.add(d); await d.promise; return d.value; },
      sibling: (p) => new URL(p, new URL(path, 'http://x/')).pathname.slice(1),
    };
    try {
      const value = await loader.load(ctx);
      for (const d of h.deps) this.release(d);
      h.deps = deps;
      h.value = value; h.status = 'ready'; h.version++; h.error = null; h.hash = entry?.hash ?? null;
      h.bytes = cached ? (await cached).byteLength : 0;
      this.#emit('loaded', h);
    } catch (e) {
      for (const d of deps) this.release(d);
      h.status = 'failed'; h.error = e instanceof AssetError ? e : new AssetError(type, path, `failed to load (${e.message})`, e);
      this.stats.failures++;
      this.#emit('failed', h);
      throw h.error;
    }
  }

  /**
   * Replace an asset's value from its file again. Anything holding the handle sees the new value; if the new file fails to load, the old value stays.
   * @returns {Promise<boolean>} true if it was reloaded
   */
  async reload(type, path) {
    const h = this.handles.get(this.#key(type, path));
    if (!h || h.status === 'loading') return false;
    const loader = this.loaders.get(type), old = { value: h.value, status: h.status, deps: h.deps, version: h.version };
    const wasFailed = h.status === 'failed';
    h.deps = new Set(); // #run releases the previous ones after success
    const prev = old.deps;
    try {
      h.status = 'loading';
      await (h.promise = this.#run(h, loader));
      for (const d of prev) this.release(d);
      if (!wasFailed) this.#dispose({ ...h, status: 'ready', value: old.value, type });
      this.stats.reloads++;
      this.#emit('reload', h);
      return true;
    } catch {
      h.value = old.value; h.status = old.status === 'ready' ? 'ready' : 'failed'; h.deps = prev; h.version = old.version;
      return false;
    }
  }

  /**
   * Take a new manifest (from a rebuilt game or a dev server) and reload every loaded asset whose hash changed.
   * @returns {Promise<string[]>} the logical paths that were reloaded
   */
  async update(manifest) {
    const before = this.manifest.assets ?? {};
    this.manifest = manifest;
    const changed = [];
    for (const h of [...this.handles.values()]) {
      const a = before[h.path], b = manifest.assets?.[h.path];
      if (h.status === 'loading' || (a?.hash === b?.hash && a?.url === b?.url)) continue;
      if (await this.reload(h.type, h.path)) changed.push(h.path);
    }
    return changed;
  }
}
