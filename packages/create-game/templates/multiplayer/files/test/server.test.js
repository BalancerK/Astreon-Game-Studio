import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../server/server.js';
import { TurnClient } from '@engine/turns';
import { connectWebSocket } from '@engine/transport';
import { crazyEights } from '../src/rules.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 15000, what = 'something') => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`); await sleep(20); } };

const MODES = { solo: { teams: 1, teamSize: 1 }, table: { teams: 1, teamSize: 4, minPlayers: 2, relaxAfterMs: 150, maxWaitMs: 20_000 } };

/** A running server with fast robots, and helpers for playing against it. */
async function boot(extra = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ce-'));
  const server = await startServer({ root: dir, port: 0, mode: 'inline', dataDir: join(dir, 'data'), tickMs: 30, modes: MODES, roomOptions: { thinkMs: [5, 15], startWaitMs: 300, lingerMs: 60_000 }, ...extra });
  const base = server.url.replace(/\/$/, '');
  const call = async (auth, method, path, body) => { const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(auth ? { authorization: `Bearer ${auth.playerId}.${auth.secret}` } : {}) }, body: body ? JSON.stringify(body) : undefined }); const t = await r.text(); return { status: r.status, body: t ? JSON.parse(t) : null }; };
  const clients = [];
  const ws = (path) => base.replace('http', 'ws') + path;   // the server gives a path; a client adds its own address
  /** Connect to a table and play it automatically with the game's own bot logic. */
  const play = (info, name) => {
    const c = new TurnClient({ createTransport: () => connectWebSocket(`${ws(info.url)}?t=${info.token}`), getToken: () => info.token, name, reconnect: null });
    c.onChange = () => { if (c.myTurn && c.legal.length && !c.busy) { c.busy = true; const pick = crazyEights.bot({ view: c.view, legal: c.legal }) ?? c.legal[0]; sleep(25).then(() => c.move(pick.move, pick.arg)).catch(() => {}).finally(() => { c.busy = false; c.onChange(c); }); } };
    c.start(); clients.push(c); return c;
  };
  return { dir, server, base, call, play, ws, clients, async close() { clients.forEach((c) => c.close()); await server.close(); rmSync(dir, { recursive: true, force: true }); } };
}
const guest = async (s, name) => { const r = await s.call(null, 'POST', '/api/guest', name ? { name } : {}); assert.equal(r.status, 201); return r.body; };
const matched = async (s, who, mode) => { const q = await s.call(who, 'POST', '/mm/queue', { mode }); assert.equal(q.status, 201, JSON.stringify(q.body)); return until(async () => { const r = (await s.call(who, 'GET', `/mm/ticket/${q.body.ticket}`)).body; if (r.status === 'failed' || r.status === 'expired') throw new Error(`matchmaking ${r.status}: ${r.error ?? ''}`); return r.status === 'matched' ? r : null; }, 15000, `${who.name} to be matched`); };

test('guest accounts: made without a sign-up, recognised by their secret, named, and refused without it', async () => {
  const s = await boot();
  try {
    const ann = await guest(s, 'Ann'), anon = await guest(s);
    assert.match(ann.playerId, /^p_/); assert.equal(ann.name, 'Ann'); assert.match(anon.name, /^Player-/);
    assert.deepEqual((await s.call(ann, 'GET', '/api/me')).body, { playerId: ann.playerId, name: 'Ann', rating: 1000, games: 0, wins: 0, rank: null });
    assert.equal((await s.call(null, 'GET', '/api/me')).status, 401); assert.equal((await s.call({ playerId: ann.playerId, secret: 'wrong-secret' }, 'GET', '/api/me')).status, 401);
    assert.equal((await s.call(ann, 'PUT', '/api/me', { name: '  Annie <b> ' })).body.name, 'Annie b'); assert.equal((await s.call(ann, 'GET', '/api/me')).body.name, 'Annie b');
    assert.equal((await s.call(ann, 'PUT', '/api/me', { name: '   ' })).status, 400);
    assert.equal((await s.call(ann, 'GET', '/api/nope')).status, 404);
  } finally { await s.close(); }
});

