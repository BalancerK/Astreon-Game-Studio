// A player's side of an online match in a game where every machine plays the whole game and a server has the last word (see `InputRelay`). Each frame the player's command is played at once (and sent),
// the other players' and the computer's commands are guessed (the same as their last one) until the server's list of what was really used for that frame arrives; if a guess was wrong, the game goes
// back to that frame and is played forward again (the engine's `RollbackSession`). The server's frames come as a short list per frame, with a checksum now and then that says what the game was, so a machine
// that has gone wrong is noticed, asks for the game afresh and carries on. This holds all of that and nothing about sockets or screens: the page gives it messages and the time, and reads the game.
//
// The messages it speaks (plain objects with a text `t`): from the server `go` (the match begins), `pong`, `f` (a frame: `f`, `i` the commands that changed, `ch` changes of who holds a seat, `h` a checksum),
// `fd` (a datagram of several frames), `state` (the whole game: `f`, `s`, `last`), `pings` (`w` the window, `p` each seat's round trip), `roster`, `end`; to the server `in` (`f`, `c`), `inr` (the last few
// commands, `cs`), `ping` (`c`, `r`), `nack` (`from`), `resync`.
import { RollbackSession } from '@engine/client';
import { describeDifferences } from './diff.js';
import { TICK_MS } from './window.js';

/** How many frames behind the server's clock a machine may be before it asks for the game as it stands rather than playing the missed frames. */
const CATCH_UP = 30;

/**
 * @typedef {object} OnlineGame What the game is, for the online match.
 * @property {() => any} base makes the state at frame 0 (the same on every machine, from what the server's `start` message said)
 * @property {(state: any, commands: any[], changes: Array<{seat: number, [k: string]: any}> | undefined, frame: number) => any[]} step plays one frame: apply the changes (of who holds a seat, and anything else the server recorded), play the game with these
 * commands (one decoded command for each seat), and return the events of the frame (shown once, when the frame is played for the first time)
 * @property {(state: any) => any} clone @property {(state: any) => number} checksum @property {(state: any) => any} serialize the state as plain data (for the server's copy and for finding differences)
 * @property {(data: any, base: any) => any} revive the state from plain data (`base` is a fresh state to take what cannot be written down from)
 * @property {(raw?: any) => any} normalize @property {(command: any) => any} encode @property {(encoded: any) => any} decode a command (see `CommandCodec` in relay.js)
 */

/** A player's side of an online match: plays at once, takes the server's word, keeps the clock and the delay (see the top of this file). */
export class OnlineRollback {
  /**
   * @param {object} o
   * @param {any[]} o.seats a record for each seat, kept (the server's `roster` messages update them)
   * @param {number} o.you this player's seat
   * @param {OnlineGame} o.game
   * @param {(msg: any) => void} o.send sends a message to the server the reliable way @param {(msg: any) => void} [o.sendFast] for what may be lost (pings, commands) @param {() => boolean} [o.redundant] whether commands go in datagrams
   * of several at a time @param {number} [o.window] the server's window in frames @param {number} [o.inputDelay] @param {(events: any[], frame: number) => void} [o.onEvents]
   */
  constructor({ seats, you, game, send, sendFast = send, redundant = () => false, window = 6, inputDelay = 0, onEvents = () => {} }) {
    this.game = game; this.sendFast = sendFast; this.redundant = redundant; this.recentCommands = []; this.pendingFrames = new Map(); this.nackedAt = -1e9; this.stats = { frames: 0, corrections: 0, resyncs: 0, nacks: 0 };
    this.you = you; this.send = send; this.window = window; this.inputDelay = inputDelay; this.onEvents = onEvents;
    this.seats = seats;
    this.base = () => game.base();
    this.started = false; this.over = false;
    /** Each seat's round trip to the server in milliseconds, -1 for a computer-driven seat (told by the server every two seconds). @type {number[] | null} */ this.pings = null;
    /** The newest canonical command of every seat (what an empty entry in a server frame means). */
    this.lastCanon = this.seats.map(() => game.normalize());
    this.nextCanon = 0;
    this.changes = new Map();
    this.frameEvents = new Map();
    this.delivered = -1;
    this.clock = { offset: null, samples: [] };
    this.rtt = 0; this.jitter = 0; this.pingAt = -1e9; this.resyncAt = -1e9;
    this.#newSession(this.base(), 0);
  }

