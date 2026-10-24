// A turn-based game as a room: `turnRoom(game)` gives the `createRoom(options)` that the server's `RoomManager` loads, in a worker thread or a
// process of its own. The room checks join tokens, seats the players, starts the match, applies their moves with the game's own rules, sends
// each player only what they may see, plays for bots and for players who are away, and offers a rematch at the end.
import { randomInt } from 'node:crypto';
import { CHANNEL } from '../../transport/src/index.js';
import { JoinTokens } from '../../matchmaking/src/node.js';
import { Match, botMove } from './game.js';
import { Rng } from './rng.js';
import { encode, parseClientMessage } from './protocol.js';

const SAFE_ID = /^[A-Za-z0-9_-]{1,40}$/;
const cleanName = (s, fallback) => { const t = typeof s === 'string' ? s.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 24) : ''; return t || fallback; };

/**
 * @typedef {object} TurnRoomOptions Everything here must be plain JSON (it crosses to the room's thread or process).
 * @property {string} [roomName] Filled in by `RoomManager`: the name tokens must be for.
 * @property {string} [secret] The secret join tokens are signed with (see `JoinTokens`). Required unless `open` is set.
 * @property {boolean} [open] Development only: the token is simply the player's id, nothing is checked.
 * @property {Array<{id: string, name?: string}>} [expect] The players this room is for (from matchmaking): only they may join, and the game starts as soon as they are all here.
 * @property {number} [seats] Seats in the match; seats nobody takes are given to computer players (default: the game's minimum, or the number expected).
 * @property {number} [startWaitMs] Without `expect`: start this long after the first player arrived, with computer players in the empty seats (10 000).
 * @property {boolean} [fillBots] Fill empty seats with computer players (true).
 * @property {number} [turnMs] Turn time limit, overriding the game's.
 * @property {[number, number]} [thinkMs] How long a computer player "thinks" before moving: [min, max] (700, 1500).
 * @property {number} [graceMs] How long a player who lost connection is waited for on their turn before a computer plays for them (8000).
 * @property {number} [lingerMs] How long the room stays after the game ends, for a rematch (30 000).
 * @property {number} [seed] Fix the random seed (tests); otherwise it is unpredictable.
 * @property {any} [matchOptions] Passed to the game's `setup`.
 */

/**
 * Turn a game definition into the `createRoom(options)` that the server's `RoomManager` loads (in a worker thread or a process
 * of its own). Export the result from a room module: `export const createRoom = turnRoom(myGame)`.
 *
 * @param {import('./game.js').GameDefinition} game
 * @param {Partial<TurnRoomOptions>} [defaults]
 * @returns {(options?: TurnRoomOptions) => Promise<TurnRoom>} the `createRoom` a room module exports
 */

export function turnRoom(game, defaults = {}) {
  return async (options = {}) => new TurnRoom(game, { ...defaults, ...options }, { timer: true });
}

/**
 * A running table: checks join tokens, seats the players, starts the match, applies moves with the game's own rules, sends
 * each player only what they may see, plays for robots and for players who are away, enforces turn limits, offers a rematch,
 * and reports each result through `stats()`. Normally created for you by `turnRoom(game)`.
 */
