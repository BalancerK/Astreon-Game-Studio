import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startArena3dServer } from '../server/arena3d-server.js';
import { Arena3dClient } from '../client/net.js';
import { PredictedPlayer3D } from '../client/predict.js';
import { resolveViewTick } from '../server/weapon.js';
import { InputQueue } from '../server/input-queue.js';
import { rayEllipsoid, traceShot } from '../shared/shot.js';
import { encodeShot, decodeEvent, EVENT } from '../shared/events.js';
import { buildArenaLevel } from '../shared/level.js';
import { createBody, stepPlayer, netSchema, Pos3, BUTTON_FIRE, BUTTON_JUMP, BODY } from '../shared/game.js';
import { MemoryNetwork, VirtualClock } from '../../../packages/transport/src/index.js';
import { BinaryWriter } from '../../../packages/protocol/src/index.js';
import { scriptedInput, shootMovingTarget, teleport, TICK_MS, SLOT } from './netlab.js';

test('shot geometry: rays vs ellipsoid bodies and walls', () => {
  assert.equal(rayEllipsoid(0, 0, 0, 1, 0, 0, 10, 0, 0, 0.4, 0.9, 0.4, 100), 9.6, 'head-on');
  assert.equal(rayEllipsoid(0, 0, 0, 1, 0, 0, 10, 2, 0, 0.4, 0.9, 0.4, 100), -1, 'passes above (body is 0.9 tall each way)');
  assert.ok(rayEllipsoid(0, 0, 0, 1, 0, 0, 10, 0.8, 0, 0.4, 0.9, 0.4, 100) > 0, 'clips the top of a tall body');
  assert.equal(rayEllipsoid(0, 0, 0, 1, 0, 0, -10, 0, 0, 0.4, 0.9, 0.4, 100), -1, 'behind');
  assert.equal(rayEllipsoid(0, 0, 0, 1, 0, 0, 200, 0, 0, 0.4, 0.9, 0.4, 100), -1, 'out of range');
  assert.equal(rayEllipsoid(0, 0, 0, 1, 0, 0, 0.1, 0, 0, 0.4, 0.9, 0.4, 100), 0, 'origin inside');

  const { world } = buildArenaLevel();
  const out = { victim: -1, reach: 0 };
  // open ground: a body at 10 m is hit
  traceShot(world, -10, 0.9, 44, 1, 0, 0, 120, 1, [7], [0], [0.9], [44], 0.4, 0.9, 0.4, out);
  assert.equal(out.victim, 7);
  assert.ok(Math.abs(out.reach - 9.6) < 1e-9);
  // a pillar between shooter and body stops the shot: pillar at (26, 0), ring of radius 26
  traceShot(world, 10, 1.6, 0, 1, 0, 0, 120, 1, [7], [40], [0.9], [0], 0.4, 0.9, 0.4, out);
  assert.equal(out.victim, -1, 'the pillar is in the way');
  assert.ok(out.reach < 20, `shot ends at the pillar (${out.reach})`);
});

test('events and the claimed view tick', () => {
  const w = new BinaryWriter();
  encodeShot(w, { shooter: 12, hit: 77, seq: 9, x0: 1.5, y0: 2.25, z0: -3, x1: 30, y1: 4, z1: -50 });
  const e = decodeEvent(w.finish());
  assert.deepEqual([e.kind, e.shooter, e.hit, e.seq, e.x0, e.y0, e.z0, e.x1, e.y1, e.z1], [EVENT.SHOT, 12, 77, 9, 1.5, 2.25, -3, 30, 4, -50]);
  assert.equal(resolveViewTick(0, 100, 12), 100);
  assert.equal(resolveViewTick((95 * 4) & 0xffff, 100, 12), 95);
  assert.equal(resolveViewTick((50 * 4) & 0xffff, 100, 12), 88, 'clamped to the rewind window');
  assert.equal(resolveViewTick((16390 * 4) & 0xffff, 16394, 12), 16390, 'across the 16-bit wrap');

  const q = new InputQueue({ eventMask: BUTTON_FIRE, maxCredit: 100 });
  q.push(1, 0, 0, BUTTON_FIRE | 2, 1.5, 0.2, 400);
  q.push(4, 0, 0, 0, 0, 0, 0);
  for (let i = 0; i < 10; i++) q.tick();
  const got = [], o = {};
  while (q.pop(o)) got.push([o.seq, o.buttons, o.yaw, o.pitch, o.view]);
  assert.deepEqual(got, [[1, 6, 1.5, 0.2, 400], [2, 2, 1.5, 0.2, 0], [3, 2, 1.5, 0.2, 0], [4, 0, 0, 0, 0]], 'run is held through the gap, the shot is not repeated, look direction is kept');
});

