import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSignalingServer } from '../src/node.js';
import { ServerSignaling, connectSignalingServer, connectWebSocket, listenWebRTC, connectWebRTC, CHANNEL } from '../src/index.js';
import { FakePeerConnection } from './fake-rtc.js';

const rtc = { RTCPeerConnection: FakePeerConnection };
const wait = (ms = 0) => new Promise((r) => setTimeout(r, ms));
async function waitFor(cond, ms = 3000, what = 'condition') {
  const t0 = Date.now();
  while (!cond()) { if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`); await wait(3); }
}
const enc = new TextEncoder(), dec = new TextDecoder();
const start = async (o = {}) => { const s = await createSignalingServer({ port: 0, ...o }); return { s, url: `ws://127.0.0.1:${s.port}/` }; };

/** A raw protocol client: sends JSON, collects what comes back. */
function raw(url) {
  const t = connectWebSocket(url); const got = []; let closed = '';
  t.onMessage = (b) => got.push(JSON.parse(dec.decode(b))); t.onClose = (w) => { closed = w; };
  return { t, got, send: (o) => t.send(enc.encode(JSON.stringify(o)), CHANNEL.RELIABLE), get closed() { return closed; }, open: new Promise((r) => { t.onOpen = r; }) };
}

test('hosting makes a room with a code; a duplicate or bad code is refused', async () => {
  const { s, url } = await start();
  try {
    const a = raw(url); await a.open; a.send({ t: 'host' }); await waitFor(() => a.got.length === 1);
    assert.equal(a.got[0].t, 'hosted'); assert.match(a.got[0].room, /^[A-Z2-9]{5}$/); assert.equal(s.rooms.size, 1);
    const b = raw(url); await b.open; b.send({ t: 'host', room: a.got[0].room.toLowerCase() }); await waitFor(() => b.closed); assert.equal(b.got[0].reason, 'room is taken');
    const c = raw(url); await c.open; c.send({ t: 'host', room: 'no way' }); await waitFor(() => c.closed); assert.match(c.got[0].reason, /letters and digits/);
    const d = raw(url); await d.open; d.send({ t: 'host', room: 'MyRoom1', max: 2 }); await waitFor(() => d.got.length === 1); assert.equal(d.got[0].room, 'MYROOM1', 'codes are upper case');
    a.t.close(); await waitFor(() => s.rooms.size === 1); d.t.close(); await waitFor(() => s.rooms.size === 0, 3000, 'rooms gone');
  } finally { await s.close(); }
});

test('joining, relaying, and leaving: only the host and its peers talk, and each hears the right things', async () => {
  const { s, url } = await start();
  try {
    const h = raw(url); await h.open; h.send({ t: 'host', room: 'GAME1' }); await waitFor(() => h.got.length === 1);
    const p1 = raw(url), p2 = raw(url); await p1.open; await p2.open;
    p1.send({ t: 'join', room: 'game1' }); await waitFor(() => p1.got.length === 1 && h.got.length === 2);
    assert.deepEqual([p1.got[0].t, p1.got[0].room, p1.got[0].id], ['joined', 'GAME1', 'p1']); assert.deepEqual(h.got[1], { t: 'peer', id: p1.got[0].id });
    p2.send({ t: 'join', room: 'GAME1' }); await waitFor(() => p2.got.length === 1 && h.got.length === 3);
    p1.send({ t: 'signal', data: { t: 'answer', sdp: 'x' } }); await waitFor(() => h.got.length === 4); assert.deepEqual(h.got[3], { t: 'signal', from: p1.got[0].id, data: { t: 'answer', sdp: 'x' } });
    h.send({ t: 'signal', to: p2.got[0].id, data: { t: 'offer', sdp: 'y' } }); await waitFor(() => p2.got.length === 2); assert.deepEqual(p2.got[1], { t: 'signal', data: { t: 'offer', sdp: 'y' } });
    await wait(30); assert.equal(p1.got.length, 1, 'the other player heard nothing');
    h.send({ t: 'signal', to: 'p99', data: { t: 'x' } }); await wait(30);
    p1.t.close(); await waitFor(() => h.got.some((m) => m.t === 'left')); assert.equal(h.got.find((m) => m.t === 'left').id, 'p1');
    h.t.close(); await waitFor(() => p2.closed); assert.equal(s.rooms.size, 0, 'the room goes with the host');
  } finally { await s.close(); }
});

test('refusals: no such room, a full room, nonsense, a stranger signalling, a second request', async () => {
  const { s, url } = await start({ maxPeersPerRoom: 1 });
  try {
    const h = raw(url); await h.open; h.send({ t: 'host', room: 'SMALL', max: 5 }); await waitFor(() => h.got.length === 1);
    const lost = raw(url); await lost.open; lost.send({ t: 'join', room: 'ZZZZZ' }); await waitFor(() => lost.closed); assert.equal(lost.got[0].reason, 'no such room');
    const p1 = raw(url); await p1.open; p1.send({ t: 'join', room: 'SMALL' }); await waitFor(() => p1.got.length === 1);
    const p2 = raw(url); await p2.open; p2.send({ t: 'join', room: 'SMALL' }); await waitFor(() => p2.closed); assert.equal(p2.got[0].reason, 'room is full', 'the server\'s own limit wins over the room\'s');
    const junk = raw(url); await junk.open; junk.t.send(enc.encode('not json'), CHANNEL.RELIABLE); await waitFor(() => junk.closed); assert.equal(junk.got[0].reason, 'bad message');
    const weird = raw(url); await weird.open; weird.send({ t: 'fly' }); await waitFor(() => weird.closed); assert.equal(weird.got[0].reason, 'unknown request');
    const stranger = raw(url); await stranger.open; stranger.send({ t: 'signal', data: {} }); await waitFor(() => stranger.closed); assert.equal(stranger.got[0].reason, 'bad message');
    p1.send({ t: 'host' }); await waitFor(() => p1.closed); assert.equal(p1.got.at(-1).reason, 'unexpected message');
    const nodata = raw(url); await nodata.open; nodata.send({ t: 'host', room: 'NODAT' }); await waitFor(() => nodata.got.length === 1); nodata.send({ t: 'signal', to: 'p1', data: 'a string' }); await waitFor(() => nodata.closed); assert.equal(nodata.got.at(-1).reason, 'bad message');
  } finally { await s.close(); }
});

test('the list shows public rooms only, with their size, and the server has limits of its own', async () => {
  const { s, url } = await start({ maxRooms: 2 });
  try {
    const open = raw(url), hidden = raw(url); await open.open; await hidden.open;
    open.send({ t: 'host', room: 'OPEN1', public: true, name: 'Ana\'s game', max: 4 }); hidden.send({ t: 'host', room: 'HIDE1' }); await waitFor(() => open.got.length === 1 && hidden.got.length === 1);
    const p = raw(url); await p.open; p.send({ t: 'join', room: 'OPEN1' }); await waitFor(() => p.got.length === 1);
    const provider = connectSignalingServer(url); assert.ok(provider instanceof ServerSignaling);
    assert.deepEqual(await provider.list(), [{ room: 'OPEN1', name: 'Ana\'s game', peers: 1, max: 4 }]);
    const third = raw(url); await third.open; third.send({ t: 'host' }); await waitFor(() => third.closed); assert.equal(third.got[0].reason, 'server is full');
    const idle = await createSignalingServer({ port: 0, idleMs: 80 }); const quiet = raw(`ws://127.0.0.1:${idle.port}/`); await quiet.open; await waitFor(() => quiet.closed, 2000, 'idle drop'); assert.equal(quiet.closed, 'idle'); await idle.close();
  } finally { await s.close(); }
});

test('only the pages you allow may use the server', async () => {
  const s = await createSignalingServer({ port: 0, allowedOrigins: ['https://mygame.example'] });
  try {
    const net = await import('node:net');
    const attempt = (origin) => new Promise((resolve) => {
      const sock = net.connect(s.port, '127.0.0.1');
      sock.on('data', (d) => { resolve(String(d).split('\r\n')[0]); sock.destroy(); });
      sock.write(`GET / HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\nOrigin: ${origin}\r\n\r\n`);
    });
    assert.match(await attempt('https://evil.example'), /403/); assert.match(await attempt('https://mygame.example'), /101/);
  } finally { await s.close(); }
});

test('browsers play through it: host and join with the server as the go-between, then it is no longer needed', async () => {
  FakePeerConnection.reset();
  const { s, url } = await start();
  try {
    const provider = connectSignalingServer(url);
    const listener = await listenWebRTC(provider, { rtc, maxPeers: 2, isPublic: true, name: 'Test' }); listener.onConnection = (c) => { c.onMessage = (d, ch) => c.send(d, ch); };
    assert.match(listener.room, /^[A-Z2-9]{5}$/); assert.equal((await provider.list())[0].room, listener.room);
    const client = connectWebRTC(provider, listener.room, { rtc }); const got = []; client.onMessage = (d) => got.push(Array.from(d)); client.onOpen = () => client.send(Uint8Array.of(8, 8), CHANNEL.UNRELIABLE);
    await waitFor(() => got.length === 1, 10_000, 'echo'); assert.deepEqual(got[0], [8, 8]);
    await waitFor(() => s.rooms.get(listener.room).peers.size === 0, 2000, 'the player\'s signalling connection is closed once connected');
    const gone = connectWebRTC(provider, 'ZZZZZ', { rtc }); const w = []; gone.onClose = (x) => w.push(x); await waitFor(() => w.length === 1); assert.match(w[0], /no such room/);
    listener.close(); await waitFor(() => s.rooms.size === 0);
    const dead = connectWebRTC(connectSignalingServer('ws://127.0.0.1:1/', { timeoutMs: 500 }), 'ABCDE', { rtc }); const w2 = []; dead.onClose = (x) => w2.push(x); await waitFor(() => w2.length === 1, 3000); assert.match(w2[0], /signalling server|could not reach/);
  } finally { await s.close(); }
});
