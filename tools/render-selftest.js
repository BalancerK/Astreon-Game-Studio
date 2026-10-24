// Runs the render self-test in headless Chrome and prints a compact summary.
// Usage: node tools/render-selftest.js   (exit code 1 if an available backend fails)
import { runBrowserPage } from './browser-test.js';

const r = await runBrowserPage('/packages/render/browser-test/selftest.html');
console.log(r.userAgent, `| navigator.gpu: ${r.gpuApi}`);
let failed = false;
for (const res of r.results) {
  if (res.unavailable) { console.log(`  ${res.kind.padEnd(9)} unavailable: ${res.unavailable}`); continue; }
  const bad = Object.entries(res.checks).filter(([, c]) => !c.ok);
  const n = Object.keys(res.checks).length;
  console.log(`  ${res.kind.padEnd(9)} ${res.ok ? 'PASS' : 'FAIL'} (${n - bad.length}/${n} pixel checks, camera move ${res.cameraMoved ? 'ok' : 'FAILED'})`);
  for (const [name, c] of bad) console.log(`      x ${name}: got ${JSON.stringify(c.got)} want ${JSON.stringify(c.want)}`);
  if (!res.ok) failed = true;
}
console.log(`  automatic fallback chose: ${r.fallback}`);
process.exit(failed ? 1 : 0);
