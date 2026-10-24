// Runs the local-lights self-test in headless Chrome on both 3D backends: spot cones, one-sided area panels, and shadows from point (cube) and spot lights, on simple and
// physically based surfaces, a caster behind the camera, the layer budget, and that the two backends agree.
// Usage: node tools/render-lights-test.js   (exit code 1 if an available backend fails)
import { runBrowserPage } from './browser-test.js';

const r = await runBrowserPage('/packages/render/browser-test/locallights.html');
if (r.error) { console.log(`the page failed: ${r.error}`); process.exit(1); }
console.log(r.userAgent);
let failed = false;
for (const res of r.results) {
  if (res.unavailable) { console.log(`  ${res.kind.padEnd(16)} unavailable: ${res.unavailable}`); if (res.stack) console.log(res.stack.split('\n').slice(0, 4).join('\n')); failed = true; continue; }
  const bad = Object.entries(res.checks).filter(([, c]) => !c.ok);
  const n = Object.keys(res.checks).length;
  console.log(`  ${res.kind.padEnd(16)} ${res.ok ? 'PASS' : 'FAIL'} (${n - bad.length}/${n} checks${res.lastError ? `, GPU error: ${res.lastError}` : ''})`);
  for (const [name, c] of bad) console.log(`      x ${name}: got ${JSON.stringify(c.got)} want ${JSON.stringify(c.want)}`);
  if (!res.ok) failed = true;
}
process.exit(failed ? 1 : 0);
