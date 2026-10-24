// The Node side of persistence: records in files, guest accounts, and an append-only log.
import { mkdir, readFile, writeFile, rename, rm, readdir, appendFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { StoreConflictError, checkName } from './store.js';

/**
 * Records as JSON files in a folder: `<dir>/<namespace>/<two hex digits>/<key>.json`, each written to a temporary file and renamed into place,
 * so a crash never leaves half a record. Writes to one record are queued, so version checks are exact inside one server process. Use it for one
 * server (or one server per folder); several servers sharing records need a database behind the same `Store` contract.
 * `list` reads folder names: fine for thousands of records, not for millions.
 */
export class FileStore {
  /** @param {string} dir */
  constructor(dir) { this.dir = dir; this.locks = new Map(); }
  #file(ns, key) {
    checkName('namespace', ns); checkName('key', key);
    const shard = createHash('sha1').update(key).digest('hex').slice(0, 2);
    return { dir: join(this.dir, ns, shard), path: join(this.dir, ns, shard, `${key.replaceAll(':', '%3A')}.json`) };
  }
  /** Run `fn` after the writes before it on the same record have finished. */
  #locked(id, fn) {
    const prev = this.locks.get(id) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    const tail = next.catch(() => {});
    this.locks.set(id, tail);
    tail.then(() => { if (this.locks.get(id) === tail) this.locks.delete(id); });
    return next;
  }
  async #read(path) {
    let text;
    try { text = await readFile(path, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
    try { const r = JSON.parse(text); return { value: r.value, version: r.v }; } catch (e) { throw new Error(`the record file ${path} is damaged (${e.message})`); }
  }
  async get(ns, key) { const { path } = this.#file(ns, key); return this.#read(path); }
  async #putNow(ns, key, value, ifVersion, dir, path) {
    const cur = await this.#read(path), actual = cur?.version ?? 0;
    if (ifVersion !== undefined && ifVersion !== actual) throw new StoreConflictError(ns, key, ifVersion, actual);
    const version = actual + 1;
    await mkdir(dir, { recursive: true });
    const tmp = `${path}.tmp-${process.pid}-${randomBytes(3).toString('hex')}`;
    await writeFile(tmp, JSON.stringify({ v: version, value }), 'utf8');
    await rename(tmp, path);
    return { version };
  }
  put(ns, key, value, { ifVersion } = {}) {
    const { dir, path } = this.#file(ns, key);
    return this.#locked(path, () => this.#putNow(ns, key, value, ifVersion, dir, path));
  }
  delete(ns, key, { ifVersion } = {}) {
    const { path } = this.#file(ns, key);
    return this.#locked(path, async () => {
      const cur = await this.#read(path);
      if (!cur) return false;
      if (ifVersion !== undefined && ifVersion !== cur.version) throw new StoreConflictError(ns, key, ifVersion, cur.version);
      await rm(path, { force: true });
      return true;
    });
  }
  async list(ns, { prefix = '', limit = 100, after = '' } = {}) {
    checkName('namespace', ns);
    const keys = [];
    let shards;
    try { shards = await readdir(join(this.dir, ns)); } catch (e) { if (e.code === 'ENOENT') return []; throw e; }
    for (const s of shards) for (const f of await readdir(join(this.dir, ns, s))) if (f.endsWith('.json')) { const key = f.slice(0, -5).replaceAll('%3A', ':'); if (key.startsWith(prefix) && key > after) keys.push(key); }
    keys.sort();
    const out = [];
    for (const key of keys.slice(0, limit)) { const r = await this.get(ns, key); if (r) out.push({ key, version: r.version }); }
    return out;
  }
  /** Read, change and write a record while holding its lock, so concurrent updates in this process queue up instead of retrying. */
  update(ns, key, fn, { create } = {}) {
    const { dir, path } = this.#file(ns, key);
    return this.#locked(path, async () => {
      const rec = await this.#read(path);
      if (!rec && !create) throw new Error(`${ns}/${key} does not exist`);
      const base = rec ? rec.value : create();
      const next = fn(base, rec?.version ?? 0) ?? base;
      const { version } = await this.#putNow(ns, key, next, rec?.version ?? 0, dir, path);
      return { value: next, version };
    });
  }
}

const sha256 = (s) => createHash('sha256').update(s).digest();
const ID_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

/**
 * Players without a sign-up: the first time someone plays they get an id and a secret to keep in the browser; showing the secret later proves it
 * is the same player. Only a hash of the secret is stored. Accounts can later be linked to a login from outside (a platform or social id),
 * which is how a guest keeps their progress when they sign in on another device.
 */
export class GuestAccounts {
  /** @param {object} o @param {import('./store.js').Store} o.store @param {() => number} [o.now] @param {string} [o.ns] */
  constructor({ store, now = () => Date.now(), ns = 'accounts' }) { this.store = store; this.now = now; this.ns = ns; this.linkNs = `${ns}-links`; }

