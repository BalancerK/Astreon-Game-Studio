import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { SandboxCore } from '../src/node.js';

const hook = (body) => `engine.register({ onFrame(f) { ${body} } });`;
const make = (source, opts = {}) => {
  const s = new SandboxCore({ source, defaultBudgetMs: 250, loadBudgetMs: 500, ...opts }); // generous: CPU contention must not make non-timing tests flaky
  const loaded = s.load();
  return { s, loaded };
};
/** Run one hook body in a fresh sandbox. */
const run = (body, opts) => {
  const { s, loaded } = make(hook(body), opts);
  assert.ok(loaded.ok, `load failed: ${JSON.stringify(loaded)}`);
  return s.call('onFrame', { tick: 1 });
};

test('a normal mod loads, registers hooks, receives data and returns commands', () => {
  const { s, loaded } = make(`
    let beats = 0;
    engine.register({
      onInit(cfg) { engine.log('init ' + cfg.name); },
      onFrame(f) { beats++; return [{ op: 'heal', id: f.players[0].id, amount: 5 + beats }]; },
      secret() { return 'ignored: not an allowed hook name'; },
    });`);
  assert.ok(loaded.ok);
  assert.deepEqual(loaded.hooks.sort(), ['onFrame', 'onInit']);
  const init = s.call('onInit', { name: 'demo' });
  assert.deepEqual(init.logs, ['init demo']);
  const r = s.call('onFrame', { tick: 3, players: [{ id: 9 }] });
  assert.deepEqual(r.value, [{ op: 'heal', id: 9, amount: 6 }]);
  assert.deepEqual(s.call('onFrame', { tick: 4, players: [{ id: 9 }] }).value, [{ op: 'heal', id: 9, amount: 7 }], 'state persists between calls');
  assert.equal(s.call('unregistered', {}).none, true);
  assert.ok(r.ms < 100, `a call takes ${r.ms.toFixed(2)} ms`);
});

test('every way of reaching the host through code generation is blocked', () => {
  const chains = [
    'this.constructor.constructor("return process")()',
    '(function(){}).constructor("return process")()',
    '(async function(){}).constructor("return process")()',
    '(function*(){}).constructor("return process")()',
    '(async function*(){}).constructor("return process")()',
    '(() => {}).constructor("return process")()',
    '[].constructor.constructor("return process")()',
    '"".constructor.constructor("return process")()',
    '(1).constructor.constructor("return process")()',
    'Object.getPrototypeOf(async function(){}).constructor("return process")()',
    'Reflect.construct(Function, ["return process"])()',
    'Reflect.getPrototypeOf(function(){}).constructor("return process")()',
    'new Proxy({}, {}).constructor.constructor("return process")()',
    'Object.constructor("return process")()',
    'globalThis.constructor.constructor("return process")()',
    'eval("process")',
    '(0, eval)("process")',
    'new Function("return process")()',
    'Function("return process")()',
    'new (Object.getPrototypeOf(function*(){}).constructor)("return process")()',
    'new Promise(function(){}).constructor.constructor("return process")()',
    'new Error("x").constructor.constructor("return process")()',
  ];
  for (const code of chains) {
    const r = run(`return ${code};`);
    assert.equal(r.ok, false, `ESCAPED via ${code}: ${JSON.stringify(r)}`);
    assert.match(r.error, /Code generation from strings disallowed/, code);
  }
});

