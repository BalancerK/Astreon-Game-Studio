// Runs the baked-sky self-test in headless Chrome, on both backends: the sky drawn with the atmosphere baked into textures against the sky worked out for every pixel (they must look the same), at three
// times of day (so that the bake is filled again when the sun moves), and the bake really in use where the card can do it.
// Usage: node tools/render-skybake-test.js   (exit code 1 if an available backend fails)
import { runBrowserPage } from './browser-test.js';

const r = await runBrowserPage('/packages/render/browser-test/skybake.html', { timeoutMs: 120_000 });
if (r.error) { console.log(`the page failed: ${r.error}`); process.exit(1); }
console.log(r.userAgent);
let failed = false;
for (const res of r.results) {
  if (res.unavailable) { console.log(`  ${res.kind.padEnd(7)} unavailable: ${res.unavailable}`); failed = true; continue; }
  const { on, off } = res;
  let sum = 0, worst = 0;
  for (let i = 0; i < on.samples.length; i++) { const d = Math.abs(on.samples[i] - off.samples[i]); sum += d; if (d > worst) worst = d; }
  const mean = sum / on.samples.length;
  const moved = on.sums.some((s, i) => i % 4 === 0 && Math.abs(s - on.sums[(i + 4) % on.sums.length]) > 2000);     // the same view at another time of day is another picture: the bake followed the sun
  const checks = [
    [`baked ${on.baked ? 'in use' : 'not available (the card cannot draw to half-float textures)'}`, res.kind === 'webgpu' ? on.baked : true],
    ['not baked when asked not to', !off.baked],
    [`looks the same: mean difference ${mean.toFixed(2)} / 255, worst sample ${worst}`, mean < 1.5 && worst < 40],
    ['the bake follows the sun (three times of day give three pictures)', moved],
    ['no GPU errors', !on.lastError && !off.lastError],
  ];
  console.log(`  ${res.kind.padEnd(7)} ${checks.every(([, ok]) => ok) ? 'PASS' : 'FAIL'}`);
  for (const [name, ok] of checks) if (!ok) { console.log(`      x ${name}`); failed = true; }
}
process.exit(failed ? 1 : 0);
