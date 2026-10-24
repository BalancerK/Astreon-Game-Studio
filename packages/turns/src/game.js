// Turn-based games as plain data and pure functions: the rules (`defineGame`) and one running game (`Match`). Nothing here knows about
// networks, timers or screens, so a game's rules are tested like any other function, run the same on a server and in a bot, and can be saved
// in the middle and loaded again.
import { Rng } from './rng.js';

/** A move the rules refuse (not allowed now, bad argument). Throw it from a move with `ctx.fail("why")`; the game is left as it was. */
export class MoveError extends Error {
  constructor(message) { super(message); this.name = 'MoveError'; }
}

const clone = (v) => JSON.parse(JSON.stringify(v));

/**
 * @typedef {object} MoveContext What a move can use.
 * @property {string} player Who is moving.
 * @property {string[]} players Everyone, in turn order.
 * @property {Rng} random The match's random numbers (the same seed gives the same game).
 * @property {number} seq Moves made so far.
 * @property {number} now The time of the move (milliseconds).
 * @property {(name: string, data?: any) => void} emit Something everyone sees happened (`"drew"`, `"played"`): for animations and logs.
 * @property {(player: string, name: string, data?: any) => void} emitTo Something only one player sees (the card you drew).
 * @property {(next?: string) => void} endTurn Pass the turn to the next player, or to `next`.
 * @property {(reason: string) => never} fail Refuse the move.
 *
 * @typedef {object} GameDefinition
 * @property {string} name
 * @property {{min: number, max: number}} players How many may play.
 * @property {(ctx: {players: string[], random: Rng, options: any}) => any} setup The starting state. It must be plain JSON data.
 * @property {Record<string, ((state: any, ctx: MoveContext, arg: any) => any) | {move: (state: any, ctx: MoveContext, arg: any) => any, anyTime?: boolean}>} moves
 *   Each move changes `state` in place (or returns a new one). Only the player whose turn it is may move, unless the move says `anyTime: true`.
 * @property {(state: any, player: string | null, meta: {current: string | null, over: any, players: string[], seq: number}) => any} [view]
 *   What `player` may see (`null`: a spectator). Hide other players' secrets here. Default: everything.
 * @property {(state: any, players: string[]) => ({winners: string[], scores?: Record<string, number>, reason?: string} | null)} [endIf] Is the game over?
 * @property {(state: any, player: string, players: string[]) => Array<{move: string, arg?: any}>} [legalMoves] Every move `player` could make now (for bots, hints and tests).
 * @property {(state: any, players: string[]) => string} [firstPlayer] Who starts (default: the first in the list).
 * @property {(state: any, player: string) => boolean} [isActive] False for a player who is out: their turn is skipped.
 * @property {number} [turnMs] How long a turn may take; then `onTimeout` (or a legal move) is played for the player.
 * @property {(state: any, player: string, players: string[]) => ({move: string, arg?: any} | null)} [onTimeout] What to play when time runs out.
 * @property {(o: {view: any, legal: Array<{move: string, arg?: any}>, random: Rng, player: string}) => ({move: string, arg?: any} | null)} [bot] How a computer player chooses.
 */

/** Check a game definition and fill in the defaults. @param {GameDefinition} def */
export function defineGame(def) {
  if (!def || typeof def.name !== 'string' || !def.name) throw new Error('a game needs a name');
  if (!def.players || !(def.players.min >= 1) || !(def.players.max >= def.players.min)) throw new Error(`game "${def.name}": players must be { min, max } with 1 <= min <= max`);
  if (typeof def.setup !== 'function') throw new Error(`game "${def.name}": setup(ctx) is required`);
  if (!def.moves || !Object.keys(def.moves).length) throw new Error(`game "${def.name}": it needs at least one move`);
  for (const [n, m] of Object.entries(def.moves)) if (typeof m !== 'function' && typeof m?.move !== 'function') throw new Error(`game "${def.name}": move "${n}" must be a function`);
  return Object.freeze({ view: (state) => state, endIf: () => null, legalMoves: () => [], ...def });
}

/** One game being played. */
export class Match {
  /**
   * @param {GameDefinition} game
   * @param {object} o
   * @param {Array<string | {id: string, name?: string, bot?: boolean}>} o.players In turn order.
   * @param {number} [o.seed] The random seed (the same seed and the same moves always give the same game).
   * @param {any} [o.options] Passed to `setup`.
   * @param {number} [o.now] When it starts (milliseconds), for the turn timer.
   */
  constructor(game, { players, seed = 1, options = {}, now = 0 }) {
    this.game = game;
    this.roster = players.map((p) => (typeof p === 'string' ? { id: p, name: p, bot: false } : { name: p.id, bot: false, ...p }));
    this.players = this.roster.map((p) => p.id);
    if (new Set(this.players).size !== this.players.length) throw new Error('two players have the same id');
    if (this.players.length < game.players.min || this.players.length > game.players.max) throw new Error(`${game.name} needs ${game.players.min} to ${game.players.max} players (got ${this.players.length})`);
    this.seed = seed; this.rng = new Rng(seed);
    this.state = game.setup({ players: this.players, random: this.rng, options }) ?? {};
    this.seq = 0; this.options = options;
    /** @type {string | null} whose turn it is */ this.current = game.firstPlayer ? game.firstPlayer(this.state, this.players) : this.players[0];
    /** @type {{winners: string[], scores?: Record<string, number>, reason?: string} | null} */ this.over = null;
    this.turnStartedAt = now;
    /** The last moves, newest last: `{seq, by, move, arg, events, auto?}`. */ this.log = [];
    this._checkOver();
  }

