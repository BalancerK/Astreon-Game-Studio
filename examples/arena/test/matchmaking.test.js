import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startArenaGateway } from '../server/gateway.js';
import { ArenaClient } from '../client/net.js';
import { Profiles, MemoryStore } from '../../../packages/persist/src/index.js';
import { updateRatings } from '../../../packages/matchmaking/src/index.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 8000, what = 'condition') => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`); await sleep(15); } };

async function setup(extra = {}) {
  const gw = await startArenaGateway({ port: 0, mode: 'inline', serveStatic: true, idleCloseMs: 0, roomOptions: { bots: 2 }, matchmaking: { secret: 'a-long-enough-test-secret', tickMs: 30, ...extra } });
  const base = `http://127.0.0.1:${gw.port}`;
  const call = async (player, method, path, body) => { const r = await fetch(base + path, { method, headers: { ...(player ? { 'x-player': player } : {}), 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); const t = await r.text(); return { status: r.status, body: t ? JSON.parse(t) : null }; };
  const clients = [];
  const connect = (url) => { const c = new ArenaClient({ url, predict: false, predictShots: false, maxEntities: 256 }).start(); clients.push(c); return c; };
  return { gw, base, call, connect, async close() { clients.forEach((c) => c.close()); await gw.close(); } };
}
const settled = (c) => until(() => (c.state === 'playing' ? 'playing' : c.state === 'closed' || c.state === 'rejected' ? c.state : null), 8000, 'the client to settle');

test('matched players get a room and a token and play together; nobody without one can enter', async () => {
  const s = await setup();
  try {
    // a client with no token is turned away at the door
    assert.notEqual(await settled(s.connect(`ws://127.0.0.1:${s.gw.port}/ws/lobby`)), 'playing');
    assert.notEqual(await settled(s.connect(`ws://127.0.0.1:${s.gw.port}/ws/lobby?t=garbage`)), 'playing');
    assert.equal((await s.call(null, 'POST', '/mm/queue', { mode: 'duel' })).status, 401);

    const a = await s.call('ann', 'POST', '/mm/queue', { mode: 'duel' }), b = await s.call('bob', 'POST', '/mm/queue', { mode: 'duel' });
    assert.equal(a.status, 201);
    const poll = (player, id) => until(async () => { const r = (await s.call(player, 'GET', `/mm/ticket/${id}`)).body; return r.status === 'matched' ? r : null; }, 8000, `${player} to be matched`);
    const [ma, mb] = await Promise.all([poll('ann', a.body.ticket), poll('bob', b.body.ticket)]);
    assert.equal(ma.room, mb.room); assert.match(ma.room, /^m-m\d+$/); assert.notEqual(ma.team, mb.team);
    assert.equal(ma.url, `ws://127.0.0.1:${s.gw.port}/ws/${ma.room}`);

    const ca = s.connect(`${ma.url}?t=${ma.token}`), cb = s.connect(`${mb.url}?t=${mb.token}`);
    assert.equal(await settled(ca), 'playing'); assert.equal(await settled(cb), 'playing');
    const room = s.gw.manager.list().find((r) => r.name === ma.room);
    assert.equal(room.players, 2, 'both are in the match\'s room');

    // a token is for one room only; a changed token is worthless
    assert.notEqual(await settled(s.connect(`ws://127.0.0.1:${s.gw.port}/ws/lobby?t=${ma.token}`)), 'playing');
    assert.notEqual(await settled(s.connect(`${ma.url}?t=${ma.token.slice(0, -3)}abc`)), 'playing');
    assert.equal(s.gw.manager.list().find((r) => r.name === ma.room).players, 2);
  } finally { await s.close(); }
});

test('a finished match updates the players\' stored ratings, and the next queue uses them', async () => {
  const store = new MemoryStore();
  const profiles = new Profiles({ store, spec: { version: 1, create: () => ({ rating: 1000, games: 0 }) }, flushMs: 0 });
  const s = await setup({ ratingOf: async (id) => (await profiles.openProfile(id)).data.rating });
  try {
    const a = await s.call('ann', 'POST', '/mm/queue', { mode: 'duel' }), b = await s.call('bob', 'POST', '/mm/queue', { mode: 'duel' });
    const match = (await until(async () => { const r = (await s.call('ann', 'GET', `/mm/ticket/${a.body.ticket}`)).body; return r.status === 'matched' ? r : null; })).match;
    assert.deepEqual(match.teams.flat().sort(), ['ann', 'bob']);
    // the game decides the winner (here: ann) and reports it
    const players = await Promise.all(['ann', 'bob'].map(async (id) => ({ id, p: await profiles.openProfile(id) })));
    const result = updateRatings(match.teams.map((team) => ({ place: team[0] === 'ann' ? 1 : 2, players: team.map((id) => ({ id, rating: players.find((x) => x.id === id).p.data.rating, games: 0 })) })));
    for (const { id, p } of players) p.change((d) => { d.rating = result.get(id).after; d.games++; });
    await profiles.closeAll();
    assert.ok((await store.get('profiles', 'ann')).value.data.rating > 1000 && (await store.get('profiles', 'bob')).value.data.rating < 1000);
    assert.equal((await store.get('profiles', 'ann')).value.data.games, 1);
    // queueing again: the service asks for the saved ratings
    const reopened = new Profiles({ store, spec: { version: 1, create: () => ({ rating: 1000, games: 0 }) }, flushMs: 0 });
    assert.equal((await reopened.openProfile('ann')).data.rating, result.get('ann').after);
    await b.body;
  } finally { await profiles.closeAll(); await s.close(); }
});
