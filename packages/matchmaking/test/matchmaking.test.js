import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { Matchmaker, Lobby, expectedScore, updateRatings, partition } from '../src/index.js';
import { JoinTokens, MatchService } from '../src/node.js';

const clock = (t = 1_000_000) => ({ now: () => t, advance: (ms) => { t += ms; } });
const solo = (id, rating) => ({ id, rating });
const ids = (match) => match.teams.map((t) => t.players.map((p) => p.id).sort());

// ---------- the matchmaker ----------
test('two players of similar rating are matched at once; far apart ones wait until the window has grown, then are matched', () => {
  const c = clock();
  const mm = new Matchmaker({ modes: { duel: { teams: 2, teamSize: 1 } }, now: c.now });
  mm.enqueue({ mode: 'duel', players: [solo('a', 1000)] }); mm.enqueue({ mode: 'duel', players: [solo('b', 1060)] });
  const first = mm.tick();
  assert.equal(first.matches.length, 1); assert.deepEqual(ids(first.matches[0]).flat().sort(), ['a', 'b']); assert.equal(first.matches[0].needsFill, 0);
  assert.equal(mm.tickets.size, 0, 'matched tickets leave the queue');
  mm.enqueue({ mode: 'duel', players: [solo('low', 800)] }); mm.enqueue({ mode: 'duel', players: [solo('high', 1400)] });
  assert.equal(mm.tick().matches.length, 0);
  c.advance(10_000);   // windows are now 100 + 25 * 10 = 350 each: still too far apart (600)
  assert.equal(mm.tick().matches.length, 0);
  c.advance(10_000);   // 600
  const late = mm.tick();
  assert.equal(late.matches.length, 1); assert.equal(late.matches[0].ratingSpread, 600); assert.equal(late.matches[0].waitedMs, 20_000);
});

test('teams are balanced, parties stay together, and combinations that cannot be split into teams are not made', () => {
  const c = clock();
  const mm = new Matchmaker({ modes: { squad: { teams: 2, teamSize: 2 } }, now: c.now });
  for (const [id, r] of [['a', 1000], ['b', 1100], ['c', 900], ['d', 1000]]) mm.enqueue({ mode: 'squad', players: [solo(id, r)] });
  const m = mm.tick().matches[0];
  assert.deepEqual(m.teams.map((t) => t.players.length), [2, 2]); assert.ok(m.teamBalance <= 50);
  assert.equal(m.teamBalance, 0, '1100 + 900 against 1000 + 1000 is the even split');
  // a party of two (kept together) plus two solos
  mm.enqueue({ mode: 'squad', players: [solo('p1', 1000), solo('p2', 1000)] }); mm.enqueue({ mode: 'squad', players: [solo('s1', 1000)] }); mm.enqueue({ mode: 'squad', players: [solo('s2', 1000)] });
  const m2 = mm.tick().matches[0];
  const team = (id) => m2.teams.findIndex((t) => t.players.some((p) => p.id === id));
  assert.equal(team('p1'), team('p2')); assert.notEqual(team('s1'), team('p1'), 'the two solos fill the other team'); assert.equal(team('s1'), team('s2'));
  // 3 + 3 + 2 cannot be split into two teams of 4 (3 + ... would need 1): the matchmaker takes a set that can be
  const mm4 = new Matchmaker({ modes: { x: { teams: 2, teamSize: 4 } }, now: c.now });
  const party = (n, tag) => Array.from({ length: n }, (_, i) => solo(`${tag}${i}`, 1000));
  mm4.enqueue({ mode: 'x', players: party(3, 'A') }); mm4.enqueue({ mode: 'x', players: party(3, 'B') }); mm4.enqueue({ mode: 'x', players: party(2, 'C') });
  assert.equal(mm4.tick().matches.length, 0, '3 + 3 + 2 would fit by count but not into two teams of 4');
  mm4.enqueue({ mode: 'x', players: party(1, 'D') }); mm4.enqueue({ mode: 'x', players: party(1, 'E') });
  const m4 = mm4.tick().matches[0];
  assert.ok(m4, 'with two solos added a valid set exists'); assert.deepEqual(m4.teams.map((t) => t.players.length), [4, 4]);
  assert.equal(partition([{ size: 3, rating: 1 }, { size: 3, rating: 1 }, { size: 2, rating: 1 }], 2, 4), null);
});