  #newSession(state, startFrame) {
    const { game } = this;
    this.session = new RollbackSession({
      players: this.seats.length, local: this.you, init: () => state, clone: game.clone, checksum: game.checksum, blank: game.normalize(), startFrame, assumeBlank: false, serverDecides: true,
      inputDelay: this.inputDelay, maxRollback: 90, step: (s, inputs, frame) => this.#step(s, inputs, frame),
    });
    this.nextCanon = startFrame;
    this.pendingFrames?.clear();
    this.delivered = startFrame - 1;
    this.frameEvents.clear();
  }

  #step(s, inputs, frame) {
    this.frameEvents.set(frame, this.game.step(s, inputs, this.changes.get(frame), frame));
  }

  /** The game now (it is replaced whenever it is played again from an earlier frame, so ask each frame). */
  get state() { return this.session.state; }
  /** How far ahead of what the server has confirmed this machine is playing (milliseconds): the part of what is on the screen that is a guess. */
  get aheadMs() { return Math.max(0, (this.session.frame - this.session.confirmedFrame) * TICK_MS); }
  /** The frame the machine has played up to. */
  get frame() { return this.session.frame; }

  /** A message from the server. @param {any} msg @param {number} now milliseconds */
  message(msg, now) {
    switch (msg.t) {
      case 'go': this.started = true; this.ping(now, true); break;
      case 'pong': this.#pong(msg, now); break;
      case 'f': this.#frame(msg, now); break;
      case 'fd': for (const m of msg.fs ?? []) this.#frame(m, now); break;                // (a datagram holds the last few frames: the ones already played are skipped)
      case 'state': this.#adopt(msg); break;
      case 'pings': this.pings = msg.p; if (Number.isFinite(msg.w)) { this.window = msg.w; this.#adaptDelay(); } break;
      case 'roster': for (let i = 0; i < msg.seats.length && i < this.seats.length; i++) Object.assign(this.seats[i], msg.seats[i]); break;
      case 'end': this.over = true; break;
      default:
    }
  }

  #frame(msg, now = performance.now()) {
    if (msg.f < this.nextCanon) return;
    if (msg.f > this.nextCanon) {                                    // a frame came but the one before it did not (a datagram was lost): keep it, and ask for what is missing the reliable way if it does not come
      this.pendingFrames.set(msg.f, msg);
      if (now - this.nackedAt > 120) { this.nackedAt = now; this.stats.nacks++; this.send({ t: 'nack', from: this.nextCanon }); }
      return;
    }
    this.#applyFrame(msg);
    while (this.pendingFrames.has(this.nextCanon)) { const next = this.pendingFrames.get(this.nextCanon); this.pendingFrames.delete(this.nextCanon); this.#applyFrame(next); }
    for (const f of this.pendingFrames.keys()) if (f < this.nextCanon) this.pendingFrames.delete(f);
  }

  #applyFrame(msg) {
    if (msg.ch) { this.changes.set(msg.f, msg.ch); this.session.redoFrom(msg.f); }            // (a seat changed hands from this frame: whatever was played since without knowing it is played again)
    msg.i.forEach((c, i) => { if (c !== null) this.lastCanon[i] = this.game.decode(c); });
    for (let i = 0; i < this.seats.length; i++) this.session.setInput(i, msg.f, this.lastCanon[i]);
    this.nextCanon = msg.f + 1;
    if (msg.h !== undefined && msg.f <= this.session.confirmedFrame - 1) {
      if (!this.session.report(msg.f, msg.h)) this.#resync();
    }
  }

  #resync() {
    if (this.stats.resyncs > 20) return;
    this.stats.resyncs++;
    this.send({ t: 'resync' });
  }

  /** The server's own copy of the game, to start from (a player who joins half way, or one whose machine went wrong). */
  #adopt(msg) {
    const { game } = this, base = this.base();
    const mine = this.session.snapshots.get(msg.f);
    if (mine) this.lastMismatch = { frame: msg.f, differences: describeDifferences(game.serialize(mine), msg.s) };           // (what this machine had wrong, for whoever is looking into it)
    this.lastCanon = (msg.last ?? []).map((s) => (s ? game.decode(JSON.parse(s)) : game.normalize()));
    while (this.lastCanon.length < this.seats.length) this.lastCanon.push(game.normalize());
    this.changes.clear();
    this.#newSession(game.revive(msg.s, base), msg.f);
  }

  // ---- time ----
  /** How many frames ahead a command is played, for this ping: a command for frame F must reach the server before it plays F, which is the window after F on the server's clock, and a command takes half the round trip to get there. */
  #adaptDelay() {
    const want = Math.max(0, Math.min(8, Math.ceil((this.rtt / 2 + 2 * this.jitter) / TICK_MS - this.window + 1)));
    this.inputDelay = want;
    if (want !== this.session.inputDelay) this.session.inputDelay = want;
  }

  /** Ask the server what time it is in the match (every second or so). @param {number} now @param {boolean} [force] */
  ping(now, force = false) {
    if (!force && now - this.pingAt < 1000) return;
    this.pingAt = now;
    this.sendFast({ t: 'ping', c: now, r: Math.round(this.rtt) });
  }

  #pong(msg, now) {
    const sample = now - msg.c;
    this.jitter = this.rtt ? this.jitter * 0.8 + Math.abs(sample - this.rtt) * 0.2 : 0;
    this.rtt = this.rtt ? this.rtt * 0.8 + sample * 0.2 : sample;
    this.#adaptDelay();
    if (msg.m < 0) return;
    const at = now - msg.m * TICK_MS - (now - msg.c) / 2;                 // the moment (on this machine's clock) at which the match's frame 0 began
    const s = this.clock.samples;
    s.push({ at, rtt: now - msg.c });
    if (s.length > 7) s.shift();
    const best = [...s].sort((a, b) => a.rtt - b.rtt).slice(0, 3);          // the quickest answers are the truest
    this.clock.offset = best.reduce((t, x) => t + x.at, 0) / best.length;
  }

  /** Which frame of the match it is now, by the server's clock (a fraction), or NaN before the clock is known. @param {number} now */
  matchFrame(now) { return this.clock.offset === null ? NaN : (now - this.clock.offset) / TICK_MS; }

  /**
   * Play the frames that are due: for each, take the player's command, send it, and play the frame. Call every rendered frame (or at least often).
   * @param {number} now milliseconds @param {() => any} readCommand gives the player's command for this moment
   * @returns {number} how many frames were played
   */
  tick(now, readCommand) {
    if (!this.started || this.over) return 0;
    this.ping(now);
    const target = Math.floor(this.matchFrame(now));
    if (!Number.isFinite(target)) return 0;
    if (target - this.session.frame > CATCH_UP && now - this.resyncAt > 1500) {          // far behind (a page that took long to load, a stalled tab): take the server's game as it is now instead of playing years of it at speed
      this.resyncAt = now;
      this.send({ t: 'resync' });
    }
    if (target - this.session.frame > CATCH_UP) return 0;
    let played = 0;
    while (this.session.frame < target && played < 5) {
      const cmd = this.game.normalize(readCommand());
      const frame = this.session.addLocalInput(cmd);
      const encoded = this.game.encode(cmd);
      if (this.redundant()) {                                         // by datagram: the last few commands go in each one, so that a datagram lost is made up for by the next
        this.recentCommands.push([frame, encoded]);
        if (this.recentCommands.length > 3) this.recentCommands.shift();
        this.sendFast({ t: 'inr', cs: this.recentCommands });
      } else this.send({ t: 'in', f: frame, c: encoded });
      if (!this.session.advance()) break;                                                       // (waiting: the command is given again next time, for the same frame: the session does not move on)
      played++; this.stats.frames++;
      this.#deliver();
    }
    if (played === 0) this.#deliver();
    return played;
  }

  /** Hand the effects of frames played for the first time to whoever is listening (frames played again after a correction are not shown twice). */
  #deliver() {
    for (let f = this.delivered + 1; f < this.session.frame; f++) {
      const events = this.frameEvents.get(f);
      this.delivered = f;
      if (events?.length) this.onEvents(events, f);
      this.frameEvents.delete(f - 120);
    }
  }
}
