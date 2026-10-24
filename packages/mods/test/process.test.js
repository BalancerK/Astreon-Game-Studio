import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ModSandbox, ModManager } from '../src/node.js';

const COMMANDS = {
  heal: { id: { type: 'int', min: 0 }, amount: { type: 'number', min: 0, max: 100 } },
  say: { text: { type: 'string', maxLength: 40 } },
};
const script = (id, src, extra = {}) => ({ manifest: { id, version: '1.0.0', tier: 'script', entry: 'main.js', ...extra }, files: { 'main.js': src } });
const GOOD = (id) => script(id, `engine.register({ onFrame(f) { return [{ op: 'heal', id: 1, amount: 1 }]; } });`);

async function waitFor(cond, ms = 5000, what = 'condition') {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 5));
  }
}

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

async function manager(bundles, opts = {}) {
  const p = opts.policy ?? {};
  // generous budgets by default: CPU contention (parallel test files) must not cause spurious timeouts
  const m = new ModManager({ commands: COMMANDS, mode: 'process', ...opts, policy: { ...p, defaults: { tickBudgetMs: 100, loadBudgetMs: 3000, ...p.defaults }, caps: { tickBudgetMs: 3000, ...p.caps } } });
  for (const b of bundles) assert.ok(m.add(b).ok, `add ${b.manifest.id}`);
  await m.start();
  return m;
}
const stat = (m, id) => m.list().find((x) => x.id === id);

test('confinement, seen from inside the child: no files, no processes, no workers, no eval, scrubbed env', async () => {
  process.env.ENGINE_TEST_SECRET = 'do-not-leak';
  const sb = new ModSandbox({ id: 'probe', source: 'engine.register({});', selftest: true, limits: { loadBudgetMs: 3000 } });
  try {
    assert.ok((await sb.start()).ok);
    const p = (await sb.probe());
    assert.equal(p.permissionModel, 'on');
    assert.equal(p.fsRead, 'ALLOWED', 'it can read only its own sandbox files');
    assert.equal(p.fsReadOther, 'blocked:ERR_ACCESS_DENIED', 'cannot list other directories');
    assert.equal(p.fsWrite, 'blocked:ERR_ACCESS_DENIED');
    assert.equal(p.spawn, 'blocked:ERR_ACCESS_DENIED');
    assert.equal(p.worker, 'blocked:ERR_ACCESS_DENIED');
    assert.equal(p.stringEval, 'blocked:EvalError', 'even the child\'s own realm cannot eval');
    assert.ok(p.pid !== process.pid && alive(p.pid));
    // Windows re-adds a handful of system variables; nothing from the server's own environment may arrive
    assert.ok(p.envVars <= 15, `${p.envVars} environment variables`);
  } finally {
    delete process.env.ENGINE_TEST_SECRET;
    await sb.stop();
  }
  // and a mod's source cannot see any of it either (strings-only boundary, no process object)
  const sb2 = new ModSandbox({ id: 'noenv', source: `engine.register({ onFrame() { return typeof process + ',' + typeof require; } });`, limits: { tickBudgetMs: 100, loadBudgetMs: 3000 } });
  try {
    assert.ok((await sb2.start()).ok);
    assert.equal((await sb2.call('onFrame', {})).value, 'undefined,undefined');
  } finally {
    await sb2.stop();
  }
});