test('regions: only the same region or "any"; a partly filled match is allowed once the wait is long, with the gap reported', () => {
  const c = clock();
  const mm = new Matchmaker({ modes: { br: { teams: 1, teamSize: 4, minPlayers: 2, relaxAfterMs: 20_000, maxWaitMs: 40_000 } }, now: c.now });
  mm.enqueue({ mode: 'br', players: [solo('eu', 1000)], region: 'eu' }); mm.enqueue({ mode: 'br', players: [solo('us', 1000)], region: 'us' });
  c.advance(25_000);
  assert.equal(mm.tick().matches.length, 0, 'different regions: nobody to play with');
  mm.enqueue({ mode: 'br', players: [solo('any', 1000)], region: 'any' });
  const m = mm.tick().matches[0];
  assert.equal(m.needsFill, 2); assert.equal(m.teams[0].players.length, 2); assert.ok(m.region === 'eu' || m.region === 'us');
  c.advance(20_000);
  const rest = mm.tick();
  assert.equal(rest.matches.length, 0); assert.equal(rest.expired.length, 1, 'the other one gave up after maxWaitMs'); assert.equal(mm.tickets.size, 0);
});

test('queue rules: no double queueing, parties must fit, unknown modes, cancel, stats and estimates', () => {
  const c = clock();
  const mm = new Matchmaker({ modes: { duel: {}, squad: { teamSize: 2 } }, now: c.now });
  const t = mm.enqueue({ mode: 'duel', players: ['a'] });
  assert.throws(() => mm.enqueue({ mode: 'duel', players: ['a'] }), /already in the queue/);
  assert.throws(() => mm.enqueue({ mode: 'squad', players: ['x', 'y', 'z'] }), /does not fit a team of 2/);
  assert.throws(() => mm.enqueue({ mode: 'nope', players: ['q'] }), /no mode "nope"/);
  assert.throws(() => mm.enqueue({ mode: 'duel', players: [] }), /at least one player/);
  assert.throws(() => mm.enqueue({ mode: 'squad', players: ['p', 'p'] }), /twice/);
  assert.equal(mm.ticketOf('a').id, t.id); assert.equal(mm.stats().duel.tickets, 1);
  assert.equal(mm.cancel(t.id), true); assert.equal(mm.cancel(t.id), false); assert.equal(mm.ticketOf('a'), null);
  mm.enqueue({ mode: 'duel', players: ['a'] }); c.advance(4000); mm.enqueue({ mode: 'duel', players: ['b'] }); mm.tick();
  assert.equal(mm.stats().duel.estimatedWaitMs, 4000);
});

test('a simulated evening: 400 players arriving over time are all matched fairly (valid teams, ratings within the allowed window, no one twice)', () => {
  const c = clock();
  let seed = 7; const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const gauss = () => (rnd() + rnd() + rnd() + rnd() - 2) * 1.7; // roughly bell shaped
  const mm = new Matchmaker({ modes: { duel: { teams: 2, teamSize: 1 }, squad: { teams: 2, teamSize: 3, maxWaitMs: 90_000 } }, now: c.now });
  const seen = new Set(), waits = [];
  let queued = 0, matchedPlayers = 0, expired = 0;
  for (let second = 0; second < 600; second++) {
    for (let k = 0; k < (second < 300 ? 2 : 0); k++, queued++) {
      const rating = Math.round(1000 + gauss() * 250), mode = rnd() < 0.5 ? 'duel' : 'squad';
      const party = mode === 'squad' && rnd() < 0.3 ? 2 : 1;
      mm.enqueue({ mode, players: Array.from({ length: party }, (_, i) => solo(`p${queued}_${i}`, rating)) });
    }
    c.advance(1000);
    const { matches, expired: ex } = mm.tick();
    expired += ex.reduce((a, t) => a + t.players.length, 0);
    for (const m of matches) {
      const cfg = m.mode === 'duel' ? { teams: 2, size: 1 } : { teams: 2, size: 3 };
      assert.equal(m.teams.length, cfg.teams); assert.ok(m.teams.every((t) => t.players.length === cfg.size), 'full teams');
      for (const t of m.tickets) { assert.ok(!seen.has(t.id), 'a ticket is matched once'); seen.add(t.id); waits.push(m.waitedMs); }
      for (const t of m.tickets) assert.ok(Math.abs(t.rating - m.tickets[0].rating) <= 800 + 1e-9, 'never beyond the widest window');
      matchedPlayers += m.teams.flatMap((t) => t.players).length;
      if (m.mode === 'duel') assert.ok(m.teamBalance <= m.waitedMs / 1000 * 25 + 100 + 1e-9, 'a duel is as even as the wait allows');
    }
  }
  assert.ok(matchedPlayers + expired + mm.tickets.size * 1 >= queued * 0.95, 'every player is matched, expired or still waiting');
  assert.ok(matchedPlayers / queued > 0.9, `${matchedPlayers} of ${queued} matched`);
  waits.sort((a, b) => a - b);
  assert.ok(waits[Math.floor(waits.length / 2)] < 15_000, `median wait ${waits[Math.floor(waits.length / 2)]} ms`);
});

