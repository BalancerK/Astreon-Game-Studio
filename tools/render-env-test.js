// Runs the environment lighting self-test in headless Chrome: on both backends (WebGPU and WebGL2), pixels checked against the shading model written out on the CPU (a white
// environment, a sky with a sun reflected in metals from mirror to chalk, the sky drawn as the background, the six faces of the cube, rotation, intensity, sky and environment off), and the
// two backends compared with each other.
// Usage: node tools/render-env-test.js [--save picture.png]   (exit code 1 if an available backend fails; --save writes the standard scene as a PNG)
import { runBrowserPage } from './browser-test.js';

const r = await runBrowserPage('/packages/render/browser-test/env.html');
if (r.error) { console.log(`the page failed: ${r.error}`); process.exit(1); }
console.log(r.userAgent);
let failed = false;
for (const res of r.results) {
  if (res.unavailable) { console.log(`  ${res.kind.padEnd(7)} unavailable: ${res.unavailable}`); if (res.stack) console.log(res.stack.split('\n').slice(0, 4).join('\n')); failed = true; continue; }
  const bad = Object.entries(res.checks).filter(([, c]) => !c.ok);
  const n = Object.keys(res.checks).length;
  console.log(`  ${res.kind.padEnd(7)} ${res.ok ? 'PASS' : 'FAIL'} (${n - bad.length}/${n} checks${res.lastError ? `, GPU error: ${res.lastError}` : ''})`);
  for (const [name, c] of bad) console.log(`      x ${name}: got ${JSON.stringify(c.got)} want ${JSON.stringify(c.want)}`);
  if (!res.ok) failed = true;
}
const [a, b] = r.results.filter((x) => x.samples);
const compare = (what, xs, ys, mean, worstMax) => {
  let sum = 0, worst = 0;
  for (let i = 0; i < xs.length; i++) { const d = Math.abs(xs[i] - ys[i]); sum += d; if (d > worst) worst = d; }
  const m = sum / xs.length, ok = m < mean && worst < worstMax;
  console.log(`  ${a.kind} vs ${b.kind} ${what}: mean difference ${m.toFixed(2)} / 255, worst sample ${worst}: ${ok ? 'PASS' : 'FAIL'}`);
  if (!ok) failed = true;
};
if (a && b) {
  compare('spheres and sky', a.samples, b.samples, 2, 60);
}
const save = process.argv.indexOf('--save');
if (save > 0 && r.results[0]?.image) { const { writeFileSync } = await import('node:fs'); writeFileSync(process.argv[save + 1], Buffer.from(r.results[0].image.split(',')[1], 'base64')); console.log(`saved ${process.argv[save + 1]}`); }
process.exit(failed ? 1 : 0);
