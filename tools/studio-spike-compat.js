// Runs the studio spike's scripted self-test (studio/spike/selftest.js) in each browser installed on this machine and prints what works where.
// The studio's design depends on service workers in a cross-origin frame, module workers, OffscreenCanvas and killing a hung worker: this says which
// browsers have all of it. Usage: node tools/studio-spike-compat.js
import { runBrowserPage, findBrowser } from './browser-test.js';

let failed = false;
for (const browser of ['chrome', 'firefox']) {
  console.log(`--- ${browser}`);
  if (!findBrowser(browser)) { console.log('     not installed here: not tested'); continue; }
  let report;
  try {
    report = await runBrowserPage('/studio/spike/index.html?selftest=1', { browser, timeoutMs: 90_000, allowDirs: ['studio', 'packages'] });
  } catch (e) {
    failed = true;
    console.log(`FAIL could not run: ${e.message}`);
    continue;
  }
  if (report.error) { failed = true; console.log(`FAIL ${report.error.split('\n').slice(0, 4).join(' | ')}`); continue; }
  console.log(`     ${report.userAgent}`);
  for (const c of report.checks) {
    if (!c.ok) failed = true;
    console.log(`${c.ok ? 'PASS' : 'FAIL'} ${c.name}${!c.ok && c.detail ? `  (${c.detail})` : ''}`);
  }
  for (const [k, v] of Object.entries(report.numbers)) console.log(`     ${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`);
}
process.exit(failed ? 1 : 0);
