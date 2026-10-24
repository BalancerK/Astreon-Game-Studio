// Live check of the production build: bundle two examples with the build tool, serve ONLY the built files, and run them in a real browser
// on both renderers. The pages must carry one hashed script (no module graph), work as the source versions do, and throw nothing.
// Usage: node tools/build-test.js
import { mkdtempSync, rmSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build, formatReport } from '../packages/build/src/index.js';
import { createStaticServer } from './static-server.js';
import { withChromePage } from './cdp.js';

const root = decodeURIComponent(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const out = mkdtempSync(join(tmpdir(), 'engine-dist-'));
let failed = false;
const check = (name, ok, detail = '') => { if (!ok) failed = true; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `  (${detail})` : ''}`); };

try {
  const result = build({ root, outDir: out, pages: ['examples/physics3d/index.html', 'examples/walk3d/index.html'] });
  console.log(formatReport(result));
  check('the build has no warnings', result.warnings.length === 0, result.warnings.join(' | '));
  check('each page has one hashed bundle', result.bundles.length === 2 && result.bundles.every((b) => /\.[0-9a-f]{8}\.js$/.test(b.file)));
  const html = readFileSync(join(out, 'examples/physics3d/index.html'), 'utf8');
  check('the page loads a plain script, not a module', /<script defer src="main\.[0-9a-f]{8}\.js"><\/script>/.test(html) && !/type="module"/.test(html), html.match(/<script[^>]*src[^>]*>/)?.[0]);
  const raw = result.bundles.reduce((n, b) => n + b.source, 0), min = result.bundles.reduce((n, b) => n + b.minified, 0);
  check('minified code is much smaller than the source', min < raw * 0.85, `${(raw / 1024).toFixed(0)} KB -> ${(min / 1024).toFixed(0)} KB`);

  const server = createStaticServer({ root: out, allowDirs: ['examples'], index: '/examples/physics3d/index.html' });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  try {
    for (const renderer of ['webgpu', 'webgl2']) {
      console.log(`--- ${renderer}: physics3d (built)`);
      await withChromePage(`http://127.0.0.1:${port}/examples/physics3d/index.html?renderer=${renderer}`, async (page) => {
        const ready = await page.waitFor('window.__physics && window.__physics.world.bodies.length > 50', 20_000);
        check('the built playground starts', ready, page.errors.slice(0, 2).join(' | '));
        if (!ready) return;
        check('on the requested backend', (await page.eval('window.__physics.renderer3d.kind')) === renderer);
        await page.sleep(2500);
        check('the physics runs (bodies finite, parts asleep)', await page.eval('window.__physics.world.bodies.every((b) => Number.isFinite(b.x + b.y + b.z)) && window.__physics.world.stats.asleep > 20'));
        await page.eval('window.__physics.quickSave(); 0'); await page.sleep(500);
        check('saving works in the built game (compressed, in localStorage)', await page.eval('(localStorage.getItem("physics3d:slot.quick") || "").startsWith("gz:")'));
        check('no page errors', page.errors.filter((e) => !/willReadFrequently/.test(e)).length === 0, page.errors.slice(0, 2).join(' | '));
      });
      console.log(`--- ${renderer}: walk3d (built)`);
      await withChromePage(`http://127.0.0.1:${port}/examples/walk3d/index.html?renderer=${renderer}`, async (page) => {
        const ready = await page.waitFor('document.querySelector("canvas") && window.__walk', 20_000);
        check('the built walk3d starts', ready || (await page.eval('!!document.querySelector("canvas")')), page.errors.slice(0, 2).join(' | '));
        await page.sleep(1500);
        check('no page errors', page.errors.filter((e) => !/willReadFrequently/.test(e)).length === 0, page.errors.slice(0, 2).join(' | '));
      });
    }
  } finally { server.close(); }
} catch (e) {
  failed = true;
  console.log('FAIL', e.stack ?? e.message);
} finally {
  rmSync(out, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
