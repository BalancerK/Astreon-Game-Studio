import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { startArenaServer } from '../server/arena-server.js';
import { ArenaClient } from '../client/net.js';
import { createRules } from '../shared/rules.js';
import { Health, Pos, buildWalls, buildWallHash } from '../shared/game.js';
import { MemoryNetwork, VirtualClock } from '../../../packages/transport/src/index.js';
import { loadCatalog, generateSigningKey, signHash } from '../../../packages/mods/src/node.js';
import { hashBundle } from '../../../packages/mods/src/index.js';

const SLOT = 0xfffff;
const TICK_MS = 1000 / 60;
const MODS_DIR = fileURLToPath(new URL('../mods', import.meta.url));
const catalog = loadCatalog(MODS_DIR);
const pick = (...ids) => catalog.bundles.filter((b) => ids.includes(b.manifest.id));
const script = (id, src, extra = {}) => ({ manifest: { id, version: '1.0.0', tier: 'script', entry: 'main.js', limits: { tickEvery: 1 }, ...extra }, files: { 'main.js': src } });
// Wait for any client still verifying mod data (real async crypto), however loaded the machine is.
const settle = async (...clients) => {
  await new Promise((r) => setImmediate(r));
  for (const c of clients) for (let i = 0; i < 2000 && c.state === 'loading-mods'; i++) await new Promise((r) => setTimeout(r, 5));
  await new Promise((r) => setImmediate(r));
};

async function setup({ mods, fetchMod, latencyMs = 20 } = {}) {
  const clock = new VirtualClock();
  if (mods && mods.mode === 'inline') { const p = mods.policy ?? {}; mods = { ...mods, policy: { ...p, defaults: { tickBudgetMs: 200, loadBudgetMs: 3000, ...p.defaults }, caps: { tickBudgetMs: 500, ...p.caps } } }; } // generous: contention-proof
  const server = await startArenaServer({ listen: false, manualTicks: true, bots: 0, serveStatic: false, mods });
  const net = new MemoryNetwork({ clock, link: { latencyMs } });
  net.listen('arena').onConnection = server.attach;
  // "Downloading" = looking the hash up in what the server would serve over HTTP
  const served = (id, hash) => Promise.resolve(server.mods?.clientViews().get(hash));
  const client = (o = {}) => new ArenaClient({ transport: net.connect('arena'), now: () => clock.now(), fetchMod: fetchMod ?? served, ...o });
  const run = async (ticks, clients = [], input = [1, 0.3, 0], pump = false) => {
    for (let i = 0; i < ticks; i++) {
      clock.advance(TICK_MS);
      for (const c of clients) c.sendInput(...input);
      server.step();
      if (pump) await settle(2);
    }
  };
  return { clock, server, net, client, run };
}

test('the catalog loads cleanly: sample mods are valid, the template is skipped', () => {
  assert.deepEqual(catalog.problems, []);
  assert.deepEqual(catalog.bundles.map((b) => b.manifest.id).sort(), ['fast-weapons', 'healing-aura', 'kill-feed', 'neon-theme']);
});

test('a data mod changes the rules on server and client alike, and prediction stays exact', async () => {
  const { clock, server, client, run } = await setup({ mods: { bundles: pick('fast-weapons'), mode: 'inline' } });
  assert.equal(server.rules.weapon.cooldownTicks, 5);
  assert.equal(server.rules.weapon.damage, 15);
  assert.equal(server.rules.playerSpeed, 480);
  const a = client().start();
  clock.advance(100);
  assert.equal(a.state, 'loading-mods', 'play does not start until the mod data is verified');
  await settle(a);
  assert.equal(a.state, 'playing');
  assert.deepEqual(a.rules, server.rules, 'client and server hold identical rule values');
  assert.deepEqual(a.mods.map((m) => m.id), ['fast-weapons']);
  await run(180, [a], [1, 0.4, 1]);
  assert.equal(a.predicted.stats.corrections, 0, `no corrections: ${JSON.stringify(a.predicted.stats)}`);
  assert.ok(a.predicted.stats.reconciles > 20);

  // control: a client that ignored the mod would disagree with the server immediately
  const b = client().start();
  clock.advance(100); await settle(b);
  b.predicted.rules = createRules();
  await run(120, [b], [1, 0, 0]);
  assert.ok(b.predicted.stats.corrections > 0, 'default rules against a modded server cause corrections (so matching rules is what keeps it exact)');
  const slot = b.selfId & SLOT;
  assert.ok(server.world.data(Pos).x[slot] > 0);
});

