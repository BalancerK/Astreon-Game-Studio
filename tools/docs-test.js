// Opens the generated API reference in a real browser: it renders, every package is there, and the search box filters. Usage: node tools/docs-test.js [outDir]
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { serve } from '../packages/build/src/index.js';
import { withChromePage } from './cdp.js';

const outDir = process.argv[2] ?? null;
if (outDir) mkdirSync(outDir, { recursive: true });
const root = decodeURIComponent(new URL('../docs/api', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
let failed = false;
const check = (name, ok, detail = '') => { if (!ok) failed = true; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `  (${detail})` : ''}`); };
const dev = await serve({ root, port: 0, liveReload: false });
try {
  await withChromePage(`${dev.url}index.html`, async (page) => {
    check('the page renders every package', await page.waitFor('document.querySelectorAll("h2.package").length >= 23', 10_000), String(await page.eval('document.querySelectorAll("h2.package").length')));
    const entries = await page.eval('document.querySelectorAll(".entry").length');
    check('with hundreds of entries', entries > 400, String(entries));
    check('the navigation links to a package\'s exports', await page.eval('!!document.querySelector("nav a[href=\\"#core.FixedLoop\\"]")'));
    await page.eval('(() => { const q = document.getElementById("q"); q.value = "fixedloop"; q.dispatchEvent(new Event("input")); })()');
    const shown = JSON.parse(await page.eval('JSON.stringify([...document.querySelectorAll(".entry:not(.hidden)")].map((e) => e.id))'));
    check('searching filters the entries', shown.length >= 1 && shown.length < 5 && shown.includes('core.FixedLoop'), shown.join(', '));
    check('and the navigation', (await page.eval('document.querySelectorAll("nav a[data-name]:not(.hidden)").length')) < 20);
    await page.eval('(() => { const q = document.getElementById("q"); q.value = ""; q.dispatchEvent(new Event("input")); })()');
    check('clearing the search shows everything again', (await page.eval('document.querySelectorAll(".entry.hidden").length')) === 0);
    check('no script or markup from comments leaked in', (await page.eval('document.querySelectorAll("main script").length')) === 0);
    if (outDir) { await page.eval('location.hash = "#core.FixedLoop"'); await page.sleep(300); writeFileSync(join(outDir, 'api-docs.png'), await page.screenshot()); }
    check('no page errors', page.errors.filter((e) => !/favicon/.test(e)).length === 0, page.errors.slice(0, 2).join(' | '));
  });
} catch (e) { failed = true; console.log('FAIL', e.stack ?? e.message); } finally { await dev.close(); }
process.exit(failed ? 1 : 0);
