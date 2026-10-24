// Live check, in a real Chrome with a real mouse, of the UI panel: make a menu, drag a button, resize it by its corner, change what it is pinned to, nudge it with the arrow
// keys, add and remove widgets, make a HUD and try test values, and run a game that draws the screens and finds which button a point is on.
// Usage: node tools/studio-ui-test.js [outDir]
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createStaticServer } from './static-server.js';
import { withChromePage } from './cdp.js';
import { placeOf } from '../packages/arcade/src/ui.js';

const outDir = process.argv[2] ?? null;
if (outDir) mkdirSync(outDir, { recursive: true });
const root = decodeURIComponent(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const server = createStaticServer({ root, allowDirs: ['studio', 'packages'], index: '/studio/index.html' });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
let failed = false;
const check = (name, ok, detail = '') => { if (!ok) failed = true; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `  (${detail})` : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PARSE = 'JSON.parse(window.studio.project.readText("src/ui.js").replace(/^[\\s\\S]*?export default /, "").replace(/;\\s*$/, ""))';
const SIZE = { width: 480, height: 320 };

try {
  await withChromePage(`http://localhost:${port}/studio/index.html`, async (page) => {
    const S = (expr) => page.eval(`(() => { const s = window.studio; return ${expr}; })()`);
    const P = (expr) => page.eval(`(() => { const p = document.querySelector('[aria-label="UI screens"]'); return p ? (${expr}) : null; })()`);
    const waitFor = (expr, ms = 8000) => page.waitFor(expr, ms);
    const press = async (code) => { await page.key(code, 'down'); await page.key(code, 'up'); };
    const answer = async (value) => {
      await waitFor('!!document.querySelector(".dialog input[type=text]")', 3000);
      await page.eval('(() => { const i = document.querySelector(".dialog input[type=text]"); i.focus(); i.select(); return 1; })()');
      await page.type(value);
      await press('Enter');
      await waitFor('!document.querySelector(".dialog input[type=text]")', 3000);
    };
    const choose = (label, value) => P(`(() => { const s = p.querySelector('select[aria-label="${label}"]'); s.value = ${JSON.stringify(value)}; s.dispatchEvent(new Event('change')); return 1; })()`);
    const widgetOf = (id) => S(`JSON.stringify(${PARSE}.menu.widgets.find((w) => w.id === ${JSON.stringify(id)}))`).then((t) => (t ? JSON.parse(t) : null));
    /** Where a place on the screen is on the monitor. */
    const onScreen = (x, y) => P(`(() => { const r = p.querySelector("canvas").getBoundingClientRect(); return [r.x + x * r.width / 480, r.y + y * r.height / 320]; })()`.replace('x *', `${x} *`).replace('y *', `${y} *`));
    const lit = () => P('(() => { const c = p.querySelector("canvas"); return c.toDataURL().length; })()');
    /** Press at one place on the screen and drag to another. The picture can shift on the monitor when something is picked, so the target is worked out after the press. */
    const drag = async (from, to) => {
      const start = await onScreen(...from);
      await page.mouse('mousePressed', start[0], start[1]);
      await sleep(80);
      const mid = await onScreen((from[0] + to[0]) / 2, (from[1] + to[1]) / 2);
      await page.mouse('mouseMoved', mid[0], mid[1], { buttons: 1 });
      const end = await onScreen(...to);
      await page.mouse('mouseMoved', end[0], end[1], { buttons: 1 });
      await page.mouse('mouseReleased', end[0], end[1]);
      await sleep(450);
    };

    check('the studio opens', await waitFor('!!window.studio && !!document.getElementById("dock")', 20_000));
    await S('(s.createProject({ name: "UI test", template: "blank" }), 1)');
    await waitFor('window.studio.project?.name === "UI test"', 10_000);
    await S('(s.dock.show("ui"), 1)');
    check('the UI panel offers to make a menu', await waitFor('!!document.querySelector("[aria-label=\\"UI screens\\"]")', 5000) && (await P('p.textContent.includes("No screens yet")')));
    await P('(() => { [...p.querySelectorAll("button")].find((b) => b.textContent === "Make a menu").click(); return 1; })()');
    await answer('menu');
    check('the menu is saved with a title and three buttons', await waitFor('window.studio.project.has("src/ui.js")', 3000) && (await S(`${PARSE}.menu.widgets.length`)) === 4);
    check('the picture is the kit\'s own drawing: it has size and content', (await P('p.querySelector("canvas").width')) === 480 && (await lit()) > 2000);
    if (outDir) writeFileSync(join(outDir, 'ui-panel.png'), await page.screenshot());
    // pick and drag a button
    const play = await widgetOf('play');
    const box = placeOf(play, SIZE);
    await drag([box.x + box.w / 2, box.y + box.h / 2], [box.x + box.w / 2 + 40, box.y + box.h / 2 + 20]);
    const moved = await widgetOf('play');
    const after = placeOf(moved, SIZE);
    check('dragging a button with the mouse moves it (to the grid of 4), pinned as before', Math.abs(after.x - box.x - 40) <= 4 && Math.abs(after.y - box.y - 20) <= 4 && moved.anchor === 'center', `${box.x},${box.y} -> ${after.x},${after.y}`);
    check('the picked widget shows in the inspector', await P('p.querySelector(".ui-inspector").textContent.includes("play")') && (await P('p.querySelectorAll(".ui-item.on").length')) === 1);
    // resize by the corner
    await drag([after.x + after.w, after.y + after.h], [after.x + after.w + 30, after.y + after.h + 10]);
    const sized = await widgetOf('play');
    check('dragging the corner square resizes it', Math.abs(sized.w - after.w - 30) <= 4 && Math.abs(sized.h - after.h - 10) <= 4 && Math.abs(placeOf(sized, SIZE).x - after.x) <= 1, `${after.w}x${after.h} -> ${sized.w}x${sized.h}`);
    // arrow keys
    await P('(() => { p.querySelector("canvas").focus(); return 1; })()');
    const b0 = placeOf(await widgetOf('play'), SIZE);
    await press('ArrowRight');
    await press('ArrowRight');
    await sleep(450);
    check('the arrow keys nudge the picked widget one pixel at a time', placeOf(await widgetOf('play'), SIZE).x === b0.x + 2);
    // anchor
    const a0 = placeOf(await widgetOf('play'), SIZE);
    await choose('Pinned to', 'bottom-right');
    await sleep(450);
    const a1 = await widgetOf('play');
    const a1box = placeOf(a1, SIZE);
    check('changing what it is pinned to does not make it jump', a1.anchor === 'bottom-right' && Math.abs(a1box.x - a0.x) <= 1 && Math.abs(a1box.y - a0.y) <= 1);
    // words
    await P('(() => { const i = p.querySelector(\'input[aria-label="Words"]\'); i.value = "Start!"; i.dispatchEvent(new Event("change")); return 1; })()');
    check('changing the words is saved', await waitFor(`${PARSE}.menu.widgets.find((w) => w.id === "play").text === "Start!"`, 3000));
    // add and remove
    await choose('Add a widget', 'bar');
    check('Add puts a new widget in the middle, picked, with its own id', await waitFor(`${PARSE}.menu.widgets.length === 5 && ${PARSE}.menu.widgets[4].id === "bar"`, 3000)
      && (await P('p.querySelector(".ui-item.on")?.textContent.includes("bar")')));
    await P('(() => { p.querySelector("canvas").focus(); return 1; })()');
    await press('Delete');
    check('the Delete key removes the picked widget', await waitFor(`${PARSE}.menu.widgets.length === 4`, 3000));
    // problems
    await choose('Add a widget', 'button');
    await sleep(450);
    check('a new button has no id problem, but a second one with the same id is flagged when the id is copied', await P('p.querySelector(".text-issues")?.hidden === true'));
    await P('(() => { const i = p.querySelector(\'input[aria-label="Name (id)"]\'); i.value = "quit"; i.dispatchEvent(new Event("change")); return 1; })()');
    check('two widgets with one id are flagged', await waitFor('/called "quit"/.test(document.querySelector("[aria-label=\\"UI screens\\"] .text-issues")?.textContent ?? "")', 3000));
    await P('(() => { const i = p.querySelector(\'input[aria-label="Name (id)"]\'); i.value = "extra"; i.dispatchEvent(new Event("change")); return 1; })()');
    // a HUD with test values
    await choose('Start a new screen from', 'hud');
    await answer('hud');
    check('a HUD screen is made and shows test values for score, hp and lives', await waitFor(`!!${PARSE}.hud`, 3000)
      && (await P('p.querySelectorAll("input[aria-label^=\\"Test value\\"]").length')) === 3);
    const before = await lit();
    await P('(() => { const i = p.querySelector(\'input[aria-label="Test value of hp"]\'); i.value = "1"; i.dispatchEvent(new Event("change")); return 1; })()');
    await sleep(150);
    check('a test value changes the picture (the health bar nearly empty)', (await lit()) !== before);
    // a game that draws the screens and finds the button under a point
    const game = [
      "import { newGame, clear, drawUi, uiHit, uiNext } from '@engine/arcade';",
      "import ui from './ui.js';",
      'export function create() { return newGame({ n: 0, score: 40, hp: 6, lives: 3, focus: null }); }',
      'export function update(game) { game.n++; if (game.n === 5) game.focus = uiNext(ui.menu, game.focus, 1, game); if (game.n === 6) game.focus = uiNext(ui.menu, game.focus, 1, game); }',
      'export function render(game, g) { clear(g); drawUi(g, ui.hud, game); drawUi(g, ui.menu, game, { focus: game.focus }); }',
      "export function summary(game) { return { n: game.n, focus: game.focus, hit: uiHit(ui.menu, 240, 200, game), none: uiHit(ui.menu, 2, 2, game) }; }", '',
    ].join('\n');
    await S(`(s.project.write("src/main.js", ${JSON.stringify(game)}), s.run({ restart: true }), 1)`);
    check('a game that draws the screens runs, keyboard focus moves, and a point finds its button', await waitFor('window.studio.runner.status === "running" && (window.studio.runner.summary?.n ?? 0) > 20', 15_000)
      && (await S('s.runner.summary.focus')) !== null && (await S('s.runner.summary.none')) === null && typeof (await S('s.runner.summary.hit')) === 'string', await S('JSON.stringify(s.runner.summary)'));
    check('no problems were reported for the game', (await S('s.diagnostics.size')) === 0);
    const errs = page.errors.filter((e) => !/willReadFrequently|favicon/.test(e));
    check('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
  }, { width: 1500, height: 900 });
} finally { server.close(); }
process.exit(failed ? 1 : 0);
