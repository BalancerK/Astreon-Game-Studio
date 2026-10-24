// Playing a game with a friend over the internet, the simple way: both computers run the same game, and all they send each other is which keys each player is holding.
// That only works because a kit game is plain data and everything in it is repeatable (the seeded `random`, the fixed time step): given the same keys on the same tick, both
// computers get exactly the same game. The price is that a tick waits until both players' keys for it have arrived, so the keys are used a few ticks late (the "delay"),
// hiding the trip across the internet.
//
// A game says it wants two players with `export const players = 2` and reads `inputs` (one set of held keys per player) as the fourth argument of `update`:
//
//     export const players = 2;
//     export function update(game, keys, dt, inputs) {
//       walk(first(game, 'red'), inputs[0]);
//       walk(first(game, 'blue'), inputs[1]);
//     }
//
// On a single computer `inputs` is `[keys]` (and the studio lets the second player use another set of keys). This file is the part that is pure logic: the studio's runner and
// exported games connect it to the network.

/** Where the current game is told who is playing (set by whoever runs the game: the studio, or an exported game). */
const info = { me: 0, players: 1, online: false, waiting: false };

/** Tell the kit about the game being played. Called by the runner, not by games. @param {{me?: number, players?: number, online?: boolean, waiting?: boolean}} next */
export function setNetInfo(next) { Object.assign(info, next); }

/** Which player this computer is, counting from 0. Use it only for drawing (a camera that follows *you*), never for the rules, or the two computers stop agreeing. */
export const me = () => info.me;
/** How many players the game is being played by (1 when played alone). */
export const playerCount = () => info.players;
/** Is the game being played with someone else over the network? */
export const isOnline = () => info.online;
/** True while the game is waiting for the other player's keys (draw a "waiting for your friend" message). */
export const isWaiting = () => info.waiting;

const MAX_KEYS = 24;
const MAX_KEY_LENGTH = 40;

/** The key codes of a set, in a fixed order, so the same keys always look the same. @param {Iterable<string>} keys */
export const keyList = (keys) => [...keys].filter((k) => typeof k === 'string' && k.length <= MAX_KEY_LENGTH).sort().slice(0, MAX_KEYS);

/**
 * The agreement between two (or more) computers about whose keys count on which tick.
 *
 * Each tick: call `local(keys)` once with the keys this player holds *now* (it gives back the message to send); call `receive(message)` for every message from the others; and
 * simulate a tick only if `ready()`, taking `take()` for the keys of every player. The keys held on tick `t` are used on tick `t + delay`, so the first `delay` ticks run with nobody
 * holding anything. Messages may arrive late, twice, or out of order; they never need to arrive in any particular order.
 */
export class Lockstep {
  /**
   * @param {object} [o]
   * @param {number} [o.players] How many players (default 2). @param {number} [o.me] This player's number (0 is the host).
   * @param {number} [o.delay] Ticks between pressing a key and the game using it (default 3: a twentieth of a second).
   * @param {number} [o.window] The most ticks a friend's keys may be ahead of this computer before they are refused (default 240).
   * @param {number} [o.checkEvery] Every this many ticks the computers compare a fingerprint of the game, to notice at once if they ever disagree (default 60).
   */
  constructor({ players = 2, me = 0, delay = 3, window = 240, checkEvery = 60 } = {}) {
    if (!Number.isInteger(players) || players < 2) throw new Error('lockstep needs at least 2 players');
    if (!Number.isInteger(me) || me < 0 || me >= players) throw new Error(`player ${me} is not one of the ${players} players`);
    this.players = players; this.me = me; this.delay = Math.max(0, Math.floor(delay)); this.window = window; this.checkEvery = checkEvery;
    /** The tick to be simulated next. */ this.frame = 0;
    /** The next tick this computer's keys have not been chosen for. */ this.sentTo = this.delay;
    /** @type {Map<number, string[][]>} The keys of each player for each tick still needed. */ this.inputs = new Map();
    for (let f = 0; f < this.delay; f++) this.inputs.set(f, Array.from({ length: players }, () => []));
    /** @type {Map<number, string>} Fingerprints of the game this computer worked out, waiting to be compared. */ this.mine = new Map();
    /** @type {Map<number, Map<number, string>>} Fingerprints from the others. */ this.theirs = new Map();
    /** The first tick on which the computers disagreed, or null. */ this.desyncAt = null;
    /** Ticks that had to wait for a friend's keys. */ this.stalls = 0;
    /** How many messages were refused as nonsense or too far ahead. */ this.refused = 0;
  }

