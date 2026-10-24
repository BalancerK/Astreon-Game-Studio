// Live check, in a real Chrome with a real mouse, of the States panel: make a hero machine, see it drawn, try it live with numbers and events, drag a state, change an arrow,
// add a state, and run a game that follows the machine. Usage: node tools/studio-states-test.js [outDir]
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createStaticServer } from './static-server.js';
import { withChromePage } from './cdp.js';
import { SPRITES } from '../studio/app/pack/sprites.js';
import { serializeSprite } from '../studio/app/paint/sprite-model.js';

const outDir = process.argv[2] ?? null;
if (outDir) mkdirSync(outDir, { recursive: true });
const root = decodeURIComponent(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const server = createStaticServer({ root, allowDirs: ['studio', 'packages'], index: '/studio/index.html' });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
let failed = false;
const check = (name, ok, detail = '') => { if (!ok) failed = true; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `  (${detail})` : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const heroFile = serializeSprite(SPRITES.find((x) => x.name === 'hero').make());
const PARSE = 'JSON.parse(window.studio.project.readText("src/states.js").replace(/^[\\s\\S]*?export default /, "").replace(/;\\s*$/, ""))';

try {
  await withChromePage(`http://localhost:${port}/studio/index.html`, async (page) => {
    const S = (expr) => page.eval(`(() => { const s = window.studio; return ${expr}; })()`);
    const P = (expr) => page.eval(`(() => { const p = document.querySelector('[aria-label="State machines"]'); return p ? (${expr}) : null; })()`);
    const waitFor = (expr, ms = 8000) => page.waitFor(expr, ms);
    const press = async (code) => { await page.key(code, 'down'); await page.key(code, 'up'); };
    const file = () => S('s.project.has("src/states.js") ? s.project.readText("src/states.js") : ""');
    const click = (label) => P(`(() => { const b = [...p.querySelectorAll("button")].find((x) => x.textContent === ${JSON.stringify(label)}); if (!b) return false; b.click(); return true; })()`);
    const answer = async (value) => {
      await waitFor('!!document.querySelector(".dialog input[type=text]")', 3000);
      await page.eval('(() => { const i = document.querySelector(".dialog input[type=text]"); i.focus(); i.select(); return 1; })()');
      await page.type(value);
      await press('Enter');
      await waitFor('!document.querySelector(".dialog input[type=text]")', 3000);
    };
    const now = () => P('p.querySelector(".state-now").textContent');
    const center = (name) => P(`(() => { const r = p.querySelector('[data-state="${name}"] rect').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`);
    const setField = (label, value) => P(`(() => { const i = p.querySelector('input[aria-label="${label}"]'); i.value = ${JSON.stringify(value)}; i.dispatchEvent(new Event('change')); return 1; })()`);

    check('the studio opens', await waitFor('!!window.studio && !!document.getElementById("dock")', 20_000));
    await S('(s.createProject({ name: "States test", template: "blank" }), 1)');
    await waitFor('window.studio.project?.name === "States test"', 10_000);
    await S(`(s.project.write("src/art/hero.js", ${JSON.stringify(heroFile)}), s.emit("files"), 1)`);
    await S('(s.dock.show("states"), 1)');
    check('the States panel offers to make a hero machine', await waitFor('!!document.querySelector("[aria-label=\\"State machines\\"]")', 5000)
      && (await P('p.textContent.includes("No states yet")')));
    await click('Make a hero machine');
    await answer('hero');
    check('the machine is saved in src/states.js', await waitFor('window.studio.project.has("src/states.js")', 3000) && /"initial":"idle"/.test(await file()));
    check('the graph draws three states and five arrows', (await P('p.querySelectorAll("[data-state]").length')) === 3 && (await P('p.querySelectorAll("[data-edge]").length')) === 5);
    check('the first state is marked, and it is the live one', await P('(() => { const c = p.querySelector(\'[data-state="idle"]\').classList; return c.contains("first") && c.contains("live"); })()'));
    check('nothing is flagged for the starter machine', await P('p.querySelector(".text-issues")?.hidden === true'));
    if (outDir) writeFileSync(join(outDir, 'states-panel.png'), await page.screenshot());
    await sleep(400);
    check('the try-it view starts in idle', /^idle/.test(await now()));
    await setField('Try vx', '3');
    check('setting vx to 3 moves the thing to walk and plays the walk animation', await waitFor('/^walk/.test(document.querySelector("[aria-label=\\"State machines\\"] .state-now").textContent)', 3000)
      && /plays "walk"/.test(await now()));
    check('the live state is lit in the graph', await P('p.querySelector(\'[data-state="walk"]\').classList.contains("live")'));
    await click('hit');
    check('sending the hit event moves it to hurt', await waitFor('/^hurt/.test(document.querySelector("[aria-label=\\"State machines\\"] .state-now").textContent)', 3000));
    check('after half a second it recovers by itself (to walk, as vx is still 3)', await waitFor('/^walk/.test(document.querySelector("[aria-label=\\"State machines\\"] .state-now").textContent)', 4000));
    // a real mouse drag of a state
    const before = await center('hurt');
    await page.mouse('mousePressed', before[0], before[1]);
    await page.mouse('mouseMoved', before[0] + 30, before[1] + 15, { buttons: 1 });
    await page.mouse('mouseMoved', before[0] + 60, before[1] + 30, { buttons: 1 });
    await page.mouse('mouseReleased', before[0] + 60, before[1] + 30);
    const after = await center('hurt');
    check('dragging a state with the mouse moves it', Math.abs(after[0] - before[0] - 60) < 4 && Math.abs(after[1] - before[1] - 30) < 4, `${before} -> ${after}`);
    check('and the new place is saved', await waitFor(`${PARSE}.hero.layout.hurt[0] > 130`, 3000));
    check('the dragged state is the picked one, and its arrows are listed', await P('p.querySelector(".state-inspector").textContent.includes("after")'));
    await setField('Seconds', '2');
    check('changing the seconds is saved', await waitFor('/"after":2/.test(window.studio.project.readText("src/states.js"))', 3000));
    await click('Add an arrow');
    check('Add an arrow adds a second arrow to the state', await waitFor(`${PARSE}.hero.states.hurt.transitions.length === 2`, 3000));
    await click('Add a state');
    await answer('jump');
    check('a new state appears and the checker says nothing leads to it', await waitFor('!!document.querySelector("[aria-label=\\"State machines\\"] [data-state=jump]")', 3000)
      && /thing/.test(await P('p.querySelector(".text-issues summary").textContent')) && /Nothing leads to "jump"/.test(await P('p.querySelector(".text-issues").textContent')));
    await click('Remove');
    check('removing it takes it away again', await waitFor('!document.querySelector("[aria-label=\\"State machines\\"] [data-state=jump]")', 3000));
    // a game that follows the machine
    const game = [
      "import { newGame, clear, label, stepState } from '@engine/arcade';",
      "import states from './states.js';",
      'export function create() { return newGame({ pl: { vx: 0 }, n: 0 }); }',
      "export function update(game) {",
      '  game.n++;',
      '  game.pl.vx = game.n > 10 && game.n < 60 ? 2 : 0;',
      "  stepState(game.pl, states.hero, 1 / 60, game.n === 30 ? ['hit'] : []);",
      '  if (game.n === 31) game.after = game.pl.state;',
      '}',
      "export function render(game, g) { clear(g); label(g, game.pl.state ?? '', 12, 24); }",
      'export function summary(game) { return { n: game.n, state: game.pl.state, after: game.after, anim: game.pl.anim }; }', '',
    ].join('\n');
    await S(`(s.project.write("src/main.js", ${JSON.stringify(game)}), s.run({ restart: true }), 1)`);
    check('a game that follows the machine runs, and the hit at tick 30 hurt the hero', await waitFor('window.studio.runner.status === "running" && (window.studio.runner.summary?.n ?? 0) > 70', 15_000)
      && (await S('JSON.stringify(s.runner.summary)')).includes('"after":"hurt"'), await S('JSON.stringify(s.runner.summary)'));
    check('no problems were reported for the game', (await S('s.diagnostics.size')) === 0);
    const errs = page.errors.filter((e) => !/willReadFrequently|favicon/.test(e));
    check('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
  }, { width: 1500, height: 900 });
} finally { server.close(); }
process.exit(failed ? 1 : 0);
