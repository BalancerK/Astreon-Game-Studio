// Keeping saves in step between a device and a server (or between two devices through one). The two sides are ordinary storages (see storage.js): the device's own, and a remote one such
// as `HttpStorage`. Which side is ahead is worked out from a small record of what the two sides held the last time they agreed, so a change on both sides is noticed instead of overwritten.
import { decode, encode, checksum, SaveError } from './format.js';

/**
 * What `CloudSync` did, or found, for one slot.
 * - `same`: both sides hold the same save. `uploaded` / `downloaded`: the older side (or the side without the slot) was brought up to date. `deleted`: the slot was deleted on one side and, with `deletions`, now on the other (`from` says where it was deleted).
 * - `conflict`: both sides changed since they last agreed and nothing was written (with `strategy: 'ask'`, or a merge that declined): `local` and `remote` describe both.
 * - `resolved`: it was a conflict, and the strategy chose (`chose` says which side, or `merged`).
 * - `failed`: a side could not be reached or a file was unreadable (`error`).
 * @typedef {{slot: string, action: 'same' | 'uploaded' | 'downloaded' | 'deleted' | 'conflict' | 'resolved' | 'failed', from?: 'local' | 'remote', chose?: 'local' | 'remote' | 'merged', local?: SlotInfo, remote?: SlotInfo, error?: string}} SyncResult
 * @typedef {{savedAt: number, playtime: number, title: string | null, sum: string, bytes: number}} SlotInfo
 */

const header = (file, bytes) => ({ slot: undefined, title: file.meta?.title ?? null, level: file.meta?.level ?? null, thumbnail: file.meta?.thumbnail ?? null, savedAt: file.savedAt, playtime: file.playtime, gameVersion: file.gameVersion, bytes });

/**
 * Cloud saves: `sync()` brings the slots on the device and on the server into step, in both directions, without ever losing a save. Both sides are `{get, set, delete, keys}` storages, so the server can
 * be `HttpStorage` (with `createSaveHandler` on your own server, or anything that speaks the same few requests), a folder, or another device's storage in a test.
 *
 * For each slot, it compares the two files with a record, kept on the device, of the file both sides held when they last agreed:
 * only the device changed: upload; only the server changed: download; the same on both: nothing; **both changed** (played offline on two devices): a conflict, settled by `strategy`.
 * Before a file is replaced on either side the old one is kept as `.bak`, as `SaveGame` does, so even a wrong choice can be undone by hand.
 */
export class CloudSync {
  /**
   * @param {object} o
   * @param {{get: Function, set: Function, delete: Function, keys: Function}} o.local The device's storage (the one the `SaveGame` uses).
   * @param {{get: Function, set: Function, delete: Function, keys: Function}} o.remote The server's.
   * @param {'newest' | 'local' | 'remote' | 'ask' | ((local: any, remote: any, info: {slot: string}) => 'local' | 'remote' | any | Promise<any>)} [o.strategy] What to do when both sides changed:
   *   `'newest'` (the default) keeps the save with the later `savedAt` (ties go to the one with more play time), `'local'` / `'remote'` always keep that side, `'ask'` writes nothing and reports the conflict
   *   for the player to settle (`resolve(slot, 'local' | 'remote')`), or a function that gets both decoded save files and returns `'local'`, `'remote'`, or a **merged save file object** (written to both sides).
   * @param {string} [o.prefix] Only slots whose key starts with this (default `slot.`: every `SaveGame` slot).
   * @param {string} [o.ledgerPrefix] Where the record of the last agreement is kept on the device (`sync.`).
   * @param {boolean} [o.deletions] Whether a slot deleted on one side is deleted on the other (false: a missing slot is brought back from the side that has it).
   */
  constructor({ local, remote, strategy = 'newest', prefix = 'slot.', ledgerPrefix = 'sync.', deletions = false }) {
    if (!local || !remote) throw new Error('CloudSync needs a local and a remote storage');
    this.local = local; this.remote = remote; this.strategy = strategy; this.prefix = prefix; this.ledgerPrefix = ledgerPrefix; this.deletions = deletions;
    /** Called with each `SyncResult` as `sync` goes along. */
    this.onResult = null;
  }

