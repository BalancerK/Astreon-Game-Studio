// The arena gateway: one port that serves the client files, lists rooms at /rooms, and routes
// WebSocket connections at /ws/<room> (or /ws for the default room) into isolated rooms.
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RoomManager } from '../../../packages/server/src/index.js';
import { listenWebSocket } from '../../../packages/transport/src/node.js';
import { createStaticServer } from '../../../tools/static-server.js';
import { loadCatalog } from '../../../packages/mods/src/node.js';
import { clientView, hashClientView } from '../../../packages/mods/src/index.js';
import { modRoute } from './mod-route.js';
import { JoinTokens, MatchService } from '../../../packages/matchmaking/src/node.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const ROOM_NAME = /^[a-z0-9_-]{1,24}$/;

/**
 * @param {object} [o]
 * @param {number} [o.port]
 * @param {string} [o.host]
 * @param {'process' | 'worker' | 'inline'} [o.mode] Rooms in their own OS processes (strongest containment), worker threads, or this thread.
 * @param {object} [o.roomHost] Process-mode options: `memoryMb` (heap cap per room), `confine` (`true` = Node permission model with read access to this repo
 *   only, plus child processes if mods are loaded; or an explicit `{fsRead, fsWrite, childProcess}`), `env`, `priority`, `startTimeoutMs`.
 * @param {object} [o.roomOptions] Defaults for every room (see startArenaServer: bots, viewRadius, bandwidth, ...).
 * @param {number} [o.maxRooms]
 * @param {number} [o.maxPlayers] Per room.
 * @param {number} [o.idleCloseMs]
 * @param {string} [o.defaultRoom] Room used for plain `/ws`.
 * @param {boolean} [o.autoCreate]
 * @param {string} [o.modsDir] Mod catalog directory. Rooms load it (all mods, or `roomOptions.mods.ids`), and clients download
 *   the client views from `/mods/<id>/<hash>` on this port.
 * @param {object} [o.modPolicy] ModManager policy (signatures, allow list, limits).
 * @param {'process' | 'inline'} [o.modMode]
 * @param {boolean} [o.serveStatic]
 * @param {{secret: string, modes?: Record<string, object>, userOf?: (req: any) => string | null | Promise<string | null>, ratingOf?: (id: string) => number | Promise<number>, canParty?: Function, tokenTtlMs?: number, tickMs?: number}} [o.matchmaking]
 *   Turn on matchmaking: `/mm/queue`, `/mm/ticket/<id>` and `/mm/status` (see `MatchService`), and require a join token for every room (`/ws/<room>?t=<token>`),
 *   so only matched players can enter a match's room. `secret` signs the tokens; `userOf` says who is calling (default: the `x-player` header, for tests).
 * @param {{maxPayload?: number, maxMessagesPerSecond?: number, burstMessages?: number, maxConnectionsPerIp?: number}} [o.limits] Per-connection and per-address limits of the WebSocket listener (defaults: 4096 bytes, 200 / s, burst 400, 64 connections per address); a load test from one machine raises the last one.
 * @param {(message: string) => void} [o.log]
 */
export async function startArenaGateway({
  port = 8080, host = '127.0.0.1', mode = 'worker', roomOptions = {}, maxRooms = 8, maxPlayers = 32,
  idleCloseMs = 60_000, defaultRoom = 'lobby', autoCreate = true, serveStatic = true, log = () => {},
  modsDir = undefined, modPolicy = undefined, modMode = 'process', roomHost = {}, limits = {}, matchmaking = undefined,
} = {}) {
  const hostOptions = { ...roomHost };
  if (hostOptions.confine === true) hostOptions.confine = { fsRead: [ROOT], childProcess: !!modsDir };
  // The gateway only serves what rooms may advertise: client views of catalog mods that pass the same policy checks.
  const views = new Map();
  if (modsDir) {
    const catalog = loadCatalog(modsDir);
    for (const b of catalog.bundles) if (b.manifest.rules || b.manifest.client) views.set(hashClientView(b), clientView(b));
    roomOptions = { ...roomOptions, mods: { dir: modsDir, policy: modPolicy, mode: modMode, ...roomOptions.mods } };
  }
  const manager = new RoomManager({
    module: new URL('./room.js', import.meta.url),
    mode, hostOptions, defaultOptions: roomOptions, maxRooms, maxPlayers, idleCloseMs, autoCreate, log,
  });

  // matchmaking: players queue over HTTP and are given a room and a signed token; rooms then only admit players holding one
  let tokens = null, mm = null;
  if (matchmaking) {
    tokens = new JoinTokens({ secret: matchmaking.secret, ttlMs: matchmaking.tokenTtlMs ?? 30_000 });
    let serverPort = 0;
    mm = new MatchService({
      modes: matchmaking.modes ?? { duel: { teams: 2, teamSize: 1 }, ffa: { teams: 1, teamSize: 4, minPlayers: 2, relaxAfterMs: 8000 } },
      tokens, tickMs: matchmaking.tickMs ?? 500,
      userOf: matchmaking.userOf ?? ((req) => { const v = req.headers['x-player']; return typeof v === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(v) ? v : null; }),
      ratingOf: matchmaking.ratingOf, canParty: matchmaking.canParty,
      createRoom: async (match) => { const room = `m-${match.id}`.slice(0, 24); return { room, url: `ws://${host}:${serverPort}/ws/${room}` }; },
      log,
    });
    mm.start();
    mm.setPort = (p) => { serverPort = p; };
  }

  const http = createStaticServer({
    root: ROOT,
    index: '/examples/arena/client/index.html',
    handle: (req, res) => {
      if (modsDir && modRoute(() => views)(req, res)) return true;
      if (mm && req.url.startsWith('/mm/')) { mm.handle(req, res, new URL(req.url, 'http://x').pathname.slice(3)); return true; }
      if (req.method === 'GET' && req.url.split('?')[0] === '/rooms') {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ mode, rooms: manager.list(), stats: manager.stats }));
        return true;
      }
      return false;
    },
  });
  if (serveStatic) http.listen(port, host);
  const route = (pathname) => {
    if (pathname === '/ws') return { room: defaultRoom };
    const m = /^\/ws\/([^/]+)$/.exec(pathname);
    return m && ROOM_NAME.test(m[1]) ? { room: m[1] } : false;
  };
  const listener = await listenWebSocket({
    server: serveStatic ? http : undefined, port, host, path: route,
    maxPayload: 4096, maxMessagesPerSecond: 200, burstMessages: 400, maxConnectionsPerIp: 64, ...limits,
    authorize: tokens ? (req, route) => { const v = tokens.verify(new URL(req.url, 'http://x').searchParams.get('t'), { room: route.room }); return v.ok ? { player: v.player, team: v.extra?.team } : false; } : undefined,
  });
  mm?.setPort(listener.port);
  listener.onConnection = (conn) => { manager.join(conn.route.room, conn); };

  return {
    port: listener.port,
    matchService: mm,
    tokens,
    manager,
    listener,
    async close() {
      mm?.stop();
      await listener.close();
      http.close();
      http.closeAllConnections?.();
      await manager.close();
    },
  };
}
