import { definePlugin, resolvePlugins, ENGINE_VERSION } from '../../core/src/index.js';
import { validateBundle, hashBundle, hashClientView, clientView } from './bundle.js';
import { verifySignature } from './signing.js';
import { validateCommand, mergeRuleSets } from './commands.js';
import { ModSandbox } from './sandbox.js';
import { SandboxCore } from './sandbox-core.js';

/** Same interface as ModSandbox but in this process, for tools and deterministic tests. NOT confined. */
export class InlineSandbox {
  constructor({ id, source, limits = {} }) {
    this.id = id;
    this.limits = { tickBudgetMs: 2, loadBudgetMs: 250, maxResultBytes: 64 * 1024, ...limits };
    this.core = new SandboxCore({ source, filename: `${id}.js`, loadBudgetMs: this.limits.loadBudgetMs, defaultBudgetMs: this.limits.tickBudgetMs, maxResultBytes: this.limits.maxResultBytes });
    this.state = 'new';
    this.hooks = [];
    this.busy = false;
  }

  async start() { const r = this.core.load(); if (r.ok) { this.state = 'ready'; this.hooks = r.hooks; } return r; }
  async call(hook, arg, budgetMs) { return this.core.call(hook, arg, budgetMs ?? this.limits.tickBudgetMs); }
  async stop() { this.state = 'dead'; }
  kill() { this.state = 'dead'; }
}

const DEFAULT_POLICY = Object.freeze({
  allowScript: true,
  /** 'none' | 'script' | 'all': which mods must carry a valid signature from a trusted key. */
  requireSignature: 'none',
  trustedKeys: [],
  /** If set, script mods must have one of these bundle hashes (pinning). */
  allowHashes: null,
  maxMods: 16,
  maxStrikes: 5,
  strikeWindowMs: 60_000,
  maxRestarts: 3,
  commandsPerCall: 32,
  /** `loadBudgetMs` is a server setting only (mods cannot ask for more): the wall-clock allowance for a cold start. */
  defaults: { tickBudgetMs: 2, memoryMb: 48, tickEvery: 6, loadBudgetMs: 250 },
  caps: { tickBudgetMs: 5, memoryMb: 96, tickEveryMin: 1, tickEveryMax: 600 },
});

/**
 * Loads mods, runs script mods in confined sandboxes, and turns what they return into validated commands.
 *
 * The game integrates in four steps: `add` bundles, `start()`, `emitFrame(frame)` on a timer (non-blocking), and
 * `drainCommands()` each tick to apply what mods asked for. Slow or misbehaving mods are skipped, struck, and
 * eventually disabled; none of this can block the caller.
 */
export class ModManager {
  /**
   * @param {object} o
   * @param {import('./commands.js').CommandSpecs} o.commands Operations mods may request.
   * @param {Partial<typeof DEFAULT_POLICY>} [o.policy]
   * @param {'process' | 'inline'} [o.mode] 'process' = confined child process per mod (use this for anything untrusted).
   * @param {(message: string) => void} [o.log]
   * @param {() => number} [o.now]
   * @param {boolean} [o.selftest] Enable runtime diagnostics (tests only).
   */
  constructor({ commands, policy = {}, mode = 'process', log = () => {}, now = () => Date.now(), selftest = false }) {
    this.commands = commands;
    this.policy = { ...DEFAULT_POLICY, ...policy, defaults: { ...DEFAULT_POLICY.defaults, ...policy.defaults }, caps: { ...DEFAULT_POLICY.caps, ...policy.caps } };
    this.mode = mode;
    this.log = log;
    this.now = now;
    this.selftest = selftest;
    /** @type {Map<string, any>} id -> record */
    this.mods = new Map();
    this.order = [];
    this.queue = [];
    this.frameCounter = 0;
    /** Called when a mod is disabled: (record, reason). */
    this.onDisabled = null;
  }

