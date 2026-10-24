import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startArenaServer } from '../server/arena-server.js';
import { ArenaClient } from '../client/net.js';
import { createSampleBuffer, sampleWorld } from '../client/interp.js';
import { buildWalls, buildWallHash, stepMover, WORLD, PLAYER_SPEED, netSchema } from '../shared/game.js';

async function waitFor(cond, ms = 3000, what = 'condition') {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 5));
  }
}

const open = async (server) => {
  const c = new ArenaClient({ url: `ws://127.0.0.1:${server.port}/ws` }).start();
  await waitFor(() => c.state === 'playing', 3000, 'handshake');
  return c;
};

test('map is deterministic, has bounded size and leaves the border closed', () => {
  const a = buildWalls(), b = buildWalls();
  assert.deepEqual(a, b);
  assert.ok(a.length > 10 && a.length < 200, `${a.length} walls`);
  const hash = buildWallHash(a);
  const p = { x: 100, y: 100 };
  for (let i = 0; i < 600; i++) stepMover(hash, p, 14, -1, -1, 5000, 1 / 60); // sprint into the corner at 83 units/tick
  assert.ok(p.x >= 40 + 14 - 0.01 && p.y >= 40 + 14 - 0.01, `stayed inside: ${p.x},${p.y}`);
  const q = { x: WORLD.w / 2, y: WORLD.h / 2 };
  const r = { x: 0, y: 0 };
  void r;
  for (let i = 0; i < 600; i++) stepMover(hash, q, 14, 1, 0.3, 5000, 1 / 60);
  assert.ok(q.x <= WORLD.w - 40 - 14 + 0.01 && q.y <= WORLD.h - 40 - 14 + 0.01);
});

test('server: handshake, spawn, authoritative movement, snapshots reach the client', async () => {
  const server = await startArenaServer({ port: 0, bots: 10, serveStatic: false, manualTicks: true, viewRadius: Infinity, resumeWindowMs: 0 });
  try {
    const c = await open(server);
    assert.ok(server.world.isAlive(c.selfId), 'player entity exists');
    // step the server and let snapshots flow
    const startX = () => server.world.data(netSchema.comps[0].component).x[c.selfId & 0xfffff];
    const x0 = startX();
    for (let i = 0; i < 30; i++) { c.sendInput(1, 0, 0); await new Promise((r) => setTimeout(r, 4)); }
    await waitFor(() => [...server.clients][0].queue.lastSeq >= 30, 3000, 'inputs queued');
    for (let i = 0; i < 40; i++) server.step();
    await waitFor(() => c.latestTick >= 40 && c.inputAck === 30, 3000, 'snapshots with the final ack');
    const moved = startX() - x0;
    // 30 inputs = 30 ticks at 420 u/s (7 u/tick), unless a wall is in the way
    assert.ok(moved > 0 && moved <= PLAYER_SPEED * 0.5 + 0.01, `moved ${moved}`);
    assert.equal([...server.clients][0].lastApplied, 30, 'every input applied exactly once, in order');
    assert.equal(c.predicted.stats.corrections, 0, 'prediction over a real WebSocket agrees with the server');
    // the client's last snapshot agrees with the server's world (within quantization)
    const out = createSampleBuffer();
    sampleWorld(c.history, c.latestTick, out);
    assert.equal(out.count, 11, '10 bots + the player');
    const i = [...out.ids.subarray(0, out.count)].indexOf(c.selfId);
    assert.ok(i >= 0);
    assert.ok(Math.abs(out.x[i] - server.world.data(netSchema.comps[0].component).x[c.selfId & 0xfffff]) < 0.05 + moved * 0);
    c.close();
    await waitFor(() => server.clients.size === 0, 3000, 'client removed');
    assert.ok(!server.world.isAlive(c.selfId), 'player entity despawned on disconnect');
  } finally {
    await server.close();
  }
});

test('server rejects a client with a mismatched schema', async () => {
  const server = await startArenaServer({ port: 0, bots: 0, serveStatic: false, manualTicks: true });
  try {
    const { connectWebSocket, CHANNEL } = await import('../../../packages/transport/src/index.js');
    const { BinaryWriter, encodeHello, decodeReject, BinaryReader, MSG } = await import('../../../packages/protocol/src/index.js');
    const t = connectWebSocket(`ws://127.0.0.1:${server.port}/ws`);
    let reject;
    t.onMessage = (b) => { if (b[0] === MSG.REJECT) reject = decodeReject(new BinaryReader(b)); };
    await waitFor(() => t.state === 'open');
    const w = new BinaryWriter();
    encodeHello(w, { schemaHash: 123, inputHash: 456 });
    t.send(w.finish(), CHANNEL.RELIABLE);
    await waitFor(() => reject, 3000, 'reject');
    assert.equal(reject.reason, 2);
    assert.equal(server.clients.size === 0 || [...server.clients].every((c) => !c.ready), true);
  } finally {
    await server.close();
  }
});

test('input before handshake or garbage closes the connection', async () => {
  const server = await startArenaServer({ port: 0, bots: 0, serveStatic: false, manualTicks: true });
  try {
    const { connectWebSocket, CHANNEL } = await import('../../../packages/transport/src/index.js');
    const t = connectWebSocket(`ws://127.0.0.1:${server.port}/ws`);
    let closed = false;
    t.onClose = () => { closed = true; };
    await waitFor(() => t.state === 'open');
    t.send(Uint8Array.from([4, 0, 0, 1, 0, 0, 0, 0]), CHANNEL.UNRELIABLE); // INPUT before HELLO
    await waitFor(() => closed, 3000, 'close');
  } finally {
    await server.close();
  }
});

test('real-time server loop ticks at the configured rate and serves static files', async () => {
  const server = await startArenaServer({ port: 0, bots: 20, tickRate: 60 });
  try {
    const c = await open(server);
    const t0 = server.tick;
    await new Promise((r) => setTimeout(r, 1000));
    const ticks = server.tick - t0;
    assert.ok(ticks >= 50 && ticks <= 70, `ran ${ticks} ticks in ~1 s`);
    assert.ok(c.stats.snapshots > 40, `client received ${c.stats.snapshots} snapshots`);
    assert.ok(server.stats.tickMsMax < 30, `max tick ${server.stats.tickMsMax} ms`);
    // `/` must lead to a page whose own relative script references load (regression: the page was once
    // served at `/`, so ./main.js resolved to /main.js and 404ed, leaving a dead page in the browser).
    const root = await fetch(`http://127.0.0.1:${server.port}/?lag=50`, { redirect: 'manual' });
    assert.equal(root.status, 302);
    assert.equal(root.headers.get('location'), '/examples/arena/client/index.html?lag=50', 'query string is preserved');
    const pageUrl = new URL(root.headers.get('location'), `http://127.0.0.1:${server.port}`);
    const html = await (await fetch(pageUrl)).text();
    assert.match(html, /<canvas|<div id="stage"/);
    const scripts = [...html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)].map((m) => new URL(m[1], pageUrl));
    assert.ok(scripts.length > 0);
    for (const u of scripts) assert.equal((await fetch(u)).status, 200, `${u.pathname} loads`);
    const js = await fetch(`http://127.0.0.1:${server.port}/packages/core/src/index.js`);
    assert.equal(js.status, 200);
    assert.equal((await fetch(`http://127.0.0.1:${server.port}/package.json`)).status, 404, 'repo root files are not served');
    assert.equal((await fetch(`http://127.0.0.1:${server.port}/packages/../package.json`)).status, 404);
    c.close();
  } finally {
    await server.close();
  }
});
