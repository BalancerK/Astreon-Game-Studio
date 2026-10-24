// Live check, in a real Chrome, of the deeper sprite editor: palette tools (merge colours that are the same, remove colours nothing uses, reduce to a limit, swap, merge into another), how an
// animation plays (round and round, backwards, forwards and back, once), the tiled preview, and a game whose animation plays once and says it is done.
// Usage: node tools/studio-palette-test.js [outDir]
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createStaticServer } from './static-server.js';
import { withChromePage } from './cdp.js';
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
const SPRITE = 'JSON.parse(window.studio.project.readText("src/art/hero.js").replace(/^[\\s\\S]*?export default /, "").replace(/;\\s*$/, ""))';

// each frame is one solid colour (red, green, blue), so the preview shows which frame is playing; d is never used and e is the same as c written in capitals
const SPRITE_TEXT = serializeSprite({
  w: 4, h: 4,
  palette: { a: '#ff0000', b: '#00ff00', c: '#0000ff', d: '#ffff00', e: '#0000FF', f: '#fe0101' },
  frames: [['aaaa', 'aaaa', 'aaaa', 'aaaa'], ['bbbb', 'bbbb', 'bbbb', 'bbbb'], ['cccc', 'cece', 'cccc', 'ffff']],
  animations: { go: { frames: [0, 1, 2], fps: 8 } },
});
const GAME = [
  "import { clear, drawThings, animate, spawn } from '@engine/arcade';",
  "import hero from './art/hero.js';",
  'const art = { hero };',
  'export function create() {',
  "  const game = { things: [], camera: { x: 0, y: 0 }, score: 0, nextId: 1, seed: 1, n: 0 };",
  "  spawn(game, 'hero', { sprite: 'hero', anim: 'go', x: 40, y: 40, w: 32, h: 32 });",
  '  return game;',
  '}',
  'export function update(game, keys, dt) { game.n++; animate(game.things[0], art, dt); }',
  'export function render(game, g) { clear(g); drawThings(g, game, art); }',
  'export function summary(game) { const t = game.things[0]; return { n: game.n, frame: t.frame, done: !!t.animDone }; }', '',
].join(String.fromCharCode(10));

