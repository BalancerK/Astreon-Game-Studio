// Network lab: runs the real arena server and client over the simulated network on a virtual clock
// and measures how interpolation behaves. Used by tests and by tools/arena-netlab.js.
import { startArenaServer } from '../server/arena-server.js';
import { ArenaClient } from '../client/net.js';
import { MemoryNetwork, VirtualClock } from '../../../packages/transport/src/index.js';
import { createSampleBuffer, sampleWorld } from '../client/interp.js';
import { Pos, Style, Health, BUTTON_FIRE, buildWalls, buildWallHash } from '../shared/game.js';

/** Scripted movement: changes direction every ~25 ticks, sometimes dashes. */
export function scriptedInput(tick) {
  const phase = Math.floor(tick / 25);
  const dirs = [[127, 0], [127, 127], [0, 127], [-127, 60], [-127, -127], [0, -127], [90, -127], [0, 0]];
  const [x, y] = dirs[(phase * 5 + 3) % dirs.length];
  return [x, y, phase % 3 === 0 ? 1 : 0];
}

/**
 * @param {object} o
 * @param {object} o.link LinkConfig for both directions, or {up, down}.
 * @param {number} [o.seconds]
 * @param {number} [o.seed]
 * @param {number | null} [o.fixedDelayMs] null = adaptive
 * @param {boolean} [o.predict]
 * @param {number} [o.bots]
 */
export async function runScenario({ link, seconds = 20, seed = 1, fixedDelayMs = null, predict = true, bots = 20, clockOptions = {} }) {
  const clock = new VirtualClock();
  const server = await startArenaServer({ listen: false, manualTicks: true, bots, serveStatic: false, seed });
  const net = new MemoryNetwork({ clock, seed, link });
  net.listen('arena').onConnection = server.attach;
  const client = new ArenaClient({ transport: net.connect('arena'), now: () => clock.now(), predict, fixedDelayMs, clockOptions }).start();

  const TICK_MS = 1000 / 60, FRAME_MS = 1000 / 144;
  const ticks = Math.round(seconds * 60);
  for (let t = 0; t < ticks; t++) {
    clock.schedule(t * TICK_MS, () => { const [x, y, b] = scriptedInput(t); client.sendInput(x / 127, y / 127, b); });
    clock.schedule(t * TICK_MS + 0.001, () => server.step());
  }
  const m = { frames: 0, starved: 0, behindSum: 0, behindMax: 0, backwards: 0, lastRt: -Infinity };
  const warmupMs = 3000;
  for (let f = 0; f * FRAME_MS < seconds * 1000; f++) {
    clock.schedule(f * FRAME_MS, () => {
      if (client.state !== 'playing') return;
      const rt = client.renderTick();
      if (Number.isNaN(rt) || clock.now() < warmupMs) { m.lastRt = rt; return; }
      const { after } = client.history.around(rt);
      m.frames++;
      if (!after) m.starved++;
      const behind = (client.latestTick - rt) * TICK_MS;
      m.behindSum += behind;
      if (behind > m.behindMax) m.behindMax = behind;
      if (rt < m.lastRt) m.backwards++;
      m.lastRt = rt;
    });
  }
  clock.runUntil(seconds * 1000 + 200);
  const out = {
    starvedPct: (m.starved / m.frames) * 100,
    behindMs: m.behindSum / m.frames,
    behindMaxMs: m.behindMax,
    backwards: m.backwards,
    rttMs: client.rttMs,
    clock: client.clock.status(clock.now()),
    corrections: client.predicted?.stats.corrections ?? 0,
    snapshots: client.stats.snapshots,
  };
  await server.close();
  return out;
}

/**
 * Several clients playing against a crowded server; measures what each one costs in bandwidth.
 * @param {object} o
 * @param {number} [o.bots]
 * @param {number} [o.clients]
 * @param {number} [o.viewRadius]
 * @param {number} [o.bandwidth] bytes/second budget per client
 * @param {number} [o.seconds]
 * @param {object} [o.link]
 */
export async function runBandwidth({ bots = 300, clients = 4, viewRadius = 700, bandwidth = Infinity, seconds = 15, link = { latencyMs: 40, jitterMs: 10 }, seed = 1 }) {
  const clock = new VirtualClock();
  const server = await startArenaServer({ listen: false, manualTicks: true, bots, serveStatic: false, seed, viewRadius, bandwidth });
  const net = new MemoryNetwork({ clock, seed, link });
  net.listen('arena').onConnection = server.attach;
  const players = Array.from({ length: clients }, () => new ArenaClient({ transport: net.connect('arena'), now: () => clock.now() }).start());
  const TICK_MS = 1000 / 60;
  const ticks = Math.round(seconds * 60);
  let tickMs = 0;
  for (let t = 0; t < ticks; t++) {
    clock.schedule(t * TICK_MS, () => players.forEach((p, i) => { const [x, y, b] = scriptedInput(t + i * 40); p.sendInput(x / 127, y / 127, b); }));
    clock.schedule(t * TICK_MS + 0.001, () => { const t0 = performance.now(); server.step(); tickMs += performance.now() - t0; });
  }
  clock.runUntil(seconds * 1000 + 300);
  const measured = [...server.clients].filter((c) => c.ready);
  const perClient = measured.map((c) => ({ bytes: c.rep.stats.bytes, views: c.rep.stats.views, visible: c.rep.stats.visible, full: c.rep.stats.full }));
  const totalBytes = perClient.reduce((a, c) => a + c.bytes, 0);
  const out = {
    kbpsPerClient: totalBytes / measured.length / seconds / 1024,
    visibleAvg: server.stats.visibleSum / Math.max(1, server.stats.snapshotsSent),
    fullPct: (perClient.reduce((a, c) => a + c.full, 0) / Math.max(1, perClient.reduce((a, c) => a + c.views, 0))) * 100,
    tickMsAvg: tickMs / ticks,
    corrections: players.reduce((a, p) => a + (p.predicted?.stats.corrections ?? 0), 0),
    clientSnapshots: players.map((p) => p.stats.snapshots),
    entities: server.world.entities.highWater,
    players,
    server,
  };
  await server.close();
  return out;
}