test('no host capability exists inside the context', () => {
  const names = ['process', 'require', 'module', 'exports', 'global', 'Buffer', 'fetch', 'WebSocket', 'XMLHttpRequest', 'setTimeout', 'setInterval',
    'setImmediate', 'queueMicrotask', 'structuredClone', 'URL', 'TextEncoder', 'performance', '__dirname', '__filename',
    'Atomics', 'SharedArrayBuffer', 'WebAssembly', 'console', 'WeakRef', 'FinalizationRegistry', 'escape', 'unescape'];
  const r = run(`return ${JSON.stringify(names)}.map((n) => typeof globalThis[n]);`);
  assert.ok(r.ok);
  assert.deepEqual(r.value, names.map(() => 'undefined'));

  // and nothing but ECMAScript intrinsics and our own entry points is on the global object
  const own = run('return Object.getOwnPropertyNames(globalThis);').value;
  const ecma = new Set(['Object', 'Function', 'Array', 'Number', 'parseFloat', 'parseInt', 'Infinity', 'NaN', 'undefined', 'Boolean', 'String', 'Symbol', 'Date', 'Promise', 'RegExp', 'Error', 'AggregateError', 'EvalError', 'RangeError', 'ReferenceError', 'SyntaxError', 'TypeError', 'URIError', 'globalThis', 'JSON', 'Math', 'Intl', 'ArrayBuffer', 'Uint8Array', 'Int8Array', 'Uint16Array', 'Int16Array', 'Uint32Array', 'Int32Array', 'BigUint64Array', 'BigInt64Array', 'Uint8ClampedArray', 'Float32Array', 'Float64Array', 'Float16Array', 'DataView', 'Map', 'BigInt', 'Set', 'Iterator', 'WeakMap', 'WeakSet', 'Proxy', 'Reflect', 'decodeURI', 'decodeURIComponent', 'encodeURI', 'encodeURIComponent', 'eval', 'isFinite', 'isNaN', 'SuppressedError', 'DisposableStack', 'AsyncDisposableStack', 'engine', '__call', '__registered', '__name', '__arg']);
  const unexpected = own.filter((n) => !ecma.has(n));
  assert.deepEqual(unexpected, [], `unexpected globals: ${unexpected.join(', ')}`);
});

test('dynamic import() is refused', () => {
  const { s, loaded } = make(`
    globalThis.outcome = 'pending';
    import('node:fs').then(() => { outcome = 'IMPORTED'; }, (e) => { outcome = 'refused: ' + (e && e.code); });
    engine.register({ onFrame() { return outcome; } });`);
  assert.ok(loaded.ok);
  assert.equal(s.call('onFrame', {}).value, 'refused: ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING');
});

test('stack-trace tricks yield nothing: prepareStackTrace is locked and captureStackTrace is gone', () => {
  const r = run(`
    'use strict';
    let tampered = 'no';
    try { Error.prepareStackTrace = (e, frames) => frames; tampered = 'writable'; } catch (e) { tampered = 'locked: ' + e.name; }
    const frames = (() => { try { return new Error('x').stack; } catch (e) { return 'err'; } })();
    return { tampered, capture: typeof Error.captureStackTrace, stackIsString: typeof frames === 'string' };`);
  assert.ok(r.ok);
  assert.deepEqual(r.value, { tampered: 'locked: TypeError', capture: 'undefined', stackIsString: true });
});

test('intrinsics are frozen: a mod cannot tamper with shared prototypes, and the host realm is untouched', () => {
  const r = run(`
    'use strict';
    const out = {};
    for (const [name, f] of Object.entries({
      objectProto: () => { Object.prototype.polluted = 1; },
      arrayProto: () => { Array.prototype.polluted = 1; },
      jsonParse: () => { JSON.parse = () => 'evil'; },
      mathRandom: () => { Math.random = () => 4; },
      functionProto: () => { Function.prototype.polluted = 1; },
      deleteObject: () => { delete globalThis.Object; },
    })) { try { f(); out[name] = 'SUCCEEDED'; } catch (e) { out[name] = 'blocked'; } }
    return out;`);
  assert.ok(r.ok);
  for (const [name, result] of Object.entries(r.value)) {
    // deleting a global binding is allowed in a context (it only removes the mod's own access)
    if (name === 'deleteObject') continue;
    assert.equal(result, 'blocked', `${name}: ${result}`);
  }
  assert.equal({}.polluted, undefined, 'host Object.prototype');
  assert.equal([].polluted, undefined, 'host Array.prototype');
  assert.equal(Object.isFrozen(Object.prototype), false, 'the host realm is not frozen by the sandbox');
  assert.equal(JSON.parse('1'), 1);
});

test('a mod cannot overwrite the entry points; whatever it does, only it suffers', () => {
  const { s, loaded } = make(`
    'use strict';
    const attempts = {};
    const tries = {
      'engine.register = null': () => { engine.register = null; },
      'engine.log = fn': () => { engine.log = () => 'x'; },
      '__call = fn': () => { globalThis.__call = () => '{"out":"hijacked","logs":[]}'; },
      'defineProperty __call': () => { Object.defineProperty(globalThis, '__call', { value: () => 'x' }); },
      '__registered = fn': () => { globalThis.__registered = () => '[]'; },
    };
    for (const [k, f] of Object.entries(tries)) { try { f(); attempts[k] = 'worked'; } catch (e) { attempts[k] = 'blocked'; } }
    engine.register({ onFrame() { return attempts; } });`);
  assert.ok(loaded.ok, JSON.stringify(loaded));
  const r = s.call('onFrame', {});
  assert.ok(r.ok, JSON.stringify(r));
  assert.deepEqual(Object.values(r.value), ['blocked', 'blocked', 'blocked', 'blocked', 'blocked']);
  assert.ok(s.call('onFrame', {}).ok, 'the protocol still works afterwards');
});

