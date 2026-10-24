// Boots the whole studio in a browser and walks the main flow, printing what works. Chrome has the full test (tools/studio-test.js); this is for the
// other browsers on this machine. Usage: node tools/studio-probe.js [firefox|chrome]
import { runBrowserPage, findBrowser } from './browser-test.js';

const browser = process.argv[2] ?? 'firefox';
if (!findBrowser(browser)) { console.log(`${browser} is not installed here`); process.exit(0); }
const report = await runBrowserPage('/tools/studio-probe/probe.html', { browser, timeoutMs: 150_000, allowDirs: ['studio', 'packages', 'tools'] });
console.log(report.userAgent);
let failed = false;
for (const s of report.steps ?? []) { if (!s.ok) failed = true; console.log(`${s.ok ? 'PASS' : 'FAIL'} ${s.name}${s.detail ? `  (${s.detail})` : ''}`); }
for (const e of report.errors ?? []) console.log(`     page error: ${e}`);
if (report.error) { failed = true; console.log(report.error); }
process.exit(failed ? 1 : 0);
