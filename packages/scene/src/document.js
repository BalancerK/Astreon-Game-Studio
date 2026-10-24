// A scene being edited: every change is an operation that can be undone and redone, and the whole thing stays a valid scene file.
// This is the model behind the editor, but nothing here needs a browser, so tools and tests edit scenes the same way.
import { normalizeScene, emptyScene, validateScene, clone } from './format.js';

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Merge a patch into an object: objects merge, `null` removes a key, anything else replaces. */
function applyPatch(target, patch) {
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete target[k];
    else if (isObject(v) && isObject(target[k])) applyPatch(target[k], v);
    else target[k] = clone(v);
  }
  return target;
}

/**
 * A scene being edited: add, remove, reparent, rename, duplicate and patch entities, with undo and redo (one step per operation,
 * `batch` to group, `merge` to fold a drag into one step), change events and dirty tracking. Always stays a valid scene file
 * (`toJSON()`).
 */
export class SceneDocument {
  /**
   * @param {any} [data] A scene file (or nothing for an empty one).
   * @param {{library?: import('../../prefab/src/library.js').PrefabLibrary, maxHistory?: number}} [o] With a `library`, new entities must name a known prefab.
   */
  constructor(data, { library, maxHistory = 200 } = {}) {
    const s = normalizeScene(data ?? emptyScene());
    this.name = s.name; this.settings = s.settings; this.assets = s.assets; this.prefabs = s.prefabs;
    /** Notes an editor keeps with the scene (the 3D cursor...): saved in the file, never part of undo, and they do not make the scene "changed". */ this.editor = s.editor ?? {};
    this.library = library; this.maxHistory = maxHistory;
    /** @type {Map<string, any>} */ this.map = new Map(s.entities.map((e) => [e.id, e]));
    /** Entity ids in file order (the order of the hierarchy among siblings). */ this.order = s.entities.map((e) => e.id);
    this.undoStack = []; this.redoStack = [];
    this.listeners = [];
    this.tx = null;
    /** The undo depth at the last save: `dirty` compares with it. */ this.savedAt = 0;
    this.revision = 0;
    /** Counts every change as it is made (before the batch it belongs to has finished). */ this.mutations = 0;
  }