test('a game against robots: queue, get a table and a token, play it to the end over a real WebSocket; the rating, the history and the leaderboard follow; nobody without a token gets in', async () => {
  const s = await boot();
  try {
    const ann = await guest(s, 'Ann');
    const m = await matched(s, ann, 'solo');
    assert.match(m.url, /^\/ws\/g-m\d+$/, 'a path: the client adds its own address');
    // the door: no token, a bad token, a token for another table
    for (const url of [s.ws(m.url), `${s.ws(m.url)}?t=garbage`, `ws://127.0.0.1:${s.server.port}/ws/g-other?t=${m.token}`]) { const t = connectWebSocket(url); let closed = null; t.onClose = (r) => { closed = r ?? 'closed'; }; await until(() => closed, 3000, `${url} to be refused`); }
    const c = s.play(m, 'Ann');
    await until(() => c.state === 'over', 60_000, 'the game to finish');
    assert.equal(c.players.length, 4); assert.equal(c.players.filter((p) => p.bot).length, 3); assert.equal(c.over.winners.length, 1);
    const won = c.over.winners[0] === ann.playerId;
    // after the game the server records it
    const me = await until(async () => { const r = (await s.call(ann, 'GET', '/api/me')).body; return r.games === 1 ? r : null; }, 8000, 'the game to be recorded');
    assert.equal(me.wins, won ? 1 : 0); assert.ok(won ? me.rating > 1000 : me.rating < 1000); assert.equal(me.rank, 1);
    const lb = (await s.call(ann, 'GET', '/api/leaderboard')).body;
    assert.deepEqual(lb.top.map((e) => [e.name, e.rating]), [['Ann', me.rating]]); assert.equal(lb.you.rank, 1);
    assert.equal((await s.call(null, 'GET', '/api/leaderboard')).body.you, undefined, 'public: no "you" without signing in');
  } finally { await s.close(); }
});

test('real players meet: two queue for a table, get the same one, play with robots in the other seats; ratings change for the winner and loser together', async () => {
  const s = await boot();
  try {
    const ann = await guest(s, 'Ann'), bob = await guest(s, 'Bob');
    const [ma, mb] = await Promise.all([matched(s, ann, 'table'), matched(s, bob, 'table')]);
    assert.equal(ma.room, mb.room); assert.equal(ma.match.needsFill, 2, 'two players: two robots to fill the table');
    const ca = s.play(ma, 'Ann'), cb = s.play(mb, 'Bob');
    await until(() => ca.state === 'over' && cb.state === 'over', 60_000, 'both to see the end');
    assert.equal(ca.players.length, 4); assert.deepEqual(ca.over.winners, cb.over.winners);
    await until(async () => (await s.call(ann, 'GET', '/api/me')).body.games === 1 && (await s.call(bob, 'GET', '/api/me')).body.games === 1, 8000, 'both to be recorded');
    const [a, b] = [(await s.call(ann, 'GET', '/api/me')).body, (await s.call(bob, 'GET', '/api/me')).body];
    assert.ok(a.wins + b.wins <= 1); assert.ok(a.rating !== 1000 || b.rating !== 1000);
    assert.equal((await s.call(null, 'GET', '/api/leaderboard?n=5')).body.top.length, 2);
  } finally { await s.close(); }
});

