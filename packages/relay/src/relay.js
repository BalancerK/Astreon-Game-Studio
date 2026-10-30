// The server's side of one match in a game where every player's machine plays the whole game and the server has the last word on every player's command for every frame. Players send their commands for
// the frame they mean them for; the relay plays frame F only when F is `window` frames old (the caller decides when: see `stepWindow`), which gives late commands a moment to arrive. For each seat it
// uses the command that came (or, if none did, the one before it), asks the game what a computer-driven seat would do, lets the game play the frame, and hands back the list of commands it used: that
// list is what every player's machine plays too, so every machine has the same game. Pure: no network, no clock; whoever runs it says when to play.
//
//   const relay = new InputRelay({ seats, codec, think: (seat, frame) => bots[seat].think(world) });
//   relay.receive(seat, frame, encodedCommand);                              // a command from a player's machine
//   const { frame, inputs, events, changes } = relay.step((commands, changes) => game.step(commands, changes));
//   broadcast(frames.make(frame, inputs, { changes }));                       // see `createFrameLog`

/** The furthest ahead (frames) a player may send a command for. */
export const MAX_AHEAD = 90;

/**
 * @typedef {object} RelaySeat A seat: who or what plays it.
 * @property {'human' | 'bot'} kind @property {string} [pilot] the id of the person in it (none for a computer-driven seat) @property {number} [team] @property {string} [name]
 */

/**
 * @typedef {object} CommandCodec How a game's command is written for the wire.
 * @property {(raw?: any) => any} normalize makes a command that is certainly sound (no argument: "nothing pressed") @property {(command: any) => any} encode a command as plain data (JSON) @property {(encoded: any) => any} decode
 */

/** The server's side of one match: the commands of every seat for every frame, and the frames played from them (see the top of this file). */
export class InputRelay {
  /**
   * @param {object} o
   * @param {RelaySeat[]} o.seats the seats; the array is kept and changed as seats change hands
   * @param {CommandCodec} o.codec
   * @param {(seat: number, frame: number) => any} o.think the command (decoded) of a computer-driven seat for this frame
   * @param {(entries: Array<{seat: number, [k: string]: any}>) => void} [o.onChange] called with the changes of a frame as they are recorded, so the game's own copy can apply them at once (the players apply them at the same frame)
   * @param {{human?: (seat: number) => void, bot?: (seat: number, frame: number) => void}} [o.hooks] called when a person takes a seat (`human`) and when a computer takes it back (`bot`), so the game can drop or make the seat's mind
   * @param {number} [o.maxAhead]
   */
  constructor({ seats, codec, think, onChange = () => {}, hooks = {}, maxAhead = MAX_AHEAD }) {
    this.seats = seats; this.codec = codec; this.think = think; this.onChange = onChange; this.hooks = hooks; this.maxAhead = maxAhead;
    /** The next frame to play. */
    this.frame = 0;
    this.pending = seats.map(() => new Map());
    /** The newest frame a command was taken for, per seat; and how many arrived late (for a status page). */
    this.newest = seats.map(() => -1); this.lateCount = 0;
    this.last = seats.map(() => codec.normalize());
    /** Changes of who holds a seat (and anything else the game records with `record`), by the frame they take effect. The players' machines apply the same changes at the same frame. */
    this.seatChanges = new Map();
  }

  /** The seat a person is in, or -1. @param {string} pilot */
  seatOf(pilot) { return this.seats.findIndex((s) => s.pilot === pilot); }

  /**
   * A command from a player's machine for a frame. Too late (that frame is already played) it is used for the next frame instead, so that a slow connection delays what the player does and does not lose it
   * (unless it is older than one already taken); too far ahead, or for a seat that is not a person's, it is ignored.
   * @param {number} seat @param {any} encoded @param {number} frame @returns {boolean} whether it was kept
   */
  receive(seat, frame, encoded) {
    if (seat < 0 || seat >= this.seats.length || !Number.isInteger(frame) || frame > this.frame + this.maxAhead) return false;
    if (this.seats[seat].kind !== 'human') return false;
    let at = frame;
    if (frame < this.frame) {
      if (frame <= this.newest[seat]) return false;
      at = this.frame;
      this.lateCount++;
    }
    this.newest[seat] = Math.max(this.newest[seat], frame);
    this.pending[seat].set(at, this.codec.encode(this.codec.decode(encoded)));
    return true;
  }

  /** A person takes over a computer-driven seat from the next frame. @param {number} seat @param {string} pilot @param {string} name */
  seatHuman(seat, pilot, name) {
    const s = this.seats[seat];
    s.kind = 'human'; s.pilot = pilot; s.name = name;
    this.hooks.human?.(seat);
    this.pending[seat].clear(); this.newest[seat] = this.frame;
    this.record({ seat, human: true });
  }

  /** The person in a seat has gone: the computer takes it from the next frame. @param {number} seat */
  seatBot(seat) {
    const s = this.seats[seat];
    s.kind = 'bot'; s.pilot = undefined;
    this.hooks.bot?.(seat, this.frame);
    this.pending[seat].clear();
    this.record({ seat, human: false });
  }

  /**
   * Note a change that takes effect at the next frame to be played, on every machine at the same frame (it comes with that frame to the players): a seat changing hands, or anything else of the game's own
   * (a new build chosen during the round).
   * @param {{seat: number, [k: string]: any}} entry
   */
  record(entry) {
    const list = this.seatChanges.get(this.frame) ?? [];
    list.push(entry);
    this.seatChanges.set(this.frame, list);
    this.onChange(list);
  }

  /** The seats a person could take over: computer-driven ones, the weakest-placed first (a team's own before any other, when `team` is given). @param {number} [team] */
  freeSeats(team) {
    const out = this.seats.map((s, i) => ({ s, i })).filter(({ s }) => s.kind === 'bot');
    return out.filter(({ s }) => team === undefined || s.team === team).concat(team === undefined ? [] : out.filter(({ s }) => s.team !== team)).map(({ i }) => i);
  }

  /**
   * Play one frame. `play` is given the commands (decoded) of every seat and the changes that take effect at this frame, and plays the game; what it returns comes back as `events`.
   * @template T
   * @param {(commands: any[], changes: Array<{seat: number, [k: string]: any}>) => T} play
   * @returns {{frame: number, inputs: any[], events: T, changes: Array<{seat: number, [k: string]: any}>}} `inputs[i]` is the encoded command of seat i
   */
  step(play) {
    const frame = this.frame, commands = [], inputs = [];
    this.seats.forEach((s, i) => {
      let encoded;
      if (s.kind === 'human') encoded = this.pending[i].get(frame) ?? this.codec.encode(this.last[i]);
      else encoded = this.codec.encode(this.think(i, frame));
      this.pending[i].delete(frame);
      const cmd = this.codec.decode(encoded);
      this.last[i] = cmd;
      commands.push(cmd);
      inputs.push(encoded);
    });
    const changes = this.seatChanges.get(frame) ?? [];
    const events = play(commands, changes);
    this.frame++;
    for (const f of this.seatChanges.keys()) if (f < frame - 600) this.seatChanges.delete(f);
    return { frame, inputs, events, changes };
  }
}
