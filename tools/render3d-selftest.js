// Runs the 3D render self-test in headless Chrome: pixel checks of shading, depth, culling, blending, fog, instancing and
// resize on each backend, and a comparison of the two backends' images against each other.
// Usage: node tools/render3d-selftest.js   (exit code 1 if an available backend fails)
import { runBrowserPage } from './browser-test.js';

const r = await runBrowserPage('/packages/render/browser-test/selftest3d.html');
console.log(r.userAgent);
let failed = false;
for (const res of r.results) {
  if (res.unavailable) { console.log(`  ${res.kind.padEnd(7)} unavailable: ${res.unavailable}`); continue; }
  const bad = Object.entries(res.checks).filter(([, c]) => !c.ok);
  const n = Object.keys(res.checks).length;
  console.log(`  ${res.kind.padEnd(7)} ${res.ok ? 'PASS' : 'FAIL'} (${n - bad.length}/${n} checks${res.lastError ? `, GPU error: ${res.lastError}` : ''})`);
  for (const [name, c] of bad) console.log(`      x ${name}: got ${JSON.stringify(c.got)} want ${JSON.stringify(c.want)}`);
  if (!res.ok) failed = true;
}
const [a, b] = r.results.filter((x) => x.samples);
if (a && b) {
  let sum = 0, worst = 0;
  for (let i = 0; i < a.samples.length; i++) { const d = Math.abs(a.samples[i] - b.samples[i]); sum += d; if (d > worst) worst = d; }
  const mean = sum / a.samples.length;
  const ok = mean < 1.5 && worst < 40;
  console.log(`  ${a.kind} vs ${b.kind} images: mean difference ${mean.toFixed(2)} / 255, worst sample ${worst}: ${ok ? 'PASS' : 'FAIL'}`);
  if (!ok) failed = true;
}
if (a && b && a.textureSamples && b.textureSamples) {
  let sum = 0, worst = 0;
  for (let i = 0; i < a.textureSamples.length; i++) { const d = Math.abs(a.textureSamples[i] - b.textureSamples[i]); sum += d; if (d > worst) worst = d; }
  const mean = sum / a.textureSamples.length;
  const ok = mean < 2.5;
  console.log(`  ${a.kind} vs ${b.kind} textured scenes: mean difference ${mean.toFixed(2)} / 255, worst sample ${worst}: ${ok ? 'PASS' : 'FAIL'}`);
  if (!ok) failed = true;
}
if (a && b && a.pointSamples && b.pointSamples) {
  let sum = 0, worst = 0;
  for (let i = 0; i < a.pointSamples.length; i++) { const d = Math.abs(a.pointSamples[i] - b.pointSamples[i]); sum += d; if (d > worst) worst = d; }
  const mean = sum / a.pointSamples.length;
  const ok = mean < 2.5;
  console.log(`  ${a.kind} vs ${b.kind} point-lit scenes: mean difference ${mean.toFixed(2)} / 255, worst sample ${worst}: ${ok ? 'PASS' : 'FAIL'}`);
  if (!ok) failed = true;
}
if (a && b && a.shadowSamples && b.shadowSamples) {
  let sum = 0, worst = 0;
  for (let i = 0; i < a.shadowSamples.length; i++) { const d = Math.abs(a.shadowSamples[i] - b.shadowSamples[i]); sum += d; if (d > worst) worst = d; }
  const mean = sum / a.shadowSamples.length;
  const ok = mean < 2.5;
  console.log(`  ${a.kind} vs ${b.kind} shadowed scenes: mean difference ${mean.toFixed(2)} / 255, worst sample ${worst}: ${ok ? 'PASS' : 'FAIL'}`);
  if (!ok) failed = true;
}
if (a && b && a.cascadeSamples && b.cascadeSamples) {
  let sum = 0, worst = 0;
  for (let i = 0; i < a.cascadeSamples.length; i++) { const d = Math.abs(a.cascadeSamples[i] - b.cascadeSamples[i]); sum += d; if (d > worst) worst = d; }
  const mean = sum / a.cascadeSamples.length;
  const ok = mean < 2.5;
  console.log(`  ${a.kind} vs ${b.kind} cascaded shadows: mean difference ${mean.toFixed(2)} / 255, worst sample ${worst}: ${ok ? 'PASS' : 'FAIL'}`);
  if (!ok) failed = true;
}
if (a && b && a.postSamples && b.postSamples) {
  let sum = 0, worst = 0;
  for (let i = 0; i < a.postSamples.length; i++) { const d = Math.abs(a.postSamples[i] - b.postSamples[i]); sum += d; if (d > worst) worst = d; }
  const mean = sum / a.postSamples.length;
  const ok = mean < 2.5;
  console.log(`  ${a.kind} vs ${b.kind} post-processed scenes: mean difference ${mean.toFixed(2)} / 255, worst sample ${worst}: ${ok ? 'PASS' : 'FAIL'}`);
  if (!ok) failed = true;
}
if (a && b && a.particleSamples && b.particleSamples) {
  let sum = 0, worst = 0;
  for (let i = 0; i < a.particleSamples.length; i++) { const d = Math.abs(a.particleSamples[i] - b.particleSamples[i]); sum += d; if (d > worst) worst = d; }
  const mean = sum / a.particleSamples.length;
  const ok = mean < 2.5;
  console.log(`  ${a.kind} vs ${b.kind} scenes with particles: mean difference ${mean.toFixed(2)} / 255, worst sample ${worst}: ${ok ? 'PASS' : 'FAIL'}`);
  if (!ok) failed = true;
}
console.log(`  automatic choice: ${r.fallback}`);
process.exit(failed ? 1 : 0);
