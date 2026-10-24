// The matchmaker: players (alone or in parties) join a queue for a mode; every `tick()` it turns the queue into matches. It waits for fair
// matches first (similar ratings, even teams) and loosens the rules the longer someone has waited, until a partly filled match is allowed
// and finally the ticket expires. No timers, network or randomness inside: you give it the clock and call `tick()` when you like.

/**
 * @typedef {object} ModeConfig
 * @property {number} [teams] Teams in a match (2).
 * @property {number} [teamSize] Players per team (1).
 * @property {number} [minPlayers] The fewest players a match may start with once `relaxAfterMs` has passed (default: a full match only).
 * @property {number} [relaxAfterMs] After this long the oldest ticket may be matched into a partly filled match (default: never).
 * @property {number} [maxWaitMs] After this long a ticket gives up and is returned as expired (default 120 000).
 * @property {number} [initialWindow] Rating difference allowed at first (100).
 * @property {number} [widenPerSecond] How much that grows each second of waiting (25).
 * @property {number} [maxWindow] The widest it gets (800).
 *
 * @typedef {object} Ticket
 * @property {string} id
 * @property {string} mode
 * @property {Array<{id: string, rating: number}>} players One for a solo player, more for a party (kept on one team).
 * @property {number} rating The party's average rating.
 * @property {string} region A region name, or `"any"`.
 * @property {number} enqueuedAt
 * @property {any} meta Whatever the game attached.
 *
 * @typedef {object} Match
 * @property {string} id
 * @property {string} mode
 * @property {Array<{players: Array<{id: string, rating: number, ticket: string}>, rating: number}>} teams
 * @property {Ticket[]} tickets
 * @property {number} ratingSpread Highest minus lowest ticket rating.
 * @property {number} teamBalance How far apart the best and worst teams' average ratings are.
 * @property {number} waitedMs How long the oldest ticket waited.
 * @property {number} needsFill Slots left empty: fill them with bots or let others join.
 * @property {string} region
 */

const DEFAULT_MODE = { teams: 2, teamSize: 1, relaxAfterMs: Infinity, maxWaitMs: 120_000, initialWindow: 100, widenPerSecond: 25, maxWindow: 800 };

/**
 * Split tickets into teams of at most `teamSize`, parties kept together, with the teams' average ratings as close as possible.
 * @param {Array<{size: number, rating: number}>} items
 * @returns {number[][] | null} for each team the indexes into `items`, or null if the parties cannot be placed.
 */
export function partition(items, teams, teamSize) {
  const order = items.map((_, i) => i).sort((a, b) => items[b].size - items[a].size || items[b].rating - items[a].rating || a - b);
  let best = null, bestScore = Infinity, visited = 0;
  const load = Array.from({ length: teams }, () => ({ size: 0, sum: 0, ids: [] }));
  const walk = (k) => {
    if (visited++ > 20_000) return;
    if (k === order.length) {
      const avgs = load.filter((t) => t.size).map((t) => t.sum / t.size);
      const score = Math.max(...avgs) - Math.min(...avgs);
      if (score < bestScore) { bestScore = score; best = load.map((t) => [...t.ids]); }
      return;
    }
    const it = items[order[k]];
    const tried = new Set();
    for (const t of load) {
      if (t.size + it.size > teamSize) continue;
      const key = `${t.size}:${t.sum}`; // teams in the same state are interchangeable: try one
      if (tried.has(key)) continue; tried.add(key);
      t.size += it.size; t.sum += it.rating * it.size; t.ids.push(order[k]);
      walk(k + 1);
      t.size -= it.size; t.sum -= it.rating * it.size; t.ids.pop();
      if (bestScore === 0) return;
    }
  };
  walk(0);
  return best;
}

/**
 * The matchmaking queue. Players (alone or in parties) `enqueue` for a mode; `tick()` turns the queue into matches: similar
 * ratings and even teams first, looser rules the longer someone has waited, a partly filled match after `relaxAfterMs`, and
 * tickets that waited too long come back as expired. No timers, network or randomness inside: you pass the clock and call
 * `tick()`.
 */