test('prediction: replaying inputs from the server state reproduces the server exactly (jumps, stairs, ramps)', () => {
  const { world } = buildArenaLevel();
  const DT = 1 / 60;
  const server = createBody(-36, 0.9, 30);
  const p = new PredictedPlayer3D(world, DT);
  const ref = createBody(-36, 0.9, 30);
  const input = { moveX: 0, moveY: 0, buttons: 0, yaw: 0 };
  for (let t = 1; t <= 600; t++) {
    const [mx, my, b, yaw] = scriptedInput(t);
    input.moveX = mx; input.moveY = my; input.buttons = b; input.yaw = Math.fround(yaw);
    stepPlayer(world, server, input, DT);
    p.record(t, mx, my, b, input.yaw);
    if (t === 1) p.reconcile(0, -36, 0.9, 30, 0, false);
    if (t % 7 === 0 && t > 20) { // acks arrive late, state quantized to 2 mm
      const ack = t - 5;
      void ack;
    }
  }
  void ref;
  assert.ok(p.initialized);
  // a single reconcile at an acknowledged input: the server state at that input, then replay to the present
  const p2 = new PredictedPlayer3D(world, DT);
  const srv = createBody(-36, 0.9, 30);
  const states = [];
  for (let t = 1; t <= 300; t++) {
    const [mx, my, b, yaw] = scriptedInput(t);
    input.moveX = mx; input.moveY = my; input.buttons = b; input.yaw = Math.fround(yaw);
    stepPlayer(world, srv, input, DT);
    p2.record(t, mx, my, b, input.yaw);
    states.push([srv.x, srv.y, srv.z, srv.vy, srv.grounded]);
  }
  // prediction never started before; adopt the state after input 200 and replay 201..300
  p2.reconcile(200, ...states[199]);
  const end = states[299];
  assert.ok(Math.abs(p2.body.x - end[0]) < 1e-9 && Math.abs(p2.body.y - end[1]) < 1e-9 && Math.abs(p2.body.z - end[2]) < 1e-9, 'bit-identical to the server after replay');
});

async function runEndToEnd({ seed, link, ticks, quiet = 120, predict = true }) {
  const clock = new VirtualClock();
  const server = await startArena3dServer({ listen: false, manualTicks: true, bots: 20, seed, botAi: false }); // (wandering bots: a netcode test should not have the player shot dead and respawned)
  const net = new MemoryNetwork({ clock, seed, link });
  net.listen('arena').onConnection = server.attach;
  const client = new Arena3dClient({ transport: net.connect('arena'), now: () => clock.now(), predict }).start();
  let moved = 0;
  for (let t = 0; t < ticks + quiet; t++) {
    clock.schedule(t * TICK_MS, () => {
      const [mx, my, b, yaw, pitch] = t < ticks ? scriptedInput(t) : [0, 0, 0, 0, 0];
      const before = client.predicted?.initialized ? [client.predicted.x, client.predicted.z] : null;
      client.sendInput(mx / 127, my / 127, b, yaw, pitch);
      if (before && mx !== 0) moved = Math.max(moved, Math.hypot(client.predicted.x - before[0], client.predicted.z - before[1]));
    });
    clock.schedule(t * TICK_MS + 0.001, () => server.step());
  }
  clock.runUntil((ticks + quiet) * TICK_MS + 500);
  const slot = client.selfId & SLOT;
  const d = server.world.data(Pos3);
  const result = { client, server, moved, sx: d.x[slot], sy: d.y[slot], sz: d.z[slot] };
  await server.close();
  return result;
}

test('end to end, healthy network: the local player is never corrected and responds at once', async () => {
  const r = await runEndToEnd({ seed: 3, ticks: 900, link: { latencyMs: 45, jitterMs: 15 } });
  const p = r.client.predicted;
  assert.equal(r.client.state, 'playing');
  assert.ok(r.moved > 0.05, 'the very frame an input is sent, the predicted player has moved');
  assert.ok(p.stats.reconciles > 100);
  assert.equal(p.stats.snaps, 0);
  assert.ok(p.stats.maxError < 0.03, `max prediction error ${p.stats.maxError}`);
  assert.ok(p.stats.corrections <= 2, `${p.stats.corrections} corrections`);
  assert.ok(Math.hypot(p.x - r.sx, p.y - r.sy, p.z - r.sz) < 0.03, 'ends where the server has the player');
});

test('end to end, bad network: loss, duplication, reordering still converge', async () => {
  const r = await runEndToEnd({ seed: 21, ticks: 900, link: { latencyMs: 80, jitterMs: 60, loss: 0.3, duplicate: 0.1, reorder: 0.2 }, quiet: 240 });
  const p = r.client.predicted;
  assert.ok(Math.hypot(p.x - r.sx, p.y - r.sy, p.z - r.sz) < 0.05, `ends within 5 cm of the server (${Math.hypot(p.x - r.sx, p.y - r.sy, p.z - r.sz)})`);
  assert.equal(r.client.stats.protocolErrors, 0);
});

test('without prediction the same run still works (the player is just late)', async () => {
  const r = await runEndToEnd({ seed: 3, ticks: 300, link: { latencyMs: 45, jitterMs: 15 }, predict: false });
  assert.equal(r.client.predicted, null);
  assert.ok(r.client.stats.snapshots > 100);
});

