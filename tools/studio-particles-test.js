// Live check, in a real Chrome with a real mouse, of the Particles panel: make a fire, see it burn in the preview, move sliders, change colors, "surprise me", make an
// explosion and click the preview for a burst, and run a game that plays the effects. Usage: node tools/studio-particles-test.js [outDir]
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
const PARSE = 'JSON.parse(window.studio.project.readText("src/particles.js").replace(/^[\\s\\S]*?export default /, "").replace(/;\\s*$/, ""))';

try {
  await withChromePage(`http://localhost:${port}/studio/index.html`, async (page) => {
    const S = (expr) => page.eval(`(() => { const s = window.studio; return ${expr}; })()`);
    const P = (expr) => page.eval(`(() => { const p = document.querySelector('[aria-label="Particle effects"]'); return p ? (${expr}) : null; })()`);
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
    const count = () => P('Number(/\\d+/.exec(p.querySelector(".particle-count").textContent)[0])');
    const lit = () => P('(() => { const c = p.querySelector(".particle-view"); const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 90 || d[i + 1] > 90 || d[i + 2] > 140) n++; return n; })()');
    const slide = (label, value) => P(`(() => { const i = p.querySelector('input[aria-label="${label}"]'); i.value = ${JSON.stringify(String(value))}; i.dispatchEvent(new Event('input')); return 1; })()`);

    check('the studio opens', await waitFor('!!window.studio && !!document.getElementById("dock")', 20_000));
    await S('(s.createProject({ name: "Particles test", template: "blank" }), 1)');
    await waitFor('window.studio.project?.name === "Particles test"', 10_000);
    await S('(s.dock.show("particles"), 1)');
    check('the Particles panel offers to make a fire', await waitFor('!!document.querySelector("[aria-label=\\"Particle effects\\"]")', 5000) && (await P('p.textContent.includes("No effects yet")')));
    await click('Make a fire');
    await answer('fire');
    check('the effect is saved in src/particles.js as a stream', await waitFor('window.studio.project.has("src/particles.js")', 3000) && (await S(`${PARSE}.fire.use`)) === 'stream');
    await sleep(900);
    check('the preview burns: particles are alive and pixels are lit', (await count()) > 10 && (await lit()) > 50, `${await count()} particles, ${await lit()} lit pixels`);
    if (outDir) writeFileSync(join(outDir, 'particles-panel.png'), await page.screenshot());
    check('a stream shows "Made each second" and not "How many in a burst"', await P('p.textContent.includes("Made each second") && !p.textContent.includes("How many in a burst")'));
    // sliders
    await slide('Direction (degrees)', 45);
    check('moving the Direction slider is saved', await waitFor(`${PARSE}.fire.angle === 45`, 3000));
    await slide('Made each second', 0);
    await sleep(2200);
    check('with a rate of 0 the stream stops and the particles die out', (await count()) === 0);
    await slide('Made each second', 80);
    await slide('Lasts (seconds), shortest', 2);
    check('a pair keeps its order: raising the shortest life lifts the longest', await waitFor(`${PARSE}.fire.life[1] >= 2`, 3000));
    // colors
    await click('Add a color');
    check('Add a color adds a fourth swatch, saved', await waitFor(`${PARSE}.fire.colors.length === 4`, 3000) && (await P('p.querySelectorAll("input[type=color]").length')) === 4);
    const was = await S(`JSON.stringify(${PARSE}.fire)`);
    await click('Surprise me');
    check('Surprise me changes the effect and keeps it valid', await waitFor(`JSON.stringify(${PARSE}.fire) !== ${JSON.stringify(was)}`, 3000)
      && (await S(`${PARSE}.fire.life[0] <= ${PARSE}.fire.life[1]`)));
    // shape and fade
    await P('(() => { const s = p.querySelector("select[aria-label=Shape]"); s.value = "square"; s.dispatchEvent(new Event("change")); return 1; })()');
    check('the shape choice is saved', await waitFor(`${PARSE}.fire.shape === "square"`, 3000));
    // an explosion from a preset, burst by a real mouse click
    await P('(() => { const s = p.querySelector("select[aria-label=\\"Start a new effect from\\"]"); s.value = "explosion"; s.dispatchEvent(new Event("change")); return 1; })()');
    await answer('boom');
    check('the explosion is a burst effect and shows "How many in a burst"', await waitFor('!!window.studio.project.readText("src/particles.js").includes("\\"boom\\"")', 3000)
      && (await S(`${PARSE}.boom.use`)) === 'emit' && (await P('p.textContent.includes("How many in a burst")')));
    await P('(() => { const r = [...p.querySelectorAll("input[type=checkbox]")].find((c) => c.parentElement.textContent.includes("Repeat")); r.checked = false; r.dispatchEvent(new Event("change")); return 1; })()');
    await sleep(1200);
    const box = await P('(() => { const r = p.querySelector(".particle-view").getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()');
    const before = await count();
    await page.mouse('mousePressed', box[0], box[1]);
    await page.mouse('mouseReleased', box[0], box[1]);
    await sleep(120);
    check('clicking the preview throws a burst from there', before === 0 && (await count()) > 20, `${before} -> ${await count()}`);
    // the other buttons
    await click('Delete');
    check('Delete takes the effect away, saved', await waitFor('!window.studio.project.readText("src/particles.js").includes("\\"boom\\"")', 3000));
    // a game that plays the effects
    const game = [
      "import { newGame, clear, drawThings, label, emit, stream, effects, all } from '@engine/arcade';",
      "import particles from './particles.js';",
      'export function create() { return newGame({ n: 0 }); }',
      "export function update(game, keys, dt) { game.n++; if (game.n === 5) emit(game, particles.fire, 100, 100); stream(game, particles.fire, 200, 200, dt); effects(game, dt); }",
      "export function render(game, g) { clear(g); drawThings(g, game, {}); label(g, String(all(game, 'spark').length), 12, 24); }",
      "export function summary(game) { return { n: game.n, sparks: all(game, 'spark').length }; }", '',
    ].join('\n');
    await S(`(s.project.write("src/main.js", ${JSON.stringify(game)}), s.run({ restart: true }), 1)`);
    check('a game that plays the effects runs and has particles alive', await waitFor('window.studio.runner.status === "running" && (window.studio.runner.summary?.n ?? 0) > 40', 15_000)
      && (await S('s.runner.summary.sparks')) > 5, await S('JSON.stringify(s.runner.summary)'));
    check('no problems were reported for the game', (await S('s.diagnostics.size')) === 0);
    const errs = page.errors.filter((e) => !/willReadFrequently|favicon/.test(e));
    check('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
  }, { width: 1500, height: 900 });
} finally { server.close(); }
process.exit(failed ? 1 : 0);
