// The language-level sandbox (layer 1 and 2 of docs/SECURITY.md). Node only.
//
// HARD RULES (see docs/SECURITY.md before changing anything here):
//  - Never put a host object or function into the context. A host function exposes the HOST realm's Function
//    constructor (`fn.constructor("return process")()`), which is a complete escape. Only strings cross:
//    we set string globals, run a constant script, and read back a string.
//  - Code generation from strings is disabled for the context, which blocks eval, new Function and every
//    constructor.constructor(...) trick.
//  - Every call runs under a timeout, with microtasks drained inside the timed window.
import vm from 'node:vm';

/** Hook names a mod may register; anything else is ignored. */
export const ALLOWED_HOOKS = Object.freeze(['onInit', 'onFrame', 'onShutdown', 'serialize']);

// Runs inside the context before any mod code. Captures what it needs from the intrinsics first, then the
// hardening script freezes them so the mod cannot swap them out.
const BOOTSTRAP = `
(function () {
  'use strict';
  const stringify = JSON.stringify, parse = JSON.parse, isArray = Array.isArray, defineProperty = Object.defineProperty;
  const freeze = Object.freeze, keys = Object.keys, slice = String.prototype.slice, toStr = String;
  const hooks = Object.create(null);
  const allowed = ${JSON.stringify(['onInit', 'onFrame', 'onShutdown', 'serialize'])};
  let logs = [];

  const engine = freeze({
    register(def) {
      if (def === null || typeof def !== 'object') throw new TypeError('engine.register needs an object of hooks');
      for (let i = 0; i < allowed.length; i++) {
        const name = allowed[i];
        if (typeof def[name] === 'function') hooks[name] = def[name];
      }
    },
    log(message) { if (logs.length < 20) logs.push(slice.call(toStr(message), 0, 200)); },
  });
  defineProperty(globalThis, 'engine', { value: engine, writable: false, configurable: false, enumerable: false });

  defineProperty(globalThis, '__registered', { value() { return keys(hooks); }, writable: false, configurable: false, enumerable: false });
  defineProperty(globalThis, '__call', {
    value(name, argJson) {
      const fn = hooks[name];
      if (typeof fn !== 'function') return '{"none":true}';
      let out;
      try {
        out = fn(parse(argJson));
        if (out !== null && typeof out === 'object' && typeof out.then === 'function') throw new TypeError('hooks must be synchronous');
        const text = stringify({ out: out === undefined ? null : out, logs });
        logs = [];
        return text;
      } catch (e) {
        const message = slice.call(toStr(e && e.message !== undefined ? e.message : e), 0, 300);
        logs = [];
        return stringify({ error: message });
      }
    },
    writable: false, configurable: false, enumerable: false,
  });
})();
`;

// Removes everything that could be used to escape, probe or block, and freezes the shared intrinsics so a mod
// cannot tamper with them or with the bootstrap.
const HARDEN = `
(function () {
  'use strict';
  const g = globalThis;
  for (const name of ['Atomics', 'SharedArrayBuffer', 'WebAssembly', 'console', 'WeakRef', 'FinalizationRegistry', 'escape', 'unescape']) {
    try { delete g[name]; } catch (e) {}
  }
  Object.defineProperty(Error, 'prepareStackTrace', { value: undefined, writable: false, configurable: false });
  delete Error.captureStackTrace;
  const protos = [Object.prototype, Array.prototype, Function.prototype, String.prototype, Number.prototype, Boolean.prototype,
    Symbol.prototype, Promise.prototype, Map.prototype, Set.prototype, WeakMap.prototype, WeakSet.prototype, RegExp.prototype,
    Date.prototype, Error.prototype, TypeError.prototype, RangeError.prototype, SyntaxError.prototype, ReferenceError.prototype,
    EvalError.prototype, URIError.prototype, ArrayBuffer.prototype, DataView.prototype, BigInt.prototype,
    Object.getPrototypeOf(Uint8Array).prototype, Object.getPrototypeOf(Uint8Array)];
  for (const p of protos) Object.freeze(p);
  for (const c of [Object, Array, Function, String, Number, Boolean, Symbol, Promise, Map, Set, RegExp, Date, Error, JSON, Math, Reflect, Proxy, BigInt]) Object.freeze(c);
})();
`;

const bootstrapScript = new vm.Script(BOOTSTRAP, { filename: 'sandbox:bootstrap' });
const hardenScript = new vm.Script(HARDEN, { filename: 'sandbox:harden' });
const callScript = new vm.Script('__call(__name, __arg)', { filename: 'sandbox:call' });
const registeredScript = new vm.Script('JSON.stringify(__registered())', { filename: 'sandbox:registered' });