  /** Make an account. @returns {Promise<{playerId: string, secret: string}>} give both to the player; the secret is not kept. */
  async create({ name = null } = {}) {
    for (let i = 0; i < 5; i++) {
      const bytes = randomBytes(12);
      const playerId = `p_${[...bytes].map((b) => ID_ALPHABET[b % ID_ALPHABET.length]).join('')}`;
      const secret = randomBytes(24).toString('base64url');
      try { await this.store.put(this.ns, playerId, { secretHash: sha256(secret).toString('hex'), createdAt: this.now(), name, links: {} }, { ifVersion: 0 }); return { playerId, secret }; }
      catch (e) { if (!(e instanceof StoreConflictError)) throw e; }
    }
    throw new Error('could not make a free player id');
  }
  /** Does this secret belong to this player? (Never throws; compares in constant time.) */
  async authenticate(playerId, secret) {
    if (typeof playerId !== 'string' || typeof secret !== 'string' || secret.length > 200) return false;
    let rec;
    try { rec = await this.store.get(this.ns, playerId); } catch { return false; }
    if (!rec) { sha256(secret); return false; }
    return timingSafeEqual(sha256(secret), Buffer.from(rec.value.secretHash, 'hex'));
  }
  async get(playerId) { const r = await this.store.get(this.ns, playerId); return r ? { playerId, name: r.value.name, createdAt: r.value.createdAt, links: r.value.links } : null; }
  async setName(playerId, name) { await this.store.update(this.ns, playerId, (a) => { a.name = String(name).slice(0, 40); }); }
  /** A new secret (the old one stops working): for "log out everywhere" or a lost device. */
  async rotateSecret(playerId) { const secret = randomBytes(24).toString('base64url'); await this.store.update(this.ns, playerId, (a) => { a.secretHash = sha256(secret).toString('hex'); }); return secret; }
  /** Tie an outside identity (`google`, `steam`…) to a player. One outside identity belongs to one player. @returns {Promise<boolean>} false if it already belongs to someone else */
  async link(playerId, provider, externalId) {
    checkName('provider', provider);
    const key = `${provider}:${externalId}`;
    try { await this.store.put(this.linkNs, key, { playerId }, { ifVersion: 0 }); }
    catch (e) { if (e instanceof StoreConflictError) return (await this.store.get(this.linkNs, key)).value.playerId === playerId; throw e; }
    await this.store.update(this.ns, playerId, (a) => { a.links[provider] = externalId; });
    return true;
  }
  /** The player an outside identity belongs to, or null. */
  async findByLink(provider, externalId) { const r = await this.store.get(this.linkNs, `${provider}:${externalId}`); return r?.value.playerId ?? null; }
  /** Delete an account and its links. */
  async delete(playerId) {
    const rec = await this.store.get(this.ns, playerId);
    if (!rec) return false;
    for (const [provider, id] of Object.entries(rec.value.links)) await this.store.delete(this.linkNs, `${provider}:${id}`);
    return this.store.delete(this.ns, playerId);
  }
}

/** An append-only log of JSON lines (match results, purchases, moderation actions): cheap to write, rotated by size, easy to read back. */
export class AppendLog {
  /** @param {string} path @param {{maxBytes?: number, keep?: number}} [o] `maxBytes`: rotate at this size (5 MB); `keep`: how many old files to keep (3). */
  constructor(path, { maxBytes = 5_000_000, keep = 3 } = {}) { this.path = path; this.maxBytes = maxBytes; this.keep = keep; this.queue = Promise.resolve(); this.size = null; }
  /** Add one record (any JSON value). Returns a promise for when it is written; writes keep their order. */
  append(record) {
    const line = `${JSON.stringify(record)}\n`;
    const job = this.queue.then(async () => {
      if (this.size === null) { try { this.size = (await stat(this.path)).size; } catch { this.size = 0; } }
      if (this.size + line.length > this.maxBytes && this.size > 0) {
        await rm(`${this.path}.${this.keep}`, { force: true });
        for (let i = this.keep - 1; i >= 1; i--) await rename(`${this.path}.${i}`, `${this.path}.${i + 1}`).catch(() => {});
        await rename(this.path, `${this.path}.1`).catch(() => {});
        this.size = 0;
      }
      await appendFile(this.path, line, 'utf8'); this.size += line.length;
    });
    this.queue = job.catch(() => {});
    return job;
  }
  /** The last `count` records, oldest first (looking back through rotated files if needed). */
  async tail(count = 100) {
    await this.queue;
    const out = [];
    for (const f of [this.path, ...Array.from({ length: this.keep }, (_, i) => `${this.path}.${i + 1}`)]) {
      let text; try { text = await readFile(f, 'utf8'); } catch { continue; }
      const lines = text.split('\n').filter(Boolean);
      for (let i = lines.length - 1; i >= 0 && out.length < count; i--) { try { out.unshift(JSON.parse(lines[i])); } catch { /* a torn last line after a crash */ } }
      if (out.length >= count) break;
    }
    return out;
  }
  /** Wait until everything appended so far is on disk. */
  flush() { return this.queue; }
}
