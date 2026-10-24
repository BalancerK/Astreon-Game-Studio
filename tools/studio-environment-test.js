// Live check, in a real Chrome, of the Environment panel: the engine's renderer draws the sky, water and ground; moving the sliders changes the picture and writes environment.json;
// the water can be turned off; a starter replaces everything; and the file is read back.
// Usage: node tools/studio-environment-test.js [outDir]
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createStaticServer } from './static-server.js';
import { withChromePage } from './cdp.js';

const outDir = process.argv[2] ?? null;
if (outDir) mkdirSync(outDir, { recursive: true });
const root = decodeURIComponent(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const server = createStaticServer({ root, allowDirs: ['studio', 'packages'], index: '/studio/index.html' });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
let failed = false;
const check = (name, ok, detail = '') => { if (!ok) failed = true; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `  (${detail})` : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FILE = 'JSON.parse(window.studio.project.readText("environment.json"))';

try {
  await withChromePage(`http://localhost:${port}/studio/index.html`, async (page) => {
    const S = (expr) => page.eval(`(() => { const s = window.studio; return ${expr}; })()`);
    const P = (expr) => page.eval(`(() => { const p = document.querySelector('[aria-label="Environment"]'); return p ? (${expr}) : null; })()`);
    const slide = (label, value) => P(`(() => { const i = [...p.querySelectorAll("input[type=range]")].find((x) => x.getAttribute("aria-label") === ${JSON.stringify(label)}); if (!i) return false; i.value = ${value}; i.dispatchEvent(new Event("input")); return true; })()`);
    /** A cheap fingerprint of what the picture shows: brightness sampled over a grid (read from a copy, as the canvas is a GPU one). */
    const shot = () => P(`(() => { const c = p.querySelector("canvas"); if (!c) return null; p.environment.frame(); const k = document.createElement("canvas"); k.width = 48; k.height = 30; const g = k.getContext("2d"); g.drawImage(c, 0, 0, 48, 30); const d = g.getImageData(0, 0, 48, 30).data; return Array.from(d); })()`);
    const diff = (a, b) => (a && b ? a.reduce((s, v, i) => s + Math.abs(v - b[i]), 0) / a.length : 0);

    check('the studio opens', await page.waitFor('!!window.studio && !!document.getElementById("dock")', 20_000));
    await S('(s.createProject({ name: "Env test", template: "blank" }), 1)');
    await page.waitFor('window.studio.project?.name === "Env test"', 10_000);
    await S('(s.dock.show("environment"), 1)');
    check('the panel opens with the engine\'s picture', await page.waitFor('!!document.querySelector("[aria-label=\\"Environment\\"] canvas")', 15_000));
    await sleep(800);
    const day = await shot();
    check('the picture is not blank', day && day.some((v, i) => i % 4 < 3 && v > 40) && day.some((v, i) => i % 4 < 3 && v !== day[0]));
    if (outDir) writeFileSync(join(outDir, 'environment-day.png'), await page.screenshot());

    await slide('Time of day', 1);
    await sleep(900);
    const night = await shot();
    check('night looks different from day (and darker)', diff(day, night) > 8 && night.reduce((s, v) => s + v, 0) < day.reduce((s, v) => s + v, 0));
    check('the file keeps the time', await page.waitFor(`(${FILE}).sky.hour === 1`, 4000));
    if (outDir) writeFileSync(join(outDir, 'environment-night.png'), await page.screenshot());

    await slide('Time of day', 15);
    await sleep(500);
    const withWater = await shot();
    await P('(() => { const c = [...p.querySelectorAll("input[type=checkbox]")].find((x) => x.parentElement.textContent.includes("There is water")); c.checked = false; c.dispatchEvent(new Event("change")); return 1; })()');
    check('turning the water off is kept in the file', await page.waitFor(`(${FILE}).water.on === false`, 4000));
    await sleep(700);
    const noWater = await shot(); check('and changes the picture', diff(withWater, noWater) > 1.2, diff(withWater, noWater).toFixed(2));

    await slide('Hill height', 20);
    check('hills are kept', await page.waitFor(`(${FILE}).terrain.hills === 20`, 4000));
    await P('(() => { const s = p.querySelector("select[aria-label=\\"Start from\\"]"); s.value = "storm"; s.dispatchEvent(new Event("change")); return 1; })()');
    check('a starter replaces everything', await page.waitFor(`(${FILE}).sky.clouds === 1 && (${FILE}).water.on === true && (${FILE}).terrain.hills === 8`, 4000));

    await S('(s.project.write("environment.json", JSON.stringify({ sky: { hour: 6 } })), s.emit("files"), 1)');
    check('a file changed by hand is read back', await page.waitFor('document.querySelector("[aria-label=\\"Environment\\"] input[aria-label=\\"Time of day\\"]")?.value === "6"', 4000));

    const errs = page.errors.filter((e) => !/willReadFrequently|favicon/.test(e));
    check('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
  }, { width: 1500, height: 1000 });
} finally { server.close(); }
process.exit(failed ? 1 : 0);
