// The player's side of a turn-based game: connect to the room, say hello with a token, keep the latest view of the game, send moves and hear
// whether they were accepted, and reconnect (with a fresh token) if the connection drops. It draws nothing: a page reads `view`, `current`
// and `legal` and listens to `onEvents` for what happened.
import { CHANNEL } from '../../transport/src/index.js';
import { encode, parseServerMessage } from './protocol.js';

/**
 * The player's side of a turn-based game: connects to the room with a join token, keeps the latest `view`, `current` player
 * and `legal` moves, sends moves (`move()` resolves when the room accepts it), and reconnects with a fresh token if the
 * connection drops. It draws nothing: a page reads its fields and listens to `onEvents`.
 *
 * @typedef {object} TurnClientOptions
 * @property {() => import('../../transport/src/types.js').Transport} createTransport Open a connection (called again to reconnect).
 * @property {() => string | Promise<string>} getToken A join token for this room (called on every connect, so a reconnect can use a fresh one).
 * @property {string} [name] The name to show.
 * @property {{maxAttempts?: number, baseDelayMs?: number, maxDelayMs?: number} | null} [reconnect] Backoff for reconnecting after an unexpected disconnect (default 6 tries from 300 ms); `null` never reconnects.
 * @property {() => number} [now] Milliseconds, for the turn countdown.
 * @property {(ms: number, fn: () => void) => any} [setTimer] Timer, replaceable in tests.
 * @property {number} [moveTimeoutMs] A move that gets no answer in this long fails (8000).
 */


export class TurnClient {
  /** @param {TurnClientOptions} o */
  constructor({ createTransport, getToken, name, reconnect = {}, now = () => Date.now(), setTimer = (ms, fn) => setTimeout(fn, ms), moveTimeoutMs = 8000 }) {
    this.createTransport = createTransport; this.getToken = getToken; this.name = name; this.now = now; this.setTimer = setTimer; this.moveTimeoutMs = moveTimeoutMs;
    this.reconnectOpts = reconnect === null ? null : { maxAttempts: 6, baseDelayMs: 300, maxDelayMs: 4000, ...reconnect };
    /** 'connecting' | 'waiting' (for players) | 'playing' | 'over' | 'reconnecting' | 'closed' */ this.state = 'connecting';
    /** @type {string | null} your player id */ this.you = null;
    this.room = null; this.seq = 0;
    /** @type {Array<{id: string, name: string, bot: boolean, connected: boolean}>} */ this.players = [];
    /** What you may see of the game (the shape is up to the game's `view`). */ this.view = null;
    /** @type {string | null} whose turn it is */ this.current = null;
    /** @type {Array<{move: string, arg?: any}>} what you can do now (empty when it is not your turn) */ this.legal = [];
    /** @type {any} the result once the game is over */ this.over = null;
    this.turnMs = null; this.turnEndsAt = null;
    this.closeReason = ''; this.attempt = 0; this.closing = false;
    this.nextMoveId = 1; this.pending = new Map();
    /** Called whenever anything changed: `(client)`. */ this.onChange = null;
    /** Called with the events of each update (and of your own moves): `(events, message)`. */ this.onEvents = null;
    /** Round-trip time of the last ping, ms. */ this.pingMs = NaN;
    this.transport = null;
  }

