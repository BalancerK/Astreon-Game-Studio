// Verifies the debug overlay's DOM view in real browsers. Usage: node tools/debug-selftest.js
import { runBrowserPage, findBrowser } from './browser-test.js';

let failed = false;
for (const browser of ['chrome', 'firefox']) {
  if (!findBrowser(browser)) { console.log(`${browser}: not installed, skipped`); continue; }
  const r = await runBrowserPage('/packages/debug/browser-test/overlay.html', { browser, timeoutMs: 45_000 });
  const bad = Object.entries(r.checks ?? {}).filter(([, c]) => !c.ok);
  const total = Object.keys(r.checks ?? {}).length;
  const ok = !r.error && bad.length === 0 && total > 0;
  if (!ok) failed = true;
  console.log(`${browser.padEnd(8)} ${ok ? 'PASS' : 'FAIL'} (${total - bad.length}/${total} checks)${r.error ? ' ERROR ' + r.error.split('\n')[0] : ''}`);
  for (const [name, c] of bad) console.log(`   x ${name}: ${JSON.stringify(c.detail)}`);
}
process.exit(failed ? 1 : 0);
