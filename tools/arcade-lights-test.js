// Runs the arcade lights self-test in headless Chrome: lights that cast shadows from walls, turn them off, and have a core, checked by pixel brightness on a real canvas.
// Usage: node tools/arcade-lights-test.js [--verbose]   (exit code 1 on a failure)
import { runBrowserPage } from './browser-test.js';

const r = await runBrowserPage('/packages/arcade/browser-test/lights.html', { browser: process.argv.includes('--firefox') ? 'firefox' : 'chrome', timeoutMs: 60_000 });
if (r.error) { console.log(`the page failed: ${r.error}`); process.exit(1); }
console.log(r.userAgent);
let failed = false;
for (const res of r.results) {
  const bad = Object.entries(res.checks).filter(([, c]) => !c.ok), n = Object.keys(res.checks).length;
  console.log(`  ${res.kind} ${res.ok ? 'PASS' : 'FAIL'} (${n - bad.length}/${n} checks)`);
  for (const [name, c] of Object.entries(res.checks)) if (process.argv.includes('--verbose') || !c.ok) console.log(`      ${c.ok ? 'ok' : 'x'} ${name}: got ${JSON.stringify(c.got)}${c.ok ? '' : ` want ${JSON.stringify(c.want)}`}`);
  if (!res.ok) failed = true;
}
process.exit(failed ? 1 : 0);