  /**
   * Register a bundle. Returns problems instead of throwing.
   * @param {import('./bundle.js').Bundle} bundle
   * @returns {{ok: boolean, errors: string[], id?: string}}
   */
  add(bundle) {
    const v = validateBundle(bundle);
    if (!v.ok) return { ok: false, errors: v.errors };
    const id = bundle.manifest.id;
    if (this.mods.has(id)) return { ok: false, errors: [`a mod with id "${id}" is already loaded`] };
    if (this.mods.size >= this.policy.maxMods) return { ok: false, errors: [`too many mods (limit ${this.policy.maxMods})`] };
    const hash = hashBundle(bundle);
    const reason = this.#policyRejection(bundle, hash);
    if (reason) return { ok: false, errors: [reason], id };
    const limits = this.#limitsFor(bundle.manifest);
    this.mods.set(id, {
      id, bundle, manifest: bundle.manifest, hash, clientHash: hashClientView(bundle), limits,
      status: 'pending', reason: '', strikes: [], restarts: 0, sandbox: null, busy: false, hooks: [], savedState: null,
      stats: { calls: 0, totalMs: 0, maxMs: 0, timeouts: 0, errors: 0, crashes: 0, skipped: 0, accepted: 0, rejected: 0, restarts: 0 },
    });
    return { ok: true, errors: [], id };
  }

