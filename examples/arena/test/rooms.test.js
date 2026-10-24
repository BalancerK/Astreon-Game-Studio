import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startArenaGateway } from '../server/gateway.js';
import { ArenaClient } from '../client/net.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(cond, ms = 5000, what = 'condition') {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`);
    await sleep(5);
  }
}

const gateway = (opts = {}) => startArenaGateway({ port: 0, host: '127.0.0.1', serveStatic: false, idleCloseMs: 0, roomOptions: { bots: 5, viewRadius: Infinity }, ...opts });

async function join(gw, room) {
  const c = new ArenaClient({ url: `ws://127.0.0.1:${gw.port}/ws/${room}` }).start();
  await waitFor(() => c.state === 'playing' && c.stats.snapshots > 5, 8000, `join ${room}`);
  return c;
}

/** Longest gap (ms) between new server ticks arriving at this client over a window. */
function watchGaps(client) {
  let last = client.latestTick, lastAt = performance.now(), max = 0;
  const timer = setInterval(() => {
    const now = performance.now();
    if (client.latestTick !== last) { max = Math.max(max, now - lastAt); last = client.latestTick; lastAt = now; }
    else max = Math.max(max, now - lastAt);
  }, 4);
  return { stop: () => { clearInterval(timer); return max; }, reset: () => { max = 0; lastAt = performance.now(); } };
}

test('rooms are separate worlds: routing by path, independent entities, listing', async () => {
  const gw = await gateway({ mode: 'worker' });
  try {
    await gw.manager.ensureRoom('alpha', { bots: 5 });
    await gw.manager.ensureRoom('beta', { bots: 20 });
    const [a, b] = await Promise.all([join(gw, 'alpha'), join(gw, 'beta')]);
    await sleep(300);
    // viewRadius is unlimited, so each client sees its whole room: 5 bots + player vs 20 bots + player
    assert.equal(a.history.latest().count, 6, 'alpha: 5 bots + the player');
    assert.equal(b.history.latest().count, 21, 'beta: 20 bots + the player');
    const list = Object.fromEntries(gw.manager.list().map((r) => [r.name, r]));
    assert.equal(list.alpha.players, 1);
    assert.equal(list.beta.players, 1);
    assert.equal(list.alpha.mode, 'worker');
    await waitFor(() => gw.manager.list().every((r) => r.tick > 0), 3000, 'room stats');
    a.close(); b.close();
    await waitFor(() => gw.manager.list().every((r) => r.players === 0), 3000, 'players to leave');
  } finally {
    await gw.close();
  }
});

test('data crosses the thread boundary intact: prediction over a worker room needs no corrections', async () => {
  const gw = await gateway({ mode: 'worker' });
  try {
    const c = await join(gw, 'solo');
    const t0 = performance.now();
    while (performance.now() - t0 < 1800) { c.sendInput(1, 0.4, 0); await sleep(16); }
    await sleep(300);
    assert.ok(c.predicted.stats.reconciles > 60, `reconciled ${c.predicted.stats.reconciles} times`);
    assert.equal(c.predicted.stats.corrections, 0, 'the proxy changes no bytes');
    assert.equal(c.stats.protocolErrors, 0);
    c.close();
  } finally {
    await gw.close();
  }
});

test('isolation: a stalled room does not disturb another room (worker mode) - but does inline, which is the point', async () => {
  const run = async (mode) => {
    const gw = await gateway({ mode });
    try {
      const [ca, cb] = await Promise.all([join(gw, 'a'), join(gw, 'b')]);
      await sleep(600);
      const ga = watchGaps(ca), gb = watchGaps(cb);
      await sleep(400);
      ga.reset(); gb.reset();
      gw.manager.rooms.get('a').handle.control({ stall: 700 }); // room "a" burns CPU for 700 ms in one tick
      await sleep(1800);
      const result = { a: ga.stop(), b: gb.stop(), bTicks: cb.latestTick };
      ca.close(); cb.close();
      return result;
    } finally {
      await gw.close();
    }
  };
  const worker = await run('worker');
  assert.ok(worker.a >= 600, `the stalled room itself froze for ${worker.a.toFixed(0)} ms`);
  assert.ok(worker.b < 120, `the other room's longest gap between ticks was ${worker.b.toFixed(0)} ms (normal is ~17)`);

  const inline = await run('inline');
  assert.ok(inline.b >= 550, `inline: the other room also froze (${inline.b.toFixed(0)} ms), proving the test can detect interference`);
});

