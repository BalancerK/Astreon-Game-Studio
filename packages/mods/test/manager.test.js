import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ModManager, generateSigningKey, signHash } from '../src/node.js';
import { hashBundle, hashClientView } from '../src/index.js';

const COMMANDS = { heal: { id: { type: 'int', min: 0 }, amount: { type: 'number', min: 0, max: 100 } } };
const script = (id, src, extra = {}) => ({ manifest: { id, version: '1.0.0', tier: 'script', entry: 'main.js', ...extra }, files: { 'main.js': src } });
const data = (id, rules, extra = {}) => ({ manifest: { id, version: '1.0.0', tier: 'data', rules, ...extra }, files: {} });
const GOOD = (id, extra) => script(id, `engine.register({ onFrame(f) { return [{ op: 'heal', id: 1, amount: f.tick % 10 }]; } });`, extra);
const flush = () => new Promise((r) => setImmediate(r));
// Budgets are generous by default so CPU contention (parallel test files) cannot cause spurious timeouts.
const relaxed = (p = {}) => ({ ...p, defaults: { tickBudgetMs: 200, loadBudgetMs: 3000, ...p.defaults }, caps: { tickBudgetMs: 500, ...p.caps } });
const mgr = (opts = {}) => new ModManager({ commands: COMMANDS, mode: 'inline', ...opts, policy: relaxed(opts.policy) });
const status = (m, id) => m.list().find((x) => x.id === id);

test('policy: scripts can be refused, signatures required, hashes pinned, counts limited', async () => {
  // scripts disabled
  let m = mgr({ policy: { allowScript: false } });
  assert.match(m.add(GOOD('a')).errors[0], /script mods are disabled/);
  assert.ok(m.add(data('d', { playerSpeed: 300 })).ok, 'data mods are still fine');

  // signatures
  const key = generateSigningKey(), stranger = generateSigningKey();
  const signed = (bundle, k = key) => ({ ...bundle, signature: signHash(hashBundle(bundle), k) });
  m = mgr({ policy: { requireSignature: 'script', trustedKeys: [key.publicKey] } });
  assert.ok(m.add(signed(GOOD('ok'))).ok, 'signed by a trusted key');
  assert.match(m.add(GOOD('unsigned')).errors[0], /signature from a trusted key is required/);
  assert.match(m.add(signed(GOOD('stranger'), stranger)).errors[0], /trusted key is required/, 'valid signature, untrusted key');
  const tampered = signed(GOOD('tampered'));
  tampered.files['main.js'] += '\n// edited after signing';
  assert.match(m.add(tampered).errors[0], /signature does not match the bundle contents/);
  assert.ok(m.add(data('free', { playerSpeed: 300 })).ok, 'requireSignature "script" does not apply to data mods');
  m = mgr({ policy: { requireSignature: 'all', trustedKeys: [key.publicKey] } });
  assert.match(m.add(data('free', { playerSpeed: 300 })).errors[0], /trusted key is required/);

  // hash pinning
  const pinned = GOOD('pinned');
  m = mgr({ policy: { allowHashes: [hashBundle(pinned)] } });
  assert.ok(m.add(pinned).ok);
  assert.match(m.add(GOOD('other')).errors[0], /not on the server allow list/);
  assert.match(m.add({ ...pinned, manifest: { ...pinned.manifest, id: 'renamed' } }).errors[0], /allow list/, 'any change breaks the pin');

  // counts, duplicates, invalid bundles
  m = mgr({ policy: { maxMods: 2 } });
  assert.ok(m.add(GOOD('a')).ok && m.add(GOOD('b')).ok);
  assert.match(m.add(GOOD('c')).errors[0], /too many mods/);
  assert.match(m.add(GOOD('a')).errors[0], /already loaded/);
  assert.match(mgr().add({ manifest: { id: 'x' }, files: {} }).errors.join(), /version is required/);
});

