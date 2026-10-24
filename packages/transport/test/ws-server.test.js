import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import http from 'node:http';
import { listenWebSocket, FrameParser, OP, encodeFrame, encodeClose, acceptKey } from '../src/node.js';
import { connectWebSocket, CHANNEL } from '../src/index.js';
import { rawFrame } from './helpers.js';

const KEY = 'dGhlIHNhbXBsZSBub25jZQ==';

async function waitFor(cond, ms = 3000, what = 'condition') {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 5));
  }
}

/** Raw TCP client: does the HTTP upgrade by hand and parses server frames, so tests can misbehave. */
function rawConnect(port, { path = '/', headers = {}, version = '13', key = KEY, upgrade = true } = {}) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1');
    const rc = { socket, status: 0, headers: {}, messages: [], closes: [], pings: [], ended: false, closedAt: 0 };
    let head = Buffer.alloc(0);
    let parser = null;
    rc.send = (buf) => socket.write(buf);
    socket.on('error', () => {});
    socket.on('end', () => { rc.ended = true; });
    socket.on('close', () => { rc.ended = true; rc.closedAt = Date.now(); });
    socket.on('data', (chunk) => {
      if (parser) { try { parser.push(chunk); } catch (e) { rc.parseError = e; } return; }
      head = Buffer.concat([head, chunk]);
      const end = head.indexOf('\r\n\r\n');
      if (end < 0) return;
      const lines = head.subarray(0, end).toString().split('\r\n');
      rc.status = Number(lines[0].split(' ')[1]);
      for (const l of lines.slice(1)) { const i = l.indexOf(':'); rc.headers[l.slice(0, i).toLowerCase()] = l.slice(i + 1).trim(); }
      const rest = head.subarray(end + 4);
      if (rc.status === 101) {
        parser = new FrameParser({
          expectMasked: false,
          maxMessageSize: 1 << 24,
          onMessage: (p) => rc.messages.push(Buffer.from(p)),
          onPing: (p) => { rc.pings.push(Buffer.from(p)); if (rc.autoPong !== false) socket.write(encodeFrame(OP.PONG, p, -1, true)); },
          onClose: (code, reason) => rc.closes.push([code, reason]),
        });
        if (rest.length) parser.push(rest);
      }
      resolve(rc);
    });
    socket.on('connect', () => {
      const lines = [`GET ${path} HTTP/1.1`, 'Host: 127.0.0.1', 'Upgrade: websocket', 'Connection: Upgrade',
        `Sec-WebSocket-Key: ${key}`, `Sec-WebSocket-Version: ${version}`];
      if (!upgrade) lines.splice(2, 2);
      for (const [k, v] of Object.entries(headers)) lines.push(`${k}: ${v}`);
      socket.write(lines.join('\r\n') + '\r\n\r\n');
    });
    setTimeout(() => reject(new Error('rawConnect timeout')), 3000).unref();
  });
}

async function withServer(opts, fn) {
  const listener = await listenWebSocket(opts);
  try { await fn(listener); } finally { await listener.close(); }
}

test('handshake: correct accept key, subprotocol negotiation', async () => {
  await withServer({ subprotocol: 'game.v1' }, async (l) => {
    const rc = await rawConnect(l.port, { headers: { 'Sec-WebSocket-Protocol': 'other, game.v1' } });
    assert.equal(rc.status, 101);
    assert.equal(rc.headers['sec-websocket-accept'], acceptKey(KEY));
    assert.equal(rc.headers['sec-websocket-protocol'], 'game.v1');
    rc.socket.destroy();
  });
});

test('handshake rejections: path, version, key, plain HTTP, origin, per-IP limit', async () => {
  await withServer({ allowedOrigins: ['https://game.example'], maxConnectionsPerIp: 2 }, async (l) => {
    assert.equal((await rawConnect(l.port, { path: '/nope' })).status, 404);
    const v = await rawConnect(l.port, { version: '8' });
    assert.equal(v.status, 426);
    assert.equal(v.headers['sec-websocket-version'], '13');
    assert.equal((await rawConnect(l.port, { key: 'short' })).status, 400);
    assert.equal((await rawConnect(l.port, { upgrade: false })).status, 426, 'plain GET is told to upgrade');
    assert.equal((await rawConnect(l.port, { headers: { Origin: 'https://evil.example' } })).status, 403);
    const ok = await rawConnect(l.port, { headers: { Origin: 'https://game.example' } });
    assert.equal(ok.status, 101);
    const noOrigin = await rawConnect(l.port); // non-browser clients are allowed unless requireOrigin
    assert.equal(noOrigin.status, 101);
    assert.equal((await rawConnect(l.port)).status, 429, 'third connection from the same IP');
    ok.socket.destroy(); noOrigin.socket.destroy();
    await waitFor(() => l.connections.size === 0, 3000, 'connections to drop');
    const again = await rawConnect(l.port);
    assert.equal(again.status, 101, 'slot freed after disconnect');
    again.socket.destroy();

    const status = await new Promise((resolve) => http.get({ port: l.port, host: '127.0.0.1' }, (res) => { res.resume(); resolve(res.statusCode); }));
    assert.equal(status, 426, 'plain HTTP request');
  });
  await withServer({ requireOrigin: true }, async (l) => {
    assert.equal((await rawConnect(l.port)).status, 403);
  });
});

