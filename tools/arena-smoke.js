// Starts an arena server, loads the demo in headless Chrome for each renderer, prints a summary
// and saves screenshots. Usage: node tools/arena-smoke.js [outDir]
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { startArenaServer } from '../examples/arena/server/arena-server.js';
import { runBrowserPage, findBrowser } from './browser-test.js';

const outDir = process.argv[2] ?? '.';
mkdirSync(outDir, { recursive: true });
const server = await startArenaServer({ port: 0, bots: 40, serveStatic: false, viewRadius: Infinity }); // rendering check: show every bot
let failed = false;
try {
  for (const kind of ['canvas2d', 'webgl2', 'webgpu']) {
    const page = `/examples/arena/browser-test/smoke.html?renderer=${kind}&ws=ws://127.0.0.1:${server.port}/ws`;
    let r;
    try { r = await runBrowserPage(page, { timeoutMs: 40_000 }); } catch (e) { console.log(`${kind.padEnd(9)} ERROR ${e.message}`); failed = true; continue; }
    const ok = r.connected && r.rendererKind === kind && r.entities >= 40 && r.distinctColours > 4 && r.snapshotsDuringInput > 30;
    if (!ok) failed = true;
    console.log(`${kind.padEnd(9)} ${ok ? 'PASS' : 'FAIL'}: renderer=${r.rendererKind} state=${r.state} entities=${r.entities} snapshots=${r.stats.snapshots} ` +
      `(full ${r.stats.fullSnapshots}, stale ${r.stats.stale}, resync ${r.stats.missingBaseline}) colours=${r.distinctColours} size=${r.size.join('x')}`);
    console.log('  hud: ' + r.hud.split('\n').slice(0, 5).join(' | '));
    writeFileSync(join(outDir, `arena-${kind}.png`), Buffer.from(r.png.split(',')[1], 'base64'));
  }
  // Prediction check: with 100 ms of simulated lag each way, the local player should still react at once.
  const reaction = {};
  for (const predict of [1, 0]) {
    const page = `/examples/arena/browser-test/smoke.html?renderer=webgl2&lag=100&jitter=30&predict=${predict}&ws=ws://127.0.0.1:${server.port}/ws`;
    const r = await runBrowserPage(page, { timeoutMs: 40_000 });
    reaction[predict] = r.reactionMs;
    console.log(`lag 100 ms each way, predict=${predict}: first visible movement after ${r.reactionMs} ms | ${r.hud.split('\n').filter((l) => /predict|network|interp|rtt/.test(l)).join(' | ')}`);
  }
  if (!(reaction[1] !== null && reaction[1] < 80 && (reaction[0] === null || reaction[0] > 250))) { failed = true; console.log('FAIL: prediction should react in <80 ms while the unpredicted player waits >250 ms'); }
  // Firefox (a different engine and renderer stack): the same demo, with prediction under lag.
  if (findBrowser('firefox')) {
    for (const renderer of ['webgl2', 'canvas2d']) {
      const page = `/examples/arena/browser-test/smoke.html?renderer=${renderer}&lag=100&jitter=30&ws=ws://127.0.0.1:${server.port}/ws`;
      try {
        const r = await runBrowserPage(page, { browser: 'firefox', timeoutMs: 60_000 });
        const ok = r.connected && r.rendererKind === renderer && r.entities >= 40 && r.reactionMs !== null && r.reactionMs < 100 && r.stats.snapshots > 60 && r.distinctColours > 4; // stale snapshots are expected with 30 ms jitter: the client drops reordered ones
        if (!ok) failed = true;
        console.log(`firefox ${renderer.padEnd(9)} ${ok ? 'PASS' : 'FAIL'}: state=${r.state} entities=${r.entities} snapshots=${r.stats.snapshots} reaction=${r.reactionMs} ms | ${r.hud.split('\n').filter((l) => /rtt|interp|predict/.test(l)).join(' | ')}`);
        writeFileSync(join(outDir, `arena-firefox-${renderer}.png`), Buffer.from(r.png.split(',')[1], 'base64'));
      } catch (e) { failed = true; console.log(`firefox ${renderer.padEnd(9)} ERROR ${e.message}`); }
    }
  }
  const s = server.stats;
  console.log(`server: ${s.ticks} ticks, avg ${(s.tickMsTotal / s.ticks).toFixed(3)} ms, max ${s.tickMsMax.toFixed(2)} ms`);
} finally {
  await server.close();
}
process.exit(failed ? 1 : 0);
