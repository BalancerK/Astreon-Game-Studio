// Usage: node examples/arena/server/main.js [--port 8080] [--host 127.0.0.1] [--mode worker|inline]
//          [--room-memory 256] [--confine] [--mods examples/arena/mods] [--bots 150] [--view 700] [--bandwidth 60000] [--no-lagcomp] [--max-rooms 8] [--max-players 32]
// Rooms: open http://127.0.0.1:8080/?room=alpha (any name a-z 0-9 _ -; default "lobby"); list at /rooms.
// --mode worker (default): every room runs in its own worker thread, so one room cannot stall or crash another.
// --mode process: every room runs in its own OS process (a native crash or out-of-memory also stays inside one room).
//   --room-memory MB caps each room's heap; --confine runs rooms under Node's permission model (read-only access to this repo).
// --view: how far each client sees (world units); --bandwidth: per-client budget in bytes/second (omit = unlimited).
import { resolve } from 'node:path';
import { startArenaGateway } from './gateway.js';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const host = arg('host', '127.0.0.1');

const gateway = await startArenaGateway({
  port: Number(arg('port', 8080)),
  host,
  mode: arg('mode', 'worker'),
  roomHost: { memoryMb: arg('room-memory', null) ? Number(arg('room-memory')) : undefined, confine: process.argv.includes('--confine') ? true : null },
  maxRooms: Number(arg('max-rooms', 8)),
  maxPlayers: Number(arg('max-players', 32)),
  modsDir: arg('mods', null) ? resolve(arg('mods')) : undefined,
  roomOptions: {
    tickRate: Number(arg('tick', 60)),
    bots: Number(arg('bots', 150)),
    viewRadius: Number(arg('view', 700)),
    bandwidth: arg('bandwidth', null) === null ? Infinity : Number(arg('bandwidth')),
    lagCompensation: !process.argv.includes('--no-lagcomp'),
  },
  log: (m) => console.log(`[rooms] ${m}`),
});
console.log(`Arena running: http://${host}:${gateway.port}/   rooms: /?room=NAME   list: /rooms   mode: ${arg('mode', 'worker')}`);

setInterval(() => {
  const rooms = gateway.manager.list();
  if (rooms.length === 0) return;
  console.log(rooms.map((r) => `${r.name}: ${r.players}p tick ${r.tick ?? '-'} avg ${(r.tickMsAvg ?? 0).toFixed(2)} ms max ${(r.tickMsMax ?? 0).toFixed(1)} ms`).join(' | '));
}, 10_000).unref();

process.on('SIGINT', async () => { await gateway.close(); process.exit(0); });
