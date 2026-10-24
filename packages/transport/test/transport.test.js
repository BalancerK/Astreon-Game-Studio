import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHANNEL, VirtualClock, MemoryNetwork, LinkSimulator, createRng } from '../src/index.js';

const bytes = (...b) => Uint8Array.from(b);

/** Open a connected pair on a fresh network; returns {net, client, server}. */
function connect(opts = {}) {
  const net = new MemoryNetwork(opts);
  const listener = net.listen('game');
  const out = { net, client: null, server: null };
  listener.onConnection = (c) => { out.server = c; };
  out.client = net.connect('game');
  net.clock.runUntil(net.clock.now() + 1000);
  assert.ok(out.server, 'server end accepted');
  return out;
}

test('VirtualClock runs events in time then insertion order, including nested ones', () => {
  const c = new VirtualClock();
  const log = [];
  c.schedule(10, () => log.push('b'));
  c.schedule(5, () => { log.push('a'); c.schedule(1, () => log.push('a2')); });
  c.schedule(10, () => log.push('c'));
  c.advance(5);
  assert.deepEqual(log, ['a']);
  c.advance(100);
  assert.deepEqual(log, ['a', 'a2', 'b', 'c']);
  assert.equal(c.now(), 105);
  assert.equal(c.pending, 0);
  c.schedule(1, function again() { c.schedule(1, again); });
  assert.throws(() => c.runAll(100), /too many events/);
});

test('latency is exact and send copies the buffer', () => {
  const { net, client, server } = connect({ link: { latencyMs: 50 } });
  const got = [];
  server.onMessage = (b, ch) => got.push([net.clock.now(), [...b], ch]);
  const buf = bytes(1, 2, 3);
  const t0 = net.clock.now();
  client.send(buf, CHANNEL.UNRELIABLE);
  buf[0] = 99; // sender reuses its buffer
  net.clock.advance(49);
  assert.equal(got.length, 0);
  net.clock.advance(1);
  assert.deepEqual(got, [[t0 + 50, [1, 2, 3], CHANNEL.UNRELIABLE]]);
  assert.equal(client.stats.sentMessages, 1);
  assert.equal(server.stats.receivedBytes, 3);
});

test('reliable channel stays ordered and lossless under heavy loss and jitter', () => {
  const { net, client, server } = connect({ seed: 5, link: { latencyMs: 30, jitterMs: 40, loss: 0.5 } });
  const got = [];
  server.onMessage = (b) => got.push(b[0]);
  for (let i = 0; i < 100; i++) client.send(bytes(i), CHANNEL.RELIABLE);
  net.clock.runAll();
  assert.deepEqual(got, Array.from({ length: 100 }, (_, i) => i));
});

test('a lost reliable message blocks later ones (head-of-line blocking)', () => {
  const clock = new VirtualClock();
  // Script the random draws: the first reliable attempt is lost, everything else succeeds.
  const draws = [0];
  const rng = () => draws.shift() ?? 0.99;
  const link = new LinkSimulator(clock, rng, { latencyMs: 10, loss: 0.5, retransmitMs: 100 });
  const times = {};
  link.transmit(CHANNEL.RELIABLE, 1, () => { times.first = clock.now(); });
  link.transmit(CHANNEL.RELIABLE, 1, () => { times.second = clock.now(); });
  clock.runAll();
  assert.equal(times.first, 110);
  assert.ok(times.second >= times.first, `second (${times.second}) waited for first (${times.first})`);
});

test('unreliable channel drops, duplicates and reorders at roughly the configured rates', () => {
  const { net, client, server } = connect({ seed: 11, link: { latencyMs: 20, jitterMs: 30, loss: 0.2, duplicate: 0.1, reorder: 0.2 } });
  const seen = [];
  server.onMessage = (b) => seen.push(b[0] | (b[1] << 8));
  const N = 4000;
  for (let i = 0; i < N; i++) {
    client.send(bytes(i & 255, i >> 8), CHANNEL.UNRELIABLE);
    net.clock.advance(1);
  }
  net.clock.runAll();
  const unique = new Set(seen);
  const lossRate = 1 - unique.size / N;
  const dupRate = (seen.length - unique.size) / unique.size;
  let reordered = 0;
  for (let i = 1; i < seen.length; i++) if (seen[i] < seen[i - 1]) reordered++;
  assert.ok(lossRate > 0.15 && lossRate < 0.25, `loss ${lossRate}`);
  assert.ok(dupRate > 0.05 && dupRate < 0.15, `dup ${dupRate}`);
  assert.ok(reordered > 0, 'some packets arrived out of order');
});

test('same seed gives identical network behaviour', () => {
  const run = (seed) => {
    const { net, client, server } = connect({ seed, link: { latencyMs: 20, jitterMs: 30, loss: 0.3, reorder: 0.3 } });
    const seen = [];
    server.onMessage = (b) => seen.push([net.clock.now(), b[0]]);
    for (let i = 0; i < 200; i++) { client.send(bytes(i & 255), CHANNEL.UNRELIABLE); net.clock.advance(3); }
    net.clock.runAll();
    return JSON.stringify(seen);
  };
  assert.equal(run(3), run(3));
  assert.notEqual(run(3), run(4));
});

