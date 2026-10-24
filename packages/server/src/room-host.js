import { Worker } from 'node:worker_threads';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

/**
 * The gateway-side handle on one room. Three implementations share this interface so a game can choose
 * isolation per deployment without changing room code:
 *
 *  - `ProcessRoom`: the room runs in its own OS process. Strongest containment: a crash, a runaway allocation
 *    (per-room heap cap), a native fault or a hang kills only that process, and the OS can limit it further.
 *  - `WorkerRoom`: the room runs in its own worker thread. Nothing is shared; a slow or crashing room cannot
 *    stall or take down the gateway or other rooms, but a native crash or out-of-memory still takes the whole process.
 *  - `InlineRoom`: the room runs in this thread (cheapest, no message passing; one room can stall the others).
 *
 * A room module exports `createRoom(options)` returning `{ attach(transport), close?(), stats?(), control?(data) }`.
 *
 * @typedef {Object} RoomHandle
 * @property {string} name
 * @property {'process' | 'worker' | 'inline'} mode
 * @property {Promise<void>} ready Resolves when the room can accept players.
 * @property {number} players Connected players.
 * @property {(conn: import('../../transport/src/index.js').Transport) => void} join
 * @property {(data: any) => void} control Send a control message to the room module (`room.control`).
 * @property {() => any} stats Latest statistics reported by the room.
 * @property {() => Promise<void>} stop
 * @property {((reason: string) => void) | null} onExit Called once if the room ends without `stop()` (crash).
 */

/**
 * Shared gateway-side logic for rooms that live behind a message channel (worker thread or child process):
 * client proxying, start timeout, crash handling and shutdown. Subclasses supply the channel.
 * @implements {RoomHandle}
 */
class ChannelRoom {
  constructor({ name, mode, startTimeoutMs = 15_000, stopTimeoutMs = 3000 }) {
    this.stopTimeoutMs = stopTimeoutMs;
    this.name = name;
    this.mode = mode;
    this.onExit = null;
    this.exited = false;
    this.stopping = false;
    this.conns = new Map();
    this.nextId = 1;
    this.lastStats = {};
    this.lastStatsAt = 0;
    this.fatalText = '';
    this.ready = new Promise((resolve, reject) => {
      const timer = setTimeout(() => { reject(new Error(`room "${name}" did not start within ${startTimeoutMs} ms`)); this._forceKill(); }, startTimeoutMs);
      this.settle = { // the start timer is not unref'd: until the room is ready, awaiting `ready` keeps the program alive
        resolve: () => { clearTimeout(timer); resolve(); }, reject: (e) => { clearTimeout(timer); reject(e); } };
    });
    this.ready.catch(() => {}); // callers observe it via join/ensure; avoid an unhandled rejection if nobody awaits
  }

  get players() { return this.conns.size; }
  stats() { return this.lastStats; }

  /** Subclass: deliver a message to the room (optionally transferring buffers). */
  _post() { throw new Error('not implemented'); }
  /** Subclass: end the room's thread or process immediately. */
  _forceKill() { throw new Error('not implemented'); }
  /** Subclass: make sure the room keeps the program alive until it has ended. */
  _holdOpen() {}
  /** Subclass: resolve when the room's thread or process has ended. */
  _whenGone() { throw new Error('not implemented'); }

  _fromRoom(m) {
    switch (m.t) {
      case 'ready': this.settle.resolve(); break;
      case 'fatal': this.fatalText = String(m.error).split('\n')[0]; this.settle.reject(new Error(`room "${this.name}" failed to start: ${m.error}`)); break;
      case 'stats': this.lastStats = m.stats; this.lastStatsAt = Date.now(); break;
      case 'send': this.conns.get(m.id)?.send(new Uint8Array(m.data), m.ch); break;
      case 'close': {
        const conn = this.conns.get(m.id);
        this.conns.delete(m.id);
        conn?.close(m.reason);
        break;
      }
      default: break;
    }
  }

