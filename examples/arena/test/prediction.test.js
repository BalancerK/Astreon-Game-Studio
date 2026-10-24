import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InputQueue } from '../server/input-queue.js';
import { PredictedPlayer } from '../client/predict.js';
import { startArenaServer } from '../server/arena-server.js';
import { ArenaClient } from '../client/net.js';
import { buildWalls, buildWallHash, applyInput, netSchema, WORLD, PLAYER_SPEED } from '../shared/game.js';
import { MemoryNetwork, VirtualClock, createRng, CHANNEL } from '../../../packages/transport/src/index.js';
import { BinaryWriter, InputBatch, encodeInput } from '../../../packages/protocol/src/index.js';
import { inputSchema } from '../shared/game.js';

const DT = 1 / 60;
const walls = buildWallHash(buildWalls());
const posCodec = netSchema.comps[0].fields[0].codec; // q(0, WORLD.w, 16), same range for y

/** Scripted input: changes direction every ~25 ticks, sometimes dashes, sometimes stands still. */
function scriptedInput(tick) {
  const phase = Math.floor(tick / 25);
  const dirs = [[127, 0], [127, 127], [0, 127], [-127, 60], [-127, -127], [0, -127], [90, -127], [0, 0]];
  const [x, y] = dirs[(phase * 5 + 3) % dirs.length];
  return [x, y, phase % 3 === 0 ? 1 : 0];
}

test('InputQueue: ordering, duplicates, gap filling and overflow', () => {
  const q = new InputQueue({ capacity: 8, maxGapFill: 3, maxCredit: 100 });
  const out = {};
  assert.ok(q.push(1, 10, 0, 0));
  assert.ok(!q.push(1, 99, 0, 0), 'duplicate ignored');
  assert.ok(q.push(2, 20, 5, 1));
  assert.ok(q.push(6, 60, 6, 0), 'gap 3..5 filled with the previous input');
  assert.equal(q.stats.filled, 3);
  assert.ok(!q.push(4, 0, 0, 0), 'stale (already covered by fill) ignored');
  for (let i = 0; i < 20; i++) q.tick();
  const got = [];
  while (q.pop(out)) got.push([out.seq, out.x, out.y, out.buttons]);
  assert.deepEqual(got, [[1, 10, 0, 0], [2, 20, 5, 1], [3, 20, 5, 1], [4, 20, 5, 1], [5, 20, 5, 1], [6, 60, 6, 0]]);

  const big = new InputQueue({ capacity: 8, maxGapFill: 3 });
  big.push(1, 1, 1, 0);
  big.push(100, 2, 2, 0); // huge jump: only the last maxGapFill missing inputs are synthesised
  assert.equal(big.stats.filled, 3);
  for (let i = 0; i < 12; i++) big.push(200 + i, 3, 3, 0);
  assert.ok(big.length <= 8 && big.stats.dropped > 0, 'bounded; oldest dropped');
});

test('InputQueue pacing: banked credit absorbs jitter but flooding cannot beat the tick rate', () => {
  const q = new InputQueue({ capacity: 4096, maxCredit: 4 });
  const out = {};
  for (let i = 1; i <= 1000; i++) q.push(i, 1, 0, 0);
  let applied = 0;
  const TICKS = 200;
  for (let t = 0; t < TICKS; t++) { q.tick(); while (q.pop(out)) applied++; }
  assert.ok(applied <= TICKS + 4 && applied >= TICKS, `applied ${applied} inputs in ${TICKS} ticks`);

  const j = new InputQueue({ maxCredit: 4 });
  let got = 0;
  for (let t = 0; t < 10; t++) { j.tick(); while (j.pop(out)) got++; } // starved: nothing queued
  assert.equal(got, 0);
  for (let i = 1; i <= 10; i++) j.push(i, 1, 0, 0);
  j.tick();
  while (j.pop(out)) got++;
  assert.equal(got, 4, 'catch-up limited to the banked credit');
});

