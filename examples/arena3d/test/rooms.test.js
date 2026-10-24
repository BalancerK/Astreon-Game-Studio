import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startArena3dServer } from '../server/arena3d-server.js';
import { startArena3dGateway } from '../server/gateway.js';
import { Arena3dClient } from '../client/net.js';
import { Pos3, Health } from '../shared/game.js';
import { MemoryNetwork, VirtualClock, connectWebSocket } from '../../../packages/transport/src/index.js';

const SLOT = 0xfffff;
const TICK_MS = 1000 / 60;

async function setup({ resumeWindowMs = 15_000, latencyMs = 20 } = {}) {
  const clock = new VirtualClock();
  const server = await startArena3dServer({ listen: false, manualTicks: true, bots: 0, resumeWindowMs, viewRadius: Infinity });
  const net = new MemoryNetwork({ clock, link: { latencyMs } });
  net.listen('arena').onConnection = server.attach;
  const timers = [];
  const reconnect = (extra = {}) => ({
    createTransport: () => net.connect('arena'),
    setTimer: (ms, fn) => { timers.push(ms); clock.schedule(ms, fn); },
    ...extra,
  });
  const client = ({ reconnect: overrides, ...rest } = {}) => new Arena3dClient({ transport: net.connect('arena'), now: () => clock.now(), reconnect: reconnect(overrides), ...rest });
  /** Advance time, ticking the server and sending a steady stream of inputs (walk forward) from each given client. */
  const run = (ticks, clients = [], input = [0, 1, 0, 0, 0]) => {
    for (let i = 0; i < ticks; i++) {
      clock.advance(TICK_MS);
      for (const c of clients) c.sendInput(...input);
      server.step();
    }
  };
  return { clock, server, net, timers, client, run };
}

const playing = (c) => c.state === 'playing';

test('a dropped player reconnects and gets the same character back: identity, position and health', async () => {
  const { clock, server, client, run } = await setup();
  const a = client().start();
  clock.advance(200);
  assert.ok(playing(a));
  run(90, [a]);
  const id = a.selfId, token = a.session;
  assert.match(token, /^[0-9a-f]{32}$/, 'a 128-bit random token was issued');
  server.world.data(Health).hp[id & SLOT] = 60;

  a.transport.close('network lost');
  assert.equal(a.state, 'reconnecting');
  run(8); // inside the 250 ms backoff: inputs already in flight are still applied
  assert.ok(server.world.isAlive(id));
  assert.equal(server.clients.size, 0, 'no live connection');
  run(2);
  const frozen = { x: server.world.data(Pos3).x[id & SLOT], z: server.world.data(Pos3).z[id & SLOT] };
  run(10);
  assert.equal(server.world.data(Pos3).z[id & SLOT], frozen.z, 'a disconnected player holds still');

  run(20); // the backoff passes: the reconnect attempt fires and the handshake completes
  run(5, [a]);
  assert.ok(playing(a), `state ${a.state}`);
  assert.equal(a.resumed, true);
  assert.equal(a.selfId, id, 'same entity');
  assert.equal(a.session, token, 'same session');
  assert.equal(a.stats.reconnects, 1);
  assert.equal(server.stats.resumed, 1);
  assert.equal(server.world.data(Health).hp[id & SLOT], 60, 'health preserved');
  assert.equal(server.bodies.size, 1, 'no second body was created');

  run(60, [a]);
  assert.ok(a.stats.fullSnapshots >= 1, 'the new connection starts from a full snapshot');
  assert.equal(a.predicted.stats.corrections, 0, 'prediction is in sync after the resume (input numbering restarted cleanly)');
  assert.ok(server.world.data(Pos3).z[id & SLOT] < frozen.z - 1, 'the resumed player walks on from where they stopped');
});

test('after the resume window the character is removed, and coming back late starts a new one', async () => {
  const { clock, server, client, run, timers } = await setup({ resumeWindowMs: 1000 });
  const a = client({ reconnect: { baseDelayMs: 4000 } }).start();
  clock.advance(200);
  run(30, [a]);
  const oldId = a.selfId, oldToken = a.session;
  a.transport.close('network lost');
  run(30);
  assert.ok(server.world.isAlive(oldId), 'still held inside the window');
  run(60);
  assert.ok(!server.world.isAlive(oldId), 'removed once the window passed');
  assert.equal(server.bodies.size, 0, 'its body is gone too');
  assert.equal(server.stats.sessionsExpired, 1);
  assert.equal(server.sessions.size, 0);

  clock.advance(4500);
  run(5, [a]);
  assert.ok(playing(a));
  assert.equal(a.resumed, false);
  assert.notEqual(a.session, oldToken);
  assert.deepEqual(timers, [4000]);
});

