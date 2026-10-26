import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connectWebTransport, CHANNEL, encodeMessage, MessageParser, StreamError } from '../src/index.js';
import { listenWebTransport, createSelfSignedCert, certificateHash } from '../src/node.js';
import { createFakeWt } from './fake-wt.js';

async function waitFor(cond, ms = 3000, what = 'condition') {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 5));
  }
}
const bytes = (...n) => Uint8Array.from(n);

test('stream messages carry their length, whatever the pieces they arrive in; an empty one is not delivered; a huge one is refused', () => {
  const got = [];
  const parser = new MessageParser({ maxMessageSize: 100, onMessage: (b) => got.push(Array.from(b)) });
  const wire = new Uint8Array([...encodeMessage(bytes(1, 2, 3)), ...encodeMessage(bytes()), ...encodeMessage(bytes(9)), ...encodeMessage(new Uint8Array(50).fill(7))]);
  for (let i = 0; i < wire.length; i += 3) parser.push(wire.subarray(i, i + 3));       // three bytes at a time
  assert.deepEqual(got.slice(0, 2), [[1, 2, 3], [9]]);
  assert.equal(got[2].length, 50);
  assert.equal(got.length, 3);
  assert.throws(() => parser.push(encodeMessage(new Uint8Array(101))), StreamError);
  const p2 = new MessageParser({ onMessage: (b) => got.push(Array.from(b)) });
  const first = encodeMessage(bytes(5, 5));
  p2.push(first.subarray(0, 5)); p2.push(first.subarray(5));
  assert.deepEqual(got.at(-1), [5, 5]);
});

test('a client and a server (with a pretend QUIC) talk on both channels, and a payload too big for a datagram goes the reliable way', async () => {
  const fake = createFakeWt({ maxDatagramSize: 100 });
  const listener = await listenWebTransport({ implementation: fake, cert: 'c', privKey: 'k', port: 0, path: '/wt' });
  const serverGot = [];
  let serverConn = null;
  listener.onConnection = (conn) => { serverConn = conn; conn.onMessage = (b, ch) => serverGot.push([Array.from(b), ch]); };
  const client = connectWebTransport(`https://127.0.0.1:${listener.port}/wt`, { WebTransportImpl: fake.WebTransport, statsEveryMs: 0 });
  const clientGot = [];
  client.onMessage = (b, ch) => clientGot.push([Array.from(b), ch]);
  let opened = false; client.onOpen = () => { opened = true; };
  await waitFor(() => opened && serverConn, 2000, 'both ends open');
  assert.equal(client.state, 'open');
  client.send(bytes(1, 2), CHANNEL.RELIABLE);
  client.send(bytes(3), CHANNEL.UNRELIABLE);
  client.send(new Uint8Array(500).fill(4), CHANNEL.UNRELIABLE);                   // too big for a datagram of 100
  await waitFor(() => serverGot.length === 3, 2000, 'three messages at the server');
  assert.deepEqual(serverGot.find(([b]) => b.length === 2), [[1, 2], CHANNEL.RELIABLE]);
  assert.deepEqual(serverGot.find(([b]) => b.length === 1), [[3], CHANNEL.UNRELIABLE]);
  assert.equal(serverGot.find(([b]) => b.length === 500)[1], CHANNEL.RELIABLE, 'the big one went on the stream');
  assert.equal(client.stats.oversize, 1);
  serverConn.send(bytes(8, 8), CHANNEL.RELIABLE); serverConn.send(bytes(9), CHANNEL.UNRELIABLE);
  await waitFor(() => clientGot.length === 2, 2000, 'two messages at the client');
  assert.equal(listener.connections.size, 1);
  let reason = null; serverConn.onClose = (r) => { reason = r; };
  client.close('bye');
  await waitFor(() => serverConn.state === 'closed' && reason !== null, 2000, 'the server noticing');
  assert.equal(client.state, 'closed');
  await waitFor(() => listener.connections.size === 0, 1000, 'the list of connections emptying');
  await listener.close();
});

test('lost datagrams do not hold anything up: reliable messages sent after them still arrive in order and at once', async () => {
  const fake = createFakeWt({ drop: (dir, b) => b[0] % 2 === 0 });                  // every datagram that starts with an even number is lost
  const listener = await listenWebTransport({ implementation: fake, cert: 'c', privKey: 'k', path: '/wt' });
  const got = [];
  listener.onConnection = (conn) => { conn.onMessage = (b, ch) => got.push([b[0], ch]); };
  const client = connectWebTransport(`https://127.0.0.1:${listener.port}/wt`, { WebTransportImpl: fake.WebTransport, statsEveryMs: 0 });
  await waitFor(() => client.state === 'open' && listener.connections.size === 1, 2000, 'open');
  for (let i = 1; i <= 10; i++) { client.send(bytes(i), CHANNEL.UNRELIABLE); client.send(bytes(100 + i), CHANNEL.RELIABLE); }
  await waitFor(() => got.filter(([, ch]) => ch === CHANNEL.RELIABLE).length === 10, 2000, 'the ten reliable ones');
  await waitFor(() => got.filter(([, ch]) => ch === CHANNEL.UNRELIABLE).length === 5, 2000, 'the five datagrams that were not lost');
  assert.deepEqual(got.filter(([, ch]) => ch === CHANNEL.RELIABLE).map(([b]) => b), [101, 102, 103, 104, 105, 106, 107, 108, 109, 110], 'in order, none lost');
  assert.deepEqual(got.filter(([, ch]) => ch === CHANNEL.UNRELIABLE).map(([b]) => b), [1, 3, 5, 7, 9], 'half of the datagrams are gone, and nobody waited for them');
  client.close(); await listener.close();
});