/** Server model: applies the same inputs and acks back a quantized position some ticks later. */
function simulatePrediction({ ticks, ackDelay, serverShove }) {
  const player = new PredictedPlayer(walls, DT);
  const server = { x: 200, y: 200 };
  player.reconcile(0, server.x, server.y); // spawn
  const inFlight = [];
  const render = [];
  const out = { x: 0, y: 0 };
  let prevRender = null, maxJump = 0;
  for (let t = 1; t <= ticks; t++) {
    const [mx, my, b] = scriptedInput(t);
    player.record(t, mx, my, b);
    applyInput(walls, server, mx, my, b, DT);
    if (serverShove && t === serverShove.tick) { server.x += serverShove.dx; server.y += serverShove.dy; }
    inFlight.push({ at: t + ackDelay(t), seq: t, x: posCodec.dequantize(posCodec.quantize(server.x)), y: posCodec.dequantize(posCodec.quantize(server.y)) });
    for (let i = inFlight.length - 1; i >= 0; i--) {
      if (inFlight[i].at <= t) { const a = inFlight.splice(i, 1)[0]; player.reconcile(a.seq, a.x, a.y); }
    }
    player.smooth(DT);
    player.renderPosition(0.5, out);
    if (prevRender) maxJump = Math.max(maxJump, Math.hypot(out.x - prevRender.x, out.y - prevRender.y));
    prevRender = { ...out };
    render.push({ ...out });
  }
  return { player, server, maxJump };
}

test('prediction matches the server exactly: no corrections across walls, dashes and delayed acks', () => {
  const rng = createRng(5);
  const { player, server, maxJump } = simulatePrediction({ ticks: 1200, ackDelay: () => 2 + ((rng() * 8) | 0) });
  assert.equal(player.stats.corrections, 0, `corrections ${player.stats.corrections}, max error ${player.stats.maxError}`);
  assert.ok(player.stats.maxError <= player.tolerance, `quantization error ${player.stats.maxError} within tolerance`);
  assert.ok(player.pending < 12, `pending ${player.pending}`);
  assert.ok(Math.abs(player.x - server.x) < 1e-9 && Math.abs(player.y - server.y) < 1e-9);
  assert.ok(maxJump < 17.6, `render never moves more than a dash step per tick (max ${maxJump.toFixed(2)})`);
});

test('a server-side divergence is corrected once, replayed, and hidden by smoothing', () => {
  const { player, server } = simulatePrediction({ ticks: 600, ackDelay: () => 4, serverShove: { tick: 300, dx: 18, dy: -9 } });
  assert.equal(player.stats.corrections, 1);
  assert.equal(player.stats.snaps, 0, 'small correction eases instead of snapping');
  assert.ok(Math.abs(player.x - server.x) < 0.2 && Math.abs(player.y - server.y) < 0.2, 'converged on the server');
  assert.equal(player.offsetX === 0 && player.offsetY === 0, true, 'offset decayed away');

  // Continuity: the rendered position does not move at the moment of correction.
  const p = new PredictedPlayer(walls, DT);
  p.reconcile(0, 500, 500);
  for (let t = 1; t <= 10; t++) p.record(t, 127, 0, 0);
  const before = p.renderPosition(0.3);
  const err = p.reconcile(5, p.px[5 % p.capacity] + 20, p.py[5 % p.capacity] + 5); // server disagrees
  assert.ok(err > 20 && err < 25);
  const after = p.renderPosition(0.3);
  assert.ok(Math.hypot(after.x - before.x, after.y - before.y) < 1e-9, 'render position continuous across the correction');
  assert.ok(Math.abs(p.offsetX) > 15, 'a visible offset remains to ease out');
  for (let i = 0; i < 40; i++) p.smooth(DT);
  assert.equal(p.offsetX, 0);
});

