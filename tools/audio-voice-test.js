// Runs the audio sprites, streaming and voice self-test in headless Chrome with a fake microphone (Chrome's own beeping test device) and autoplay allowed: a sprite region renders at its own pitch
// and stops at its end, the microphone opens and an audio worklet delivers 20 ms frames, ADPCM and Opus (WebCodecs) round trip, whole voice chats loop back and are heard on the voice bus, and a
// streamed track plays from a media element, pauses, seeks, and ends.
// Usage: node tools/audio-voice-test.js   (exit code 1 on a failure)
import { runBrowserPage } from './browser-test.js';

const r = await runBrowserPage('/packages/audio/browser-test/voice.html', { timeoutMs: 60_000, flags: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
if (r.error) { console.log(`the page failed: ${r.error}`); process.exit(1); }
console.log(r.userAgent);
let failed = false;
for (const res of r.results) {
  if (res.unavailable) { console.log(`  ${res.kind} unavailable: ${res.unavailable}`); if (res.stack) console.log(res.stack.split('\n').slice(0, 4).join('\n')); failed = true; continue; }
  const bad = Object.entries(res.checks).filter(([, c]) => !c.ok), n = Object.keys(res.checks).length;
  console.log(`  ${res.kind} ${res.ok ? 'PASS' : 'FAIL'} (${n - bad.length}/${n} checks)`);
  for (const [name, c] of Object.entries(res.checks)) if (process.argv.includes('--verbose') || !c.ok) console.log(`      ${c.ok ? 'ok' : 'x'} ${name}: got ${JSON.stringify(c.got)}${c.ok ? '' : ` want ${JSON.stringify(c.want)}`}`);
  if (!res.ok) failed = true;
}
process.exit(failed ? 1 : 0);
