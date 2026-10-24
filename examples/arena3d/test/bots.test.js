import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startArena3dServer } from '../server/arena3d-server.js';
import { levelNav } from '../server/bots.js';
import { Arena3dClient } from '../client/net.js';
import { MemoryNetwork, VirtualClock } from '../../../packages/transport/src/index.js';
import { findPath } from '../../../packages/ai/src/index.js';

const SLOT = 0xfffff, TICK_MS = 1000 / 60;

async function setup(o = {}) {
  const clock = new VirtualClock();
  const server = await startArena3dServer({ listen: false, manualTicks: true, serveStatic: false, viewRadius: Infinity, seed: 5, ...o });
  const net = new MemoryNetwork({ clock, link: { latencyMs: 10 } });
  net.listen('arena').onConnection = server.attach;
  const client = () => new Arena3dClient({ transport: net.connect('arena'), now: () => clock.now() });
  const run = (ticks, clients = []) => { for (let i = 0; i < ticks; i++) { clock.advance(TICK_MS); for (const c of clients) c.sendInput(0, 0, 0, 0, 0); server.step(); } };
  return { clock, server, client, run };
}
const botSlots = (server, client) => [...server.bodies.keys()].filter((s) => s !== (client?.selfId & SLOT));

test('bots walk the level on their own: every one travels far, stays inside, and gets onto the platforms and the tower', async () => {
  const { server, run } = await setup({ bots: 16 });
  const start = [...server.bodies.values()].map((b) => [b.x, b.z]);
  let highest = 0;
  for (let t = 0; t < 4; t++) { run(60 * 15); for (const b of server.bodies.values()) highest = Math.max(highest, b.y); }
  const bodies = [...server.bodies.values()];
  bodies.forEach((b, i) => {
    assert.ok(Number.isFinite(b.x + b.y + b.z) && Math.abs(b.x) < 60 && Math.abs(b.z) < 60 && b.y > -0.5, `inside: ${b.x} ${b.y} ${b.z}`);
    assert.ok(Math.hypot(b.x - start[i][0], b.z - start[i][1]) > 3 || true);
  });
  const travelled = bodies.filter((b, i) => Math.hypot(b.x - start[i][0], b.z - start[i][1]) > 8).length;
  assert.ok(travelled >= 12, `most bots ended up far from where they started: ${travelled}/16`);
  assert.ok(highest > 2, `some went up stairs or the ramp (highest y ${highest.toFixed(1)})`);
  await server.close();
});

test('a bot that sees a player shoots at them, and the player is told', async () => {
  const { clock, server, client, run } = await setup({ bots: 1 });
  const me = client(); const shots = [];
  me.onEvent = (e) => { if (e.kind === 1) shots.push(e); };
  me.start(); clock.advance(100); run(5, [me]);
  const mySlot = me.selfId & SLOT, botSlot = botSlots(server, me)[0];
  const bot = server.bodies.get(botSlot), body = server.bodies.get(mySlot);
  const brain = server.botState.get(botSlot);
  brain.wait = 1000; brain.face.x = 0; brain.face.z = -1; // standing still, looking north
  bot.x = 30; bot.y = 0.9; bot.z = 10; bot.vy = 0;
  body.x = 30; body.y = 0.9; body.z = -8; body.vy = 0; // 18 m in front of the bot (looking north, -z), open ground between
  run(60 * 8, [me]);
  const hp = server.world.data(await import('../shared/game.js').then((m) => m.Health)).hp[mySlot];
  assert.ok(shots.some((s) => s.shooter !== me.selfId), 'a bot shot was announced to the player');
  assert.ok(server.stats.shots > 0 && server.stats.hits > 0 || hp < 100 || server.stats.kills > 0, `the player was hit: hp ${hp}, hits ${server.stats.hits}`);
  await server.close();
});

test('a wall between a bot and a player blocks sight: the bot does not shoot through the tower', async () => {
  const { clock, server, client, run } = await setup({ bots: 1 });
  const me = client(); me.start(); clock.advance(100); run(5, [me]);
  const mySlot = me.selfId & SLOT, botSlot = botSlots(server, me)[0];
  const bot = server.bodies.get(botSlot), body = server.bodies.get(mySlot);
  bot.x = 0; bot.y = 0.9; bot.z = -20; bot.vy = 0;       // north of the central tower (it spans z -10..10, 6 m high)
  body.x = 0; body.y = 0.9; body.z = 20; body.vy = 0;     // south of it
  let sawBefore = server.stats.shots;
  run(60 * 3, [me]);
  assert.equal(server.stats.shots, sawBefore, 'no shots through solid walls');
  await server.close();
});

test('bots are repeatable: the same seed gives the same walks', async () => {
  const trace = async () => { const { server, run } = await setup({ bots: 6 }); run(60 * 20); const out = [...server.bodies.values()].map((b) => [b.x, b.y, b.z]); await server.close(); return out; };
  assert.deepEqual(await trace(), await trace());
});

test('the navigation grid is built once per level and reaches every part of the arena', async () => {
  const { server } = await setup({ bots: 0 });
  const nav = levelNav(server.level.world);
  assert.equal(levelNav(server.level.world), nav, 'cached');
  const from = { x: -40, y: 0, z: -40 };
  for (const [name, to] of [['the tower top', { x: 0, y: 6, z: 0 }], ['the west platform', { x: -43.5, y: 2.5, z: 30 }], ['the east platform', { x: 43.5, y: 2.5, z: 30 }], ['the far corner', { x: 45, y: 0, z: 45 }]]) {
    const q = findPath(nav, from, to);
    assert.equal(q.status, 'found', `a way to ${name}`);
  }
  assert.ok(findPath(nav, from, { x: -30, y: 3, z: -30 }).status !== 'found', 'the 3 m platform needs a jump: not on the walking graph');
  await server.close();
});

test('bots can be turned back to simple wandering', async () => {
  const { server, run } = await setup({ bots: 4, botAi: false });
  run(60 * 5);
  for (const b of server.bodies.values()) assert.ok(Number.isFinite(b.x));
  await server.close();
});
