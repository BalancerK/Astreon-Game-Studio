import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runScenario } from './netlab.js';

// Full pipeline (server -> simulated network -> client) on a virtual clock; deterministic.

test('adaptive interpolation beats a fixed 100 ms delay on good links and matches its smoothness on bad ones', async () => {
  const cases = [
    { name: 'good', link: { latencyMs: 20 }, maxBehind: 40, maxStarved: 1 },
    { name: 'typical', link: { latencyMs: 50, jitterMs: 10 }, maxBehind: 40, maxStarved: 1 },
    { name: 'jittery', link: { latencyMs: 50, jitterMs: 60 }, maxBehind: 110, maxStarved: 2 },
    { name: 'lossy', link: { latencyMs: 50, jitterMs: 20, loss: 0.1 }, maxBehind: 70, maxStarved: 2 },
  ];
  for (const c of cases) {
    const adaptive = await runScenario({ link: c.link, seconds: 15, seed: 7 });
    const fixed = await runScenario({ link: c.link, seconds: 15, seed: 7, fixedDelayMs: 100 });
    assert.ok(adaptive.starvedPct <= c.maxStarved, `${c.name}: starved ${adaptive.starvedPct.toFixed(2)}% of frames`);
    assert.ok(adaptive.behindMs <= c.maxBehind, `${c.name}: ${adaptive.behindMs.toFixed(0)} ms behind (limit ${c.maxBehind})`);
    assert.ok(adaptive.behindMs <= fixed.behindMs + 5, `${c.name}: adaptive ${adaptive.behindMs.toFixed(0)} ms vs fixed ${fixed.behindMs.toFixed(0)} ms`);
    assert.equal(adaptive.backwards, 0, `${c.name}: render time never ran backwards`);
  }
});

test('on a terrible link adaptive stays smooth by buffering more, without freezing the view', async () => {
  const awful = { latencyMs: 100, jitterMs: 80, loss: 0.25, reorder: 0.1 };
  const r = await runScenario({ link: awful, seconds: 20, seed: 7 });
  assert.ok(r.starvedPct <= 2, `starved ${r.starvedPct.toFixed(2)}%`);
  assert.ok(r.behindMs > 60 && r.behindMs < 160, `${r.behindMs.toFixed(0)} ms behind`);
  assert.equal(r.backwards, 0);
  assert.ok(r.clock.gapPeak >= 2, 'noticed the packet loss');
});

test('input-to-acknowledgement RTT is measured', async () => {
  const r = await runScenario({ link: { latencyMs: 50 }, seconds: 10, seed: 3 });
  assert.ok(r.rttMs >= 98 && r.rttMs <= 125, `rtt ${r.rttMs} ms for 50 ms each way`);
});
