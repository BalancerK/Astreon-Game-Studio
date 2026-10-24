// Network lab for the 3D arena: the real server and client over the simulated network on a virtual clock.
import { startArena3dServer } from '../server/arena3d-server.js';
import { Arena3dClient } from '../client/net.js';
import { createSampleBuffer, sampleWorld } from '../client/interp.js';
import { Pos3, Look, Motion, Style, Health, BUTTON_FIRE, BUTTON_JUMP, BUTTON_RUN, eyeY } from '../shared/game.js';
import { MemoryNetwork, VirtualClock } from '../../../packages/transport/src/index.js';

export const TICK_MS = 1000 / 60;
export const SLOT = 0xfffff;

/** Scripted movement: changes direction every ~25 ticks, turns, jumps now and then, sometimes runs. [moveX, moveY, buttons, yaw, pitch] */
export function scriptedInput(tick) {
  const phase = Math.floor(tick / 25);
  const dirs = [[127, 0], [127, 127], [0, 127], [-127, 60], [-127, -127], [0, -127], [90, -127], [0, 0]];
  const [x, y] = dirs[(phase * 5 + 3) % dirs.length];
  const buttons = (phase % 3 === 0 ? BUTTON_RUN : 0) | (tick % 70 === 0 ? BUTTON_JUMP : 0);
  return [x, y, buttons, ((phase * 0.9) % 6.28) - 3.14, ((phase % 5) - 2) * 0.15];
}

/** Put a server-side body somewhere (tests only). */
export function teleport(server, id, x, y, z) {
  const slot = id & SLOT, body = server.bodies.get(slot);
  body.x = x; body.y = y; body.z = z; body.vy = 0; body.grounded = false;
  const d = server.world.data(Pos3);
  d.x[slot] = x; d.y[slot] = y; d.z[slot] = z;
}

/** Add a stationary-or-scripted target dummy (no controller, no input): damage is counted but it never dies. */
export function addDummy(server, x, y, z) {
  const e = server.world.create();
  server.world.add(e, Pos3, { x, y, z });
  server.world.add(e, Look, { yaw: 0, pitch: 0 });
  server.world.add(e, Motion, { vy: 0, grounded: 1 });
  server.world.add(e, Style, { hue: 5 });
  server.world.add(e, Health, { hp: 100 });
  return e;
}

/**
 * One client plays on a (possibly slow) link while a target dummy runs back and forth in open ground; the client aims at where
 * it SEES the dummy every `spacing` ticks.
 */
export async function shootMovingTarget({ latencyMs = 100, jitterMs = 0, loss = 0, lagCompensation = true, maxRewindMs = 250, shots = 30, speed = 0.15, predictShots = false, spacing = 14 }) {
  const clock = new VirtualClock();
  const server = await startArena3dServer({ listen: false, manualTicks: true, bots: 0, lagCompensation, maxRewindMs, viewRadius: 200 });
  const net = new MemoryNetwork({ clock, seed: 5, link: { latencyMs, jitterMs, loss } });
  net.listen('arena').onConnection = server.attach;
  const a = new Arena3dClient({ transport: net.connect('arena'), now: () => clock.now(), predictShots }).start();
  clock.runUntil(500);
  teleport(server, a.selfId, 0, 0.9, 47);
  const target = addDummy(server, -10, 0.9, 38);
  const ti = target & SLOT;
  const px = server.world.data(Pos3).x, hp = server.world.data(Health).hp;
  const events = [], predicted = [], verdicts = [];
  a.onEvent = (e) => events.push(e);
  a.onPredictedShot = (s) => predicted.push({ ...s, at: clock.now() });
  a.onShotResult = (r) => verdicts.push({ ...r, at: clock.now() });

  const out = createSampleBuffer();
  let dir = 1, fired = 0;
  const TOTAL = 150 + shots * spacing;
  for (let t = 0; t < TOTAL; t++) {
    clock.schedule(500 + t * TICK_MS, () => {
      const rt = a.renderTick();
      let tx = NaN, ty = NaN, tz = NaN;
      if (Number.isFinite(rt)) {
        sampleWorld(a.history, rt, out);
        for (let i = 0; i < out.count; i++) if (out.ids[i] === target) { tx = out.x[i]; ty = out.y[i]; tz = out.z[i]; }
      }
      const ready = t >= 150 && fired < shots && (t - 150) % spacing === 0 && Number.isFinite(tx) && a.predicted?.initialized;
      if (ready) {
        fired++;
        const b = a.predicted.body;
        const dx = tx - b.x, dy = ty - eyeY(b), dz = tz - b.z, len = Math.sqrt(dx * dx + dy * dy + dz * dz);
        a.sendInput(0, 0, BUTTON_FIRE, Math.atan2(-dx, -dz), Math.asin(dy / len)); // determinism-ok: test script, not simulation
      } else a.sendInput(0, 0, 0, 0, 0);
    });
    clock.schedule(500 + t * TICK_MS + 0.001, () => {
      hp[ti] = 100;
      px[ti] += dir * speed;
      if (px[ti] > 10) dir = -1;
      if (px[ti] < -10) dir = 1;
      server.step();
    });
  }
  clock.runUntil(500 + TOTAL * TICK_MS + 1500);
  const result = { fired, shots: server.stats.shots, hits: server.stats.hits, events, predicted, verdicts, a, server, target };
  await server.close();
  return result;
}
