// Projects and their files, kept safe. The rules this file exists to keep:
//   - A change is saved the moment it is made (writes to the same file made in quick succession are merged, never lost).
//   - If saving fails, the person is told at once and the work stays in memory; nothing pretends to be saved that is not.
//   - Restore points (snapshots) are cheap (identical file contents are kept once) and restoring one first saves the state it replaces.
//   - Deleting a project only hides it for 30 days; deleting a file or restoring a snapshot can always be undone from a snapshot.
//   - Anything that comes from outside (a zip, a file name) is checked before it is believed.
import { Emitter } from '../util/emitter.js';
import { readZip, writeZip, safeEntryName } from './zip.js';

export const LIMITS = {
  name: 100, pathLength: 120, pathDepth: 8, fileBytes: 2 * 1024 * 1024, projectBytes: 20 * 1024 * 1024, files: 500, snapshots: 200,
};
const TEXT_EXTENSIONS = new Set(['js', 'mjs', 'json', 'md', 'txt', 'css', 'html', 'csv', 'glsl', 'wgsl', 'svg']);
const DAY = 24 * 60 * 60 * 1000;
const encoder = new TextEncoder();

export class StoreError extends Error {
  constructor(message, code) { super(message); this.name = 'StoreError'; this.code = code; }
}

/** Is this a name a project may call a file? Returns the reason it is not, or null. */
export function pathProblem(path) {
  if (typeof path !== 'string' || !path) return 'a file needs a name';
  if (path.length > LIMITS.pathLength) return `a file name can have at most ${LIMITS.pathLength} characters`;
  if (path.startsWith('/') || path.endsWith('/')) return 'a file name cannot start or end with a slash';
  if (/[\u0000-\u001f\\:*?"<>|]/.test(path)) return 'a file name cannot contain \\ : * ? " < > | or control characters';
  const parts = path.split('/');
  if (parts.length > LIMITS.pathDepth) return `folders can go at most ${LIMITS.pathDepth - 1} levels deep`;
  const odd = (p) => p === '' || p === '.' || p === '..' || p.endsWith('.') || p.endsWith(' ') || p.startsWith(' ');
  if (parts.some(odd)) return 'a file name cannot have empty parts, "." or "..", or spaces and dots at the ends of a part';
  return safeEntryName(path) ? null : 'that file name is not allowed';
}

const isTextPath = (path) => TEXT_EXTENSIONS.has(path.split('.').pop().toLowerCase());
const sizeOf = (content) => (typeof content === 'string' ? encoder.encode(content).length : content.length);

async function hashOf(content) {
  const bytes = typeof content === 'string' ? encoder.encode(content) : content;
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...digest.subarray(0, 16)].map((b) => b.toString(16).padStart(2, '0')).join('') + (typeof content === 'string' ? 't' : 'b');
}

const cleanName = (name) => String(name ?? '').replace(/\s+/g, ' ').trim().slice(0, LIMITS.name) || 'Untitled';

function randomId() {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return [...bytes].map((b) => b.toString(36).padStart(2, '0')).join('').slice(0, 8);
}

/** One open project: its files are in memory (reading is instant) and every change is written to the backend in the background. */
export class Project extends Emitter {
  #store;
  #meta;
  #files;
  #sizes = new Map();              // path -> bytes, so the total is known without measuring every file on every change
  #total = 0;
  #pending = new Map();            // path -> content, or null for "delete": changes not yet written
  #draining = null;
  #metaDirty = false;
  #lastSnapshotHashes = null;
  #lastAutoAt = 0;
  saveState = 'saved';             // 'saved' | 'saving' | 'error'
  saveError = null;

  constructor(store, meta, files) {
    super();
    this.#store = store;
    this.#meta = meta;
    this.#files = files;
    for (const [path, content] of files) { const n = sizeOf(content); this.#sizes.set(path, n); this.#total += n; }
  }

  get id() { return this.#meta.id; }
  get name() { return this.#meta.name; }
  get template() { return this.#meta.template; }
  get createdAt() { return this.#meta.createdAt; }
  get updatedAt() { return this.#meta.updatedAt; }
  get totalBytes() { return this.#total; }

  #track(path, content) {
    this.#total -= this.#sizes.get(path) ?? 0;
    if (content === null) {
      this.#sizes.delete(path);
    } else {
      const n = sizeOf(content);
      this.#sizes.set(path, n);
      this.#total += n;
    }
  }

  /** All file names, sorted. */
  list() { return [...this.#files.keys()].sort(); }

  has(path) { return this.#files.has(path); }

  read(path) { return this.#files.get(path); }

  /** The file's text ('' for a binary file). */
  readText(path) { const c = this.#files.get(path); return typeof c === 'string' ? c : ''; }

  /** A copy of all the files, as plain data. */
  toFiles() { return Object.fromEntries(this.#files); }

  // ---- changing files ----
  #check(path, content) {
    const problem = pathProblem(path);
    if (problem) throw new StoreError(problem, 'bad-path');
    if (content !== undefined) {
      if (typeof content !== 'string' && !(content instanceof Uint8Array)) throw new StoreError('a file holds text or bytes', 'bad-content');
      const size = sizeOf(content);
      if (size > LIMITS.fileBytes) throw new StoreError(`"${path}" is larger than ${Math.round(LIMITS.fileBytes / 1024 / 1024)} MB`, 'too-big');
      const total = this.#total - (this.#sizes.get(path) ?? 0) + size;
      if (total > LIMITS.projectBytes) {
        throw new StoreError(`the project would be larger than ${Math.round(LIMITS.projectBytes / 1024 / 1024)} MB`, 'too-big');
      }
      if (!this.#files.has(path) && this.#files.size >= LIMITS.files) {
        throw new StoreError(`a project can have at most ${LIMITS.files} files`, 'too-many');
      }
    }
  }

  /** Create or change a file. The change is visible at once; the returned promise resolves when it has been saved. */
  write(path, content) {
    this.#check(path, content);
    const created = !this.#files.has(path);
    if (!created && this.#files.get(path) === content) return this.#done();
    this.#files.set(path, content);
    this.#track(path, content);
    this.#queue(path, content);
    this.emit('change', { path, kind: created ? 'create' : 'write' });
    return this.#done();
  }

  /** Delete a file (it stays in earlier restore points). */
  remove(path) {
    if (!this.#files.has(path)) throw new StoreError(`there is no file "${path}"`, 'missing');
    this.#files.delete(path);
    this.#track(path, null);
    this.#queue(path, null);
    this.emit('change', { path, kind: 'remove' });
    return this.#done();
  }

  /** Give a file another name (or move it to another folder). */
  rename(from, to) {
    if (!this.#files.has(from)) throw new StoreError(`there is no file "${from}"`, 'missing');
    this.#check(to);
    if (this.#files.has(to)) throw new StoreError(`there is already a file "${to}"`, 'exists');
    const content = this.#files.get(from);
    this.#files.delete(from);
    this.#files.set(to, content);
    this.#track(from, null);
    this.#track(to, content);
    this.#queue(to, content);
    this.#queue(from, null);
    this.emit('change', { path: to, from, kind: 'rename' });
    return this.#done();
  }

  /** Rename the project. */
  setName(name) {
    this.#meta.name = cleanName(name);
    this.#touch();
    this.#setState('saving');
    this.#draining ??= this.#drain();
    this.emit('rename', this.#meta.name);
    return this.#done();
  }

  /** A promise for "saved". A caller that ignores it does not cause an unhandled rejection: a failure is also announced as a 'save-error' event. */
  #done() {
    const promise = this.flush();
    promise.catch(() => {});
    return promise;
  }

  #touch() {
    this.#meta.updatedAt = this.#store.now();
    this.#metaDirty = true;
  }

  #queue(path, content) {
    this.#pending.set(path, content);
    this.#touch();
    this.#setState('saving');
    this.#draining ??= this.#drain();
  }

  #setState(state, error = null) {
    if (this.saveState === state && this.saveError === error) return;
    this.saveState = state;
    this.saveError = error;
    this.emit('save-state', state, error);
  }

  async #drain() {
    await Promise.resolve();                                       // let a burst of changes in the same moment be merged
    try {
      while (this.#pending.size || this.#metaDirty) {
        const batch = [...this.#pending];
        this.#pending.clear();
        const metaNow = this.#metaDirty ? { ...this.#meta } : null;
        this.#metaDirty = false;
        for (const [path, content] of batch) {
          try {
            if (content === null) await this.#store.backend.delete('files', `${this.id}/${path}`);
            else {
              const kind = typeof content === 'string' ? 'text' : 'bytes';
              await this.#store.backend.put('files', `${this.id}/${path}`, { kind, data: content });
            }
          } catch (error) {
            if (!this.#pending.has(path)) this.#pending.set(path, content);   // keep it for the next try, unless a newer change has replaced it
            throw error;
          }
        }
        if (metaNow) await this.#store.backend.put('projects', this.id, metaNow);
      }
      this.#setState('saved');
    } catch (error) {
      this.#metaDirty = true;
      this.#setState('error', error);
      this.emit('save-error', error);
    } finally {
      this.#draining = null;
      if (this.#pending.size && this.saveState !== 'error') this.#draining = this.#drain();
    }
  }

  /** Resolves when every change so far has been written. Rejects if saving is failing. */
  async flush() {
    while (this.#draining) await this.#draining;
    if (this.saveState === 'error') throw this.saveError;
  }

  /** Try again to save what could not be saved (after the person freed some space, for example). */
  async retrySave() {
    if (this.#pending.size || this.#metaDirty) { this.#draining ??= this.#drain(); await this.flush(); }
    else this.#setState('saved');
  }

  // ---- restore points ----
  async #hashes() {
    const out = {};
    for (const [path, content] of this.#files) out[path] = await hashOf(content);
    return out;
  }

  /**
   * Keep a restore point of the files as they are now. Returns null when nothing changed since the last one.
   * @param {{label?: string, auto?: boolean}} [o]
   */
  async snapshot({ label = '', auto = false } = {}) {
    await this.flush();
    const hashes = await this.#hashes();
    const last = (await this.snapshots())[0];
    if (last) {
      const lastRecord = await this.#store.backend.get('snapshots', `${this.id}/${last.id}`);
      if (JSON.stringify(Object.entries(lastRecord.files).sort()) === JSON.stringify(Object.entries(hashes).sort())) {
        if (auto || !last.auto) return null;                           // nothing changed since the last restore point
        // asked for by hand: the automatic one that is already there is kept, with the name
        const kept = { ...lastRecord, auto: false, label: String(label).slice(0, 120) };
        await this.#store.backend.put('snapshots', `${this.id}/${last.id}`, kept);
        this.emit('snapshot', kept.id);
        return { id: kept.id, createdAt: kept.createdAt, label: kept.label, auto: false, fileCount: Object.keys(kept.files).length };
      }
    }
    if (!auto && (await this.snapshots()).filter((s) => !s.auto).length >= LIMITS.snapshots) {
      throw new StoreError(`there are ${LIMITS.snapshots} saved restore points: delete some first`, 'too-many');
    }
    for (const [path, hash] of Object.entries(hashes)) {
      const key = `${this.id}/${hash}`;
      if ((await this.#store.backend.get('blobs', key)) === undefined) await this.#store.backend.put('blobs', key, this.#files.get(path));
    }
    const id = `${String(this.#store.now()).padStart(14, '0')}-${this.#store.newId()}`;
    const record = { id, createdAt: this.#store.now(), label: String(label).slice(0, 120), auto, files: hashes };
    await this.#store.backend.put('snapshots', `${this.id}/${id}`, record);
    if (auto) await this.#thin();
    this.emit('snapshot', record.id);
    return { id, createdAt: record.createdAt, label: record.label, auto, fileCount: Object.keys(hashes).length };
  }

  /** A restore point if the files changed and at least `minIntervalMs` has passed since the last automatic one. */
  async autoSnapshot({ minIntervalMs = 5 * 60 * 1000 } = {}) {
    const now = this.#store.now();
    if (now - this.#lastAutoAt < minIntervalMs) return null;
    const made = await this.snapshot({ label: 'Automatic', auto: true });
    this.#lastAutoAt = now;
    return made;
  }

  /** Keep the newest `keepAuto` automatic restore points (the ones made by hand are never removed on their own). */
  async #thin(keepAuto = 30) {
    const all = await this.snapshots();
    const autos = all.filter((s) => s.auto);
    for (const old of autos.slice(keepAuto)) await this.#store.backend.delete('snapshots', `${this.id}/${old.id}`);
    if (autos.length > keepAuto) await this.#collectBlobs();
  }

  /** Forget file contents that no restore point refers to any more. */
  async #collectBlobs() {
    const used = new Set();
    for (const key of await this.#store.backend.keys('snapshots', `${this.id}/`)) {
      const s = await this.#store.backend.get('snapshots', key);
      Object.values(s.files).forEach((h) => used.add(`${this.id}/${h}`));
    }
    for (const key of await this.#store.backend.keys('blobs', `${this.id}/`)) if (!used.has(key)) await this.#store.backend.delete('blobs', key);
  }

  /** The restore points, newest first (without their contents). */
  async snapshots() {
    const out = [];
    for (const key of await this.#store.backend.keys('snapshots', `${this.id}/`)) {
      const s = await this.#store.backend.get('snapshots', key);
      out.push({ id: s.id, createdAt: s.createdAt, label: s.label, auto: s.auto, fileCount: Object.keys(s.files).length });
    }
    return out.sort((a, b) => (a.id < b.id ? 1 : -1));
  }

  /** Remove a restore point made by hand. */
  async deleteSnapshot(id) {
    await this.#store.backend.delete('snapshots', `${this.id}/${id}`);
    await this.#collectBlobs();
  }

  /** What differs between a restore point and the project now. */
  async diffAgainst(id) {
    const s = await this.#store.backend.get('snapshots', `${this.id}/${id}`);
    if (!s) throw new StoreError('that restore point no longer exists', 'missing');
    const now = await this.#hashes();
    return {
      added: Object.keys(now).filter((p) => !(p in s.files)).sort(),          // in the project now, not in the restore point
      removed: Object.keys(s.files).filter((p) => !(p in now)).sort(),        // in the restore point, gone now
      changed: Object.keys(now).filter((p) => p in s.files && s.files[p] !== now[p]).sort(),
    };
  }

  /** Go back to a restore point. What the project is now is kept as a restore point first, so this can itself be undone. */
  async restore(id) {
    const s = await this.#store.backend.get('snapshots', `${this.id}/${id}`);
    if (!s) throw new StoreError('that restore point no longer exists', 'missing');
    const label = s.label || new Date(s.createdAt).toISOString().slice(0, 16).replace('T', ' ');
    await this.snapshot({ label: `Before going back to "${label}"` });
    const contents = new Map();
    for (const [path, hash] of Object.entries(s.files)) {
      const c = await this.#store.backend.get('blobs', `${this.id}/${hash}`);
      if (c === undefined) throw new StoreError(`the restore point is damaged (missing the contents of "${path}")`, 'damaged');
      contents.set(path, c);
    }
    for (const path of this.list()) if (!contents.has(path)) this.remove(path);
    for (const [path, content] of contents) this.write(path, content);
    await this.flush();
    this.emit('restore', id);
  }

  // ---- leaving ----
  /** The project as a zip file's bytes. */
  exportZip() {
    return writeZip(Object.fromEntries(this.#files));
  }
}

export class ProjectStore {
  /** @param {import('./backends.js').MemoryBackend} backend @param {{now?: () => number, newId?: () => string}} [o] */
  constructor(backend, { now = () => Date.now(), newId = randomId } = {}) {
    this.backend = backend;
    this.now = now;
    this.newId = newId;
  }

  /** Projects, most recently changed first. */
  async list({ deleted = false } = {}) {
    const out = [];
    for (const id of await this.backend.keys('projects')) {
      const meta = await this.backend.get('projects', id);
      if (!meta || !!meta.deletedAt !== deleted) continue;
      out.push({ ...meta, fileCount: (await this.backend.keys('files', `${id}/`)).length });
    }
    return out.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /**
   * Start a project.
   * @param {{name?: string, template?: string, files?: Record<string, string | Uint8Array>}} [o]
   */
  async create({ name, template = 'blank', files = {} } = {}) {
    const meta = { id: this.newId(), name: cleanName(name), template, createdAt: this.now(), updatedAt: this.now(), version: 1 };
    const project = new Project(this, meta, new Map());
    await this.backend.put('projects', meta.id, meta);
    for (const [path, content] of Object.entries(files)) project.write(path, content);
    await project.flush();
    return project;
  }

  /** Open a project (all its files are read into memory). */
  async open(id) {
    const meta = await this.backend.get('projects', id);
    if (!meta || meta.deletedAt) throw new StoreError('that project does not exist', 'missing');
    const files = new Map();
    for (const key of await this.backend.keys('files', `${id}/`)) {
      const v = await this.backend.get('files', key);
      if (v) files.set(key.slice(id.length + 1), v.data);
    }
    return new Project(this, meta, files);
  }

  /** A copy of a project under a new name. */
  async duplicate(id, name) {
    const source = await this.open(id);
    return this.create({ name: name ?? `${source.name} copy`, template: source.template, files: source.toFiles() });
  }

  /** Hide a project. It can be brought back for 30 days (`restoreProject`). */
  async remove(id) {
    const meta = await this.backend.get('projects', id);
    if (!meta) throw new StoreError('that project does not exist', 'missing');
    await this.backend.put('projects', id, { ...meta, deletedAt: this.now() });
  }

  async restoreProject(id) {
    const meta = await this.backend.get('projects', id);
    if (!meta?.deletedAt) throw new StoreError('that project is not in the bin', 'missing');
    const { deletedAt, ...rest } = meta;
    void deletedAt;
    await this.backend.put('projects', id, { ...rest, updatedAt: this.now() });
  }

  /** Delete a project for good. */
  async purge(id) {
    for (const store of ['files', 'snapshots', 'blobs']) {
      for (const key of await this.backend.keys(store, `${id}/`)) await this.backend.delete(store, key);
    }
    await this.backend.delete('projects', id);
  }

  /** Delete projects that have been in the bin for more than `days` days. Returns how many. */
  async purgeOld(days = 30) {
    let n = 0;
    for (const p of await this.list({ deleted: true })) {
      if (this.now() - p.deletedAt > days * DAY) { await this.purge(p.id); n++; }
    }
    return n;
  }

  /**
   * Make a project from a zip file's bytes. Everything in it is checked: unsafe or odd paths are refused, text files must be valid text.
   * @param {Uint8Array} bytes @param {{name?: string}} [o]
   */
  async importZip(bytes, { name } = {}) {
    const entries = await readZip(bytes, { maxEntries: LIMITS.files, maxEntryBytes: LIMITS.fileBytes, maxTotalBytes: LIMITS.projectBytes });
    const files = {};
    const decoder = new TextDecoder('utf-8', { fatal: true });
    for (const [path, data] of entries) {
      const problem = pathProblem(path);
      if (problem) throw new StoreError(`the zip has a file the studio cannot use ("${path}": ${problem})`, 'bad-path');
      if (isTextPath(path)) {
        try { files[path] = decoder.decode(data); } catch { throw new StoreError(`"${path}" is not valid text`, 'bad-content'); }
      } else {
        files[path] = data;
      }
    }
    return this.create({ name: name ?? 'Imported project', template: 'import', files });
  }

  /** Small settings kept next to the projects (for example which projects were opened last). */
  async getMeta(key) { return this.backend.get('meta', key); }

  async setMeta(key, value) { return this.backend.put('meta', key, value); }
}