export class Matchmaker {
  /**
   * @param {object} o
   * @param {Record<string, ModeConfig>} o.modes The game modes players can queue for.
   * @param {() => number} [o.now] Milliseconds; give it your own clock in tests and replays.
   * @param {number} [o.defaultRating] Rating of a player who has none (1000).
   */
  constructor({ modes, now = () => Date.now(), defaultRating = 1000 }) {
    if (!modes || !Object.keys(modes).length) throw new Error('a Matchmaker needs at least one mode');
    /** @type {Map<string, Required<ModeConfig>>} */ this.modes = new Map(Object.entries(modes).map(([name, m]) => [name, { ...DEFAULT_MODE, ...m }]));
    this.now = now; this.defaultRating = defaultRating;
    /** @type {Map<string, Ticket>} */ this.tickets = new Map();
    this.nextTicket = 1; this.nextMatch = 1;
    this.waits = new Map(); // mode -> smoothed wait of recent matches, ms
    this.playerTicket = new Map(); // player id -> ticket id
  }

  /**
   * Join the queue. A party is one ticket with several players.
   * @param {{mode: string, players: Array<string | {id: string, rating?: number}>, region?: string, meta?: any, id?: string}} o
   * @returns {Ticket}
   */
  enqueue({ mode, players, region = 'any', meta = null, id }) {
    const cfg = this.modes.get(mode);
    if (!cfg) throw new Error(`there is no mode "${mode}" (modes: ${[...this.modes.keys()].join(', ')})`);
    if (!Array.isArray(players) || !players.length) throw new Error('a ticket needs at least one player');
    const ps = players.map((p) => (typeof p === 'string' ? { id: p, rating: this.defaultRating } : { id: p.id, rating: p.rating ?? this.defaultRating }));
    if (ps.length > cfg.teamSize) throw new Error(`a party of ${ps.length} does not fit a team of ${cfg.teamSize} in "${mode}"`);
    if (new Set(ps.map((p) => p.id)).size !== ps.length) throw new Error('a player is in the party twice');
    for (const p of ps) if (this.playerTicket.has(p.id)) throw new Error(`player "${p.id}" is already in the queue`);
    const ticket = { id: id ?? `t${this.nextTicket++}`, mode, players: ps, rating: ps.reduce((a, p) => a + p.rating, 0) / ps.length, region, enqueuedAt: this.now(), meta };
    if (this.tickets.has(ticket.id)) throw new Error(`ticket "${ticket.id}" exists`);
    this.tickets.set(ticket.id, ticket);
    for (const p of ps) this.playerTicket.set(p.id, ticket.id);
    return ticket;
  }

  /** Leave the queue. @returns {boolean} false if there was no such ticket (already matched, expired or cancelled) */
  cancel(ticketId) {
    const t = this.tickets.get(ticketId);
    if (!t) return false;
    this.#remove(t);
    return true;
  }
  #remove(t) { this.tickets.delete(t.id); for (const p of t.players) if (this.playerTicket.get(p.id) === t.id) this.playerTicket.delete(p.id); }

  /** The ticket a player is waiting with, or null. */
  ticketOf(playerId) { return this.tickets.get(this.playerTicket.get(playerId)) ?? null; }
  get(ticketId) { return this.tickets.get(ticketId) ?? null; }
  /** How many tickets and players wait, per mode. */
  stats() {
    const out = {};
    for (const mode of this.modes.keys()) out[mode] = { tickets: 0, players: 0, estimatedWaitMs: this.waits.get(mode) ?? null };
    for (const t of this.tickets.values()) { out[t.mode].tickets++; out[t.mode].players += t.players.length; }
    return out;
  }

  /** The rating difference a ticket accepts now: it grows with the waiting. */
  window(ticket, now = this.now()) {
    const c = this.modes.get(ticket.mode);
    return Math.min(c.maxWindow, c.initialWindow + (c.widenPerSecond * Math.max(0, now - ticket.enqueuedAt)) / 1000);
  }