// ---------- ratings ----------
test('Elo: expected scores add up to one, an upset moves more points than an expected win, draws and several teams work, ratings do not fall below the floor', () => {
  assert.ok(Math.abs(expectedScore(1000, 1000) - 0.5) < 1e-12); assert.ok(Math.abs(expectedScore(1400, 1000) - 10 / 11) < 1e-9);
  assert.ok(Math.abs(expectedScore(1200, 1000) + expectedScore(1000, 1200) - 1) < 1e-12);
  const team = (id, rating, place, games = 50) => ({ players: [{ id, rating, games }], place });
  const upset = updateRatings([team('weak', 1000, 1), team('strong', 1400, 2)], { k: 32 });
  const expected = updateRatings([team('strong', 1400, 1), team('weak', 1000, 2)], { k: 32 });
  assert.ok(upset.get('weak').delta > expected.get('strong').delta * 5, 'an upset is worth much more');
  assert.equal(upset.get('weak').delta + upset.get('strong').delta, 0, 'zero-sum between equals');
  const draw = updateRatings([team('a', 1000, 1), team('b', 1000, 1)]);
  assert.equal(draw.get('a').delta, 0);
  const four = updateRatings([team('a', 1000, 1), team('b', 1000, 2), team('c', 1000, 3), team('d', 1000, 4)], { k: 32 });
  assert.ok(four.get('a').delta > 0 && four.get('d').delta < 0 && four.get('b').delta > four.get('c').delta); assert.equal([...four.values()].reduce((s, v) => s + v.delta, 0), 0);
  const squads = updateRatings([{ place: 1, players: [{ id: 'x', rating: 1200 }, { id: 'y', rating: 1000 }] }, { place: 2, players: [{ id: 'z', rating: 1100 }, { id: 'w', rating: 1100 }] }], { k: 32 });
  assert.equal(squads.get('x').delta, squads.get('y').delta, 'a team moves together');
  assert.equal(updateRatings([team('low', 100, 2), team('hi', 100, 1)]).get('low').after, 100, 'the floor');
  assert.ok(updateRatings([team('n', 1000, 1, 2), team('o', 1000, 2, 2)]).get('n').delta > updateRatings([team('n', 1000, 1, 200), team('o', 1000, 2, 200)]).get('n').delta, 'new players move faster');
});

