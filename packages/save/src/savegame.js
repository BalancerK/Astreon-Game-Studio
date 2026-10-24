// The save manager: subsystems register sections (what to write, how to read it back, how old versions are upgraded), and slots are
// written safely (the previous file is kept as a backup) and loaded safely (everything is read, checked and upgraded before the game is
// touched at all; if applying it fails halfway, the game is put back as it was).
import { FORMAT, FORMAT_VERSION, SaveError, encode, decode } from './format.js';

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

/**
 * @typedef {object} SectionDef
 * @property {number} [version] Version of the data this section writes (1).
 * @property {() => any} save Return the section's state as plain data.
 * @property {(data: any, ctx: {file: any, meta: any}) => void} load Put it back (after upgrades). Sections load in the order registered.
 * @property {Record<number, (data: any) => any>} [migrations] `{ 1: (old) => v2data }`: how to upgrade data saved at that version by one step.
 * @property {boolean} [optional] A save without this section still loads (the section is left as it is).
 */

/**
 * Save and load for a game: slots, quick and rolling autosaves, sections the game registers (scene, physics, values…), safe writes
 * with a backup, checksums, migrations for old saves, and loads that are all-or-nothing.
 */
export class SaveGame {
  /**
   * @param {object} o
   * @param {string} o.game Name of the game (a save from another game is refused).
   * @param {number} [o.version] The game's version number (1). Saves from a newer version are refused; older ones go through `migrations`.
   * @param {{get: Function, set: Function, delete: Function, keys: Function}} o.storage
   * @param {() => number} [o.clock] Milliseconds (default `Date.now`): given so tests and replays are exact.
   * @param {boolean} [o.compress] gzip the files (where the platform can).
   * @param {number} [o.autosaveSlots] Rolling autosaves kept (3).
   * @param {Record<number, (file: any) => any>} [o.migrations] Whole-file upgrades by game version: `{ 1: (file) => file2 }` turns a version 1 save into version 2.
   */
  constructor({ game, version = 1, storage, clock = () => Date.now(), compress = false, autosaveSlots = 3, migrations = {} }) {
    if (!game) throw new Error('SaveGame needs the name of the game');
    this.game = game; this.version = version; this.storage = storage; this.clock = clock; this.compress = compress; this.autosaveSlots = autosaveSlots;
    this.migrations = migrations;
    /** @type {Map<string, SectionDef & {name: string}>} */ this.sections = new Map();
    /** Seconds played, carried across saves (call `tick(dt)` each frame while playing). */
    this.playtime = 0;
    this.beforeSave = []; this.afterLoad = [];
    this.busy = false;
  }

  /** Register a subsystem. Sections are written and loaded in the order registered, so put what others depend on first (the scene before the physics that refers to its bodies). */
  section(name, def) {
    if (this.sections.has(name)) throw new Error(`save section "${name}" is already registered`);
    if (typeof def.save !== 'function' || typeof def.load !== 'function') throw new Error(`save section "${name}" needs save() and load()`);
    this.sections.set(name, { version: 1, migrations: {}, ...def, name });
    return this;
  }

  /** Count play time. */
  tick(dt) { this.playtime += dt; }

  /** Run `fn()` just before every save (flush buffers, pause streaming) and `fn(meta)` after every load. */
  on(event, fn) { (event === 'beforeSave' ? this.beforeSave : this.afterLoad).push(fn); return this; }

  /**
   * The game's state as a file object, without writing anything (also what `load` restores if applying a save fails).
   * @param {Record<string, any>} [meta] Facts for the load screen: `{ title, level, thumbnail }`.
   */
  capture(meta = {}) {
    for (const fn of this.beforeSave) fn();
    const sections = {};
    for (const s of this.sections.values()) {
      try { sections[s.name] = { v: s.version, data: clone(s.save()) }; }
      catch (e) { throw new SaveError('section', `saving "${s.name}" failed: ${e.message}`, e); }
    }
    return { format: FORMAT, formatVersion: FORMAT_VERSION, game: this.game, gameVersion: this.version, savedAt: this.clock(), playtime: this.playtime, meta: clone(meta), sections };
  }

  #key(slot) { if (!/^[A-Za-z0-9_-]{1,48}$/.test(slot)) throw new SaveError('storage', `"${slot}" is not a usable slot name (letters, digits, - and _, up to 48)`); return `slot.${slot}`; }

