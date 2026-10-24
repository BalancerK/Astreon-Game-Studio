import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startArenaServer } from '../server/arena-server.js';
import { ArenaClient } from '../client/net.js';
import { traceShot, rayCircle } from '../shared/shot.js';
import { encodeShot } from '../shared/events.js';
import { Pos, BUTTON_FIRE, buildWalls, buildWallHash } from '../shared/game.js';
import { MemoryNetwork, VirtualClock } from '../../../packages/transport/src/index.js';
import { BinaryWriter } from '../../../packages/protocol/src/index.js';
import { shootMovingTarget, findClearRect, SLOT, TICK_MS } from './netlab.js';

const walls = buildWallHash(buildWalls());
const out = { victim: -1, reach: 0 };

test('traceShot: nearest target wins, walls and range stop the shot, misses report full reach', () => {
  const rect = findClearRect(780, 560);
  const ox = rect.x + 100, oy = rect.y + 300;
  const ids = [11, 22, 33], xs = [ox + 400, ox + 200, ox + 300], ys = [oy, oy + 2, oy + 200], rs = [14, 14, 14];
  traceShot(walls, ox, oy, 1, 0, 900, 3, ids, xs, ys, rs, out);
  assert.equal(out.victim, 22, 'the nearest circle on the line');
  assert.ok(Math.abs(out.reach - (200 - Math.sqrt(14 * 14 - 4))) < 1e-9);
  traceShot(walls, ox, oy, 1, 0, 900, 0, ids, xs, ys, rs, out);
  assert.deepEqual([out.victim, out.reach], [-1, 900], 'a miss travels the full range');
  traceShot(walls, ox, oy, 1, 0, 150, 3, ids, xs, ys, rs, out);
  assert.equal(out.victim, -1, 'beyond range');
  // a wall between the shooter and the target blocks the shot
  const pillar = buildWalls()[4];
  traceShot(walls, pillar.x - pillar.hw - 100, pillar.y, 1, 0, 900, 1, [7], [pillar.x + pillar.hw + 100], [pillar.y], [14], out);
  assert.equal(out.victim, -1);
  assert.ok(out.reach < 200, `stopped at the pillar after ${out.reach.toFixed(1)}`);
  assert.equal(rayCircle(0, 0, 1, 0, 100, 0, 10, 500), 90);
});

test('you see the shot the instant you fire; the server\'s event is a confirmation, not a second tracer', async () => {
  const withPrediction = await shootMovingTarget({ latencyMs: 100, predictShots: true });
  const without = await shootMovingTarget({ latencyMs: 100, predictShots: false });

  assert.equal(withPrediction.predicted.length, 30, 'every trigger pull was predicted');
  withPrediction.predicted.forEach((p, i) => assert.equal(p.at, withPrediction.firedAt[i], `shot ${i} was shown in the same instant it was fired`));
  assert.equal(withPrediction.verdicts.length, 30, 'and the server answered every one');
  const delays = withPrediction.verdicts.map((v, i) => v.at - withPrediction.firedAt[i]);
  assert.ok(Math.min(...delays) >= 190, `server verdicts arrive a round trip later (${Math.min(...delays).toFixed(0)} to ${Math.max(...delays).toFixed(0)} ms)`);

  // without prediction the first thing you see is that same round trip later
  assert.equal(without.predicted.length, 0);
  assert.equal(without.events.length, 30);

  // accuracy: what you saw is what the server decided
  const agreed = withPrediction.verdicts.filter((v) => v.agreed).length;
  assert.ok(agreed >= 27, `predicted hit/miss matched the server ${agreed}/30 times`);
  assert.equal(withPrediction.a.shotStats.agreed, agreed);
  assert.equal(withPrediction.events.length, 30 - agreed, 'the server event is only drawn again when it disagrees');
  assert.ok(withPrediction.events.every((e) => e.corrected === true));
  const predictedHits = withPrediction.predicted.filter((p) => p.victim >= 0).length;
  assert.ok(Math.abs(predictedHits - withPrediction.hits) <= 3, `predicted ${predictedHits} hits, server counted ${withPrediction.hits}`);
  assert.equal(withPrediction.a.shotStats.unconfirmed, 0);
  assert.equal(withPrediction.a.predicted.stats.corrections, 0, 'movement prediction is unaffected');
});