test('dependencies decide load order; unsatisfiable mods are rejected individually', async () => {
  const m = mgr();
  m.add(GOOD('app', { dependencies: { lib: '^1.0.0' } }));
  m.add(GOOD('lib'));
  m.add(GOOD('needs-missing', { dependencies: { ghost: '*' } }));
  m.add(GOOD('too-new', { engine: '^9.0.0' }));
  m.add(GOOD('cyc-a', { dependencies: { 'cyc-b': '*' } }));
  m.add(GOOD('cyc-b', { dependencies: { 'cyc-a': '*' } }));
  m.add(GOOD('wrong-version', { dependencies: { lib: '^2.0.0' } }));
  m.add(GOOD('independent'));
  await m.start();
  assert.deepEqual(m.order.indexOf('lib') < m.order.indexOf('app'), true, 'lib loads before app');
  for (const id of ['app', 'lib', 'independent']) assert.equal(status(m, id).status, 'running', id);
  for (const id of ['needs-missing', 'too-new', 'cyc-a', 'cyc-b', 'wrong-version']) assert.equal(status(m, id).status, 'rejected', id);
  assert.match(status(m, 'needs-missing').reason, /missing plugin "ghost"/);
  assert.match(status(m, 'too-new').reason, /requires engine/);
  assert.match(status(m, 'wrong-version').reason, /needs "lib" \^2\.0\.0, found 1\.0\.0/);
  await m.close();
});

test('requested limits are clamped to what the server allows', async () => {
  const m = new ModManager({ commands: COMMANDS, mode: 'inline' }); // default policy: this test is about the defaults and caps
  m.add(GOOD('greedy', { limits: { tickBudgetMs: 1000, memoryMb: 100000, tickEvery: 0.2 } }));
  m.add(GOOD('tiny', { limits: { tickBudgetMs: 0.01, memoryMb: 1, tickEvery: 99999 } }));
  m.add(GOOD('default'));
  assert.deepEqual(status(m, 'greedy').limits, { tickBudgetMs: 5, memoryMb: 96, tickEvery: 1 });
  assert.deepEqual(status(m, 'tiny').limits, { tickBudgetMs: 0.5, memoryMb: 16, tickEvery: 600 });
  assert.deepEqual(status(m, 'default').limits, { tickBudgetMs: 2, memoryMb: 48, tickEvery: 6 });
});

test('frames reach mods at their own cadence and never overlap; commands keep their author', async () => {
  const m = mgr();
  m.add(GOOD('fast', { limits: { tickEvery: 1 } }));
  m.add(GOOD('slow', { limits: { tickEvery: 3 } }));
  await m.start();
  for (let tick = 1; tick <= 9; tick++) { m.emitFrame({ tick }); await flush(); }
  assert.equal(status(m, 'fast').stats.calls, 9);
  assert.equal(status(m, 'slow').stats.calls, 3);
  const cmds = m.drainCommands();
  assert.equal(cmds.length, 12);
  assert.deepEqual(cmds.filter((c) => c.mod === 'slow').map((c) => c.cmd.amount), [3, 6, 9]);
  assert.equal(m.drainCommands().length, 0);
  await m.close();
});

test('strikes expire: only recent misbehaviour counts', async () => {
  let now = 0;
  const m = mgr({ now: () => now, policy: { maxStrikes: 3, strikeWindowMs: 1000 } });
  m.add(script('flaky', `engine.register({ onFrame(f) { if (f.bad) throw new Error('oops'); return []; } });`, { limits: { tickEvery: 1 } }));
  await m.start();
  const frame = async (bad) => { m.emitFrame({ bad }); await flush(); };
  await frame(true); now = 400; await frame(true);
  assert.equal(status(m, 'flaky').strikes, 2);
  now = 1600; await frame(true); // the first two are older than the window now
  assert.equal(status(m, 'flaky').strikes, 1, 'old strikes are forgiven');
  assert.equal(status(m, 'flaky').status, 'running');
  now = 1700; await frame(true); now = 1800; await frame(true);
  assert.equal(status(m, 'flaky').status, 'disabled', 'three strikes inside one window disable it');
  assert.match(status(m, 'flaky').reason, /too many strikes/);
  await m.close();
});