  _checkOver() {
    const r = this.game.endIf(this.state, this.players);
    if (r) { this.over = r; this.current = null; }
    return !!r;
  }
  _next(from) {
    const n = this.players.length;
    for (let i = 1; i <= n; i++) {
      const p = this.players[(this.players.indexOf(from) + i) % n];
      if (!this.game.isActive || this.game.isActive(this.state, p)) return p;
    }
    return from;
  }

  /**
   * Make a move. Never throws for a refused move: you get `{ ok: false, error }` and the game is unchanged.
   * @param {string} player @param {string} move @param {any} [arg] @param {number} [now] @param {{auto?: boolean}} [o]
   * @returns {{ok: true, seq: number, events: any[], current: string | null, over: any} | {ok: false, error: string}}
   */
  move(player, move, arg, now = 0, { auto = false } = {}) {
    if (this.over) return { ok: false, error: 'the game is over' };
    if (!this.players.includes(player)) return { ok: false, error: 'you are not in this game' };
    const def = this.game.moves[move];
    if (!def) return { ok: false, error: `there is no move "${String(move).slice(0, 30)}"` };
    const fn = typeof def === 'function' ? def : def.move;
    if (!(typeof def === 'object' && def.anyTime) && this.current !== player) return { ok: false, error: 'it is not your turn' };
    const draft = clone(this.state), rngBefore = this.rng.state, events = [];
    let next;
    const ctx = {
      player, players: this.players, random: this.rng, seq: this.seq, now,
      emit: (name, data) => { events.push(data === undefined ? { e: name } : { e: name, data }); },
      emitTo: (to, name, data) => { events.push({ e: name, to, ...(data === undefined ? {} : { data }) }); },
      endTurn: (to) => { next = to ?? true; },
      fail: (reason) => { throw new MoveError(reason); },
    };
    let result;
    try { result = fn(draft, ctx, arg === undefined ? undefined : clone(arg)); }
    catch (e) { this.rng.state = rngBefore; if (e instanceof MoveError) return { ok: false, error: e.message }; throw e; }
    this.state = result !== undefined && result !== draft ? result : draft;
    this.seq++;
    const wasCurrent = this.current;
    if (next !== undefined) { this.current = next === true ? this._next(wasCurrent ?? player) : next; this.turnStartedAt = now; }
    if (this._checkOver()) events.push({ e: 'over', data: this.over });
    this.log.push({ seq: this.seq, by: player, move, ...(arg === undefined ? {} : { arg }), events, ...(auto ? { auto: true } : {}) });
    if (this.log.length > 200) this.log.shift();
    return { ok: true, seq: this.seq, events, current: this.current, over: this.over };
  }

  /** What one player may see (`null`: a spectator). */
  viewFor(player) { return clone(this.game.view(this.state, player, { current: this.current, over: this.over, players: this.players, seq: this.seq })); }
  /** The events of a move, as one player may see them: private events for others are left out. */
  static eventsFor(events, player) { return events.filter((e) => e.to === undefined || e.to === player).map(({ to, ...rest }) => rest); }
  /** Every move `player` could make now. */
  legalMoves(player) { return this.over ? [] : this.game.legalMoves(this.state, player, this.players); }

  /** Milliseconds left in the current turn, or null if turns are not timed. */
  turnLeftMs(now) { return this.game.turnMs && this.current ? Math.max(0, this.game.turnMs - (now - this.turnStartedAt)) : null; }

  /** If the current player has run out of time, play for them. @returns {ReturnType<Match['move']> | null} the move that was made, or null if there was no need */
  timeout(now) {
    if (!this.game.turnMs || !this.current || now - this.turnStartedAt < this.game.turnMs) return null;
    const p = this.current;
    const pick = this.game.onTimeout?.(this.state, p, this.players) ?? this.legalMoves(p)[0] ?? null;
    if (!pick) return null;
    return this.move(p, pick.move, pick.arg, now, { auto: true });
  }

  /** The whole game as plain data, to store and `Match.load` later (reconnecting after a crash, a game paused for a day). */
  save() {
    return clone({ v: 1, game: this.game.name, roster: this.roster, seed: this.seed, rng: this.rng.state, state: this.state, seq: this.seq, current: this.current, over: this.over, turnStartedAt: this.turnStartedAt, options: this.options });
  }
  /** @param {GameDefinition} game @param {any} data */
  static load(game, data) {
    if (data?.v !== 1 || data.game !== game.name) throw new Error(`this save is not a ${game.name} game`);
    const m = Object.create(Match.prototype);
    Object.assign(m, { game, roster: data.roster, players: data.roster.map((p) => p.id), seed: data.seed, options: data.options ?? {}, state: clone(data.state), seq: data.seq, current: data.current, over: data.over, turnStartedAt: data.turnStartedAt, log: [] });
    m.rng = new Rng(data.seed); m.rng.state = data.rng;
    return m;
  }
}

/**
 * The move a computer player makes: the game's `bot` if it has one, else a random legal move.
 * @returns {{move: string, arg?: any} | null} null when there is nothing to do
 */
export function botMove(match, player, random = match.rng) {
  const legal = match.legalMoves(player);
  if (!legal.length) return null;
  return match.game.bot?.({ view: match.viewFor(player), legal, random, player }) ?? random.pick(legal);
}
