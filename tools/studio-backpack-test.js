// Live check, in a real Chrome with real clicks, of the backpack and the Tiled/LDtk importer: put things from one project in the backpack, open another project and add them (under
// free names, asking before replacing a story), keep the backpack between projects, and bring in a Tiled map and an LDtk project and see them in the Level painter and the Scene panel.
// Usage: node tools/studio-backpack-test.js [outDir]
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createStaticServer } from './static-server.js';
import { withChromePage } from './cdp.js';
import { SPRITES } from '../studio/app/pack/sprites.js';
import { serializeSprite } from '../studio/app/paint/sprite-model.js';
import { serializeSounds, preset } from '../studio/app/paint/sound-model.js';
import { serializeUi, STARTERS } from '../studio/app/paint/ui-model.js';
import { serializeStoryFile, STARTER } from '../studio/app/paint/story-model.js';

const outDir = process.argv[2] ?? null;
if (outDir) mkdirSync(outDir, { recursive: true });
const root = decodeURIComponent(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const server = createStaticServer({ root, allowDirs: ['studio', 'packages'], index: '/studio/index.html' });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
let failed = false;
const check = (name, ok, detail = '') => { if (!ok) failed = true; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `  (${detail})` : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const TILED = {
  orientation: 'orthogonal', width: 5, height: 3, tilewidth: 16, tileheight: 16,
  layers: [
    { type: 'tilelayer', name: 'Ground', width: 5, height: 3, data: [1, 1, 1, 1, 1, 1, 0, 0, 2, 1, 1, 1, 1, 1, 1] },
    { type: 'objectgroup', name: 'Things', objects: [{ name: 'Sam', type: 'Hero', x: 20, y: 16, width: 16, height: 16, properties: [{ name: 'hp', type: 'int', value: 3 }] }] },
  ],
};
const LDTK = {
  __header__: {}, jsonVersion: '1.5.3', defs: { layers: [{ uid: 1, identifier: 'Collisions', intGridValues: [{ value: 1, identifier: 'Wall', color: '#ff0000' }] }] },
  levels: [{ identifier: 'Level_0', pxWid: 64, pxHei: 32, layerInstances: [
    { __identifier: 'Things', __type: 'Entities', __gridSize: 16, entityInstances: [{ __identifier: 'Player', px: [16, 16], width: 16, height: 16, __pivot: [0, 0], fieldInstances: [] }] },
    { __identifier: 'Collisions', __type: 'IntGrid', __gridSize: 16, __cWid: 4, __cHei: 2, layerDefUid: 1, intGridCsv: [1, 1, 1, 1, 1, 0, 0, 1] },
  ] }],
};

try {
  await withChromePage(`http://localhost:${port}/studio/index.html`, async (page) => {
    const S = (expr) => page.eval(`(() => { const s = window.studio; return ${expr}; })()`);
    const P = (expr) => page.eval(`(() => { const p = document.querySelector('[aria-label="Backpack"]'); return p ? (${expr}) : null; })()`);
    const waitFor = (expr, ms = 8000) => page.waitFor(expr, ms);
    const click = (label) => P(`(() => { const b = [...p.querySelectorAll("button")].find((x) => x.textContent === ${JSON.stringify(label)}); if (!b) return false; b.click(); return true; })()`);
    const clickAria = (label) => P(`(() => { const b = p.querySelector('button[aria-label=${JSON.stringify(JSON.stringify(label)).slice(1, -1).replace(/\\"/g, '"').replace(/^/, '"').replace(/$/, '"')}]'); if (!b) return false; b.click(); return true; })()`);
    const packed = () => S('s.store.getMeta("backpack").then((m) => (m ?? []).map((i) => i.kind + ":" + i.name).join())');

    check('the studio opens', await waitFor('!!window.studio && !!document.getElementById("dock")', 20_000));
    // ---- project A: make things and put them in the backpack ----
    await S('(s.createProject({ name: "Project A", template: "blank" }), 1)');
    await waitFor('window.studio.project?.name === "Project A"', 10_000);
    const hero = serializeSprite(SPRITES.find((x) => x.name === 'hero').make());
    await S(`(s.project.write("src/art/hero.js", ${JSON.stringify(hero)}), s.project.write("src/sounds.js", ${JSON.stringify(serializeSounds({ coin: preset('coin') }))}), `
      + `s.project.write("src/ui.js", ${JSON.stringify(serializeUi({ hud: STARTERS.hud() }))}), s.project.write("src/dialogue.js", ${JSON.stringify(serializeStoryFile(STARTER))}), s.emit("files"), s.dock.show("backpack"), 1)`);
    check('the Backpack panel lists what Project A has: a sprite, a sound, a screen and a story', await waitFor('!!document.querySelector("[aria-label=\\"Backpack\\"] .backpack-row")', 5000)
      && (await P('["hero", "coin", "hud", "story"].every((n) => p.querySelector(".backpack-here").textContent.includes(n))')));
    check('the backpack starts empty', await P('p.textContent.includes("The backpack is empty")'));
    for (const name of ['hero', 'coin', 'hud', 'story']) await P(`(() => { p.querySelector('button[aria-label="Put ${name} in the backpack"]').click(); return 1; })()`);
    check('putting four things in the backpack keeps them on this computer', await waitFor('document.querySelectorAll("[aria-label=\\"Backpack\\"] .backpack-packed .backpack-row").length === 4', 5000)
      && (await packed()).split(',').sort().join() === 'screen:hud,sound:coin,sprite:hero,story:story');
    if (outDir) writeFileSync(join(outDir, 'backpack.png'), await page.screenshot());
    // ---- project B: add them ----
    await S('(s.createProject({ name: "Project B", template: "blank" }), 1)');
    await waitFor('window.studio.project?.name === "Project B"', 10_000);
    await S('(s.dock.show("backpack"), 1)');
    check('the backpack is still full in another project, and says where each thing came from', await waitFor('document.querySelectorAll("[aria-label=\\"Backpack\\"] .backpack-packed .backpack-row").length === 4', 5000)
      && (await P('p.querySelector(".backpack-packed").textContent.includes("from Project A")')));
    await P('(() => { p.querySelector("button[aria-label=\\"Add hero to this project\\"]").click(); return 1; })()');
    check('adding the sprite writes src/art/hero.js', await waitFor('window.studio.project.has("src/art/hero.js")', 3000));
    await P('(() => { p.querySelector("button[aria-label=\\"Add hero to this project\\"]").click(); return 1; })()');
    check('adding it again does not overwrite: it becomes hero2', await waitFor('window.studio.project.has("src/art/hero2.js")', 3000) && (await S('s.project.readText("src/art/hero.js")')) === hero);
    await P('(() => { p.querySelector("button[aria-label=\\"Add coin to this project\\"]").click(); return 1; })()');
    await P('(() => { p.querySelector("button[aria-label=\\"Add hud to this project\\"]").click(); return 1; })()');
    check('a sound and a screen are put into src/sounds.js and src/ui.js', await waitFor('window.studio.project.has("src/sounds.js") && window.studio.project.has("src/ui.js")', 3000)
      && (await S('s.project.readText("src/sounds.js").includes("\\"coin\\"") && s.project.readText("src/ui.js").includes("\\"hud\\"")')));
    await P('(() => { p.querySelector("button[aria-label=\\"Add coin to this project\\"]").click(); return 1; })()');
    check('a second coin gets a free name (coin2) and the first is kept', await waitFor('s=window.studio, /"coin2"/.test(s.project.readText("src/sounds.js")) && /"coin"/.test(s.project.readText("src/sounds.js"))', 3000));
    // the story: replaces only after asking
    await S('(s.project.write("src/dialogue.js", "export default `== start ==\\nMine`;\\n"), s.emit("files"), 1)');
    await P('(() => { p.querySelector("button[aria-label=\\"Add story to this project\\"]").click(); return 1; })()');
    check('adding a story to a project that has one asks first', await waitFor('!!document.querySelector(".dialog")', 3000) && (await S('s.project.readText("src/dialogue.js").includes("Mine")')));
    await page.eval('(() => { [...document.querySelectorAll(".dialog button")].find((b) => b.textContent === "Replace").click(); return 1; })()');
    check('and replaces it once the person says yes', await waitFor('!window.studio.project.readText("src/dialogue.js").includes("Mine")', 3000));
    // search and remove
    await P('(() => { const i = p.querySelector("input[type=search]"); i.value = "hero"; i.dispatchEvent(new Event("input")); return 1; })()');
    check('the search narrows the backpack to what matches', await waitFor('document.querySelectorAll("[aria-label=\\"Backpack\\"] .backpack-packed .backpack-row").length === 1', 3000));
    await P('(() => { p.querySelector("button[aria-label=\\"Remove hero from the backpack\\"]").click(); return 1; })()');
    check('removing a thing takes it out of the backpack for good', await waitFor('true', 100) && (await sleep(300), (await packed()).split(',').sort().join()) === 'screen:hud,sound:coin,story:story');
    // ---- importing levels ----
    await S('(s.createProject({ name: "Project C", template: "blank" }), 1)');
    await waitFor('window.studio.project?.name === "Project C"', 10_000);
    const imported = await page.eval(`(async () => {
      const { importMapFile } = await import('/studio/app/core/import-map.js');
      const a = await importMapFile(window.studio, { name: 'Cave.tmj', text: async () => ${JSON.stringify(JSON.stringify(TILED))} });
      const b = await importMapFile(window.studio, { name: 'world.ldtk', text: async () => ${JSON.stringify(JSON.stringify(LDTK))} });
      const bad = await importMapFile(window.studio, { name: 'x.json', text: async () => 'nonsense' });
      return JSON.stringify({ a, b, bad });
    })()`);
    const r = JSON.parse(imported);
    check('a Tiled map writes a level and a scene, an LDtk project does too, and a file that is not a map writes nothing', r.a.length === 2 && r.b.length === 2 && r.bad.length === 0, imported);
    check('the files are where the painters look: src/levels and scenes', r.a.includes('src/levels/cave.js') && r.a.includes('scenes/cave.js') && r.b.some((p) => p.startsWith('src/levels/')));
    await S('(s.dock.show("levels"), 1)');
    check('the Level painter opens the imported level', await waitFor('!!document.querySelector("[aria-label=\\"Level painter\\"] canvas") && [...document.querySelectorAll("[aria-label=\\"Level painter\\"] option")].some((o) => /levels\\/cave/.test(o.textContent))', 5000));
    check('the Level painter has an Import button', await waitFor('[...document.querySelectorAll("[aria-label=\\"Level painter\\"] button")].some((b) => /Import Tiled/.test(b.textContent))', 3000));
    await S('(s.dock.show("scene2d"), 1)');
    check('the Scene panel lists the imported scene', await waitFor('[...document.querySelectorAll("option")].some((o) => /cave/.test(o.textContent))', 5000));
    // a game that loads the imported level and scene
    const game = [
      "import { newGame, loadScene, clear, drawThings, all } from '@engine/arcade';",
      "import { loadLevel } from './levels/cave.js';",
      "import scene from '../scenes/cave.js';",
      'export function create() { const g = newGame(); g.size = loadLevel(g); loadScene(g, scene); g.n = 0; return g; }',
      'export function update(g) { g.n++; }',
      'export function render(g, ctx) { clear(ctx); drawThings(ctx, g); }',
      "export function summary(g) { return { n: g.n, walls: all(g, 'wall').length, heroes: all(g, 'Hero').length, hp: all(g, 'Hero')[0]?.hp, cols: g.size.columns }; }", '',
    ].join('\n');
    await S(`(s.project.write("src/main.js", ${JSON.stringify(game)}), s.emit("files"), 1)`);
    await sleep(600);
    await S('(s.run({ restart: true }), 1)');
    check('a game that loads the imported level and scene runs: the walls, and the Hero with the hp that was set in Tiled',
      await waitFor('window.studio.runner.status === "running" && (window.studio.runner.summary?.n ?? 0) > 10', 15_000)
      && (await S('s.runner.summary.walls')) === 12 && (await S('s.runner.summary.heroes')) === 1 && (await S('s.runner.summary.hp')) === 3 && (await S('s.runner.summary.cols')) === 5,
    await S('JSON.stringify(s.runner.summary)'));
    check('no problems were reported for the game', (await S('s.diagnostics.size')) === 0);
    const errs = page.errors.filter((e) => !/willReadFrequently|favicon/.test(e));
    check('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
  }, { width: 1500, height: 900 });
} finally { server.close(); }
process.exit(failed ? 1 : 0);