test('cooldown is predicted exactly: holding fire shoots precisely as often as the server allows, for default and modded cooldowns', async () => {
  for (const cooldownTicks of [10, 5, 23]) {
    const r = await shootMovingTarget({ latencyMs: 60, predictShots: true, cooldownTicks, shots: 200, spacing: 1 }); // pull the trigger every tick
    assert.ok(r.server.stats.shots >= 8, `server accepted ${r.server.stats.shots} shots`);
    assert.equal(r.predicted.length, r.server.stats.shots, `cooldown ${cooldownTicks}: ${r.predicted.length} predicted vs ${r.server.stats.shots} accepted`);
    assert.equal(r.a.shotStats.confirmed, r.predicted.length);
    assert.equal(r.a.shotStats.unconfirmed, 0);
    assert.equal(r.a.shotStats.cooldownResyncs <= 1, true, `the client's cooldown count never had to be corrected (${r.a.shotStats.cooldownResyncs})`);
    const gaps = r.predicted.slice(1).map((p, i) => p.seq - r.predicted[i].seq);
    assert.ok(gaps.every((g) => g === cooldownTicks), `shots are ${cooldownTicks} inputs apart: ${[...new Set(gaps)]}`);
  }
});

test('with jitter and packet loss the predicted shots still line up with the server\'s', async () => {
  const r = await shootMovingTarget({ latencyMs: 80, jitterMs: 25, loss: 0.05, predictShots: true, shots: 120, spacing: 3 });
  const s = r.a.shotStats;
  assert.ok(r.predicted.length >= 15);
  // an event can be lost (unreliable), and a lost fire input is never replayed: those are the only ways to differ
  assert.ok(Math.abs(r.predicted.length - r.server.stats.shots) <= Math.ceil(r.predicted.length * 0.25), `${r.predicted.length} predicted, ${r.server.stats.shots} accepted`);
  assert.ok(s.confirmed >= s.predicted * 0.7, `${s.confirmed}/${s.predicted} confirmed`);
  assert.ok(s.agreed >= s.confirmed * 0.8, `${s.agreed}/${s.confirmed} confirmed shots matched`);
});

test('when the server disagrees it wins: the correction is shown, the cooldown follows the server, unknown shots draw normally', async () => {
  const clock = new VirtualClock();
  const server = await startArenaServer({ listen: false, manualTicks: true, bots: 0, serveStatic: false });
  const net = new MemoryNetwork({ clock, link: { latencyMs: 20 } });
  net.listen('a').onConnection = server.attach;
  const a = new ArenaClient({ transport: net.connect('a'), now: () => clock.now() }).start();
  clock.runUntil(300);
  const run = (n) => { for (let i = 0; i < n; i++) { clock.advance(TICK_MS); a.sendInput(0, 0, 0); server.step(); } };
  run(40);
  a.renderTick();
  const verdicts = [], events = [];
  a.onShotResult = (r) => verdicts.push(r);
  a.onEvent = (e) => events.push(e);
  a.sendInput(0, 0, BUTTON_FIRE, 1, 0);
  const seq = a.seq;
  assert.equal(a.predictedShots.size, 1);
  assert.equal(a.nextFireSeq, seq + a.rules.weapon.cooldownTicks);

  // a verdict that contradicts the prediction (we predicted a miss; the server says it hit entity 123)
  const w = new BinaryWriter();
  encodeShot(w, { shooter: a.selfId, hit: 123, seq, x0: 0, y0: 0, x1: 100, y1: 0 });
  a.transport.onMessage(w.finish(), 0);
  assert.equal(verdicts.length, 1);
  assert.equal(verdicts[0].agreed, false);
  assert.equal(a.shotStats.disagreed, 1);
  assert.equal(events.length, 1);
  assert.equal(events[0].corrected, true, 'the server\'s version is shown');
  assert.equal(a.predictedShots.size, 0);

  // the server accepted a shot we did not predict (we thought we were still cooling down): follow its count
  const before = a.nextFireSeq;
  w.reset();
  encodeShot(w, { shooter: a.selfId, hit: -1, seq: seq + 100, x0: 0, y0: 0, x1: 1, y1: 0 });
  a.transport.onMessage(w.finish(), 0);
  assert.equal(a.nextFireSeq, seq + 100 + a.rules.weapon.cooldownTicks);
  assert.ok(a.nextFireSeq > before);
  assert.equal(events.length, 2);
  assert.equal(events[1].corrected, undefined, 'an unpredicted own shot is drawn as usual');

  // other players' shots are never touched
  w.reset();
  encodeShot(w, { shooter: a.selfId + 1, hit: -1, seq: 5, x0: 0, y0: 0, x1: 1, y1: 0 });
  a.transport.onMessage(w.finish(), 0);
  assert.equal(events.length, 3);
  await server.close();
});

