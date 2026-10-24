// Live check, in a real Chrome with a real keyboard, of the Controls panel: make the controls file, add an action by pressing its key, add and remove keys, choose which settings the
// menu offers, use the real settings menu in the preview with the keyboard, see the accessibility report change as the game uses more of the kit, and run a game with the settings
// in place. Usage: node tools/studio-controls-test.js [outDir]
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
const PARSE = 'JSON.parse(window.studio.project.readText("src/controls.js").replace(/^[\\s\\S]*?export default /, "").replace(/;\\s*$/, ""))';

const BASIC = [
  "import { held, play, shake, label } from '@engine/arcade';",
  'export function create() { return { n: 0 }; }',
  "export function update(g, keys) { g.n++; if (held(keys, 'jump')) { play('jump'); shake(g); } }",
  "export function render(g, ctx) { ctx.fillStyle = '#123'; ctx.fillRect(0, 0, 480, 320); label(ctx, 'hi', 10, 20, { size: 10 }); }", '',
].join('\n');

try {
  await withChromePage(`http://localhost:${port}/studio/index.html`, async (page) => {
    const S = (expr) => page.eval(`(() => { const s = window.studio; return ${expr}; })()`);
    const P = (expr) => page.eval(`(() => { const p = document.querySelector('[aria-label="Controls and settings"]'); return p ? (${expr}) : null; })()`);
    const K = (expr) => page.eval(`(async () => { const k = await import('/packages/arcade/src/settings.js'); return ${expr}; })()`);
    const waitFor = (expr, ms = 8000) => page.waitFor(expr, ms);
    const press = async (code) => { await page.key(code, 'down'); await sleep(40); await page.key(code, 'up'); await sleep(40); };       // a person's tap lasts longer than one frame
    const click = (label) => P(`(() => { const b = [...p.querySelectorAll("button")].find((x) => x.textContent === ${JSON.stringify(label)}); if (!b) return false; b.click(); return true; })()`);
    const answer = async (value) => {
      await waitFor('!!document.querySelector(".dialog input[type=text]")', 3000);
      await page.eval('(() => { const i = document.querySelector(".dialog input[type=text]"); i.focus(); i.select(); return 1; })()');
      await page.type(value);
      await press('Enter');
      await waitFor('!document.querySelector(".dialog input[type=text]")', 3000);
    };

    check('the studio opens', await waitFor('!!window.studio && !!document.getElementById("dock")', 20_000));
    await S('(s.createProject({ name: "Controls test", template: "blank" }), 1)');
    await waitFor('window.studio.project?.name === "Controls test"', 10_000);
    await S(`(s.project.write("src/main.js", ${JSON.stringify(BASIC)}), s.emit("files"), s.dock.show("controls"), 1)`);
    check('the Controls panel offers to make the controls file', await waitFor('!!document.querySelector("[aria-label=\\"Controls and settings\\"]")', 5000) && (await P('p.textContent.includes("No controls yet")')));
    await click('Make the controls file');
    check('the file is made with every setting offered, and the built-in actions are listed with their keys', await waitFor('window.studio.project.has("src/controls.js")', 3000)
      && (await S(`${PARSE}.offer.length`)) === 7 && (await P('p.textContent.includes("Left arrow") && p.textContent.includes("jump") && p.textContent.includes("built in")')));
    // the report
    check('the report says what is missing in a game that reads keys and plays sounds', await P('p.querySelector(".controls-group")?.textContent.includes("To do")')
      && (await P('p.querySelector(".controls-report").textContent.includes("Players can choose their keys")')));
    const report = await P('p.querySelector(".controls-report").textContent');
    check('it names the screen shake with where it is, the small text, and the things to check by eye', /Screen shake can be turned off/.test(report) && /src\/main\.js:3/.test(report) && /Small text/.test(report) && /Colour alone/.test(report), report.slice(0, 120));
    // add an action by pressing its key
    await click('Add an action');
    await answer('fire');
    await sleep(200);
    check('the new action waits for a key', await P('p.textContent.includes("Press a key…")'));
    await press('KeyF');
    check('pressing F gives "fire" its first key, saved', await waitFor(`JSON.stringify(${PARSE}.actions.fire) === '["KeyF"]'`, 3000));
    // add and remove a key on a built-in action
    await P('(() => { p.querySelector("button[aria-label=\\"Add a key to left\\"]").click(); return 1; })()');
    await press('KeyJ');
    check('a key is added to a built-in action (it now says what it starts with in the file)', await waitFor(`JSON.stringify(${PARSE}.actions.left) === '["ArrowLeft","KeyA","KeyJ"]'`, 3000));
    await P('(() => { p.querySelector("button[aria-label=\\"Remove J from left\\"]").click(); return 1; })()');
    check('taking it away again puts the usual keys back (nothing left to say in the file)', await waitFor(`!("left" in ${PARSE}.actions)`, 3000));
    await P('(() => { p.querySelector("button[aria-label=\\"Add a key to right\\"]").click(); return 1; })()');
    await press('KeyF');
    check('a key that another action starts with is noticed', await P('p.textContent.includes("F also starts fire")'));
    // settings
    await P('(() => { const c = p.querySelector("input[aria-label=\\"Offer High contrast\\"]"); c.checked = false; c.dispatchEvent(new Event("change")); return 1; })()');
    check('switching a setting off removes it from the menu, saved', await waitFor(`!${PARSE}.offer.includes("highContrast") && ${PARSE}.offer.length === 6`, 3000));
    await P('(() => { const i = p.querySelector("input[aria-label=\\"Music starts at\\"]"); i.value = "0.5"; i.dispatchEvent(new Event("change")); return 1; })()');
    check('a starting value is saved', await waitFor(`${PARSE}.settings.musicVolume === 0.5`, 3000));
    // the real menu in the preview, with the keyboard
    await P('(() => { p.querySelector("canvas").focus(); return 1; })()');
    await sleep(300);
    check('the preview menu starts with what the file says (music at 0.5)', (await K('k.getSetting("musicVolume")')) === 0.5);
    await press('Enter');                                  // arms the menu (the key that opened it does nothing)
    await sleep(100);
    await press('ArrowDown');
    await press('ArrowDown');
    await press('ArrowLeft');
    await sleep(150);
    check('arrow keys change a setting in the real menu: Music went down a step', Math.abs((await K('k.getSetting("musicVolume")')) - 0.4) < 1e-9, await K('k.getSetting("musicVolume")'));
    await press('ArrowDown');
    await press('ArrowDown');
    await press('Enter');
    await sleep(150);
    check('Enter flips a yes/no setting (captions off)', (await K('k.getSetting("subtitles")')) === false);
    if (outDir) writeFileSync(join(outDir, 'controls-panel.png'), await page.screenshot());
    // the report follows the code
    await S('(s.dock.show("controls"), 1)');
    await sleep(100);
    const game = [
      "import { held, play, shake, label, controls, settings, openSettingsMenu, stepSettingsMenu, drawSettingsMenu, settingsMenuOpen, getSetting, caption, stepCaptions, drawCaptions } from '@engine/arcade';",
      "import setup from './controls.js';",
      'controls(setup.actions);',
      'settings(setup.settings);',
      'export function create() { const g = { n: 0, fired: 0 }; openSettingsMenu(g, { offer: setup.offer }); return g; }',
      "export function update(g, keys, dt) { g.n++; if (g.n < 0) play('jump'); if (settingsMenuOpen(g)) stepSettingsMenu(g, keys); if (held(keys, 'fire')) g.fired++; if (g.n === 3) caption(g, '[menu opens]'); stepCaptions(g, dt); }",
      "export function render(g, ctx) { ctx.fillStyle = '#123'; ctx.fillRect(0, 0, 480, 320); label(ctx, 'Hello', 10, 20, { size: 18 }); if (settingsMenuOpen(g)) drawSettingsMenu(ctx, g); drawCaptions(ctx, g); }",
      "export function summary(g) { return { n: g.n, open: settingsMenuOpen(g) ? 1 : 0, music: getSetting('musicVolume'), subs: getSetting('subtitles') ? 1 : 0, fireKeys: setup.actions.fire?.join('+') }; }", '',
    ].join('\n');
    await S(`(s.project.write("src/main.js", ${JSON.stringify(game)}), s.emit("files"), 1)`);
    await waitFor('/Players can choose their keys/.test(document.querySelector("[aria-label=\\"Controls and settings\\"] .controls-report")?.textContent ?? "")', 5000);
    check('once the game uses controls(), settings() and the menu, the report moves those items to Done',
      await waitFor('(() => { const r = document.querySelector("[aria-label=\\"Controls and settings\\"] .controls-report"); const ok = [...r.querySelectorAll(".controls-item.ok")].map((x) => x.textContent).join("|"); return /Players can choose their keys/.test(ok) && /Separate volumes/.test(ok) && /Captions/.test(ok); })()', 5000));
    check('a game with the settings in place runs, the menu is open, and the starting volume is the one from the file', await (async () => {
      await S('(s.run({ restart: true }), 1)');
      return waitFor('window.studio.runner.status === "running" && (window.studio.runner.summary?.n ?? 0) > 10', 15_000);
    })() && (await S('s.runner.summary.open')) === 1 && (await S('s.runner.summary.music')) === 0.5 && (await S('s.runner.summary.fireKeys')) === 'KeyF', await S('JSON.stringify(s.runner.summary)'));
    check('no problems were reported for the game', (await S('s.diagnostics.size')) === 0);
    const errs = page.errors.filter((e) => !/willReadFrequently|favicon/.test(e));
    check('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
  }, { width: 1500, height: 900 });
} finally { server.close(); }
process.exit(failed ? 1 : 0);
