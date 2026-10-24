// Runs the text self-tests in headless Chrome: the bidirectional algorithm against the browser's own on thousands of random mixed-direction strings, and (with the text engine) shaped Arabic,
// Hebrew with marks, fallback fonts, bitmap fonts and rich text laid out and drawn with real fonts.
// Usage: node tools/render-text-test.js [--verbose]   (exit code 1 on a failure)
import { existsSync } from 'node:fs';
import { runBrowserPage } from './browser-test.js';

const root = new URL('..', import.meta.url).pathname.replace(/^\/(\w:)/, '$1');

let failed = false;
for (const page of ['/packages/render/browser-test/bidi.html', '/packages/render/browser-test/text.html']) {
  if (!existsSync(root + page.slice(1))) continue;
  const r = await runBrowserPage(page, { browser: process.argv.includes('--firefox') ? 'firefox' : 'chrome', timeoutMs: 60_000 });
  if (r.error) { console.log(`${page}: the page failed: ${r.error}`); failed = true; continue; }
  console.log(r.userAgent, page.split('/').pop());
  for (const res of r.results) {
    if (res.unavailable) { console.log(`  ${res.kind} unavailable: ${res.unavailable}`); if (res.stack) console.log(res.stack.split('\n').slice(0, 4).join('\n')); failed = true; continue; }
    const bad = Object.entries(res.checks).filter(([, c]) => !c.ok), n = Object.keys(res.checks).length;
    console.log(`  ${res.kind} ${res.ok ? 'PASS' : 'FAIL'} (${n - bad.length}/${n} checks)`);
    for (const [name, c] of Object.entries(res.checks)) if (process.argv.includes('--verbose') || !c.ok) console.log(`      ${c.ok ? 'ok' : 'x'} ${name}: got ${JSON.stringify(c.got)}${c.ok ? '' : ` want ${JSON.stringify(c.want)}`}`);
    if (!res.ok) failed = true;
  }
}
process.exit(failed ? 1 : 0);
