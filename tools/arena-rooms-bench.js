// Room isolation and scaling numbers. Usage: node tools/arena-rooms-bench.js
import os from 'node:os';
import { startArenaGateway } from '../examples/arena/server/gateway.js';
import { ArenaClient } from '../examples/arena/client/net.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const gw = (opts) => startArenaGateway({ port: 0, serveStatic: false, idleCloseMs: 0, ...opts });

async function join(g, room) {
  const c = new ArenaClient({ url: `ws://127.0.0.1:${g.port}/ws/${room}` }).start();
  const t0 = Date.now();
  while (!(c.state === 'playing' && c.stats.snapshots > 5)) { if (Date.now() - t0 > 15_000) throw new Error(`join ${room} timed out`); await sleep(5); }
  return c;
}

function gaps(client) {
  let last = client.latestTick, lastAt = performance.now(), max = 0;
  const t = setInterval(() => {
    const now = performance.now();
    if (client.latestTick !== last) { max = Math.max(max, now - lastAt); last = client.latestTick; lastAt = now; } else max = Math.max(max, now - lastAt);
  }, 4);
  return { reset: () => { max = 0; lastAt = performance.now(); }, stop: () => { clearInterval(t); return max; } };
}

console.log(`machine: ${os.cpus().length} logical CPUs, Node ${process.version}\n`);
console.log('ISOLATION: room "a" burns CPU for 700 ms in one tick; longest gap between ticks seen by a player in room "b"');
for (const mode of ['process', 'worker', 'inline']) {
  const g = await gw({ mode, roomOptions: { bots: 5, viewRadius: Infinity } });
  const [ca, cb] = await Promise.all([join(g, 'a'), join(g, 'b')]);
  await sleep(800);
  const ga = gaps(ca), gb = gaps(cb);
  await sleep(300); ga.reset(); gb.reset();
  g.manager.rooms.get('a').handle.control({ stall: 700 });
  await sleep(1800);
  console.log(`  ${mode.padEnd(7)} room b: ${gb.stop().toFixed(0).padStart(4)} ms   (the stalled room a itself: ${ga.stop().toFixed(0)} ms)`);
  ca.close(); cb.close();
  await g.close();
}

console.log('\nSCALE: N rooms, 150 bots and 3 players each, 6 s; per-room server tick time (budget 16.7 ms)');
console.log('  mode     rooms   avg tick   worst tick   snapshots/s per player');
for (const mode of ['process', 'worker', 'inline']) {
  for (const n of [1, 4, 8]) {
    const g = await gw({ mode, maxRooms: 16, roomOptions: { bots: 150 } });
    const clients = [];
    for (let r = 0; r < n; r++) for (let p = 0; p < 3; p++) clients.push(await join(g, `room${r}`));
    const before = clients.map((c) => c.stats.snapshots);
    clients.forEach((c) => { c.sendInput(1, 0, 0); });
    const loop = setInterval(() => clients.forEach((c) => c.sendInput(Math.sin(c.seq / 40), Math.cos(c.seq / 55), 0)), 16);
    await sleep(6000);
    clearInterval(loop);
    const rooms = g.manager.list();
    const avg = rooms.reduce((a, r) => a + r.tickMsAvg, 0) / rooms.length;
    const worst = Math.max(...rooms.map((r) => r.tickMsMax));
    const sps = clients.map((c, i) => (c.stats.snapshots - before[i]) / 6).reduce((a, b) => a + b, 0) / clients.length;
    console.log(`  ${mode.padEnd(7)} ${String(n).padStart(5)} ${avg.toFixed(3).padStart(10)} ms ${worst.toFixed(2).padStart(10)} ms ${sps.toFixed(1).padStart(14)}`);
    clients.forEach((c) => c.close());
    await g.close();
  }
}
