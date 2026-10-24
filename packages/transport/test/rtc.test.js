import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CHANNEL, RtcTransport, Negotiation, LoopbackSignaling, BroadcastSignaling, listenWebRTC, connectWebRTC, createInvitation, acceptInvitation, encodeCode, decodeCode, makeRoomCode, isRoomCode, ROOM_ALPHABET,
} from '../src/index.js';
import { FakePeerConnection } from './fake-rtc.js';

const rtc = { RTCPeerConnection: FakePeerConnection };
const wait = (ms = 0) => new Promise((r) => setTimeout(r, ms));
async function waitFor(cond, ms = 2000, what = 'condition') {
  const t0 = Date.now();
  while (!cond()) { if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`); await wait(2); }
}
const reset = () => FakePeerConnection.reset();
const bytes = (...v) => Uint8Array.from(v);

/** Two negotiations wired straight to each other (no signalling). */
function pair(options = {}) {
  let a, b;
  a = new Negotiation({ offerer: true, peerId: 'b', send: (m) => queueMicrotask(() => b.receive(m)), options: { rtc, ...options } });
  b = new Negotiation({ offerer: false, peerId: 'a', send: (m) => queueMicrotask(() => a.receive(m)), options: { rtc, ...options } });
  return { a, b };
}

test('two peers negotiate and get a transport each, open and talking', async () => {
  reset();
  const { a, b } = pair(); a.start();
  const [ta, tb] = await Promise.all([a.transport, b.transport]);
  assert.equal(ta.state, 'open'); assert.equal(tb.state, 'open'); assert.ok(ta instanceof RtcTransport);
  const got = []; tb.onMessage = (data, ch) => got.push([Array.from(data), ch]);
  ta.send(bytes(1, 2, 3), CHANNEL.RELIABLE); ta.send(bytes(9), CHANNEL.UNRELIABLE);
  await waitFor(() => got.length === 2, 1000, 'two messages');
  assert.deepEqual(got.sort((x, y) => x[1] - y[1]), [[[1, 2, 3], CHANNEL.RELIABLE], [[9], CHANNEL.UNRELIABLE]]);
  assert.deepEqual([ta.stats.sentMessages, ta.stats.sentBytes, tb.stats.receivedMessages, tb.stats.receivedBytes], [2, 4, 2, 4]);
});

test('the channels are what the engine expects: reliable and ordered, unreliable and unordered with no retransmits, negotiated by id', async () => {
  reset();
  const { a, b } = pair(); a.start(); await Promise.all([a.transport, b.transport]);
  const [rel, unrel] = a.channels.reliable ? [a.channels.reliable, a.channels.unreliable] : [];
  assert.deepEqual([rel.ordered, rel.id, rel.negotiated, rel.label], [true, 0, true, 'reliable']);
  assert.deepEqual([unrel.ordered, unrel.maxRetransmits, unrel.id, unrel.negotiated, unrel.label], [false, 0, 1, true, 'unreliable']);
  assert.equal(a.channels.reliable.binaryType, 'arraybuffer');
});

test('send copies the bytes (the buffer can be reused at once) and refuses what it should', async () => {
  reset();
  const { a, b } = pair({ maxMessageBytes: 100 }); a.start(); const [ta, tb] = await Promise.all([a.transport, b.transport]);
  const got = []; tb.onMessage = (d) => got.push(Array.from(d));
  const buf = bytes(1, 2, 3); ta.send(buf); buf[0] = 99; await waitFor(() => got.length === 1);
  assert.deepEqual(got[0], [1, 2, 3]); assert.equal(ta.send(new Uint8Array(101)), false, 'over the size limit'); assert.equal(ta.stats.droppedMessages, 1);
  ta.close('bye'); assert.equal(ta.send(bytes(1)), false, 'closed');
});

test('unreliable messages are dropped when the queue is full; a reliable queue that grows without end closes the connection', async () => {
  reset();
  const { a, b } = pair({ softSendLimit: 1000, hardSendLimit: 5000 }); a.start(); const [ta] = await Promise.all([a.transport, b.transport]);
  ta.channels.unreliable.bufferedAmount = 2000;
  assert.equal(ta.send(bytes(1), CHANNEL.UNRELIABLE), true, 'reported as sent (dropped on purpose)'); assert.equal(ta.stats.droppedMessages, 1); assert.equal(ta.stats.sentMessages, 0);
  ta.channels.unreliable.bufferedAmount = 0; ta.send(bytes(1), CHANNEL.UNRELIABLE); assert.equal(ta.stats.sentMessages, 1);
  let closed = ''; ta.onClose = (why) => { closed = why; };
  ta.channels.reliable.bufferedAmount = 6000; assert.equal(ta.send(bytes(1), CHANNEL.RELIABLE), false); assert.equal(closed, 'send queue overflow'); assert.equal(ta.state, 'closed');
});

test('what arrives that should not: text, oversized messages', async () => {
  reset();
  const { a, b } = pair({ maxMessageBytes: 50 }); a.start(); const [ta, tb] = await Promise.all([a.transport, b.transport]);
  let reason = ''; tb.onClose = (why) => { reason = why; };
  ta.channels.reliable.remote.onmessage?.({ data: 'text' });          // as if the other end had sent a string
  assert.equal(reason, 'bad message');
  const c = pair({ maxMessageBytes: 50 }); c.a.start(); const [tc, td] = await Promise.all([c.a.transport, c.b.transport]);
  let why2 = ''; td.onClose = (w) => { why2 = w; }; tc.maxOverride = true; tc.opts.maxMessageBytes = 1000; tc.send(new Uint8Array(200));
  await waitFor(() => why2 !== ''); assert.equal(why2, 'message too large');
});

test('closing: either end, with the reason, once', async () => {
  reset();
  const { a, b } = pair(); a.start(); const [ta, tb] = await Promise.all([a.transport, b.transport]);
  const reasons = []; ta.onClose = (w) => reasons.push(['a', w]); tb.onClose = (w) => reasons.push(['b', w]);
  ta.close('done'); ta.close('again'); await waitFor(() => reasons.length === 2);
  assert.deepEqual(reasons.map((r) => r[0]).sort(), ['a', 'b']); assert.equal(reasons.find((r) => r[0] === 'a')[1], 'done'); assert.equal(tb.state, 'closed'); assert.equal(reasons.length, 2, 'once each');
  assert.equal(a.pc.closed, true, 'the peer connection is closed too');
});

test('connection states: failed closes at once, disconnected is forgiven for a moment, closed ends it', async () => {
  reset();
  const timers = { fns: [], setTimeout(fn, ms) { this.fns.push({ fn, ms }); return this.fns.length; }, clearTimeout(id) { if (this.fns[id - 1]) this.fns[id - 1].dead = true; } };
  const { a, b } = pair({ timers, disconnectGraceMs: 3000 }); a.start(); const [ta, tb] = await Promise.all([a.transport, b.transport]);
  const reasons = []; ta.onClose = (w) => reasons.push(w);
  a.pc.setState('disconnected'); assert.equal(ta.state, 'open'); const grace = timers.fns.at(-1); assert.equal(grace.ms, 3000);
  a.pc.setState('connected'); assert.equal(grace.dead, true, 'it came back: the timer is cancelled');
  a.pc.setState('disconnected'); const second = timers.fns.at(-1); second.fn(); assert.deepEqual(reasons, ['connection lost']);
  const c = pair(); c.a.start(); const [tc] = await Promise.all([c.a.transport, c.b.transport]); const r2 = []; tc.onClose = (w) => r2.push(w); c.a.pc.setState('failed'); assert.deepEqual(r2, ['connection failed']);
  void tb;
});

test('the round trip time comes from the browser\'s statistics', async () => {
  reset();
  const { a, b } = pair(); a.start(); const [ta] = await Promise.all([a.transport, b.transport]);
  assert.ok(Number.isNaN(ta.rttMs)); assert.equal(await ta.measureRtt(), 42); assert.equal(ta.rttMs, 42); ta.close(); assert.equal(await ta.measureRtt(), null);
});

test('negotiation: candidates that arrive early are held, a bad offer fails it, and it gives up when nothing connects', async () => {
  reset();
  const fns = []; const timers = { setTimeout: (fn, ms) => { fns.push({ fn, ms }); return fns.length; }, clearTimeout: () => {} };
  const sent = []; const n = new Negotiation({ offerer: false, send: (m) => sent.push(m), options: { rtc, timers, connectTimeoutMs: 5000 } });
  await n.receive({ t: 'ice', candidate: { candidate: 'candidate:early', sdpMid: '0', sdpMLineIndex: 0 } });
  assert.equal(n.pending.length, 1, 'held until the offer'); assert.equal(fns[0].ms, 5000);
  const peer = new FakePeerConnection(); await peer.setLocalDescription(await peer.createOffer());
  await n.receive({ t: 'offer', sdp: peer.localDescription.sdp }); await wait(5);
  assert.ok(sent.some((m) => m.t === 'answer')); assert.equal(n.pending.length, 0, 'flushed'); assert.equal(n.pc.candidatesAdded.length, 1);
  fns[0].fn(); await assert.rejects(n.transport, /timed out connecting/); assert.equal(n.rtcTransport.state, 'closed');
  const bad = new Negotiation({ offerer: false, send: () => {}, options: { rtc } }); await bad.receive({ t: 'offer', sdp: 'garbage' }); await assert.rejects(bad.transport, /negotiation failed/);
  const ignore = new Negotiation({ offerer: true, send: () => {}, options: { rtc } }); await ignore.receive({ t: 'offer', sdp: 'v=0\r\no=fake x\r\n' }); await ignore.receive(null); await ignore.receive({ t: 'weird' }); assert.equal(ignore.done, false, 'an offerer ignores offers and junk'); ignore.cancel('stop'); await assert.rejects(ignore.transport, /stop/);
  assert.throws(() => new Negotiation({ offerer: true, send: () => {}, options: { rtc: {} } }), /no RTCPeerConnection/);
});

test('peers that cannot reach each other time out and are closed with a reason', async () => {
  reset(); FakePeerConnection.blocked = true;
  const { a, b } = pair({ connectTimeoutMs: 60 }); a.start();
  await assert.rejects(a.transport, /timed out connecting/); await assert.rejects(b.transport, /timed out connecting/);
  assert.equal(a.rtcTransport.state, 'closed');
});

test('room codes: easy to read out, easy to check', () => {
  const code = makeRoomCode(); assert.equal(code.length, 5); assert.ok([...code].every((c) => ROOM_ALPHABET.includes(c))); assert.ok(!/[01OIL]/.test(ROOM_ALPHABET));
  assert.equal(makeRoomCode(8, () => 0), 'AAAAAAAA'); assert.ok(isRoomCode('K7QXD') && isRoomCode('abc') && !isRoomCode('ab') && !isRoomCode('a b c') && !isRoomCode(5) && !isRoomCode('x'.repeat(17)));
});

test('a room on loopback signalling: host, join, and the host sees every player as a transport', async () => {
  reset();
  const signaling = new LoopbackSignaling();
  const listener = await listenWebRTC(signaling, { rtc, maxPeers: 3, room: 'ABCDE' });
  assert.equal(listener.room, 'ABCDE');
  const seen = []; listener.onConnection = (conn) => { seen.push(conn); conn.onMessage = (d, ch) => conn.send(d, ch); };
  const clients = [connectWebRTC(signaling, 'abcde', { rtc }), connectWebRTC(signaling, 'ABCDE', { rtc })];
  const echoes = clients.map(() => []); clients.forEach((c, i) => { c.onMessage = (d) => echoes[i].push(Array.from(d)); c.onOpen = () => c.send(bytes(i + 1, 7)); });
  await waitFor(() => echoes.every((e) => e.length === 1), 2000, 'echoes');
  assert.deepEqual(echoes, [[[1, 7]], [[2, 7]]]); assert.equal(seen.length, 2); assert.equal(listener.peers.size, 2); assert.equal(listener.pending, 0); assert.deepEqual(seen.map((t) => t.peerId).sort(), ['p1', 'p2']);
  clients[0].close('leaving'); await waitFor(() => listener.peers.size === 1, 1000, 'one left'); assert.equal(seen[0].state, 'closed');
  listener.close(); await waitFor(() => clients[1].state === 'closed'); assert.equal(listener.peers.size, 0);
  await assert.rejects(signaling.join('ABCDE'), /no room/);
});

test('a room that does not exist, a room that is full, and a host who leaves first, all say why', async () => {
  reset();
  const signaling = new LoopbackSignaling();
  const lost = connectWebRTC(signaling, 'NOPE1', { rtc }); const why = []; lost.onClose = (w) => why.push(w); await waitFor(() => why.length === 1); assert.match(why[0], /no room NOPE1/);
  const listener = await listenWebRTC(signaling, { rtc, maxPeers: 1, room: 'FULL1' }); listener.onConnection = () => {};
  const first = connectWebRTC(signaling, 'FULL1', { rtc }); await waitFor(() => first.state === 'open');
  const second = connectWebRTC(signaling, 'FULL1', { rtc }); const w2 = []; second.onClose = (w) => w2.push(w); await waitFor(() => w2.length === 1); assert.match(w2[0], /full/);
  await assert.rejects(listenWebRTC(signaling, { rtc, room: 'FULL1' }), /taken/); await assert.rejects(listenWebRTC(signaling, { rtc, room: 'x y' }), /letters and digits/);
  listener.close();
  FakePeerConnection.blocked = true; const l2 = await listenWebRTC(signaling, { rtc, room: 'LATE1' }); const late = connectWebRTC(signaling, 'LATE1', { rtc }); const w3 = []; late.onClose = (w) => w3.push(w);
  await wait(10); l2.close(); await waitFor(() => w3.length === 1); assert.match(w3[0], /host left|closed/);
});

test('players beyond the limit are turned away while others are still connecting', async () => {
  reset();
  const signaling = new LoopbackSignaling();
  const listener = await listenWebRTC(signaling, { rtc, maxPeers: 2, room: 'TWO22' }); const got = []; listener.onConnection = (c) => got.push(c);
  const players = ['a', 'b', 'c'].map(() => connectWebRTC(signaling, 'TWO22', { rtc })); const reasons = players.map(() => ''); players.forEach((p, i) => { p.onClose = (w) => { reasons[i] = w; }; });
  await waitFor(() => got.length === 2 && reasons.some(Boolean), 2000, 'two in, one out'); assert.equal(reasons.filter(Boolean).length, 1); assert.match(reasons.find(Boolean), /full/);
});

test('tabs of one site find each other through a BroadcastChannel', async () => {
  reset();
  const hostSide = new BroadcastSignaling({ prefix: 'test-rtc-1' }), guestSide = new BroadcastSignaling({ prefix: 'test-rtc-1', joinTimeoutMs: 400 });
  const listener = await listenWebRTC(hostSide, { rtc, room: 'TABS1' }); listener.onConnection = (c) => { c.onMessage = (d) => c.send(d); };
  await assert.rejects(new BroadcastSignaling({ prefix: 'test-rtc-1' }).host({ room: 'TABS1' }), /taken/);
  const c = connectWebRTC(guestSide, 'TABS1', { rtc }); const got = []; c.onMessage = (d) => got.push(Array.from(d)); c.onOpen = () => c.send(bytes(5, 5));
  await waitFor(() => got.length === 1, 3000, 'echo'); assert.deepEqual(got[0], [5, 5]);
  const lost = connectWebRTC(guestSide, 'NONE9', { rtc }); const w = []; lost.onClose = (x) => w.push(x); await waitFor(() => w.length === 1, 2000); assert.match(w[0], /no room/);
  listener.close(); c.close(); await wait(20);
});

test('invitation codes: encode, decode, and say what is wrong with a bad one', () => {
  const sdp = 'v=0\r\no=fake abc\r\na=candidate:1 café\r\n';
  const code = encodeCode('offer', sdp); assert.ok(code.startsWith('ENGINE1.') && /^[A-Za-z0-9._-]+$/.test(code)); assert.equal(decodeCode(code, 'offer'), sdp); assert.equal(decodeCode(`  ${code.slice(0, 20)}\n${code.slice(20)}  `, 'offer'), sdp, 'tolerates line breaks and spaces from copying');
  assert.throws(() => decodeCode('hello', 'offer'), /not an invitation code/); assert.throws(() => decodeCode(code.slice(0, 30), 'offer'), /damaged/); assert.throws(() => decodeCode(code, 'answer'), /invitation: friends paste it/); assert.throws(() => decodeCode(encodeCode('answer', sdp), 'offer'), /answer code/);
  assert.throws(() => decodeCode(`ENGINE1.${'A'.repeat(30000)}`, 'offer'), /too long/); assert.throws(() => decodeCode(encodeCode('offer', 'not sdp'), 'offer'), /does not hold a connection/); assert.throws(() => decodeCode(undefined, 'offer'), /not an invitation/);
});

test('playing with no server: an invitation, an answer, and the two are connected', async () => {
  reset();
  const invitation = await createInvitation({ rtc }); assert.ok(invitation.code.startsWith('ENGINE1.'));
  const friend = await acceptInvitation(invitation.code, { rtc }); assert.ok(friend.answer.startsWith('ENGINE1.'));
  const [host, guest] = await Promise.all([invitation.accept(friend.answer), friend.transport]);
  assert.equal(host.state, 'open'); assert.equal(guest.state, 'open'); const got = []; guest.onMessage = (d) => got.push(Array.from(d)); host.send(bytes(4, 2)); await waitFor(() => got.length === 1); assert.deepEqual(got[0], [4, 2]);
  await assert.rejects(acceptInvitation('nonsense', { rtc }), /not an invitation code/);
  const second = await createInvitation({ rtc }); await assert.rejects(second.accept(invitation.code), /invitation: friends paste/); second.cancel(); await assert.rejects(second.transport, /cancelled/);
  const lone = await createInvitation({ rtc, connectTimeoutMs: 40 }); await assert.rejects(lone.transport, /timed out/);
});

test('a player who has answered and then goes from the signalling is not dropped; one who goes before answering is', async () => {
  reset();
  const loop = new LoopbackSignaling(); let hostEnd = null;
  const signaling = { host: async (o) => (hostEnd = await loop.host(o)), join: (room) => loop.join(room) };     // lets the test reach the host's end of the room
  const listener = await listenWebRTC(signaling, { rtc, room: 'RACE1' }); const joined = []; listener.onConnection = (c) => joined.push(c);
  const js = await loop.join('RACE1');
  const n = new Negotiation({ offerer: false, send: (m) => js.send(m), options: { rtc } });
  js.onMessage = (m) => n.receive(m);
  await n.transport.then(() => js.close());                                  // what connectWebRTC does the moment its side is open
  hostEnd.onPeerLeft?.(js.peerId);                                           // ... and the host hears of it before its own side has opened
  await waitFor(() => joined.length === 1, 2000, 'the host side'); assert.equal(joined[0].state, 'open', 'the host did not drop the player');
  const quitter = await loop.join('RACE1'); quitter.onMessage = () => {}; await wait(5); assert.equal(listener.pending, 1, 'negotiating with the second player'); quitter.close(); await wait(20);
  assert.equal(listener.pending, 0, 'a player who left before answering is forgotten'); assert.equal(joined.length, 1); listener.close();
});

test('messages that arrive before a handler is attached are kept and delivered in order', async () => {
  const signaling = new LoopbackSignaling();
  const host = await signaling.host({ room: 'QUEUE' }); const peer = await signaling.join('QUEUE');
  host.send(peer.peerId, { n: 1 }); host.send(peer.peerId, { n: 2 }); await wait(5);
  const got = []; peer.onMessage = (m) => got.push(m.n); assert.deepEqual(got, [1, 2]); host.send(peer.peerId, { n: 3 }); await wait(5); assert.deepEqual(got, [1, 2, 3]);
  const heard = []; peer.send({ a: 1 }); await wait(5); host.onMessage = (id, m) => heard.push([id, m.a]); assert.deepEqual(heard, [[peer.peerId, 1]]);
  const seen = []; host.onPeer = (id) => seen.push(id); assert.equal(seen.length, 1, 'the player who came in before anyone was listening'); await signaling.join('QUEUE'); await wait(5); assert.equal(seen.length, 2);
});