test('large divergence snaps; unknown ack snaps; pre-init inputs are replayed from the first snapshot', () => {
  const { player } = simulatePrediction({ ticks: 200, ackDelay: () => 3, serverShove: { tick: 100, dx: 400, dy: 0 } });
  assert.equal(player.stats.snaps, 1);

  const p = new PredictedPlayer(walls, DT, { capacity: 16 });
  p.reconcile(0, 300, 300);
  for (let t = 1; t <= 40; t++) p.record(t, 127, 0, 0); // ring only remembers the last 16
  const snapsBefore = p.stats.snaps;
  p.reconcile(5, 350, 300); // ack 5 is long forgotten
  assert.equal(p.stats.snaps, snapsBefore + 1, 'cannot replay safely: snap to the server');
  assert.equal(p.offsetX, 0);

  // inputs sent before the first snapshot are replayed on top of the server's spawn state
  const q = new PredictedPlayer(walls, DT);
  const ref = { x: 300, y: 300 };
  for (let t = 1; t <= 5; t++) q.record(t, 127, 127, 0);
  for (let t = 1; t <= 2; t++) applyInput(walls, ref, 127, 127, 0, DT); // server applied 2 so far
  q.reconcile(2, ref.x, ref.y);
  for (let t = 3; t <= 5; t++) applyInput(walls, ref, 127, 127, 0, DT);
  assert.ok(Math.abs(q.x - ref.x) < 1e-9 && Math.abs(q.y - ref.y) < 1e-9);
});

// ---------- end to end over the simulated network, fully deterministic ----------

async function runEndToEnd({ seed, link, ticks, quiet = 120, predict = true }) {
  const clock = new VirtualClock();
  const server = await startArenaServer({ listen: false, manualTicks: true, bots: 20, serveStatic: false, seed });
  const net = new MemoryNetwork({ clock, seed, link });
  net.listen('arena').onConnection = server.attach;
  const client = new ArenaClient({ transport: net.connect('arena'), now: () => clock.now(), predict }).start();
  const TICK_MS = 1000 / 60;
  const trace = { responsive: null };
  let selfIndex = 0;
  for (let t = 0; t < ticks + quiet; t++) {
    clock.schedule(t * TICK_MS, () => {
      const [mx, my, b] = t < ticks ? scriptedInput(t) : [0, 0, 0];
      const before = client.predicted?.initialized ? [client.predicted.x, client.predicted.y] : null;
      client.sendInput(mx / 127, my / 127, b);
      if (before && trace.responsive === null && mx !== 0) {
        trace.responsive = Math.hypot(client.predicted.x - before[0], client.predicted.y - before[1]) > 0.5;
      }
    });
    clock.schedule(t * TICK_MS + 0.001, () => server.step());
  }
  clock.runUntil((ticks + quiet) * TICK_MS + 500);
  selfIndex = client.selfId & 0xfffff;
  const sx = server.world.data(netSchema.comps[0].component).x[selfIndex];
  const sy = server.world.data(netSchema.comps[0].component).y[selfIndex];
  const result = { client, server, trace, sx, sy, queue: [...server.clients][0]?.queue };
  await server.close();
  return result;
}

test('end to end, healthy network: the local player never needs correcting and responds instantly', async () => {
  const r = await runEndToEnd({ seed: 3, ticks: 900, link: { latencyMs: 45, jitterMs: 15 } });
  const p = r.client.predicted;
  assert.equal(r.client.state, 'playing');
  assert.equal(p.stats.corrections, 0, `corrections ${p.stats.corrections}, max error ${p.stats.maxError}`);
  assert.ok(p.stats.reconciles > 500, `reconciled against ${p.stats.reconciles} snapshots`);
  assert.equal(r.trace.responsive, true, 'predicted position moved in the very tick the input was sent');
  assert.ok(Math.hypot(p.x - r.sx, p.y - r.sy) < 0.1, `final position agrees with server (${p.x},${p.y}) vs (${r.sx},${r.sy})`);
  assert.ok(r.queue.stats.dropped === 0);
});

test('end to end, 10% loss + duplication + reordering: rare corrections, exact convergence', async () => {
  const lossy = { latencyMs: 60, jitterMs: 30, loss: 0.1, duplicate: 0.05, reorder: 0.1 };
  const r = await runEndToEnd({ seed: 11, ticks: 900, link: lossy });
  const p = r.client.predicted;
  assert.ok(p.stats.corrections <= 6, `corrections ${p.stats.corrections} (max error ${p.stats.maxError.toFixed(2)})`);
  assert.ok(Math.hypot(p.x - r.sx, p.y - r.sy) < 0.1, `converged: (${p.x},${p.y}) vs (${r.sx},${r.sy})`);
  assert.ok(r.client.stats.stale + r.queue.stats.duplicates > 0, 'duplicates/reordering were actually exercised');
});