test('no prediction when it cannot be right: switched off, no fire button, no aim, cooling down, or before the first snapshot', async () => {
  const clock = new VirtualClock();
  const server = await startArenaServer({ listen: false, manualTicks: true, bots: 0, serveStatic: false });
  const net = new MemoryNetwork({ clock, link: { latencyMs: 20 } });
  net.listen('a').onConnection = server.attach;
  const off = new ArenaClient({ transport: net.connect('a'), now: () => clock.now(), predictShots: false }).start();
  const on = new ArenaClient({ transport: net.connect('a'), now: () => clock.now() }).start();
  const shots = [];
  on.onPredictedShot = (s) => shots.push(s);
  on.sendInput(0, 0, BUTTON_FIRE, 1, 0); // not even connected yet
  clock.runUntil(300);
  on.sendInput(0, 0, BUTTON_FIRE, 1, 0); // connected, but nothing rendered yet
  const run = (n, f) => { for (let i = 0; i < n; i++) { clock.advance(TICK_MS); f(); server.step(); } };
  run(40, () => { on.sendInput(0, 0, 0); off.sendInput(0, 0, 0); });
  on.renderTick(); off.renderTick();
  assert.equal(shots.length, 0, 'nothing predicted so far');
  on.sendInput(0, 0, 0, 1, 0);
  assert.equal(shots.length, 0, 'no fire button');
  on.sendInput(0, 0, BUTTON_FIRE, 0, 0);
  assert.equal(shots.length, 0, 'no aim: the server ignores it too and does not start a cooldown');
  off.sendInput(0, 0, BUTTON_FIRE, 1, 0);
  assert.equal(off.predictedShots.size, 0, 'switched off');
  on.sendInput(0, 0, BUTTON_FIRE, 1, 0);
  assert.equal(shots.length, 1);
  on.sendInput(0, 0, BUTTON_FIRE, 1, 0);
  on.sendInput(0, 0, BUTTON_FIRE, 1, 0);
  assert.equal(shots.length, 1, 'cooling down');
  assert.equal(shots[0].victim, -1);
  assert.ok(Math.hypot(shots[0].x1 - shots[0].x0, shots[0].y1 - shots[0].y0) > 0, 'a miss still has a tracer');
  await server.close();
});

test('a player who floods inputs cannot fire faster than the cooldown allows', async () => {
  const clock = new VirtualClock();
  const server = await startArenaServer({ listen: false, manualTicks: true, bots: 0, serveStatic: false });
  const net = new MemoryNetwork({ clock, link: { latencyMs: 5 } });
  net.listen('a').onConnection = server.attach;
  const a = new ArenaClient({ transport: net.connect('a'), now: () => clock.now() }).start();
  clock.runUntil(300);
  for (let i = 0; i < 30; i++) { clock.advance(TICK_MS); a.sendInput(0, 0, 0); server.step(); }
  a.renderTick();
  const before = server.stats.shots;
  const TICKS = 120;
  for (let t = 0; t < TICKS; t++) {
    clock.advance(TICK_MS);
    for (let k = 0; k < 6; k++) { a.seq += k === 0 ? 0 : 3; a.sendInput(0, 0, BUTTON_FIRE, 1, 0); } // six fire inputs per tick, with sequence jumps
    server.step();
  }
  const fired = server.stats.shots - before;
  const max = Math.ceil(TICKS / server.rules.weapon.cooldownTicks) + 1;
  assert.ok(fired <= max + 4, `${fired} shots in ${TICKS} ticks (a steady player gets ${Math.floor(TICKS / server.rules.weapon.cooldownTicks)})`);
  await server.close();
});

test('after a reconnect the client forgets pending shots and starts counting again', async () => {
  const clock = new VirtualClock();
  const server = await startArenaServer({ listen: false, manualTicks: true, bots: 0, serveStatic: false });
  const net = new MemoryNetwork({ clock, link: { latencyMs: 20 } });
  net.listen('a').onConnection = server.attach;
  const a = new ArenaClient({
    transport: net.connect('a'), now: () => clock.now(),
    reconnect: { createTransport: () => net.connect('a'), setTimer: (ms, fn) => clock.schedule(ms, fn) },
  }).start();
  clock.runUntil(300);
  for (let i = 0; i < 40; i++) { clock.advance(TICK_MS); a.sendInput(0, 0, 0); server.step(); }
  a.renderTick();
  a.sendInput(0, 0, BUTTON_FIRE, 1, 0);
  assert.equal(a.predictedShots.size, 1);
  a.transport.close('network lost');
  assert.equal(a.state, 'reconnecting');
  assert.equal(a.predictedShots.size, 1, 'kept until the new connection starts');
  clock.advance(400);
  assert.equal(a.state, 'playing');
  assert.equal(a.predictedShots.size, 0);
  assert.equal(a.nextFireSeq, 0);
  await server.close();
});
