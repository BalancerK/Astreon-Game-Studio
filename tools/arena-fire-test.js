// Live shot-prediction check: a real browser with 100 ms of simulated lag each way fires at drawn bots.
// Measures how long after pulling the trigger the tracer is on screen, with and without shot prediction,
// and how often the predicted hit/miss matched the server's verdict.
// Usage: node tools/arena-fire-test.js [outDir]
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { startArenaServer } from '../examples/arena/server/arena-server.js';
import { withChromePage } from './cdp.js';

const outDir = process.argv[2] ?? '.';
mkdirSync(outDir, { recursive: true });

const INSTRUMENT = `(() => {
  const c = window.__arena.client, L = (window.__lat = { tracer: [], verdict: [] });
  const since = (seq) => performance.now() - c.sentAt[seq % 256];
  const pp = c.onPredictedShot; c.onPredictedShot = (s) => { L.tracer.push(since(s.seq)); pp?.(s); };
  const pr = c.onShotResult; c.onShotResult = (r) => { L.verdict.push(since(r.event.seq)); pr?.(r); };
  const pe = c.onEvent; c.onEvent = (e) => { if (e.kind === 1 && e.shooter === c.selfId) L.tracer.push(since(e.seq)); pe?.(e); };
})()`;

const AUTO_AIM = `(() => {
  const W = window.__arena;
  function frame() {
    const s = W.samples, me = W.shownSelf;
    let best = -1, bestD = 450;
    for (let i = 0; i < s.count; i++) {
      if (s.ids[i] === W.client.selfId) continue;
      const d = Math.hypot(s.x[i] - me.x, s.y[i] - me.y);
      if (d < bestD) { bestD = d; best = i; }
    }
    if (best >= 0) {
      const p = W.camera.worldToScreen(s.x[best], s.y[best]);
      window.dispatchEvent(new PointerEvent('pointermove', { clientX: p.x, clientY: p.y }));
      window.dispatchEvent(new PointerEvent('pointerdown', { clientX: p.x, clientY: p.y }));
    } else window.dispatchEvent(new PointerEvent('pointerup'));
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})()`;

const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : NaN; };

async function run(predict, shot) {
  const server = await startArenaServer({ port: 0, host: '127.0.0.1', bots: 90, seed: 7 });
  try {
    return await withChromePage(`http://127.0.0.1:${server.port}/?lag=100&renderer=webgl2${predict ? '' : '&predictshots=0'}`, async (page) => {
      const ok = await page.waitFor("window.__arena && window.__arena.client.state === 'playing' && window.__arena.client.stats.snapshots > 30", 15_000);
      if (!ok) throw new Error(`page did not start: ${page.errors.join(' | ')}`);
      await page.sleep(1500);
      await page.eval(INSTRUMENT);
      await page.eval(AUTO_AIM);
      await page.sleep(8000);
      if (shot) writeFileSync(join(outDir, 'arena-fire-predicted.png'), await page.screenshot());
      return page.eval(`(() => { const L = window.__lat, s = window.__arena.client.shotStats; return { tracer: L.tracer, verdict: L.verdict, stats: { ...s }, rtt: window.__arena.client.rttMs, corrections: window.__arena.client.predicted.stats.corrections }; })()`);
    });
  } finally {
    await server.close();
  }
}

let failed = false;
const check = (name, ok, detail = '') => { if (!ok) failed = true; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `  (${detail})` : ''}`); };

const on = await run(true, true);
const off = await run(false, false);
const t = (r) => `median ${median(r.tracer).toFixed(0)} ms, n=${r.tracer.length}`;
console.log(`shot prediction ON : tracer on screen ${t(on)}; server verdict after median ${median(on.verdict).toFixed(0)} ms; RTT ${Math.round(on.rtt)} ms`);
console.log(`shot prediction OFF: tracer on screen ${t(off)}; RTT ${Math.round(off.rtt)} ms`);
check('enough shots were fired', on.tracer.length >= 10 && off.tracer.length >= 10, `${on.tracer.length} / ${off.tracer.length}`);
check('predicted tracer is immediate', median(on.tracer) < 40, `${median(on.tracer).toFixed(1)} ms`);
check('without prediction the tracer waits about one round trip', median(off.tracer) > 150, `${median(off.tracer).toFixed(0)} ms`);
check('the server\'s verdict still arrives a round trip later and confirms', on.stats.confirmed >= on.stats.predicted * 0.8 && median(on.verdict) > 150, JSON.stringify(on.stats));
const agree = on.stats.agreed / Math.max(1, on.stats.confirmed);
check('predicted hit/miss matches the server most of the time', agree >= 0.6, `${(agree * 100).toFixed(0)}% of ${on.stats.confirmed}`);
check('movement prediction is unaffected', on.corrections === 0, `${on.corrections} corrections`);
process.exit(failed ? 1 : 0);