  /** The room is gone. Disconnect everyone it was serving (with a 1011 "internal error" close code). */
  _ended(reason) {
    if (this.exited) return;
    this.exited = true;
    const why = this.stopping || !this.fatalText ? reason : `${reason}: ${this.fatalText}`;
    this.settle.reject(new Error(why));
    for (const conn of [...this.conns.values()]) conn.close(why, 1011);
    this.conns.clear();
    if (!this.stopping) this.onExit?.(why);
  }

  /** @param {import('../../transport/src/index.js').Transport} conn */
  join(conn) {
    if (this.exited) { conn.close('room is not running', 1011); return; }
    const id = this.nextId++;
    this.conns.set(id, conn);
    this._post({ t: 'open', id });
    conn.onMessage = (bytes, channel) => {
      const copy = new Uint8Array(bytes); // a real copy: Buffer#slice would only be a view of shared pool memory
      this._post({ t: 'msg', id, ch: channel, data: copy }, [copy.buffer]);
    };
    const previous = conn.onClose;
    conn.onClose = (reason) => {
      if (this.conns.delete(id) && !this.exited) this._post({ t: 'close', id, reason });
      previous?.(reason);
    };
  }

  control(data) { if (!this.exited) this._post({ t: 'control', data }); }

  async stop() {
    if (this.exited) return;
    this.stopping = true;
    this._holdOpen(); // while shutting down, the program must wait for the room to finish
    this._post({ t: 'stop' });
    let timer;
    await Promise.race([this._whenGone(), new Promise((resolve) => { timer = setTimeout(resolve, this.stopTimeoutMs); })]);
    clearTimeout(timer);
    if (!this.exited) { this._forceKill(); await this._whenGone(); this._ended('room terminated'); }
  }
}

/** A room in its own worker thread. */
export class WorkerRoom extends ChannelRoom {
  /**
   * @param {object} o
   * @param {string} o.name
   * @param {string | URL} o.module Room module URL (must be importable from the worker).
   * @param {object} [o.options] Passed to `createRoom` (structured-cloneable).
   * @param {number} [o.startTimeoutMs]
   * @param {number} [o.stopTimeoutMs] How long `stop()` waits for a clean exit before terminating (default 3000).
   */
  constructor({ name, module, options = {}, startTimeoutMs, stopTimeoutMs }) {
    super({ name, mode: 'worker', startTimeoutMs, stopTimeoutMs });
    this.worker = new Worker(new URL('./room-worker.js', import.meta.url), { workerData: { module: String(module), options, name } });
    this.gone = new Promise((resolve) => this.worker.once('exit', resolve));
    this.worker.on('message', (m) => this._fromRoom(m));
    this.worker.on('error', (e) => this._ended(`room crashed: ${e && e.message ? e.message : e}`));
    this.worker.on('exit', (code) => this._ended(this.stopping ? 'room closed' : `room exited (code ${code})`));
  }

  _post(message, transfer) { this.worker.postMessage(message, transfer); }
  _forceKill() { this.worker.terminate(); }
  _whenGone() { return this.gone; }
}

/**
 * A room in its own OS process, connected to the gateway by an IPC channel.
 *
 * Containment beyond a worker thread: a heap cap (`memoryMb`) so a leaking or hostile room dies alone (V8 aborts the
 * process, the gateway sees the exit and reports it), a scrubbed environment, optional Node permission-model
 * confinement (`confine`), and lower scheduling priority if asked. If the gateway dies, rooms exit with it.
 */