test('private tables: a code that friends type in, no joining a game already under way, and a full table starts at once', async () => {
  const s = await boot({ roomOptions: { thinkMs: [5, 15], startWaitMs: 1500, lingerMs: 60_000 } });
  try {
    const [ann, bob, cat, dan, eve] = await Promise.all(['Ann', 'Bob', 'Cat', 'Dan', 'Eve'].map((n) => guest(s, n)));
    const t = await s.call(ann, 'POST', '/api/private'); assert.equal(t.status, 201); assert.match(t.body.code, /^[A-HJ-KM-NP-Z2-9]{5}$/);
    assert.equal((await s.call(null, 'POST', '/api/join', { code: t.body.code })).status, 401); assert.equal((await s.call(bob, 'POST', '/api/join', { code: 'ZZZZZ' })).status, 404);
    const jb = await s.call(bob, 'POST', '/api/join', { code: t.body.code.toLowerCase() }); assert.equal(jb.status, 200); assert.equal(jb.body.room, t.body.room);
    const jc = (await s.call(cat, 'POST', '/api/join', { code: t.body.code })).body, jd = (await s.call(dan, 'POST', '/api/join', { code: t.body.code })).body;
    const cs = [s.play(t.body, 'Ann'), s.play(jb.body, 'Bob'), s.play(jc, 'Cat'), s.play(jd, 'Dan')];
    await until(() => cs[0].state === 'playing', 8000, 'a full table to start');
    assert.equal(cs[0].players.filter((p) => !p.bot).length, 4);
    const late = await s.call(eve, 'POST', '/api/join', { code: t.body.code }); assert.equal(late.status, 409, JSON.stringify(late.body));
    await until(() => cs.every((c) => c.state === 'over'), 90_000, 'the game to finish');
  } finally { await s.close(); }
});

test('what players earned is still there after the server restarts: accounts, ratings and the leaderboard', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ce-persist-'));
  const opts = { root: dir, port: 0, mode: 'inline', dataDir: join(dir, 'data'), tickMs: 30, modes: { solo: { teams: 1, teamSize: 1 } }, roomOptions: { thinkMs: [5, 10] } };
  let first = await startServer(opts);
  const call = async (srv, auth, method, path, body) => { const r = await fetch(srv.url.replace(/\/$/, '') + path, { method, headers: { 'content-type': 'application/json', ...(auth ? { authorization: `Bearer ${auth.playerId}.${auth.secret}` } : {}) }, body: body ? JSON.stringify(body) : undefined }); const t = await r.text(); return { status: r.status, body: t ? JSON.parse(t) : null }; };
  const ann = (await call(first, null, 'POST', '/api/guest', { name: 'Ann' })).body;
  const q = (await call(first, ann, 'POST', '/mm/queue', { mode: 'solo' })).body;
  const m = await until(async () => { const r = (await call(first, ann, 'GET', `/mm/ticket/${q.ticket}`)).body; return r.status === 'matched' ? r : null; });
  const c = new TurnClient({ createTransport: () => connectWebSocket(`${first.url.replace('http', 'ws').replace(/\/$/, '')}${m.url}?t=${m.token}`), getToken: () => m.token, reconnect: null });
  c.onChange = () => { if (c.myTurn && c.legal.length && !c.busy) { c.busy = true; const pick = crazyEights.bot({ view: c.view, legal: c.legal }) ?? c.legal[0]; c.move(pick.move, pick.arg).catch(() => {}).finally(() => { c.busy = false; c.onChange(c); }); } };
  c.start();
  await until(() => c.state === 'over', 60_000);
  const before = await until(async () => { const r = (await call(first, ann, 'GET', '/api/me')).body; return r.games === 1 ? r : null; }, 8000);
  c.close(); await first.close();
  first = await startServer(opts);
  try {
    assert.deepEqual((await call(first, ann, 'GET', '/api/me')).body, before, 'the same account, rating and rank');
    assert.equal((await call(first, null, 'GET', '/api/leaderboard')).body.top[0].name, 'Ann');
    assert.equal((await call(first, { playerId: ann.playerId, secret: 'nope' }, 'GET', '/api/me')).status, 401);
  } finally { await first.close(); rmSync(dir, { recursive: true, force: true }); }
});
