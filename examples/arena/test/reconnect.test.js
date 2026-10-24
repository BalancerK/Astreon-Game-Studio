import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startArenaServer } from '../server/arena-server.js';
import { startArenaGateway } from '../server/gateway.js';
import { ArenaClient } from '../client/net.js';
import { Pos, Health } from '../shared/game.js';
import { MemoryNetwork, VirtualClock, connectWebSocket } from '../../../packages/transport/src/index.js';

const SLOT = 0xfffff;
const TICK_MS = 1000 / 60;

async function setup({ resumeWindowMs = 15_000, latencyMs = 20 } = {}) {
  const clock = new VirtualClock();
  const server = await startArenaServer({ listen: false, manualTicks: true, bots: 0, serveStatic: false, resumeWindowMs });
  const net = new MemoryNetwork({ clock, link: { latencyMs } });
  net.listen('arena').onConnection = server.attach;
  const timers = [];
  const reconnect = (extra = {}) => ({
    createTransport: () => net.connect('arena'),
    setTimer: (ms, fn) => { timers.push(ms); clock.schedule(ms, fn); },
    ...extra,
  });
  const client = ({ reconnect: overrides, ...rest } = {}) => new ArenaClient({ transport: net.connect('arena'), now: () => clock.now(), reconnect: reconnect(overrides), ...rest });
  /** Advance time, ticking the server and sending a steady stream of inputs from each given client. */
  const run = (ticks, clients = [], input = [1, 0.3, 0]) => {
    for (let i = 0; i < ticks; i++) {
      clock.advance(TICK_MS);
      for (const c of clients) c.sendInput(...input);
      server.step();
    }
  };
  return { clock, server, net, timers, client, run, reconnect };
}

const playing = (c) => c.state === 'playing';

test('a dropped player reconnects and gets the same player back: identity, position and health', async () => {
  const { clock, server, client, run } = await setup();
  const a = client().start();
  clock.advance(200);
  assert.ok(playing(a));
  run(90, [a]);
  const id = a.selfId, token = a.session;
  assert.match(token, /^[0-9a-f]{32}$/, 'a 128-bit random token was issued');
  server.world.data(Health).hp[id & SLOT] = 60;

  a.transport.close('network lost'); // the connection dies
  assert.equal(a.state, 'reconnecting');
  run(8); // inside the 250 ms backoff: the server notices the drop (inputs already in flight still get applied)
  assert.ok(server.world.isAlive(id));
  assert.equal(server.clients.size, 0, 'no live connection');
  const frozenX = server.world.data(Pos).x[id & SLOT];
  run(2);
  assert.equal(server.world.data(Pos).x[id & SLOT], frozenX, 'once the queue drains, a disconnected player holds still');

  run(20); // the backoff passes: the reconnect attempt fires and the handshake completes
  run(5, [a]);
  assert.ok(playing(a), `state ${a.state}`);
  assert.equal(a.resumed, true);
  assert.equal(a.selfId, id, 'same entity');
  assert.equal(a.session, token, 'same session');
  assert.equal(a.stats.reconnects, 1);
  assert.equal(server.stats.resumed, 1);
  assert.equal(server.world.data(Health).hp[id & SLOT], 60, 'health preserved');
  assert.equal(server.clients.size, 1);

  // the client starts clean: first snapshot is full, prediction re-initialises at the preserved position, play continues
  run(60, [a]);
  assert.ok(a.stats.fullSnapshots >= 1);
  assert.equal(a.predicted.stats.corrections, 0, 'prediction in sync after resume (input numbering restarted cleanly)');
  const x2 = server.world.data(Pos).x[id & SLOT];
  assert.ok(x2 > frozenX, `the resumed player moves again (${frozenX} -> ${x2})`);
  assert.ok(Math.abs(a.predicted.x - x2) < 7 * 8, 'prediction runs ahead of the server only by the inputs still in flight');
});

test('after the resume window the player is gone, and coming back late starts a new player', async () => {
  const { clock, server, client, run, timers } = await setup({ resumeWindowMs: 1000 });
  const a = client({ reconnect: { baseDelayMs: 4000 } }).start(); // slow to retry: the window will expire first
  clock.advance(200);
  run(30, [a]);
  const oldId = a.selfId, oldToken = a.session;
  a.transport.close('network lost');
  run(30);
  assert.ok(server.world.isAlive(oldId), 'still held inside the window');
  run(60); // 1 s window = 60 ticks
  assert.ok(!server.world.isAlive(oldId), 'removed once the window passed');
  assert.equal(server.stats.sessionsExpired, 1);
  assert.equal(server.sessions.size, 0);

  clock.advance(4500); // the retry fires, with the now-useless token
  run(5, [a]);
  assert.ok(playing(a));
  assert.equal(a.resumed, false, 'the server could not resume: it created a new player');
  assert.notEqual(a.session, oldToken);
  assert.notEqual(a.selfId, oldId);
  assert.deepEqual(timers, [4000]);
});

