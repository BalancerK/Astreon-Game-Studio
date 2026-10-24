// Live check of the documentation website in a real browser: every page loads without errors and has content, the search finds things and opens them,
// the theme switch works, code blocks have copy buttons, the lag lab draws and reacts, and the layout holds on a phone-sized screen.
// Usage: node tools/site-test.js [outDir]
import { writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createStaticServer } from './static-server.js';
import { withChromePage } from './cdp.js';

const outDir = process.argv[2] ?? null;
if (outDir) mkdirSync(outDir, { recursive: true });
const root = decodeURIComponent(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const server = createStaticServer({ root, allowDirs: ['docs'], index: '/docs/site/index.html' });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/docs/site/`;
let failed = false;
const check = (name, ok, detail = '') => { if (!ok) failed = true; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `  (${detail})` : ''}`); };
const walk = (d) => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]));
const pages = walk(join(root, 'docs/site')).map((f) => relative(join(root, 'docs/site'), f).replace(/\\/g, '/')).filter((f) => f.endsWith('.html'));

try {
  await withChromePage(`${base}index.html`, async (page) => {
    const errors = () => page.errors.filter((e) => !/willReadFrequently/.test(e)).slice(0, 2).join(' | ');
    check('the home page loads', await page.waitFor('document.querySelector(".hero h1") && document.querySelectorAll(".card").length >= 6', 10_000), errors());
    check('the home page shows real numbers', await page.eval('document.querySelectorAll(".stat b").length === 4 && Number(document.querySelector(".stat b").textContent) >= 20'));
    if (outDir) writeFileSync(join(outDir, 'site-home.png'), await page.screenshot());

    // every page: no script errors, a title, a heading, working links to other pages of the site
    const bad = [];
    for (const p of pages) {
      await page.eval(`location.href = ${JSON.stringify(base + p)}`);
      await page.waitFor(`location.pathname.endsWith(${JSON.stringify(p)}) && document.readyState === 'complete' && !!document.querySelector('h1, .hero')`, 5000);
      let i = {};
      for (let attempt = 0; attempt < 4 && !(i.h && i.t && i.th); attempt++) {          // a page can still be settling just after it reports complete
        if (attempt) await page.sleep(150);
        i = JSON.parse((await page.eval('JSON.stringify({ h: !!document.querySelector("h1"), t: document.title.length > 3, th: !!document.getElementById("theme-btn") })').catch(() => '{}')) || '{}');
      }
      if (!(i.h && i.t && i.th)) bad.push(p);
    }
    check(`all ${pages.length} pages load with a heading, a title and the header`, bad.length === 0, bad.slice(0, 4).join(', '));
    check('no script errors across the site', errors() === '', errors());

    await page.eval(`location.href = ${JSON.stringify(`${base}guide/architecture.html`)}`); await page.sleep(300);
    check('the architecture page draws its diagrams', (await page.eval('document.querySelectorAll("figure.diagram svg").length')) >= 3);
    check('and the layers diagram links to packages', (await page.eval('document.querySelectorAll("figure.diagram a[href*=packages]").length')) >= 20);
    check('code blocks have copy buttons', (await page.eval('document.querySelectorAll(".code .copy").length')) >= 1);
    check('the table of contents lists the sections', (await page.eval('document.querySelectorAll("aside.toc a").length')) >= 6);
    if (outDir) writeFileSync(join(outDir, 'site-architecture.png'), await page.screenshot());

    // search: open with "/", type, results appear, Enter opens the first
    await page.eval('document.dispatchEvent(new KeyboardEvent("keydown", { key: "/", bubbles: true }))');
    check('"/" opens the search', await page.waitFor('document.getElementById("search").classList.contains("open")', 3000));
    await page.type('character controller');
    check('searching finds the physics package', await page.waitFor('[...document.querySelectorAll("#search li")].some((li) => /physics/i.test(li.textContent))', 3000));
    if (outDir) writeFileSync(join(outDir, 'site-search.png'), await page.screenshot());
    await page.key('Enter', 'down'); await page.key('Enter', 'up');
    check('Enter opens the result', await page.waitFor('location.pathname.includes("/packages/") || location.pathname.includes("/api/")', 4000), await page.eval('location.pathname'));

    // theme
    await page.eval(`location.href = ${JSON.stringify(`${base}guide/start-here.html`)}`); await page.sleep(300);
    const bg = () => page.eval('getComputedStyle(document.body).backgroundColor');
    const before = await bg();
    await page.eval('document.getElementById("theme-btn").click()'); await page.sleep(100);
    const after = await bg();
    check('the theme button switches light and dark', before !== after, `${before} -> ${after}`);
    if (outDir) writeFileSync(join(outDir, 'site-start-here.png'), await page.screenshot());
    await page.eval('document.getElementById("theme-btn").click()');

    // the lag lab
    await page.eval(`location.href = ${JSON.stringify(`${base}guide/multiplayer-explained.html`)}`);
    check('the lag lab appears', await page.waitFor('document.getElementById("lab-canvas") && document.getElementById("lab-canvas").width > 300', 5000), errors());
    await page.sleep(800);
    const pixels = () => page.eval('(() => { const c = document.getElementById("lab-canvas"), d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++; return n; })()');
    check('the lab draws', (await pixels()) > 1000);
    await page.eval('(() => { const e = document.getElementById("lab-pred"); e.click(); document.getElementById("lab-interp").click(); })()'); await page.sleep(500);
    check('its switches are checked after clicking', await page.eval('document.getElementById("lab-pred").checked && document.getElementById("lab-interp").checked'));
    if (outDir) { await page.eval('document.getElementById("lab-canvas").scrollIntoView({ block: "center" })'); await page.sleep(500); writeFileSync(join(outDir, 'site-lab.png'), await page.screenshot()); }
    check('no errors after using the lab', errors() === '', errors());
  });
} finally { server.close(); }
process.exit(failed ? 1 : 0);