test('crash containment: a crashing room disconnects only its own players and can be restarted', async () => {
  const gw = await gateway({ mode: 'worker' });
  try {
    const [ca, cb] = await Promise.all([join(gw, 'a'), join(gw, 'b')]);
    const gb = watchGaps(cb);
    await sleep(300);
    gb.reset();
    gw.manager.rooms.get('a').handle.control({ crash: true });
    await waitFor(() => ca.state === 'closed', 5000, 'room a players to be disconnected');
    assert.match(ca.closeReason, /crash/, `reason: ${ca.closeReason}`);
    await sleep(500);
    assert.equal(cb.state, 'playing', 'the other room is unaffected');
    assert.ok(gb.stop() < 120, 'and keeps ticking smoothly');
    assert.equal(gw.manager.stats.crashed, 1);
    assert.ok(!gw.manager.list().some((r) => r.name === 'a'), 'the dead room is gone from the list');

    const again = await join(gw, 'a'); // a fresh room is started on demand
    assert.equal(again.state, 'playing');
    again.close(); cb.close();
  } finally {
    await gw.close();
  }
});

test('limits: players per room, number of rooms, unknown rooms, and idle cleanup', async () => {
  const gw = await gateway({ mode: 'worker', maxPlayers: 2, maxRooms: 2, idleCloseMs: 400 });
  try {
    const p1 = await join(gw, 'x'), p2 = await join(gw, 'x');
    const p3 = new ArenaClient({ url: `ws://127.0.0.1:${gw.port}/ws/x` }).start();
    await waitFor(() => p3.state === 'closed' || p3.state === 'rejected', 5000, 'third player to be refused');
    assert.match(p3.closeReason, /room full/);
    const room2 = await join(gw, 'y');
    const p4 = new ArenaClient({ url: `ws://127.0.0.1:${gw.port}/ws/z` }).start();
    await waitFor(() => p4.state === 'closed', 5000, 'third room to be refused');
    assert.match(p4.closeReason, /too many rooms/);
    assert.equal(gw.manager.stats.rejected, 2);

    // names are validated at the door
    const bad = new ArenaClient({ url: `ws://127.0.0.1:${gw.port}/ws/BAD!name` }).start();
    await waitFor(() => bad.state === 'closed', 5000, 'bad room name to be refused');

    p1.close(); p2.close(); room2.close();
    await waitFor(() => gw.manager.list().length === 0, 5000, 'idle rooms to be closed');
    const reborn = await join(gw, 'x'); // joining again simply starts a new room
    assert.equal(gw.manager.list()[0].players, 1);
    reborn.close();
  } finally {
    await gw.close();
  }

  const closed = await gateway({ mode: 'worker', maxRooms: 4 });
  closed.manager.autoCreate = false;
  try {
    const c = new ArenaClient({ url: `ws://127.0.0.1:${closed.port}/ws/nothere` }).start();
    await waitFor(() => c.state === 'closed', 5000, 'unknown room to be refused');
    assert.match(c.closeReason, /no such room/);
  } finally {
    await closed.close();
  }
});