test('client adapter <-> server: both channels, tags, stats, big message, orderly close', async () => {
  await withServer({}, async (l) => {
    let server;
    const serverClosed = [];
    l.onConnection = (c) => {
      server = c;
      c.onMessage = (bytes, ch) => c.send(Uint8Array.from([...bytes].reverse()), ch); // echo reversed on the same channel
      c.onClose = (r) => serverClosed.push(r);
    };
    const client = connectWebSocket(`ws://127.0.0.1:${l.port}/`);
    assert.equal(client.state, 'connecting');
    const got = [];
    client.onMessage = (b, ch) => got.push([[...b], ch]);
    await waitFor(() => client.state === 'open', 3000, 'client open');
    const buf = Uint8Array.from([1, 2, 3]);
    client.send(buf, CHANNEL.RELIABLE);
    buf[0] = 99; // reusing the buffer must not affect what was sent
    client.send(Uint8Array.from([7, 8]), CHANNEL.UNRELIABLE);
    const big = new Uint8Array(60000).map((_, i) => i & 255);
    client.send(big, CHANNEL.RELIABLE);
    await waitFor(() => got.length === 3, 3000, 'echoes');
    assert.deepEqual(got[0], [[3, 2, 1], CHANNEL.RELIABLE]);
    assert.deepEqual(got[1], [[8, 7], CHANNEL.UNRELIABLE]);
    assert.equal(got[2][0].length, 60000);
    assert.equal(got[2][0][0], 59999 & 255);
    assert.equal(server.stats.receivedMessages, 3);
    assert.equal(client.stats.sentBytes, 3 + 2 + 60000);

    const clientClosed = [];
    client.onClose = (r) => clientClosed.push(r);
    client.close('bye');
    await waitFor(() => serverClosed.length === 1, 3000, 'server close');
    assert.equal(serverClosed[0], 'bye');
    assert.equal(server.state, 'closed');
    assert.equal(server.send(Uint8Array.from([1])), false);
    assert.equal(clientClosed.length, 1);
  });
});

test('server-initiated close reaches the client with its reason; shutdown closes everyone', async () => {
  const listener = await listenWebSocket({});
  let server;
  listener.onConnection = (c) => { server = c; };
  const a = connectWebSocket(`ws://127.0.0.1:${listener.port}/`);
  const b = connectWebSocket(`ws://127.0.0.1:${listener.port}/`);
  const reasons = {};
  a.onClose = (r) => { reasons.a = r; };
  b.onClose = (r) => { reasons.b = r; };
  await waitFor(() => a.state === 'open' && b.state === 'open' && listener.connections.size === 2, 3000, 'both open');
  [...listener.connections][0].close('kicked');
  await waitFor(() => reasons.a ?? reasons.b, 3000, 'kick');
  await listener.close();
  await waitFor(() => reasons.a && reasons.b, 3000, 'shutdown close');
  assert.ok(Object.values(reasons).includes('kicked'));
  assert.ok(Object.values(reasons).includes('server shutting down'));
  void server;
});

test('misbehaving clients are closed with the right code', async () => {
  await withServer({ maxPayload: 1000, maxMessagesPerSecond: 5, burstMessages: 5 }, async (l) => {
    const cases = [
      ['unmasked frame', (rc) => rc.send(rawFrame(OP.BINARY, Buffer.from([0, 1]), { mask: false })), 1002],
      ['text frame', (rc) => rc.send(rawFrame(OP.TEXT, Buffer.from('hi'))), 1003],
      ['bad channel tag', (rc) => rc.send(rawFrame(OP.BINARY, Buffer.from([7, 1]))), 1002],
      ['oversize message', (rc) => rc.send(rawFrame(OP.BINARY, Buffer.alloc(5000))), 1009],
      ['rate limit', (rc) => { for (let i = 0; i < 30; i++) rc.send(rawFrame(OP.BINARY, Buffer.from([1, i]))); }, 1008],
    ];
    for (const [name, act, code] of cases) {
      const rc = await rawConnect(l.port);
      assert.equal(rc.status, 101, name);
      act(rc);
      await waitFor(() => rc.closes.length > 0, 3000, `${name} close`);
      assert.equal(rc.closes[0][0], code, name);
      await waitFor(() => rc.ended, 3000, `${name} socket end`);
    }
  });
});

