// Renders sounds through the bus effects in headless Chrome (an OfflineAudioContext, so it needs no sound card) and measures the result: filters, reverb tails, echoes, ducking, occlusion.
// Usage: node tools/audio-effects-test.js   (exit code 1 on a failure)
import { runBrowserPage } from './browser-test.js';

const r = await runBrowserPage('/packages/audio/browser-test/effects.html');
if (r.error) { console.log(`the page failed: ${r.error}`); process.exit(1); }
console.log(r.userAgent);
const res = r.results[0];
if (res.error) { console.log(`failed: ${res.error}`); process.exit(1); }
const bad = Object.entries(res.checks).filter(([, c]) => !c.ok);
const n = Object.keys(res.checks).length;
console.log(`  audio effects ${res.ok ? 'PASS' : 'FAIL'} (${n - bad.length}/${n} checks)`);
for (const [name, c] of bad) console.log(`      x ${name}: got ${JSON.stringify(c.got)} want ${JSON.stringify(c.want)}`);
process.exit(res.ok ? 0 : 1);