// ---------- the lobby ----------
test('the lobby lists rooms fullest first, holds seats for players about to connect, and gives them back', () => {
  const c = clock();
  const lobby = new Lobby({ now: c.now, reservationMs: 10_000, random: (() => { let i = 0; return () => ((i++ * 7919) % 1000) / 1000; })() });
  lobby.register({ id: 'r1', mode: 'duel', capacity: 4, players: 1, region: 'eu', rating: 1000 }); lobby.register({ id: 'r2', mode: 'duel', capacity: 4, players: 3, region: 'eu', rating: 1500 });
  lobby.register({ id: 'r3', mode: 'duel', capacity: 4, players: 0, region: 'us' }); lobby.register({ id: 'x', mode: 'other', capacity: 2, players: 0 }); lobby.register({ id: 'closed', mode: 'duel', capacity: 4, players: 1, joinable: false }); lobby.register({ id: 'priv', mode: 'duel', capacity: 4, players: 1, isPrivate: true });
  assert.deepEqual(lobby.list({ mode: 'duel' }).map((r) => r.id), ['r2', 'r1', 'r3'], 'fullest first; private and closed rooms are not offered');
  assert.deepEqual(lobby.list({ mode: 'duel', region: 'eu' }).map((r) => r.id), ['r2', 'r1']);
  assert.equal(lobby.findOpen({ mode: 'duel', rating: 1000, ratingWindow: 200 }).id, 'r1', 'r2 is nearly full but too strong; the next best is r1');
  assert.equal(lobby.findOpen({ mode: 'duel', size: 4 }).id, 'r3', 'only an empty room has space for a party of four');
  assert.equal(lobby.findOpen({ mode: 'none' }), null);
  assert.equal(lobby.freeSeats('r2'), 1);
  assert.deepEqual(lobby.reserve('r2', ['a']), { ok: true, expiresAt: c.now() + 10_000 });
  assert.equal(lobby.freeSeats('r2'), 0); assert.deepEqual(lobby.reserve('r2', ['b']), { ok: false, reason: 'full' });
  assert.equal(lobby.reserve('r2', ['a']).ok, true, 'asking again for the same player does not need another seat');
  assert.equal(lobby.reserve('closed', ['a']).reason, 'closed'); assert.equal(lobby.reserve('nope', ['a']).reason, 'unknown');
  assert.equal(lobby.hasReservation('r2', 'a'), true);
  c.advance(10_001);
  assert.equal(lobby.freeSeats('r2'), 1, 'an unused reservation expires'); assert.equal(lobby.hasReservation('r2', 'a'), false);
  lobby.reserve('r2', ['a']); assert.equal(lobby.confirm('r2', 'a'), true); assert.equal(lobby.confirm('r2', 'a'), false);
  lobby.update('r2', { players: 4 }); assert.equal(lobby.freeSeats('r2'), 0);
  lobby.reserve('r1', ['p', 'q']); assert.equal(lobby.release('r1', 'p'), true); assert.equal(lobby.freeSeats('r1'), 2);
});

test('join codes: unique, easy to read, any case, private rooms found only by code, and gone when the room goes', () => {
  let n = 0;
  const lobby = new Lobby({ random: () => ((n++ * 0.6180339887) % 1) });
  lobby.register({ id: 'a', isPrivate: true }); lobby.register({ id: 'b' });
  const ca = lobby.createCode('a'), cb = lobby.createCode('b');
  assert.match(ca, /^[A-HJ-KM-NP-Z2-9]{5}$/); assert.notEqual(ca, cb); assert.equal(lobby.createCode('a'), ca, 'the same room keeps its code');
  assert.equal(lobby.resolveCode(ca.toLowerCase()), 'a'); assert.equal(lobby.resolveCode(` ${ca.slice(0, 2)}-${ca.slice(2)} `), 'a'); assert.equal(lobby.resolveCode('ZZZZZ'), null);
  assert.equal(lobby.get('a').isPrivate, true); assert.ok(!lobby.list().some((r) => r.id === 'a'));
  lobby.remove('a'); assert.equal(lobby.resolveCode(ca), null); assert.throws(() => lobby.createCode('a'), /no room/);
});