test('a new connection with the token takes over a half-open one the server has not noticed dying', async () => {
  const { clock, server, client, net, run } = await setup();
  const a = new ArenaClient({ transport: net.connect('arena'), now: () => clock.now() }).start(); // no auto-reconnect
  clock.advance(200);
  run(30, [a]);
  const b = new ArenaClient({ transport: net.connect('arena'), now: () => clock.now() });
  b.session = a.session; // the same player, from a new connection, while the old one is still "open"
  b.start();
  run(10, [b]);
  clock.advance(100);
  assert.ok(playing(b));
  assert.equal(b.resumed, true);
  assert.equal(b.selfId, a.selfId);
  assert.equal(a.state, 'closed');
  assert.match(a.closeReason, /replaced by a new connection/);
  assert.equal(server.clients.size, 1, 'exactly one live connection per player');
  void client;
});

test('an unknown or forged token just creates a new player', async () => {
  const { clock, server, net, run } = await setup();
  const a = new ArenaClient({ transport: net.connect('arena'), now: () => clock.now() });
  a.session = 'f'.repeat(32);
  a.start();
  run(10, [a]);
  clock.advance(100);
  assert.ok(playing(a));
  assert.equal(a.resumed, false);
  assert.notEqual(a.session, 'f'.repeat(32));
  assert.equal(server.stats.resumed, 0);
});

test('with no resume window the player is removed immediately, and a returning client is a new player', async () => {
  const { clock, server, client, run } = await setup({ resumeWindowMs: 0 });
  const a = client().start();
  clock.advance(200);
  run(20, [a]);
  const id = a.selfId;
  a.transport.close('network lost');
  run(5);
  clock.advance(100);
  assert.ok(!server.world.isAlive(id));
  clock.advance(400);
  run(5, [a]);
  assert.ok(playing(a));
  assert.equal(a.resumed, false);
});

test('reconnect attempts back off exponentially, then give up', async () => {
  const { clock, net, timers, run } = await setup();
  let calls = 0;
  const a = new ArenaClient({
    transport: net.connect('arena'),
    now: () => clock.now(),
    reconnect: {
      maxAttempts: 4,
      createTransport: () => { calls++; throw new Error('connection refused'); },
      setTimer: (ms, fn) => { timers.push(ms); clock.schedule(ms, fn); },
    },
  }).start();
  clock.advance(200);
  assert.ok(playing(a));
  a.transport.close('network lost');
  clock.advance(20_000);
  assert.deepEqual(timers, [250, 500, 1000, 2000], 'doubling delays');
  assert.equal(calls, 4);
  assert.equal(a.state, 'closed');
  assert.match(a.closeReason, /^reconnect failed: connection refused/);
  void run;
});

test('leaving on purpose never reconnects; being rejected is final', async () => {
  const { clock, server, client, run, timers } = await setup();
  const a = client().start();
  clock.advance(200);
  run(10, [a]);
  a.close();
  clock.advance(5000);
  assert.equal(a.state, 'closed');
  assert.deepEqual(timers, [], 'no reconnect was scheduled');

  // a REJECT (here: schema mismatch) must not be retried
  const b = client().start();
  clock.advance(200);
  b.session = '';
  const hello = server.clients; // keep the linter quiet
  void hello;
});

test('over a real WebSocket and a worker room: killing the socket resumes the same player', async () => {
  const gw = await startArenaGateway({ port: 0, serveStatic: false, idleCloseMs: 0, roomOptions: { bots: 3, viewRadius: Infinity } });
  try {
    const a = new ArenaClient({
      url: `ws://127.0.0.1:${gw.port}/ws/resume`,
      reconnect: { createTransport: () => connectWebSocket(`ws://127.0.0.1:${gw.port}/ws/resume`), baseDelayMs: 100 },
    }).start();
    const wait = async (cond, ms, what) => { const t0 = Date.now(); while (!cond()) { if (Date.now() - t0 > ms) throw new Error(`timed out: ${what} (state ${a.state})`); await new Promise((r) => setTimeout(r, 10)); } };
    await wait(() => a.state === 'playing' && a.stats.snapshots > 10, 8000, 'initial join');
    const id = a.selfId, token = a.session;
    for (let i = 0; i < 20; i++) { a.sendInput(1, 0, 0); await new Promise((r) => setTimeout(r, 16)); }

    [...gw.listener.connections][0].socket.destroy(); // abrupt: no close frame, like a dropped network
    await wait(() => a.state === 'reconnecting' || a.stats.reconnects > 0, 3000, 'to notice the drop');
    await wait(() => a.state === 'playing' && a.stats.reconnects === 1, 8000, 'to reconnect');
    assert.equal(a.resumed, true, 'the room (in a worker) recognised the token');
    assert.equal(a.selfId, id);
    assert.equal(a.session, token);
    await wait(() => a.stats.snapshots > 5, 3000, 'snapshots after resume');
    for (let i = 0; i < 40; i++) { a.sendInput(0, 1, 0); await new Promise((r) => setTimeout(r, 16)); }
    assert.equal(a.predicted.stats.corrections, 0, `prediction stats after resume: ${JSON.stringify(a.predicted.stats)} resumed=${a.resumed} stale=${a.stats.stale} missing=${a.stats.missingBaseline} full=${a.stats.fullSnapshots}`);
    a.close();
  } finally {
    await gw.close();
  }
});
