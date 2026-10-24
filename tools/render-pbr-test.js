// Runs the physically based materials self-test in headless Chrome: pixels from both backends (WebGPU and WebGL2) checked against the shading model written out
// on the CPU (metal and roughness, the five kinds of picture, cut-outs, point lights and fog, a skinned mesh, changing a material), and the two backends compared with each other.
// Usage: node tools/render-pbr-test.js   (exit code 1 if an available backend fails)
import { runBrowserPage } from './browser-test.js';

const r = await runBrowserPage('/packages/render/browser-test/pbr.html');
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
  compare('spheres', a.samples, b.samples, 1.5, 40);
  compare('textured quad', a.textureSamples, b.textureSamples, 2, 40);
  compare('lit by points, with fog', a.pointSamples, b.pointSamples, 2, 40);
}
process.exit(failed ? 1 : 0);
