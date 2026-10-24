// Host side of the process sandbox (layer 3 of docs/SECURITY.md). Node only.
import { fork } from 'node:child_process';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const SRC_DIR = dirname(fileURLToPath(import.meta.url));
const RUNTIME = fileURLToPath(new URL('./sandbox-runtime.js', import.meta.url));

/**
 * @typedef {Object} SandboxLimits
 * @property {number} [tickBudgetMs] CPU budget per call, enforced inside the child by vm timeout.
 * @property {number} [loadBudgetMs] CPU budget for loading the script.
 * @property {number} [memoryMb] V8 old-space limit for the child (it is killed when exceeded).
 * @property {number} [hardTimeoutMs] If the child does not answer a call within this long, it is killed (watchdog).
 * @property {number} [maxResultBytes]
 */

/**
 * One mod, in its own confined process. Started with:
 *  --permission (no filesystem except reading the engine's own sandbox files, no child processes, no workers),
 *  --max-old-space-size (a runaway allocation kills the child, not the server),
 *  --disallow-code-generation-from-strings (even the child's own realm cannot eval),
 *  a scrubbed environment, no stdio, and below-normal OS priority.
 * It does NOT block the network (Node 24's permission model does not cover it): see SECURITY.md.
 */
export class ModSandbox {
  /**
   * @param {object} o
   * @param {string} o.id
   * @param {string} o.source The mod's JavaScript.
   * @param {SandboxLimits} [o.limits]
   * @param {boolean} [o.selftest] Enable diagnostic messages in the runtime (tests only).
   */
  constructor({ id, source, limits = {}, selftest = false }) {
    this.id = id;
    this.source = source;
    this.limits = {
      tickBudgetMs: 2, loadBudgetMs: 250, memoryMb: 48, maxResultBytes: 64 * 1024, ...limits,
    };
    this.limits.hardTimeoutMs ??= Math.max(250, this.limits.tickBudgetMs * 50);
    this.selftest = selftest;
    /** @type {'new' | 'ready' | 'dead'} */
    this.state = 'new';
    this.child = null;
    this.pid = 0;
    this.nextId = 1;
    this.pending = new Map();
    this.stopping = false;
    this.exitInfo = null;
    this.hooks = [];
  }

  get busy() { return this.pending.size > 0; }

  /** Start the child and load the mod. Resolves `{ok, hooks}` or `{ok: false, kind, error}`. */
  async start() {
    const execArgv = [
      '--permission', `--allow-fs-read=${SRC_DIR}`,
      `--max-old-space-size=${Math.max(16, Math.floor(this.limits.memoryMb))}`,
      '--disallow-code-generation-from-strings',
    ];
    const args = this.selftest ? ['--selftest'] : [];
    const child = fork(RUNTIME, args, { execArgv, env: {}, stdio: ['ignore', 'ignore', 'ignore', 'ipc'], windowsHide: true, serialization: 'json' });
    this.child = child;
    // A forgotten sandbox must never keep the host process alive (the child exits when the channel closes).
    child.unref();
    child.channel?.unref?.();
    child.on('message', (m) => this.#onMessage(m));
    child.on('exit', (code, signal) => this.#onExit(code, signal));
    child.on('error', (e) => this.#onExit(-1, String(e.message)));

    const ready = await this.#waitFor('ready', 5000);
    if (!ready) return { ok: false, kind: 'crash', error: this.exitInfo ? `sandbox process exited: ${this.exitInfo}` : 'sandbox process did not start' };
    this.pid = child.pid;
    try { os.setPriority(child.pid, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch { /* not fatal */ }
    this.state = 'ready';
    const loaded = await this.#request({ t: 'load', source: this.source, filename: `${this.id}.js`, loadBudgetMs: this.limits.loadBudgetMs, budgetMs: this.limits.tickBudgetMs, maxResultBytes: this.limits.maxResultBytes }, 'loaded', 5000);
    if (!loaded.ok) { this.kill(); return loaded; }
    this.hooks = loaded.hooks;
    return loaded;
  }

  /**
   * Call a hook. Resolves with the same result shapes as SandboxCore plus `kind: 'crash' | 'watchdog'`.
   * @param {string} hook
   * @param {any} arg
   * @param {number} [budgetMs]
   */
  call(hook, arg, budgetMs = this.limits.tickBudgetMs) {
    if (this.state !== 'ready') return Promise.resolve({ ok: false, kind: 'crash', error: 'sandbox is not running', ms: 0 });
    return this.#request({ t: 'call', hook, arg, budgetMs }, 'result', this.limits.hardTimeoutMs, true);
  }

  /** Diagnostics from inside the confined process (tests only: requires `selftest`). */
  probe() { return this.#request({ t: 'probe' }, 'probed', 5000); }
  /** Block the child's event loop outside the vm (tests only), to exercise the watchdog. */
  hang() { try { this.child.send({ t: 'hang' }); } catch { /* gone */ } }

  #waitFor(type, ms) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => { this.waiters?.delete(type); resolve(false); }, ms);
      (this.waiters ??= new Map()).set(type, () => { clearTimeout(timer); resolve(true); });
      if (this.state === 'dead') { clearTimeout(timer); resolve(false); }
    });
  }

  #request(message, replyType, timeoutMs, watchdog = false) {
    return new Promise((resolve) => {
      const id = this.nextId++;
      const timer = setTimeout(() => {
        if (!this.pending.delete(id)) return;
        if (watchdog) this.kill(`no answer within ${timeoutMs} ms`);
        resolve({ ok: false, kind: watchdog ? 'watchdog' : 'crash', error: `no answer within ${timeoutMs} ms`, ms: timeoutMs });
      }, timeoutMs);
      this.pending.set(id, { resolve, timer, replyType });
      try { this.child.send({ ...message, id }); } catch (e) {
        clearTimeout(timer); this.pending.delete(id);
        resolve({ ok: false, kind: 'crash', error: `could not reach the sandbox: ${e.message}`, ms: 0 });
      }
    });
  }

  #onMessage(m) {
    if (m.t === 'ready') { this.waiters?.get('ready')?.(); return; }
    const entry = this.pending.get(m.id);
    if (!entry || entry.replyType !== m.t) return;
    clearTimeout(entry.timer);
    this.pending.delete(m.id);
    entry.resolve(m.result);
  }

  #onExit(code, signal) {
    this.exitInfo ??= `code ${code}${signal ? `, ${signal}` : ''}`;
    this.#markDead(`sandbox process exited (${this.exitInfo})`);
  }

  /** Mark dead exactly once and fail every call still waiting. */
  #markDead(reason) {
    if (this.state === 'dead') return;
    this.state = 'dead';
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.resolve({ ok: false, kind: 'crash', error: reason, ms: 0 });
    }
    this.pending.clear();
    this.waiters?.get('ready')?.(); // let start() fail fast
  }

  /** Terminate the child immediately. The sandbox is dead as soon as this returns. */
  kill(reason = 'killed') {
    this.stopping = true;
    this.exitInfo ??= reason;
    this.#markDead(`sandbox killed (${reason})`);
    try { this.child?.kill('SIGKILL'); } catch { /* already gone */ }
  }

  /** Ask the child to exit, then make sure it did. */
  async stop() {
    if (this.state === 'dead') return;
    this.stopping = true;
    try { this.child.send({ t: 'exit' }); } catch { /* gone */ }
    await new Promise((resolve) => {
      const t = setTimeout(() => { this.kill(); resolve(); }, 500);
      this.child.once('exit', () => { clearTimeout(t); resolve(); });
    });
  }
}