test('shutdown is prompt and leaves no workers behind', async () => {
  const gw = await gateway({ mode: 'worker' });
  const clients = await Promise.all(['r1', 'r2', 'r3'].map((r) => join(gw, r)));
  const t0 = Date.now();
  await gw.close();
  assert.ok(Date.now() - t0 < 4000, `closed in ${Date.now() - t0} ms`);
  await waitFor(() => clients.every((c) => c.state === 'closed'), 3000, 'clients to be disconnected');
  assert.equal(gw.manager.rooms.size, 0);
});

// ---- process mode: each room in its own OS process ----

test('process mode: routing, prediction over IPC, and a stalled room does not disturb another', async () => {
  const gw = await gateway({ mode: 'process', roomHost: { memoryMb: 256 } });
  try {
    const [a, b] = await Promise.all([join(gw, 'a'), join(gw, 'b')]);
    await waitFor(() => gw.manager.list().every((r) => r.tick > 0 && r.pid), 5000, 'room stats');
    const rows = gw.manager.list();
    assert.ok(rows.every((r) => r.mode === 'process' && r.pid !== process.pid), 'each room reports its own process');
    assert.notEqual(rows[0].pid, rows[1].pid, 'and they are different processes');
    const t0 = performance.now();
    while (performance.now() - t0 < 1500) { a.sendInput(1, 0.4, 0); await sleep(16); }
    await sleep(300);
    assert.equal(a.predicted.stats.corrections, 0, 'the IPC proxy changes no bytes');
    assert.equal(a.stats.protocolErrors, 0);

    const ga = watchGaps(a), gb = watchGaps(b);
    await sleep(300);
    ga.reset(); gb.reset();
    gw.manager.rooms.get('a').handle.control({ stall: 700 });
    await sleep(1600);
    assert.ok(ga.stop() >= 600, 'the stalled room itself froze');
    assert.ok(gb.stop() < 120, 'the other room kept ticking');
    a.close(); b.close();
  } finally {
    await gw.close();
  }
});

test('process mode: a crashing room disconnects only its players, its process is gone, and the name can be reused', async () => {
  const gw = await gateway({ mode: 'process' });
  try {
    const [ca, cb] = await Promise.all([join(gw, 'a'), join(gw, 'b')]);
    await waitFor(() => gw.manager.list().every((r) => r.pid), 5000, 'pids');
    const pid = gw.manager.rooms.get('a').handle.pid;
    gw.manager.rooms.get('a').handle.control({ crash: true });
    await waitFor(() => ca.state === 'closed', 5000, 'room a players to be disconnected');
    assert.match(ca.closeReason, /room exited/, ca.closeReason);
    await waitFor(() => { try { process.kill(pid, 0); return false; } catch { return true; } }, 3000, 'process to end');
    assert.equal(cb.state, 'playing');
    const again = await join(gw, 'a');
    assert.equal(again.state, 'playing');
    again.close(); cb.close();
  } finally {
    await gw.close();
  }
});

test('process mode with confinement and mods: rooms run under the permission model and still load script mods', async () => {
  const modsDir = new URL('../mods', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
  const gw = await gateway({ mode: 'process', modsDir: decodeURIComponent(modsDir), roomHost: { confine: true, memoryMb: 256 }, serveStatic: true });
  try {
    const base = `http://127.0.0.1:${gw.port}`;
    const c = new ArenaClient({ url: `ws://127.0.0.1:${gw.port}/ws/modded`, fetchMod: async (id, hash) => (await fetch(`${base}/mods/${id}/${hash}`)).json() }).start();
    await waitFor(() => c.state === 'playing' && c.stats.snapshots > 5, 10_000, 'join a confined, modded room');
    assert.deepEqual(c.mods.map((m) => m.id), ['fast-weapons', 'neon-theme']);
    assert.equal(c.rules.playerSpeed, 480);
    const t0 = performance.now();
    while (performance.now() - t0 < 1200) { c.sendInput(1, 0.2, 0); await sleep(16); }
    assert.equal(c.predicted.stats.corrections, 0, 'rules agree across server process, client and mods');
    c.close();
  } finally {
    await gw.close();
  }
});
