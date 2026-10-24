import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startArenaServer } from '../server/arena-server.js';
import { ArenaClient } from '../client/net.js';
import { createSampleBuffer, sampleWorld } from '../client/interp.js';
import { InputQueue } from '../server/input-queue.js';
import { rayCircle, resolveViewTick } from '../server/weapon.js';
import { encodeShot, decodeEvent, EVENT } from '../shared/events.js';
import { Pos, Style, Health, BUTTON_FIRE, WEAPON, buildWalls, buildWallHash, netSchema } from '../shared/game.js';
import { MemoryNetwork, VirtualClock } from '../../../packages/transport/src/index.js';
import { BinaryWriter, describePacket } from '../../../packages/protocol/src/index.js';
import { shootMovingTarget, findClearRect, SLOT, TICK_MS } from './netlab.js';

test('weapon maths: ray vs circle and the claimed view tick', () => {
  assert.equal(rayCircle(0, 0, 1, 0, 100, 0, 10, 500), 90, 'head-on');
  assert.equal(rayCircle(0, 0, 1, 0, 100, 30, 10, 500), -1, 'passes beside');
  assert.equal(rayCircle(0, 0, 1, 0, -100, 0, 10, 500), -1, 'behind the shooter');
  assert.equal(rayCircle(0, 0, 1, 0, 600, 0, 10, 500), -1, 'beyond range');
  assert.equal(rayCircle(0, 0, 1, 0, 3, 0, 10, 500), 0, 'origin inside the circle');
  assert.ok(Math.abs(rayCircle(0, 0, 1, 0, 100, 9.9, 10, 500) - 98.6) < 1, 'grazing hit');

  assert.equal(resolveViewTick(0, 100, 12), 100, 'no information: now');
  assert.equal(resolveViewTick((95 * 4) & 0xffff, 100, 12), 95);
  assert.equal(resolveViewTick((50 * 4) & 0xffff, 100, 12), 88, 'too old: clamped to the rewind window');
  assert.equal(resolveViewTick((130 * 4) & 0xffff, 100, 12), 100, 'claims to be looking at the future: clamped to now');
  // wraparound: 65536 quarter ticks = 16384 ticks
  assert.equal(resolveViewTick((16390 * 4) & 0xffff, 16394, 12), 16390, 'works across the 16-bit wrap');
  assert.equal(resolveViewTick((6 * 4) & 0xffff, 16390, 12), 16390, 'a claim from just after the wrap');
});

test('events: shot packets round trip and appear in the packet inspector', () => {
  const w = new BinaryWriter();
  encodeShot(w, { shooter: 12, hit: 77, x0: 10.5, y0: 20.25, x1: 300, y1: 400 });
  const e = decodeEvent(w.finish());
  assert.deepEqual([e.kind, e.shooter, e.hit, e.x0, e.y0, e.x1, e.y1], [EVENT.SHOT, 12, 77, 10.5, 20.25, 300, 400]);
  w.reset();
  encodeShot(w, { shooter: 0, hit: -1, x0: 0, y0: 0, x1: 1, y1: 1 });
  assert.equal(decodeEvent(w.finish()).hit, -1, 'miss');
  assert.equal(describePacket(w.finish()).type, 'EVENT');
});

test('fire is an event, not held state: lost-input gap filling never repeats a shot', () => {
  const q = new InputQueue({ eventMask: BUTTON_FIRE, maxCredit: 100 });
  q.push(1, 0, 0, BUTTON_FIRE | 1, 50, 60, 400); // fire + dash
  q.push(4, 0, 0, 0, 0, 0, 0);                    // 2 and 3 were lost
  for (let i = 0; i < 10; i++) q.tick();
  const got = [], out = {};
  while (q.pop(out)) got.push([out.seq, out.buttons, out.aimX, out.view]);
  assert.deepEqual(got, [[1, 3, 50, 400], [2, 1, 50, 0], [3, 1, 50, 0], [4, 0, 0, 0]], 'dash is held through the gap; the shot is not repeated');
});