export const SCENARIOS = {
  'good (20 ms)': { latencyMs: 20 },
  'typical (50 ms, 10 jitter)': { latencyMs: 50, jitterMs: 10 },
  'jittery (50 ms, 60 jitter)': { latencyMs: 50, jitterMs: 60 },
  'lossy (50 ms, 10% loss)': { latencyMs: 50, jitterMs: 20, loss: 0.1 },
  'awful (100 ms, 80 jitter, 25% loss)': { latencyMs: 100, jitterMs: 80, loss: 0.25, reorder: 0.1 },
};

export const SLOT = 0xfffff;
export const TICK_MS = 1000 / 60;
const wallHash = buildWallHash(buildWalls());

/** A rectangle of the map with no walls in it, so tests are not affected by the pillar layout. */
export function findClearRect(w, h) {
  const out = new Int32Array(8);
  for (let y = 100; y < 2200 - h; y += 100) for (let x = 100; x < 2200 - w; x += 100) if (wallHash.queryRect(x, y, x + w, y + h, out) === 0) return { x, y, w, h };
  throw new Error('no clear area on the map');
}

/** One shooter against a target that sweeps back and forth; the shooter always aims at where the target is DISPLAYED. */
export async function shootMovingTarget({ latencyMs = 100, jitterMs = 0, loss = 0, lagCompensation = true, maxRewindMs = 250, shots = 30, viewRadius = 700, speed = 9, predictShots = false, cooldownTicks = null, spacing = 14 }) {
  const rect = findClearRect(780, 560);
  const clock = new VirtualClock();
  const server = await startArenaServer({ listen: false, manualTicks: true, bots: 0, serveStatic: false, viewRadius, lagCompensation, maxRewindMs });
  if (cooldownTicks) server.rules.weapon.cooldownTicks = cooldownTicks;
  const net = new MemoryNetwork({ clock, seed: 5, link: { latencyMs, jitterMs, loss } });
  net.listen('arena').onConnection = server.attach;
  const a = new ArenaClient({ transport: net.connect('arena'), now: () => clock.now(), predictShots }).start();
  clock.runUntil(500);
  if (cooldownTicks) a.rules.weapon.cooldownTicks = cooldownTicks; // the client's rules are installed by the welcome: set after it (as a data mod would have)
  const { x: posX, y: posY } = server.world.data(Pos);
  const sx = rect.x + 390, sy = rect.y + 500;
  posX[a.selfId & SLOT] = sx; posY[a.selfId & SLOT] = sy;
  const target = server.world.create();
  server.world.add(target, Pos, { x: rect.x + 60, y: rect.y + 100 });
  server.world.add(target, Style, { hue: 5, radius: 14 });
  server.world.add(target, Health, { hp: 100 });
  const ti = target & SLOT;
  const events = [], predicted = [], verdicts = [];
  a.onEvent = (e) => events.push(e);
  a.onPredictedShot = (s) => predicted.push({ ...s, at: clock.now() });
  a.onShotResult = (r) => verdicts.push({ ...r, at: clock.now() });
  const firedAt = [];

  const out = createSampleBuffer();
  let dir = 1, fired = 0;
  const TOTAL = 150 + shots * spacing;
  for (let t = 0; t < TOTAL; t++) {
    clock.schedule(500 + t * TICK_MS, () => {
      const rt = a.renderTick();
      let tx = NaN, ty = NaN;
      if (Number.isFinite(rt)) {
        sampleWorld(a.history, rt, out);
        for (let i = 0; i < out.count; i++) if (out.ids[i] === target) { tx = out.x[i]; ty = out.y[i]; }
      }
      const ready = t >= 150 && fired < shots && (t - 150) % spacing === 0 && Number.isFinite(tx);
      if (ready) { fired++; firedAt.push(clock.now()); a.sendInput(0, 0, BUTTON_FIRE, tx - a.predicted.x, ty - a.predicted.y); } else a.sendInput(0, 0, 0);
    });
    clock.schedule(500 + t * TICK_MS + 0.001, () => {
      server.world.data(Health).hp[ti] = 100; // a training dummy: damage is counted but it never dies and respawns elsewhere
      posX[ti] += dir * speed;
      if (posX[ti] > rect.x + 700) dir = -1;
      if (posX[ti] < rect.x + 60) dir = 1;
      server.step();
    });
  }
  clock.runUntil(500 + TOTAL * TICK_MS + 1500);
  const result = { fired, shots: server.stats.shots, hits: server.stats.hits, events, predicted, verdicts, firedAt, a, server, target, rect };
  await server.close();
  return result;
}

