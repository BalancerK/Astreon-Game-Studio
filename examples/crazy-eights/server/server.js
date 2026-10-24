// The Crazy Eights server: the page and an API on one port, tables as rooms, and everything that outlives a game.
//
//   POST /api/guest           -> { playerId, secret, name }        make a guest account (keep the secret in the browser)
//   GET  /api/me              -> { playerId, name, rating, games, wins, rank }      (Authorization: Bearer <playerId>.<secret>)
//   PUT  /api/me   { name }                                         change the display name
//   GET  /api/leaderboard     -> { top: [{ rank, id, name, rating }], you? }
//   POST /api/private         -> { room, url, token, code }        a private table; friends join with the code
//   POST /api/join { code }   -> { room, url, token }
//   /mm/queue, /mm/ticket/<id>, /mm/status                          matchmaking (see @engine/matchmaking):
//                                                                   modes "solo" (you and three robots) and "table" (2-4 players)
//   /ws/<room>?t=<token>  (a WebSocket on the same address)                                      play: only holders of a join token can enter a table
import { randomBytes } from 'node:crypto';
import { serve } from '../../../packages/build/src/index.js';
import { RoomManager } from '../../../packages/server/src/index.js';
import { listenWebSocket } from '../../../packages/transport/src/node.js';
import { JoinTokens, MatchService } from '../../../packages/matchmaking/src/node.js';
import { Lobby, updateRatings } from '../../../packages/matchmaking/src/index.js';
import { MemoryStore, Profiles, Leaderboard } from '../../../packages/persist/src/index.js';
import { FileStore, GuestAccounts, AppendLog } from '../../../packages/persist/src/node.js';

const ROOM_NAME = /^[a-z0-9_-]{1,24}$/;
const SEATS = { solo: 4, table: 4 };
const MODES = { solo: { teams: 1, teamSize: 1 }, table: { teams: 1, teamSize: 4, minPlayers: 2, relaxAfterMs: 8000, maxWaitMs: 90_000 } };

/**
 * @param {object} o
 * @param {string} o.root The folder to serve the page from.
 * @param {number} [o.port] 0 picks a free one.
 * @param {string} [o.host]
 * @param {string | null} [o.dataDir] Where accounts, profiles and the leaderboard are kept (default: in memory, gone when the server stops).
 * @param {'process' | 'worker' | 'inline'} [o.mode] Where tables run: their own process, their own thread, or this thread.
 * @param {string} [o.secret] Signs join tokens (default: a new random one each start).
 * @param {(msg: string) => void} [o.log]
 * @param {number} [o.tickMs] How often matchmaking runs (400).
 * @param {Record<string, object>} [o.modes] The matchmaking modes (the tests shorten the waits).
 * @param {object} [o.roomOptions] Extra options for every table (the tests make robots quick).
 */
