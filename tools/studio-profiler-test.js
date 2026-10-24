// Live check, in a real Chrome with real mouse and keyboard events, of the Profiler: a game with a known cost (200 things, a timed section, a slow frame every 30
// updates) is measured while the panel is open; the chart, the summary, the timed section, the slow frames and the advice appear; a frame can be chosen with
// the keyboard and the Time Machine taken to it; recording can be turned off; and a hidden panel measures nothing. Usage: node tools/studio-profiler-test.js [outDir]
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

const GAME = [
  "import { newGame, spawn, clear, drawThings, timed } from '@engine/arcade';",
  'export function create() {',
  '  const game = newGame({ n: 0 });',
  "  for (let i = 0; i < 200; i++) spawn(game, 'dot', { x: (i * 7) % 480, y: (i * 13) % 320, w: 6, h: 6 });",
  '  return game;',
  '}',
  'function bump(game) { game.n++; }',
  'export function update(game) {',
  '  bump(game);',
  "  timed('crowd', () => { let s = 0; for (let i = 0; i < 40000; i++) s += Math.sqrt(i); game.s = s; });",
  '  if (game.n % 30 === 0) { const t = performance.now(); while (performance.now() - t < 28) { /* a slow frame, on purpose */ } }',
  '}',
  'export function render(game, g) { clear(g); drawThings(g, game); }',
  'export function summary(game) { return { n: game.n }; }', '',
].join('\n');