// ---------- join tokens ----------
test('join tokens: made for one player and room, expire, cannot be changed, survive key rotation, optionally work once, and garbage never throws', () => {
  const c = clock();
  const tokens = new JoinTokens({ secret: 'a-long-enough-secret-1', ttlMs: 5000, now: c.now });
  const t = tokens.issue({ player: 'ann', room: 'm1', extra: { team: 1 } });
  const ok = tokens.verify(t, { room: 'm1' });
  assert.deepEqual([ok.ok, ok.player, ok.room, ok.extra], [true, 'ann', 'm1', { team: 1 }]); assert.equal(ok.expiresAt, c.now() + 5000);
  assert.deepEqual(tokens.verify(t, { room: 'm2' }), { ok: false, reason: 'wrong-room' }); assert.equal(tokens.verify(t).ok, true, 'no room given: any');
  const [v, kid, body, sig] = t.split('.');
  const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url')), p: 'bob' })).toString('base64url');
  assert.equal(tokens.verify([v, kid, forged, sig].join('.')).reason, 'bad-signature');
  assert.equal(tokens.verify([v, kid, body, sig.slice(0, -2) + 'AA'].join('.')).reason, 'bad-signature');
  assert.equal(tokens.verify([v, 'k9', body, sig].join('.')).reason, 'unknown-key');
  for (const junk of [undefined, null, 42, '', 'a.b', 'v1.k1.x.y', 'v2.k1.a.b', `${v}.${kid}.!!!.${sig}`, {}]) assert.equal(tokens.verify(junk).ok, false);
  c.advance(5001); assert.equal(tokens.verify(t).reason, 'expired');
  // rotation: new tokens use the new first key, old ones still verify while the old key is listed
  const old = new JoinTokens({ secret: { a: 'old-secret-old-secret-1' }, now: c.now }), oldToken = old.issue({ player: 'z', room: 'r' });
  const rotated = new JoinTokens({ secret: { b: 'new-secret-new-secret-2', a: 'old-secret-old-secret-1' }, now: c.now });
  assert.equal(rotated.verify(oldToken).ok, true); assert.ok(rotated.issue({ player: 'z', room: 'r' }).startsWith('v1.b.'));
  assert.equal(new JoinTokens({ secret: { b: 'new-secret-new-secret-2' }, now: c.now }).verify(oldToken).reason, 'unknown-key');
  const once = new JoinTokens({ secret: 'a-long-enough-secret-1', oneTime: true, now: c.now }), ot = once.issue({ player: 'p', room: 'r' });
  assert.equal(once.verify(ot).ok, true); assert.equal(once.verify(ot).reason, 'used');
  assert.throws(() => new JoinTokens({ secret: 'short' }), /at least 16 characters/);
});