  /**
   * Make the matches that can be made, and give up on tickets that waited too long.
   * @returns {{matches: Match[], expired: Ticket[]}}
   */
  tick() {
    const now = this.now(), matches = [], expired = [];
    for (const [mode, cfg] of this.modes) {
      const queue = [...this.tickets.values()].filter((t) => t.mode === mode).sort((a, b) => a.enqueuedAt - b.enqueuedAt || (a.id < b.id ? -1 : 1));
      const need = cfg.teams * cfg.teamSize, used = new Set();
      for (const anchor of queue) {
        if (used.has(anchor.id)) continue;
        if (now - anchor.enqueuedAt >= cfg.maxWaitMs) { expired.push(anchor); used.add(anchor.id); continue; }
        const chosen = this.#assemble(anchor, queue.filter((t) => !used.has(t.id) && t !== anchor), cfg, need, now);
        if (!chosen) continue;
        const match = this.#build(mode, cfg, chosen, need, now);
        for (const t of chosen) used.add(t.id);
        matches.push(match);
      }
    }
    for (const m of matches) for (const t of m.tickets) this.#remove(t);
    for (const t of expired) this.#remove(t);
    for (const m of matches) { const prev = this.waits.get(m.mode); this.waits.set(m.mode, prev === undefined ? m.waitedMs : Math.round(prev * 0.8 + m.waitedMs * 0.2)); }
    return { matches, expired };
  }

  #compatible(a, b, now) {
    if (a.region !== 'any' && b.region !== 'any' && a.region !== b.region) return false;
    return Math.abs(a.rating - b.rating) <= Math.min(this.window(a, now), this.window(b, now));
  }

  /** The tickets for a match around `anchor`, or null. */
  #assemble(anchor, others, cfg, need, now) {
    const pool = others.filter((t) => this.#compatible(anchor, t, now)).sort((a, b) => Math.abs(a.rating - anchor.rating) - Math.abs(b.rating - anchor.rating) || a.enqueuedAt - b.enqueuedAt);
    // a full match: tickets whose sizes add up to exactly `need` and that can be split into teams
    const want = need - anchor.players.length;
    let found = null, visited = 0;
    const pick = (start, left, picked) => {
      if (found || visited++ > 4000) return;
      if (left === 0) { if (partition([anchor, ...picked].map((t) => ({ size: t.players.length, rating: t.rating })), cfg.teams, cfg.teamSize)) found = [anchor, ...picked]; return; }
      for (let i = start; i < pool.length; i++) {
        const t = pool[i];
        if (t.players.length > left) continue;
        pick(i + 1, left - t.players.length, [...picked, t]);
        if (found) return;
      }
    };
    pick(0, want, []);
    if (found) return found;
    // after long enough, a partly filled match
    if (now - anchor.enqueuedAt >= cfg.relaxAfterMs) {
      const min = cfg.minPlayers ?? need;
      const group = [anchor]; let size = anchor.players.length;
      for (const t of pool) { if (size + t.players.length <= need) { group.push(t); size += t.players.length; } }
      if (size >= min && partition(group.map((t) => ({ size: t.players.length, rating: t.rating })), cfg.teams, cfg.teamSize)) return group;
    }
    return null;
  }

  #build(mode, cfg, tickets, need, now) {
    const split = partition(tickets.map((t) => ({ size: t.players.length, rating: t.rating })), cfg.teams, cfg.teamSize);
    const teams = split.map((idx) => {
      const players = idx.flatMap((i) => tickets[i].players.map((p) => ({ id: p.id, rating: p.rating, ticket: tickets[i].id })));
      return { players, rating: players.length ? players.reduce((a, p) => a + p.rating, 0) / players.length : 0 };
    });
    const ratings = tickets.map((t) => t.rating), filled = teams.filter((t) => t.players.length).map((t) => t.rating);
    const regions = new Set(tickets.map((t) => t.region).filter((r) => r !== 'any'));
    return {
      id: `m${this.nextMatch++}`, mode, teams, tickets,
      ratingSpread: Math.max(...ratings) - Math.min(...ratings), teamBalance: filled.length ? Math.max(...filled) - Math.min(...filled) : 0,
      waitedMs: Math.max(...tickets.map((t) => now - t.enqueuedAt)), needsFill: need - tickets.reduce((a, t) => a + t.players.length, 0), region: regions.size === 1 ? [...regions][0] : 'any',
    };
  }
}
