// A leaderboard: who has the best score, what rank a player has, and who is just above and below them. Kept sorted in memory (ranks are
// instant), and saved to a store as one record so it survives a restart. A player appears once; ties go to whoever got the score first.

/**
 * A leaderboard: ranks, the best scores, and the players just above and below one player. Kept sorted in memory (ranks are
 * instant) and saved to a store as one record. A player appears once; ties go to whoever got the score first.
 */
export class Leaderboard {
  /**
   * @param {object} [o]
   * @param {'desc' | 'asc'} [o.order] `desc`: higher is better (points); `asc`: lower is better (race times).
   * @param {number} [o.maxEntries] Keep only the best this many (default: all).
   * @param {() => number} [o.now]
   */
  constructor({ order = 'desc', maxEntries = Infinity, now = () => Date.now() } = {}) {
    this.order = order; this.maxEntries = maxEntries; this.now = now;
    /** @type {Array<{id: string, score: number, at: number, meta?: any}>} best first */ this.entries = [];
    /** @type {Map<string, {id: string, score: number, at: number}>} */ this.byId = new Map();
  }
  /** Is `a` better than `b`? (A tie: the earlier one is.) */
  #before(a, b) { return a.score === b.score ? a.at < b.at || (a.at === b.at && a.id < b.id) : this.order === 'desc' ? a.score > b.score : a.score < b.score; }
  #indexFor(e) { // first position whose entry is NOT better than e
    let lo = 0, hi = this.entries.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (this.#before(this.entries[mid], e)) lo = mid + 1; else hi = mid; }
    return lo;
  }
  #positionOf(e) { const i = this.#indexFor(e); return this.entries[i] === e ? i : this.entries.indexOf(e); }

  /**
   * Record a score.
   * @param {string} id @param {number} score
   * @param {{mode?: 'best' | 'replace' | 'add', meta?: any}} [o] `best` keeps the player's better score (default); `replace` always takes the new one; `add` adds to the total.
   * @returns {{rank: number, score: number, improved: boolean}} the player's rank (1 is first) and score after this
   */
  submit(id, score, { mode = 'best', meta } = {}) {
    if (!Number.isFinite(score)) throw new Error(`score for ${id} must be a number (got ${score})`);
    const old = this.byId.get(id);
    let next = score;
    if (old) {
      if (mode === 'add') next = old.score + score;
      else if (mode === 'best' && !(this.order === 'desc' ? score > old.score : score < old.score)) return { rank: this.rank(id), score: old.score, improved: false };
      if (next === old.score && mode !== 'add') return { rank: this.rank(id), score: old.score, improved: false };
      this.entries.splice(this.#positionOf(old), 1);
    }
    const e = { id, score: next, at: this.now(), ...(meta !== undefined ? { meta } : {}) };
    this.entries.splice(this.#indexFor(e), 0, e); this.byId.set(id, e);
    if (this.entries.length > this.maxEntries) { const dropped = this.entries.pop(); this.byId.delete(dropped.id); }
    return { rank: this.byId.has(id) ? this.rank(id) : 0, score: next, improved: true };
  }
  remove(id) { const e = this.byId.get(id); if (!e) return false; this.entries.splice(this.#positionOf(e), 1); this.byId.delete(id); return true; }
  /** A player's rank, 1 being the best, or 0 if they have no score. */
  rank(id) { const e = this.byId.get(id); return e ? this.#positionOf(e) + 1 : 0; }
  score(id) { return this.byId.get(id)?.score ?? null; }
  get size() { return this.entries.length; }
  /** The best `count` entries from position `offset` (0 is the best), each with its `rank`. */
  top(count = 10, offset = 0) { return this.entries.slice(offset, offset + count).map((e, i) => ({ rank: offset + i + 1, ...e })); }
  /** A player and the `radius` entries above and below them (for "you are here"), or `[]` if they have no score. */
  around(id, radius = 3) {
    const e = this.byId.get(id);
    if (!e) return [];
    const i = this.#positionOf(e), from = Math.max(0, i - radius);
    return this.entries.slice(from, i + radius + 1).map((x, k) => ({ rank: from + k + 1, ...x }));
  }
  /** Start a new season: empty the board and return what it held (to archive). */
  reset() { const old = this.entries; this.entries = []; this.byId.clear(); return old; }

  toJSON() { return { order: this.order, entries: this.entries }; }
  /** @param {{order?: string, entries: any[]}} data @param {ConstructorParameters<typeof Leaderboard>[0]} [o] */
  static from(data, o = {}) {
    const lb = new Leaderboard({ order: data.order, ...o });
    lb.entries = data.entries.map((e) => ({ ...e })).sort((a, b) => (lb.#before(a, b) ? -1 : lb.#before(b, a) ? 1 : 0));
    for (const e of lb.entries) lb.byId.set(e.id, e);
    return lb;
  }
  /** Save to a store as one record. @param {import('./store.js').Store} store */
  async save(store, ns, key) { return store.put(ns, key, this.toJSON()); }
  /** Load a board saved with `save` (an empty one if there is none). */
  static async load(store, ns, key, o = {}) { const rec = await store.get(ns, key); return rec ? Leaderboard.from(rec.value, o) : new Leaderboard(o); }
}
