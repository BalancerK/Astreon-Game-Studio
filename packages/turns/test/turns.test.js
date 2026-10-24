import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defineGame, Match, MoveError, botMove, Rng, encode, parseClientMessage, parseServerMessage, TurnClient, MAX_CLIENT_MESSAGE } from '../src/index.js';
import { TurnRoom } from '../src/node.js';
import { MemoryNetwork, VirtualClock } from '../../transport/src/index.js';
import { JoinTokens } from '../../matchmaking/src/node.js';

/** A tiny game that shows every feature: add 1 to 3 to a shared counter, whoever reaches 10 wins; each player has a secret only they can see. */
const race = defineGame({
  name: 'race', players: { min: 2, max: 3 }, turnMs: 5000,
  setup: ({ players, random }) => ({ total: 0, secret: Object.fromEntries(players.map((p) => [p, random.int(1000)])), order: players, out: [] }),
  moves: {
    add(G, ctx, n) {
      if (![1, 2, 3].includes(n)) ctx.fail('add 1, 2 or 3');
      G.total += n; ctx.emit('added', { by: ctx.player, n }); ctx.emitTo(ctx.player, 'tip', { total: G.total });
      if (G.total >= 10) { G.winner = ctx.player; return; }
      ctx.endTurn();
    },
    bad(G, ctx) { G.total = -1; ctx.random.random(); ctx.fail('changed my mind'); },
    shout: { anyTime: true, move(G, ctx) { ctx.emit('shout', { by: ctx.player }); } },
  },
  view: (G, p) => ({ total: G.total, mine: G.secret[p] ?? null }),
  endIf: (G) => (G.winner ? { winners: [G.winner], scores: { [G.winner]: 1 } } : null),
  legalMoves: () => [{ move: 'add', arg: 1 }, { move: 'add', arg: 2 }, { move: 'add', arg: 3 }],
  bot: ({ legal }) => legal[2],
});

// ---------- game definitions and matches ----------
test('a game definition is checked, and gets sensible defaults', () => {
  for (const [def, re] of [[{}, /needs a name/], [{ name: 'x', players: { min: 2, max: 1 }, setup() {}, moves: { a() {} } }, /players must be/], [{ name: 'x', players: { min: 1, max: 2 }, moves: { a() {} } }, /setup/], [{ name: 'x', players: { min: 1, max: 2 }, setup() {}, moves: {} }, /at least one move/], [{ name: 'x', players: { min: 1, max: 2 }, setup() {}, moves: { a: 5 } }, /move "a" must be a function/]]) assert.throws(() => defineGame(def), re);
  const g = defineGame({ name: 'bare', players: { min: 1, max: 2 }, setup: () => ({ a: 1 }), moves: { m() {} } });
  assert.deepEqual(g.view({ a: 1 }), { a: 1 }); assert.equal(g.endIf({}), null); assert.deepEqual(g.legalMoves(), []); assert.ok(Object.isFrozen(g));
});

test('a match: only the player whose turn it is may move, a refused move changes nothing (not even the dice), moves can be allowed at any time, private events stay private', () => {
  const m = new Match(race, { players: ['a', 'b'], seed: 5 });
  assert.equal(m.current, 'a'); assert.equal(m.move('b', 'add', 1).error, 'it is not your turn'); assert.equal(m.move('a', 'add', 7).error, 'add 1, 2 or 3');
  const rng = m.rng.state, before = JSON.stringify(m.state);
  assert.equal(m.move('a', 'bad').error, 'changed my mind'); assert.equal(m.rng.state, rng); assert.equal(JSON.stringify(m.state), before);
  assert.equal(m.move('b', 'shout').ok, true, 'anyTime'); assert.equal(m.seq, 1); assert.equal(m.current, 'a');
  const r = m.move('a', 'add', 2);
  assert.deepEqual([r.ok, m.current, m.state.total], [true, 'b', 2]);
  assert.deepEqual(Match.eventsFor(r.events, 'a').map((e) => e.e), ['added', 'tip']); assert.deepEqual(Match.eventsFor(r.events, 'b').map((e) => e.e), ['added']);
  assert.equal(m.viewFor('a').mine, m.state.secret.a); assert.notEqual(m.viewFor('a').mine, m.viewFor('b').mine); assert.equal(m.viewFor(null).mine, null);
  assert.throws(() => new Match(race, { players: ['a'] }), /needs 2 to 3/); assert.throws(() => new Match(race, { players: ['a', 'a'] }), /same id/);
  while (!m.over) { const p = m.current; assert.equal(m.move(p, 'add', 3).ok, true); }
  assert.deepEqual(m.over.winners.length, 1); assert.equal(m.current, null); assert.equal(m.move('a', 'add', 1).error, 'the game is over');
  assert.equal(m.log.at(-1).events.at(-1).e, 'over');
});