test('a mod spinning forever never blocks the caller, is cut off by its budget, struck, and finally disabled; neighbours are unaffected', async () => {
  const m = await manager([
    GOOD('healthy'),
    script('spinner', `engine.register({ onFrame() { for (;;) {} } });`),
  ], { policy: { maxStrikes: 3, defaults: { tickEvery: 1 } } });
  try {
    const t0 = performance.now();
    for (let i = 1; i <= 6; i++) m.emitFrame({ tick: i, players: [] });
    assert.ok(performance.now() - t0 < 5, `emitFrame returned in ${(performance.now() - t0).toFixed(2)} ms: it is non-blocking`);
    for (let i = 0; i < 40 && stat(m, 'spinner').status !== 'disabled'; i++) { await new Promise((r) => setTimeout(r, 30)); m.emitFrame({ tick: 10 + i, players: [] }); }
    await waitFor(() => stat(m, 'spinner').status === 'disabled', 8000, 'spinner to be disabled');
    const spinner = stat(m, 'spinner');
    assert.match(spinner.reason, /too many strikes.*timeout/);
    assert.ok(spinner.stats.timeouts >= 3);
    assert.equal(m.mods.get('spinner').sandbox.state, 'dead', 'its process was terminated');
    // the healthy mod kept working the whole time
    assert.equal(stat(m, 'healthy').status, 'running');
    assert.ok(stat(m, 'healthy').stats.accepted >= 3, `healthy accepted ${stat(m, 'healthy').stats.accepted} commands`);
    assert.equal(stat(m, 'healthy').strikes, 0);
    const before = m.list().find((x) => x.id === 'spinner').stats.calls;
    for (let i = 0; i < 6; i++) m.emitFrame({ tick: 100 + i });
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(stat(m, 'spinner').stats.calls, before, 'a disabled mod is not called again');
  } finally {
    await m.close();
  }
});

test('a memory bomb kills only its own process: restarted a few times, then disabled', async () => {
  const bomb = script('bomb', `engine.register({ onFrame() { const a = []; for (;;) a.push(new Array(100000).fill(1)); } });`, { limits: { tickBudgetMs: 2500, memoryMb: 32 } });
  const m = await manager([GOOD('healthy'), bomb], { policy: { caps: { tickBudgetMs: 3000 }, maxStrikes: 99, maxRestarts: 2 } });
  try {
    const pidBefore = m.mods.get('bomb').sandbox.pid;
    const t0 = performance.now();
    for (let i = 1; i <= 40; i++) { m.emitFrame({ tick: i }); await new Promise((r) => setTimeout(r, 40)); if (stat(m, 'bomb').status === 'disabled') break; }
    await waitFor(() => stat(m, 'bomb').status === 'disabled', 15_000, 'bomb to be disabled');
    const b = stat(m, 'bomb');
    assert.match(b.reason, /crashed too often/);
    assert.equal(b.stats.restarts, 2, 'restarted twice, then gave up');
    assert.ok(b.stats.crashes >= 3, `${b.stats.crashes} crashes`);
    assert.ok(!alive(pidBefore), 'the first child process is gone');
    assert.ok(performance.now() - t0 < 12_000, 'and it all happened quickly');
    assert.equal(stat(m, 'healthy').status, 'running', 'the neighbour never noticed');
    assert.ok(process.memoryUsage().rss < 1.5e9, 'the server process itself did not balloon');
  } finally {
    await m.close();
  }
});

test('the watchdog kills a sandbox that stops answering even though no vm timeout can reach it', async () => {
  const sb = new ModSandbox({ id: 'hung', source: 'engine.register({ onFrame() { return 1; } });', selftest: true, limits: { hardTimeoutMs: 300, loadBudgetMs: 3000 } });
  assert.ok((await sb.start()).ok);
  const pid = sb.pid;
  sb.hang(); // block the child's event loop OUTSIDE the vm
  const t0 = performance.now();
  const r = await sb.call('onFrame', {});
  assert.equal(r.ok, false);
  assert.equal(r.kind, 'watchdog');
  assert.ok(performance.now() - t0 < 1500, `gave up after ${(performance.now() - t0).toFixed(0)} ms`);
  await waitFor(() => !alive(pid), 3000, 'the hung process to be killed');
  assert.equal(sb.state, 'dead');
  assert.equal((await sb.call('onFrame', {})).kind, 'crash', 'later calls fail fast instead of hanging');
});

