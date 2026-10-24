// Live check, in a real Chrome with a real mouse, of auto-tiling in the Level painter: turn it on for a tile and see the edges appear, paint and watch the shapes follow, change the
// settings, make the pictures, and run a game that uses it and re-works the shapes when a tile is removed. Usage: node tools/studio-autotile-test.js [outDir]
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createStaticServer } from './static-server.js';
import { withChromePage } from './cdp.js';
import { parseSprite } from '../studio/app/paint/sprite-model.js';

const outDir = process.argv[2] ?? null;
if (outDir) mkdirSync(outDir, { recursive: true });
const root = decodeURIComponent(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const server = createStaticServer({ root, allowDirs: ['studio', 'packages'], index: '/studio/index.html' });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
let failed = false;
const check = (name, ok, detail = '') => { if (!ok) failed = true; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `  (${detail})` : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const MAIN = `import { newGame, loadMap, retile, all, despawn, clear, drawThings } from '@engine/arcade';
const LEVEL = [
  '#########',
  '#.......#',
  '#..###..#',
  '#.......#',
  '#########',
];
export function create() {
  const game = newGame();
  loadMap(game, LEVEL, {
    '#': { kind: 'wall', color: '#3b4a6b' },
    o: { kind: 'coin', color: '#ffd23c' },
  });
  game.ticks = 0;
  return game;
}
export function update(game) {
  game.ticks++;
  if (game.ticks === 5) { const w = all(game, 'wall').find((x) => x.x === 128 && x.y === 64); game.before = w.mask; despawn(game, w); retile(game); game.after = all(game, 'wall').find((x) => x.x === 96 && x.y === 64).mask; }
}
export function render(game, g) { clear(g); drawThings(g, game); }
export function summary(game) { const w = all(game, 'wall').find((x) => x.x === 0 && x.y === 0); return { ticks: game.ticks, corner: w?.mask, frame: w?.frame, before: game.before, after: game.after }; }
`;

try {
  await withChromePage(`http://localhost:${port}/studio/index.html`, async (page) => {
    const S = (expr) => page.eval(`(() => { const s = window.studio; return ${expr}; })()`);
    const P = (expr) => page.eval(`(() => { const p = document.querySelector('[aria-label="Level painter"]'); return p ? (${expr}) : null; })()`);
    const waitFor = (expr, ms = 8000) => page.waitFor(expr, ms);
    const shot = () => P('p.querySelector("canvas").toDataURL()');
    const legendText = () => S('s.project.readText("src/main.js")');
    const setField = (label, value, kind = 'input') => P(`(() => { const i = p.querySelector('${kind}[aria-label="${label}"]'); i.value = ${JSON.stringify(value)}; i.dispatchEvent(new Event('change')); return 1; })()`);

    check('the studio opens', await waitFor('!!window.studio && !!document.getElementById("dock")', 20_000));
    await S('(s.createProject({ name: "Autotile test", template: "blank" }), 1)');
    await waitFor('window.studio.project?.name === "Autotile test"', 10_000);
    await S(`(s.project.write("src/main.js", ${JSON.stringify(MAIN)}), s.emit("files"), s.dock.show("levels"), 1)`);
    check('the Level painter finds the level and its tiles', await waitFor('!!document.querySelector("[aria-label=\\"Level painter\\"] canvas")', 5000) && (await P('p.querySelectorAll(".tile").length')) >= 3);
    await P('(() => { [...p.querySelectorAll(".tile")].find((t) => t.textContent.includes("wall")).click(); return 1; })()');
    check('picking the wall tile shows an auto-tiling box with the checkbox off', await waitFor('!!document.querySelector("[aria-label=\\"Level painter\\"] .level-auto input[type=checkbox]")', 3000)
      && (await P('p.querySelector(".level-auto input[type=checkbox]").checked')) === false);
    const plain = await shot();
    await P('(() => { const c = p.querySelector(".level-auto input[type=checkbox]"); c.checked = true; c.dispatchEvent(new Event("change")); return 1; })()');
    check('turning it on writes autotile: \'blob47\' into the wall\'s legend entry, and nothing else in the file changes', await waitFor('/autotile: \'blob47\'/.test(window.studio.project.readText("src/main.js"))', 3000)
      && (await legendText()).replace(", autotile: 'blob47'", '') === MAIN);
    await sleep(300);
    const edged = await shot();
    check('the picture now has edges (it is drawn differently)', edged !== plain);
    if (outDir) writeFileSync(join(outDir, 'autotile-painter.png'), await page.screenshot());
    // paint with the mouse: a new wall in the middle of the room changes the shapes round it
    const cell = await P('(() => { const r = p.querySelector("canvas").getBoundingClientRect(); return [r.x + r.width * (4.5 / 9), r.y + r.height * (3.5 / 5)]; })()');
    await P('(() => { [...p.querySelectorAll(".btn")].find((b) => b.textContent === "Paint").click(); return 1; })()');
    await page.mouse('mousePressed', cell[0], cell[1]);
    await page.mouse('mouseReleased', cell[0], cell[1]);
    check('painting a wall with the mouse changes the level and the shapes of its neighbours', await waitFor('/\'#\\.\\.#\\.\\.#\\.\\.#|#..\\#.\\.\\.#/.test(window.studio.project.readText("src/main.js")) || window.studio.project.readText("src/main.js").includes("\'#...#...#\'") || /\'#\\.\\.[#.]{5}\\.\\.#\'/.test(window.studio.project.readText("src/main.js"))', 3000)
      && (await shot()) !== edged);
    // settings
    await P('(() => { const s = p.querySelector("select[aria-label=\\"Which shapes\\"]"); s.value = "edges4"; s.dispatchEvent(new Event("change")); return 1; })()');
    check('the shapes can be four sides only', await waitFor('/autotile: \'edges4\'/.test(window.studio.project.readText("src/main.js"))', 3000));
    await setField('Edge width in game pixels', '5');
    check('the edge width is saved in the legend', await waitFor('/edgeWidth: 5/.test(window.studio.project.readText("src/main.js"))', 3000));
    await setField('Edge colour', '#ff0000');
    check('the edge colour is saved', await waitFor('/edge: \'#ff0000\'/.test(window.studio.project.readText("src/main.js"))', 3000));
    await P('(() => { const c = p.querySelector("input[aria-label=\\"The edge of the map counts as an edge\\"]"); c.checked = true; c.dispatchEvent(new Event("change")); return 1; })()');
    check('the map edge can be made an edge too', await waitFor('/openEdge: true/.test(window.studio.project.readText("src/main.js"))', 3000));
    await setField('Terrain name: tiles with the same name join', 'stone');
    check('a terrain name is saved', await waitFor('/terrain: \'stone\'/.test(window.studio.project.readText("src/main.js"))', 3000));
    // the picture
    await P('(() => { [...p.querySelectorAll("button")].find((b) => b.textContent === "Make a picture for it").click(); return 1; })()');
    check('"Make a picture" writes a sprite with a frame for every shape and points the legend at it', await waitFor('window.studio.project.has("src/art/wall-tiles.js")', 3000)
      && await waitFor('/sprite: \'wallTiles\'/.test(window.studio.project.readText("src/main.js"))', 3000));
    const sprite = parseSprite(await S('s.project.readText("src/art/wall-tiles.js")'));
    check('the sprite has the 16 frames of four sides', sprite.frames.length === 16 && sprite.w === 16, `${sprite.frames.length} frames`);
    check('the sprite file opens in the sprite painter\'s list', await S('(s.dock.show("sprites"), 1)') && await waitFor('[...document.querySelectorAll("option")].some((o) => o.textContent === "wall-tiles")', 5000));
    // turn it off again
    await S('(s.dock.show("levels"), 1)');
    await waitFor('!!document.querySelector("[aria-label=\\"Level painter\\"] .level-auto input[type=checkbox]")', 3000);
    await P('(() => { const c = p.querySelector(".level-auto input[type=checkbox]"); c.checked = false; c.dispatchEvent(new Event("change")); return 1; })()');
    check('turning it off takes the auto-tile settings out of the entry (the picture setting stays for the game to use)', await waitFor('!/autotile:/.test(window.studio.project.readText("src/main.js"))', 3000));
    // a game that uses it
    await S(`(s.project.write("src/main.js", ${JSON.stringify(MAIN.replace("color: '#3b4a6b' }", "color: '#3b4a6b', autotile: 'blob47' }"))}), s.emit("files"), 1)`);
    await sleep(700);
    await S('(s.run({ restart: true }), 1)');
    check('a game with auto-tiling runs: the corner tile has its mask and picture number, and removing a tile then retile() changes its neighbour',
      await waitFor('window.studio.runner.status === "running" && (window.studio.runner.summary?.ticks ?? 0) > 10', 15_000)
      && (await S('s.runner.summary.corner')) === 255 - 32 && Number.isInteger(await S('s.runner.summary.frame')) && (await S('s.runner.summary.before')) !== (await S('s.runner.summary.after')),
    await S('JSON.stringify(s.runner.summary)'));
    check('no problems were reported for the game', (await S('s.diagnostics.size')) === 0);
    const errs = page.errors.filter((e) => !/willReadFrequently|favicon/.test(e));
    check('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
  }, { width: 1500, height: 900 });
} finally { server.close(); }
process.exit(failed ? 1 : 0);
