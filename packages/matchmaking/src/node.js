// The server side of matchmaking in Node: signed join tokens (so only matched players can enter a match's room) and a small HTTP service
// that players call to queue, poll their ticket and cancel. Players poll rather than keep a socket open: it works through every proxy and
// costs the server nothing between polls.
import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto';
import { Matchmaker } from './matchmaker.js';

const b64 = (buf) => Buffer.from(buf).toString('base64url');

/** Signed, expiring tokens that say "this player may join this room". Anyone can read one; no one can make or change one without the secret. */
export class JoinTokens {
  /**
   * @param {object} o
   * @param {string | Record<string, string>} o.secret A secret (at least 16 characters), or `{ keyId: secret }` for several: the first one signs, all of them verify (rotate by adding a new first key and removing the old one later).
   * @param {number} [o.ttlMs] How long a token works (30 000).
   * @param {() => number} [o.now]
   * @param {boolean} [o.oneTime] Each token works once (a stolen or replayed one is refused).
   */
  constructor({ secret, ttlMs = 30_000, now = () => Date.now(), oneTime = false }) {
    this.keys = typeof secret === 'string' ? { k1: secret } : { ...secret };
    if (!Object.keys(this.keys).length || Object.values(this.keys).some((s) => typeof s !== 'string' || s.length < 16)) throw new Error('JoinTokens needs a secret of at least 16 characters');
    this.signingKey = Object.keys(this.keys)[0];
    this.ttlMs = ttlMs; this.now = now; this.oneTime = oneTime;
    this.used = new Map(); // nonce -> expiry
  }
  #sign(kid, body) { return createHmac('sha256', this.keys[kid]).update(`v1.${kid}.${body}`).digest(); }

  /** A token for a player to enter a room. `extra` rides along (their team, for example) and is covered by the signature. */
  issue({ player, room, extra = null, ttlMs = this.ttlMs }) {
    const payload = { p: player, r: room, e: this.now() + ttlMs, n: randomBytes(8).toString('hex'), ...(extra === null ? {} : { x: extra }) };
    const body = b64(JSON.stringify(payload));
    return `v1.${this.signingKey}.${body}.${b64(this.#sign(this.signingKey, body))}`;
  }

  /**
   * Check a token. Never throws.
   * @param {string} token @param {{room?: string}} [expect] The room it must be for (leave out to accept any).
   * @returns {{ok: true, player: string, room: string, expiresAt: number, extra: any} | {ok: false, reason: 'malformed' | 'unknown-key' | 'bad-signature' | 'expired' | 'wrong-room' | 'used'}}
   */
  verify(token, { room } = {}) {
    const parts = typeof token === 'string' ? token.split('.') : [];
    if (parts.length !== 4 || parts[0] !== 'v1') return { ok: false, reason: 'malformed' };
    const [, kid, body, sig] = parts;
    if (!(kid in this.keys)) return { ok: false, reason: 'unknown-key' };
    const want = this.#sign(kid, body), got = Buffer.from(sig, 'base64url');
    if (got.length !== want.length || !timingSafeEqual(got, want)) return { ok: false, reason: 'bad-signature' };
    let p;
    try { p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch { return { ok: false, reason: 'malformed' }; }
    const now = this.now();
    if (!(p.e > now)) return { ok: false, reason: 'expired' };
    if (room !== undefined && p.r !== room) return { ok: false, reason: 'wrong-room' };
    if (this.oneTime) {
      for (const [n, e] of this.used) if (e <= now) this.used.delete(n);
      if (this.used.has(p.n)) return { ok: false, reason: 'used' };
      this.used.set(p.n, p.e);
    }
    return { ok: true, player: p.p, room: p.r, expiresAt: p.e, extra: p.x ?? null };
  }
}

/**
 * The matchmaking service: a `Matchmaker`, a timer that ticks it, and an HTTP handler.
 *
 *   POST   /queue        { mode, players?: [ids], region?, meta? }  ->  201 { ticket }
 *   GET    /ticket/<id>  ->  { status: 'waiting' | 'matched' | 'expired' | 'cancelled', ... }  (matched: { room, token, team, match })
 *   DELETE /ticket/<id>  ->  204
 *   GET    /status       ->  { modes: { duel: { tickets, players, estimatedWaitMs } } }
 *
 * `userOf(req)` says who is calling (your login check); a caller may only queue as themselves, and as a party only players `canParty` allows.
 */
export class MatchService {
  /**
   * @param {object} o
   * @param {Record<string, import('./matchmaker.js').ModeConfig>} o.modes
   * @param {JoinTokens} o.tokens
   * @param {(match: import('./matchmaker.js').Match) => Promise<{room: string, [k: string]: any}>} o.createRoom Make (or find) the room for a match; return its name and anything the client needs to connect (`url`).
   * @param {(req: any) => string | null | Promise<string | null>} o.userOf The caller's player id, or null to refuse.
   * @param {(playerId: string) => number | Promise<number>} [o.ratingOf] A player's rating (default: the matchmaker's default).
   * @param {(req: any, ids: string[]) => boolean | Promise<boolean>} [o.canParty] May this caller queue these other players with them (default: no parties)?
   * @param {number} [o.tickMs] How often the queue is turned into matches (500).
   * @param {number} [o.resultTtlMs] How long a finished ticket's outcome can still be read (120 000).
   * @param {() => number} [o.now]
   * @param {(msg: string) => void} [o.log]
   */
  constructor({ modes, tokens, createRoom, userOf, ratingOf, canParty = () => false, tickMs = 500, resultTtlMs = 120_000, now = () => Date.now(), log = () => {} }) {
    this.matchmaker = new Matchmaker({ modes, now });
    this.tokens = tokens; this.createRoom = createRoom; this.userOf = userOf; this.ratingOf = ratingOf; this.canParty = canParty;
    this.tickMs = tickMs; this.resultTtlMs = resultTtlMs; this.now = now; this.log = log;
    /** @type {Map<string, {status: string, owner: string[], at: number, [k: string]: any}>} */ this.results = new Map();
    this.timer = null; this.busy = false;
  }