  /**
   * Write a slot. The old file becomes `.bak` first, so a write that fails or is cut short never costs the player their save.
   * @returns {Promise<{slot: string, bytes: number, file: any}>}
   */
  async save(slot, meta = {}) {
    const key = this.#key(slot);
    const file = this.capture(meta);
    const text = await encode(file, { compress: this.compress });
    try {
      const old = await this.storage.get(key);
      if (old !== null) await this.storage.set(`${key}.bak`, old);
      await this.storage.set(key, text);
      await this.storage.set(`${key}.meta`, JSON.stringify(this.#header(file, text.length)));
    } catch (e) { throw new SaveError('storage', `could not write the save (${e.message})`, e); }
    return { slot, bytes: text.length, file };
  }

  #header(file, bytes) { return { slot: undefined, title: file.meta?.title ?? null, level: file.meta?.level ?? null, thumbnail: file.meta?.thumbnail ?? null, savedAt: file.savedAt, playtime: file.playtime, gameVersion: file.gameVersion, bytes }; }

  /** Everything for a load screen, newest first: slot, title, time, play time, size. Cheap (reads small header entries, not the saves). */
  async list() {
    const out = [];
    for (const k of await this.storage.keys('slot.')) {
      if (!k.endsWith('.meta')) continue;
      const slot = k.slice(5, -5);
      try { out.push({ ...JSON.parse(await this.storage.get(k)), slot }); } catch { out.push({ slot, title: null, savedAt: 0, error: 'unreadable header' }); }
    }
    return out.sort((a, b) => b.savedAt - a.savedAt);
  }

  async has(slot) { return (await this.storage.get(this.#key(slot))) !== null; }
  async delete(slot) { const key = this.#key(slot); for (const k of [key, `${key}.bak`, `${key}.meta`]) await this.storage.delete(k); }

  /** Read, check and upgrade a slot without touching the game. Falls back to the backup if the main file is damaged. @returns {Promise<{file: any, sections: Record<string, any>, recovered: boolean}>} */
  async read(slot) {
    const key = this.#key(slot);
    let recovered = false, file;
    const text = await this.storage.get(key);
    try {
      if (text === null) throw new SaveError('missing', `there is no save in slot "${slot}"`);
      file = await decode(text);
    } catch (e) {
      const backup = e.code === 'corrupt' || e.code === 'missing' ? await this.storage.get(`${key}.bak`) : null;
      if (backup === null) throw e;
      try { file = await decode(backup); recovered = true; } catch { throw e; }
    }
    return { ...this.#upgrade(file), recovered };
  }

  #upgrade(file) {
    if (file.game !== this.game) throw new SaveError('game', `this save belongs to "${file.game}", not "${this.game}"`);
    if (file.gameVersion > this.version) throw new SaveError('newer', `this save was made by version ${file.gameVersion} of the game; this is version ${this.version}`);
    let f = clone(file);
    for (let v = f.gameVersion; v < this.version; v++) {
      const step = this.migrations[v];
      if (step) { try { f = step(f) ?? f; } catch (e) { throw new SaveError('migration', `upgrading the save from game version ${v} failed: ${e.message}`, e); } }
      f.gameVersion = v + 1;
    }
    const sections = {};
    for (const s of this.sections.values()) {
      const saved = f.sections[s.name];
      if (!saved) { if (s.optional) continue; throw new SaveError('section', `the save has no "${s.name}" section`); }
      if (saved.v > s.version) throw new SaveError('newer', `the "${s.name}" part of this save is newer (${saved.v}) than this game understands (${s.version})`);
      let data = saved.data;
      for (let v = saved.v; v < s.version; v++) {
        const step = s.migrations[v];
        if (!step) throw new SaveError('migration', `no way to upgrade the "${s.name}" part of the save from version ${v} to ${v + 1}`);
        try { data = step(clone(data)); } catch (e) { throw new SaveError('migration', `upgrading "${s.name}" from version ${v} failed: ${e.message}`, e); }
      }
      sections[s.name] = data;
    }
    return { file: f, sections };
  }

  /**
   * Load a slot into the game. If anything is wrong with the file nothing changes; if a section fails while applying, the game is put back as it was.
   * @returns {Promise<{meta: any, recovered: boolean, ignored: string[], playtime: number}>}
   */
  async load(slot) {
    if (this.busy) throw new SaveError('apply', 'a load is already in progress');
    this.busy = true;
    try {
      const { file, sections, recovered } = await this.read(slot);
      const before = this.capture(file.meta); // to undo a failed load
      try {
        for (const s of this.sections.values()) if (s.name in sections) s.load(clone(sections[s.name]), { file, meta: file.meta });
      } catch (e) {
        try { for (const s of this.sections.values()) s.load(clone(before.sections[s.name].data), { file: before, meta: before.meta }); } catch { /* the original state could not be restored either: nothing more to try */ }
        throw new SaveError('apply', `loading the save failed and the game was put back as it was (${e.message})`, e);
      }
      this.playtime = file.playtime ?? 0;
      for (const fn of this.afterLoad) fn(file.meta);
      return { meta: file.meta, recovered, ignored: Object.keys(file.sections).filter((n) => !this.sections.has(n)), playtime: this.playtime };
    } finally { this.busy = false; }
  }

  // ---- quick and automatic saves ----
  quicksave(meta) { return this.save('quick', { title: 'Quicksave', ...meta }); }
  quickload() { return this.load('quick'); }

  /** Save into the rolling autosave slots (auto-1 is the newest; each save pushes the older ones down and drops the oldest). */
  async autosave(meta) {
    try {
      for (let i = this.autosaveSlots; i > 1; i--) {
        for (const suffix of ['', '.meta']) { const t = await this.storage.get(`slot.auto-${i - 1}${suffix}`); if (t !== null) await this.storage.set(`slot.auto-${i}${suffix}`, t); }
      }
    } catch (e) { throw new SaveError('storage', `could not write the save (${e.message})`, e); }
    return this.save('auto-1', { title: 'Autosave', ...meta });
  }
}

/**
 * Saves the game now and then while you tick it: `auto.tick(dt)` each frame; every `every` seconds it autosaves, unless `canSave()` says no
 * (in a fight, in a cutscene). Failures go to `onError` and never throw into the frame loop.
 */
export class AutoSaver {
  /** @param {SaveGame} saves @param {{every?: number, canSave?: () => boolean, meta?: () => object, onError?: (e: Error) => void}} [o] */
  constructor(saves, { every = 120, canSave = () => true, meta = () => ({}), onError = () => {} } = {}) { this.saves = saves; this.every = every; this.canSave = canSave; this.meta = meta; this.onError = onError; this.t = 0; this.pending = null; }
  tick(dt) {
    this.t += dt;
    if (this.t < this.every || this.pending || !this.canSave()) return;
    this.t = 0;
    this.pending = this.saves.autosave(this.meta()).catch((e) => this.onError(e)).finally(() => { this.pending = null; });
  }
}