test('onDisabled fires, broken scripts are disabled at load, and onInit problems count', async () => {
  const disabled = [];
  const m = mgr();
  m.onDisabled = (rec, reason) => disabled.push([rec.id, reason]);
  m.add(script('syntax', 'engine.register({ onFrame( }'));
  m.add(script('loops', 'for (;;) {}'));
  m.add(script('init-throws', `engine.register({ onInit() { throw new Error('bad init'); } });`));
  m.add(GOOD('fine'));
  await m.start();
  assert.equal(status(m, 'syntax').status, 'disabled');
  assert.match(status(m, 'syntax').reason, /failed to load: load/);
  assert.match(status(m, 'loops').reason, /failed to load: timeout/);
  assert.equal(status(m, 'init-throws').strikes, 1, 'a failing onInit is a strike but not fatal on its own');
  assert.equal(status(m, 'fine').status, 'running');
  assert.deepEqual(disabled.map((d) => d[0]).sort(), ['loops', 'syntax']);
  await m.close();
});

test('rules and presentation reach clients only through content-addressed, verifiable views', async () => {
  const m = mgr();
  m.add(data('fast-weapons', { weapon: { cooldownTicks: 5, damage: 30 } }));
  m.add(data('neon', {}, { client: { theme: { floor: [10, 20, 40] } } }));
  m.add(GOOD('healer', { rules: { weapon: { damage: 20 } } }));
  m.add(GOOD('no-client-data'));
  await m.start();
  const { merged, conflicts } = m.collectRules();
  assert.equal(merged['weapon.cooldownTicks'], 5);
  assert.equal(merged['weapon.damage'], 20, 'later mod wins');
  assert.deepEqual(conflicts.map((c) => [c.key, c.winner]), [['weapon.damage', 'healer']]);

  const ads = m.advertised();
  assert.deepEqual(ads.map((a) => a.id).sort(), ['fast-weapons', 'healer', 'neon'], 'mods without client-relevant data are not advertised');
  const views = m.clientViews();
  for (const ad of ads) {
    assert.ok(views.has(ad.hash), `${ad.id}: advertised hash resolves to a view`);
    assert.equal(views.get(ad.hash).id, ad.id);
    assert.ok(!JSON.stringify(views.get(ad.hash)).includes('onFrame'), 'no script source ever goes to clients');
  }
  assert.equal(ads.find((a) => a.id === 'neon').hash, hashClientView(m.mods.get('neon').bundle));

  // a disabled mod stops contributing rules
  m.mods.get('healer').status = 'disabled';
  assert.equal(m.collectRules().merged['weapon.damage'], 30);
  await m.close();
});

test('hot reload swaps a mod in place, hands over saved state, resets strikes, and refuses bad bundles', async () => {
  const v1 = script('counter', `
    let n = 0;
    engine.register({
      onFrame() { n++; return [{ op: 'heal', id: 1, amount: n % 100 }]; },
      serialize() { return { n }; },
    });`, { limits: { tickEvery: 1 } });
  const v2 = script('counter', `
    let n = 0;
    engine.register({
      onInit(cfg) { n = (cfg.savedState && cfg.savedState.n) || 0; engine.log('resumed at ' + n); },
      onFrame() { n += 10; return [{ op: 'heal', id: 1, amount: n % 100 }]; },
    });`, { version: '2.0.0', limits: { tickEvery: 1 } });
  const logs = [];
  const m = mgr({ log: (l) => logs.push(l) });
  m.add(v1);
  await m.start();
  for (let i = 0; i < 5; i++) { m.emitFrame({}); await flush(); }
  m.drainCommands();
  const oldHash = status(m, 'counter').hash;

  const r = await m.reload(v2);
  assert.ok(r.ok, JSON.stringify(r));
  assert.notEqual(status(m, 'counter').hash, oldHash);
  assert.equal(status(m, 'counter').version, '2.0.0');
  assert.ok(logs.some((l) => l.includes('resumed at 5')), 'the new version started from the old version\'s serialized state');
  m.emitFrame({}); await flush();
  assert.equal(m.drainCommands()[0].cmd.amount, 15, '5 carried over, +10');

  assert.equal((await m.reload({ ...v2, manifest: { ...v2.manifest, id: 'unknown' } })).ok, false);
  const strict = mgr({ policy: { allowHashes: [hashBundle(v1)] } });
  strict.add(v1); await strict.start();
  assert.match((await strict.reload(v2)).errors[0], /allow list/, 'reload goes through the same policy');
  assert.equal(status(strict, 'counter').status, 'running', 'the old version keeps running');
  assert.equal((await m.reload({ manifest: { id: 'counter' } })).ok, false, 'invalid bundles are refused');
  await m.close(); await strict.close();
});
