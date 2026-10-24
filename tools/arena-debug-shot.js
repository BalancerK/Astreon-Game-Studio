// Plays the arena in headless Chrome with real key events, opens the debug overlay with F3, checks
// its content and saves a screenshot. Usage: node tools/arena-debug-shot.js [outDir]
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { startArenaServer } from '../examples/arena/server/arena-server.js';
import { withChromePage } from './cdp.js';

const outDir = process.argv[2] ?? '.';
mkdirSync(outDir, { recursive: true });
const server = await startArenaServer({ port: 0, host: '127.0.0.1', bots: 40 });
let failed = false;
const check = (name, ok, detail = '') => { if (!ok) failed = true; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `  (${detail})` : ''}`); };
try {
  const url = `http://127.0.0.1:${server.port}/?lag=60&jitter=25&loss=0.03`;
  await withChromePage(url, async (page) => {
    const connected = await page.waitFor("window.__arena && window.__arena.client.state === 'playing' && window.__arena.client.stats.snapshots > 20", 15_000);
    check('game connects', connected, page.errors.slice(0, 3).join(' | '));
    if (!connected) throw new Error(`page did not start: ${page.errors.join(' | ') || 'no errors reported'}`);
    const visible = () => page.eval("(() => { const r = document.querySelector('[data-debug-overlay]'); return !!r && r.style.display !== 'none'; })()");
    check('overlay starts hidden', !(await visible()));
    await page.key('KeyD'); await page.key('KeyS');
    await page.sleep(4000); // generate movement, graph history and packets
    await page.key('F3');
    await page.sleep(400);
    check('F3 opens the overlay', await visible());
    const text = await page.eval("document.querySelector('[data-debug-overlay]').innerText");
    check('graphs for the key metrics', /RTT/.test(text) && /Download/.test(text) && /Prediction error/.test(text) && /Render behind newest/.test(text));
    check('info lines', /renderer\s+\w+/.test(text) && /state\s+playing/.test(text) && /predict\s+\d+ corrections/.test(text));
    check('packet inspector decodes SNAPSHOT and INPUT', /SNAPSHOT .*tick \d+/.test(text) && /INPUT .*seq \d+/.test(text), text.split('\n').filter((l) => /SNAPSHOT|INPUT/.test(l)).slice(0, 2).join(' | '));
    const rtt = await page.eval('window.__arena.client.rttMs');
    check('RTT near the simulated 2 x 60 ms', rtt > 110 && rtt < 220, `${Math.round(rtt)} ms`);
    const fps = await page.eval("window.__arena.debug.model.series.get('fps').data.stats().last");
    check('overlay does not tank the frame rate', fps > 30, `${Math.round(fps)} fps with the overlay open`);
    writeFileSync(join(outDir, 'arena-debug-overlay.png'), await page.screenshot());
    await page.key('F3');
    await page.sleep(200);
    check('F3 closes the overlay', !(await visible()));
  });
} finally {
  await server.close();
}
process.exit(failed ? 1 : 0);
