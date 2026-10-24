import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NetLab, moveStep, botAt, ARENA, TICK_MS } from '../netlab/lab.js';

const run = (lab, ms, step = 16) => { for (let t = 0; t < ms; t += step) lab.advance(step); };
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

test('the movement rule is the same on both sides, diagonals are not faster, and the arena has walls', () => {
  assert.deepEqual(moveStep({ x: 100, y: 100 }, 1, 0), { x: 100 + 140 / 30, y: 100 });
  const d = moveStep({ x: 100, y: 100 }, 1, 1);
  assert.ok(Math.abs(Math.hypot(d.x - 100, d.y - 100) - 140 / 30) < 1e-9);
  assert.deepEqual(moveStep({ x: 470, y: 5 }, 1, -1), { x: ARENA.w - 8, y: 8 });
  const a = botAt(0); const b = botAt(30); assert.notDeepEqual(a, b); assert.deepEqual(botAt(30), b, 'the bot goes where the tick says');
});

test('on a perfect network the guess is always right: no correction is ever needed', () => {
  const lab = new NetLab({ latencyMs: 0, jitterMs: 0, loss: 0 });
  lab.steer(1, 0); run(lab, 1500); lab.steer(0, 1); run(lab, 1000);
  const r = lab.report();
  assert.equal(r.mispredictions, 0); assert.ok(r.error.max < 1.5, `error ${r.error.max}`);
  assert.ok(dist(lab.client.predicted, lab.server.player) < 6, 'the guess is at most one tick ahead of the truth');
  assert.ok(lab.client.shown.x > 150, 'the player really moved');
});

test('lag: the round trip is about twice the one-way delay, and with prediction off the picture trails what you asked for', () => {
  const on = new NetLab({ latencyMs: 150, jitterMs: 0, prediction: true });
  const off = new NetLab({ latencyMs: 150, jitterMs: 0, prediction: false });
  for (const lab of [on, off]) { lab.steer(1, 0); run(lab, 2500); }
  const rtt = on.report().rtt.avg;
  assert.ok(rtt >= 300 && rtt <= 400, `rtt ${rtt}`);
  assert.ok(on.report().lag.avg < 3, `with prediction the picture keeps up (${on.report().lag.avg})`);
  assert.ok(off.report().lag.avg > 35, `without it the picture is behind (${off.report().lag.avg})`);
  assert.ok(off.client.shown.x < on.client.shown.x - 30);
});

test('a gust only the server knows about makes the guess wrong; the correction is the size of the push, and easing it in hides the jump', () => {
  const make = (smoothing) => { const lab = new NetLab({ latencyMs: 100, jitterMs: 0, smoothing }); lab.steer(1, 0); run(lab, 1000); return lab; };
  const smooth = make(true); const snap = make(false);
  const before = { s: { ...smooth.client.shown }, n: { ...snap.client.shown } };
  smooth.gust(0, 1); snap.gust(0, 1);
  let jumpSmooth = 0; let jumpSnap = 0; let last = { s: smooth.client.shown, n: snap.client.shown };
  for (let t = 0; t < 600; t += 16) {
    smooth.advance(16); snap.advance(16);
    jumpSmooth = Math.max(jumpSmooth, dist(smooth.client.shown, last.s) - 140 * 0.016);
    jumpSnap = Math.max(jumpSnap, dist(snap.client.shown, last.n) - 140 * 0.016);
    last = { s: smooth.client.shown, n: snap.client.shown };
  }
  assert.ok(smooth.report().mispredictions >= 1 && snap.report().mispredictions >= 1, 'the wrong guess is noticed');
  assert.ok(smooth.errorSeries.stats().max > 40, `the error is the size of the push (${smooth.errorSeries.stats().max})`);
  assert.ok(jumpSnap > 30, `a snap shows the whole jump at once (${jumpSnap})`);
  assert.ok(jumpSmooth < jumpSnap / 2, `easing it in is gentler (${jumpSmooth} against ${jumpSnap})`);
  assert.ok(before.s.x > 100);
  run(smooth, 1500); assert.ok(dist(smooth.client.shown, smooth.client.predicted) < 0.5, 'and the picture settles on the corrected guess');
});