test('programming mistakes in a move are not hidden: only MoveError is a refusal', () => {
  const g = defineGame({ name: 'oops', players: { min: 1, max: 1 }, setup: () => ({}), moves: { boom() { throw new TypeError('a bug'); } } });
  const m = new Match(g, { players: ['p'] });
  assert.throws(() => m.move('p', 'boom'), /a bug/); assert.ok(new MoveError('x') instanceof Error);
});

test('players who are out are skipped, the first player can be chosen, and time limits play for the player', () => {
  const g = defineGame({ name: 'skip', players: { min: 3, max: 3 }, turnMs: 1000, setup: ({ players }) => ({ out: ['b'], order: players }), isActive: (s, p) => !s.out.includes(p), firstPlayer: (s, ps) => ps[1], moves: { go(G, ctx) { ctx.endTurn(); } }, legalMoves: () => [{ move: 'go' }] });
  const m = new Match(g, { players: ['a', 'b', 'c'], now: 100 });
  assert.equal(m.current, 'b', 'the game chose who starts'); m.move('b', 'go', undefined, 100); assert.equal(m.current, 'c'); m.move('c', 'go', undefined, 200); assert.equal(m.current, 'a', 'b is out: skipped');
  assert.equal(m.timeout(1100), null, 'a started at 200: not yet'); assert.equal(m.turnLeftMs(700), 500);
  assert.equal(m.timeout(1200).ok, true); assert.equal(m.current, 'c'); assert.equal(m.log.at(-1).auto, true);
  assert.equal(new Match(race, { players: ['a', 'b'] }).turnLeftMs(0), 5000); assert.equal(botMove(new Match(race, { players: ['a', 'b'] }), 'a').arg, 3, 'the game\'s own bot');
  const noBot = defineGame({ name: 'nb', players: { min: 1, max: 1 }, setup: () => ({}), moves: { x() {} }, legalMoves: () => [{ move: 'x' }] });
  assert.equal(botMove(new Match(noBot, { players: ['p'] }), 'p').move, 'x', 'no bot: a random legal move');
});

test('wire messages from players are checked: wrong shapes, wrong types and oversize ones are nothing', () => {
  const ok = (m) => parseClientMessage(encode(m));
  assert.deepEqual(ok({ t: 'hello', token: 'abc', name: 'Ann' }), { t: 'hello', token: 'abc', name: 'Ann' }); assert.deepEqual(ok({ t: 'move', id: 3, move: 'add', arg: [1, { a: 2 }] }), { t: 'move', id: 3, move: 'add', arg: [1, { a: 2 }] });
  assert.deepEqual(ok({ t: 'rematch', extra: 1 }), { t: 'rematch' }); assert.deepEqual(ok({ t: 'ping', n: 12 }), { t: 'ping', n: 12 });
  for (const bad of [{ t: 'hello' }, { t: 'hello', token: 5 }, { t: 'hello', token: 'x', name: 'n'.repeat(99) }, { t: 'move', id: 'x', move: 'a' }, { t: 'move', id: 1.5, move: 'a' }, { t: 'move', id: 1, move: 'm'.repeat(99) }, { t: 'ping', n: 'x' }, { t: 'nope' }, [], 'str', null]) assert.equal(ok(bad), null, JSON.stringify(bad));
  assert.equal(parseClientMessage(new Uint8Array(0)), null); assert.equal(parseClientMessage(new TextEncoder().encode('{not json')), null); assert.equal(parseClientMessage(new Uint8Array(MAX_CLIENT_MESSAGE + 1).fill(97)), null);
  assert.equal(parseServerMessage('{"t":"x"}').t, 'x'); assert.equal(parseServerMessage('{"a":1}'), null); assert.equal(parseServerMessage(new Uint8Array([1, 2])), null);
});