export async function startServer({
  root, modes = MODES, port = 8080, host = '127.0.0.1', dataDir = null, mode = 'worker',
  secret = randomBytes(24).toString('hex'), log = () => {}, tickMs = 400, roomOptions = {},
}) {
  const store = dataDir ? new FileStore(dataDir) : new MemoryStore();
  const accounts = new GuestAccounts({ store });
  const profiles = new Profiles({ store, spec: { version: 1, create: (id) => ({ rating: 1000, games: 0, wins: 0 }) }, flushMs: 5000, log });
  const board = await Leaderboard.load(store, 'boards', 'main');
  const history = dataDir ? new AppendLog(`${dataDir}/games.log`) : null;
  const tokens = new JoinTokens({ secret, ttlMs: 15 * 60_000 }); // long enough to reconnect to a table after a dropped connection
  const lobby = new Lobby();
  const names = new Map();
  let boardDirty = false, saving = Promise.resolve();
  /** Save the leaderboard if it changed; saves never overlap, and shutdown waits for the last one. */
  /** Save the leaderboard if it changed. Saves run one after another, never overlapping. */
  const saveBoard = () => {
    saving = saving.then(async () => {
      if (!boardDirty) return;
      boardDirty = false;
      try {
        await board.save(store, 'boards', 'main');
      } catch (e) {
        boardDirty = true;
        log(`could not save the leaderboard: ${e.message}`);
      }
    });
    return saving;
  };

  const manager = new RoomManager({
    module: new URL('../src/room.js', import.meta.url), mode, maxRooms: 100, maxPlayers: 8, autoCreate: false, idleCloseMs: 30_000,
    defaultOptions: { secret, ...roomOptions }, log,
  });

  // ---- who is calling ----
  const authCache = new Map();
  async function auth(req) {
    const h = req.headers.authorization;
    const m = typeof h === 'string' ? /^Bearer ([A-Za-z0-9_]{1,40})\.([A-Za-z0-9_-]{1,100})$/.exec(h) : null;
    if (!m) return null;
    const key = `${m[1]}.${m[2]}`, hit = authCache.get(key);
    if (hit && hit > Date.now()) return m[1];
    if (!(await accounts.authenticate(m[1], m[2]))) return null;
    authCache.set(key, Date.now() + 60_000);
    if (authCache.size > 5000) authCache.delete(authCache.keys().next().value);
    return m[1];
  }
  async function nameOf(id) {
    if (names.has(id)) return names.get(id);
    const a = await accounts.get(id), n = a?.name ?? `Player-${id.slice(-4)}`;
    names.set(id, n); return n;
  }

  // ---- matchmaking: players queue over HTTP, get a table and a token ----
  const matchmaking = new MatchService({
    modes, tokens, tickMs, userOf: auth, log,
    ratingOf: async (id) => (await profiles.peek(id))?.rating ?? 1000,
    createRoom: async (match) => {
      const room = `g-${match.id}`.slice(0, 24);
      const expect = await Promise.all(match.teams.flatMap((t) => t.players).map(async (p) => ({ id: p.id, name: await nameOf(p.id) })));
      await manager.ensureRoom(room, { expect, seats: SEATS[match.mode] ?? 4 });
      return { room, url: `/ws/${room}` };
    },
  });
  matchmaking.start();

  // ---- the HTTP API ----
  const buckets = new Map();
  /** A simple rate limit: more than `perMinute` requests from one address in a minute are refused. */
  const limited = (ip, perMinute) => {
    const now = Date.now();
    const bucket = buckets.get(ip);
    if (!bucket || bucket.reset < now) {
      buckets.set(ip, { n: 1, reset: now + 60_000 });
      return false;
    }
    return ++bucket.n > perMinute;
  };
  const send = (res, code, body) => {
    res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(body === undefined ? '' : JSON.stringify(body));
  };
  /** The JSON body of a request, or null if it is too big (over 2 KB) or is not JSON. */
  const readJson = async (req) => {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 2048) return null;
      chunks.push(chunk);
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    } catch {
      return null;
    }
  };
  const cleanName = (s) => String(s ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 24);
  const wsUrl = (room) => `/ws/${room}`;   // a path: the client adds its own address (so https gives wss, and a proxy in front just works)

  async function api(req, res, path) {
    const url = new URL(req.url, 'http://x');
    try {
      if (req.method === 'POST' && path === '/guest') {
        if (limited(req.socket.remoteAddress ?? '?', 30)) return send(res, 429, { error: 'too many new accounts from here: wait a minute' });
        const body = await readJson(req);
        const { playerId, secret: s } = await accounts.create({ name: cleanName(body?.name) || null });
        const name = cleanName(body?.name) || `Player-${playerId.slice(-4)}`;
        if (!body?.name) await accounts.setName(playerId, name);
        names.set(playerId, name);
        await profiles.openProfile(playerId); await profiles.close(playerId);
        return send(res, 201, { playerId, secret: s, name });
      }
      if (path === '/leaderboard' && req.method === 'GET') {
        const n = Math.min(50, Math.max(1, Number(url.searchParams.get('n')) || 10));
        const top = await Promise.all(board.top(n).map(async (e) => ({ rank: e.rank, id: e.id, name: await nameOf(e.id), rating: e.score })));
        const me = await auth(req);
        return send(res, 200, { top, ...(me && board.rank(me) ? { you: { rank: board.rank(me), rating: board.score(me) } } : {}) });
      }
      const me = await auth(req);
      if (!me) return send(res, 401, { error: 'sign in first' });
      if (path === '/me' && req.method === 'GET') {
        const profile = (await profiles.peek(me)) ?? { rating: 1000, games: 0, wins: 0 };
        return send(res, 200, { playerId: me, name: await nameOf(me), ...profile, rank: board.rank(me) || null });
      }
      if (path === '/me' && req.method === 'PUT') {
        const name = cleanName((await readJson(req))?.name);
        if (!name) return send(res, 400, { error: 'a name needs at least one character' });
        await accounts.setName(me, name); names.set(me, name);
        return send(res, 200, { name });
      }
      if (path === '/private' && req.method === 'POST') {
        if (limited(`${me}:private`, 10)) return send(res, 429, { error: 'too many tables: wait a minute' });
        const room = `t-${randomBytes(4).toString('hex')}`;
        lobby.register({ id: room, mode: 'private', capacity: 4, isPrivate: true, players: 0 });
        const code = lobby.createCode(room);
        await manager.ensureRoom(room, { seats: 4, startWaitMs: 20_000 });
        lobby.reserve(room, [me]);
        return send(res, 201, { room, code, url: wsUrl(room), token: tokens.issue({ player: me, room, extra: { name: await nameOf(me) } }) });
      }
      if (path === '/join' && req.method === 'POST') {
        const code = (await readJson(req))?.code;
        const room = typeof code === 'string' ? lobby.resolveCode(code) : null;
        if (!room) return send(res, 404, { error: 'no table with that code' });
        if (!lobby.get(room).joinable) return send(res, 409, { error: 'that game has already started' });
        const r = lobby.reserve(room, [me]);
        if (!r.ok) return send(res, 409, { error: r.reason === 'full' ? 'that table is full' : 'that table is closed' });
        return send(res, 200, { room, url: wsUrl(room), token: tokens.issue({ player: me, room, extra: { name: await nameOf(me) } }) });
      }
      return send(res, 404, { error: 'not found' });
    } catch (e) { log(`api error: ${e.stack ?? e}`); return send(res, 500, { error: 'something went wrong' }); }
  }

  // ---- after each game: ratings, the leaderboard, the history ----
  const seen = new Set();
  async function record(result) {
    const humans = result.players.filter((p) => !p.bot);
    const open = await Promise.all(humans.map(async (p) => ({ id: p.id, profile: await profiles.openProfile(p.id) })));
    const rating = (p) => (p.bot ? 1000 : open.find((o) => o.id === p.id).profile.data.rating);
    const out = updateRatings(result.players.map((p) => ({
      place: result.winners.includes(p.id) ? 1 : 2,
      players: [{ id: p.id, rating: rating(p), games: p.bot ? 100 : open.find((o) => o.id === p.id).profile.data.games }],
    })));
    for (const { id, profile } of open) {
      profile.change((d) => { d.rating = out.get(id).after; d.games++; if (result.winners.includes(id)) d.wins++; });
      board.submit(id, out.get(id).after, { mode: 'replace' }); boardDirty = true;
      await profiles.close(id);
    }
    await history?.append({ at: Date.now(), id: result.id, winners: result.winners, players: result.players, scores: result.scores });
    log(`game ${result.id} finished: ${result.winners.join(', ')} won`);
  }
  const watcher = setInterval(async () => {
    try {
      for (const r of manager.list()) {
        if (lobby.get(r.name)) lobby.update(r.name, { players: r.players, joinable: r.phase === 'waiting' });
        if (r.lastResult && !seen.has(r.lastResult.id)) { seen.add(r.lastResult.id); await record(r.lastResult); }
      }
      if (boardDirty) await saveBoard();
    } catch (e) { log(`bookkeeping failed: ${e.message}`); }
  }, 500);
  watcher.unref?.();

  // ---- the page, the API and the sockets on one port ----
  let dev;
  const base = () => `http://${host}:${dev.port}`;
  dev = await serve({
    root, port, host, liveReload: false, log,
    handle: (req, res) => {
      const p = new URL(req.url, 'http://x').pathname;
      if (p.startsWith('/mm/')) { matchmaking.handle(req, res, p.slice(3)); return true; }
      if (p.startsWith('/api/')) { api(req, res, p.slice(4)); return true; }
      return false;
    },
  });
  const listener = listenWebSocket({
    server: dev.server, host, path: (p) => { const m = /^\/ws\/([^/]+)$/.exec(p); return m && ROOM_NAME.test(m[1]) ? { room: m[1] } : false; },
    maxPayload: 4096, maxMessagesPerSecond: 100, burstMessages: 200, maxConnectionsPerIp: 64,
    // a socket may only join the table its token was made for
    authorize: (req, route) => {
      const token = new URL(req.url, 'http://x').searchParams.get('t');
      const verdict = tokens.verify(token, { room: route.room });
      return verdict.ok ? { player: verdict.player } : false;
    },
  });
  (await listener).onConnection = (conn) => { manager.join(conn.route.room, conn); };

  return {
    url: `${base()}/`, port: dev.port, manager, matchmaking, accounts, profiles, board, lobby, tokens, store,
    async close() {
      clearInterval(watcher); matchmaking.stop();
      await (await listener).close();
      await profiles.closeAll();
      await saveBoard();
      await dev.close();
      await manager.close();
    },
  };
}