test('lag compensation: aiming at what you SEE hits, even with 200 ms round trip', async () => {
  const withComp = await shootMovingTarget({ lagCompensation: true });
  const without = await shootMovingTarget({ lagCompensation: false });
  assert.equal(withComp.shots, 30, 'every trigger pull produced a shot');
  const rateWith = withComp.hits / withComp.shots, rateWithout = without.hits / without.shots;
  assert.ok(rateWith >= 0.9, `with lag compensation ${withComp.hits}/${withComp.shots} hit`);
  assert.ok(rateWithout <= 0.2, `without it only ${without.hits}/${without.shots} hit: the target had moved on`);
  assert.ok(withComp.events.length >= 30, 'the shooter is told about every shot');
  assert.ok(withComp.events.filter((e) => e.hit >= 0).length >= 27, 'and about the hits');
  assert.equal(withComp.a.predicted.stats.corrections, 0, 'prediction unaffected by firing');
});

test('lag compensation stays accurate under jitter and loss', async () => {
  const r = await shootMovingTarget({ latencyMs: 80, jitterMs: 30, loss: 0.08, shots: 40 });
  assert.ok(r.shots >= 36, `${r.shots} shots registered of ${r.fired} fired (some inputs can be lost)`);
  assert.ok(r.hits / r.shots >= 0.8, `${r.hits}/${r.shots} hit on a bad network`);
});

test('the rewind window is capped: a shooter cannot reach arbitrarily far into the past', async () => {
  const roomy = await shootMovingTarget({ latencyMs: 100, maxRewindMs: 250, shots: 20 });
  const capped = await shootMovingTarget({ latencyMs: 100, maxRewindMs: 50, shots: 20 });
  assert.ok(roomy.hits / roomy.shots >= 0.9);
  assert.ok(capped.hits / capped.shots <= 0.4, `capped at 50 ms: ${capped.hits}/${capped.shots} (needs ~130 ms of rewind, so most miss)`);
});

test('an entity the shooter could not see cannot be hit, even if the shot geometry lines up', async () => {
  const rect = findClearRect(780, 560);
  const clock = new VirtualClock();
  const server = await startArenaServer({ listen: false, manualTicks: true, bots: 0, serveStatic: false, viewRadius: 250 });
  const net = new MemoryNetwork({ clock, link: { latencyMs: 20 } });
  net.listen('a').onConnection = server.attach;
  const a = new ArenaClient({ transport: net.connect('a'), now: () => clock.now(), predictShots: false }).start();
  clock.runUntil(300);
  const { x, y } = server.world.data(Pos);
  x[a.selfId & SLOT] = rect.x + 100; y[a.selfId & SLOT] = rect.y + 300;
  const far = server.world.create();
  server.world.add(far, Pos, { x: rect.x + 100 + 400, y: rect.y + 300 }); // 400 away: outside the 250 view
  server.world.add(far, Style, { hue: 1, radius: 14 });
  server.world.add(far, Health, { hp: 100 });
  for (let t = 0; t < 60; t++) { clock.advance(TICK_MS); a.sendInput(0, 0, 0); server.step(); }
  a.renderTick();
  a.sendInput(0, 0, BUTTON_FIRE, 1, 0); // dead straight at it
  clock.advance(100); server.step(); // the input needs 20 ms to arrive, then the server applies it
  assert.equal(server.stats.shots, 1);
  assert.equal(server.stats.hits, 0, 'not in view, not hittable (also stops wall-hack style targeting of hidden entities)');
  await server.close();
});