test('tampered or unavailable mod data is refused: the player never plays and never auto-reconnects', async () => {
  for (const [name, fetchMod, expect] of [
    ['changed rules', async (id, hash) => { const v = structuredClone((await setup0.server.mods.clientViews()).get(hash)); v.rules.playerSpeed = 2000; return v; }, /does not match its advertised hash/],
    ['extra field', async (id, hash) => ({ ...setup0.server.mods.clientViews().get(hash), evil: 1 }), /does not match/],
    ['download fails', async () => { throw new Error('download of "fast-weapons" failed (404)'); }, /failed \(404\)/],
    ['wrong mod served', async (id, hash) => ({ ...setup0.server.mods.clientViews().get(hash), id: 'other' }), /does not match|claims to be/],
  ]) {
    var setup0 = await setup({ mods: { bundles: pick('fast-weapons'), mode: 'inline' }, fetchMod });
    const reconnects = [];
    const a = setup0.client({ reconnect: { createTransport: () => { reconnects.push(1); return setup0.net.connect('arena'); }, setTimer: (ms, fn) => setup0.clock.schedule(ms, fn) } }).start();
    setup0.clock.advance(100); await settle(a);
    assert.equal(a.state, 'rejected', name);
    assert.match(a.closeReason, /^mod verification failed: /, name);
    assert.match(a.closeReason, expect, name);
    setup0.clock.advance(20_000); await settle();
    assert.equal(a.state, 'rejected', `${name}: still rejected`);
    assert.equal(reconnects.length, 0, `${name}: no reconnect attempts`);
    a.sendInput(1, 0, 0);
    assert.equal(a.seq, 0, `${name}: no inputs are sent`);
    await setup0.server.close();
  }
});

test('presentation data is whitelisted: valid colours apply, junk is ignored', async () => {
  const hostile = { manifest: { id: 'junk-theme', version: '1.0.0', tier: 'data', client: { theme: { floor: [999, 0, 0], wall: 'red', dot: [1, 2, 3], title: 'Hi\u0007<b>', evil: 'x' }, scripts: ['x.js'] } }, files: {} };
  const { clock, client } = await setup({ mods: { bundles: [...pick('neon-theme'), hostile], mode: 'inline' } });
  const a = client().start();
  clock.advance(100); await settle(a);
  assert.equal(a.state, 'playing');
  assert.deepEqual(a.theme.wall, [255, 40, 160], 'from the neon theme');
  assert.deepEqual(a.theme.dot, [1, 2, 3], 'the later mod overrides what is valid');
  assert.deepEqual(a.theme.floor, [8, 6, 24], 'invalid floor ignored, earlier value kept');
  assert.equal(a.theme.title, 'Hi<b>', 'control characters stripped');
  assert.equal(a.theme.evil, undefined);
});

test('script mods act through validated commands: healing, kill feed messages, and nothing else', async () => {
  const { clock, server, client, run } = await setup({ mods: { bundles: pick('healing-aura', 'kill-feed'), mode: 'inline', policy: { defaults: { tickEvery: 1 } } } });
  const a = client().start();
  clock.advance(100); await settle(a);
  assert.equal(a.state, 'playing', 'script-only mods advertise nothing, so there is nothing to download');
  assert.deepEqual(server.mods.advertised(), []);
  const hp = server.world.data(Health).hp, id = a.selfId & SLOT;
  await run(5, [a], [0, 0, 0], true);
  hp[id] = 50;
  await run(70, [a], [0, 0, 0], true); // the aura acts every 30 ticks
  assert.ok(hp[id] > 50 && hp[id] <= 58, `healed gradually: ${hp[id]}`);
  hp[id] = 99;
  await run(70, [a], [0, 0, 0], true);
  assert.equal(hp[id], 100, 'never above the maximum');

  const messages = [];
  a.onEvent = (e) => { if (e.kind === 2) messages.push(e.text); };
  server.mods.queue.push({ mod: 'test', cmd: { op: 'message', text: 'hello\u0007 world' } });
  await run(3, [a], [0, 0, 0], true);
  assert.deepEqual(messages, ['hello world'], 'control characters removed, delivered as an EVENT');
});