try {
  await withChromePage(`http://localhost:${port}/studio/index.html`, async (page) => {
    const S = (expr) => page.eval(`(() => { const s = window.studio; return ${expr}; })()`);
    const P = (expr) => page.eval(`(() => { const p = document.querySelector('[aria-label="Sprite painter"]'); return p ? (${expr}) : null; })()`);
    const waitFor = (expr, ms = 8000) => page.waitFor(expr, ms);
    const click = (label) => P(`(() => { const b = [...p.querySelectorAll("button")].find((x) => x.textContent === ${JSON.stringify(label)} || x.getAttribute("aria-label") === ${JSON.stringify(label)}); if (!b) return false; b.click(); return true; })()`);
    const choose = (label, value) => P(`(() => { const s = [...p.querySelectorAll("select")].find((x) => x.getAttribute("aria-label") === ${JSON.stringify(label)}); if (!s) return false; s.value = ${JSON.stringify(value)}; s.dispatchEvent(new Event("change", { bubbles: true })); return true; })()`);
    const colourNow = () => P(`(() => { const d = p.querySelector("canvas.art-preview").getContext("2d").getImageData(32, 32, 1, 1).data; return d[0] > 200 ? "r" : d[1] > 200 ? "g" : d[2] > 200 ? "b" : "-"; })()`);
    const watch = async (ms) => { const seen = []; for (let t = 0; t < ms; t += 40) { const c = await colourNow(); if (seen.at(-1) !== c) seen.push(c); await sleep(40); } return seen.join(''); };

    check('the studio opens', await waitFor('!!window.studio && !!document.getElementById("dock")', 20_000));
    await S('(s.createProject({ name: "Palette test", template: "blank" }), 1)');
    await waitFor('window.studio.project?.name === "Palette test"', 10_000);
    await S(`(s.project.write("src/art/hero.js", ${JSON.stringify(SPRITE_TEXT)}), s.emit("files"), s.commands.execute("workspace.art"), s.dock.show("sprites"), 1)`);
    await waitFor('!!document.querySelector("[aria-label=\\"Sprite painter\\"] details.art-help")', 8000);
    await P('(() => { p.querySelector("details.art-help").open = true; p.querySelector("details.art-help").dispatchEvent(new Event("toggle")); return 1; })()');
    check('the painter opens the sprite and counts the colours it uses', await waitFor('!!document.querySelector("[aria-label=\\"Sprite painter\\"] .art-palette-tools")', 8000)
      && (await P('p.querySelector(".art-palette-tools").textContent.includes("5 of 6 colours used")')), await P('p.querySelector(".art-palette-tools").textContent'));
    check('it says which colours are the same as another one and which nothing uses', await P('/same as another one/.test(p.querySelector(".art-palette-tools").textContent) && /not used by any pixel/.test(p.querySelector(".art-palette-tools").textContent)'));
    if (outDir) writeFileSync(join(outDir, 'palette-1.png'), await page.screenshot());

    // how it plays
    const loop = await watch(2500);
    check('an animation goes round and round by default (red, green, blue, red...)', /rgbrg/.test(loop), loop);
    await choose('How go plays', 'pingpong');
    check('choosing forwards and back writes the mode to the file', await waitFor(`${SPRITE}.animations.go.mode === "pingpong"`, 4000));
    const pong = await watch(3000);
    check('forwards and back goes up and then down again (red, green, blue, green, red)', /rgbgr/.test(pong), pong);
    await choose('How go plays', 'reverse');
    const back = await watch(2500);
    check('backwards goes blue, green, red, blue...', /bgrbg/.test(back), back);
    await choose('How go plays', 'once');
    await sleep(800);
    const once = await watch(2000);
    check('once stops on the last frame', once === 'b', once);
    await choose('How go plays', 'loop');
    check('round and round is the default again and is not written to the file', await waitFor(`!("mode" in ${SPRITE}.animations.go)`, 4000));

    // palette tools
    await click('Merge colours that are the same');
    check('merging the colours that are the same takes one away', await waitFor(`!("e" in ${SPRITE}.palette) && ${SPRITE}.frames[2][1] === "cccc"`, 4000));
    await click('Remove colours nothing uses');
    check('removing unused colours takes yellow away', await waitFor(`!("d" in ${SPRITE}.palette)`, 4000));
    await choose('Colour limit', '2');
    check('a limit that is lower than the colours in use offers to reduce', await waitFor('[...document.querySelectorAll("[aria-label=\\"Sprite painter\\"] button")].some((b) => b.textContent === "Reduce to 2 colours")', 4000)
      && (await P('/uses 4 colours; the limit is 2/.test(p.querySelector(".art-palette-tools").textContent)')));
    await click('Reduce to 2 colours');
    check('reducing keeps two colours', await waitFor(`Object.keys(${SPRITE}.palette).length === 2`, 4000), await S(`JSON.stringify(${SPRITE}.palette)`));
    check('and the sprite is still a valid one with every pixel using a colour that exists', await S(`(() => { const sp = ${SPRITE}; return sp.frames.every((f) => f.every((r) => [...r].every((c) => c === "." || c in sp.palette))); })()`));
    await choose('Colour limit', '0');

    // swap and merge into
    const before = await S(`JSON.stringify(${SPRITE}.palette)`);
    const [k1, k2] = Object.keys(JSON.parse(before));
    await P(`(() => { p.querySelectorAll(".art-palette .swatch")[0].click(); return 1; })()`);
    await choose('Swap the selected colour with…', k2);
    check('swapping two colours exchanges them in the palette', await waitFor(`${SPRITE}.palette["${k1}"] === ${JSON.stringify(JSON.parse(before)[k2])} && ${SPRITE}.palette["${k2}"] === ${JSON.stringify(JSON.parse(before)[k1])}`, 4000));
    await P(`(() => { p.querySelectorAll(".art-palette .swatch")[0].click(); return 1; })()`);
    await choose('Merge the selected colour into…', k2);
    check('merging one colour into another leaves one', await waitFor(`Object.keys(${SPRITE}.palette).join() === "${k2}"`, 4000));

    // the tiled preview
    await S(`(s.project.write("src/art/hero.js", ${JSON.stringify(serializeSprite({ w: 4, h: 4, palette: { a: '#ff0000', b: '#0000ff' }, frames: [['abbb', 'baaa', 'baaa', 'bbbb']], animations: {} }))}), s.emit("files"), 1)`);
    await sleep(500);
    await P('(() => { const c = p.querySelector("input[aria-label=\\"Show the frame tiled\\"]"); c.checked = true; c.dispatchEvent(new Event("change", { bubbles: true })); return 1; })()');
    await sleep(400);
    const tile = await P(`(() => { const c = p.querySelectorAll("canvas.art-preview")[1]; const g = c.getContext("2d"); const px = (x, y) => [...g.getImageData(x, y, 1, 1).data].join(); return { visible: !c.hidden, a: px(2, 2), b: px(2 + 32, 2), c: px(2 + 64, 2 + 64), mid: px(10, 2) }; })()`);
    check('the tiled preview repeats the frame in a grid', tile.visible && tile.a === tile.b && tile.a === tile.c && tile.a !== tile.mid && tile.a.endsWith('255'), JSON.stringify(tile));

    // a game that plays the animation once
    await S(`(s.project.write("src/art/hero.js", ${JSON.stringify(SPRITE_TEXT.replace('"fps":8}', '"fps":8,"mode":"once"}'))}), s.project.write("src/main.js", ${JSON.stringify(GAME)}), s.emit("files"), 1)`);
    await sleep(600);
    await S('(s.run({ restart: true }), 1)');
    check('a game whose animation plays once ends on its last frame and says it is done',
      await waitFor('window.studio.runner.status === "running" && window.studio.runner.summary?.done === true && window.studio.runner.summary?.n > 40', 20_000)
      && (await S('s.runner.summary.frame')) === 2, await S('JSON.stringify(s.runner.summary)'));
    check('no problems were reported for the game', (await S('s.diagnostics.size')) === 0);
    const errs = page.errors.filter((e) => !/willReadFrequently|favicon/.test(e));
    check('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
  }, { width: 1500, height: 900 });
} finally { server.close(); }
process.exit(failed ? 1 : 0);