  #slot(frame) {
    let row = this.inputs.get(frame);
    if (!row) { row = Array.from({ length: this.players }, () => null); this.inputs.set(frame, row); }
    return row;
  }

  /**
   * Choose this player's keys for a tick `delay` ticks from now, once per tick.
   * @param {Iterable<string>} keys The keys held now.
   * @returns {{t: 'in', f: number, k: string[]} | null} The message to send to the others, or null if this tick's keys were already chosen.
   */
  local(keys) {
    if (this.sentTo > this.frame + this.delay) return null;
    const f = this.sentTo++, k = keyList(keys);
    this.#slot(f)[this.me] = k;
    return { t: 'in', f, k };
  }

  /**
   * Take in a message from another computer.
   * @param {unknown} message @param {number} from Which player sent it.
   * @returns {boolean} False if it was refused.
   */
  receive(message, from) {
    const m = /** @type {any} */ (message);
    if (!m || typeof m !== 'object' || !Number.isInteger(from) || from < 0 || from >= this.players || from === this.me) { this.refused++; return false; }
    if (m.t === 'in') {
      if (!Number.isInteger(m.f) || m.f < 0 || m.f > this.frame + this.window || !Array.isArray(m.k) || m.k.length > MAX_KEYS || !m.k.every((k) => typeof k === 'string' && k.length <= MAX_KEY_LENGTH)) { this.refused++; return false; }
      if (m.f < this.frame) return true;                                    // an old copy: already used
      const row = this.#slot(m.f);
      if (row[from] === null || row[from] === undefined) row[from] = [...m.k].sort();
      return true;
    }
    if (m.t === 'sum') {
      if (!Number.isInteger(m.f) || m.f < 0 || typeof m.h !== 'string' || m.h.length > 40) { this.refused++; return false; }
      const mine = this.mine.get(m.f);
      if (mine !== undefined) { if (mine !== m.h) this.desyncAt ??= m.f; this.mine.delete(m.f); } else if (m.f > this.frame && m.f < this.frame + this.window) {
        let per = this.theirs.get(m.f); if (!per) this.theirs.set(m.f, per = new Map()); per.set(from, m.h);
      }
      return true;
    }
    this.refused++;
    return false;
  }

  /** Has every player's keys for the next tick arrived? */
  ready() {
    if (this.#complete()) return true;
    this.stalls++;
    return false;
  }

  #complete() {
    const row = this.inputs.get(this.frame);
    if (!row) return false;
    for (let p = 0; p < this.players; p++) if (row[p] === null || row[p] === undefined) return false;
    return true;
  }

  /** The keys of every player for the tick about to be simulated: one `Set` per player. Call only when `ready()`; then simulate the tick, and call `done`. @returns {Set<string>[]} */
  take() {
    if (!this.#complete()) throw new Error('take() before the keys for this tick have arrived (check ready() first)');
    return this.inputs.get(this.frame).map((k) => new Set(k ?? []));
  }

  /**
   * The tick has been simulated. Pass a fingerprint of the game now (only needed on the ticks `wantsSum` says; otherwise leave it out).
   * @param {string} [hash] @returns {{t: 'sum', f: number, h: string} | null} A message to send, when this is a tick to compare on.
   */
  done(hash) {
    const finished = this.frame;
    this.inputs.delete(finished);
    this.frame++;
    if (hash === undefined || !this.wantsSum(finished + 1)) return null;
    const f = finished + 1, per = this.theirs.get(f);
    if (per) {
      for (const h of per.values()) if (h !== hash) this.desyncAt ??= f;
      this.theirs.delete(f);
    } else this.mine.set(f, hash);
    return { t: 'sum', f, h: hash };
  }

  /** Is the game after `frame` ticks one the computers compare? @param {number} frame */
  wantsSum(frame) { return this.checkEvery > 0 && frame % this.checkEvery === 0; }
}