export class TurnRoom {
  /**
   * @param {import('./game.js').GameDefinition} game
   * @param {TurnRoomOptions} options
   * @param {{now?: () => number, timer?: boolean, onGameOver?: (result: any, match: Match) => void}} [env] Tests give a clock and tick the room themselves.
   */
  constructor(game, options, { now = () => Date.now(), timer = false, onGameOver } = {}) {
    this.options = options;
    this.game = options.turnMs ? { ...game, turnMs: options.turnMs } : game;
    this.now = now; this.onGameOver = onGameOver;
    if (!options.open && !options.secret) throw new Error('a turn room needs a `secret` for join tokens (or `open: true` while developing)');
    this.tokens = options.open ? null : new JoinTokens({ secret: options.secret, ttlMs: 60_000, now });
    this.expect = options.expect ?? null;
    this.strangers = new Set(); // connections that have not said hello yet
    this.seats = new Map(); // player id -> { id, name, bot, conn, joinedAt, disconnectedAt }
    this.phase = 'waiting';
    /** @type {Match | null} */ this.match = null;
    this.matches = 0; this.lastResult = null; this.firstJoinAt = null; this.overAt = null;
    this.botDueAt = null; this.botFor = null; this.rematchVotes = new Set(); this.closed = false;
    this.think = options.thinkMs ?? [700, 1500];
    this.stats_ = { moves: 0, rejected: 0, botMoves: 0, autoMoves: 0 };
    this.thinkRng = new Rng(options.seed ?? randomInt(1, 2 ** 31));
    this.timer = timer ? setInterval(() => this.tick(), 100) : null;
    this.timer?.unref?.();
  }

  // ---- connections ----
  /** A new connection from the server (the room module contract). @param {import('@engine/transport').Transport} transport */
  attach(transport) {
    const conn = { t: transport, player: null, tokens: 40, last: this.now(), since: this.now() };
    this.strangers.add(conn); // dropped by `tick` if they do not say hello in time
    transport.onMessage = (bytes) => this.#onMessage(conn, bytes);
    transport.onClose = () => this.#onClose(conn);
  }
  #send(conn, msg) { try { conn.t.send(encode(msg), CHANNEL.RELIABLE); } catch { /* the connection is going away */ } }
  #kick(conn, reason) { this.#send(conn, { t: 'bye', reason }); try { conn.t.close(reason); } catch { /* already closed */ } }

