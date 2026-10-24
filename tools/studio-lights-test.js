// Live check, in a real Chrome, of the Lights panel: start a set, see the dark and the lights in the picture, change them with sliders, add, copy and remove lights, tint the screen,
// see that the file is written, and run a game that uses it: the pixels under a light are bright and the pixels far from any light are dark, in the game's own worker.
// Usage: node tools/studio-lights-test.js [outDir]
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
const FILE = 'JSON.parse(window.studio.project.readText("src/lights.js").replace(/^[\\s\\S]*?export default /, "").replace(/;\\s*$/, ""))';

const GAME = [
  "import { clear, drawThings, stepLayers, drawLights } from '@engine/arcade';",
  "import lights from './lights.js';",
  'export function create() { return { things: [{ kind: "torch", x: 94, y: 94, w: 12, h: 12, color: "#ffffff" }], camera: { x: 0, y: 0 }, score: 0, nextId: 2, seed: 1, n: 0 }; }',
  'export function update(game, keys, dt) { game.n++; stepLayers(game, dt); }',
  'export function render(game, g) {',
  '  g.fillStyle = "#c8c8c8"; g.fillRect(0, 0, 480, 320);',
  '  drawLights(g, game, lights);',
  '  const px = (x, y) => { const d = g.getImageData(x, y, 1, 1).data; return d[0] + d[1] + d[2]; };',
  '  game.sample = { lit: px(100, 100), far: px(440, 290) };',
  '}',
  'export function summary(game) { return { n: game.n, lit: game.sample?.lit, far: game.sample?.far }; }', '',
].join('\n');

try {
  await withChromePage(`http://localhost:${port}/studio/index.html`, async (page) => {
    const S = (expr) => page.eval(`(() => { const s = window.studio; return ${expr}; })()`);
    const P = (expr) => page.eval(`(() => { const p = document.querySelector('[aria-label="Lights"]'); return p ? (${expr}) : null; })()`);
    const waitFor = (expr, ms = 8000) => page.waitFor(expr, ms);
    const btn = (label) => P(`(() => { const b = [...p.querySelectorAll("button")].find((x) => x.textContent === ${JSON.stringify(label)} || x.getAttribute("aria-label") === ${JSON.stringify(label)}); if (!b) return false; b.click(); return true; })()`);
    const slide = (label, value) => P(`(() => { const i = [...p.querySelectorAll("input[type=range]")].find((x) => x.getAttribute("aria-label") === ${JSON.stringify(label)}); if (!i) return false; i.value = ${value}; i.dispatchEvent(new Event("input", { bubbles: true })); return true; })()`);
    const names = () => P('[...p.querySelectorAll(".layers-row > button:first-child")].map((b) => b.textContent).join(",")');
    const brightness = (x, y) => P(`(() => { const d = p.querySelector("canvas.layers-view").getContext("2d").getImageData(${x}, ${y}, 1, 1).data; return d[0] + d[1] + d[2]; })()`);

    check('the studio opens', await waitFor('!!window.studio && !!document.getElementById("dock")', 20_000));
    await S('(s.createProject({ name: "Lights test", template: "blank" }), 1)');
    await waitFor('window.studio.project?.name === "Lights test"', 10_000);
    await S('(s.dock.show("lights"), 1)');
    check('with no file the panel offers ready-made sets', await waitFor('!!document.querySelector("[aria-label=\\"Lights\\"] .empty button")', 5000) && (await P('p.querySelector(".empty").textContent.includes("dark cave")')));
    await btn('A night with torches');
    check('choosing one writes src/lights.js', await waitFor('window.studio.project.has("src/lights.js")', 4000));
    check('the lights are listed', await waitFor('document.querySelectorAll("[aria-label=\\"Lights\\"] .layers-row").length === 2', 4000) && (await names()) === 'hero glow,torches', await names());
    await sleep(300);
    // the torch at (77, 157) is lit, the far corner is dark
    const lit = await brightness(77, 157);
    const far = await brightness(395, 235);
    check('the picture is dark in the corner and bright at a torch', lit > far * 1.6 && far < 400, `${lit} vs ${far}`);
    if (outDir) writeFileSync(join(outDir, 'lights-night.png'), await page.screenshot());

    await slide('Darkness', 0);
    await sleep(250);
    const daylight = await brightness(395, 235);
    check('no darkness means the corner is as bright as the rest', daylight > far * 2, `${daylight} vs ${far}`);
    check('and the file keeps it', await waitFor(`(${FILE}).screen.darkness === 0`, 4000));
    await slide('Darkness', 0.9);
    await btn('Edit light torches');
    await slide('Size', 200);
    await slide('Flicker', 0.8);
    check('a light\'s size and flicker are kept in the file', await waitFor(`(${FILE}).lights[1].radius === 200 && (${FILE}).lights[1].flicker === 0.8`, 4000));
    await P('(() => { const s = p.querySelector("select[aria-label=\\"Add a light\\"]"); s.value = "lamp"; s.dispatchEvent(new Event("change")); return 1; })()');
    check('adding a lamp adds a light at a place in the world', await waitFor('document.querySelectorAll("[aria-label=\\"Lights\\"] .layers-row").length === 3', 4000) && (await names()) === 'hero glow,torches,lamp'
      && (await P('!!p.querySelector("input[aria-label=\\"Across\\"]")')));
    await slide('Across', 300);
    check('moving the lamp is kept', await waitFor(`(${FILE}).lights[2].x === 300`, 4000));
    await btn('Copy lamp');
    check('a copy gets a free name', (await names()).includes('lamp 2'));
    await btn('Remove lamp 2');
    check('removing takes it out of the file', await waitFor(`(${FILE}).lights.length === 3`, 4000));
    await P('(() => { const i = p.querySelector("input[aria-label=\\"Light name\\"]"); i.value = "hero glow"; i.dispatchEvent(new Event("change")); return 1; })()');
    check('a name that is taken is refused with a message', await waitFor('!!document.querySelector(".toast") && /already a light/.test(document.querySelector(".toast").textContent)', 4000));
    await slide('Tint strength', 0.4);
    check('the tint strength is kept', await waitFor(`(${FILE}).screen.tintAlpha === 0.4`, 4000));

    // a game that uses the file, in the worker
    await S(`(s.project.write("src/lights.js", ${JSON.stringify('export default { "screen": { "darkness": 0.9, "ambient": "#000000", "tint": "", "tintAlpha": 0, "vignette": 0 }, "lights": [{ "name": "lamp", "x": 100, "y": 100, "radius": 80, "color": "#ffffff", "intensity": 1 }] };\n')}), `
      + `s.project.write("src/main.js", ${JSON.stringify(GAME)}), s.emit("files"), 1)`);
    await sleep(600);
    await S('(s.run({ restart: true }), 1)');
    check('a game that draws the lights runs: under the lamp it is bright, far from it it is dark',
      await waitFor('window.studio.runner.status === "running" && (window.studio.runner.summary?.n ?? 0) > 5 && window.studio.runner.summary?.lit > 0', 15_000)
      && (await S('s.runner.summary.lit')) > (await S('s.runner.summary.far')) * 3, await S('JSON.stringify(s.runner.summary)'));
    check('no problems were reported for the game', (await S('s.diagnostics.size')) === 0);
    const errs = page.errors.filter((e) => !/willReadFrequently|favicon/.test(e));
    check('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
  }, { width: 1500, height: 900 });
} finally { server.close(); }
process.exit(failed ? 1 : 0);
