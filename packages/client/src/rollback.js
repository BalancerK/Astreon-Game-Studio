// Rollback netcode for peer-to-peer or lockstep-style games (fighting games, small co-op): every player runs the whole game. Each frame it is simulated at once with the inputs that are
// known and a GUESS for the inputs of players that have not arrived yet (the same as their last input is the usual guess). When a real input arrives that was guessed wrong, the session
// goes back to the state before that frame, and simulates forward again with the truth, all within one `advance`. If every machine ends up with the same inputs for the same frames, they
// all end up with the same state, so only inputs are sent.
//
// It needs two things from the game: a state that is plain data (so it can be copied), and a step function that is DETERMINISTIC (see `@engine/math`: no Math.random, no clock, no
// iteration order that depends on the machine). A `checksum` of the state lets players find out the moment they disagree.
//
//   const session = new RollbackSession({ players: 2, local: 0, init: () => ({ x: [0, 100], hp: [10, 10] }), step: (state, inputs, frame) => { ... } });
//   // every tick:
//   const frame = session.addLocalInput(readKeys());           // which frame this input is for: send { frame, input } to the other player
//   send({ frame, input });
//   for (const m of received) session.addRemoteInput(m.player, m.frame, m.input);
//   session.advance();                                         // false when it has to wait (too far ahead of the other player)
//   draw(session.state);

/**
 * @typedef {Object} RollbackOptions
 * @property {number} players How many players.
 * @property {number} local Which player is on this machine (0 to players - 1).
 * @property {() => any} init Makes the state at frame 0.
 * @property {(state: any, inputs: any[], frame: number) => void} step Simulates one frame, changing the state in place. `inputs[p]` is player p's input for this frame.
 * @property {(state: any) => any} [clone] Copies a state. Default `structuredClone` (so the state must be plain data).
 * @property {number} [maxRollback] The most frames it may run ahead of what is confirmed (and so the most it ever re-simulates). Default 8.
 * @property {number} [inputDelay] Local inputs take effect this many frames late, which gives the other player time to receive them and so means fewer rollbacks. Default 0.
 * @property {any} [blank] The input that means "nothing pressed", used for the first frames and before anything is known. Default `null`.
 * @property {(last: any) => any} [guess] Guesses an input that has not arrived from the last one that did. Default: the same again.
 * @property {(state: any) => number} [checksum] A number that says what a state is, to find players that disagree.
 */

/**
 * Rollback netcode: every player runs the whole game, unknown remote inputs are guessed, and when a real input differs from its guess the session goes back and simulates forward
 * again within one `advance()`. Only inputs are sent; checksums find the moment two machines stop agreeing.
 */
export class RollbackSession {
  #confirmed = 0;

  /** @param {RollbackOptions} o */
  constructor(o) {
    const { players, local, init, step } = o;
    if (!(players >= 1) || !(local >= 0 && local < players)) throw new Error('RollbackSession needs players and which player is local.');
    if (typeof init !== 'function' || typeof step !== 'function') throw new Error('RollbackSession needs init (makes the first state) and step (simulates one frame).');
    this.players = players;
    this.local = local;
    this.stepFn = step;
    this.clone = o.clone ?? ((s) => structuredClone(s));
    this.maxRollback = o.maxRollback ?? 8;
    this.inputDelay = o.inputDelay ?? 0;
    this.blank = o.blank ?? null;
    this.guess = o.guess ?? ((last) => last);
    this.checksumFn = o.checksum ?? null;
    this.state = init();
    this.frame = 0;                                                     // frames simulated: `state` is the state before frame `frame`
    this.snapshots = new Map([[0, this.clone(this.state)]]);            // the state before each recent frame
    this.known = Array.from({ length: players }, () => new Map());      // the real inputs, by frame
    this.used = Array.from({ length: players }, () => new Map());       // the inputs each frame was actually simulated with
    this.nextLocal = 0;
    this.rollbackTo = null;
    this.desync = null;
    this.stats = { rollbacks: 0, resimulated: 0, stalls: 0, maxRollback: 0 };
    for (let f = 0; f < this.inputDelay; f++) for (let p = 0; p < players; p++) this.known[p].set(f, this.blank);   // nobody can have pressed anything yet
  }