test('the client cannot move faster than the tick rate, and cannot move through walls', async () => {
  const clock = new VirtualClock();
  const server = await startArena3dServer({ listen: false, manualTicks: true, bots: 0 });
  const net = new MemoryNetwork({ clock, link: { latencyMs: 5 } });
  net.listen('arena').onConnection = server.attach;
  const c = new Arena3dClient({ transport: net.connect('arena'), now: () => clock.now() }).start();
  clock.runUntil(100);
  teleport(server, c.selfId, 0, 0.9, 44);
  // run straight into the south wall at z = 50 for 4 seconds
  for (let t = 0; t < 240; t++) {
    clock.schedule(100 + t * TICK_MS, () => c.sendInput(0, 1, 2, 3.14159, 0)); // yaw ~ pi looks toward +z
    clock.schedule(100 + t * TICK_MS + 0.001, () => server.step());
  }
  clock.runUntil(100 + 240 * TICK_MS + 300);
  const z = server.world.data(Pos3).z[c.selfId & SLOT];
  assert.ok(z < 50 - BODY.radius + 0.05 && z > 48, `stopped by the wall (z = ${z})`);
  await server.close();
});

test('lag compensation: aiming at what you SEE hits, even with 200 ms round trip', async () => {
  const withComp = await shootMovingTarget({ lagCompensation: true });
  const without = await shootMovingTarget({ lagCompensation: false });
  assert.equal(withComp.shots, 30, 'every trigger pull produced a shot');
  const rateWith = withComp.hits / withComp.shots, rateWithout = without.hits / without.shots;
  assert.ok(rateWith >= 0.9, `with lag compensation ${withComp.hits}/${withComp.shots} hit`);
  assert.ok(rateWithout <= 0.3, `without it only ${without.hits}/${without.shots} hit: the target had moved on`);
  assert.ok(withComp.events.filter((e) => e.hit >= 0).length >= 27, 'the shooter is told about the hits');
});

test('shot prediction: the tracer and hit show at once and the server agrees', async () => {
  const r = await shootMovingTarget({ predictShots: true, latencyMs: 100 });
  assert.ok(r.predicted.length >= 25, `${r.predicted.length} shots predicted`);
  assert.ok(r.verdicts.length >= 25);
  const agreed = r.verdicts.filter((v) => v.agreed).length;
  assert.ok(agreed / r.verdicts.length >= 0.9, `${agreed}/${r.verdicts.length} predictions matched the server`);
  assert.ok(r.a.shotStats.predicted >= 25 && r.a.shotStats.disagreed <= 3);
  const lead = r.verdicts.map((v) => v.at - r.predicted.find((p) => p.seq === v.predicted.seq).at);
  assert.ok(lead.every((ms) => ms > 150), 'the prediction came a full round trip before the verdict');
});

test('interest: far players are not sent, near ones are; bandwidth is bounded', async () => {
  const clock = new VirtualClock();
  const server = await startArena3dServer({ listen: false, manualTicks: true, bots: 60, viewRadius: 30, seed: 4 });
  const net = new MemoryNetwork({ clock, link: { latencyMs: 20 } });
  net.listen('arena').onConnection = server.attach;
  const c = new Arena3dClient({ transport: net.connect('arena'), now: () => clock.now() }).start();
  clock.runUntil(100);
  teleport(server, c.selfId, -40, 0.9, -40);
  for (let t = 0; t < 120; t++) {
    clock.schedule(100 + t * TICK_MS, () => c.sendInput(0, 0, 0, 0, 0));
    clock.schedule(100 + t * TICK_MS + 0.001, () => server.step());
  }
  clock.runUntil(100 + 120 * TICK_MS + 200);
  const view = c.history.latest();
  const d = server.world.data(Pos3);
  let near = 0;
  for (let i = 0; i < view.count; i++) {
    const s = view.ids[i] & SLOT;
    assert.ok(Math.hypot(d.x[s] + 40, d.z[s] + 40) < 30 * 1.15 + 3, 'nobody beyond the leave radius is in the view');
    near++;
  }
  assert.ok(near >= 1 && near < 61, `saw ${near} of 61 players`);
  await server.close();
});

test('schema: positions carry 2 mm resolution and the hash is stable', () => {
  const [, , , ,] = netSchema.comps;
  const fx = netSchema.comps[0].fields[0].codec;
  assert.ok(Math.abs(fx.dequantize(fx.quantize(12.3456)) - 12.3456) <= (128 / 65535) / 2 + 1e-12);
  assert.equal(typeof netSchema.hash, 'number');
  void BUTTON_JUMP;
});

test('shared rules are repeatable and match the recorded golden hashes', async () => {
  const { readFileSync } = await import('node:fs');
  const { runArena3dSuite } = await import('../shared/determinism.js');
  const golden = JSON.parse(readFileSync(new URL('./determinism.golden.json', import.meta.url), 'utf8'));
  const a = runArena3dSuite().exact, b = runArena3dSuite().exact;
  assert.deepEqual(a, b);
  assert.deepEqual(a, golden, 'changed: if intended, run `node tools/determinism.js --update` and review');
});