test('even a mod that destroys or replaces the call protocol cannot hurt the host: output is always untrusted', () => {
  // V8 lets a context delete its own global bindings (measured), so a mod can remove __call and install a
  // fake. That only affects this mod: the host validates every envelope.
  const hostile = {
    'garbage text': 'globalThis.__call = () => "not json at all";',
    'wrong shape': 'globalThis.__call = () => "[1,2,3]";',
    'huge string': 'globalThis.__call = () => "x".repeat(10000000);',
    'non-string': 'globalThis.__call = () => ({ constructor: 1 });',
    'throws': 'globalThis.__call = () => { throw new Error("nope"); };',
    '__proto__ payload': `globalThis.__call = () => '{"out": {"__proto__": {"admin": true}}, "logs": ["a", 1, {"x": 1}]}';`,
  };
  for (const [name, setup] of Object.entries(hostile)) {
    const { s, loaded } = make('engine.register({ onFrame() { return 1; } });');
    assert.ok(loaded.ok);
    // the mod's own code deletes the real entry point and installs the fake; do the same through a second load step
    const sabotaged = new SandboxCore({ source: `engine.register({ onFrame() { return 1; } }); delete globalThis.__call; ${setup}`, maxResultBytes: 4096, defaultBudgetMs: 250 });
    assert.ok(sabotaged.load().ok, name);
    const r = sabotaged.call('onFrame', {});
    assert.ok(r.ok === false || r.ok === true, name);
    if (r.ok) {
      assert.equal(({}).admin, undefined, `${name}: no host pollution`);
      assert.ok(Array.isArray(r.logs) && r.logs.every((l) => typeof l === 'string'), `${name}: logs are strings`);
    } else {
      assert.ok(['error', 'invalid', 'oversize'].includes(r.kind), `${name}: ${r.kind}`);
    }
    void s;
  }
});

test('runaway code is interrupted inside its budget, whatever form it takes', () => {
  const forms = {
    'while(true)': 'while (true) {}',
    'for(;;)': 'for (;;) {}',
    'catastrophic regex': 'return /(a+)+$/.test("a".repeat(45) + "!");',
    'busy arithmetic': 'let x = 0; for (;;) { x = (x * 31 + 7) % 1000003; }',
    'recursive allocation loop': 'const a = []; for (;;) { a.push({ x: [1, 2, 3] }); if (a.length > 1e6) a.length = 0; }',
  };
  for (const [name, body] of Object.entries(forms)) {
    const { s } = make(hook(body));
    const t0 = performance.now();
    const r = s.call('onFrame', {}, 20);
    const ms = performance.now() - t0;
    assert.equal(r.ok, false, name);
    assert.equal(r.kind, 'timeout', `${name}: ${JSON.stringify(r)}`);
    assert.ok(ms < 250, `${name} stopped after ${ms.toFixed(0)} ms (budget 20 ms)`);
  }
  // the sandbox survives a timeout and keeps serving later calls
  const { s } = make(`let n = 0; engine.register({ onFrame(f) { if (f.spin) for (;;) {} return ++n; } });`);
  assert.equal(s.call('onFrame', { spin: true }, 10).kind, 'timeout');
  assert.ok(s.call('onFrame', {}).ok);
});

test('microtask loops, promise chains and async hooks cannot outlive the budget or hide (run in a clean process)', () => {
  // Promise-job interruption must not run inside node:test (async hooks corrupt Node's stack); see the fixture.
  const stdout = execFileSync(process.execPath, [fileURLToPath(new URL('./fixtures/clean-process-cases.mjs', import.meta.url))], { encoding: 'utf8', timeout: 30_000 });
  const r = JSON.parse(stdout);
  assert.equal(r.asyncBusyLoopAtLoad.ok, false);
  assert.equal(r.asyncBusyLoopAtLoad.kind, 'timeout', 'an async busy-loop at load is cut off: microtasks drain inside the timed window');
  assert.equal(r.promiseChain.kind, 'timeout');
  assert.equal(r.asyncHook.ok, false);
  assert.match(r.asyncHook.error, /synchronous/);
  assert.equal(r.asyncLoopInHook.kind, 'timeout');
  assert.ok(r.asyncLoopInHookMs < 250, `stopped after ${r.asyncLoopInHookMs.toFixed(0)} ms`);
  assert.equal(r.survivedAfterwards, 'timeout', 'the sandbox keeps answering (and keeps enforcing the budget) afterwards');
});