/**
 * The confined JavaScript environment a mod script runs in: a fresh context with no host objects, code generation from strings
 * switched off, and a time limit on every call. Only strings cross the boundary. Node only; `docs/SECURITY.md` explains the
 * layers.
 *
 * @typedef {{ok: true, value: any, none?: boolean, logs: string[], ms: number} | {ok: false, kind: 'load' | 'timeout' | 'error' | 'oversize' | 'invalid', error: string, ms: number}} CallResult
 */
export class SandboxCore {
  /**
   * @param {object} o
   * @param {string} o.source The mod's JavaScript.
   * @param {string} [o.filename]
   * @param {number} [o.loadBudgetMs] CPU budget for loading the script.
   * @param {number} [o.defaultBudgetMs] CPU budget per call unless overridden.
   * @param {number} [o.maxResultBytes] Largest result accepted from a call.
   * @param {number} [o.maxArgBytes] Largest argument sent into a call.
   */
  constructor({ source, filename = 'mod.js', loadBudgetMs = 250, defaultBudgetMs = 2, maxResultBytes = 64 * 1024, maxArgBytes = 256 * 1024 }) {
    this.source = source;
    this.filename = filename;
    this.loadBudgetMs = loadBudgetMs;
    this.defaultBudgetMs = defaultBudgetMs;
    this.maxResultBytes = maxResultBytes;
    this.maxArgBytes = maxArgBytes;
    this.context = null;
    this.hooks = [];
  }

  /** Create the context, run the mod's top level, and report which hooks it registered. */
  load() {
    const t0 = performance.now();
    // A null-prototype sandbox object: nothing from the host is reachable through it.
    const context = vm.createContext(Object.create(null), {
      codeGeneration: { strings: false, wasm: false },
      microtaskMode: 'afterEvaluate',
    });
    this.context = context;
    try {
      bootstrapScript.runInContext(context, { timeout: this.loadBudgetMs });
      hardenScript.runInContext(context, { timeout: this.loadBudgetMs });
      if (typeof this.source !== 'string' || this.source.length > 128 * 1024) return this.#fail('load', 'mod source must be a string of at most 128 KB', t0);
      new vm.Script(this.source, { filename: this.filename }).runInContext(context, { timeout: this.loadBudgetMs });
      this.hooks = JSON.parse(registeredScript.runInContext(context, { timeout: this.loadBudgetMs }));
      return { ok: true, hooks: this.hooks, ms: performance.now() - t0 };
    } catch (e) {
      return this.#fail(e && e.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT' ? 'timeout' : 'load', e && e.message ? String(e.message) : String(e), t0);
    }
  }

  #fail(kind, error, t0) { return { ok: false, kind, error: String(error).slice(0, 300), ms: performance.now() - t0 }; }

  /**
   * Call a registered hook with a JSON-serialisable argument.
   * @param {string} hook
   * @param {any} arg
   * @param {number} [budgetMs]
   * @returns {CallResult}
   */
  call(hook, arg, budgetMs = this.defaultBudgetMs) {
    const t0 = performance.now();
    if (!this.context) return this.#fail('invalid', 'sandbox not loaded', t0);
    let argJson;
    try { argJson = JSON.stringify(arg === undefined ? null : arg); } catch { return this.#fail('invalid', 'argument is not JSON-serialisable', t0); }
    if (argJson.length > this.maxArgBytes) return this.#fail('invalid', 'argument too large', t0);
    let text;
    try {
      this.context.__name = hook; // strings only
      this.context.__arg = argJson;
      text = callScript.runInContext(this.context, { timeout: budgetMs });
    } catch (e) {
      return this.#fail(e && e.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT' ? 'timeout' : 'error', e && e.message ? String(e.message) : String(e), t0);
    }
    const ms = performance.now() - t0;
    if (typeof text !== 'string') return this.#fail('invalid', 'the mod returned something that is not a string envelope', t0);
    if (text.length > this.maxResultBytes) return { ok: false, kind: 'oversize', error: `result too large (${text.length} > ${this.maxResultBytes} bytes)`, ms };
    let envelope;
    try { envelope = JSON.parse(text); } catch { return this.#fail('invalid', 'result is not valid JSON', t0); }
    if (envelope.none) return { ok: true, none: true, value: null, logs: [], ms };
    if (envelope.error !== undefined) return { ok: false, kind: 'error', error: String(envelope.error), ms };
    return { ok: true, value: envelope.out, logs: Array.isArray(envelope.logs) ? envelope.logs.map(String) : [], ms };
  }
}
