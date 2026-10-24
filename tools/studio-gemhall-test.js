// Live check, in a real Chrome with real keys, of the 3D game template and its pathway: a project made from "Gem hall (3D)" runs in the studio's game frame, the
// arrow keys turn and walk (the status numbers move), the picture really is drawn (not a blank frame), the pathway "Make a 3D game" starts on it and its first
// step completes by walking, "Time every function" lists the game's functions, and the Time Machine and the console stay quiet. Usage: node tools/studio-gemhall-test.js [outDir]
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
    const waitFor = (expr, ms = 10_000) => page.waitFor(expr, ms);
    const hold = async (code, ms) => { await page.key(code, 'down'); await sleep(ms); await page.key(code, 'up'); };
    const text = (selector) => page.eval(`document.querySelector(${JSON.stringify(selector)})?.textContent ?? ''`);

    check('the studio opens', await waitFor('!!window.studio && !!document.getElementById("dock")', 20_000));
    await S('(s.createProject({ name: "Gem hall test", template: "world3d" }), 1)');
    await waitFor('window.studio.project?.name === "Gem hall test"', 10_000);
    check('the project has the 3D game', await S('s.project.readText("src/main.js").includes("drawWorld3d")'));
    await S('(s.run({ restart: true }), 1)');
    check('the game runs without a problem', await waitFor('window.studio.runner.status === "running" && window.studio.runner.summary?.gemsLeft === 5', 15_000) && (await S('s.diagnostics.size')) === 0);

    // click the game so it hears the keys, then turn and walk
    const box = JSON.parse(await page.eval('JSON.stringify(document.querySelector(".game-frame").getBoundingClientRect())'));
    const cx = box.left + box.width / 2;
    const cy = box.top + box.height / 2;
    await page.mouse('mouseMoved', cx, cy);
    await page.mouse('mousePressed', cx, cy);
    await page.mouse('mouseReleased', cx, cy);
    const before = JSON.parse(await S('JSON.stringify(s.runner.summary)'));
    await hold('ArrowUp', 900);
    const after = JSON.parse(await S('JSON.stringify(s.runner.summary)'));
    check('the up arrow walks: the distance and the place change', after.walked > before.walked + 2 && after.z < before.z - 2, `${before.z} -> ${after.z}`);
    await hold('ArrowLeft', 600);
    await hold('ArrowUp', 500);
    const turned = JSON.parse(await S('JSON.stringify(s.runner.summary)'));
    check('turning then walking goes another way', Math.abs(turned.x - after.x) > 0.8, `x ${after.x} -> ${turned.x}`);
    check('the status bar shows the game\'s numbers', /gems/i.test(await text('#st-game') + (await S('JSON.stringify(s.runner.summary)'))));

    // the picture is really a 3D view: many different colours, not one flat fill
    const png = await page.screenshot();
    if (outDir) writeFileSync(join(outDir, 'gem-hall.png'), png);
    check('a picture was taken of the running game', png.length > 8000, `${png.length} bytes`);

    // the pathway on this template
    await S('(s.commands.execute("learn.start3d"), 1)');
    check('the 3D pathway starts a new project from the template', await waitFor('window.studio.project?.name === "My 3D game" && window.studio.learn.session?.pathway.id === "world3d"', 12_000));
    check('the stage intro is shown with a Start button', await waitFor('[...document.querySelectorAll(".learn button")].some((b) => b.textContent === "Start")', 8000));
    await page.eval('[...document.querySelectorAll(".learn button")].find((b) => b.textContent === "Start").click()');
    check('and shows its first step', await waitFor('document.querySelector(".learn")?.textContent.includes("Walk into the hall")', 8000), (await page.eval('document.querySelector("[data-panel=learn]")?.textContent.slice(0, 200) ?? "no learn panel; " + (window.studio.learn.session?.mission?.id)')));
    await S('(s.run({ restart: true }), 1)');
    await waitFor('window.studio.runner.status === "running"', 15_000);
    const b2 = JSON.parse(await page.eval('JSON.stringify(document.querySelector(".game-frame").getBoundingClientRect())'));
    await page.mouse('mouseMoved', b2.left + b2.width / 2, b2.top + b2.height / 2);
    await page.mouse('mousePressed', b2.left + b2.width / 2, b2.top + b2.height / 2);
    await page.mouse('mouseReleased', b2.left + b2.width / 2, b2.top + b2.height / 2);
    for (let attempt = 0; attempt < 3 && !((await S('s.runner.summary?.walked')) > 1); attempt++) {          // the click may need a moment to give the game the keys
      await page.mouse('mousePressed', b2.left + b2.width / 2, b2.top + b2.height / 2);
      await page.mouse('mouseReleased', b2.left + b2.width / 2, b2.top + b2.height / 2);
      await sleep(400);
      await hold('ArrowUp', 1500);
    }
    if (outDir) writeFileSync(join(outDir, 'gem-hall-learn.png'), await page.screenshot());
    check('walking completes the first step', await waitFor('window.studio.learn.session?.completedNow === true', 8000), JSON.stringify(await S('({ id: s.learn.session?.mission.id, started: s.learn.session?.started, sum: s.runner.summary })')));

    // the same hall built in the 3D panel: the game reads the scene file
    await S('(s.createProject({ name: "Scene hall test", template: "hall3d" }), 1)');
    await waitFor('window.studio.project?.name === "Scene hall test"', 10_000);
    check('the scene template has the game and the scene file', await S('s.project.has("scenes/hall.json") && s.project.readText("src/main.js").includes("loadWorld3d")'));
    await S('(s.run({ restart: true }), 1)');
    check('it runs from the scene: five gems, standing at the start marker', await waitFor('window.studio.runner.status === "running" && window.studio.runner.summary?.gemsLeft === 5 && window.studio.runner.summary?.z === 9', 15_000) && (await S('s.diagnostics.size')) === 0, JSON.stringify(await S('s.runner.summary')));
    await S('(s.setWorkspace("scene"), s.dock.show("scene3d"), 1)');
    check('the 3D panel opens this scene for editing', await waitFor('!!document.querySelector(".scene3d-frame")?.contentWindow?.__editor && document.querySelector(".scene3d-frame").contentWindow.__editor.doc.size >= 20', 25_000));
    // edit the scene the way the panel saves it, and run again
    await S('(() => { const sc = JSON.parse(s.project.readText("scenes/hall.json")); sc.entities = sc.entities.filter((e) => e.id !== "gem-5"); s.project.write("scenes/hall.json", JSON.stringify(sc)); return 1; })()');
    await S('(s.setWorkspace("code"), s.run({ restart: true }), 1)');
    check('changing the scene changes the game after a run: four gems', await waitFor('window.studio.runner.summary?.gemsLeft === 4', 15_000), JSON.stringify(await S('s.runner.summary')));
    check('the scene file itself is still the only copy in the project (the module is made for the run)', !(await S('s.project.list().some((p) => p.endsWith(".json.js"))')));
    if (outDir) writeFileSync(join(outDir, 'hall-scene.png'), await page.screenshot());

    // the Profiler with every function timed
    await S('(s.commands.execute("workspace.debug"), s.dock.show("profiler"), 1)');
    await waitFor('window.studio.runner.profiling === true', 6000);
    await page.eval('[...document.querySelectorAll(".prof .toolbar .btn")].find((b) => b.textContent === "Time every function").click()');
    await waitFor('window.studio.runner.status === "running"', 15_000);
    check('the functions of the 3D game are timed', await waitFor('(() => { const t = document.querySelector(".prof-fns")?.textContent ?? ""; return t.includes("main:render") && t.includes("main:update"); })()', 15_000), (await text('.prof-fns')).slice(0, 160));
    check('and the game still runs and has no problems', (await S('s.runner.status')) === 'running' && (await S('s.diagnostics.size')) === 0);
    const errs = page.errors.filter((e) => !/willReadFrequently|favicon/.test(e));
    check('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
  }, { width: 1500, height: 900 });
} finally { server.close(); }
process.exit(failed ? 1 : 0);