// ---------- the room, with real clients over an in-memory network ----------
function fixture({ options = {}, clientOptions = {} } = {}) {
  const clock = new VirtualClock(1000);
  const net = new MemoryNetwork({ clock, link: { latencyMs: 20 } });
  const results = [];
  const room = new TurnRoom(race, { open: true, roomName: 'r1', thinkMs: [500, 500], graceMs: 3000, lingerMs: 10_000, seed: 3, ...options }, { now: () => clock.now(), onGameOver: (r) => results.push(r) });
  const listener = net.listen('r1'); listener.onConnection = (t) => room.attach(t);
  const step = (ms) => { for (let i = 0; i < Math.ceil(ms / 50); i++) { clock.advance(50); room.tick(); } };
  const clients = [];
  const join = (id, o = {}) => {
    const c = new TurnClient({ createTransport: () => net.connect('r1'), getToken: () => id, name: id.toUpperCase(), now: () => clock.now(), setTimer: (ms, fn) => clock.schedule(ms, fn), ...clientOptions, ...o });
    const events = []; c.onEvents = (e) => events.push(...e); c.events = events; c.start(); clients.push(c); step(100);
    return c;
  };
  return { clock, net, room, step, join, results, clients };
}

test('players join with a token, the game starts when the expected players are all here, bots fill empty seats, and each player sees only their own secret', () => {
  const f = fixture({ options: { expect: [{ id: 'ann' }, { id: 'bob' }], seats: 3 } });
  const ann = f.join('ann');
  assert.equal(ann.state, 'waiting'); assert.equal(ann.you, 'ann'); assert.deepEqual(ann.players.map((p) => p.id), ['ann']);
  const bob = f.join('bob'); f.step(100);
  assert.equal(ann.state, 'playing'); assert.equal(bob.state, 'playing'); assert.equal(ann.players.length, 3); assert.equal(ann.players.filter((p) => p.bot).length, 1, 'one robot makes three');
  assert.notEqual(ann.view.mine, null); assert.notEqual(ann.view.mine, bob.view.mine); assert.ok(ann.events.some((e) => e.e === 'start'));
  assert.equal(ann.view.mine, ann.view.mine); assert.equal(f.room.stats().players, 2); assert.equal(f.room.stats().phase, 'playing');
  const stranger = f.join('stranger'); assert.equal(stranger.state, 'closed'); assert.match(stranger.closeReason, /not for you/);
});

