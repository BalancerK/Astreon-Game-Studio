// Live check, in a real Chrome with a real mouse, of the Clips panel: make a clip from a preset, see its curve and keys, add a key by clicking, drag a key, set its easing,
// play it, add a track, and run a game that plays the clip. Usage: node tools/studio-clips-test.js [outDir]
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
const PARSE = 'JSON.parse(window.studio.project.readText("src/clips.js").replace(/^[\\s\\S]*?export default /, "").replace(/;\\s*$/, ""))';

try {
  await withChromePage(`http://localhost:${port}/studio/index.html`, async (page) => {
    const S = (expr) => page.eval(`(() => { const s = window.studio; return ${expr}; })()`);
    const P = (expr) => page.eval(`(() => { const p = document.querySelector('[aria-label="Clips"]'); return p ? (${expr}) : null; })()`);
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
    const setField = (label, value) => P(`(() => { const i = p.querySelector('[aria-label="${label}"]'); i.value = ${JSON.stringify(value)}; i.dispatchEvent(new Event('change')); return 1; })()`);
    /** Where a key (or a place in a lane) is on the screen. */
    const keyAt = (field, i) => P(`(() => { const r = p.querySelector('[data-key="${field}:${i}"]').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`);
    const laneBox = (field) => P(`(() => { const r = p.querySelector('[data-lane="${field}"]').getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; })()`);
    const drag = async (from, to) => {
      await page.mouse('mousePressed', from[0], from[1]);
      await page.mouse('mouseMoved', (from[0] + to[0]) / 2, (from[1] + to[1]) / 2, { buttons: 1 });
      await page.mouse('mouseMoved', to[0], to[1], { buttons: 1 });
      await page.mouse('mouseReleased', to[0], to[1]);
    };

    check('the studio opens', await waitFor('!!window.studio && !!document.getElementById("dock")', 20_000));
    await S('(s.createProject({ name: "Clips test", template: "blank" }), 1)');
    await waitFor('window.studio.project?.name === "Clips test"', 10_000);
    await S('(s.dock.show("clips"), 1)');
    check('the Clips panel offers to make a bobbing clip', await waitFor('!!document.querySelector("[aria-label=\\"Clips\\"]")', 5000) && (await P('p.textContent.includes("No clips yet")')));
    await click('Make a bobbing clip');
    await answer('bob');
    check('the clip is saved in src/clips.js', await waitFor('window.studio.project.has("src/clips.js")', 3000) && (await S('s.project.readText("src/clips.js")')).includes('"bob"'));
    check('one lane for y with three keys and a curve', (await P('p.querySelectorAll("[data-lane]").length')) === 1 && (await P('p.querySelectorAll("[data-key]").length')) === 3
      && (await P('p.querySelector(".lane-curve").getAttribute("d").length')) > 100);
    check('nothing is flagged for the preset', await P('p.querySelector(".text-issues")?.hidden === true'));
    if (outDir) writeFileSync(join(outDir, 'clips-panel.png'), await page.screenshot());
    // click an empty place in the lane: adds a key
    const [lx, ly, lw, lh] = await laneBox('y');
    await page.mouse('mousePressed', lx + lw * 0.25, ly + lh * 0.5);
    await page.mouse('mouseReleased', lx + lw * 0.25, ly + lh * 0.5);
    check('clicking an empty place adds a key there (4 keys, in time order)', await waitFor(`${PARSE}.bob.tracks.y.length === 4`, 3000)
      && (await S(`${PARSE}.bob.tracks.y.map((k) => k[0]).join(",")`)).split(',').every((t, i, a) => i === 0 || Number(t) >= Number(a[i - 1])));
    check('the new key is the picked one and its time is shown', await P('p.querySelector("input[aria-label=\\"At (s)\\"]")?.value') !== null
      && Math.abs(Number(await P('p.querySelector("input[aria-label=\\"At (s)\\"]").value')) - 0.25) < 0.08, await P('p.querySelector("input[aria-label=\\"At (s)\\"]")?.value'));
    // drag the middle key up (a bigger value) and to the right
    const keys = await P('p.querySelectorAll("[data-key]").length');
    const mid = await keyAt('y', 2);
    const before = (await S(`JSON.stringify(${PARSE}.bob.tracks.y[2])`));
    await drag(mid, [mid[0] + 40, mid[1] - 20]);
    await sleep(700);                                              // the file is saved a moment after the mouse lets go
    const after = (await S(`JSON.stringify(${PARSE}.bob.tracks.y[2])`));
    check('dragging a key with the mouse changes its time and its value, and it is saved', after !== before && keys === 4,
      `${before} -> ${after}; track ${await S(`JSON.stringify(${PARSE}.bob.tracks.y)`)}; key at ${mid}`);
    // set the easing of the picked key
    await P('(() => { const s = p.querySelector("select[aria-label=\\"How this key moves on to the next\\"]"); s.value = "step"; s.dispatchEvent(new Event("change")); return 1; })()');
    check('setting how the key moves on is saved', await waitFor('/"step"/.test(window.studio.project.readText("src/clips.js"))', 3000));
    // type exact numbers
    await setField('Value', '55');
    check('typing an exact value moves the key', await waitFor(`${PARSE}.bob.tracks.y.some((k) => k[1] === 55)`, 3000));
    // remove that key with the keyboard
    await P('(() => { p.querySelector(".key.on").focus(); return 1; })()');
    await press('Delete');
    check('Delete removes the picked key', await waitFor(`${PARSE}.bob.tracks.y.length === 3`, 3000));
    // length and loop
    await setField('Length in seconds', '2');
    check('changing the length is saved', await waitFor(`${PARSE}.bob.duration === 2`, 3000));
    await click('Add a track');
    await answer('alpha');
    check('Add a track makes a second lane', await waitFor('document.querySelectorAll("[aria-label=\\"Clips\\"] [data-lane]").length === 2', 3000));
    // play
    await click('Play');
    await sleep(700);
    const stage1 = await P('p.querySelector(".clip-stage").toDataURL().length');
    check('Play moves the playhead (the pause button shows)', (await P('[...p.querySelectorAll("button")].some((b) => b.textContent === "Pause")')) && stage1 > 0);
    await click('Pause');
    // a game that plays the clip
    const game = [
      "import { newGame, clear, label, stepClip } from '@engine/arcade';",
      "import clips from './clips.js';",
      'export function create() { return newGame({ coin: { y: 0, alpha: 0 }, n: 0 }); }',
      'export function update(game) { game.n++; stepClip(game.coin, clips.bob, 1 / 60); }',
      "export function render(game, g) { clear(g); label(g, 'y ' + Math.round(game.coin.y), 12, 24); }",
      'export function summary(game) { return { n: game.n, y: game.coin.y, alpha: game.coin.alpha }; }', '',
    ].join('\n');
    await S(`(s.project.write("src/main.js", ${JSON.stringify(game)}), s.run({ restart: true }), 1)`);
    check('a game that plays the clip runs and the clip moves the coin', await waitFor('window.studio.runner.status === "running" && (window.studio.runner.summary?.n ?? 0) > 40', 15_000)
      && typeof (await S('s.runner.summary.y')) === 'number' && (await S('s.runner.summary.alpha')) !== 0, await S('JSON.stringify(s.runner.summary)'));
    check('no problems were reported for the game', (await S('s.diagnostics.size')) === 0);
    const errs = page.errors.filter((e) => !/willReadFrequently|favicon/.test(e));
    check('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
  }, { width: 1500, height: 900 });
} finally { server.close(); }
process.exit(failed ? 1 : 0);