export class ProcessRoom extends ChannelRoom {
  /**
   * @param {object} o
   * @param {string} o.name
   * @param {string | URL} o.module Room module URL.
   * @param {object} [o.options] Passed to `createRoom` (must be JSON-serialisable or structured-cloneable).
   * @param {number} [o.startTimeoutMs]
   * @param {number} [o.stopTimeoutMs] How long `stop()` waits for a clean exit before killing the process (default 3000).
   * @param {number} [o.memoryMb] V8 old-space heap cap for the room process (default: none).
   * @param {Record<string, string>} [o.env] Environment for the room process (default: none; the OS adds its own standard variables on Windows).
   * @param {{fsRead?: string[], fsWrite?: string[], childProcess?: boolean} | null} [o.confine] Run under Node's
   *   permission model: no file access except the listed paths, no child processes unless allowed. The room's own
   *   source files must be readable, so list the directory your room module and its imports live in. Does not
   *   restrict the network (Node's model does not cover it); for that use a container.
   * @param {number} [o.priority] An `os.constants.priority` value (e.g. `os.constants.priority.PRIORITY_BELOW_NORMAL`).
   * @param {string[]} [o.execArgv] Extra node flags.
   * @param {boolean} [o.inheritStderr] Show the room's stderr (default true, so crashes are visible).
   */
  constructor({ name, module, options = {}, startTimeoutMs, stopTimeoutMs, memoryMb, env = {}, confine = null, priority, execArgv = [], inheritStderr = true }) {
    super({ name, mode: 'process', startTimeoutMs, stopTimeoutMs });
    const args = [...execArgv];
    if (memoryMb) args.push(`--max-old-space-size=${Math.floor(memoryMb)}`);
    if (confine) {
      args.push('--permission');
      const own = fileURLToPath(new URL('../../', import.meta.url)); // the engine packages the room runtime imports (sibling packages, no game data)
      const reads = new Set([own, ...(confine.fsRead ?? [])]);
      for (const p of reads) args.push(`--allow-fs-read=${p}`);
      for (const p of confine.fsWrite ?? []) args.push(`--allow-fs-write=${p}`);
      if (confine.childProcess) args.push('--allow-child-process');
    }
    this.child = fork(fileURLToPath(new URL('./room-process.js', import.meta.url)), [], {
      execArgv: args, env, serialization: 'advanced', windowsHide: true,
      stdio: ['ignore', 'ignore', inheritStderr ? 'inherit' : 'ignore', 'ipc'],
    });
    // Once the room is ready it must not keep the gateway alive on its own (see _fromRoom); the child exits when the channel closes.
    this.pid = this.child.pid;
    if (priority !== undefined && this.pid) { try { os.setPriority(this.pid, priority); } catch { /* not fatal */ } }
    this.gone = new Promise((resolve) => this.child.once('exit', resolve));
    this.child.on('message', (m) => this._fromRoom(m));
    this.child.on('error', (e) => this._ended(`room process error: ${e && e.message ? e.message : e}`));
    this.child.on('exit', (code, signal) => this._ended(this.stopping ? 'room closed' : `room exited (${signal ? `signal ${signal}` : `code ${code}`})`));
    this.child.send({ t: 'init', module: String(module), options });
  }

  _fromRoom(m) {
    super._fromRoom(m);
    if (m.t === 'ready') { this.child.unref(); this.child.channel?.unref?.(); }
  }

  _post(message) {
    if (this.exited || !this.child.connected) return;
    try { this.child.send(message); } catch { /* the process is going away; its exit event cleans up */ }
  }
  _holdOpen() { this.child.ref(); this.child.channel?.ref?.(); }
  _forceKill() { try { this.child.kill('SIGKILL'); } catch { /* already gone */ } }
  _whenGone() { return this.gone; }
}

/** @implements {RoomHandle} */
export class InlineRoom {
  /** @param {{name: string, module: string | URL, options?: object}} o */
  constructor({ name, module, options = {} }) {
    this.name = name;
    this.mode = 'inline';
    this.onExit = null;
    this.count = 0;
    this.room = null;
    this.ready = (async () => {
      const mod = await import(String(module));
      this.room = await mod.createRoom(options);
    })();
    this.ready.catch(() => {});
  }

  get players() { return this.count; }
  stats() { return this.room?.stats?.() ?? {}; }

  join(conn) {
    this.count++;
    const previous = conn.onClose;
    conn.onClose = (reason) => { this.count--; previous?.(reason); };
    this.room.attach(conn);
  }

  control(data) { this.room?.control?.(data); }
  async stop() { await this.ready.catch(() => {}); await this.room?.close?.(); }
}
