import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pack, unpack, linkQuality, TONE, createTokenBucket, WINDOW, MAX_WINDOW, TICK_MS, neededWindow, stepWindow, createFrameLog, InputRelay, MAX_AHEAD, OnlineRollback, describeDifferences } from '../src/index.js';

// ---- a toy game: each player walks along a line; a command is { dx } from -1 to 1 ----
const codec = { normalize: (raw) => ({ dx: Math.max(-1, Math.min(1, Math.round(Number(raw?.dx) || 0))) }), encode: (c) => [c.dx], decode: (e) => ({ dx: Array.isArray(e) ? Math.max(-1, Math.min(1, Math.round(Number(e[0]) || 0))) : 0 }) };
const toy = (n) => ({ tick: 0, x: Array(n).fill(0), jumps: 0 });
const stepToy = (state, commands) => { state.tick++; commands.forEach((c, i) => { state.x[i] += c.dx; }); return commands.map((c, i) => ({ type: 'move', who: i, dx: c.dx })).filter((e) => e.dx !== 0); };
const sum = (state) => state.x.reduce((h, v, i) => (h * 31 + v + i * 7) | 0, state.tick);

const seatsOf = (...kinds) => kinds.map((kind, i) => ({ kind, pilot: kind === 'human' ? `p${i}` : undefined, team: i % 2 }));

test('wire: messages round-trip as bytes, and anything that is not a message with a text t is dropped', () => {
  const m = { t: 'in', f: 12, c: [1, 0, 3] };
  assert.deepEqual(unpack(pack(m)), m);
  for (const bad of [new Uint8Array([1, 2, 3]), pack(7), pack({ t: 5 }), pack(null), pack([1])]) assert.equal(unpack(bad), null);
  assert.deepEqual(unpack(pack({ t: 'x' }).buffer), { t: 'x' });
});

