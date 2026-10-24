// Runs the terrain self-test in headless Chrome: splat-mapped ground with several levels of detail on WebGPU and WebGL2, checked by pixel colours, and (as they come in) water, decals and the procedural sky.
// Usage: node tools/render-terrain-test.js [--verbose]   (exit code 1 on a failure)
import { existsSync } from 'node:fs';
import { runBrowserPage } from './browser-test.js';

const root = new URL('..', import.meta.url).pathname.replace(/^\/(\w:)/, '$1');
let failed = false;
for (const page of ['/packages/render/browser-test/terrain.html', '/packages/render/browser-test/water.html', '/packages/render/browser-test/sky.html']) {
  if (!existsSync(root + page.slice(1))) continue;
  const r = await runBrowserPage(page, { browser: process.argv.includes('--firefox') ? 'firefox' : 'chrome', timeoutMs: 120_000 });
  if (r.error) { console.log(`${page}: the page failed: ${r.error}`); failed = true; continue; }
  console.log(r.userAgent, page.split('/').pop());
  for (const res of r.results) {
    if (res.unavailable) { console.log(`  ${res.kind} unavailable: ${res.unavailable}`); if (res.stack) console.log(res.stack.split('\n').slice(0, 4).join('\n')); failed = true; continue; }
    const bad = Object.entries(res.checks).filter(([, c]) => !c.ok), n = Object.keys(res.checks).length;
    console.log(`  ${res.kind} ${res.ok ? 'PASS' : 'FAIL'} (${n - bad.length}/${n} checks)`);
    for (const [name, c] of Object.entries(res.checks)) if (process.argv.includes('--verbose') || !c.ok) console.log(`      ${c.ok ? 'ok' : 'x'} ${name}: got ${JSON.stringify(c.got)}${c.ok ? '' : ` want ${JSON.stringify(c.want)}`}`);
    if (res.lastError) console.log(`      GPU error: ${res.lastError}`);
    if (!res.ok) failed = true;
  }
}
process.exit(failed ? 1 : 0);
