// A thread full of bot players for the load test (tools/loadtest.js). Each bot is the real arena client minus the picture: it connects over a
// real WebSocket, does the handshake, acknowledges snapshots, and sends inputs at the rate a real client would.
import { parentPort, workerData } from 'node:worker_threads';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { ArenaClient } from '../examples/arena/client/net.js';
import { BUTTON_FIRE } from '../examples/arena/shared/game.js';
import { Histogram } from './loadtest-lib.js';

const { host, port, rooms, first, count, rampPerSecond, inputHz, fireEverySeconds } = workerData;
const loop = monitorEventLoopDelay({ resolution: 10 }); loop.enable();
let rng = (workerData.seed ^ (first * 2654435761)) >>> 0;
const rand = () => { rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0; return rng / 4294967296; };

const bots = [];
const stats = () => ({ bots: count, started: 0, playing: 0, failedToJoin: 0, dropped: 0, snapshots: 0, bytesDown: 0, bytesUp: 0, handshake: new Histogram(10, 3000), gap: new Histogram(1, 1000), rejected: [] });
let s = stats();
let measuring = false;

function spawn(k) {
  const room = `load${(first + k) % rooms}`;
  const bot = { client: new ArenaClient({ url: `ws://${host}:${port}/ws/${room}`, predict: false, predictShots: false, maxEntities: 512 }), room, startedAt: performance.now(), lastMsg: 0, joined: false, failed: false, dirX: 0, dirY: 0, turnAt: 0, base: null };
  bots.push(bot);
  s.started++;
  const c = bot.client.start();
  const t = c.transport, orig = t.onMessage;
  t.onMessage = (bytes) => { // time between messages: the player's view of how smooth the stream is
    const now = performance.now();
    if (measuring && bot.lastMsg) s.gap.record(now - bot.lastMsg);
    bot.lastMsg = now;
    orig(bytes);
  };
}

// start the bots gradually, as players arrive
let spawned = 0;
const rampTimer = setInterval(() => {
  const due = Math.min(count, Math.floor(((performance.now() - rampStart) / 1000) * rampPerSecond) + 1);
  while (spawned < due) spawn(spawned++);
  if (spawned >= count) clearInterval(rampTimer);
}, 20);
const rampStart = performance.now();

// what each bot does every tick of its own clock: walk about, turn now and then, fire every few seconds
const inputTimer = setInterval(() => {
  const now = performance.now();
  for (const b of bots) {
    const c = b.client;
    if (b.failed) continue;
    if (!b.joined) {
      if (c.state === 'playing') { b.joined = true; s.playing++; s.handshake.record(now - b.startedAt); b.base = { bytes: c.stats.bytes, snaps: c.stats.snapshots, up: c.transport?.stats?.sentBytes ?? 0 }; }
      else if (c.state === 'closed' || c.state === 'rejected') { b.failed = true; s.failedToJoin++; if (s.rejected.length < 5) s.rejected.push(`${b.room}: ${c.closeReason || c.state}`); }
      continue;
    }
    if (c.state !== 'playing') { b.failed = true; s.playing--; s.dropped++; continue; }
    if (now > b.turnAt) { const a = rand() * Math.PI * 2; b.dirX = Math.cos(a); b.dirY = Math.sin(a); b.turnAt = now + 500 + rand() * 2500; b.fireAt = now + (fireEverySeconds * 1000) * (0.5 + rand()); }
    const fire = now > b.fireAt ? (b.fireAt = now + fireEverySeconds * 1000 * (0.5 + rand()), BUTTON_FIRE) : 0;
    c.sendInput(b.dirX, b.dirY, fire, b.dirX, b.dirY);
  }
}, 1000 / inputHz);

function report() {
  const out = { ...s, loopLagP99: loop.percentile(99) / 1e6 };
  for (const b of bots) if (b.joined && !b.failed) { out.snapshots += b.client.stats.snapshots - b.base.snaps; out.bytesDown += b.client.stats.bytes - b.base.bytes; out.bytesUp += (b.client.transport?.stats?.sentBytes ?? 0) - b.base.up; }
  return { ...out, handshake: s.handshake.toJSON(), gap: s.gap.toJSON() };
}

parentPort.on('message', (m) => {
  if (m.t === 'measure') { // from now on count: reset what the ramp-up produced
    measuring = true; s.gap = new Histogram(1, 1000); loop.reset();
    for (const b of bots) if (b.joined && !b.failed) b.base = { bytes: b.client.stats.bytes, snaps: b.client.stats.snapshots, up: b.client.transport?.stats?.sentBytes ?? 0 };
  } else if (m.t === 'status') {
    parentPort.postMessage({ t: 'status', playing: s.playing, spawned, failed: s.failedToJoin, dropped: s.dropped });
  } else if (m.t === 'stop') {
    clearInterval(inputTimer); clearInterval(rampTimer);
    const r = report();
    for (const b of bots) b.client.close();
    parentPort.postMessage({ t: 'final', report: r });
  }
});
parentPort.postMessage({ t: 'ready' });
