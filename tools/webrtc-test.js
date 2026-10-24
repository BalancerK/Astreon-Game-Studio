// Runs the WebRTC self-test in headless Chrome: real peer connections between a host and a client in one page, over in-page signalling, tabs-style signalling, a real signalling server
// (started here) and invitation codes: ordering and integrity of reliable messages, the unreliable channel, big messages, closing, and the round trip time.
// Usage: node tools/webrtc-test.js [--verbose] [--firefox]   (exit code 1 on a failure)
import { runBrowserPage } from './browser-test.js';
import { createSignalingServer } from '../packages/transport/src/node.js';

const server = await createSignalingServer({ port: 0 });
const browser = process.argv.includes('--firefox') ? 'firefox' : 'chrome';
let failed = false;
try {
  for (const page of [`/packages/transport/browser-test/webrtc.html?signal=${encodeURIComponent(`ws://127.0.0.1:${server.port}/`)}`, '/packages/transport/browser-test/webrtc-game.html']) {
    const r = await runBrowserPage(page, { browser, timeoutMs: 90_000 });
    if (r.error) { console.log(`${page.split('?')[0].split('/').pop()}: the page failed: ${r.error}`); failed = true; continue; }
    console.log(r.userAgent, page.split('?')[0].split('/').pop());
    for (const res of r.results) {
      const bad = Object.entries(res.checks).filter(([, c]) => !c.ok), n = Object.keys(res.checks).length;
      console.log(`  ${browser} ${res.ok ? 'PASS' : 'FAIL'} (${n - bad.length}/${n} checks)`);
      for (const [name, c] of Object.entries(res.checks)) if (process.argv.includes('--verbose') || !c.ok) console.log(`      ${c.ok ? 'ok' : 'x'} ${name}: got ${JSON.stringify(c.got)}${c.ok ? '' : ` want ${JSON.stringify(c.want)}`}`);
      if (!res.ok) failed = true;
    }
  }
} finally { await server.close(); }
process.exit(failed ? 1 : 0);
