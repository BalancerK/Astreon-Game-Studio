// The engine's general `Predictor` (packages/client) must do exactly what the arena's own hand-written PredictedPlayer does, on the arena's real movement function and real walls.
// If this ever fails, the general version has drifted from the one that was tuned and tested in the arena.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PredictedPlayer } from '../client/predict.js';
import { Predictor } from '../../../packages/client/src/index.js';
import { buildWalls, buildWallHash, applyInput } from '../shared/game.js';

const DT = 1 / 60;
const walls = buildWallHash(buildWalls());

function scriptedInput(tick) {
  const phase = Math.floor(tick / 25);
  const dirs = [[127, 0], [127, 127], [0, 127], [-127, 60], [-127, -127], [0, -127], [90, -127], [0, 0]];
  const [x, y] = dirs[(phase * 5 + 3) % dirs.length];
  return [x, y, phase % 3 === 0 ? 1 : 0];
}

/** The same movement function the server uses, wrapped for the general predictor: an input is `[moveX, moveY, buttons]`. */
const step = (s, input, dt) => { applyInput(walls, s, input[0], input[1], input[2], dt); };

function drive({ ticks, ackDelay, shoveAt = -1, shove = 0 }) {
  const old = new PredictedPlayer(walls, DT);
  const next = new Predictor({ step, dt: DT, tolerance: 0.08, snapDistance: 200, smoothHalfLife: 0.06 });
  const server = { x: 600, y: 400 };
  const history = [];
  const trace = [];
  for (let seq = 1; seq <= ticks; seq++) {
    const [mx, my, b] = scriptedInput(seq);
    old.record(seq, mx, my, b);
    next.record(seq, [mx, my, b]);
    applyInput(walls, server, mx, my, b, DT);
    if (seq === shoveAt) { server.x += shove; server.y += shove; }
    history.push({ x: server.x, y: server.y });
    if (seq > ackDelay) {
      const ack = seq - ackDelay;
      const at = history[ack - 1];
      const moved1 = old.reconcile(ack, at.x, at.y);
      const moved2 = next.reconcile(ack, { x: at.x, y: at.y });
      assert.equal(moved2, moved1, `seq ${seq}: both say the same about the correction`);
    }
    old.smooth(DT);
    next.smooth(DT);
    const a = old.renderPosition(0.5);
    const c = next.renderState(0.5);
    if (next.initialized) trace.push([seq, a.x, a.y, c.x, c.y]);      // before the first answer neither knows where the player is
  }
  return { old, next, trace };
}

test('with a server that agrees, the general predictor draws exactly where the arena\'s predictor does', () => {
  const { old, next, trace } = drive({ ticks: 400, ackDelay: 6 });
  for (const [seq, ax, ay, bx, by] of trace) assert.ok(Math.abs(ax - bx) < 1e-9 && Math.abs(ay - by) < 1e-9, `seq ${seq}`);
  assert.equal(old.stats.corrections, next.stats.corrections);
  assert.equal(next.stats.corrections, 0);
  assert.equal(old.pending, next.pending);
});

test('with a server that pushes the player, both correct in the same way, at the same moment, by the same amount', () => {
  const { old, next, trace } = drive({ ticks: 400, ackDelay: 6, shoveAt: 150, shove: 14 });
  for (const [seq, ax, ay, bx, by] of trace) assert.ok(Math.abs(ax - bx) < 1e-9 && Math.abs(ay - by) < 1e-9, `seq ${seq}: ${ax},${ay} vs ${bx},${by}`);
  assert.ok(old.stats.corrections >= 1, 'the push was noticed');
  assert.deepEqual({ corrections: next.stats.corrections, snaps: next.stats.snaps }, { corrections: old.stats.corrections, snaps: old.stats.snaps });
  assert.ok(Math.abs(old.stats.maxError - next.stats.maxError) < 1e-9);
});

test('and with a slow network and a big push (a snap)', () => {
  const { old, next, trace } = drive({ ticks: 500, ackDelay: 20, shoveAt: 200, shove: 260 });
  for (const [seq, ax, ay, bx, by] of trace) assert.ok(Math.abs(ax - bx) < 1e-9 && Math.abs(ay - by) < 1e-9, `seq ${seq}`);
  assert.equal(next.stats.snaps, old.stats.snaps);
});
