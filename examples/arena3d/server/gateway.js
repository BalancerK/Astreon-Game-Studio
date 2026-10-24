// The 3D arena gateway: one port that serves the client files, lists rooms at /rooms, and routes WebSocket connections at
// /ws/<room> (or /ws for the default room) into isolated rooms (worker threads, processes, or inline).
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RoomManager } from '../../../packages/server/src/index.js';
import { listenWebSocket } from '../../../packages/transport/src/node.js';
import { createStaticServer } from '../../../tools/static-server.js';
import { loadCatalog } from '../../../packages/mods/src/node.js';
import { clientView, hashClientView } from '../../../packages/mods/src/index.js';
import { modRoute } from '../../arena/server/mod-route.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const ROOM_NAME = /^[a-z0-9_-]{1,24}$/;

/**
 * @param {object} [o]
 * @param {number} [o.port]
 * @param {string} [o.host]
 * @param {'process' | 'worker' | 'inline'} [o.mode] Rooms in their own OS processes (strongest containment), worker threads, or this thread.
 * @param {object} [o.roomHost] Process-mode options (`memoryMb`, `confine`, `env`, ...), see RoomManager.
 * @param {object} [o.roomOptions] Defaults for every room (see startArena3dServer: bots, viewRadius, bandwidth, resumeWindowMs, ...).
 * @param {number} [o.maxRooms]
 * @param {number} [o.maxPlayers] Per room.
 * @param {number} [o.idleCloseMs]
 * @param {string} [o.defaultRoom] Room used for plain `/ws`.
 * @param {boolean} [o.autoCreate]
 * @param {string} [o.modsDir] Mod catalog directory; rooms load it and clients download the client views from `/mods/<id>/<hash>` on this port.
 * @param {object} [o.modPolicy]
 * @param {'process' | 'inline'} [o.modMode]
 * @param {boolean} [o.serveStatic]
 * @param {(message: string) => void} [o.log]
 */
export async function startArena3dGateway({
  port = 8081, host = '127.0.0.1', mode = 'worker', roomOptions = {}, maxRooms = 8, maxPlayers = 32,
  idleCloseMs = 60_000, defaultRoom = 'lobby', autoCreate = true, serveStatic = true, log = () => {},
  modsDir = undefined, modPolicy = undefined, modMode = 'process', roomHost = {},
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

  const http = createStaticServer({
    root: ROOT,
    index: '/examples/arena3d/client/index.html',
    handle: (req, res) => {
      if (modsDir && modRoute(() => views)(req, res)) return true;
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
    maxPayload: 4096, maxMessagesPerSecond: 200, burstMessages: 400, maxConnectionsPerIp: 64,
  });
  listener.onConnection = (conn) => { manager.join(conn.route.room, conn); };

  return {
    port: listener.port,
    manager,
    listener,
    async close() {
      await listener.close();
      http.close();
      http.closeAllConnections?.();
      await manager.close();
    },
  };
}