test('stack overflow and huge allocations are errors, not crashes', () => {
  assert.equal(run('function f() { return f() + 1; } return f();').ok, false);
  assert.match(run('return new Array(2 ** 32);').error, /Invalid array length/);
  assert.match(run('let s = "x"; for (let i = 0; i < 40; i++) s += s; return s.length;').error, /Invalid string length/);
});

test('results are size-capped, must be JSON, and exceptions are contained', () => {
  const big = run('return "x".repeat(100000);', { maxResultBytes: 4096 });
  assert.equal(big.kind, 'oversize');
  assert.match(run('return 10n;').error, /BigInt/, 'BigInt is not JSON-serialisable');
  assert.match(run('const a = {}; a.self = a; return a;').error, /JSON/, 'cycles are not JSON');
  const thrown = run('throw new Error("boom " + f.tick);');
  assert.equal(thrown.ok, false);
  assert.equal(thrown.error, 'boom 1', 'only the message crosses the boundary, never a stack or host object');
  assert.equal(run('return undefined;').value, null);
  assert.deepEqual(run('return { a: [1, { b: 2 }], c: "d" };').value, { a: [1, { b: 2 }], c: 'd' });
  // arguments are checked too
  const { s } = make(hook('return 1;'), { maxArgBytes: 100 });
  assert.match(s.call('onFrame', { big: 'x'.repeat(500) }).error, /too large/);
  const cyclic = {}; cyclic.me = cyclic;
  assert.match(make(hook('return 1;')).s.call('onFrame', cyclic).error, /JSON/);
});

test('values coming back are plain host objects with no prototype tricks', () => {
  const r = run('return JSON.parse(\'{"__proto__": {"admin": true}, "constructor": {"prototype": {"x": 1}}}\');');
  assert.ok(r.ok);
  assert.equal(({}).admin, undefined, 'a __proto__ key in a mod result does not pollute the host');
  assert.equal(Object.getPrototypeOf(r.value), Object.prototype);
  assert.equal(r.value.admin, undefined);
});

test('loading problems are reported, not thrown', () => {
  assert.equal(make('this is not javascript {').loaded.kind, 'load');
  assert.equal(make('while (true) {}', { loadBudgetMs: 20 }).loaded.kind, 'timeout');
  assert.equal(make('engine.register(null);').loaded.ok, false, 'engine.register(null) throws inside the mod');
  assert.equal(make('x'.repeat(200 * 1024)).loaded.ok, false, 'oversized source');
  assert.equal(new SandboxCore({ source: '' }).call('onFrame', {}).kind, 'invalid', 'call before load');
});

test('logs are capped in count and length, and objects are stringified rather than passed through', () => {
  const r = run('for (let i = 0; i < 100; i++) engine.log("line " + i + " " + "z".repeat(1000)); engine.log({ a: 1 }); return 1;');
  assert.ok(r.ok);
  assert.equal(r.logs.length, 20);
  assert.ok(r.logs.every((l) => typeof l === 'string' && l.length <= 200));
});

test('sandboxes are isolated from each other: no shared globals, no shared state', () => {
  const a = make(`globalThis.secret = 42; engine.register({ onFrame() { return typeof secret; } });`);
  const b = make(`engine.register({ onFrame() { return typeof secret; } });`);
  assert.equal(a.s.call('onFrame', {}).value, 'number');
  assert.equal(b.s.call('onFrame', {}).value, 'undefined');
  assert.equal(typeof globalThis.secret, 'undefined');
});

test('many calls stay fast', () => {
  const { s } = make(`engine.register({ onFrame(f) { let sum = 0; for (const p of f.players) sum += p.hp; return [{ op: 'heal', id: f.players[0].id, amount: sum % 7 }]; } });`);
  const players = Array.from({ length: 64 }, (_, i) => ({ id: i, hp: 50 + i }));
  const t0 = performance.now();
  for (let i = 0; i < 2000; i++) assert.ok(s.call('onFrame', { tick: i, players }).ok);
  const per = (performance.now() - t0) / 2000;
  assert.ok(per < 1, `${per.toFixed(3)} ms per frame with 64 players`);
});
