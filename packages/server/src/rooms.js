import { ProcessRoom, WorkerRoom, InlineRoom } from './room-host.js';

/**
 * Creates, finds and retires rooms, and routes incoming connections to them.
 *
 * - Rooms are created on demand (`autoCreate`) up to `maxRooms`, each with at most `maxPlayers`.
 * - A connection that arrives while its room is still starting is held (its early packets are buffered
 *   and replayed) until the room is ready.
 * - Empty rooms are closed after `idleCloseMs`.
 * - A room that crashes disconnects only its own players; the next join to that name starts a fresh room.
 */
export class RoomManager {
  /**
   * @param {object} o
   * @param {string | URL} o.module Room module: exports `createRoom(options)`.
   * @param {'process' | 'worker' | 'inline'} [o.mode] Where rooms run: own OS process (strongest containment), own worker thread, or this thread.
   * @param {object} [o.hostOptions] Options for the room host itself (process mode: `memoryMb`, `env`, `confine`, `priority`, `startTimeoutMs`, ...). Not passed to `createRoom`.
   * @param {object} [o.defaultOptions] Options for every room (can be overridden per room).
   * @param {number} [o.maxRooms]
   * @param {number} [o.maxPlayers] Per room.
   * @param {boolean} [o.autoCreate] Create a room when someone asks for an unknown name.
   * @param {number} [o.idleCloseMs] Close a room this long after its last player left (0 = never).
   * @param {(message: string) => void} [o.log]
   */
  constructor({ module, mode = 'worker', hostOptions = {}, defaultOptions = {}, maxRooms = 16, maxPlayers = 32, autoCreate = true, idleCloseMs = 60_000, log = () => {} }) {
    this.module = module;
    if (!['process', 'worker', 'inline'].includes(mode)) throw new Error(`unknown room mode "${mode}"`);
    this.mode = mode;
    this.hostOptions = hostOptions;
    this.defaultOptions = defaultOptions;
    this.maxRooms = maxRooms;
    this.maxPlayers = maxPlayers;
    this.autoCreate = autoCreate;
    this.idleCloseMs = idleCloseMs;
    this.log = log;
    /** @type {Map<string, {handle: import('./room-host.js').RoomHandle, since: number, emptySince: number, options: object}>} */
    this.rooms = new Map();
    this.timer = idleCloseMs > 0 ? setInterval(() => this.#sweep(), Math.max(50, Math.min(1000, idleCloseMs / 2))) : null;
    this.timer?.unref();
    this.stats = { created: 0, crashed: 0, rejected: 0, joined: 0 };
  }

  /**
   * Make sure a room exists (creating it if allowed) and return its handle once it is ready.
   * @param {string} name
   * @param {object} [options] Per-room options (merged over the defaults) used only when creating.
   */
  async ensureRoom(name, options = {}) {
    let rec = this.rooms.get(name);
    if (!rec) {
      if (!this.autoCreate && !Object.keys(options).length) throw new Error('no such room');
      if (this.rooms.size >= this.maxRooms) throw new Error('server is full (too many rooms)');
      const merged = { ...this.defaultOptions, ...options };
      const Host = this.mode === 'inline' ? InlineRoom : this.mode === 'process' ? ProcessRoom : WorkerRoom;
      const handle = new Host({ name, module: this.module, options: { roomName: name, ...merged }, ...(this.mode === 'inline' ? {} : this.hostOptions) }); // (a room can tell which room it is)
      rec = { handle, since: Date.now(), emptySince: Date.now(), options: merged };
      this.rooms.set(name, rec);
      this.stats.created++;
      this.log(`room "${name}" starting (${this.mode})`);
      handle.onExit = (reason) => {
        if (this.rooms.get(name) === rec) this.rooms.delete(name);
        this.stats.crashed++;
        this.log(`room "${name}" ended: ${reason}`);
      };
    }
    try {
      await rec.handle.ready;
    } catch (e) {
      if (this.rooms.get(name) === rec) this.rooms.delete(name);
      throw e;
    }
    return rec.handle;
  }

  /**
   * Route a connection into a room. Rejections close the connection with an explanatory reason.
   * @param {string} name
   * @param {import('../../transport/src/index.js').Transport} conn
   * @param {object} [options] Used only if this creates the room.
   */
  async join(name, conn, options) {
    const early = [];
    let closed = false;
    conn.onMessage = (bytes, ch) => early.push([new Uint8Array(bytes), ch]); // clients talk straight away; keep it until the room is up
    const earlyClose = conn.onClose;
    conn.onClose = (r) => { closed = true; earlyClose?.(r); };
    let handle;
    try {
      handle = await this.ensureRoom(name, options);
    } catch (e) {
      this.stats.rejected++;
      conn.close(e.message, 1013);
      return;
    }
    if (closed) return;
    if (handle.players >= this.maxPlayers) {
      this.stats.rejected++;
      conn.close('room full', 1013);
      return;
    }
    const rec = this.rooms.get(name);
    if (rec) rec.emptySince = 0;
    conn.onClose = earlyClose ?? null;
    handle.join(conn);
    this.stats.joined++;
    for (const [bytes, ch] of early) conn.onMessage?.(bytes, ch);
  }

  /** Snapshot of every room, for a lobby page or monitoring. */
  list() {
    return [...this.rooms.entries()].map(([name, rec]) => ({
      name, mode: rec.handle.mode, players: rec.handle.players, maxPlayers: this.maxPlayers,
      uptimeMs: Date.now() - rec.since, pid: rec.handle.pid, ...rec.handle.stats(),
    }));
  }

  #sweep() {
    const now = Date.now();
    for (const [name, rec] of this.rooms) {
      if (rec.handle.players > 0) { rec.emptySince = 0; continue; }
      if (!rec.emptySince) rec.emptySince = now;
      if (now - rec.emptySince >= this.idleCloseMs) {
        this.rooms.delete(name);
        this.log(`room "${name}" closed after ${this.idleCloseMs} ms empty`);
        rec.handle.stop().catch(() => {});
      }
    }
  }

  async closeRoom(name) {
    const rec = this.rooms.get(name);
    if (!rec) return;
    this.rooms.delete(name);
    await rec.handle.stop();
  }

  async close() {
    if (this.timer) clearInterval(this.timer);
    const all = [...this.rooms.keys()];
    await Promise.all(all.map((n) => this.closeRoom(n)));
  }
}