test('mods cannot kill, teleport into walls, hit dead entities, or reach outside the command set', async () => {
  const { clock, server, client, run } = await setup({ mods: { bundles: [], mode: 'inline' } });
  const a = client().start();
  clock.advance(100); await settle(a);
  await run(3, [a], [0, 0, 0]);
  const hp = server.world.data(Health).hp, x = server.world.data(Pos).x, y = server.world.data(Pos).y, id = a.selfId & SLOT;
  const send = async (cmd) => { server.mods.queue.push({ mod: 'test', cmd }); await run(1, [a], [0, 0, 0]); };
  hp[id] = 30;
  await send({ op: 'damage', id: a.selfId, amount: 100 });
  assert.equal(hp[id], 1, 'damage from a mod leaves 1 hp: only players kill');
  const before = [x[id], y[id]];
  await send({ op: 'teleport', id: a.selfId, x: 20, y: 20 }); // inside the border wall
  assert.deepEqual([x[id], y[id]], before, 'teleport into a wall refused');
  const walls = buildWallHash(buildWalls());
  const out = new Int32Array(8);
  let free = null;
  for (let gx = 300; gx < 2000 && !free; gx += 50) if (walls.queryRect(gx - 40, 1000 - 40, gx + 40, 1000 + 40, out) === 0) free = gx;
  await send({ op: 'teleport', id: a.selfId, x: free, y: 1000 });
  assert.deepEqual([x[id], y[id]], [free, 1000], 'teleport to open ground works');
  await send({ op: 'heal', id: 4_000_000, amount: 5 }); // no such entity
  await send({ op: 'heal', id: 0.5, amount: 5 });
  await send({ op: 'delete-everything' });
  assert.ok(server.world.isAlive(a.selfId));
});

test('evil mods running in confined processes do not hurt the tick, the players or each other', async () => {
  const evil = [
    script('spinner', 'engine.register({ onFrame() { for (;;) {} } });'),
    script('bomb', 'engine.register({ onFrame() { const a = []; for (;;) a.push(new Array(1e5).fill(1)); } });', { limits: { tickEvery: 1, memoryMb: 32, tickBudgetMs: 2 } }),
    script('flooder', `engine.register({ onFrame(f) { return Array.from({ length: 5000 }, () => ({ op: 'damage', id: f.players[0].id, amount: 100 })); } });`),
    script('liar', `engine.register({ onFrame(f) { return [{ op: 'heal', id: f.players[0].id, amount: 1e12 }, { op: 'teleport', id: -1, x: NaN, y: 0 }]; } });`),
    script('escaper', `engine.register({ onFrame() { try { return [{ op: 'message', text: String(this.constructor.constructor('return process')().pid) }]; } catch (e) { return [{ op: 'message', text: 'blocked:' + e.name }]; } } });`),
    ...pick('healing-aura'),
  ];
  const { clock, server, client, run } = await setup({ mods: { bundles: evil, mode: 'process', policy: { defaults: { tickEvery: 1, tickBudgetMs: 50, loadBudgetMs: 3000 }, caps: { tickBudgetMs: 100 }, maxStrikes: 3, maxRestarts: 1 } } });
  try {
    const a = client().start();
    const seen = [];
    a.onEvent = (e) => { if (e.kind === 2) seen.push(e.text); };
    clock.advance(100); await settle(a);
    const hp = server.world.data(Health).hp, id = a.selfId & SLOT;
    hp[id] = 100;
    const t0 = Date.now();
    for (let i = 0; i < 240; i++) { await run(1, [a], [0.5, 0.5, 0]); await new Promise((r) => setTimeout(r, 4)); }
    const status = Object.fromEntries(server.mods.list().map((m) => [m.id, m.status]));
    assert.equal(status.spinner, 'disabled');
    assert.equal(status.bomb, 'disabled');
    assert.equal(status.flooder, 'disabled');
    assert.equal(status.liar, 'disabled');
    assert.equal(status['healing-aura'], 'running', 'the honest mod was unaffected');
    assert.ok(server.stats.tickMsMax < 15, `slowest tick ${server.stats.tickMsMax.toFixed(2)} ms: mods never ran on the tick thread`);
    assert.ok(hp[id] >= 1, 'a mod flood of 100-damage commands could not kill the player');
    assert.ok(hp[id] <= 100);
    assert.ok(!seen.some((t) => /^\d+$/.test(t)), `no escape: ${seen.join()}`);
    assert.ok(Date.now() - t0 < 20_000);
  } finally {
    await server.close();
  }
});

