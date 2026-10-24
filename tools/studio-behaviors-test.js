// Live check, in a real Chrome with a real mouse, of the Behaviours panel: make an enemy, see its behaviours as cards, watch it in the arena, click to add one, change a
// slider, add and remove behaviours, make a coin, and run a game that uses the table. Usage: node tools/studio-behaviors-test.js [outDir]
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
const PARSE = 'JSON.parse(window.studio.project.readText("src/behaviors.js").replace(/^[\\s\\S]*?export default /, "").replace(/;\\s*$/, ""))';

try {
  await withChromePage(`http://localhost:${port}/studio/index.html`, async (page) => {
    const S = (expr) => page.eval(`(() => { const s = window.studio; return ${expr}; })()`);
    const P = (expr) => page.eval(`(() => { const p = document.querySelector('[aria-label="Behaviours"]'); return p ? (${expr}) : null; })()`);
    const waitFor = (expr, ms = 8000) => page.waitFor(expr, ms);
    const press = async (code) => { await page.key(code, 'down'); await page.key(code, 'up'); };
    const click = (label) => P(`(() => { const b = [...p.querySelectorAll("button")].find((x) => x.textContent === ${JSON.stringify(label)}); if (!b) return false; b.click(); return true; })()`);
    const answer = async (value) => {
      await waitFor('!!document.querySelector(".dialog input[type=text]")', 3000);
      await page.eval('(() => { const i = document.querySelector(".dialog input[type=text]"); i.focus(); i.select(); return 1; })()');
      await page.type(value);
      await press('Enter');
      await waitFor('!document.querySelector(".dialog input[type=text]")', 3000);
    };
    const choose = (label, value) => P(`(() => { const s = p.querySelector('select[aria-label="${label}"]'); s.value = ${JSON.stringify(value)}; s.dispatchEvent(new Event('change')); return 1; })()`);
    const pixels = () => P('(() => { const c = p.querySelector("canvas"); return c.toDataURL().length; })()');
    const lit = () => P('(() => { const c = p.querySelector("canvas"); const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 60 || d[i + 1] > 60 || d[i + 2] > 80) n++; return n; })()');
    const arenaBox = () => P('(() => { const r = p.querySelector("canvas").getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; })()');

    check('the studio opens', await waitFor('!!window.studio && !!document.getElementById("dock")', 20_000));
    await S('(s.createProject({ name: "Behaviours test", template: "blank" }), 1)');
    await waitFor('window.studio.project?.name === "Behaviours test"', 10_000);
    await S('(s.dock.show("behaviors"), 1)');
    check('the Behaviours panel offers to make an enemy', await waitFor('!!document.querySelector("[aria-label=\\"Behaviours\\"]")', 5000) && (await P('p.textContent.includes("No behaviours yet")')));
    await click('Make an enemy');
    await answer('enemy');
    check('the enemy is saved with its four behaviours', await waitFor('window.studio.project.has("src/behaviors.js")', 3000) && (await S(`${PARSE}.enemy.length`)) === 4);
    check('each behaviour is a card with its words', (await P('p.querySelectorAll(".behavior-card").length')) === 4
      && (await P('p.textContent.includes("Pace back and forth") && p.textContent.includes("Hurt on touch")')));
    check('the summary says what the kind does', await P('p.textContent.includes("enemy: pace back and forth, follow something")'));
    if (outDir) writeFileSync(join(outDir, 'behaviors-panel.png'), await page.screenshot());
    // the arena
    const a = await pixels();
    await sleep(500);
    check('the arena is alive: the picture changes as the enemies move', (await pixels()) !== a && (await lit()) > 400);
    const box = await arenaBox();
    const before = await lit();
    await page.mouse('mouseMoved', box[0] + box[2] * 0.5, box[1] + box[3] * 0.75);
    await page.mouse('mousePressed', box[0] + box[2] * 0.5, box[1] + box[3] * 0.75);
    await page.mouse('mouseReleased', box[0] + box[2] * 0.5, box[1] + box[3] * 0.75);
    await sleep(150);
    check('a click adds one more enemy to the arena', (await lit()) > before + 200, `${before} -> ${await lit()}`);
    // settings
    await P('(() => { const i = p.querySelector(\'input[aria-label="Speed (Pace back and forth)"]\'); i.value = "200"; i.dispatchEvent(new Event("input")); return 1; })()');
    check('moving a slider is saved, kept within its range', await waitFor(`${PARSE}.enemy[0].speed === 200`, 3000));
    await P('(() => { const i = p.querySelector(\'input[aria-label="Hit points (Has health)"]\'); i.value = "9"; i.dispatchEvent(new Event("input")); return 1; })()');
    check('hit points are saved', await waitFor(`${PARSE}.enemy[2].hp === 9`, 3000));
    // add, move and remove behaviours
    await choose('Add a behaviour', 'shoot');
    check('Add a behaviour adds a Shoot card with its settings, saved', await waitFor(`${PARSE}.enemy.length === 5 && ${PARSE}.enemy[4].type === "shoot"`, 3000)
      && (await P('p.textContent.includes("Bullet speed")')));
    await choose('Aims', 'up');
    check('a choice is saved', await waitFor(`${PARSE}.enemy[4].aim === "up"`, 3000));
    await P('(() => { const b = [...p.querySelectorAll("button")].find((x) => x.getAttribute("aria-label") === "Run this earlier" && !x.disabled && x.closest(".behavior-card").textContent.includes("Shoot")); b.click(); return 1; })()');
    check('the up arrow moves a behaviour earlier', await waitFor(`${PARSE}.enemy[3].type === "shoot"`, 3000));
    await P('(() => { p.querySelector("button[aria-label=\\"Remove Shoot\\"]").click(); return 1; })()');
    check('the cross removes it', await waitFor(`${PARSE}.enemy.length === 4`, 3000));
    // another kind from a starter
    await choose('Start a new kind from', 'coin');
    await answer('coin');
    check('a coin kind is made and picked', await waitFor(`${PARSE}.coin?.[0]?.type === "collect"`, 3000) && (await P('p.querySelectorAll(".behavior-card").length')) === 1);
    await choose('Kind of thing', 'enemy');
    check('the kind picker goes back to the enemy', (await P('p.querySelectorAll(".behavior-card").length')) === 4);
    // a game that uses the table
    const game = [
      "import { newGame, spawn, clear, drawThings, label, behaviors, behave, all } from '@engine/arcade';",
      "import table from './behaviors.js';",
      "behaviors({ ...table, hero: [{ type: 'health', hp: 5, safeFor: 0.3 }] });",
      'export function create() {',
      "  const game = newGame({ n: 0 });",
      "  spawn(game, 'hero', { x: 100, y: 100, w: 20, h: 20, color: '#8b8bff' });",
      "  spawn(game, 'enemy', { x: 180, y: 100, w: 20, h: 20, color: '#e84a5f' });",
      "  spawn(game, 'coin', { x: 100, y: 100, w: 10, h: 10 });",
      '  return game;',
      '}',
      'export function update(game, keys, dt) { game.n++; behave(game, dt, keys); }',
      "export function render(game, g) { clear(g); drawThings(g, game, {}); label(g, 'score ' + (game.score ?? 0), 12, 24); }",
      "export function summary(game) { return { n: game.n, score: game.score ?? 0, hp: all(game, 'hero')[0]?.hp, coins: all(game, 'coin').length, enemyMoved: all(game, 'enemy')[0]?.x !== 180 }; }", '',
    ].join('\n');
    await S(`(s.project.write("src/main.js", ${JSON.stringify(game)}), s.run({ restart: true }), 1)`);
    check('a game that uses the table runs: the coin is collected, the enemy moves and hurts the hero',
      await waitFor('window.studio.runner.status === "running" && (window.studio.runner.summary?.n ?? 0) > 120', 15_000)
      && (await S('s.runner.summary.score')) === 1 && (await S('s.runner.summary.coins')) === 0 && (await S('s.runner.summary.enemyMoved')) && (await S('s.runner.summary.hp')) < 5,
    await S('JSON.stringify(s.runner.summary)'));
    check('no problems were reported for the game', (await S('s.diagnostics.size')) === 0);
    // finding the way round walls
    check('the list of behaviours offers "Go to" and "Keep away"', await P('(() => { const o = [...p.querySelectorAll("select")].flatMap((x) => [...x.options].map((y) => y.textContent)); return o.includes("Go to something, round walls") && o.includes("Keep away from something"); })()'));
    check('the New kind list has a hunter and a mouse', await P('(() => { const o = [...p.querySelectorAll("select")].flatMap((x) => [...x.options].map((y) => y.textContent)); return o.includes("hunter") && o.includes("mouse"); })()'));
    const maze = [
      "import { newGame, spawn, loadMap, clear, drawThings, behaviors, behave, all } from '@engine/arcade';",
      "behaviors({ hunter: [{ type: 'goTo', target: 'hero', speed: 140, stopAt: 6, solid: 'wall' }], mouse: [{ type: 'keepAway', from: 'hero', speed: 100, range: 150 }] });",
      "const LEVEL = ['##########', '#....#...#', '#....#...#', '#....#...#', '#........#', '##########'];",
      'export function create() {',
      '  const game = newGame({ n: 0, met: 0 });',
      "  loadMap(game, LEVEL, { '#': { kind: 'wall', color: '#2f3a55' } }, 32);",
      "  spawn(game, 'hero', { x: 240, y: 40, w: 20, h: 20, color: '#8b8bff' });",
      "  spawn(game, 'hunter', { x: 50, y: 40, w: 20, h: 20, color: '#e84a5f' });",
      "  spawn(game, 'mouse', { x: 200, y: 140, w: 20, h: 20, color: '#ffd23c' });",
      '  return game;',
      '}',
      'export function update(game, keys, dt) {',
      '  game.n++;',
      '  behave(game, dt, keys);',
      "  const h = all(game, 'hero')[0], e = all(game, 'hunter')[0];",
      '  if (Math.hypot(h.x - e.x, h.y - e.y) < 18 && !game.met) game.met = game.n;',
      '}',
      'export function render(game, g) { clear(g); drawThings(g, game, {}); }',
      "export function summary(game) { const e = all(game, 'hunter')[0], m = all(game, 'mouse')[0]; return { n: game.n, met: game.met, inWall: all(game, 'wall').some((w) => e.x + 10 > w.x && e.x + 10 < w.x + w.w && e.y + 10 > w.y && e.y + 10 < w.y + w.h), mouseX: m.x, mouseY: m.y }; }", ''
    ].join(String.fromCharCode(10));
    await S(`(s.project.write("src/main.js", ${JSON.stringify(maze)}), s.run({ restart: true }), 1)`);
    check('in a game, the hunter finds its way through the gap to the hero, never inside a wall, and the mouse keeps in the room',
      await waitFor('window.studio.runner.status === "running" && (window.studio.runner.summary?.n ?? 0) > 400', 20_000)
      && (await S('s.runner.summary.met')) > 0 && !(await S('s.runner.summary.inWall')) && (await S('s.runner.summary.mouseX')) > 32 && (await S('s.runner.summary.mouseY')) < 160,
    await S('JSON.stringify(s.runner.summary)'));
    check('no problems were reported for the maze game', (await S('s.diagnostics.size')) === 0);
    const errs = page.errors.filter((e) => !/willReadFrequently|favicon/.test(e));
    check('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
  }, { width: 1500, height: 900 });
} finally { server.close(); }
process.exit(failed ? 1 : 0);
