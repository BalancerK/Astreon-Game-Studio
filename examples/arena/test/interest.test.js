import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startArenaServer } from '../server/arena-server.js';
import { ArenaClient } from '../client/net.js';
import { runBandwidth } from './netlab.js';
import { Pos, Style } from '../shared/game.js';
import { MemoryNetwork, VirtualClock } from '../../../packages/transport/src/index.js';

const INDEX_MASK = 0xfffff;

async function twoClients(viewRadius) {
  const clock = new VirtualClock();
  const server = await startArenaServer({ listen: false, manualTicks: true, bots: 0, serveStatic: false, viewRadius });
  const net = new MemoryNetwork({ clock, link: { latencyMs: 15 } });
  net.listen('a').onConnection = server.attach;
  const clients = [0, 1].map(() => new ArenaClient({ transport: net.connect('a'), now: () => clock.now() }).start());
  clock.runUntil(200);
  assert.ok(clients.every((c) => c.state === 'playing'));
  const { x, y } = server.world.data(Pos);
  const place = (id, px, py) => { x[id & INDEX_MASK] = px; y[id & INDEX_MASK] = py; };
  const spawn = (px, py) => { const e = server.world.create(); server.world.add(e, Pos, { x: px, y: py }); server.world.add(e, Style, { hue: 1, radius: 10 }); return e; };
  const tick = (n = 1) => { for (let i = 0; i < n; i++) { server.step(); clock.advance(1000 / 60); } clock.advance(100); };
  const sees = (client, id) => { const s = client.history.latest(); return s ? s.rowOf(id) >= 0 : false; };
  return { server, clients, place, spawn, tick, sees, clock };
}

test('each client receives only the entities near its own player', async () => {
  const { server, clients: [a, b], place, spawn, tick, sees } = await twoClients(500);
  try {
    place(a.selfId, 500, 500);
    place(b.selfId, 1900, 1900);
    const nearA = spawn(700, 500), nearB = spawn(1900, 1700), nowhere = spawn(1200, 1200);
    tick(5);
    assert.ok(sees(a, a.selfId) && sees(b, b.selfId), 'everyone sees themselves');
    assert.ok(sees(a, nearA) && !sees(a, nearB) && !sees(a, nowhere), 'A sees only what is near A');
    assert.ok(sees(b, nearB) && !sees(b, nearA) && !sees(b, nowhere), 'B sees only what is near B');
    assert.ok(!sees(a, b.selfId) && !sees(b, a.selfId), 'the two players are far apart and do not see each other');

    // an entity walking out of range disappears; hysteresis keeps it a little beyond the enter radius
    place(nearA, 500 + 540, 500); // 540 away: outside enter (500) but inside leave (575), and it was visible
    tick(3);
    assert.ok(sees(a, nearA), 'stays visible inside the hysteresis band');
    place(nearA, 500 + 700, 500);
    tick(3);
    assert.ok(!sees(a, nearA), 'removed once beyond the leave radius');
    place(nearA, 500 + 540, 500); // back in the band, but not visible before: must not reappear until inside 500
    tick(3);
    assert.ok(!sees(a, nearA), 'an entity outside the enter radius does not re-enter through the hysteresis band');
    place(nearA, 500 + 300, 500);
    tick(3);
    assert.ok(sees(a, nearA), 'visible again once inside the enter radius');

    // a destroyed entity is removed from views
    server.world.destroy(nearA);
    tick(3);
    assert.ok(!sees(a, nearA));
    assert.equal(a.predicted.stats.corrections, 0, 'prediction unaffected by interest filtering');
  } finally {
    await server.close();
  }
});

test('interest management cuts per-client bandwidth, and a budget holds it near the target', async () => {
  const whole = await runBandwidth({ bots: 250, clients: 3, viewRadius: Infinity, seconds: 10, seed: 3 });
  const focused = await runBandwidth({ bots: 250, clients: 3, viewRadius: 700, seconds: 10, seed: 3 });
  assert.ok(focused.kbpsPerClient < whole.kbpsPerClient * 0.4, `view 700: ${focused.kbpsPerClient.toFixed(1)} KB/s vs whole world ${whole.kbpsPerClient.toFixed(1)} KB/s`);
  assert.ok(focused.visibleAvg < whole.visibleAvg * 0.5, `sees ${focused.visibleAvg.toFixed(0)} instead of ${whole.visibleAvg.toFixed(0)}`);
  assert.ok(focused.tickMsAvg < whole.tickMsAvg, 'and the server tick gets cheaper');

  const budgetKBps = 12;
  const capped = await runBandwidth({ bots: 250, clients: 3, viewRadius: 700, bandwidth: budgetKBps * 1024, seconds: 12, seed: 3 });
  assert.ok(focused.kbpsPerClient > budgetKBps * 1.4, `the scene needs ${focused.kbpsPerClient.toFixed(1)} KB/s uncapped, so ${budgetKBps} KB/s really binds`);
  assert.ok(capped.kbpsPerClient < budgetKBps * 1.25, `capped at ${budgetKBps} KB/s, used ${capped.kbpsPerClient.toFixed(1)} KB/s`);
  assert.ok(capped.kbpsPerClient > budgetKBps * 0.6, `and uses most of it (${capped.kbpsPerClient.toFixed(1)} KB/s)`);
  assert.equal(capped.corrections, 0, 'the local player stays exactly predicted under a tight budget');
  assert.ok(capped.fullPct < focused.fullPct, 'deltas are effective once fewer entities change per tick');
  assert.ok(capped.clientSnapshots.every((n) => n > 400), `clients keep receiving snapshots (${capped.clientSnapshots.join(', ')})`);
});