  /** Connect. Returns `this`. */
  start() {
    const t = this.createTransport();
    this.transport = t;
    const hello = () => {
      const send = (token) => { if (t === this.transport) t.send(encode({ t: 'hello', token, ...(this.name ? { name: this.name } : {}) }), CHANNEL.RELIABLE); };
      try {
        const token = this.getToken();
        if (token && typeof token.then === 'function') token.then(send, (e) => this.#fail(`could not get a join token: ${e.message}`)); else send(token); // no waiting when the token is already there
      } catch (e) { this.#fail(`could not get a join token: ${e.message}`); }
    };
    t.onOpen = hello;
    t.onMessage = (bytes) => { if (t === this.transport) this.#onMessage(bytes); };
    t.onClose = (reason) => {
      if (t !== this.transport) return;
      this.#rejectAll(new Error('disconnected'));
      if (this.state === 'closed') return;
      if (this.reconnectOpts && !this.closing && this.you !== null) { this.#scheduleReconnect(reason); return; }
      this.state = 'closed'; this.closeReason ||= reason; this.onChange?.(this);
    };
    if (t.state === 'open') hello();
    return this;
  }

  #fail(reason) { this.state = 'closed'; this.closeReason = reason; this.closing = true; this.transport?.close?.('failed'); this.onChange?.(this); }

  #scheduleReconnect(reason) {
    const o = this.reconnectOpts;
    if (this.attempt >= o.maxAttempts) { this.state = 'closed'; this.closeReason = `could not reconnect (${reason})`; this.onChange?.(this); return; }
    this.state = 'reconnecting'; this.onChange?.(this);
    const delay = Math.min(o.maxDelayMs, o.baseDelayMs * 2 ** this.attempt++);
    this.setTimer(delay, () => { if (!this.closing && this.state === 'reconnecting') { try { this.start(); } catch (e) { this.#scheduleReconnect(e.message); } } });
  }

  #apply(m) {
    if (m.seq !== undefined) this.seq = m.seq;
    if ('view' in m) this.view = m.view;
    if ('current' in m) this.current = m.current;
    this.legal = Array.isArray(m.legal) ? m.legal : [];
    if ('over' in m) this.over = m.over ?? null;
    if ('turnLeftMs' in m) this.turnEndsAt = m.turnLeftMs === null || m.turnLeftMs === undefined ? null : this.now() + m.turnLeftMs;
    if (m.players) this.players = m.players;
  }

  #onMessage(bytes) {
    const m = parseServerMessage(bytes);
    if (!m) return;
    switch (m.t) {
      case 'welcome': case 'start':
        this.you = m.you; this.room = m.room; this.attempt = 0; this.turnMs = m.turnMs ?? null;
        this.#apply(m);
        this.state = m.phase === 'over' ? 'over' : m.phase === 'playing' ? 'playing' : 'waiting';
        if (m.t === 'start') this.onEvents?.([{ e: 'start' }], m);
        this.onChange?.(this);
        break;
      case 'players': this.players = m.players; this.onChange?.(this); break;
      case 'update': {
        if (m.seq <= this.seq && m.seq !== undefined) break; // an old one
        this.#apply(m);
        this.state = m.over ? 'over' : 'playing';
        const p = this.pending.get(m.ack);
        if (p) { this.pending.delete(m.ack); p.resolve({ ok: true, seq: m.seq }); }
        this.onEvents?.(m.events ?? [], m);
        this.onChange?.(this);
        break;
      }
      case 'reject': { const p = this.pending.get(m.id); if (p) { this.pending.delete(m.id); p.reject(new Error(m.error)); } break; }
      case 'pong': this.pingMs = this.now() - m.n; this.onChange?.(this); break;
      case 'bye': this.closing = true; this.closeReason = m.reason ?? 'closed'; this.state = 'closed'; this.transport?.close?.(m.reason); this.onChange?.(this); break;
      default: break;
    }
  }

  #rejectAll(err) { for (const p of this.pending.values()) p.reject(err); this.pending.clear(); }

  /** Whose turn it is: is it yours? */
  get myTurn() { return this.state === 'playing' && this.current === this.you; }
  /** Milliseconds left in the current turn (null when turns are not timed). */
  turnLeftMs() { return this.turnEndsAt === null ? null : Math.max(0, this.turnEndsAt - this.now()); }
  /** The name of a player. */
  nameOf(id) { return this.players.find((p) => p.id === id)?.name ?? id; }

  /**
   * Make a move. Resolves when the room has accepted it (and the game has moved on); rejects with the room's reason if it was refused.
   * @param {string} move @param {any} [arg] @returns {Promise<{ok: true, seq: number}>}
   */
  move(move, arg) {
    if (!this.transport || this.state === 'closed' || this.state === 'reconnecting' || this.state === 'connecting') return Promise.reject(new Error('not connected'));
    const id = this.nextMoveId++;
    return new Promise((resolve, reject) => {
      const timer = this.setTimer(this.moveTimeoutMs, () => { if (this.pending.delete(id)) reject(new Error('the room did not answer')); });
      this.pending.set(id, { resolve: (v) => { clearTimeout?.(timer); resolve(v); }, reject: (e) => { clearTimeout?.(timer); reject(e); } });
      this.transport.send(encode({ t: 'move', id, move, ...(arg === undefined ? {} : { arg }) }), CHANNEL.RELIABLE);
    });
  }
  /** Vote for another game after this one. */
  rematch() { this.transport?.send(encode({ t: 'rematch' }), CHANNEL.RELIABLE); }
  /** Measure the round trip (see `pingMs`). */
  ping() { this.transport?.send(encode({ t: 'ping', n: this.now() }), CHANNEL.RELIABLE); }
  /** Leave on purpose: no reconnecting. */
  close() { if (this.closing && this.state === 'closed') return; this.closing = true; this.#rejectAll(new Error('closed')); try { this.transport?.send(encode({ t: 'leave' }), CHANNEL.RELIABLE); } catch { /* already gone */ } this.transport?.close?.('left'); this.state = 'closed'; this.onChange?.(this); }
}
