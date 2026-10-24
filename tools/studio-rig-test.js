// Live check, in a real Chrome, of the Rig panel: add the sample skeleton, see it drawn by the engine, play and pause an animation, scrub to a moment, show the bones, hear its event,
// and see a damaged file explained and missing pictures reported.
// Usage: node tools/studio-rig-test.js [outDir]
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

try {
  await withChromePage(`http://localhost:${port}/studio/index.html`, async (page) => {
    const S = (expr) => page.eval(`(() => { const s = window.studio; return ${expr}; })()`);
    const P = (expr) => page.eval(`(() => { const p = document.querySelector('[aria-label="Rig"]'); return p ? (${expr}) : null; })()`);
    const btn = (label) => P(`(() => { const b = [...p.querySelectorAll("button")].find((x) => x.textContent === ${JSON.stringify(label)}); if (!b) return false; b.click(); return true; })()`);
    /** Draw a frame of the given length and read the picture in the same moment (a GPU canvas is blank a moment later). */
    const shot = (dt = 0) => P(`(() => { const r = p.rig.preview; r.frame(${dt}); const c = r.renderer.canvas; const k = document.createElement("canvas"); k.width = 96; k.height = 60;
      const g = k.getContext("2d"); g.drawImage(c, 0, 0, 96, 60); return Array.from(g.getImageData(0, 0, 96, 60).data); })()`);
    const diff = (a, b) => a.reduce((s, v, i) => s + Math.abs(v - b[i]), 0) / a.length;
    const select = (label, value) => P(`(() => { const s = p.querySelector('select[aria-label=${JSON.stringify(label)}]'); s.value = ${JSON.stringify(value)}; s.dispatchEvent(new Event("change")); return 1; })()`);

    check('the studio opens', await page.waitFor('!!window.studio && !!document.getElementById("dock")', 20_000));
    await S('(s.createProject({ name: "Rig test", template: "blank" }), 1)');
    await page.waitFor('window.studio.project?.name === "Rig test"', 10_000);
    await S('(s.dock.show("rig"), 1)');
    check('with no rigs it says so', await page.waitFor('!!document.querySelector("[aria-label=\\"Rig\\"]")', 8000) && /No rigs|rigs/.test(await P('p.querySelector("[role=status]").textContent')));
    await btn('Add a sample rig');
    check('the sample is written to rigs/', await page.waitFor('window.studio.project.has("rigs/sample.json")', 5000));
    check('the engine draws it', await page.waitFor('!!document.querySelector("[aria-label=\\"Rig\\"] canvas")', 15_000));
    await sleep(500);
    check('the summary says what is in it', /5 bones, 3 slots, 2 animations/.test(await P('p.querySelector("[role=status]").textContent')), await P('p.querySelector("[role=status]").textContent'));
    check('missing pictures are reported (the sample has none in the project)', /Missing pictures.*sample\/body/.test(await P('p.querySelector("[role=status]").textContent')));
    const idle0 = await shot();
    check('the picture is not blank', idle0.some((v, i) => i % 4 < 3 && v > 90));
    if (outDir) writeFileSync(join(outDir, 'rig-idle.png'), await page.screenshot());

    await select('Animation', 'wave');
    await P('(() => { p.rig.preview.paused = true; return 1; })()');
    const t0 = await shot();
    await P('(() => { p.rig.preview.seek(0.3); return 1; })()');
    const t1 = await shot();
    check('scrubbing to a moment of "wave" moves the arm', diff(t0, t1) > 0.4, diff(t0, t1).toFixed(2));
    if (outDir) writeFileSync(join(outDir, 'rig-wave.png'), await page.screenshot());
    const frozenA = await shot(0.2), frozenB = await shot(0.2);
    check('paused, time does not move the picture', diff(frozenA, frozenB) < 0.01);
    await P('(() => { p.rig.preview.paused = false; return 1; })()');
    const moveA = await shot(0.05), moveB = await shot(0.4);
    check('playing, time moves it', diff(moveA, moveB) > 0.2, diff(moveA, moveB).toFixed(2));
    await P('(() => { const r = p.rig.preview; r.play("wave"); r.frame(0.35); return 1; })()');
    check('the "clap" event fires at 0.3 s', (await P('p.rig.preview.events.includes("clap")')) === true);

    await P('(() => { const c = [...p.querySelectorAll("input[type=checkbox]")].find((x) => x.parentElement.textContent.includes("Show the bones")); c.checked = true; c.dispatchEvent(new Event("change")); return 1; })()');
    await sleep(200);
    check('the bones are drawn over it', await P('(() => { const o = p.querySelectorAll("canvas")[1]; const d = o.getContext("2d").getImageData(0, 0, o.width, o.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++; return n > 40; })()'));

    await S('(s.project.write("rigs/broken.json", "{\\"bones\\": [{\\"name\\": \\"a\\", \\"parent\\": \\"ghost\\"}]}"), s.emit("files"), 1)');
    await select('The rig', 'rigs/broken.json');
    check('a broken rig is explained, not drawn', await page.waitFor('/ghost|parent|bone/i.test(document.querySelector("[aria-label=\\"Rig\\"] [role=status]").textContent)', 4000));

    const errs = page.errors.filter((e) => !/willReadFrequently|favicon/.test(e));
    check('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
  }, { width: 1500, height: 1000 });
} finally { server.close(); }
process.exit(failed ? 1 : 0);
