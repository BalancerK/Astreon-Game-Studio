// Live check, in a real Chrome with a real mouse and keyboard, of the World panel: make a world from the project's scenes, link the rooms through an edge and through a named door, drag a
// room on the board, choose where a link arrives, see problems pointed out, and run a game that walks the hero from one room into the next. Usage: node tools/studio-world-test.js [outDir]
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createStaticServer } from './static-server.js';
import { withChromePage } from './cdp.js';
import { serializeScene } from '../studio/app/paint/scene-model.js';

const outDir = process.argv[2] ?? null;
if (outDir) mkdirSync(outDir, { recursive: true });
const root = decodeURIComponent(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const server = createStaticServer({ root, allowDirs: ['studio', 'packages'], index: '/studio/index.html' });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
let failed = false;
const check = (name, ok, detail = '') => { if (!ok) failed = true; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `  (${detail})` : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WORLD = 'JSON.parse(window.studio.project.readText("src/world.js").replace(/^[\\s\\S]*?export default /, "").replace(/;\\s*$/, ""))';

const CAVE = serializeScene({ w: 300, h: 200, things: [
  { kind: 'hero', x: 20, y: 150, w: 16, h: 16, color: '#8b8bff' }, { kind: 'rock', x: 100, y: 100, w: 20, h: 20, color: '#888888' },
  { kind: 'door', x: 250, y: 150, w: 20, h: 30, color: '#c8a064', extra: { name: 'cave-door' } },
] });
const FOREST = serializeScene({ w: 500, h: 200, things: [
  { kind: 'tree', x: 200, y: 50, w: 20, h: 40, color: '#3a8a4a' }, { kind: 'door', x: 10, y: 120, w: 20, h: 30, color: '#c8a064', extra: { name: 'forest-door' } },
] });
const ISLAND = serializeScene({ w: 200, h: 160, things: [{ kind: 'palm', x: 20, y: 20, w: 16, h: 30, color: '#3a8a4a' }] });
const GAME = [
  "import { clear, drawThings, loadScene, makeWorld, first } from '@engine/arcade';",
  "import data from './world.js';",
  "import cave from '../scenes/cave.js';",
  "import forest from '../scenes/forest.js';",
  'const world = makeWorld(data, { cave: (g) => loadScene(g, cave), forest: (g) => loadScene(g, forest) });',
  'export function create() {',
  '  const game = { things: [], camera: { x: 0, y: 0 }, score: 0, nextId: 1, seed: 1, n: 0 };',
  '  world.start(game);',
  '  return game;',
  '}',
  'export function update(game) {',
  '  game.n++;',
  "  if (world.room(game) === 'cave') first(game, 'hero').x += 3;",
  '  world.step(game);',
  '}',
  'export function render(game, g) { clear(g); drawThings(g, game); }',
  "export function summary(game) { const h = first(game, 'hero'); return { n: game.n, room: world.room(game), from: game.world.from, visited: world.visited(game).join(), heroes: game.things.filter((t) => t.kind === 'hero').length, x: h.x, y: h.y, width: game.map.width }; }", '',
].join(String.fromCharCode(10));

try {
  await withChromePage(`http://localhost:${port}/studio/index.html`, async (page) => {
    const S = (expr) => page.eval(`(() => { const s = window.studio; return ${expr}; })()`);
    const P = (expr) => page.eval(`(() => { const p = document.querySelector('[aria-label="World"]'); return p ? (${expr}) : null; })()`);
    const waitFor = (expr, ms = 8000) => page.waitFor(expr, ms);
    const press = async (code) => { await page.key(code, 'down'); await page.key(code, 'up'); };
    const click = (label) => P(`(() => { const b = [...p.querySelectorAll("button")].find((x) => x.textContent === ${JSON.stringify(label)} || x.getAttribute("aria-label") === ${JSON.stringify(label)}); if (!b) return false; b.click(); return true; })()`);
    const setSel = (label, value) => P(`(() => { const s = [...p.querySelectorAll("select,input")].find((x) => x.getAttribute("aria-label") === ${JSON.stringify(label)}); if (!s) return false; if (s.type === "checkbox") s.checked = ${JSON.stringify(value)}; else s.value = ${JSON.stringify(String(value))}; s.dispatchEvent(new Event("change", { bubbles: true })); return true; })()`);
    const roomAt = (name) => P(`(() => { const g = [...p.querySelectorAll("g.world-room")].find((x) => x.getAttribute("aria-label").startsWith("Room ${name}")); const r = g.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`);
    const clickRoom = async (name) => { const [x, y] = await roomAt(name); await page.mouse('mouseMoved', x, y); await page.mouse('mousePressed', x, y); await page.mouse('mouseReleased', x, y); };

    check('the studio opens', await waitFor('!!window.studio && !!document.getElementById("dock")', 20_000));
    await S('(s.createProject({ name: "World test", template: "blank" }), 1)');
    await waitFor('window.studio.project?.name === "World test"', 10_000);
    await S(`(s.project.write("scenes/cave.js", ${JSON.stringify(CAVE)}), s.project.write("scenes/forest.js", ${JSON.stringify(FOREST)}), s.emit("files"), s.commands.execute("workspace.art"), s.dock.show("world"), 1)`);
    check('with no world the panel offers to make one from the scenes', await waitFor('!!document.querySelector("[aria-label=\\"World\\"] .empty button")', 5000));
    await click('Make a world from my scenes and levels');
    check('it writes src/world.js with both rooms, starting in the first', await waitFor('window.studio.project.has("src/world.js")', 4000)
      && (await S(`Object.keys(${WORLD}.rooms).join()`)) === 'cave,forest' && (await S(`${WORLD}.start`)) === 'cave');
    check('the board shows a box for each room, with its size', await waitFor('document.querySelectorAll("[aria-label=\\"World\\"] g.world-room").length === 2', 4000)
      && (await P('p.querySelector("svg").textContent.includes("300 × 200") && p.querySelector("svg").textContent.includes("500 × 200")')));
    if (outDir) writeFileSync(join(outDir, 'world-1.png'), await page.screenshot());

    // select a room with a real click, add a two-way edge link
    await clickRoom('cave');
    check('clicking a room shows its inspector', await waitFor('!!document.querySelector("[aria-label=\\"World\\"] .world-inspector h4") && /cave/.test(document.querySelector("[aria-label=\\"World\\"] .world-inspector h4").textContent)', 3000));
    check('the suggested edge is the right one, because the forest is to the right', (await P('p.querySelector("select[aria-label=\\"Which edge\\"]").value')) === 'right');
    await click('Add the link');
    check('adding a link both ways writes the edge and the way back', await waitFor(`${WORLD}.links.length === 2`, 4000)
      && (await S(`JSON.stringify(${WORLD}.links[1].via)`)) === '{"kind":"edge","side":"left"}');
    // a door link
    await setSel('Leave through', 'door');
    check('choosing a door lists the named things of the scene', (await P('[...p.querySelector("select[aria-label=\\"Which door\\"]").options].map((o) => o.textContent).join()')).includes('cave-door'));
    await setSel('Which door', 'cave-door');
    await click('Add the link');
    check('a door link is added', await waitFor(`${WORLD}.links.length === 3 && ${WORLD}.links[2].via.name === "cave-door"`, 4000));
    await setSel('How link 3 arrives', 'at');
    await setSel('Arrive next to, link 3', 'forest-door');
    check('the link can arrive next to a named door of the other room', await waitFor(`${WORLD}.links[2].arrive?.at === "forest-door"`, 4000), await S(`JSON.stringify(${WORLD}.links[2])`));
    if (outDir) writeFileSync(join(outDir, 'world-2.png'), await page.screenshot());

    // drag a room
    const before = await S(`${WORLD}.rooms.forest.y`);
    const [fx, fy] = await roomAt('forest');
    await page.mouse('mouseMoved', fx, fy);
    await page.mouse('mousePressed', fx, fy);
    await page.mouse('mouseMoved', fx, fy + 30);
    await page.mouse('mouseMoved', fx, fy + 60);
    await page.mouse('mouseReleased', fx, fy + 60);
    check('dragging a room moves it on the board and in the file', await waitFor(`${WORLD}.rooms.forest.y > ${before}`, 4000), await S(`${WORLD}.rooms.forest.y`));
    // keyboard
    await P('(() => { [...p.querySelectorAll("g.world-room")].find((x) => x.getAttribute("aria-label").startsWith("Room forest")).focus(); return 1; })()');
    const x0 = await S(`${WORLD}.rooms.forest.x`);
    await press('ArrowRight');
    check('an arrow key moves the focused room by 10', await waitFor(`${WORLD}.rooms.forest.x === ${x0} + 10`, 3000));

    // problems
    await S(`(s.project.write("scenes/island.js", ${JSON.stringify(ISLAND)}), s.emit("files"), 1)`);
    await waitFor('[...document.querySelectorAll("[aria-label=\\"World\\"] select")].some((x) => [...x.options].some((o) => o.value === "scenes/island.js"))', 5000);
    await setSel('Add a room', 'scenes/island.js');
    check('a room added from the list has no way in, and the panel says so', await waitFor('/island" cannot be reached/.test(document.querySelector("[aria-label=\\"World\\"] details.text-issues").textContent)', 5000));
    await click('Delete room');
    check('deleting a room takes it, and the problem, away', await waitFor(`!("island" in ${WORLD}.rooms)`, 4000));
    await clickRoom('forest');
    await click('Make the game start here');
    check('a different room can be made the start', await waitFor(`${WORLD}.start === "forest"`, 4000));
    await clickRoom('cave');
    await click('Make the game start here');
    await waitFor(`${WORLD}.start === "cave"`, 4000);

    // a game that walks through the world
    await S(`(s.project.write("src/main.js", ${JSON.stringify(GAME)}), s.emit("files"), 1)`);
    await sleep(700);
    await S('(s.run({ restart: true }), 1)');
    check('a game with makeWorld: the hero walks into the cave door and arrives at the forest door, the same single hero',
      await waitFor('window.studio.runner.status === "running" && window.studio.runner.summary?.room === "forest" && window.studio.runner.summary?.n > 5', 25_000)
      && (await S('s.runner.summary.from')) === 'cave' && (await S('s.runner.summary.visited')) === 'cave,forest' && (await S('s.runner.summary.heroes')) === 1
      && Math.abs((await S('s.runner.summary.x')) - 12) < 2 && Math.abs((await S('s.runner.summary.y')) - 127) < 2 && (await S('s.runner.summary.width')) === 500,
    await S('JSON.stringify(s.runner.summary)'));
    check('no problems were reported for the game', (await S('s.diagnostics.size')) === 0);
    const errs = page.errors.filter((e) => !/willReadFrequently|favicon/.test(e));
    check('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
  }, { width: 1500, height: 900 });
} finally { server.close(); }
process.exit(failed ? 1 : 0);