test('a server that is not there ends the connection with a reason, and a missing implementation or certificate is said plainly', async () => {
  const fake = createFakeWt();
  const client = connectWebTransport('https://127.0.0.1:1/wt', { WebTransportImpl: fake.WebTransport });
  const why = await new Promise((resolve) => { client.onClose = resolve; });
  assert.match(why, /no server|could not/);
  assert.throws(() => connectWebTransport('https://x/', { WebTransportImpl: null }), /no WebTransport/);
  await assert.rejects(listenWebTransport({ implementation: { Http3Server: fake.Http3Server } }), /cert and privKey|selfSigned/);
  await assert.rejects(listenWebTransport({ implementation: {}, cert: 'c', privKey: 'k' }), /optional packages/);
});

test('connections beyond the limit are closed, and a self-signed certificate is made, trusted by hash, replaced on request and announced', async () => {
  const fake = createFakeWt();
  const listener = await listenWebTransport({ implementation: fake, selfSigned: { hosts: ['localhost', '127.0.0.1'], days: 7 }, path: '/wt', maxConnections: 1 });
  const first = listener.certificateHash;
  assert.match(first, /^[A-Za-z0-9+/]{43}=$/, 'a sha-256 hash as base64');
  assert.ok(listener.certificateExpires > new Date(Date.now() + 6 * 86_400_000));
  let announced = null; listener.onCertificate = (h) => { announced = h; };
  const next = listener.rotateCertificate();
  assert.notEqual(next, first); assert.equal(announced, next); assert.equal(listener.certificateHash, next);
  const a = connectWebTransport(`https://127.0.0.1:${listener.port}/wt`, { WebTransportImpl: fake.WebTransport, statsEveryMs: 0 });
  await waitFor(() => listener.connections.size === 1, 2000, 'the first');
  const b = connectWebTransport(`https://127.0.0.1:${listener.port}/wt`, { WebTransportImpl: fake.WebTransport, statsEveryMs: 0 });
  const why = await new Promise((resolve) => { b.onClose = resolve; });
  assert.match(why, /full|closed/);
  assert.equal(listener.connections.size, 1);
  a.close(); await listener.close();
});

test('a certificate for a hash-trusting page: elliptic curve, at most thirteen days, the names asked for, and the hash matches', () => {
  const c = createSelfSignedCert({ hosts: ['game.example', '203.0.113.7'], days: 5 });
  assert.equal(c.hash, certificateHash(c.cert));
  assert.ok(c.notAfter - c.notBefore < 6 * 86_400_000 && c.notAfter - c.notBefore > 4 * 86_400_000);
  assert.match(c.cert, /BEGIN CERTIFICATE/); assert.match(c.privKey, /PRIVATE KEY/);
  assert.throws(() => createSelfSignedCert({ days: 30 }), RangeError);
});

// The same, over a real QUIC connection, when the optional package is installed (npm install --no-save @fails-components/webtransport @fails-components/webtransport-transport-http3-quiche), or
// found by setting WT_PACKAGE to where it is.
let real = null;
try { real = await import(process.env.WT_PACKAGE ?? '@fails-components/webtransport'); } catch { /* not installed: the test below is skipped */ }
test('over real QUIC: a client and a server exchange both kinds of message, and a datagram round trip is quick', { skip: real ? false : 'optional package @fails-components/webtransport is not installed' }, async () => {
  const listener = await listenWebTransport({ implementation: real, selfSigned: { hosts: ['localhost', '127.0.0.1'] }, host: '127.0.0.1', path: '/wt' });
  try {
    let serverConn = null; const serverGot = [];
    listener.onConnection = (c) => { serverConn = c; c.onMessage = (b, ch) => { serverGot.push([Array.from(b), ch]); if (ch === CHANNEL.UNRELIABLE) c.send(b, CHANNEL.UNRELIABLE); }; };
    const client = connectWebTransport(`https://127.0.0.1:${listener.port}/wt`, { WebTransportImpl: real.WebTransport, certificateHashes: [listener.certificateHash], statsEveryMs: 0 });
    const clientGot = []; client.onMessage = (b, ch) => clientGot.push([Array.from(b), ch]);
    await waitFor(() => client.state === 'open' && serverConn, 8000, 'a real session');
    client.send(bytes(1, 2, 3), CHANNEL.RELIABLE);
    const t0 = performance.now();
    client.send(bytes(7), CHANNEL.UNRELIABLE);
    await waitFor(() => clientGot.some(([b, ch]) => b[0] === 7 && ch === CHANNEL.UNRELIABLE), 4000, 'the datagram echo');
    assert.ok(performance.now() - t0 < 500, `the echo took ${(performance.now() - t0).toFixed(0)} ms`);
    await waitFor(() => serverGot.some(([b]) => b.length === 3), 4000, 'the stream message');
    serverConn.send(new Uint8Array(5000).fill(2), CHANNEL.UNRELIABLE);               // too big for a datagram: comes by the stream
    await waitFor(() => clientGot.some(([b]) => b.length === 5000), 4000, 'the big message');
    client.close('done');
  } finally { await listener.close(); }
});
