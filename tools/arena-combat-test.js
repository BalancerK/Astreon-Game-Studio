// Live lag-compensation check: a real browser, a real server, 100 ms of simulated lag each way.
// An in-page auto-aim script always aims at where the nearest bot is DRAWN and holds fire; the server's
// own hit counters then show how much rewinding to the shooter's view matters.
// Usage: node tools/arena-combat-test.js [outDir]
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { startArenaServer } from '../examples/arena/server/arena-server.js';
import { withChromePage } from './cdp.js';

const outDir = process.argv[2] ?? '.';
mkdirSync(outDir, { recursive: true });

const AUTO_AIM = `(() => {
  let stop = false;
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
    if (!stop) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  window.__stopAim = () => { stop = true; window.dispatchEvent(new PointerEvent('pointerup')); };
})()`;

async function run(lagCompensation, shot) {
  const server = await startArenaServer({ port: 0, host: '127.0.0.1', bots: 90, seed: 7, lagCompensation });
  try {
    return await withChromePage(`http://127.0.0.1:${server.port}/?lag=100&renderer=webgl2`, async (page) => {
      const ok = await page.waitFor("window.__arena && window.__arena.client.state === 'playing' && window.__arena.client.stats.snapshots > 30", 15_000);
      if (!ok) throw new Error(`page did not start: ${page.errors.join(' | ')}`);
      await page.sleep(1500);
      const before = { shots: server.stats.shots, hits: server.stats.hits };
      await page.eval(AUTO_AIM);
      await page.sleep(shot ? 4500 : 9000);
      if (shot) writeFileSync(join(outDir, 'arena-combat.png'), await page.screenshot());
      await page.sleep(shot ? 4500 : 0);
      await page.eval('window.__stopAim()');
      const rtt = await page.eval('window.__arena.client.rttMs');
      return { shots: server.stats.shots - before.shots, hits: server.stats.hits - before.hits, kills: server.stats.kills, rtt };
    });
  } finally {
    await server.close();
  }
}

const on = await run(true, true);
const off = await run(false, false);
const pct = (r) => (100 * r.hits / Math.max(1, r.shots)).toFixed(0);
console.log(`lag compensation ON : ${on.hits}/${on.shots} shots hit (${pct(on)}%), ${on.kills} kills, RTT ${Math.round(on.rtt)} ms`);
console.log(`lag compensation OFF: ${off.hits}/${off.shots} shots hit (${pct(off)}%), ${off.kills} kills, RTT ${Math.round(off.rtt)} ms`);
const ok = on.shots >= 10 && off.shots >= 10 && on.hits / on.shots > (off.hits / off.shots) * 2 && on.hits / on.shots > 0.4;
console.log(ok ? 'PASS: rewinding to the shooter\'s view multiplies hit registration' : 'FAIL: expected a large advantage with lag compensation');
process.exit(ok ? 0 : 1);