  #policyRejection(bundle, hash) {
    const p = this.policy;
    const isScript = bundle.manifest.tier === 'script';
    if (isScript && !p.allowScript) return 'script mods are disabled by server policy';
    const needsSig = p.requireSignature === 'all' || (p.requireSignature === 'script' && isScript);
    if (needsSig) {
      const sig = bundle.signature;
      if (!sig || !p.trustedKeys.includes(sig.key)) return 'a signature from a trusted key is required';
      if (!verifySignature(hash, sig)) return 'signature does not match the bundle contents';
    }
    if (isScript && p.allowHashes && !p.allowHashes.includes(hash)) return 'bundle hash is not on the server allow list';
    return null;
  }

  #limitsFor(manifest) {
    const { defaults, caps } = this.policy;
    const asked = manifest.limits ?? {};
    const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
    return {
      tickBudgetMs: clamp(asked.tickBudgetMs ?? defaults.tickBudgetMs, 0.5, caps.tickBudgetMs),
      memoryMb: clamp(asked.memoryMb ?? defaults.memoryMb, 16, caps.memoryMb),
      tickEvery: clamp(Math.round(asked.tickEvery ?? defaults.tickEvery), caps.tickEveryMin, caps.tickEveryMax),
    };
  }

  /** Resolve dependency order, then start sandboxes for script mods. Mods with problems are rejected individually. */
  async start() {
    const plugins = [...this.mods.values()].map((r) => definePlugin({
      id: r.id, version: r.manifest.version, engine: r.manifest.engine ?? '*', dependencies: r.manifest.dependencies ?? {}, setup() {},
    }));
    // Remove mods whose dependencies cannot be satisfied one at a time, so one bad mod does not block the rest.
    let usable = plugins;
    for (;;) {
      try { this.order = resolvePlugins(usable, ENGINE_VERSION).map((p) => p.id); break; } catch (e) {
        // Errors read `plugin "<subject>" needs ...` (the subject is the FIRST quoted id; later ids are what it
        // needs and must not be blamed) or, for a cycle, `plugin dependency cycle: a -> b -> a` (reject every member).
        const subject = /^plugin "([^"]+)"/.exec(e.message)?.[1];
        const culprits = subject ? [subject] : [...new Set((e.message.split(': ')[1] ?? '').split(' -> '))].filter((id) => this.mods.has(id));
        if (culprits.length === 0) culprits.push(usable[0].id); // unknown error shape: make progress rather than loop forever
        for (const id of culprits) {
          const rec = this.mods.get(id);
          rec.status = 'rejected'; rec.reason = e.message;
          this.log(`mod "${id}" rejected: ${e.message}`);
        }
        usable = usable.filter((p) => !culprits.includes(p.id));
        if (usable.length === 0) { this.order = []; break; }
      }
    }
    await Promise.all(this.order.map((id) => this.#startMod(this.mods.get(id))));
    return this.list();
  }

  async #startMod(rec) {
    if (rec.manifest.tier === 'data') { rec.status = 'data'; return; }
    const source = rec.bundle.files[rec.manifest.entry];
    const Sandbox = this.mode === 'inline' ? InlineSandbox : ModSandbox;
    const sandbox = new Sandbox({ id: rec.id, source, limits: { ...rec.limits, loadBudgetMs: this.policy.defaults.loadBudgetMs }, selftest: this.selftest });
    rec.sandbox = sandbox;
    const loaded = await sandbox.start();
    if (!loaded.ok) { this.#disable(rec, `failed to load: ${loaded.kind}: ${loaded.error}`); return; }
    rec.status = 'running';
    rec.hooks = loaded.hooks;
    if (rec.hooks.includes('onInit')) {
      const r = await sandbox.call('onInit', { id: rec.id, savedState: rec.savedState }, rec.limits.tickBudgetMs * 10);
      this.#record(rec, r);
      if (!r.ok) this.#strike(rec, `onInit ${r.kind}: ${r.error}`);
      else for (const l of r.logs ?? []) this.log(`[${rec.id}] ${l}`);
    }
  }

  /**
   * Offer the current game state to every running script mod. Never blocks: a mod still busy with its previous
   * frame is skipped. Results become commands (see `drainCommands`) when they arrive.
   * @param {any | (() => any)} frame JSON-serialisable (keep it small: it is copied into each sandbox). Pass a
   *   function to build it lazily: it is only called on ticks when some mod is actually due.
   */
  emitFrame(frame) {
    this.frameCounter++;
    let built;
    for (const id of this.order) {
      const rec = this.mods.get(id);
      if (rec.status !== 'running' || !rec.hooks.includes('onFrame')) continue;
      if (this.frameCounter % rec.limits.tickEvery !== 0) continue;
      if (rec.busy) { rec.stats.skipped++; continue; }
      rec.busy = true;
      built ??= typeof frame === 'function' ? frame() : frame;
      rec.sandbox.call('onFrame', built, rec.limits.tickBudgetMs).then((r) => {
        rec.busy = false;
        if (rec.status === 'running') this.#handleResult(rec, r);
      });
    }
  }

  #record(rec, r) {
    rec.stats.calls++;
    const ms = r.ms ?? 0;
    rec.stats.totalMs += ms;
    if (ms > rec.stats.maxMs) rec.stats.maxMs = ms;
  }

  #handleResult(rec, r) {
    this.#record(rec, r);
    if (!r.ok) {
      if (r.kind === 'timeout') rec.stats.timeouts++;
      else if (r.kind === 'crash' || r.kind === 'watchdog') rec.stats.crashes++;
      else rec.stats.errors++;
      this.#strike(rec, `${r.kind}: ${r.error}`);
      if (r.kind === 'crash' || r.kind === 'watchdog') this.#restart(rec);
      return;
    }
    for (const l of r.logs ?? []) this.log(`[${rec.id}] ${l}`);
    if (r.none || r.value === null) return;
    if (!Array.isArray(r.value)) { this.#strike(rec, 'onFrame must return an array of commands'); return; }
    let rejected = 0;
    for (const cmd of r.value.slice(0, this.policy.commandsPerCall)) {
      const v = validateCommand(cmd, this.commands);
      if (v.ok) { this.queue.push({ mod: rec.id, cmd }); rec.stats.accepted++; } else { rejected++; rec.stats.rejected++; rec.lastRejection = v.error; }
    }
    const over = r.value.length - this.policy.commandsPerCall;
    if (over > 0) { rec.stats.rejected += over; rejected += over; }
    if (rejected > 0 && rejected >= Math.ceil(r.value.length / 2)) this.#strike(rec, `mostly invalid commands (${rec.lastRejection ?? 'too many'})`);
  }

  #strike(rec, reason) {
    const now = this.now();
    rec.strikes = rec.strikes.filter((t) => now - t < this.policy.strikeWindowMs);
    rec.strikes.push(now);
    this.log(`mod "${rec.id}" strike ${rec.strikes.length}/${this.policy.maxStrikes}: ${reason}`);
    if (rec.strikes.length >= this.policy.maxStrikes) this.#disable(rec, `too many strikes (last: ${reason})`);
  }

  async #restart(rec) {
    if (rec.status !== 'running') return;
    const now = this.now();
    rec.restartTimes = (rec.restartTimes ?? []).filter((t) => now - t < this.policy.strikeWindowMs);
    if (rec.restartTimes.length >= this.policy.maxRestarts) { this.#disable(rec, 'crashed too often'); return; }
    rec.restartTimes.push(now);
    rec.stats.restarts++;
    rec.status = 'restarting';
    rec.sandbox?.kill();
    await this.#startMod(rec);
  }

  #disable(rec, reason) {
    rec.status = 'disabled';
    rec.reason = reason;
    rec.sandbox?.kill();
    this.log(`mod "${rec.id}" DISABLED: ${reason}`);
    this.onDisabled?.(rec, reason);
  }

  /** Validated commands produced since the last call, in arrival order. @returns {{mod: string, cmd: any}[]} */
  drainCommands() {
    const out = this.queue;
    this.queue = [];
    return out;
  }

  /**
   * Replace a script mod with a new bundle (development hot reload). The old version's `serialize()` result,
   * if any, is handed to the new version's `onInit` as `savedState`.
   * @param {import('./bundle.js').Bundle} bundle
   */
  async reload(bundle) {
    const id = bundle.manifest?.id;
    const rec = this.mods.get(id);
    if (!rec) return { ok: false, errors: [`no mod "${id}" is loaded`] };
    const v = validateBundle(bundle);
    if (!v.ok) return { ok: false, errors: v.errors };
    const hash = hashBundle(bundle);
    const reason = this.#policyRejection(bundle, hash);
    if (reason) return { ok: false, errors: [reason] };
    if (rec.status === 'running' && rec.hooks.includes('serialize')) {
      const s = await rec.sandbox.call('serialize', null, rec.limits.tickBudgetMs * 5);
      if (s.ok) rec.savedState = s.value;
    }
    await rec.sandbox?.stop();
    Object.assign(rec, { bundle, manifest: bundle.manifest, hash, clientHash: hashClientView(bundle), limits: this.#limitsFor(bundle.manifest), strikes: [], restartTimes: [], reason: '', status: 'pending' });
    await this.#startMod(rec);
    return { ok: rec.status === 'running' || rec.status === 'data', errors: rec.status === 'disabled' ? [rec.reason] : [], hash };
  }

  /** Rules from every enabled mod in load order, merged with conflicts reported. */
  collectRules() {
    const sets = this.order.map((id) => this.mods.get(id)).filter((r) => r.status === 'data' || r.status === 'running').filter((r) => r.manifest.rules)
      .map((r) => ({ mod: r.id, rules: r.manifest.rules }));
    return mergeRuleSets(sets);
  }

  /** What to tell joining clients: the mods that carry client-relevant data, with the hash they must verify. */
  advertised() {
    return this.order.map((id) => this.mods.get(id)).filter((r) => (r.status === 'data' || r.status === 'running') && (r.manifest.rules || r.manifest.client))
      .map((r) => ({ id: r.id, version: r.manifest.version, hash: r.clientHash }));
  }

  /** @returns {Map<string, any>} content-addressed client views (hash -> data) for serving over HTTP. */
  clientViews() {
    const out = new Map();
    for (const r of this.mods.values()) if (r.manifest.rules || r.manifest.client) out.set(r.clientHash, clientView(r.bundle));
    return out;
  }

  /** Status of every mod, for dashboards and logs. */
  list() {
    return [...this.mods.values()].map((r) => ({
      id: r.id, version: r.manifest.version, tier: r.manifest.tier, status: r.status, reason: r.reason, hash: r.hash, clientHash: r.clientHash,
      limits: r.limits, strikes: r.strikes.length, stats: { ...r.stats, avgMs: r.stats.calls ? r.stats.totalMs / r.stats.calls : 0 },
    }));
  }

  async close() {
    await Promise.all([...this.mods.values()].map((r) => r.sandbox?.stop()));
  }
}
