import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHANNEL, MemoryNetwork, tapTransport } from '../src/index.js';

test('tapTransport reports packets in both directions without changing behaviour', () => {
  const net = new MemoryNetwork({ link: { latencyMs: 25 } });
  let server;
  net.listen('g').onConnection = (c) => { server = c; };
  const client = net.connect('g');
  net.clock.runUntil(100);

  const events = [];
  const tapped = tapTransport(client, (e) => events.push([e.dir, [...e.bytes], e.channel, e.time]), () => net.clock.now());
  const got = [];
  tapped.onMessage = (b, ch) => got.push([[...b], ch]);
  server.onMessage = (b) => server.send(Uint8Array.from([...b].map((x) => x + 1)), CHANNEL.UNRELIABLE);

  const t0 = net.clock.now();
  assert.equal(tapped.send(Uint8Array.from([1, 2]), CHANNEL.RELIABLE), true);
  net.clock.runAll();
  assert.deepEqual(got, [[[2, 3], CHANNEL.UNRELIABLE]]);
  assert.deepEqual(events, [['out', [1, 2], CHANNEL.RELIABLE, t0], ['in', [2, 3], CHANNEL.UNRELIABLE, t0 + 50]]);
  assert.equal(tapped.state, 'open');

  tapped.close('x');
  assert.equal(tapped.send(Uint8Array.from([9])), false);
  assert.equal(events.length, 2, 'failed sends are not reported');
});
