import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InterpolationClock } from '../src/index.js';

const TICK_MS = 1000 / 60;

/** Deterministic PRNG. */
function rng(seed) {
  return () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
}

/** Feed `seconds` of snapshots with the given latency and jitter; sample the render clock at 144 Hz. */
function run(clock, { seconds, latencyMs, jitterMs = 0, loss = 0, seed = 1, startMs = 0 }) {
  const baseTick = Math.round(startMs / TICK_MS); // tick N is simulated at N * TICK_MS
  const r = rng(seed);
  const arrivals = [];
  const ticks = Math.round(seconds * 60);
  for (let i = 0; i < ticks; i++) {
    if (r() < loss) continue;
    const tick = baseTick + i;
    arrivals.push({ tick, at: startMs + i * TICK_MS + latencyMs + r() * jitterMs });
  }
  arrivals.sort((a, b) => a.at - b.at);
  const frames = [];
  let a = 0;
  let last = -Infinity;
  for (let now = startMs; now < startMs + seconds * 1000; now += 1000 / 144) {
    while (a < arrivals.length && arrivals[a].at <= now) {
      if (arrivals[a].tick > clock.lastTick || clock.lateness === null) clock.onSnapshot(arrivals[a].at, arrivals[a].tick);
      a++;
    }
    const rt = clock.renderTick(now);
    if (Number.isNaN(rt)) continue;
    frames.push({ now, rt, newest: clock.latestTick, backwards: rt < last });
    last = rt;
  }
  return frames;
}

const starvedFraction = (frames, skip = 120) => {
  const f = frames.slice(skip);
  return f.filter((x) => x.rt > x.newest).length / f.length;
};

test('no data yet: NaN, no crash', () => {
  const c = new InterpolationClock({ tickMs: TICK_MS });
  assert.ok(Number.isNaN(c.renderTick(100)));
  assert.ok(Number.isNaN(c.serverTickNow(100)));
});

test('steady link: tiny buffer, playback speed ~1, never runs backwards, never starves', () => {
  const c = new InterpolationClock({ tickMs: TICK_MS });
  const frames = run(c, { seconds: 10, latencyMs: 40 });
  assert.ok(c.bufferTicks <= 2.05, `buffer ${c.bufferTicks.toFixed(2)} ticks`);
  assert.ok(c.bufferTicks * TICK_MS < 36, `buffer ${(c.bufferTicks * TICK_MS).toFixed(1)} ms`);
  assert.ok(Math.abs(c.rate - 1) < 0.02, `rate ${c.rate}`);
  assert.ok(frames.every((f) => !f.backwards), 'monotonic');
  assert.ok(starvedFraction(frames) < 0.01, `starved ${(starvedFraction(frames) * 100).toFixed(1)}%`);
  assert.ok(Math.abs(c.lateness * TICK_MS - 40) < 5, `lateness ${c.lateness * TICK_MS} ms ~ latency 40 ms`);
});

test('jittery link: buffer grows with jitter and starvation stays low', () => {
  const calm = new InterpolationClock({ tickMs: TICK_MS });
  run(calm, { seconds: 10, latencyMs: 50, jitterMs: 4, seed: 2 });
  const wild = new InterpolationClock({ tickMs: TICK_MS });
  const frames = run(wild, { seconds: 15, latencyMs: 50, jitterMs: 60, seed: 2 });
  assert.ok(wild.bufferTicks > calm.bufferTicks + 1, `wild ${wild.bufferTicks.toFixed(2)} vs calm ${calm.bufferTicks.toFixed(2)}`);
  assert.ok(wild.bufferTicks <= 20);
  assert.ok(starvedFraction(frames) < 0.05, `starved ${(starvedFraction(frames) * 100).toFixed(1)}%`);
  assert.ok(frames.every((f) => !f.backwards));
});

test('packet loss widens the buffer through the observed snapshot gap', () => {
  const clean = new InterpolationClock({ tickMs: TICK_MS });
  run(clean, { seconds: 10, latencyMs: 40, seed: 3 });
  const lossy = new InterpolationClock({ tickMs: TICK_MS });
  const frames = run(lossy, { seconds: 15, latencyMs: 40, loss: 0.25, seed: 3 });
  assert.ok(lossy.gap > 1.15, `mean gap ${lossy.gap.toFixed(2)}`);
  assert.ok(lossy.gapPeak >= 2, `peak gap ${lossy.gapPeak.toFixed(2)}`);
  assert.ok(lossy.bufferTicks >= 2 && lossy.bufferTicks > clean.bufferTicks, `lossy buffers ${lossy.bufferTicks.toFixed(2)} vs clean ${clean.bufferTicks.toFixed(2)} ticks`);
  assert.ok(starvedFraction(frames) < 0.1, `starved ${(starvedFraction(frames) * 100).toFixed(1)}%`);
});

test('buffer shrinks again, slowly, once jitter stops', () => {
  const c = new InterpolationClock({ tickMs: TICK_MS });
  run(c, { seconds: 10, latencyMs: 50, jitterMs: 60, seed: 4 });
  const wide = c.bufferTicks;
  run(c, { seconds: 10, latencyMs: 50, jitterMs: 0, seed: 4, startMs: 10_000 });
  assert.ok(c.bufferTicks < wide - 1, `shrank from ${wide.toFixed(2)} to ${c.bufferTicks.toFixed(2)}`);
});

test('playback speed changes are bounded, so retargeting never looks like a jump', () => {
  const c = new InterpolationClock({ tickMs: TICK_MS, maxRateAdjust: 0.1 });
  const frames = run(c, { seconds: 6, latencyMs: 40, jitterMs: 2 });
  // sudden jitter appears: target moves, the clock must slew, not jump
  const more = run(c, { seconds: 6, latencyMs: 40, jitterMs: 80, seed: 9, startMs: 6000 });
  const all = [...frames, ...more];
  let maxRate = 1, minRate = 1;
  for (let i = 1; i < all.length; i++) {
    const dt = (all[i].now - all[i - 1].now) / TICK_MS;
    const rate = (all[i].rt - all[i - 1].rt) / dt;
    maxRate = Math.max(maxRate, rate); minRate = Math.min(minRate, rate);
  }
  assert.ok(maxRate <= 1.1 + 1e-9 && minRate >= 0.9 - 1e-9, `playback speed stayed within ${minRate.toFixed(3)}..${maxRate.toFixed(3)}`);
  assert.equal(c.snaps, 0, 'no snap needed');
});

test('a huge latency change (route change) snaps once instead of crawling', () => {
  const c = new InterpolationClock({ tickMs: TICK_MS });
  run(c, { seconds: 5, latencyMs: 30 });
  run(c, { seconds: 5, latencyMs: 700, startMs: 5000 });
  assert.ok(c.snaps >= 1 && c.snaps <= 3, `snaps ${c.snaps}`);
  assert.ok(Math.abs(c.lateness * TICK_MS - 700) < 60, `lateness converged to ${(c.lateness * TICK_MS).toFixed(0)} ms`);
});

test('fixed delay mode renders a constant distance behind the newest estimate', () => {
  const c = new InterpolationClock({ tickMs: TICK_MS, fixedDelayMs: 100 });
  run(c, { seconds: 5, latencyMs: 40 });
  assert.ok(Math.abs(c.bufferTicks * TICK_MS - 100) < 1e-9);
  const s = c.status(5000);
  assert.ok(s.behindNewestMs > 80 && s.behindNewestMs <= 101, `behind newest ${s.behindNewestMs.toFixed(0)} ms`);
});