  // ---- reading ----
  get(id) { return this.map.get(id) ?? null; }
  has(id) { return this.map.has(id); }
  get size() { return this.map.size; }
  /** Entities in order. */
  get entities() { return this.order.map((id) => this.map.get(id)); }
  /** Children of an entity (or the roots, for null), in order. */
  children(id = null) { return this.order.filter((c) => (this.map.get(c).parent ?? null) === id); }
  /** An entity and everything below it, parents first. */
  subtree(id) { const out = [id]; for (let i = 0; i < out.length; i++) out.push(...this.children(out[i])); return out; }
  ancestors(id) { const out = []; let p = this.map.get(id)?.parent ?? null; while (p) { out.push(p); p = this.map.get(p)?.parent ?? null; } return out; }
  /** The scene as a file (a copy). */
  toJSON() { return { format: 'engine-scene', version: 1, name: this.name, settings: clone(this.settings), assets: clone(this.assets), prefabs: clone(this.prefabs), entities: this.entities.map((e) => clone(e)), ...(Object.keys(this.editor).length ? { editor: clone(this.editor) } : {}) }; }
  /**
   * Keep a note with the scene for the editor (a key and its value; `null` forgets it). It is saved with the scene but is not an edit: it cannot be undone and does not
   * make the scene "changed", so moving a 3D cursor does not ask to be saved.
   */
  setEditor(key, value) {
    if (value === null || value === undefined) delete this.editor[key]; else this.editor[key] = clone(value);
  }
  validate(o = {}) { return validateScene(this.toJSON(), { library: this.library, ...o }); }
  get dirty() { return this.undoStack.length !== this.savedAt; }
  markSaved() { this.savedAt = this.undoStack.length; }
  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }

  /** Call `fn(event)` after every change: `{kind: 'edit'|'undo'|'redo'|'load', label, ids}`. @returns {() => void} unsubscribe */
  onChange(fn) { this.listeners.push(fn); return () => { this.listeners.splice(this.listeners.indexOf(fn), 1); }; }
  #emit(kind, label, ids) { this.revision++; for (const fn of [...this.listeners]) fn({ kind, label, ids }); }

  // ---- the transaction machinery ----
  #touch(id) {
    this.mutations++; // (every mutation calls this first, so views can tell the document changed even in the middle of a batch)
    if (this.tx && !this.tx.before.has(id)) this.tx.before.set(id, this.map.has(id) ? clone(this.map.get(id)) : null);
  }

  /** Run `fn` as one undo step. Everything it changes (even through several operations) is undone together; if it throws, nothing changed. */
  batch(label, fn, { merge } = {}) {
    if (this.tx) return fn(); // joins the enclosing step
    const tx = this.tx = { before: new Map(), orderBefore: [...this.order], meta: { name: this.name, settings: clone(this.settings), assets: clone(this.assets), prefabs: clone(this.prefabs) } };
    let result;
    try { result = fn(); } catch (e) { this.#restore(tx.before, tx.orderBefore, tx.meta); this.tx = null; throw e; }
    this.tx = null;
    const after = new Map();
    for (const id of tx.before.keys()) after.set(id, this.map.has(id) ? clone(this.map.get(id)) : null);
    const metaAfter = { name: this.name, settings: clone(this.settings), assets: clone(this.assets), prefabs: clone(this.prefabs) };
    const changedIds = [...tx.before.keys()].filter((id) => !same(tx.before.get(id), after.get(id)));
    const reordered = !same(tx.orderBefore, this.order), metaChanged = !same(tx.meta, metaAfter);
    if (!changedIds.length && !reordered && !metaChanged) return result;
    const last = this.undoStack[this.undoStack.length - 1];
    const step = { label, merge, before: tx.before, after, orderBefore: tx.orderBefore, orderAfter: [...this.order], metaBefore: tx.meta, metaAfter };
    if (merge && last?.merge === merge && this.undoStack.length > this.savedAt) { // keep dragging as one step
      for (const [id, b] of tx.before) if (!last.before.has(id)) last.before.set(id, b);
      for (const [id, a] of after) last.after.set(id, a);
      last.orderAfter = step.orderAfter; last.metaAfter = metaAfter;
    } else { this.undoStack.push(step); if (this.undoStack.length > this.maxHistory) { this.undoStack.shift(); this.savedAt = Math.max(0, this.savedAt - 1); } }
    this.redoStack.length = 0;
    this.#emit('edit', label, changedIds);
    return result;
  }

  #restore(entities, order, meta) {
    for (const [id, e] of entities) { if (e === null) this.map.delete(id); else this.map.set(id, clone(e)); }
    this.order = [...order];
    this.name = meta.name; this.settings = clone(meta.settings); this.assets = clone(meta.assets); this.prefabs = clone(meta.prefabs);
  }
  undo() {
    const s = this.undoStack.pop(); if (!s) return false;
    this.#restore(s.before, s.orderBefore, s.metaBefore); this.redoStack.push(s);
    this.#emit('undo', s.label, [...s.before.keys()]); return true;
  }
  redo() {
    const s = this.redoStack.pop(); if (!s) return false;
    this.#restore(s.after, s.orderAfter, s.metaAfter); this.undoStack.push(s);
    this.#emit('redo', s.label, [...s.after.keys()]); return true;
  }
  /** Replace everything with another scene file; this cannot be undone and clears the history. */
  load(data) {
    const s = normalizeScene(data);
    this.name = s.name; this.settings = s.settings; this.assets = s.assets; this.prefabs = s.prefabs; this.editor = s.editor ?? {};
    this.map = new Map(s.entities.map((e) => [e.id, e])); this.order = s.entities.map((e) => e.id);
    this.undoStack = []; this.redoStack = []; this.savedAt = 0;
    this.#emit('load', 'load', [...this.order]);
  }

  // ---- operations ----
  /** A free id based on a name: 'crate' -> 'crate-1', 'crate-2'. */
  freeId(base) {
    const stem = String(base).replace(/[^A-Za-z0-9_.:-]/g, '-').replace(/-\d+$/, '').slice(0, 56) || 'entity';
    for (let n = 1; ; n++) { const id = `${stem}-${n}`; if (!this.map.has(id)) return id; }
  }
  #checkParent(id, parent) {
    if (parent === null || parent === undefined) return;
    if (!this.map.has(parent)) throw new Error(`there is no entity "${parent}" to be the parent of "${id}"`);
    if (parent === id || this.subtree(id).includes(parent)) throw new Error(`"${id}" cannot be placed inside itself ("${parent}" is below it)`);
  }
  #checkPrefab(prefab) {
    if (!this.library) return;
    if (!this.library.has(prefab) && !this.prefabs.some((p) => p.name === prefab)) throw new Error(`no prefab called "${prefab}"`);
  }

  /**
   * Add an entity. @param {{prefab: string, id?: string, name?: string, at?: object, params?: object, overrides?: object, parent?: string | null}} spec
   * @param {{index?: number}} [o] Position among all entities (default: after its parent's last descendant, or at the end).
   * @returns {string} the id
   */
  add(spec, { index } = {}) {
    return this.batch(`Add ${spec.prefab}`, () => {
      if (typeof spec.prefab !== 'string' || !spec.prefab) throw new Error('an entity needs a prefab name');
      this.#checkPrefab(spec.prefab);
      const id = spec.id ?? this.freeId(spec.prefab);
      if (this.map.has(id)) throw new Error(`there is already an entity "${id}"`);
      this.#checkParent(id, spec.parent);
      this.#touch(id);
      const e = { id, prefab: spec.prefab, ...(spec.name ? { name: spec.name } : {}), at: clone(spec.at ?? {}), ...(spec.params ? { params: clone(spec.params) } : {}), ...(spec.overrides ? { overrides: clone(spec.overrides) } : {}), parent: spec.parent ?? null };
      this.map.set(id, e);
      const where = index ?? (e.parent ? this.order.indexOf(this.subtree(e.parent).at(-1)) + 1 : this.order.length);
      this.order.splice(Math.max(0, Math.min(where, this.order.length)), 0, id);
      return id;
    });
  }

  /** Remove an entity and everything below it (or, with `keepChildren`, lift its children to its parent). */
  remove(id, { keepChildren = false } = {}) {
    return this.batch(`Delete ${id}`, () => {
      if (!this.map.has(id)) throw new Error(`there is no entity "${id}"`);
      const e = this.map.get(id);
      const doomed = keepChildren ? [id] : this.subtree(id);
      if (keepChildren) for (const c of this.children(id)) { this.#touch(c); this.map.get(c).parent = e.parent; }
      for (const d of doomed) { this.#touch(d); this.map.delete(d); }
      this.order = this.order.filter((x) => !doomed.includes(x));
      return doomed;
    });
  }

  /**
   * Change an entity: `patch` merges into it (`{ at: { x: 3 }, params: { hp: null } }`; null removes a key). `id` and `parent` cannot be patched here.
   * Pass `merge` (any string, e.g. 'drag') so a series of small changes while dragging is one undo step.
   */
  update(id, patch, { merge, label } = {}) {
    return this.batch(label ?? `Change ${id}`, () => {
      const e = this.map.get(id);
      if (!e) throw new Error(`there is no entity "${id}"`);
      if ('id' in patch || 'parent' in patch) throw new Error('use rename() and reparent() to change an id or a parent');
      if (patch.prefab !== undefined) this.#checkPrefab(patch.prefab);
      this.#touch(id);
      applyPatch(e, patch);
    }, { merge: merge ? `${merge}:${id}` : undefined });
  }

  /** Change one value by a path like 'at.x' or 'overrides.components.health.hp'. */
  set(id, path, value, o) {
    const patch = {}; let cur = patch; const parts = path.split('.');
    parts.slice(0, -1).forEach((p) => { cur = cur[p] = {}; });
    cur[parts.at(-1)] = value === undefined ? null : value;
    return this.update(id, patch, o);
  }

  /** Move an entity (and what is below it) under another entity, or to the top level (`null`), optionally before `beforeId`. */
  reparent(id, parent, { before } = {}) {
    return this.batch(`Move ${id}`, () => {
      if (!this.map.has(id)) throw new Error(`there is no entity "${id}"`);
      this.#checkParent(id, parent);
      this.#touch(id);
      const e = this.map.get(id);
      e.parent = parent ?? null;
      const moving = this.subtree(id);
      this.order = this.order.filter((x) => !moving.includes(x));
      let at;
      if (before) { if (!this.map.has(before) || moving.includes(before)) throw new Error(`cannot place before "${before}"`); at = this.order.indexOf(before); }
      else at = parent ? this.order.indexOf(this.subtree(parent).filter((x) => !moving.includes(x)).at(-1)) + 1 : this.order.length;
      this.order.splice(at, 0, ...moving);
    });
  }

  /** Give an entity another id; its children and any other reference follow. */
  rename(id, newId) {
    return this.batch(`Rename ${id}`, () => {
      if (!this.map.has(id)) throw new Error(`there is no entity "${id}"`);
      if (this.map.has(newId)) throw new Error(`there is already an entity "${newId}"`);
      if (!/^[A-Za-z0-9_.:-]{1,64}$/.test(newId)) throw new Error(`"${newId}" is not a usable id (letters, digits and - _ . :)`);
      this.#touch(id); this.#touch(newId);
      const e = this.map.get(id); this.map.delete(id); e.id = newId; this.map.set(newId, e);
      this.order[this.order.indexOf(id)] = newId;
      for (const c of this.children(id)) { this.#touch(c); this.map.get(c).parent = newId; }
    });
  }

  /** Copy an entity with everything below it, placed right after the original. @returns {string} the id of the copy */
  duplicate(id, { offset } = {}) {
    return this.batch(`Duplicate ${id}`, () => {
      if (!this.map.has(id)) throw new Error(`there is no entity "${id}"`);
      const ids = this.subtree(id), names = new Map();
      for (const old of ids) names.set(old, this.freeId(old.replace(/-\d+$/, '') || old));
      // free ids must differ from each other too
      const taken = new Set(this.map.keys());
      for (const old of ids) { let n = names.get(old); while (taken.has(n)) n = this.freeId(`${n}-x`); taken.add(n); names.set(old, n); }
      const insertAt = this.order.indexOf(ids.at(-1)) + 1;
      const copies = ids.map((old) => {
        const c = clone(this.map.get(old)); c.id = names.get(old);
        c.parent = old === id ? this.map.get(id).parent : names.get(c.parent);
        if (old === id && offset) c.at = { ...c.at, x: (c.at?.x ?? 0) + (offset.x ?? 0), y: (c.at?.y ?? 0) + (offset.y ?? 0), z: (c.at?.z ?? 0) + (offset.z ?? 0) };
        return c;
      });
      for (const c of copies) { this.#touch(c.id); this.map.set(c.id, c); }
      this.order.splice(insertAt, 0, ...copies.map((c) => c.id));
      return names.get(id);
    });
  }

  // ---- scene-level settings ----
  setName(name) { return this.batch('Rename scene', () => { this.name = name; }); }
  /** Merge into the scene's settings (null removes a key). */
  setSettings(patch, o) { return this.batch('Change scene settings', () => { applyPatch(this.settings, patch); }, { merge: o?.merge ? `settings:${o.merge}` : undefined }); }
  addAsset(type, path) { return this.batch(`Add asset ${path}`, () => { if (!this.assets.some((a) => a.path === path && a.type === type)) this.assets.push({ type, path }); }); }
  removeAsset(path) { return this.batch(`Remove asset ${path}`, () => { this.assets = this.assets.filter((a) => a.path !== path); }); }
  /** Define (or replace) a prefab that only this scene uses. */
  setPrefab(spec) { return this.batch(`Prefab ${spec.name}`, () => { const i = this.prefabs.findIndex((p) => p.name === spec.name); if (i >= 0) this.prefabs[i] = clone(spec); else this.prefabs.push(clone(spec)); }); }
}
