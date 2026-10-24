// Runs the audio self-test in headless Chrome: the engine renders through a real Web Audio graph (an OfflineAudioContext) and the
// output samples are measured: pitch, volume, panning, distance, buses, fades, decoding of a real file format.
// Usage: node tools/audio-selftest.js   (exit code 1 on any failure)
import { runBrowserPage } from './browser-test.js';

const r = await runBrowserPage('/packages/audio/browser-test/selftest.html');
console.log(r.userAgent);
let failed = !r.ok;
for (const [name, c] of Object.entries(r.checks)) {
  console.log(`  ${c.ok ? 'PASS' : 'FAIL'} ${name}${c.ok ? '' : `  got ${JSON.stringify(c.got)} want ${JSON.stringify(c.want)}`}`);
}
process.exit(failed ? 1 : 0);
