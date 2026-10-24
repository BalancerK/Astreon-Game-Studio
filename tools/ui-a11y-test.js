// Runs the UI accessibility self-test in headless Chrome: the hidden mirror of the UI with its ARIA roles, focus moving both ways between the screen reader and the UI, keys and clicks reaching
// the widgets, live-region announcements, and the typing field named after what is being edited. Uses the real DOM, with `attachDom` as in a game.
// Usage: node tools/ui-a11y-test.js   (exit code 1 on a failure)
import { runBrowserPage } from './browser-test.js';

const r = await runBrowserPage('/packages/ui/browser-test/a11y.html');
if (r.error) { console.log(`the page failed: ${r.error}`); process.exit(1); }
console.log(r.userAgent);
let failed = false;
for (const res of r.results) {
  if (res.unavailable) { console.log(`  ${res.kind} unavailable: ${res.unavailable}`); if (res.stack) console.log(res.stack.split('\n').slice(0, 4).join('\n')); failed = true; continue; }
  const bad = Object.entries(res.checks).filter(([, c]) => !c.ok), n = Object.keys(res.checks).length;
  console.log(`  ${res.kind} ${res.ok ? 'PASS' : 'FAIL'} (${n - bad.length}/${n} checks)`);
  for (const [name, c] of bad) console.log(`      x ${name}: got ${JSON.stringify(c.got)} want ${JSON.stringify(c.want)}`);
  if (!res.ok) failed = true;
}
process.exit(failed ? 1 : 0);