  #onClose(conn) {
    this.strangers.delete(conn);
    const seat = conn.player && this.seats.get(conn.player);
    if (!seat || seat.conn !== conn) return;
    seat.conn = null; seat.disconnectedAt = this.now();
    this.#broadcastPlayers();
  }

  #onMessage(conn, bytes) {
    const now = this.now();
    conn.tokens = Math.min(40, conn.tokens + ((now - conn.last) / 1000) * 20); conn.last = now; // 20 messages a second, bursts of 40
    if (--conn.tokens < 0) return this.#kick(conn, 'too many messages');
    const m = parseClientMessage(bytes);
    if (!m) return;
    if (m.t === 'hello') return this.#hello(conn, m);
    if (!conn.player) return;
    const seat = this.seats.get(conn.player);
    switch (m.t) {
      case 'ping': this.#send(conn, { t: 'pong', n: m.n }); break;
      case 'leave': this.#kick(conn, 'left'); break;
      case 'rematch':
        if (this.phase !== 'over') break;
        this.rematchVotes.add(conn.player);
        if ([...this.seats.values()].filter((s) => !s.bot && s.conn).every((s) => this.rematchVotes.has(s.id))) this.#start(true);
        else this.#broadcastPlayers();
        break;
      case 'move': {
        if (this.phase !== 'playing' || !this.match) { this.#send(conn, { t: 'reject', id: m.id, error: 'the game has not started' }); break; }
        const r = this.match.move(seat.id, m.move, m.arg, now);
        if (!r.ok) { this.stats_.rejected++; this.#send(conn, { t: 'reject', id: m.id, error: r.error }); break; }
        this.stats_.moves++;
        this.#afterMove(r, seat.id, m.id);
        break;
      }
      default: break;
    }
  }

  #hello(conn, m) {
    if (conn.player) return;
    let player, nameHint = m.name;
    if (this.options.open) { if (!SAFE_ID.test(m.token)) return this.#kick(conn, 'bad token'); player = m.token; }
    else {
      const v = this.tokens.verify(m.token, { room: this.options.roomName });
      if (!v.ok) return this.#kick(conn, `refused: ${v.reason}`);
      player = v.player; nameHint ??= v.extra?.name;
    }
    if (this.expect && !this.expect.some((p) => p.id === player)) return this.#kick(conn, 'this room is not for you');
    let seat = this.seats.get(player);
    if (!seat) {
      if (this.phase !== 'waiting') return this.#kick(conn, 'the game has already started');
      const cap = this.#seatCount();
      if ([...this.seats.values()].filter((s) => !s.bot).length >= cap) return this.#kick(conn, 'the room is full');
      const expected = this.expect?.find((p) => p.id === player);
      seat = { id: player, name: cleanName(nameHint ?? expected?.name, player), bot: false, conn: null, joinedAt: this.now(), disconnectedAt: null };
      this.seats.set(player, seat);
      this.firstJoinAt ??= this.now();
    } else if (seat.conn) { this.#send(seat.conn, { t: 'bye', reason: 'replaced' }); const old = seat.conn; seat.conn = null; try { old.t.close('replaced'); } catch { /* gone */ } }
    seat.conn = conn; seat.disconnectedAt = null; conn.player = player;
    this.strangers.delete(conn);
    this.#send(conn, { t: 'welcome', ...this.#state(player) });
    this.#broadcastPlayers();
    this.tick();
  }

  // ---- the game ----
  #seatCount() { return Math.min(this.game.players.max, this.options.seats ?? this.expect?.length ?? this.game.players.min); }

  #roster(rotate) {
    const humans = [...this.seats.values()].filter((s) => !s.bot);
    let bots = [...this.seats.values()].filter((s) => s.bot);
    const want = this.#seatCount();
    if (this.options.fillBots !== false) {
      for (let i = bots.length; humans.length + bots.length < want; i++) {
        const id = `bot-${bots.length + 1}`;
        const bot = { id, name: ['Robo', 'Clank', 'Beep', 'Sprocket', 'Widget', 'Gizmo'][bots.length % 6], bot: true, conn: null };
        this.seats.set(id, bot); bots.push(bot);
      }
    }
    const all = [...humans, ...bots].slice(0, this.game.players.max);
    new Rng(this.options.seed ?? randomInt(1, 2 ** 31)).shuffle(all);
    if (rotate && this.match) { // a rematch: the one who went first goes last
      const prev = this.match.players, i = (prev.indexOf(this.match.players[0]) + 1) % all.length; all.push(...all.splice(0, i));
    }
    return all;
  }

  #start(rematch = false) {
    const all = this.#roster(rematch);
    if (all.length < this.game.players.min) return false;
    this.match = new Match(this.game, { players: all.map((s) => ({ id: s.id, name: s.name, bot: s.bot })), seed: this.options.seed ?? randomInt(1, 2 ** 31), options: this.options.matchOptions ?? {}, now: this.now() });
    this.phase = 'playing'; this.overAt = null; this.rematchVotes.clear(); this.matches++; this.botDueAt = null; this.botFor = null;
    for (const s of this.seats.values()) if (!s.bot && s.conn) this.#send(s.conn, { t: 'start', ...this.#state(s.id) });
    if (this.match.over) this.#finish();
    return true;
  }

  #playersList() {
    const order = this.match?.players ?? [...this.seats.keys()];
    return order.map((id) => { const s = this.seats.get(id); return { id, name: s.name, bot: !!s.bot, connected: s.bot ? true : !!s.conn, ...(this.rematchVotes.has(id) ? { rematch: true } : {}) }; });
  }
  #broadcastPlayers() { const players = this.#playersList(); for (const s of this.seats.values()) if (s.conn) this.#send(s.conn, { t: 'players', players }); }

  #state(player) {
    const m = this.match, now = this.now();
    return {
      you: player, room: this.options.roomName ?? null, phase: this.phase, seq: m?.seq ?? 0, players: this.#playersList(), turnMs: this.game.turnMs ?? null,
      view: m ? m.viewFor(player) : null, current: m?.current ?? null, legal: m && m.current === player ? m.legalMoves(player) : [], over: m?.over ?? null, turnLeftMs: m ? m.turnLeftMs(now) : null,
    };
  }

  #afterMove(r, by, ack, auto = false) {
    const m = this.match, now = this.now();
    for (const s of this.seats.values()) {
      if (!s.conn) continue;
      this.#send(s.conn, {
        t: 'update', seq: r.seq, by, move: m.log.at(-1).move, ...(s.id === by && ack !== undefined ? { ack } : {}), ...(auto ? { auto: true } : {}),
        events: Match.eventsFor(r.events, s.id), view: m.viewFor(s.id), current: m.current, legal: m.current === s.id ? m.legalMoves(s.id) : [], over: m.over, turnLeftMs: m.turnLeftMs(now),
      });
    }
    this.botDueAt = null;
    if (m.over) this.#finish();
  }

  #finish() {
    this.phase = 'over'; this.overAt = this.now();
    this.lastResult = { id: `${this.options.roomName ?? 'room'}#${this.matches}`, at: this.now(), winners: this.match.over.winners, scores: this.match.over.scores ?? null, players: this.match.roster.map((p) => ({ id: p.id, name: p.name, bot: !!p.bot })), moves: this.match.seq };
    this.onGameOver?.(this.lastResult, this.match);
    this.#broadcastPlayers();
  }

  /** Advance time: start the game when it is time, play for bots and absent players, enforce turn limits, close after the linger. The room calls this itself every 100 ms. */
  tick() {
    if (this.closed) return;
    const now = this.now();
    for (const c of this.strangers) if (now - c.since > 5000) { this.strangers.delete(c); this.#kick(c, 'no hello'); }
    if (this.phase === 'waiting') {
      const humans = [...this.seats.values()].filter((s) => !s.bot);
      const connected = humans.filter((s) => s.conn).length;
      const everyoneHere = this.expect ? this.expect.every((p) => this.seats.get(p.id)?.conn) : connected >= this.#seatCount();
      const waited = this.firstJoinAt !== null && now - this.firstJoinAt >= (this.options.startWaitMs ?? 10_000);
      if (connected > 0 && (everyoneHere || waited)) this.#start();
      return;
    }
    if (this.phase === 'over') { if (this.overAt !== null && now - this.overAt >= (this.options.lingerMs ?? 30_000)) this.#dismiss('the room has closed'); return; }
    const m = this.match;
    const timed = m.timeout(now);
    if (timed) { if (timed.ok) { this.stats_.autoMoves++; this.#afterMove(timed, m.log.at(-1).by, undefined, true); } return; }
    const seat = this.seats.get(m.current);
    const away = seat && !seat.bot && !seat.conn && now - (seat.disconnectedAt ?? now) >= (this.options.graceMs ?? 8000);
    if (seat && (seat.bot || away)) {
      if (this.botFor !== m.current || this.botDueAt === null) { this.botFor = m.current; this.botDueAt = now + this.think[0] + this.thinkRng.random() * (this.think[1] - this.think[0]); return; }
      if (now < this.botDueAt) return;
      const pick = botMove(m, m.current, this.thinkRng);
      this.botDueAt = null;
      if (!pick) return;
      const r = m.move(m.current, pick.move, pick.arg, now);
      if (r.ok) { this.stats_.botMoves++; this.#afterMove(r, m.log.at(-1).by); }
    }
  }

  #dismiss(reason) { for (const s of this.seats.values()) if (s.conn) this.#kick(s.conn, reason); this.closed = true; }

  // ---- the room contract ----
  async close() { clearInterval(this.timer); this.closed = true; for (const s of this.seats.values()) if (s.conn) this.#kick(s.conn, 'server shutting down'); }
  /** Numbers for the server's room list: connected players, the phase, and the result of the last game (so the server can record it once). */
  stats() {
    return { players: [...this.seats.values()].filter((s) => !s.bot && s.conn).length, phase: this.phase, matches: this.matches, seq: this.match?.seq ?? 0, tickMsAvg: 0, tickMsMax: 0, lastResult: this.lastResult, ...this.stats_ };
  }
  control(data) { if (data?.dismiss) this.#dismiss('closed by the server'); }
}
