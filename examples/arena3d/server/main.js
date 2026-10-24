// Usage: node examples/arena3d/server/main.js [--port 8081] [--host 127.0.0.1] [--mode worker|process|inline] [--bots 20] [--view 110]
//          [--bandwidth 60000] [--no-lagcomp] [--no-collide] [--resume 15000] [--max-rooms 8] [--max-players 32] [--mods examples/arena3d/mods]
// Rooms: open http://127.0.0.1:8081/?room=alpha (any name a-z 0-9 _ -; default "lobby"); list at /rooms.
// --mode worker (default): every room runs in its own worker thread, so one room cannot stall or crash another;
// --mode process: every room in its own OS process. --resume: how long (ms) a dropped player's character is held for a reconnect.
import { resolve } from 'node:path';
import { startArena3dGateway } from './gateway.js';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const host = arg('host', '127.0.0.1');
const mode = arg('mode', 'worker');
const gateway = await startArena3dGateway({
  port: Number(arg('port', 8081)),
  host,
  mode,
  maxRooms: Number(arg('max-rooms', 8)),
  maxPlayers: Number(arg('max-players', 32)),
  modsDir: arg('mods', null) ? resolve(arg('mods')) : undefined,
  roomOptions: {
    bots: Number(arg('bots', 20)),
    viewRadius: Number(arg('view', 110)),
    bandwidth: arg('bandwidth', null) === null ? Infinity : Number(arg('bandwidth')),
    lagCompensation: !process.argv.includes('--no-lagcomp'),
    collide: !process.argv.includes('--no-collide'),
    resumeWindowMs: Number(arg('resume', 15_000)),
  },
  log: (m) => console.log(`[rooms] ${m}`),
});
console.log(`Arena 3D running: http://${host}:${gateway.port}/   rooms: /?room=NAME   list: /rooms   mode: ${mode}   (Ctrl+C to stop)`);
setInterval(() => {
  const rooms = gateway.manager.list();
  if (rooms.length === 0) return;
  console.log(rooms.map((r) => `${r.name}: ${r.players}p tick ${r.tick ?? '-'} avg ${(r.tickMsAvg ?? 0).toFixed(2)} ms max ${(r.tickMsMax ?? 0).toFixed(1)} ms shots ${r.shots ?? 0} hits ${r.hits ?? 0}`).join(' | '));
}, 10_000).unref();
process.on('SIGINT', async () => { await gateway.close(); process.exit(0); });