test('link quality: more bars for a better connection, none for a lost one, and a tone for each', () => {
  assert.equal(linkQuality({ ping: 20 }).bars, 4); assert.equal(linkQuality({ ping: 20 }).label, 'EXCELLENT');
  assert.equal(linkQuality({ ping: 90 }).bars, 3); assert.equal(linkQuality({ ping: 150 }).bars, 2); assert.equal(linkQuality({ ping: 400 }).bars, 1);
  assert.ok(linkQuality({ ping: 20, jitter: 60 }).bars < 4 && linkQuality({ ping: 20, ahead: 400 }).bars < 4);
  assert.deepEqual(linkQuality({ ping: NaN }), { bars: 0, label: 'LOST', tone: 'lost' }); assert.equal(linkQuality({ ping: 10, lost: true }).bars, 0);
  assert.ok(Object.keys(TONE).every((k) => /^#[0-9a-f]{6}$/.test(TONE[k])));
});

test('a token bucket lets a burst through, then the rate, and holds no more than its burst', () => {
  const b = createTokenBucket({ rate: 5, burst: 3, now: 0 });
  assert.deepEqual([b.take(0), b.take(0), b.take(0), b.take(0)], [true, true, true, false]);
  assert.equal(b.take(100), false, 'half a request has come back');
  assert.equal(b.take(200), true, 'a whole one has');
  assert.equal(b.take(200), false);
  assert.equal(b.take(60_000), true); assert.ok(b.tokens <= 2 && b.tokens >= 0, 'never more than the burst');
  const full = createTokenBucket({ rate: 1, burst: 2, now: 0 }); full.take(1e9); assert.ok(full.tokens <= 2);
});

test('the window: what the connections need, up quickly and down slowly, and never beyond the most', () => {
  assert.equal(neededWindow([]), WINDOW); assert.equal(neededWindow([null, undefined, {}]), WINDOW, 'no round trip yet counts for nothing');
  assert.equal(neededWindow([{ rtt: 40, jitter: 5 }]), WINDOW, 'a good link needs no more than the usual');
  const slow = neededWindow([{ rtt: 300, jitter: 20 }]); assert.ok(slow > WINDOW && slow <= MAX_WINDOW, `${slow}`);
  assert.equal(neededWindow([{ rtt: 30_000 }]), MAX_WINDOW);
  assert.equal(neededWindow([{ rtt: 300 }, { rtt: 100 }]), neededWindow([{ rtt: 300 }]), 'the worst one');
  const room = {};
  assert.equal(stepWindow(room, 15, 0), 9, 'up by three at a time'); assert.equal(stepWindow(room, 15, 10), 12); assert.equal(stepWindow(room, 15, 20), 15); assert.equal(stepWindow(room, 15, 30), 15);
  assert.equal(stepWindow(room, 6, 3000), 14, 'down by one'); assert.equal(stepWindow(room, 6, 3500), 14, 'not again at once'); assert.equal(stepWindow(room, 6, 5200), 13);
  assert.ok(TICK_MS > 16 && TICK_MS < 17);
});

test('the frame log: an unchanged seat is null, changes and a checksum ride along, and lost frames can be sent again', () => {
  const log = createFrameLog({ hashEvery: 10, keep: 5 });
  const a = log.make(0, [[1], [0]], { hash: 111 });
  assert.deepEqual(a, { t: 'f', f: 0, i: [[1], [0]], h: 111 }, 'the first frame says everything');
  const b = log.make(1, [[1], [2]], { changes: [{ seat: 1, human: false }], hash: 222 });
  assert.deepEqual(b, { t: 'f', f: 1, i: [null, [2]], ch: [{ seat: 1, human: false }] }, 'only what changed, and no checksum off the tenth frame');
  assert.equal(log.wantsHash(10), true); assert.equal(log.wantsHash(11), false);
  assert.deepEqual(log.last, ['[1]', '[2]']);
  for (let f = 2; f < 9; f++) log.make(f, [[f], [f]]);
  assert.equal(log.history.length, 5); assert.equal(log.history[0].f, 4);
  assert.deepEqual(log.since(6).map((m) => m.f), [6, 7, 8]); assert.equal(log.since(2), null, 'too long ago: send the whole state'); assert.deepEqual(log.since(8).map((m) => m.f), [8]);
  log.reset(); assert.deepEqual(log.last, []); assert.equal(log.since(0), null);
});

test('describeDifferences names the paths that differ and stops at the limit', () => {
  assert.deepEqual(describeDifferences({ a: 1, b: { c: [1, 2] } }, { a: 1, b: { c: [1, 3] } }), ['.b.c.1: 2 vs 3']);
  assert.deepEqual(describeDifferences({ a: 1 }, { a: 1, b: 2 }), ['.b: undefined vs 2']);
  assert.equal(describeDifferences({ a: [1, 2, 3, 4, 5] }, { a: [9, 9, 9, 9, 9] }, 3).length, 3);
  assert.deepEqual(describeDifferences({ n: NaN }, { n: null }), []);
});

test('the relay uses the command that came for a frame, the one before it if none did, and asks the game for a computer-driven seat', () => {
  const asked = [];
  const relay = new InputRelay({ seats: seatsOf('human', 'bot', 'human'), codec, think: (seat, frame) => { asked.push([seat, frame]); return { dx: -1 }; } });
  const state = toy(3);
  const play = (cmds) => stepToy(state, cmds);
  assert.equal(relay.receive(0, 0, [1]), true); assert.equal(relay.receive(0, 1, [1]), true); assert.equal(relay.receive(0, 3, [-1]), true);
  const f0 = relay.step(play); assert.deepEqual(f0.inputs, [[1], [-1], [0]]); assert.equal(f0.frame, 0);
  relay.step(play); relay.step(play);                                                    // frame 2: nothing came, so the one before is used
  assert.deepEqual(state.x, [1 + 1 + 1, -3, 0]);
  const f3 = relay.step(play); assert.deepEqual(f3.inputs[0], [-1], 'a command for a later frame waits for it');
  assert.deepEqual(asked, [[1, 0], [1, 1], [1, 2], [1, 3]]); assert.equal(relay.frame, 4);
  assert.equal(relay.receive(1, 5, [1]), false, 'not a person\'s seat'); assert.equal(relay.receive(9, 5, [1]), false); assert.equal(relay.receive(-1, 5, [1]), false);
  assert.equal(relay.receive(0, 4 + MAX_AHEAD + 1, [1]), false, 'too far ahead'); assert.equal(relay.receive(0, 4.5, [1]), false); assert.equal(relay.receive(0, 4 + MAX_AHEAD, [1]), true);
});

test('a command that is late for its frame is used for the next one, not lost, unless it is older than one already taken', () => {
  const relay = new InputRelay({ seats: seatsOf('human'), codec, think: () => codec.normalize() });
  const state = toy(1);
  for (let i = 0; i < 10; i++) relay.step((c) => stepToy(state, c));
  assert.equal(relay.receive(0, 7, [1]), true); assert.equal(relay.lateCount, 1);
  const f = relay.step((c) => stepToy(state, c)); assert.deepEqual(f.inputs, [[1]], 'played at frame 10, the next to be played');
  assert.equal(relay.receive(0, 6, [-1]), false, 'older than the one already taken'); assert.equal(relay.receive(0, 8, [-1]), true, 'a newer one than that is taken'); assert.equal(relay.lateCount, 2);
  assert.equal(relay.newest[0], 8);
  const noisy = new InputRelay({ seats: seatsOf('human'), codec, think: () => codec.normalize() });
  noisy.receive(0, 0, [57]); noisy.receive(0, 1, 'junk');
  assert.deepEqual(noisy.step(() => []).inputs, [[1]], 'a command is made sound on the way in'); assert.deepEqual(noisy.step(() => []).inputs, [[0]]);
});

test('seats change hands at a frame: the changes are recorded for that frame, the hooks and onChange run, and a person\'s old commands are dropped', () => {
  const log = [], hooks = { human: (s) => log.push(['human', s]), bot: (s, f) => log.push(['bot', s, f]) };
  const seen = [];
  const relay = new InputRelay({ seats: seatsOf('human', 'bot', 'bot', 'bot'), codec, think: () => ({ dx: 1 }), hooks, onChange: (list) => seen.push(list.map((e) => ({ ...e }))) });
  const state = toy(4);
  relay.receive(0, 0, [1]); relay.receive(0, 1, [1]);
  relay.step((c) => stepToy(state, c));
  relay.seatBot(0);                                                                       // the person goes: their waiting command is dropped, and a bot plays from the next frame
  assert.deepEqual(log.at(-1), ['bot', 0, 1]); assert.equal(relay.seats[0].kind, 'bot'); assert.equal(relay.seats[0].pilot, undefined);
  const f1 = relay.step((c) => stepToy(state, c)); assert.deepEqual(f1.inputs[0], [1]); assert.deepEqual(f1.changes, [{ seat: 0, human: false }]);
  relay.seatHuman(2, 'newcomer', 'NEW'); assert.deepEqual(log.at(-1), ['human', 2]);
  assert.equal(relay.seatOf('newcomer'), 2); assert.equal(relay.seats[2].name, 'NEW');
  relay.record({ seat: 2, loadout: 'x' });
  const f2 = relay.step((c) => stepToy(state, c)); assert.deepEqual(f2.changes, [{ seat: 2, human: true }, { seat: 2, loadout: 'x' }]);
  assert.deepEqual(seen.at(-1).map((e) => e.seat), [2, 2], 'onChange got the frame\'s list as it grew');
  assert.equal(relay.receive(2, 3, [1]), true); assert.equal(relay.receive(0, 3, [1]), false, 'seat 0 is a bot now');
  assert.deepEqual(relay.freeSeats().sort(), [0, 1, 3]);
  assert.deepEqual(relay.freeSeats(1), [1, 3, 0], 'a team\'s own seats first, then the others');
});

test('an old record of changes is forgotten after ten seconds of frames', () => {
  const relay = new InputRelay({ seats: seatsOf('human', 'bot'), codec, think: () => codec.normalize() });
  relay.record({ seat: 0, loadout: 'a' });
  for (let i = 0; i < 700; i++) relay.step(() => []);
  assert.equal(relay.seatChanges.has(0), false); assert.ok(relay.seatChanges.size === 0);
});

// ---- a server and clients over a pretend network, playing the toy game ----
function network({ latency = 40, jitter = 15, seed = 3, players = 3, bots = 1 } = {}) {
  let s = seed >>> 0; const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  const clock = { t: 0 };
  const seats = [...Array(players)].map((_, i) => ({ kind: 'human', pilot: `p${i}`, name: `P${i}` })).concat([...Array(bots)].map((_, i) => ({ kind: 'bot', name: `B${i}` })));
  const state = toy(seats.length), relay = new InputRelay({ seats, codec, think: (seat, frame) => ({ dx: Math.sin(frame / 30 + seat) > 0 ? 1 : -1 }) });
  const frames = createFrameLog(), history = new Map();
  const server = { window: WINDOW, t0: 0, downAt: 0 };
  const clients = [];
  const pipe = () => ({ list: [], last: 0 });
  const push = (p, msg) => { const at = Math.max(p.last, clock.t + latency + rnd() * jitter); p.last = at; p.list.push({ at, msg }); };
  for (let i = 0; i < players; i++) {
    const up = pipe(), down = pipe();
    const c = { i, up, down, online: null, events: 0, delays: [] };
    c.online = new OnlineRollback({ seats: seats.map((x) => ({ ...x })), you: i, game: { base: () => toy(seats.length), step: (st, inputs) => stepToy(st, inputs), clone: (st) => structuredClone(st), checksum: sum, serialize: (st) => st, revive: (d) => structuredClone(d), ...codec }, send: (m) => push(up, m), window: WINDOW, onEvents: (ev) => { c.events += ev.length; } });
    clients.push(c);
  }
  const reader = (c) => ({ dx: Math.sin((clock.t + c.i * 100) / 400) > 0 ? 1 : -1 });
  const server_receive = (c, m) => {
    if (m.t === 'in') relay.receive(c.i, m.f, m.c);
    else if (m.t === 'ping') push(c.down, { t: 'pong', c: m.c, m: (clock.t - server.t0) / TICK_MS });
    else if (m.t === 'resync') push(c.down, { t: 'state', f: relay.frame, s: structuredClone(state), last: frames.last.length ? frames.last : null });
    else if (m.t === 'nack') { const fs = frames.since(m.from); if (fs) fs.forEach((f) => push(c.down, f)); else push(c.down, { t: 'state', f: relay.frame, s: structuredClone(state), last: frames.last }); }
  };
  let started = false, nextFrame = 0;
  function advance(ms, { step = 4, frameMs = 1000 / 60 } = {}) {
    for (let k = 0; k < ms / step; k++) {
      clock.t += step;
      if (!started) { started = true; server.t0 = clock.t; for (const c of clients) push(c.down, { t: 'go' }); }
      for (const c of clients) while (c.up.list.length && c.up.list[0].at <= clock.t) server_receive(c, c.up.list.shift().msg);
      const due = (clock.t - server.t0) / TICK_MS;
      while (relay.frame + server.window <= due) {
        const f = relay.frame, at = sum(state);
        const { inputs, changes } = relay.step((cmds) => stepToy(state, cmds));
        history.set(f, at);
        const msg = frames.make(f, inputs, { changes, hash: frames.wantsHash(f) ? at : undefined });
        for (const c of clients) push(c.down, msg);
      }
      for (const c of clients) {
        while (c.down.list.length && c.down.list[0].at <= clock.t) c.online.message(c.down.list.shift().msg, clock.t);
        c.next ??= clock.t; while (c.next <= clock.t) { c.next += frameMs; c.online.tick(clock.t, () => reader(c)); }
      }
      void nextFrame;
    }
  }
  return { clock, relay, state, clients, history, advance, server, frames };
}

test('three machines and a bot over a network with delay and jitter play the same game as the server, and each plays its own commands at once', () => {
  const net = network();
  net.advance(6000);
  for (const c of net.clients) {
    assert.ok(c.online.started && c.online.session.frame > 200, `client ${c.i} played ${c.online.session.frame} frames`);
    assert.equal(c.online.stats.resyncs, 0, 'never needed the game again from the server'); assert.equal(c.online.session.desync, null);
    const { frame, checksum } = c.online.session.confirmed();
    assert.ok(frame > 100); assert.equal(checksum, net.history.get(frame), `client ${c.i}: the state before frame ${frame} is the server's`);
    assert.ok(c.events > 100, 'the effects of frames were handed over once');
  }
  const x = net.clients[0].online.state.x;
  assert.ok(x.length === 4 && x.some((v) => v !== 0));
});

test('a client whose game went wrong is noticed from a checksum, asks for the server\'s game and carries on in step', () => {
  const net = network({ seed: 9 });
  net.advance(4000);
  const c = net.clients[1];
  c.online.session.state.x[0] += 50;                                                     // the machine's game is damaged (the sort of thing a different browser's arithmetic could do)
  net.advance(4000);
  assert.ok(c.online.stats.resyncs >= 1, 'it noticed and asked');
  assert.ok(c.online.lastMismatch === undefined || Array.isArray(c.online.lastMismatch.differences));
  net.advance(2000);
  const { frame, checksum } = c.online.session.confirmed();
  assert.equal(checksum, net.history.get(frame), 'and is in step again');
});

test('the client\'s lead over the server shrinks again after a slow start (a lead that grew never stays)', () => {
  const net = network({ latency: 20, jitter: 4 });
  net.advance(1500);
  const c = net.clients[0];
  c.online.rtt = 700; c.online.jitter = 60; c.online.window = 6; c.online.message({ t: 'pings', w: 6, p: [] }, net.clock.t);      // one bad answer sets the delay high
  assert.ok(c.online.inputDelay > 3, `${c.online.inputDelay}`);
  c.online.rtt = 40; c.online.jitter = 2; net.advance(1500); c.online.rtt = 40; c.online.jitter = 2; c.online.message({ t: 'pings', w: 6, p: [] }, net.clock.t); net.advance(300);
  assert.equal(c.online.inputDelay, 0);
  assert.ok(c.online.session.nextLocal - c.online.session.frame <= 1 + 8, 'the commands are for the present frames');
});

test('frames lost on the way are asked for again, and a client that took a long time to start takes the server\'s game and plays from there', () => {
  const net = network({ seed: 5 });
  net.advance(1000);
  const c = net.clients[2];
  c.down.list = c.down.list.filter((e, i) => e.msg.t !== 'f' || i % 3 !== 0);        // some frames never arrive
  net.advance(3000);
  assert.ok(c.online.stats.nacks >= 1, 'it asked for what was missing');
  const late = network({ seed: 6 });
  late.advance(5000);
  const l = late.clients[0];
  l.online.session.frame; l.online.started = false;                                   // (pretend this machine only just came)
  const fresh = new OnlineRollback({ seats: late.relay.seats.map((x) => ({ ...x })), you: 0, game: l.online.game, send: (m) => late.clients[0].up.list.push({ at: late.clock.t + 40, msg: m }), window: WINDOW });
  fresh.message({ t: 'go' }, late.clock.t);
  assert.ok(fresh.session.frame === 0);
  fresh.message({ t: 'pong', c: late.clock.t - 40, m: (late.clock.t - late.server.t0) / TICK_MS }, late.clock.t);
  fresh.tick(late.clock.t + 5, () => ({ dx: 0 }));
  assert.ok(late.clients[0].up.list.some((e) => e.msg.t === 'resync'), 'far behind the server: it asked for the game as it is now');
});