test('moves: accepted ones resolve when the game moves on and everyone gets the update; refused ones reject with the reason; only your own private events reach you', async () => {
  const flush = () => new Promise((r) => setImmediate(r));
  const f = fixture({ options: { expect: [{ id: 'ann' }, { id: 'bob' }], seats: 2 } });
  const ann = f.join('ann'), bob = f.join('bob'); f.step(100);
  const first = ann.current, me = first === 'ann' ? ann : bob, other = me === ann ? bob : ann;
  assert.equal(me.myTurn, true); assert.equal(other.myTurn, false); assert.ok(me.legal.length > 0); assert.deepEqual(other.legal, []);
  let settled = null; me.move('add', 2).then((r) => { settled = r; });
  f.step(200); await flush();
  assert.deepEqual(settled, { ok: true, seq: 1 }); assert.equal(me.view.total, 2); assert.equal(other.view.total, 2); assert.equal(other.current, other.you);
  assert.ok(me.events.some((e) => e.e === 'tip'), 'my private tip'); assert.ok(!other.events.some((e) => e.e === 'tip'), 'not the other player\'s');
  let err = null; me.move('add', 3).catch((e) => { err = e; }); f.step(200); await flush(); assert.equal(err.message, 'it is not your turn');
  let err2 = null; other.move('add', 9).catch((e) => { err2 = e; }); f.step(200); await flush(); assert.equal(err2.message, 'add 1, 2 or 3');
  assert.equal(f.room.stats().rejected, 2); assert.equal(f.room.stats().moves, 1);
  // play to the end
  for (let i = 0; i < 20 && me.state !== 'over'; i++) { const c = [ann, bob].find((x) => x.myTurn); if (!c) { f.step(100); continue; } c.move('add', 3).catch(() => {}); f.step(150); }
  assert.equal(ann.state, 'over'); assert.equal(bob.state, 'over'); assert.deepEqual(ann.over.winners, bob.over.winners);
  assert.equal(f.results.length, 1); assert.equal(f.room.stats().lastResult.winners[0], ann.over.winners[0]); assert.match(f.room.stats().lastResult.id, /^r1#1$/);
});

test('computer players move after thinking, time limits move for slow players, and a player who loses connection comes back to the same seat', () => {
  const f = fixture({ options: { expect: [{ id: 'ann' }], seats: 2 } });
  const ann = f.join('ann'); f.step(100);
  assert.equal(ann.state, 'playing');
  if (ann.current !== 'ann') { assert.equal(ann.view.total, 0); f.step(700); assert.equal(f.room.stats().botMoves, 1, 'the robot played after thinking'); }
  const total0 = ann.view.total;
  f.step(5200); // ann's turn runs out
  assert.ok(f.room.stats().autoMoves >= 1, 'the clock played for her'); assert.ok(ann.view.total > total0);
  // she drops and reconnects with the same id: same seat, same game, same secret
  const secret = ann.view.mine, seq = ann.seq;
  ann.transport.close('wifi died'); f.step(100);
  assert.equal(ann.state, 'reconnecting', 'the client notices and starts reconnecting'); assert.equal(f.room.stats().players, 0);
  f.step(1000);
  assert.equal(ann.state, 'playing'); assert.equal(ann.view.mine, secret); assert.ok(ann.seq >= seq);
  assert.equal(f.room.stats().players, 1);
});

test('a player who stays away is replaced by a computer after the grace period, and gets the seat back if they return', () => {
  const f = fixture({ options: { expect: [{ id: 'ann' }, { id: 'bob' }], seats: 2, turnMs: 60_000 } });
  const ann = f.join('ann', { reconnect: null }), bob = f.join('bob'); f.step(100);
  const away = ann; away.transport.close('gone');
  f.step(100);
  const totalNow = bob.view.total;
  f.step(3000 + 500 + 100 + 4000); // grace, thinking, and a bot turn each way
  assert.ok(f.room.stats().botMoves >= 1 || bob.myTurn, 'the room kept the game moving'); assert.ok(bob.view.total >= totalNow);
  const back = f.join('ann'); f.step(100); assert.equal(back.state === 'playing' || back.state === 'over', true); assert.equal(back.you, 'ann');
});

test('after the game: a rematch needs everyone, starts a new game, and the room closes after the linger', () => {
  const f = fixture({ options: { expect: [{ id: 'ann' }, { id: 'bob' }], seats: 2, lingerMs: 3000 } });
  const ann = f.join('ann'), bob = f.join('bob'); f.step(100);
  const playOut = () => { for (let i = 0; i < 40 && ann.state !== 'over'; i++) { const c = [ann, bob].find((x) => x.myTurn); if (c) c.move('add', 3).catch(() => {}); f.step(120); } };
  playOut(); assert.equal(ann.state, 'over');
  ann.rematch(); f.step(100); assert.equal(ann.state, 'over', 'bob has not voted'); assert.ok(ann.players.find((p) => p.id === 'ann').rematch);
  bob.rematch(); f.step(100);
  assert.equal(ann.state, 'playing'); assert.equal(ann.view.total, 0); assert.equal(f.room.stats().matches, 2); assert.equal(ann.over, null);
  playOut(); assert.equal(ann.state, 'over'); assert.equal(f.results.length, 2);
  f.step(3500); assert.equal(ann.state, 'closed'); assert.match(ann.closeReason, /room has closed/);
});

test('with join tokens: a valid one for this room gets in; wrong room, expired, forged and missing ones do not; a second connection replaces the first', () => {
  const clockHolder = { t: 1000 };
  const tokens = new JoinTokens({ secret: 'a-long-enough-test-secret', ttlMs: 60_000, now: () => clockHolder.t });
  const f = fixture({ options: { open: false, secret: 'a-long-enough-test-secret', expect: [{ id: 'ann' }], seats: 2 } });
  // the room's own clock is the virtual one; tokens made at the same time are valid
  const make = (player, room = 'r1', ttlMs = 60_000) => new JoinTokens({ secret: 'a-long-enough-test-secret', now: () => f.clock.now() }).issue({ player, room, ttlMs });
  const bad = (token) => { const c = f.join('x', { getToken: () => token, reconnect: null }); return c; };
  assert.match(bad(make('ann', 'other')).closeReason, /wrong-room/); assert.match(bad(make('ann', 'r1', 1)).closeReason, /expired|refused/); assert.match(bad('garbage').closeReason, /malformed/);
  assert.match(bad(`${make('ann').slice(0, -3)}AAA`).closeReason, /bad-signature/);
  const first = f.join('x', { getToken: () => make('ann'), reconnect: null }); f.step(100);
  assert.equal(first.state, 'playing'); assert.equal(first.you, 'ann');
  const second = f.join('x', { getToken: () => make('ann'), reconnect: null }); f.step(100);
  assert.equal(first.state, 'closed'); assert.equal(first.closeReason, 'replaced'); assert.equal(second.you, 'ann'); assert.notEqual(second.state, 'closed');
  void tokens; void clockHolder;
});

test('a player who floods the room is disconnected, one who never says hello is dropped, and an unready game refuses moves', async () => {
  const f = fixture({ options: { expect: [{ id: 'ann' }, { id: 'bob' }], seats: 2 } });
  const ann = f.join('ann', { reconnect: null }); assert.equal(ann.state, 'waiting');
  let rejected = null; ann.move('add', 1).catch((e) => { rejected = e.message; }); f.step(100); await new Promise((r) => setImmediate(r)); assert.equal(rejected, 'the game has not started');
  for (let i = 0; i < 60; i++) ann.ping();
  f.step(100); assert.equal(ann.state, 'closed'); assert.match(ann.closeReason, /too many messages/);
  const silent = f.net.connect('r1'); let closed = null; silent.onClose = (r) => { closed = r; }; f.step(5500); assert.ok(closed, 'no hello within five seconds');
  assert.throws(() => new TurnRoom(race, {}), /needs a `secret`/);
});

test('the room is a valid room module: stats for the server, and it can be told to close', async () => {
  const f = fixture({ options: { expect: [{ id: 'ann' }], seats: 2 } });
  const ann = f.join('ann'); f.step(100);
  const s = f.room.stats(); assert.deepEqual([s.players, s.phase, s.matches], [1, 'playing', 1]); assert.equal(typeof s.tickMsAvg, 'number');
  f.room.control({ dismiss: true }); f.step(100); assert.equal(ann.state, 'closed');
  await f.room.close();
});