test('walls stop shots; damage, death and respawn work', async () => {
  const pillar = buildWalls()[4];
  const clock = new VirtualClock();
  const server = await startArenaServer({ listen: false, manualTicks: true, bots: 0, serveStatic: false });
  const net = new MemoryNetwork({ clock, link: { latencyMs: 10 } });
  net.listen('a').onConnection = server.attach;
  const a = new ArenaClient({ transport: net.connect('a'), now: () => clock.now(), predictShots: false }).start();
  clock.runUntil(300);
  const { x, y } = server.world.data(Pos), hp = server.world.data(Health).hp;
  const mkTarget = (px, py) => { const e = server.world.create(); server.world.add(e, Pos, { x: px, y: py }); server.world.add(e, Style, { hue: 1, radius: 12 }); server.world.add(e, Health, { hp: 100 }); return e; };
  const tick = (n = 1) => { for (let i = 0; i < n; i++) { clock.advance(TICK_MS); a.sendInput(0, 0, 0); server.step(); } };
  const fireAt = (tx, ty) => { tick(WEAPON.cooldownTicks + 1); a.renderTick(); a.sendInput(0, 0, BUTTON_FIRE, tx - x[a.selfId & SLOT], ty - y[a.selfId & SLOT]); clock.advance(TICK_MS); server.step(); clock.advance(60); };

  // shooter and target on opposite sides of a pillar, in a straight line through it
  x[a.selfId & SLOT] = pillar.x - pillar.hw - 120; y[a.selfId & SLOT] = pillar.y;
  const behind = mkTarget(pillar.x + pillar.hw + 120, pillar.y);
  tick(40);
  fireAt(x[behind & SLOT], y[behind & SLOT]);
  assert.equal(server.stats.shots, 1);
  assert.equal(server.stats.hits, 0, 'the pillar is in the way');
  server.world.destroy(behind);

  // open ground: four hits kill, then the victim respawns healthy somewhere else
  const rect = findClearRect(780, 560);
  x[a.selfId & SLOT] = rect.x + 100; y[a.selfId & SLOT] = rect.y + 300;
  const victim = mkTarget(rect.x + 300, rect.y + 300);
  tick(40);
  for (let shot = 1; shot <= 4; shot++) {
    const expected = Math.max(0, WEAPON.maxHp - shot * WEAPON.damage);
    fireAt(rect.x + 300, rect.y + 300);
    if (shot < 4) assert.equal(hp[victim & SLOT], expected, `hp after ${shot} hit(s)`);
  }
  assert.equal(server.stats.kills, 1);
  assert.equal(hp[victim & SLOT], WEAPON.maxHp, 'respawned with full health');
  assert.ok(Math.hypot(x[victim & SLOT] - (rect.x + 300), y[victim & SLOT] - (rect.y + 300)) > 1, 'at a new position');

  // the client's view of the world carries health (the victim respawned somewhere random, usually out of view: bring it back)
  x[victim & SLOT] = rect.x + 300; y[victim & SLOT] = rect.y + 300;
  hp[victim & SLOT] = 60;
  tick(10); clock.advance(100);
  const view = a.history.latest();
  const F = netSchema.fieldCount, col = netSchema.comps[2].fields[0].col;
  assert.equal(view.vals[view.rowOf(victim) * F + col], 60, 'the client sees the health the server holds');
  await server.close();
});

test('shot events reach the shooter and nearby players, not far-away ones', async () => {
  const rect = findClearRect(780, 560);
  const clock = new VirtualClock();
  const server = await startArenaServer({ listen: false, manualTicks: true, bots: 0, serveStatic: false, viewRadius: 400 });
  const net = new MemoryNetwork({ clock, link: { latencyMs: 10 } });
  net.listen('a').onConnection = server.attach;
  const [shooter, near, far] = [0, 1, 2].map(() => new ArenaClient({ transport: net.connect('a'), now: () => clock.now(), predictShots: false }).start());
  clock.runUntil(300);
  const { x, y } = server.world.data(Pos);
  const put = (c, px, py) => { x[c.selfId & SLOT] = px; y[c.selfId & SLOT] = py; };
  put(shooter, rect.x + 100, rect.y + 300); put(near, rect.x + 300, rect.y + 450); put(far, 2300, 2300);
  const seen = { shooter: [], near: [], far: [] };
  shooter.onEvent = (e) => seen.shooter.push(e); near.onEvent = (e) => seen.near.push(e); far.onEvent = (e) => seen.far.push(e);
  for (let t = 0; t < 60; t++) { clock.advance(TICK_MS); [shooter, near, far].forEach((c) => c.sendInput(0, 0, 0)); server.step(); }
  shooter.renderTick();
  shooter.sendInput(0, 0, BUTTON_FIRE, 1, 0);
  clock.advance(TICK_MS); server.step(); clock.advance(100);
  assert.equal(seen.shooter.length, 1);
  assert.equal(seen.near.length, 1);
  assert.equal(seen.far.length, 0);
  assert.equal(seen.shooter[0].shooter, shooter.selfId);
  await server.close();
});
