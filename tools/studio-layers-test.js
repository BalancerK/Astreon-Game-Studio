// Live check, in a real Chrome, of the Layers panel: start a set, see the layers and the picture, change a layer with a slider, add, move and remove layers, change the
// camera settings, see that the file is written, and run a game that uses the file: its camera lags behind the hero, its layers drift, and parallax layers move less than the world.
// Usage: node tools/studio-layers-test.js [outDir]
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
const FILE = 'JSON.parse(window.studio.project.readText("src/layers.js").replace(/^[\\s\\S]*?export default /, "").replace(/;\\s*$/, ""))';

const GAME = [
  "import { clear, drawThings, followSmooth, stepLayers, drawLayers } from '@engine/arcade';",
  "import layers from './layers.js';",
  'export function create() { return { things: [{ kind: "hero", x: 300, y: 100, w: 20, h: 20 }], map: { width: 4000, height: 300 }, camera: { x: 0, y: 0 }, score: 0, nextId: 2, seed: 1 }; }',
  'export function update(game, keys, dt) {',
  '  game.things[0].x += 4;',
  '  stepLayers(game, 1 / 60);',
  '  followSmooth(game, game.things[0], game.map, 1 / 60, layers.camera);',
  '}',
  'export function render(game, g) { clear(g); drawLayers(g, game, layers); drawThings(g, game); drawLayers(g, game, layers, { front: true }); }',
  'export function summary(game) { return { cam: game.camera.x, hero: game.things[0].x, clock: game.layerClock ?? 0 }; }', '',
].join('\n');

try {
  await withChromePage(`http://localhost:${port}/studio/index.html`, async (page) => {
    const S = (expr) => page.eval(`(() => { const s = window.studio; return ${expr}; })()`);
    const P = (expr) => page.eval(`(() => { const p = document.querySelector('[aria-label="Layers"]'); return p ? (${expr}) : null; })()`);
    const waitFor = (expr, ms = 8000) => page.waitFor(expr, ms);
    const btn = (label) => P(`(() => { const b = [...p.querySelectorAll("button")].find((x) => x.textContent === ${JSON.stringify(label)} || x.getAttribute("aria-label") === ${JSON.stringify(label)}); if (!b) return false; b.click(); return true; })()`);
    const slide = (label, value) => P(`(() => { const i = [...p.querySelectorAll("input[type=range]")].find((x) => x.getAttribute("aria-label") === ${JSON.stringify(label)}); if (!i) return false; i.value = ${value}; i.dispatchEvent(new Event("input", { bubbles: true })); return true; })()`);
    const names = () => P('[...p.querySelectorAll(".layers-row > button:first-child")].map((b) => b.textContent).join(",")');

    check('the studio opens', await waitFor('!!window.studio && !!document.getElementById("dock")', 20_000));
    await S('(s.createProject({ name: "Layers test", template: "blank" }), 1)');
    await waitFor('window.studio.project?.name === "Layers test"', 10_000);
    await S('(s.dock.show("layers"), 1)');
    check('with no file the panel offers ready-made sets', await waitFor('!!document.querySelector("[aria-label=\\"Layers\\"] .empty button")', 5000)
      && (await P('p.querySelector(".empty").textContent.includes("starry night")')));
    await btn('A starry night');
    check('choosing one writes src/layers.js', await waitFor('window.studio.project.has("src/layers.js")', 4000));
    check('the layers are listed back to front', await waitFor('document.querySelectorAll("[aria-label=\\"Layers\\"] .layers-row").length === 3', 4000)
      && (await names()) === 'sky,stars,hills', await names());
    check('the picture shows the sky: the top left of the canvas is the sky colour', await P(`(() => {
      const c = p.querySelector("canvas.layers-view").getContext("2d").getImageData(2, 40, 1, 1).data;
      return c[2] > c[0];
    })()`));
    if (outDir) writeFileSync(join(outDir, 'layers-night.png'), await page.screenshot());

    // sliders change the file
    await btn('Edit layer hills');
    await slide('Height', 120);
    await slide('Parallax across', 0.8);
    check('a slider changes the layer and the file', await waitFor(`(${FILE}).layers[2].height === 120 && (${FILE}).layers[2].parallax[0] === 0.8`, 4000));
    await slide('Delay', 0.5);
    await slide('Look ahead', 60);
    check('the camera settings are kept in the file too', await waitFor(`(${FILE}).camera.smooth === 0.5 && (${FILE}).camera.lookAhead === 60`, 4000));
    // add, move, copy, remove
    await P('(() => { const s = p.querySelector("select[aria-label=\\"Add a layer\\"]"); s.value = "clouds"; s.dispatchEvent(new Event("change")); return 1; })()');
    check('adding a cloud layer puts it at the front of the list', await waitFor('document.querySelectorAll("[aria-label=\\"Layers\\"] .layers-row").length === 4', 4000) && (await names()) === 'sky,stars,hills,clouds');
    await btn('Move clouds back');
    check('a layer moves towards the back', await waitFor(`(${FILE}).layers[2].name === "clouds"`, 4000));
    await btn('Copy clouds');
    check('a copy gets a free name', await waitFor('document.querySelectorAll("[aria-label=\\"Layers\\"] .layers-row").length === 5', 4000) && (await names()).includes('clouds 2'));
    await btn('Remove clouds 2');
    check('removing takes it out of the file', await waitFor(`(${FILE}).layers.length === 4`, 4000));
    // naming clash is refused politely
    await P('(() => { const i = p.querySelector("input[aria-label=\\"Layer name\\"]"); i.value = "sky"; i.dispatchEvent(new Event("change")); return 1; })()');
    check('a name already used is refused with a message', await waitFor('!!document.querySelector(".toast") && /already a layer/.test(document.querySelector(".toast").textContent)', 4000));
    // walk
    await btn('Make the camera walk');
    const before = await P('p.querySelector("input[aria-label=\\"Where the camera is in the world\\"]").value');
    await sleep(800);
    check('Walk moves the camera along the world', Number(await P('p.querySelector("input[aria-label=\\"Where the camera is in the world\\"]").value')) > Number(before));
    await btn('Stop the camera walking');
    check('the Add-a-layer list has all the kinds', await P('p.querySelector("select[aria-label=\\"Add a layer\\"]").options.length === 9'));

    // a game that uses the file
    await S(`(s.project.write("src/main.js", ${JSON.stringify(GAME)}), s.emit("files"), 1)`);
    await sleep(600);
    await S('(s.run({ restart: true }), 1)');
    check('a game using followSmooth and drawLayers runs', await waitFor('window.studio.runner.status === "running" && (window.studio.runner.summary?.clock ?? 0) > 1', 15_000), await S('JSON.stringify(s.runner.summary)'));
    const sm = JSON.parse(await S('JSON.stringify(s.runner.summary)'));
    check('the camera is behind the hero, not on it, but it has moved', sm.cam > 0 && sm.cam < sm.hero + 10 - 240, JSON.stringify(sm));
    check('the layers clock runs', sm.clock > 1);
    check('no problems were reported for the game', (await S('s.diagnostics.size')) === 0);
    await S('(s.dock.show("layers"), 1)');
    if (outDir) { await sleep(300); writeFileSync(join(outDir, 'layers-game.png'), await page.screenshot()); }
    const errs = page.errors.filter((e) => !/willReadFrequently|favicon/.test(e));
    check('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
  }, { width: 1500, height: 900 });
} finally { server.close(); }
process.exit(failed ? 1 : 0);