test('heartbeat: unresponsive clients are dropped, responsive ones stay and report RTT', async () => {
  await withServer({ pingIntervalMs: 30, pongTimeoutMs: 80 }, async (l) => {
    const closed = {};
    const conns = [];
    l.onConnection = (c) => { conns.push(c); c.onClose = (r) => { closed[conns.indexOf(c)] = r; }; };
    const dead = await rawConnect(l.port);
    dead.autoPong = false;
    const good = connectWebSocket(`ws://127.0.0.1:${l.port}/`);
    await waitFor(() => conns.length === 2, 3000, 'two connections');
    await waitFor(() => closed[0] === 'ping timeout', 3000, 'dead client dropped');
    await new Promise((r) => setTimeout(r, 250));
    assert.equal(closed[1], undefined, 'responsive client still connected');
    assert.ok(Number.isFinite(conns[1].rttMs) && conns[1].rttMs >= 0, `rtt ${conns[1].rttMs}`);
    good.close();
    dead.socket.destroy();
  });
});

test('client that stops reading: unreliable data is dropped, then the connection is cut', async () => {
  await withServer({ softSendLimit: 20_000, hardSendLimit: 400_000, pingIntervalMs: 60_000 }, async (l) => {
    let server;
    const closed = [];
    l.onConnection = (c) => { server = c; c.onClose = (r) => closed.push(r); };
    const rc = await rawConnect(l.port);
    rc.socket.pause(); // never reads
    await waitFor(() => server, 3000, 'server connection');
    const chunk = new Uint8Array(32_000);
    let sent = 0;
    while (server.state === 'open' && sent < 4000) { server.send(chunk, CHANNEL.UNRELIABLE); sent++; }
    assert.ok(server.stats.droppedMessages > 0, 'unreliable sends were dropped under backpressure');
    assert.equal(server.state, 'open', 'dropping unreliable data does not close the connection');
    for (let i = 0; i < 4000 && server.state === 'open'; i++) server.send(chunk, CHANNEL.RELIABLE);
    assert.equal(server.state, 'closed');
    assert.match(closed[0], /send buffer overflow/);
    rc.socket.destroy();
  });
});

test('data sent in the same TCP segment as the handshake is not lost', async () => {
  await withServer({}, async (l) => {
    const got = [];
    l.onConnection = (c) => { c.onMessage = (b, ch) => got.push([[...b], ch]); };
    const socket = net.connect(l.port, '127.0.0.1');
    await new Promise((r) => socket.on('connect', r));
    const req = `GET / HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${KEY}\r\nSec-WebSocket-Version: 13\r\n\r\n`;
    socket.write(Buffer.concat([Buffer.from(req), rawFrame(OP.BINARY, Buffer.from([1, 42]))]));
    await waitFor(() => got.length === 1, 3000, 'early message');
    assert.deepEqual(got[0], [[42], 1]);
    socket.destroy();
  });
});

test('a path function routes per URL and exposes the match as connection.route', async () => {
  const match = (p) => { const m = /^\/ws\/([a-z0-9-]{1,12})$/.exec(p); return m ? { room: m[1] } : p === '/ws' ? { room: 'lobby' } : false; };
  await withServer({ path: match }, async (l) => {
    const routes = [];
    l.onConnection = (c) => routes.push(c.route);
    const a = await rawConnect(l.port, { path: '/ws/alpha' });
    const b = await rawConnect(l.port, { path: '/ws' });
    assert.equal(a.status, 101); assert.equal(b.status, 101);
    assert.equal((await rawConnect(l.port, { path: '/ws/BADNAME' })).status, 404);
    assert.equal((await rawConnect(l.port, { path: '/elsewhere' })).status, 404);
    await waitFor(() => routes.length === 2, 3000, 'two routed connections');
    assert.deepEqual(routes, [{ room: 'alpha' }, { room: 'lobby' }]);
    a.socket.destroy(); b.socket.destroy();
  });
});