test('a new connection with the token takes over a half-open one; a forged token makes a new player', async () => {
  const { clock, server, net, run } = await setup();
  const a = new Arena3dClient({ transport: net.connect('arena'), now: () => clock.now() }).start();
  clock.advance(200);
  run(30, [a]);
  const b = new Arena3dClient({ transport: net.connect('arena'), now: () => clock.now() });
  b.session = a.session;
  b.start();
  run(10, [b]);
  clock.advance(100);
  assert.ok(playing(b));
  assert.equal(b.resumed, true);
  assert.equal(b.selfId, a.selfId);
  assert.equal(a.state, 'closed');
  assert.match(a.closeReason, /replaced by a new connection/);
  assert.equal(server.clients.size, 1, 'exactly one live connection per player');

  const c = new Arena3dClient({ transport: net.connect('arena'), now: () => clock.now() });
  c.session = 'f'.repeat(32);
  c.start();
  run(10, [b, c]);
  clock.advance(100);
  assert.ok(playing(c));
  assert.equal(c.resumed, false);
  assert.notEqual(c.selfId, a.selfId);
  assert.equal(server.stats.resumed, 1);
});

test('with no resume window the player is removed at once; leaving on purpose never reconnects', async () => {
  const { clock, server, client, run, timers } = await setup({ resumeWindowMs: 0 });
  const a = client().start();
  clock.advance(200);
  run(20, [a]);
  const id = a.selfId;
  a.transport.close('network lost');
  run(5);
  clock.advance(100);
  assert.ok(!server.world.isAlive(id));
  assert.equal(server.bodies.size, 0);
  clock.advance(500);
  run(5, [a]);
  assert.ok(playing(a));
  assert.equal(a.resumed, false);

  const before = timers.length;
  a.close();
  clock.advance(10_000);
  assert.equal(a.state, 'closed');
  assert.equal(timers.length, before, 'no reconnect was scheduled');
});

test('a resumed character keeps its shot cooldown, so reconnecting does not reset the weapon', async () => {
  const { clock, server, client, run } = await setup();
  const a = client().start();
  clock.advance(200);
  run(30, [a]);
  run(1, [a], [0, 0, 4, 0, 0]); // fire once
  run(4, [a]);
  assert.equal(server.stats.shots, 1);
  a.transport.close('network lost');
  run(2);
  const sess = [...server.sessions.values()][0];
  assert.ok(sess.cooldownLeft > 0, `cooldown carried in the session (${sess.cooldownLeft})`);
});

test('gateway: rooms are separate worlds, listed at /rooms, and a real socket resumes the same player', async () => {
  const gw = await startArena3dGateway({ port: 0, mode: 'worker', idleCloseMs: 0, roomOptions: { bots: 2, viewRadius: Infinity } });
  const clients = [];
  try {
    const wait = async (cond, ms, what) => { const t0 = Date.now(); while (!cond()) { if (Date.now() - t0 > ms) throw new Error(`timed out: ${what}`); await new Promise((r) => setTimeout(r, 10)); } };
    const join = (room) => {
      const url = `ws://127.0.0.1:${gw.port}/ws/${room}`;
      const c = new Arena3dClient({ url, reconnect: { createTransport: () => connectWebSocket(url), baseDelayMs: 100 } }).start();
      clients.push(c);
      return c;
    };
    const a = join('alpha'), b = join('beta'), a2 = join('alpha');
    await wait(() => [a, b, a2].every((c) => c.state === 'playing' && c.stats.snapshots > 5), 10_000, 'joins');
    const list = (await (await fetch(`http://127.0.0.1:${gw.port}/rooms`)).json()).rooms;
    const count = (name) => list.find((r) => r.name === name)?.players;
    assert.equal(count('alpha'), 2);
    assert.equal(count('beta'), 1);
    const seen = (c) => { const s = c.history.latest(); return s ? s.count : 0; };
    assert.ok(seen(a) >= 3 && seen(b) >= 3, 'each room has its own bots');

    const id = a.selfId, token = a.session;
    for (let i = 0; i < 20; i++) { a.sendInput(0, 1, 0, 0, 0); await new Promise((r) => setTimeout(r, 16)); }
    [...gw.listener.connections].find((c) => c.route.room === 'alpha' && true)?.socket.destroy(); // abrupt, like a dropped network
    await wait(() => a.stats.reconnects > 0 || a2.stats.reconnects > 0, 8000, 'a reconnect');
    const dropped = [a, a2].find((c) => c.stats.reconnects > 0);
    await wait(() => playing(dropped), 8000, 'playing again');
    assert.equal(dropped.resumed, true, 'the room recognised the token');
    if (dropped === a) { assert.equal(a.selfId, id); assert.equal(a.session, token); }
  } finally {
    for (const c of clients) c.close();
    await gw.close();
  }
});