test('policy applies at startup: unsigned scripts refused, signed ones accepted, rules still apply', async () => {
  const key = generateSigningKey();
  const healer = pick('healing-aura')[0];
  const signed = { ...healer, signature: signHash(hashBundle(healer), key) };
  const logs = [];
  const { server } = await setup({ mods: { bundles: [signed, pick('kill-feed')[0], ...pick('fast-weapons')], mode: 'inline', log: (m) => logs.push(m), policy: { requireSignature: 'script', trustedKeys: [key.publicKey] } } });
  const status = Object.fromEntries(server.mods.list().map((m) => [m.id, m.status]));
  assert.equal(status['healing-aura'], 'running');
  assert.equal(status['fast-weapons'], 'data');
  assert.equal(status['kill-feed'], undefined, 'refused before it was even registered');
  assert.ok(logs.some((l) => l.includes('kill-feed') && l.includes('trusted key')), logs.join('; '));
  assert.equal(server.rules.weapon.damage, 15);
});

test('the HTTP route serves exactly the advertised client views and nothing else', async () => {
  const server = await startArenaServer({ port: 0, bots: 0, mods: { bundles: pick('fast-weapons', 'neon-theme', 'healing-aura'), mode: 'inline' } });
  try {
    const get = (path, method = 'GET') => new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port: server.port, path, method }, (res) => {
        let body = ''; res.on('data', (d) => (body += d)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
      });
      req.on('error', reject); req.end();
    });
    const ads = server.mods.advertised();
    assert.deepEqual(ads.map((a) => a.id).sort(), ['fast-weapons', 'neon-theme']);
    for (const ad of ads) {
      const r = await get(`/mods/${ad.id}/${ad.hash}`);
      assert.equal(r.status, 200);
      assert.match(r.headers['cache-control'], /immutable/);
      assert.equal(r.headers['x-content-type-options'], 'nosniff');
      assert.equal(JSON.parse(r.body).id, ad.id);
    }
    const [fw, nt] = ads.find((a) => a.id === 'fast-weapons') && [ads.find((a) => a.id === 'fast-weapons'), ads.find((a) => a.id === 'neon-theme')];
    assert.equal((await get(`/mods/fast-weapons/${nt.hash}`)).status, 404, 'a hash belonging to another mod');
    assert.equal((await get(`/mods/fast-weapons/${'0'.repeat(64)}`)).status, 404, 'unknown hash');
    assert.equal((await get(`/mods/fast-weapons/${fw.hash.slice(0, 63)}`)).status, 404);
    assert.equal((await get(`/mods/healing-aura/${server.mods.list().find((m) => m.id === 'healing-aura').hash}`)).status, 404, 'script bundles are never served');
    assert.equal((await get('/mods/../../package.json')).status, 404);
    assert.equal((await get('/mods/%2e%2e/%2e%2e/package.json')).status, 404);
    assert.equal((await get(`/mods/fast-weapons/${fw.hash}`, 'POST')).status, 405);
    assert.equal((await get('/mods/')).status, 404);
  } finally {
    await server.close();
  }
});
