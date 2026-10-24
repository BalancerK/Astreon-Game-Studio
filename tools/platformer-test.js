// Live check of the platformer tutorial game in a real browser, on both renderers: the menu lists the levels, the real keys start a level, a
// computer player presses the real arrow and space keys until the level is finished, and the best time is saved in the browser.
// Usage: node tools/platformer-test.js [outDir]
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createStaticServer } from './static-server.js';
import { withChromePage } from './cdp.js';

const outDir = process.argv[2] ?? null;
if (outDir) mkdirSync(outDir, { recursive: true });
const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const server = createStaticServer({ root: decodeURIComponent(root), index: '/examples/platformer/index.html' });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
let failed = false;
const check = (name, ok, detail = '') => { if (!ok) failed = true; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `  (${detail})` : ''}`); };

try {
  for (const renderer of ['webgpu', 'webgl2']) {
    console.log(`--- ${renderer}`);
    await withChromePage(`http://127.0.0.1:${server.address().port}/examples/platformer/index.html?renderer=${renderer}`, async (page) => {
      const errors = () => page.errors.filter((e) => !/willReadFrequently/.test(e)).slice(0, 2).join(' | ');
      check('the page starts on the level menu', await page.waitFor('window.__platformer && window.__platformer.mode === "menu"', 15_000), errors());
      await page.eval('localStorage.clear()');
      await page.key('Enter', 'down'); await page.key('Enter', 'up');
      check('Enter starts the first level', await page.waitFor('window.__platformer.mode === "play" && window.__platformer.game.level.name === "First steps"', 5000));
      if (outDir) writeFileSync(join(outDir, `platformer-${renderer}.png`), await page.screenshot());

      // the computer player decides, the real keys do it
      await page.eval('import("/examples/platformer/src/game.js").then((m) => { window.__bot = m.botInput; })');
      const held = { ArrowLeft: false, ArrowRight: false, Space: false };
      const set = async (code, on) => { if (held[code] !== on) { held[code] = on; await page.key(code, on ? 'down' : 'up'); } };
      const t0 = Date.now(); let status = 'playing', deaths = 0;
      while (Date.now() - t0 < 60_000) {
        const s = JSON.parse(await page.eval('(() => { const g = window.__platformer.game; return JSON.stringify({ status: g.status, deaths: g.deaths, bits: window.__bot(g) }); })()'));
        status = s.status; deaths = s.deaths;
        if (status === 'won') break;
        await set('ArrowRight', (s.bits & 2) !== 0); await set('ArrowLeft', (s.bits & 1) !== 0); await set('Space', (s.bits & 4) !== 0);
        await page.sleep(15);
      }
      for (const c of Object.keys(held)) await set(c, false);
      check('the level is finished with the real keys', status === 'won', `status ${status}, deaths ${deaths}, ${Math.round((Date.now() - t0) / 1000)} s`);
      const best = JSON.parse(await page.eval('JSON.stringify(window.__platformer.progress)'));
      check('the best time and coins are remembered', typeof best.best['0'] === 'number' && best.coins['0'] > 0, JSON.stringify(best));
      await page.sleep(400);
      check('and saved in the browser', await page.eval('Object.keys(localStorage).some((k) => k.startsWith("platformer:"))'));
      if (outDir) writeFileSync(join(outDir, `platformer-won-${renderer}.png`), await page.screenshot());
      await page.key('KeyN', 'down'); await page.key('KeyN', 'up');
      check('N goes on to the next level', await page.waitFor('window.__platformer.game.level.name === "Spiky business"', 4000));
      check('no page errors', errors() === '', errors());
    });
  }
} finally { server.close(); }
process.exit(failed ? 1 : 0);
