// Runs the compressed textures self-test in headless Chrome: on both backends (WebGPU and WebGL2), a picture compressed for the graphics card (BC1 and BC3, read from KTX2 files) must draw
// the same colours as the same picture as plain pixels. A card that cannot read a format must say so clearly (that is reported, not failed).
// Usage: node tools/render-compressed-test.js   (exit code 1 if an available backend fails)
import { runBrowserPage } from './browser-test.js';

const r = await runBrowserPage('/packages/render/browser-test/compressed.html');
if (r.error) { console.log(`the page failed: ${r.error}`); process.exit(1); }
console.log(r.userAgent);
let failed = false;
for (const res of r.results) {
  if (res.unavailable) { console.log(`  ${res.kind.padEnd(7)} unavailable: ${res.unavailable}`); if (res.stack) console.log(res.stack.split('\n').slice(0, 4).join('\n')); failed = true; continue; }
  const bad = Object.entries(res.checks).filter(([, c]) => !c.ok);
  const n = Object.keys(res.checks).length;
  console.log(`  ${res.kind.padEnd(7)} ${res.ok ? 'PASS' : 'FAIL'} (${n - bad.length}/${n} checks${res.lastError ? `, GPU error: ${res.lastError}` : ''}${res.skipped ? `; not readable by this card: ${res.skipped.join(', ')}` : ''})`);
  for (const [name, c] of bad) console.log(`      x ${name}: got ${JSON.stringify(c.got)} want ${JSON.stringify(c.want)}`);
  if (!res.ok) failed = true;
}
process.exit(failed ? 1 : 0);