test('lost packets are counted, both ways, and make the guess drift more than a clean line does', () => {
  const clean = new NetLab({ latencyMs: 60, jitterMs: 0, loss: 0, seed: 3 });
  const lossy = new NetLab({ latencyMs: 60, jitterMs: 0, loss: 0.3, seed: 3 });
  for (const lab of [clean, lossy]) { lab.steer(1, 0); run(lab, 3000); lab.steer(0, 1); run(lab, 3000); }
  const c = clean.report(); const l = lossy.report();
  assert.equal(c.sent.lost, 0); assert.equal(c.received.lost, 0);
  assert.ok(l.sent.lost > 10 && l.received.lost > 10, `lost ${l.sent.lost} up and ${l.received.lost} down`);
  assert.ok(l.mispredictions > c.mispredictions, `${l.mispredictions} against ${c.mispredictions}`);
  assert.ok(lossy.client.snapshots.length > 0, 'the game still goes on');
});

test('interpolation draws the bot smoothly even when the network is rough; without it the bot jumps from snapshot to snapshot', () => {
  const rough = { latencyMs: 80, jitterMs: 60, loss: 0.15, seed: 5 };
  const measure = (interpolation) => {
    const lab = new NetLab({ ...rough, interpolation });
    run(lab, 1500);
    let worst = 0; let last = lab.client.bot;
    for (let t = 0; t < 6000; t += 16) { lab.advance(16); worst = Math.max(worst, dist(lab.client.bot, last)); last = lab.client.bot; }
    return worst;
  };
  const smooth = measure(true); const raw = measure(false);
  assert.ok(raw > smooth * 1.4, `the biggest jump in one frame: ${raw.toFixed(1)} px without, ${smooth.toFixed(1)} with`);
});

test('packets are tiny and counted: 7 bytes for an input, 25 for a snapshot, and the log shows what crossed the wire', () => {
  const lab = new NetLab({ latencyMs: 40, jitterMs: 0 });
  lab.steer(1, 0); run(lab, 2000);
  const r = lab.report();
  assert.ok(Math.abs(r.bytesPerSecond.out - 7 * 30) < 20, `out ${r.bytesPerSecond.out}`); assert.ok(Math.abs(r.bytesPerSecond.in - 25 * 30) < 60, `in ${r.bytesPerSecond.in}`);
  const entries = lab.packets.entries(10);
  assert.ok(entries.length === 10 && entries.every((e) => ['INPUT', 'SNAPSHOT'].includes(e.type)));
  assert.ok(entries.some((e) => e.dir === 'out' && e.size === 7) && entries.some((e) => e.dir === 'in' && e.size === 25));
  assert.ok(lab.packets.total('out').count >= 55);
});

test('the same settings and seed always give the same lab, and settings can be changed while it runs', () => {
  const trace = (seed) => { const lab = new NetLab({ latencyMs: 90, jitterMs: 40, loss: 0.1, seed }); lab.steer(1, 1); run(lab, 3000); return JSON.stringify([lab.client.shown, lab.report().rtt.avg, lab.report().mispredictions]); };
  assert.equal(trace(7), trace(7)); assert.notEqual(trace(7), trace(8));
  const lab = new NetLab({ latencyMs: 0 }); lab.steer(1, 0); run(lab, 1000);
  lab.set({ latencyMs: 200 }); run(lab, 3000);
  assert.ok(lab.report().rtt.avg > 350, `the new delay is in force (${lab.report().rtt.avg})`);
  assert.equal(lab.settings.latencyMs, 200); assert.ok(TICK_MS > 33 && TICK_MS < 34);
});