test('end to end, 40% loss: heavy corrections but the player still converges', async () => {
  const r = await runEndToEnd({ seed: 21, ticks: 900, link: { latencyMs: 80, jitterMs: 60, loss: 0.4, duplicate: 0.1, reorder: 0.2 }, quiet: 240 });
  const p = r.client.predicted;
  assert.ok(Math.hypot(p.x - r.sx, p.y - r.sy) < 0.1, `converged: (${p.x},${p.y}) vs (${r.sx},${r.sy}), corrections ${p.stats.corrections}`);
});

test('without prediction the local player trails the input by the full round trip', async () => {
  const r = await runEndToEnd({ seed: 3, ticks: 300, link: { latencyMs: 45, jitterMs: 15 }, predict: false });
  assert.equal(r.client.predicted, null);
  assert.equal(r.trace.responsive, null);
});

test('speed hack: flooding inputs does not make the server move the player faster than the tick rate', async () => {
  const clock = new VirtualClock();
  const server = await startArenaServer({ listen: false, manualTicks: true, bots: 0, serveStatic: false });
  const net = new MemoryNetwork({ clock, link: { latencyMs: 5 } });
  net.listen('a').onConnection = server.attach;
  const honest = new ArenaClient({ transport: net.connect('a'), now: () => clock.now() }).start();
  clock.runUntil(100);
  assert.equal(honest.state, 'playing');
  const c = [...server.clients][0];
  const i = c.entity & 0xfffff;
  const posX = server.world.data(netSchema.comps[0].component).x;
  const x0 = posX[i];
  // A cheater sends 5 inputs per tick (300 per second) straight to the server.
  const batch = new InputBatch(inputSchema);
  const w = new BinaryWriter();
  const TICKS = 60;
  let seq = 0;
  for (let t = 0; t < TICKS; t++) {
    batch.clear(); batch.ackTick = 0; batch.firstSeq = seq + 1;
    for (let k = 0; k < 5; k++) { batch.push(0, [127, 0, 0, 0, 0, 0]); seq++; }
    w.reset(); encodeInput(w, batch);
    honest.transport.send(w.finish(), CHANNEL.UNRELIABLE);
    clock.advance(1000 / 60);
    server.step();
  }
  clock.advance(100);
  const moved = posX[i] - x0;
  const maxLegit = PLAYER_SPEED * (TICKS + 4) / 60;
  assert.ok(c.queue.stats.applied <= TICKS + 4, `applied ${c.queue.stats.applied} inputs in ${TICKS} ticks`);
  assert.ok(moved <= maxLegit + 1 && moved > 0, `moved ${moved.toFixed(1)} <= ${maxLegit.toFixed(1)}`);
  assert.ok(c.queue.stats.dropped > 0, 'excess inputs were dropped');
  void WORLD;
  await server.close();
});

test('a snapshot that already acknowledges inputs sent before prediction started does not cause a snap (regression)', () => {
  // Real sequence found over a resumed WebSocket: input 1 was sent before the first snapshot arrived; that
  // snapshot already acknowledged it, and the NEXT snapshot repeated ack 1 while input 2 was pending.
  const p = new PredictedPlayer(walls, DT);
  const server = { x: 300, y: 300 };
  p.record(1, 0, 127, 0);                 // sent before prediction exists: no predicted position for seq 1
  applyInput(walls, server, 0, 127, 0, DT);
  p.reconcile(1, server.x, server.y);     // first snapshot: initialises at the server's position after input 1
  p.record(2, 0, 127, 0);                 // client keeps predicting
  p.reconcile(1, server.x, server.y);     // next snapshot still only acknowledges input 1
  const expected = { x: server.x, y: server.y };
  applyInput(walls, expected, 0, 127, 0, DT); // where the player should be after input 2 as well
  assert.ok(Math.abs(p.y - expected.y) < 1e-9, `kept the replayed input 2 (y ${p.y} vs ${expected.y})`);
  assert.equal(p.stats.snaps, 0, 'no snap');
  assert.equal(p.stats.corrections, 0, 'and nothing counted as a correction');
  applyInput(walls, server, 0, 127, 0, DT);
  p.reconcile(2, server.x, server.y);     // input 2 acknowledged: matches
  assert.equal(p.stats.corrections, 0);
  assert.ok(Math.abs(p.y - server.y) < 1e-9);
});
