import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { startArena3dServer } from '../server/arena3d-server.js';
import { Arena3dClient } from '../client/net.js';
import { applyRules, createRules, sanitizeClientData } from '../shared/rules.js';
import { Health, Pos3 } from '../shared/game.js';
import { MemoryNetwork, VirtualClock } from '../../../packages/transport/src/index.js';
import { loadCatalog } from '../../../packages/mods/src/node.js';
import { teleport, TICK_MS, SLOT } from './netlab.js';

const catalog = loadCatalog(fileURLToPath(new URL('../mods', import.meta.url)));
const pick = (...ids) => catalog.bundles.filter((b) => ids.includes(b.manifest.id));
const script = (id, src) => ({ manifest: { id, version: '1.0.0', tier: 'script', entry: 'main.js', limits: { tickEvery: 1 } }, files: { 'main.js': src } });
const settle = async (...clients) => {
  await new Promise((r) => setImmediate(r));
  for (const c of clients) for (let i = 0; i < 2000 && c.state === 'loading-mods'; i++) await new Promise((r) => setTimeout(r, 5));
  await new Promise((r) => setImmediate(r));
};

async function setup({ mods, fetchMod }) {
  const clock = new VirtualClock();
  if (mods.mode === 'inline') mods = { ...mods, policy: { defaults: { tickBudgetMs: 200, loadBudgetMs: 3000 }, caps: { tickBudgetMs: 500 } } };
  const server = await startArena3dServer({ listen: false, manualTicks: true, bots: 0, serveStatic: false, mods });
  const net = new MemoryNetwork({ clock, link: { latencyMs: 20 } });
  net.listen('arena').onConnection = server.attach;
  const served = (id, hash) => Promise.resolve(server.mods.clientViews().get(hash));
  const client = () => new Arena3dClient({ transport: net.connect('arena'), now: () => clock.now(), fetchMod: fetchMod ?? served });
  return { clock, server, client };
}

test('rules: whitelisted, range-checked, strict', () => {
  const r = createRules();
  const out = applyRules(r, { gravity: 9, 'weapon.damage': 30, 'weapon.damage2': 1, jumpSpeed: 999, walkSpeed: 'fast', 'weapon.cooldownTicks': 2.5 });
  assert.deepEqual(out.applied.sort(), ['gravity', 'weapon.damage']);
  assert.equal(out.rejected.length, 4);
  assert.equal(r.gravity, 9);
  assert.deepEqual(sanitizeClientData({ theme: { sky: [1, 2, 3], ground: [300, 0, 0], fog: 0.5, title: 'ok\u0007' } }).theme, { sky: [1, 2, 3], title: 'ok' });
});

test('the catalog loads cleanly', () => {
  assert.deepEqual(catalog.problems, []);
  assert.deepEqual(catalog.bundles.map((b) => b.manifest.id).sort(), ['healing-aura', 'low-gravity', 'night-sky']);
});

test('a data mod changes the rules on server and client alike; prediction stays exact with other gravity', async () => {
  const { clock, server, client } = await setup({ mods: { bundles: pick('low-gravity', 'night-sky'), mode: 'inline' } });
  assert.equal(server.rules.gravity, 9);
  const a = client().start();
  clock.advance(100);
  assert.equal(a.state, 'loading-mods', 'play does not start until the mod data is verified');
  await settle(a);
  assert.equal(a.state, 'playing');
  assert.equal(a.rules.gravity, 9);
  assert.equal(a.rules.weapon.cooldownTicks, 8);
  assert.equal(a.theme.title, 'ARENA 3D: NIGHT');
  assert.deepEqual(a.mods.map((m) => m.id).sort(), ['low-gravity', 'night-sky']);
  teleport(server, a.selfId, -15, 0.9, 40);
  for (let t = 0; t < 400; t++) {
    clock.advance(TICK_MS);
    a.sendInput(0.3, 1, t % 50 === 0 ? 1 : 0, (t % 120) / 40, 0); // keeps jumping
    server.step();
  }
  clock.advance(200);
  assert.equal(a.predicted.stats.snaps <= 1, true);
  assert.ok(a.predicted.stats.maxError < 0.05, `prediction error ${a.predicted.stats.maxError}`);
  await server.close();
});

test('a tampered mod download is refused: the client never plays', async () => {
  const { clock, server, client } = await setup({
    mods: { bundles: pick('low-gravity'), mode: 'inline' },
    fetchMod: async (id, hash) => { const v = structuredClone(server.mods.clientViews().get(hash)); v.rules = { ...v.rules, gravity: 2 }; return v; },
  });
  const a = client().start();
  clock.advance(100);
  await settle(a);
  assert.equal(a.state, 'rejected');
  assert.match(a.closeReason, /mod verification failed/);
  await server.close();
});

test('a script mod can only propose commands: healing works, impossible commands are ignored', async () => {
  const heal = pick('healing-aura');
  const { clock, server, client } = await setup({ mods: { bundles: heal, mode: 'inline' } });
  const a = client().start();
  clock.advance(100);
  await settle(a);
  server.world.data(Health).hp[a.selfId & SLOT] = 40;
  for (let t = 0; t < 120; t++) { clock.advance(TICK_MS); a.sendInput(0, 0, 0, 0, 0); server.step(); await settle(); }
  assert.ok(server.world.data(Health).hp[a.selfId & SLOT] > 40, 'wounded player was healed by the mod');
  await server.close();

  const evil = script('evil', `engine.register({ onFrame(f) { return [
    { op: 'teleport', id: f.players[0].id, x: 25, y: 0.9, z: 38 },
    { op: 'teleport', id: f.players[0].id, x: 0, y: 3, z: 0 },
    { op: 'damage', id: 99999, amount: 5 } ]; } });`);
  const t2 = await setup({ mods: { bundles: [evil], mode: 'inline' } });
  const b = t2.client().start();
  t2.clock.advance(100);
  await settle(b);
  teleport(t2.server, b.selfId, 20, 0.9, 30);
  for (let t = 0; t < 20; t++) { t2.clock.advance(TICK_MS); b.sendInput(0, 0, 0, 0, 0); t2.server.step(); await settle(); }
  const d = t2.server.world.data(Pos3);
  assert.ok(Math.abs(d.x[b.selfId & SLOT] - 25) < 0.5 && Math.abs(d.z[b.selfId & SLOT] - 38) < 0.5, 'the legal teleport worked; the one into the middle of the tower was refused');
  await t2.server.close();
});