  /**
   * The number of frames for which every player's real input is known. The state before this frame is final and will never change.
   * @returns {number}
   */
  get confirmedFrame() {
    while (this.known.every((m) => m.has(this.#confirmed))) this.#confirmed++;          // a running count: old inputs are forgotten, so it never starts again from 0
    return this.#confirmed;
  }

  /**
   * Give this machine's input for now. It will take effect `inputDelay` frames from the current one. Send the returned frame and the input to the other players.
   * @param {any} input
   * @returns {number} The frame the input is for.
   */
  addLocalInput(input) {
    const frame = Math.max(this.nextLocal, this.frame + this.inputDelay);
    this.known[this.local].set(frame, input);
    this.nextLocal = frame + 1;
    return frame;
  }

  /**
   * Give another player's real input, when it arrives (late, early or twice is fine). If it is not what was guessed, the frames from there are simulated again at the next `advance`.
   * @param {number} player
   * @param {number} frame
   * @param {any} input
   */
  addRemoteInput(player, frame, input) {
    if (player === this.local || player < 0 || player >= this.players || this.known[player].has(frame)) return;
    this.known[player].set(frame, input);
    if (frame < this.frame) {
      const guessed = this.used[player].get(frame);
      if (JSON.stringify(guessed) !== JSON.stringify(input) && (this.rollbackTo === null || frame < this.rollbackTo)) this.rollbackTo = frame;
    }
  }

  #inputsFor(frame) {
    return Array.from({ length: this.players }, (_, p) => {
      if (this.known[p].has(frame)) return this.known[p].get(frame);
      let last = this.blank;
      for (let f = frame - 1; f >= Math.max(0, frame - 64); f--) if (this.known[p].has(f)) { last = this.known[p].get(f); break; }
      return this.guess(last);
    });
  }

  #simulate(frame) {
    this.snapshots.set(frame, this.clone(this.state));
    const inputs = this.#inputsFor(frame);
    inputs.forEach((value, p) => this.used[p].set(frame, value));
    this.stepFn(this.state, inputs, frame);
  }

  /**
   * Simulate one more frame (after going back and correcting any frames whose guessed inputs turned out wrong). Call it once per tick, after giving the inputs.
   * @returns {boolean} false if it could not: it is `maxRollback` frames ahead of what is confirmed (wait for the other player), or this machine has not given its input for this frame yet.
   */
  advance() {
    if (this.frame - this.confirmedFrame >= this.maxRollback) { this.stats.stalls++; return false; }
    if (!this.known[this.local].has(this.frame)) return false;
    this.#resolve();
    this.#simulate(this.frame);
    this.frame++;
    this.#forget();
    return true;
  }

  /** If a real input turned out different from the guess, go back to the state before that frame and simulate forward again with the truth, up to the present. */
  #resolve() {
    if (this.rollbackTo === null) return;
    const from = this.rollbackTo;
    this.rollbackTo = null;
    this.state = this.clone(this.snapshots.get(from));
    const target = this.frame;
    this.stats.rollbacks++;
    this.stats.resimulated += target - from;
    this.stats.maxRollback = Math.max(this.stats.maxRollback, target - from);
    for (let f = from; f < target; f++) this.#simulate(f);
  }

  /** The state before a frame, if it is still kept (the present one counts). */
  #stateAt(frame) {
    return this.snapshots.get(frame) ?? (frame === this.frame ? this.state : undefined);
  }

  #forget() {
    const keep = Math.min(this.confirmedFrame, this.frame) - 1;          // frames before the confirmed one can never be needed again
    for (const f of this.snapshots.keys()) if (f < keep) this.snapshots.delete(f);
    for (const maps of [...this.known, ...this.used]) for (const f of maps.keys()) if (f < keep - 64) maps.delete(f);
  }

  /**
   * The newest state that can no longer change, and its checksum if the session has one. Players compare these to find out whether they still agree.
   * @returns {{frame: number, state: any, checksum: number | null}}
   */
  confirmed() {
    this.#resolve();                                                      // inputs that arrived since the last advance may change the past
    const frame = Math.min(this.confirmedFrame, this.frame);
    const state = this.#stateAt(frame);
    return { frame, state, checksum: this.checksumFn ? this.checksumFn(state) : null };
  }

  /**
   * Compare what another player says the state was at a confirmed frame with ours. When it differs the session is `desync`ed: the game is no longer the same on both machines.
   * @param {number} frame
   * @param {number} theirChecksum
   * @returns {boolean} true when they agree (or the frame is too old to check)
   */
  report(frame, theirChecksum) {
    this.#resolve();
    const snap = this.#stateAt(frame);
    if (!this.checksumFn || !snap || frame > this.confirmedFrame) return true;
    const ours = this.checksumFn(snap);
    if (ours === theirChecksum) return true;
    this.desync ??= { frame, ours, theirs: theirChecksum };
    return false;
  }
}
