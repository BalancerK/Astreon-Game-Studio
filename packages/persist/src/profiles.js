// Player profiles: the data that outlives a match (name, rating, unlocks, settings). A profile is open while its player is connected: changes
// are made in memory (fast, no database round trip per action) and written back in the background, when the player leaves, and on shutdown.
// Old profiles are upgraded as they are read, and two servers writing the same profile are noticed rather than lost.
import { StoreConflictError } from './store.js';

/**
 * @typedef {object} ProfileSpec
 * @property {number} [version] The profile layout version (1).
 * @property {(playerId: string) => any} create The data of a brand-new player.
 * @property {Record<number, (data: any) => any>} [migrations] `{ 1: (old) => v2data }` upgrades data saved at that version by one step.
 * @property {(mine: any, theirs: any, base: any) => any} [merge] When a write finds another server changed the profile, combine the two (default: keep ours).
 */

/** A profile that is open: change `data`, then call `touch()` (or use `change`). */
export class Profile {
  constructor(manager, id, data, version, base) {
    this.manager = manager; this.id = id; this.data = data; this.version = version;
    this.base = base; // what was last stored, for merging
    this.dirty = false; this.openedAt = manager.now(); this.lastWrite = 0;
  }
  /** Say the data changed: it is written back at the next flush. */
  touch() { this.dirty = true; return this; }
  /** Change the data and mark it: `profile.change((d) => { d.coins += 5; })`. */
  change(fn) { const r = fn(this.data); if (r !== undefined) this.data = r; this.dirty = true; return this; }
}

/**
 * Player profiles: the data that outlives a match. A profile is open while its player is connected: changes are made in memory
 * and written back in the background, when the player leaves and on shutdown. Old layouts are upgraded as they are read, and a
 * write that finds another server changed the profile is merged (or the conflict is counted) rather than lost.
 */
export class Profiles {
  /**
   * @param {object} o
   * @param {import('./store.js').Store} o.store
   * @param {ProfileSpec} o.spec
   * @param {string} [o.ns] The store namespace (`"profiles"`).
   * @param {number} [o.flushMs] How often dirty profiles are written back (5000; 0 = only when you call `flush`).
   * @param {() => number} [o.now]
   * @param {(msg: string) => void} [o.log]
   */
  constructor({ store, spec, ns = 'profiles', flushMs = 5000, now = () => Date.now(), log = () => {} }) {
    this.store = store; this.ns = ns; this.version = spec.version ?? 1; this.createData = spec.create; this.migrations = spec.migrations ?? {}; this.merge = spec.merge ?? null;
    this.now = now; this.log = log;
    /** @type {Map<string, Profile>} */ this.open = new Map();
    this.opening = new Map();
    this.stats = { loads: 0, creates: 0, writes: 0, conflicts: 0, merged: 0, failures: 0 };
    this.timer = null;
    if (flushMs > 0) { this.timer = setInterval(() => { this.flush().catch((e) => this.log(`profile flush failed: ${e.message}`)); }, flushMs); this.timer.unref?.(); }
  }

  #migrate(rec) {
    let { v, data } = rec;
    if (v > this.version) throw new Error(`this profile was saved by a newer version of the game (layout ${v}, this reads up to ${this.version})`);
    for (; v < this.version; v++) {
      const step = this.migrations[v];
      if (!step) throw new Error(`no way to upgrade a profile from layout ${v} to ${v + 1}`);
      data = step(data) ?? data;
    }
    return data;
  }

  /**
   * Open a player's profile (creating it the first time). Opening twice gives the same object. Call `close` when the player leaves.
   * @param {string} playerId @returns {Promise<Profile>}
   */
  async openProfile(playerId) {
    const have = this.open.get(playerId);
    if (have) return have;
    let pending = this.opening.get(playerId);
    if (!pending) {
      pending = (async () => {
        const rec = await this.store.get(this.ns, playerId);
        let p;
        if (rec) { this.stats.loads++; const data = this.#migrate(rec.value); p = new Profile(this, playerId, data, rec.version, JSON.parse(JSON.stringify(rec.value.data))); p.dirty = rec.value.v !== this.version; }
        else {
          const data = this.createData(playerId);
          const { version } = await this.store.put(this.ns, playerId, { v: this.version, data }, { ifVersion: 0 }).catch(async (e) => { if (e instanceof StoreConflictError) return { version: -1 }; throw e; });
          if (version === -1) { this.opening.delete(playerId); return this.openProfile(playerId); } // someone created it first
          this.stats.creates++; p = new Profile(this, playerId, data, version, JSON.parse(JSON.stringify(data)));
        }
        this.open.set(playerId, p);
        return p;
      })().finally(() => this.opening.delete(playerId));
      this.opening.set(playerId, pending);
    }
    return pending;
  }

  /** A profile without keeping it open (read once; changes are not tracked). */
  async peek(playerId) {
    const open = this.open.get(playerId);
    if (open) return open.data;
    const rec = await this.store.get(this.ns, playerId);
    return rec ? this.#migrate(rec.value) : null;
  }

  async #write(p) {
    const record = (data) => ({ v: this.version, data });
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const { version } = await this.store.put(this.ns, p.id, record(p.data), { ifVersion: p.version });
        p.version = version; p.base = JSON.parse(JSON.stringify(p.data)); p.dirty = false; p.lastWrite = this.now(); this.stats.writes++;
        return true;
      } catch (e) {
        if (!(e instanceof StoreConflictError)) throw e;
        this.stats.conflicts++;
        const theirs = await this.store.get(this.ns, p.id);
        if (!theirs) { p.version = 0; continue; }
        if (this.merge) { p.data = this.merge(p.data, this.#migrate(theirs.value), p.base) ?? p.data; this.stats.merged++; }
        p.version = theirs.version; // keep ours (or the merge) on top of their version
        this.log(`profile ${p.id} was changed elsewhere: ${this.merge ? 'merged' : 'kept ours'}`);
      }
    }
    this.stats.failures++;
    throw new Error(`could not write profile ${p.id}: it keeps changing`);
  }

  /** Write the changed profiles now. @returns {Promise<number>} how many were written */
  async flush() {
    let n = 0;
    const errors = [];
    for (const p of [...this.open.values()]) if (p.dirty) { try { if (await this.#write(p)) n++; } catch (e) { errors.push(e); } }
    if (errors.length) throw errors[0];
    return n;
  }

  /** The player left: write their profile and let go of it. */
  async close(playerId) {
    const p = this.open.get(playerId);
    if (!p) return;
    if (p.dirty) await this.#write(p);
    this.open.delete(playerId);
  }

  /** Server shutdown: write everything and stop the timer. */
  async closeAll() { clearInterval(this.timer); this.timer = null; await this.flush(); this.open.clear(); }
}