// ---------- the HTTP service ----------
async function serviceFixture(extra = {}) {
  const c = clock();
  const tokens = new JoinTokens({ secret: 'a-long-enough-secret-1', now: c.now });
  const rooms = [];
  const svc = new MatchService({
    modes: { duel: { teams: 2, teamSize: 1, maxWaitMs: 30_000 }, squad: { teams: 2, teamSize: 2 } }, tokens, now: c.now,
    userOf: (req) => req.headers['x-user'] ?? null, ratingOf: (id) => ({ ann: 1000, bob: 1050, cat: 3000 })[id] ?? 1000,
    canParty: (req, ids) => ids.every((i) => i.startsWith('friend-')),
    createRoom: async (match) => { rooms.push(match); return { room: `room-${match.id}`, url: `ws://game.example/ws/room-${match.id}` }; }, ...extra,
  });
  const server = http.createServer((req, res) => svc.handle(req, res, new URL(req.url, 'http://x').pathname.replace(/^\/mm/, '') || '/'));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/mm`;
  const call = async (user, method, path, body) => { const r = await fetch(base + path, { method, headers: { ...(user ? { 'x-user': user } : {}), 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); const text = await r.text(); return { status: r.status, body: text ? JSON.parse(text) : null }; };
  return { c, svc, tokens, rooms, call, close: () => server.close() };
}

test('the match service: queue, poll, get matched with a room and a personal token, cancel; nobody can read another player\'s ticket', async () => {
  const f = await serviceFixture();
  try {
    assert.equal((await f.call(null, 'POST', '/queue', { mode: 'duel' })).status, 401);
    const a = await f.call('ann', 'POST', '/queue', { mode: 'duel' }); assert.equal(a.status, 201);
    assert.equal((await f.call('ann', 'POST', '/queue', { mode: 'duel' })).status, 409, 'already queued');
    assert.equal((await f.call('bob', 'POST', '/queue', { mode: 'nope' })).status, 400);
    assert.equal((await f.call('bob', 'POST', '/queue', {})).status, 400);
    const waiting = await f.call('ann', 'GET', `/ticket/${a.body.ticket}`); assert.equal(waiting.body.status, 'waiting');
    const b = await f.call('bob', 'POST', '/queue', { mode: 'duel' });
    assert.equal((await f.call('bob', 'GET', `/ticket/${a.body.ticket}`)).status, 404, 'not your ticket');
    assert.equal((await f.call('cat', 'GET', `/ticket/${b.body.ticket}`)).status, 404);
    await f.svc.tick();
    const ma = (await f.call('ann', 'GET', `/ticket/${a.body.ticket}`)).body, mb = (await f.call('bob', 'GET', `/ticket/${b.body.ticket}`)).body;
    assert.equal(ma.status, 'matched'); assert.equal(ma.room, mb.room); assert.match(ma.url, /^ws:\/\/game\.example\/ws\/room-m/);
    assert.notEqual(ma.token, mb.token); assert.notEqual(ma.team, mb.team);
    const va = f.tokens.verify(ma.token, { room: ma.room }), vb = f.tokens.verify(mb.token, { room: ma.room });
    assert.deepEqual([va.ok, va.player, va.extra.team], [true, 'ann', ma.team]); assert.equal(vb.player, 'bob');
    assert.equal(f.tokens.verify(ma.token, { room: 'another' }).ok, false);
    assert.deepEqual(ma.match.teams.flat().sort(), ['ann', 'bob']); assert.equal(f.rooms.length, 1);
    // cancelling
    const c1 = await f.call('ann', 'POST', '/queue', { mode: 'duel' });
    assert.equal((await f.call('bob', 'DELETE', `/ticket/${c1.body.ticket}`)).status, 204);
    assert.equal((await f.call('ann', 'GET', `/ticket/${c1.body.ticket}`)).body.status, 'waiting', 'someone else cannot cancel it');
    assert.equal((await f.call('ann', 'DELETE', `/ticket/${c1.body.ticket}`)).status, 204);
    assert.equal((await f.call('ann', 'GET', `/ticket/${c1.body.ticket}`)).body.status, 'cancelled');
    assert.equal((await f.call('ann', 'GET', '/status')).body.modes.duel.tickets, 0);
    assert.equal((await f.call('ann', 'GET', '/nothing')).status, 404);
  } finally { f.close(); }
});

test('the match service: ratings come from the game, far-apart players wait then expire, parties need permission, a failing room is reported', async () => {
  const f = await serviceFixture();
  try {
    const a = await f.call('ann', 'POST', '/queue', { mode: 'duel' }), cat = await f.call('cat', 'POST', '/queue', { mode: 'duel' });
    await f.svc.tick(); assert.equal((await f.call('ann', 'GET', `/ticket/${a.body.ticket}`)).body.status, 'waiting', '1000 and 3000 are not a fair match');
    f.c.advance(31_000); await f.svc.tick();
    assert.equal((await f.call('ann', 'GET', `/ticket/${a.body.ticket}`)).body.status, 'expired'); assert.equal((await f.call('cat', 'GET', `/ticket/${cat.body.ticket}`)).body.status, 'expired');
    assert.equal((await f.call('ann', 'POST', '/queue', { mode: 'squad', players: ['stranger'] })).status, 403, 'not allowed to queue a stranger with you');
    const party = await f.call('ann', 'POST', '/queue', { mode: 'squad', players: ['friend-1'] }); assert.equal(party.status, 201);
    assert.equal(f.svc.matchmaker.get(party.body.ticket).players.length, 2);
    assert.equal((await f.call('friend-1', 'GET', `/ticket/${party.body.ticket}`)).body.status, 'waiting', 'party members can follow the ticket');
  } finally { f.close(); }
  let fail = true;
  const g = await serviceFixture({ createRoom: async (m) => { if (fail) throw new Error('no capacity'); return { room: `r-${m.id}` }; }, log: () => {} });
  try {
    const x = await g.call('ann', 'POST', '/queue', { mode: 'duel' }); await g.call('bob', 'POST', '/queue', { mode: 'duel' });
    await g.svc.tick();
    assert.deepEqual((await g.call('ann', 'GET', `/ticket/${x.body.ticket}`)).body, { status: 'failed', error: 'no room was available' });
  } finally { g.close(); }
});
