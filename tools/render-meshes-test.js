// Runs the triangle-mesh self-test in headless Chrome: textured and tinted meshes, additive blending, cameras, filters and layers on WebGPU, WebGL2 and Canvas2D.
// Usage: node tools/render-meshes-test.js [--verbose]   (exit code 1 on a failure)
import { runBrowserPage } from './browser-test.js';

const r = await runBrowserPage('/packages/render/browser-test/meshes.html', { browser: process.argv.includes('--firefox') ? 'firefox' : 'chrome', timeoutMs: 120_000 });
if (r.error) { console.log(`the page failed: ${r.error}`); process.exit(1); }
console.log(r.userAgent);
let failed = false;
for (const res of r.results) {
  if (res.unavailable) { console.log(`  ${res.kind} unavailable: ${res.unavailable}`); if (res.stack) console.log(res.stack.split('\n').slice(0, 4).join('\n')); failed = true; continue; }
  const bad = Object.entries(res.checks).filter(([, c]) => !c.ok), n = Object.keys(res.checks).length;
  console.log(`  ${res.kind} ${res.ok ? 'PASS' : 'FAIL'} (${n - bad.length}/${n} checks)`);
  for (const [name, c] of Object.entries(res.checks)) if (process.argv.includes('--verbose') || !c.ok) console.log(`      ${c.ok ? 'ok' : 'x'} ${name}: got ${JSON.stringify(c.got)}${c.ok ? '' : ` want ${JSON.stringify(c.want)}`}`);
  if (res.lastError) console.log(`      GPU error: ${res.lastError}`);
  if (!res.ok) failed = true;
}
process.exit(failed ? 1 : 0);
