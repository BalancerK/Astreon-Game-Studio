// The directory of rooms: which rooms exist, what mode they play, how many seats are free, short codes for sharing a room with friends,
// and seat reservations (a matched player has a few seconds to connect; until then the seat is theirs and nobody else can take it).
// Pure bookkeeping, like the matchmaker: you give it the clock and tell it what happens.

/**
 * @typedef {object} RoomInfo
 * @property {string} id
 * @property {string} mode
 * @property {number} capacity Seats in the room.
 * @property {number} players Players in it now.
 * @property {string} region A region name or `"any"`.
 * @property {boolean} joinable False while the room is starting, ending or locked.
 * @property {boolean} isPrivate Private rooms are not listed or offered by `findOpen`; only a code finds them.
 * @property {number} rating Average rating of the players in it (for matching new players to it).
 * @property {any} meta Whatever the game attached (a map name, a server address).
 */

// no 0 / O / 1 / I / L: codes are read aloud and typed on phones
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/**
 * The directory of rooms: what exists, what mode each plays, how many seats are free, short join codes for sharing a room, and
 * seat reservations (a matched player has a few seconds to connect; until then the seat is theirs). Pure bookkeeping: you tell
 * it what happens and give it the clock.
 */
export class Lobby {
  /**
   * @param {object} [o]
   * @param {() => number} [o.now] Milliseconds.
   * @param {number} [o.reservationMs] How long a reserved seat is held (15 000).
   * @param {number} [o.codeLength] Characters in a join code (5: about 28 million codes).
   * @param {() => number} [o.random] A 0..1 generator, for codes (default `Math.random`).
   */
  constructor({ now = () => Date.now(), reservationMs = 15_000, codeLength = 5, random = Math.random } = {}) {
    this.now = now; this.reservationMs = reservationMs; this.codeLength = codeLength; this.random = random;
    /** @type {Map<string, RoomInfo>} */ this.rooms = new Map();
    /** @type {Map<string, Map<string, number>>} room id -> player id -> reservation expiry */ this.reserved = new Map();
    /** @type {Map<string, string>} */ this.codes = new Map();
  }

  /** Add a room, or replace what is known about it. */
  register(info) {
    if (!info?.id) throw new Error('a room needs an id');
    const room = { mode: 'default', capacity: 8, players: 0, region: 'any', joinable: true, isPrivate: false, rating: 0, meta: null, ...this.rooms.get(info.id), ...info };
    this.rooms.set(room.id, room);
    if (!this.reserved.has(room.id)) this.reserved.set(room.id, new Map());
    return room;
  }
  /** Change some fields (the player count, whether it is joinable). Unknown rooms are ignored. */
  update(id, patch) { const r = this.rooms.get(id); if (!r) return null; Object.assign(r, patch); return r; }
  /** Forget a room, its reservations and its codes. */
  remove(id) {
    this.rooms.delete(id); this.reserved.delete(id);
    for (const [code, room] of this.codes) if (room === id) this.codes.delete(code);
  }
  get(id) { return this.rooms.get(id) ?? null; }

  #sweep(id) {
    const map = this.reserved.get(id), now = this.now();
    if (map) for (const [p, until] of map) if (until <= now) map.delete(p);
  }
  /** Seats nobody has and nobody is holding. */
  freeSeats(id) {
    const r = this.rooms.get(id);
    if (!r) return 0;
    this.#sweep(id);
    return Math.max(0, r.capacity - r.players - (this.reserved.get(id)?.size ?? 0));
  }

  /**
   * Hold seats for players who are about to connect.
   * @param {string} id @param {string[]} playerIds
   * @returns {{ok: true, expiresAt: number} | {ok: false, reason: 'unknown' | 'closed' | 'full'}}
   */
  reserve(id, playerIds) {
    const r = this.rooms.get(id);
    if (!r) return { ok: false, reason: 'unknown' };
    if (!r.joinable) return { ok: false, reason: 'closed' };
    this.#sweep(id);
    const map = this.reserved.get(id);
    const fresh = playerIds.filter((p) => !map.has(p));
    if (fresh.length > this.freeSeats(id)) return { ok: false, reason: 'full' };
    const expiresAt = this.now() + this.reservationMs;
    for (const p of playerIds) map.set(p, expiresAt);
    return { ok: true, expiresAt };
  }
  /** A player connected: their reservation becomes a seat (count them with `update(id, { players })` as you see fit). @returns {boolean} true if they had one */
  confirm(id, playerId) { return this.reserved.get(id)?.delete(playerId) ?? false; }
  /** Give a held seat back. */
  release(id, playerId) { return this.reserved.get(id)?.delete(playerId) ?? false; }
  hasReservation(id, playerId) { this.#sweep(id); return this.reserved.get(id)?.has(playerId) ?? false; }

  /** A short code for sharing the room ("K7M2Q"). Codes are unique; asking again returns the same one. */
  createCode(id) {
    if (!this.rooms.has(id)) throw new Error(`there is no room "${id}"`);
    for (const [c, room] of this.codes) if (room === id) return c;
    for (let tries = 0; tries < 200; tries++) {
      let code = '';
      for (let i = 0; i < this.codeLength; i++) code += CODE_ALPHABET[Math.floor(this.random() * CODE_ALPHABET.length)];
      if (!this.codes.has(code)) { this.codes.set(code, id); return code; }
    }
    throw new Error('could not find a free join code');
  }
  /** The room a code belongs to (any case, spaces and dashes ignored), or null. */
  resolveCode(code) { return this.codes.get(String(code).toUpperCase().replace(/[\s-]/g, '')) ?? null; }

  /**
   * Public rooms that can be listed, filtered and sorted.
   * @param {{mode?: string, region?: string, joinable?: boolean, minFree?: number}} [f]
   * @returns {Array<RoomInfo & {free: number}>} fullest first (so games fill up rather than spreading thin)
   */
  list({ mode, region, joinable = true, minFree = 0 } = {}) {
    const out = [];
    for (const r of this.rooms.values()) {
      if (r.isPrivate || (mode && r.mode !== mode) || (joinable && !r.joinable)) continue;
      if (region && region !== 'any' && r.region !== 'any' && r.region !== region) continue;
      const free = this.freeSeats(r.id);
      if (free >= minFree) out.push({ ...r, free });
    }
    return out.sort((a, b) => a.free - b.free || (a.id < b.id ? -1 : 1));
  }

  /**
   * The room a quick-play player should go to: public, joinable, with room for the whole party, and a rating close to theirs;
   * among those, the fullest. Null means make a new room.
   * @param {{mode: string, size?: number, region?: string, rating?: number, ratingWindow?: number}} q
   */
  findOpen({ mode, size = 1, region = 'any', rating, ratingWindow = Infinity }) {
    const candidates = this.list({ mode, region, minFree: Math.max(1, size) }).filter((r) => rating === undefined || r.players === 0 || Math.abs(r.rating - rating) <= ratingWindow);
    return candidates[0] ?? null;
  }
}