  async #read(storage, key) {
    const text = await storage.get(key);
    if (text === null || text === undefined) return null;
    try { const file = await decode(text); return { text, file, info: { savedAt: file.savedAt, playtime: file.playtime ?? 0, title: file.meta?.title ?? null, sum: checksum(text), bytes: text.length } }; }
    catch (e) { return { text, file: null, error: e.message, info: { savedAt: 0, playtime: 0, title: null, sum: checksum(text), bytes: text.length } }; }
  }
  async #ledger(key) { try { const t = await this.local.get(`${this.ledgerPrefix}${key}`); return t ? JSON.parse(t).sum : null; } catch { return null; } }
  async #agree(key, sum) { await this.local.set(`${this.ledgerPrefix}${key}`, JSON.stringify({ sum, at: Date.now() })); }

  async #put(storage, key, text, file) {
    const old = await storage.get(key);
    if (old !== null && old !== undefined && old !== text) await storage.set(`${key}.bak`, old);
    await storage.set(key, text);
    await storage.set(`${key}.meta`, JSON.stringify(header(file, text.length)));
  }

  /** Slot names on both sides (without `.bak` and `.meta`). */
  async slots() {
    const names = new Set();
    for (const side of [this.local, this.remote]) for (const k of await side.keys(this.prefix)) if (!k.endsWith('.bak') && !k.endsWith('.meta')) names.add(k.slice(this.prefix.length));
    return [...names].sort();
  }

  /**
   * Bring one slot into step.
   * @param {string} slot (without the `slot.` prefix) @returns {Promise<SyncResult>}
   */
  async syncSlot(slot) {
    const key = `${this.prefix}${slot}`;
    try {
      const [l, r] = [await this.#read(this.local, key), await this.#read(this.remote, key)];
      const base = await this.#ledger(key);
      const result = await this.#decide(slot, key, l, r, base);
      this.onResult?.(result);
      return result;
    } catch (e) {
      const result = { slot, action: 'failed', error: e.message };
      this.onResult?.(result);
      return result;
    }
  }

  async #decide(slot, key, l, r, base) {
    if (!l && !r) return { slot, action: 'same' };
    if (l?.file === null) throw new SaveError('corrupt', `the local save "${slot}" is damaged (${l.error}); it is not uploaded`);
    if (r?.file === null) throw new SaveError('corrupt', `the save "${slot}" on the server is damaged (${r.error}); it is not downloaded`);
    if (l && !r) {
      if (this.deletions && base === l.info.sum) { await this.#drop(this.local, key); await this.local.delete(`${this.ledgerPrefix}${key}`); return { slot, action: 'deleted', from: 'remote', local: l.info }; }
      await this.#put(this.remote, key, l.text, l.file); await this.#agree(key, l.info.sum); return { slot, action: 'uploaded', local: l.info };
    }
    if (!l && r) {
      if (this.deletions && base === r.info.sum) { await this.#drop(this.remote, key); await this.local.delete(`${this.ledgerPrefix}${key}`); return { slot, action: 'deleted', from: 'local', remote: r.info }; }
      await this.#put(this.local, key, r.text, r.file); await this.#agree(key, r.info.sum); return { slot, action: 'downloaded', remote: r.info };
    }
    if (l.info.sum === r.info.sum) { await this.#agree(key, l.info.sum); return { slot, action: 'same', local: l.info, remote: r.info }; }
    if (base === r.info.sum) { await this.#put(this.remote, key, l.text, l.file); await this.#agree(key, l.info.sum); return { slot, action: 'uploaded', local: l.info, remote: r.info }; }
    if (base === l.info.sum) { await this.#put(this.local, key, r.text, r.file); await this.#agree(key, r.info.sum); return { slot, action: 'downloaded', local: l.info, remote: r.info }; }
    return this.#conflict(slot, key, l, r);
  }

  async #drop(storage, key) { for (const k of [key, `${key}.meta`]) await storage.delete(k); }

  async #conflict(slot, key, l, r) {
    const info = { local: l.info, remote: r.info };
    let choice;
    const s = this.strategy;
    if (s === 'ask') return { slot, action: 'conflict', ...info };
    if (s === 'local' || s === 'remote') choice = s;
    else if (s === 'newest') choice = l.info.savedAt > r.info.savedAt ? 'local' : r.info.savedAt > l.info.savedAt ? 'remote' : (l.info.playtime >= r.info.playtime ? 'local' : 'remote');
    else if (typeof s === 'function') { choice = await s(l.file, r.file, { slot }); if (choice === undefined || choice === null) return { slot, action: 'conflict', ...info }; }
    else throw new Error(`unknown sync strategy "${s}"`);
    return this.#apply(slot, key, l, r, choice, info);
  }

  async #apply(slot, key, l, r, choice, info) {
    if (choice === 'local') { await this.#put(this.remote, key, l.text, l.file); await this.#agree(key, l.info.sum); return { slot, action: 'resolved', chose: 'local', ...info }; }
    if (choice === 'remote') { await this.#put(this.local, key, r.text, r.file); await this.#agree(key, r.info.sum); return { slot, action: 'resolved', chose: 'remote', ...info }; }
    if (typeof choice === 'object' && choice.format) {                                  // a merged save file: sealed and written to both
      const text = await encode(choice);
      await this.#put(this.local, key, text, choice); await this.#put(this.remote, key, text, choice); await this.#agree(key, checksum(text));
      return { slot, action: 'resolved', chose: 'merged', ...info };
    }
    throw new Error('a sync strategy must return "local", "remote" or a save file');
  }

  /** Settle a slot that `sync` reported as a conflict (with `strategy: 'ask'`): keep the device's save, the server's, or a merged save file. @returns {Promise<SyncResult>} */
  async resolve(slot, choice) {
    const key = `${this.prefix}${slot}`;
    const [l, r] = [await this.#read(this.local, key), await this.#read(this.remote, key)];
    if (!l || !r) throw new Error(`there is nothing to resolve for "${slot}": it is on only one side`);
    return this.#apply(slot, key, l, r, choice, { local: l.info, remote: r.info });
  }

  /**
   * Bring every slot into step (one after another, so a slow server is not flooded). Never throws for one bad slot: its result says `failed`.
   * @returns {Promise<{results: SyncResult[], uploaded: number, downloaded: number, deleted: number, conflicts: number, failed: number, same: number}>}
   */
  async sync() {
    const results = [];
    let names;
    try { names = await this.slots(); } catch (e) { return { results: [{ slot: '*', action: 'failed', error: `could not list the saves (${e.message})` }], uploaded: 0, downloaded: 0, deleted: 0, conflicts: 0, failed: 1, same: 0 }; }
    for (const slot of names) results.push(await this.syncSlot(slot));
    const count = (a) => results.filter((r) => r.action === a).length;
    return { results, uploaded: count('uploaded'), downloaded: count('downloaded'), deleted: count('deleted'), conflicts: count('conflict'), failed: count('failed'), same: count('same') };
  }
}