test('bandwidth limit serialises packets and tail-drops unreliable overflow', () => {
  const { net, client, server } = connect({ link: { bandwidthBps: 80000, maxQueueMs: 50 } }); // 10 KB/s
  const times = [];
  server.onMessage = () => times.push(net.clock.now());
  const t0 = net.clock.now();
  client.send(new Uint8Array(1000), CHANNEL.RELIABLE); // 100 ms on the wire
  client.send(new Uint8Array(1000), CHANNEL.RELIABLE);
  net.clock.runAll();
  assert.deepEqual(times.map((t) => Math.round(t - t0)), [100, 200]);

  times.length = 0;
  for (let i = 0; i < 10; i++) client.send(new Uint8Array(1000), CHANNEL.UNRELIABLE);
  net.clock.runAll();
  assert.ok(times.length > 0 && times.length < 10, `queue overflow dropped some (${times.length}/10 delivered)`);
});

test('connect fails for unknown address; listen rejects duplicates', () => {
  const net = new MemoryNetwork();
  assert.throws(() => net.connect('nowhere'), /no listener/);
  net.listen('a');
  assert.throws(() => net.listen('a'), /in use/);
});

test('unreliable packets arriving before the server accepts are dropped; reliable ones arrive after', () => {
  const net = new MemoryNetwork({ link: { latencyMs: 40, loss: 0.5, retransmitMs: 200 } });
  // Script draws: the accept (reliable) loses its first attempt, so it lands at 240 ms;
  // the unreliable packet (40 ms) beats it; the reliable message queues behind the accept.
  const draws = [0, 0.99];
  net.rng = () => draws.shift() ?? 0.99;
  const listener = net.listen('g');
  const got = [];
  listener.onConnection = (c) => { c.onMessage = (b) => got.push(b[0]); };
  const client = net.connect('g');
  client.send(bytes(1), CHANNEL.UNRELIABLE);
  client.send(bytes(2), CHANNEL.RELIABLE);
  net.clock.runAll();
  assert.deepEqual(got, [2]);
});

test('close is ordered after in-flight reliable data and notifies both sides once', () => {
  const { net, client, server } = connect({ link: { latencyMs: 30 } });
  const log = [];
  server.onMessage = (b) => log.push(`msg${b[0]}`);
  server.onClose = (r) => log.push(`server-close:${r}`);
  client.onClose = (r) => log.push(`client-close:${r}`);
  client.send(bytes(1));
  client.send(bytes(2));
  client.close('bye');
  client.close('again');
  assert.equal(client.send(bytes(3)), false);
  net.clock.runAll();
  assert.deepEqual(log, ['client-close:bye', 'msg1', 'msg2', 'server-close:bye']);
  assert.equal(server.state, 'closed');
  assert.equal(server.send(bytes(9)), false);
});

test('asymmetric up/down links', () => {
  const { net, client, server } = connect({ link: { up: { latencyMs: 10 }, down: { latencyMs: 90 } } });
  const t = {};
  server.onMessage = () => { t.up = net.clock.now(); };
  client.onMessage = () => { t.down = net.clock.now(); };
  const t0 = net.clock.now();
  client.send(bytes(1)); server.send(bytes(1));
  net.clock.runAll();
  assert.equal(t.up - t0, 10);
  assert.equal(t.down - t0, 90);
});

test('createRng is deterministic and uniform-ish', () => {
  const a = createRng(1), b = createRng(1);
  let sum = 0;
  for (let i = 0; i < 10000; i++) { const x = a(); assert.equal(x, b()); assert.ok(x >= 0 && x < 1); sum += x; }
  assert.ok(Math.abs(sum / 10000 - 0.5) < 0.02);
});

test('simulateLink delays both directions of a wrapped transport and keeps the contract', async () => {
  const { simulateLink } = await import('../src/index.js');
  const { net, client, server } = connect({ link: {} });
  const clock = net.clock;
  const wrapped = simulateLink(client, { up: { latencyMs: 40 }, down: { latencyMs: 70 }, clock });
  const t = {};
  server.onMessage = (b) => { t.up = clock.now(); server.send(b, CHANNEL.UNRELIABLE); };
  wrapped.onMessage = (b, ch) => { t.down = clock.now(); t.ch = ch; t.bytes = [...b]; };
  const t0 = clock.now();
  const buf = bytes(7, 8);
  assert.equal(wrapped.send(buf, CHANNEL.UNRELIABLE), true);
  buf[0] = 0; // caller may reuse the buffer
  clock.runAll();
  assert.equal(t.up - t0, 40);
  assert.equal(t.down - t0, 40 + 70);
  assert.deepEqual(t.bytes, [7, 8]);
  assert.equal(t.ch, CHANNEL.UNRELIABLE);
  assert.equal(wrapped.state, 'open');
  const closed = [];
  wrapped.onClose = (r) => closed.push(r);
  wrapped.close('bye');
  assert.equal(wrapped.send(bytes(1)), false);
  assert.deepEqual(closed, ['bye']);
});