test('abusive output: oversized results, invalid commands, floods and wrong shapes are struck, never trusted', async () => {
  const m = await manager([
    script('huge', `engine.register({ onFrame() { return [{ op: 'say', text: 'x'.repeat(100000) }]; } });`),
    script('invalid', `engine.register({ onFrame() { return [{ op: 'heal', id: -5, amount: 1e9 }, { op: 'format-disk' }, { op: 'heal', id: 1 }]; } });`),
    script('flood', `engine.register({ onFrame() { return Array.from({ length: 500 }, () => ({ op: 'heal', id: 1, amount: 1 })); } });`),
    script('shape', `engine.register({ onFrame() { return { op: 'heal', id: 1, amount: 1 }; } });`),
    script('thrower', `engine.register({ onFrame() { throw new Error('mod bug'); } });`),
  ], { policy: { maxStrikes: 99, commandsPerCall: 8, defaults: { tickEvery: 1 } } });
  try {
    for (let i = 1; i <= 12; i++) { m.emitFrame({ tick: i }); await new Promise((r) => setTimeout(r, 25)); }
    await waitFor(() => m.list().every((x) => x.stats.calls >= 5), 8000, 'every mod to be called');
    const get = (id) => stat(m, id);
    assert.ok(get('huge').strikes >= 3 && get('huge').stats.errors >= 3, 'oversize result: struck');
    assert.equal(get('invalid').stats.accepted, 0, 'no invalid command was ever accepted');
    assert.ok(get('invalid').strikes >= 3);
    assert.ok(get('flood').stats.accepted <= 8 * get('flood').stats.calls, 'at most commandsPerCall accepted per call');
    assert.ok(get('flood').stats.rejected > 0 && get('flood').strikes >= 3, 'the flood was refused and struck');
    assert.ok(get('shape').strikes >= 3, 'wrong shape: struck');
    assert.ok(get('thrower').stats.errors >= 3, 'exceptions are contained');
    const accepted = m.drainCommands();
    assert.ok(accepted.every((c) => c.cmd.op === 'heal' && c.cmd.id === 1 && c.cmd.amount === 1), 'only well-formed commands got through');
    assert.ok(!accepted.some((c) => ['huge', 'invalid', 'shape', 'thrower'].includes(c.mod)));
    assert.equal(m.drainCommands().length, 0, 'drain empties the queue');
  } finally {
    await m.close();
  }
});

test('frames are skipped, not queued, while a mod is still busy; slow-but-legal mods are fine', async () => {
  const m = await manager([
    script('busy', `engine.register({ onFrame() { const t = Date.now(); while (Date.now() - t < 1.5) {} return []; } });`, { limits: { tickBudgetMs: 60 } }),
  ], { policy: { defaults: { tickEvery: 1 } } });
  try {
    for (let i = 1; i <= 200; i++) m.emitFrame({ tick: i }); // far faster than the mod can answer
    await waitFor(() => !m.mods.get('busy').busy, 5000, 'the mod to catch up');
    const s = stat(m, 'busy');
    assert.ok(s.stats.skipped > 100, `skipped ${s.stats.skipped} frames instead of queueing them`);
    assert.ok(s.stats.calls >= 1 && s.strikes === 0, 'legal slow work earns no strikes');
    assert.equal(s.status, 'running');
  } finally {
    await m.close();
  }
});

test('closing the manager terminates every sandbox process', async () => {
  const m = await manager([GOOD('a'), GOOD('b'), GOOD('c')]);
  const pids = [...m.mods.values()].map((r) => r.sandbox.pid);
  assert.equal(new Set(pids).size, 3, 'one process per mod');
  assert.ok(pids.every((p) => p !== process.pid && alive(p)));
  await m.close();
  await waitFor(() => pids.every((p) => !alive(p)), 3000, 'all sandbox processes to exit');
});

test('starting a sandbox is fast, and a call round trip is cheap', async () => {
  // Loose bounds on purpose: this runs alongside every other test file. Typical values on an idle machine are about 60 ms to start and 0.8 ms per call.
  const t0 = performance.now();
  const sb = new ModSandbox({ id: 'speed', source: 'engine.register({ onFrame(f) { return f.tick; } });', limits: { tickBudgetMs: 100, loadBudgetMs: 3000 } });
  try {
    assert.ok((await sb.start()).ok);
    const startMs = performance.now() - t0;
    const t1 = performance.now();
    for (let i = 0; i < 300; i++) assert.equal((await sb.call('onFrame', { tick: i })).value, i);
    const per = (performance.now() - t1) / 300;
    assert.ok(startMs < 5000, `started in ${startMs.toFixed(0)} ms`);
    assert.ok(per < 25, `${per.toFixed(2)} ms per call including IPC`);
  } finally {
    await sb.stop();
  }
});