  /** Start ticking. */
  start() { if (!this.timer) { this.timer = setInterval(() => { this.tick().catch((e) => this.log(`matchmaking tick failed: ${e.message}`)); }, this.tickMs); this.timer.unref?.(); } return this; }
  stop() { clearInterval(this.timer); this.timer = null; }

  /** Turn the queue into matches now (the timer calls this; tests can too). */
  async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      const { matches, expired } = this.matchmaker.tick();
      for (const t of expired) this.results.set(t.id, { status: 'expired', owner: t.players.map((p) => p.id), at: this.now() });
      await Promise.all(matches.map(async (match) => {
        let room;
        try { room = await this.createRoom(match); }
        catch (e) { this.log(`could not make a room for ${match.id}: ${e.message}`); for (const t of match.tickets) this.results.set(t.id, { status: 'failed', owner: t.players.map((p) => p.id), at: this.now(), error: 'no room was available' }); return; }
        const summary = { id: match.id, mode: match.mode, room: room.room, teams: match.teams.map((t) => t.players.map((p) => p.id)), needsFill: match.needsFill, ...room };
        for (const t of match.tickets) {
          const players = {};
          match.teams.forEach((team, ti) => { for (const p of team.players) if (p.ticket === t.id) players[p.id] = { team: ti, token: this.tokens.issue({ player: p.id, room: room.room, extra: { team: ti, match: match.id } }) }; });
          this.results.set(t.id, { status: 'matched', owner: Object.keys(players), at: this.now(), match: summary, players });
        }
      }));
      const cutoff = this.now() - this.resultTtlMs;
      for (const [id, r] of this.results) if (r.at < cutoff) this.results.delete(id);
    } finally { this.busy = false; }
  }

  /**
   * The HTTP handler. `path` is the part of the URL after where you mounted it (`/queue`, `/ticket/t1`...).
   * @returns {Promise<void>}
   */
  async handle(req, res, path) {
    const send = (code, body, headers = {}) => { res.writeHead(code, { 'cache-control': 'no-store', ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers }); res.end(body === undefined ? '' : JSON.stringify(body)); };
    try {
      const user = await this.userOf(req);
      if (!user) return send(401, { error: 'sign in first' });
      const m = /^\/ticket\/([A-Za-z0-9_-]{1,40})$/.exec(path);
      if (req.method === 'GET' && path === '/status') return send(200, { modes: this.matchmaker.stats() });
      if (req.method === 'POST' && path === '/queue') {
        const body = await readJson(req);
        if (!body || typeof body.mode !== 'string') return send(400, { error: 'say which mode: { "mode": "duel" }' });
        const ids = [...new Set([user, ...(Array.isArray(body.players) ? body.players.map(String) : [])])].slice(0, 16);
        const others = ids.filter((i) => i !== user);
        if (others.length && !(await this.canParty(req, others))) return send(403, { error: 'you cannot queue those players' });
        const players = await Promise.all(ids.map(async (id) => ({ id, rating: this.ratingOf ? await this.ratingOf(id) : undefined })));
        if (this.matchmaker.ticketOf(user)) return send(409, { error: 'you are already in the queue', ticket: this.matchmaker.ticketOf(user).id });
        let ticket;
        try { ticket = this.matchmaker.enqueue({ mode: body.mode, players, region: typeof body.region === 'string' ? body.region : 'any', meta: body.meta ?? null }); }
        catch (e) { return send(400, { error: e.message }); }
        return send(201, { ticket: ticket.id });
      }
      if (m && req.method === 'GET') {
        const id = m[1], waiting = this.matchmaker.get(id), done = this.results.get(id);
        const owner = waiting ? waiting.players.map((p) => p.id) : done?.owner;
        if (!owner || !owner.includes(user)) return send(404, { error: 'no such ticket' });
        if (waiting) return send(200, { status: 'waiting', waitedMs: this.now() - waiting.enqueuedAt, estimatedWaitMs: this.matchmaker.stats()[waiting.mode].estimatedWaitMs });
        if (done.status === 'matched') return send(200, { status: 'matched', room: done.match.room, url: done.match.url ?? null, token: done.players[user].token, team: done.players[user].team, match: done.match });
        return send(200, { status: done.status, ...(done.error ? { error: done.error } : {}) });
      }
      if (m && req.method === 'DELETE') {
        const t = this.matchmaker.get(m[1]);
        if (t && t.players.some((p) => p.id === user)) { this.matchmaker.cancel(t.id); this.results.set(t.id, { status: 'cancelled', owner: t.players.map((p) => p.id), at: this.now() }); }
        return send(204);
      }
      return send(404, { error: 'not found' });
    } catch (e) { return send(500, { error: e.message }); }
  }
}

async function readJson(req, limit = 4096) {
  const chunks = []; let size = 0;
  for await (const c of req) { size += c.length; if (size > limit) return null; chunks.push(c); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return null; }
}