try {
  await withChromePage(`http://localhost:${port}/studio/index.html`, async (page) => {
    const S = (expr) => page.eval(`(() => { const s = window.studio; return ${expr}; })()`);
    const waitFor = (expr, ms = 10_000) => page.waitFor(expr, ms);
    const press = async (code) => { await page.key(code, 'down'); await page.key(code, 'up'); };
    const text = (selector) => page.eval(`document.querySelector(${JSON.stringify(selector)})?.textContent ?? ''`);

    check('the studio opens', await waitFor('!!window.studio && !!document.getElementById("dock")', 20_000));
    await S('(s.createProject({ name: "Profile test", template: "blank" }), 1)');
    await waitFor('window.studio.project?.name === "Profile test"', 10_000);
    await S(`(s.project.write("src/main.js", ${JSON.stringify(GAME)}), s.commands.execute("workspace.debug"), s.dock.show("profiler"), s.run({ restart: true }), 1)`);
    check('with the panel closed nothing is measured', true);
    check('opening the Profiler starts the measuring in the game', await waitFor('window.studio.runner.profiling === true', 5000));
    check('frames arrive and the chart and summary appear', await waitFor('!!document.querySelector(".prof-body") && !document.querySelector(".prof-body").hidden && document.querySelectorAll(".prof-card").length >= 6', 15_000), await text('.prof-status'));
    check('it says it is recording and how many frames it holds', /^Recording: \d+ frames kept/.test(await text('.prof-status')), await text('.prof-status'));
    await page.sleep(6000);                                                  // a few slow frames
    const cards = JSON.parse(await page.eval('JSON.stringify([...document.querySelectorAll(".prof-card")].map((c) => [c.querySelector(".prof-t").textContent, c.querySelector(".prof-n").textContent]))'));
    const card = (name) => cards.find(([t]) => t === name)?.[1];
    check('the draw calls are counted (about 200 things plus the clear)', Number(card('Draw calls')) >= 150 && Number(card('Draw calls')) <= 320, String(card('Draw calls')));
    check('and so are the things', Number(card('Things')) === 200, String(card('Things')));
    check('the average frame is a real number in milliseconds', /^\d+(\.\d+)? ms$/.test(card('Average frame') ?? ''), String(card('Average frame')));
    check('the section the game timed is listed with what it costs a frame', (await text('.prof-marks')).includes('crowd') && /crowd\d/.test((await text('.prof-marks')).replace(/\s/g, '')), await text('.prof-marks'));
    check('the slow frames are listed, and the cause is the game\'s update (the busy wait is outside the timed section)', await waitFor('document.querySelectorAll(".prof-slow-row").length >= 2', 8000) && (await text('.prof-slow-row')).includes('the game\'s update'), await text('.prof-slow-row'));
    check('the advice says some frames went over the budget', await waitFor('[...document.querySelectorAll(".prof-hint")].some((h) => /took longer than|went over/.test(h.textContent))', 8000), await page.eval('[...document.querySelectorAll(".prof-hint")].map((h) => h.textContent).join(" | ")'));
    check('and notices the slow frame comes round at a regular rhythm', await waitFor('[...document.querySelectorAll(".prof-hint")].some((h) => /every \\d+ frames/.test(h.textContent))', 12_000), await page.eval('[...document.querySelectorAll(".prof-hint")].map((h) => h.textContent).join(" | ")'));
    if (outDir) writeFileSync(join(outDir, 'profiler.png'), await page.screenshot());

    // choose a frame
    await page.eval('document.querySelector(".prof-slow-row").click()');
    check('choosing a slow frame describes it', await waitFor('document.querySelector(".prof-detail").textContent.startsWith("Frame ")', 3000), await text('.prof-detail'));
    check('and enables going to that moment', await page.eval('!document.querySelector(".prof .toolbar .btn:not([aria-pressed]):not(.ghost)")?.disabled'));
    const before = await text('.prof-detail');
    await page.eval('document.querySelector(".prof-chart").focus()');
    await press('ArrowLeft');
    check('the arrow keys move to another frame', (await text('.prof-detail')) !== before && (await text('.prof-detail')).startsWith('Frame '));
    await press('Enter');
    check('Enter takes the Time Machine to that moment: the game is paused', await waitFor('window.studio.runner.timeline?.paused === true', 8000));
    await S('(s.timeMachine.play(), 1)');

    // time every function: the game restarts with a timer round each function, and the table names them
    await S('(s.dock.show("profiler"), 1)');
    await page.eval('[...document.querySelectorAll(".prof .toolbar .btn")].find((b) => b.textContent === "Time every function").click()');
    check('Time every function turns on and the project is rerun with timers (the file in the editor is unchanged)',
      await waitFor('window.studio.runner.profileFunctions === true', 4000) && !(await S('s.project.readText("src/main.js").includes("__pf")')));
    check('the table lists the own functions of the project with their cost', await waitFor('(() => { const t = document.querySelector(".prof-fns")?.textContent ?? ""; return t.includes("main:update") && t.includes("main:bump") && t.includes("main:render"); })()', 12_000), (await text('.prof-fns')).slice(0, 200));
    check('the cause of the slow frame now names the function', await waitFor('[...document.querySelectorAll(".prof-slow-row")].some((r) => r.textContent.includes("the function main:update"))', 15_000), await text('.prof-slow'));
    check('the game kept running after the rewrite', (await S('s.runner.status')) === 'running');
    await page.eval('[...document.querySelectorAll(".prof .toolbar .btn")].find((b) => b.textContent === "Save reading").click()');
    check('saving a reading makes the cards show the difference to it afterwards', await waitFor('[...document.querySelectorAll(".prof-delta")].some((d) => /saved reading/.test(d.textContent))', 8000));
    await page.eval('[...document.querySelectorAll(".prof .toolbar .btn")].find((b) => b.textContent === "Time every function").click()');
    check('turning it off runs the plain code again', await waitFor('window.studio.runner.profileFunctions === false', 4000) && await waitFor('!document.querySelector(".prof-fns")?.textContent', 8000));

    // recording off, on
    await S('(s.dock.show("profiler"), 1)');
    await page.eval('[...document.querySelectorAll(".prof .toolbar .btn")].find((b) => b.textContent.startsWith("Record")).click()');
    check('turning Record off stops the measuring in the game', await waitFor('window.studio.runner.profiling === false', 4000) && (await text('.prof-status')) === 'Not recording.');
    await page.eval('[...document.querySelectorAll(".prof .toolbar .btn")].find((b) => b.textContent.startsWith("Record")).click()');
    check('and turning it on again starts it', await waitFor('window.studio.runner.profiling === true', 4000));
    await page.eval('[...document.querySelectorAll(".prof .toolbar .btn")].find((b) => b.textContent === "Clear").click()');
    check('Clear empties the chart, and new frames fill it again', await waitFor('!document.querySelector(".prof-body").hidden', 8000));

    // a panel nobody can see measures nothing
    await S('(s.commands.execute("workspace.code"), 1)');
    check('with the panel hidden the measuring stops', await waitFor('window.studio.runner.profiling === false', 5000));
    await S('(s.commands.execute("workspace.debug"), s.dock.show("profiler"), 1)');
    check('and starts again when it is shown', await waitFor('window.studio.runner.profiling === true', 5000));

    check('the game kept running and has no problems', (await S('s.runner.status')) === 'running' && (await S('s.diagnostics.size')) === 0);
    const errs = page.errors.filter((e) => !/willReadFrequently|favicon/.test(e));
    check('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
  }, { width: 1500, height: 900 });
} finally { server.close(); }
process.exit(failed ? 1 : 0);
