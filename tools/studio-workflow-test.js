// Live check, in a real Chrome, of the workflow items: the Resources panel (what the game loads, what is unused, removing a file), build profiles in the Ship panel (a new
// profile, what it leaves out, what the build contains, which build the game is told it is), and the Tests panel (make a test file, run it in its own worker, see passes and
// failures, a file that will not load, a test stuck in a loop being stopped). Usage: node tools/studio-workflow-test.js [outDir]
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

const MAIN = [
  "import { build } from '@engine/arcade';",
  "import hero from './art/hero.js';",
  'export function create() { return { n: 0, hero: hero.w, build: build().name, debug: build().debug }; }',
  'export function update(game) { game.n++; }',
  "export function render(game, g) { g.fillStyle = '#123'; g.fillRect(0, 0, 480, 320); }",
  'export function summary(game) { return { n: game.n, build: game.build, debug: game.debug ? 1 : 0 }; }', '',
].join('\n');

try {
  await withChromePage(`http://localhost:${port}/studio/index.html`, async (page) => {
    const S = (expr) => page.eval(`(() => { const s = window.studio; return ${expr}; })()`);
    const panel = (label) => (expr) => page.eval(`(() => { const p = document.querySelector('[aria-label="${label}"]'); return p ? (${expr}) : null; })()`);
    const R = panel('Resources');
    const SH = panel('Ship');
    const T = panel('Tests');
    const waitFor = (expr, ms = 8000) => page.waitFor(expr, ms);
    const press = async (code) => { await page.key(code, 'down'); await page.key(code, 'up'); };
    const click = (P) => (label) => P(`(() => { const b = [...p.querySelectorAll("button")].find((x) => x.textContent === ${JSON.stringify(label)}); if (!b) return false; b.click(); return true; })()`);
    const answer = async (value) => {
      await waitFor('!!document.querySelector(".dialog input[type=text]")', 3000);
      await page.eval('(() => { const i = document.querySelector(".dialog input[type=text]"); i.focus(); i.select(); return 1; })()');
      await page.type(value);
      await press('Enter');
      await waitFor('!document.querySelector(".dialog input[type=text]")', 3000);
    };

    check('the studio opens', await waitFor('!!window.studio && !!document.getElementById("dock")', 20_000));
    await S('(s.createProject({ name: "Workflow test", template: "blank" }), 1)');
    await waitFor('window.studio.project?.name === "Workflow test"', 10_000);
    await S(`(s.project.write("src/main.js", ${JSON.stringify(MAIN)}), s.project.write("src/art/hero.js", "export default { w: 16, h: 16, palette: {}, frames: [[]], animations: {} };"), `
      + 's.project.write("src/art/unused.js", "export default { w: 8 };"), s.project.write("notes/ideas.md", "# ideas"), s.emit("files"), 1)');

    // ---- Resources ----
    await S('(s.dock.show("resources"), 1)');
    check('the Resources panel lists the files and says what nothing reaches', await waitFor('!!document.querySelector("[aria-label=\\"Resources\\"] .resource-row")', 5000)
      && (await R('p.textContent.includes("nothing reaches")')) && (await R('p.textContent.includes("src/art/unused.js")')));
    check('used files are marked used, the unused one is marked unused', await R('(() => { const row = (n) => [...p.querySelectorAll(".resource-row")].find((r) => r.textContent.includes(n)); return row("src/art/hero.js").textContent.includes("by src/main.js") && row("src/art/unused.js").classList.contains("unused"); })()'));
    if (outDir) writeFileSync(join(outDir, 'resources.png'), await page.screenshot());
    await R('(() => { p.querySelector("button[aria-label=\\"Remove src/art/unused.js\\"]").click(); return 1; })()');
    await waitFor('!!document.querySelector(".dialog")', 3000);
    await page.eval('(() => { [...document.querySelectorAll(".dialog button")].find((b) => b.textContent === "Remove").click(); return 1; })()');
    check('removing an unused file asks first, then takes it away', await waitFor('!window.studio.project.has("src/art/unused.js")', 3000));

    // ---- Build profiles ----
    await S('(s.dock.show("ship"), 1)');
    check('the Ship panel has build profiles: release and debug', await waitFor('!!document.querySelector("[aria-label=\\"Ship\\"] select[aria-label=\\"Build profile\\"]")', 5000)
      && (await SH('[...p.querySelectorAll("select[aria-label=\\"Build profile\\"] option")].map((o) => o.value).join()')) === 'release,debug');
    check('the release profile leaves out tests by default and the debug build is a debug build', await SH('p.querySelector("textarea[aria-label=\\"Files this profile leaves out\\"]").value.includes("tests/**")')
      && (await S('s.ship.profiles.profiles.debug.debug')) === true);
    await S('(s.project.write("tests/a.test.js", "// a test"), s.emit("files"), 1)');
    await click(SH)('New profile…');
    await answer('itch');
    check('a new profile is made (a copy of release), chosen, and saved in build.json', await waitFor('window.studio.project.has("build.json")', 3000) && (await S('s.ship.profiles.selected')) === 'itch');
    await SH('(() => { const t = p.querySelector("textarea[aria-label=\\"Files this profile leaves out\\"]"); t.value = "tests/**\\nnotes"; t.dispatchEvent(new Event("change")); return 1; })()');
    check('what the profile leaves out is saved and the panel says how much', await waitFor('/notes/.test(window.studio.project.readText("build.json"))', 3000)
      && await waitFor('/leaves out 2 files/.test(document.querySelector("[aria-label=\\"Ship\\"] .ship-profiles")?.textContent ?? "")', 3000));
    const built = await S('s.ship.build().then((b) => JSON.stringify({ files: Object.keys(b.files), html: b.files["index.html"].match(/"build":\\{[^}]*\\}/)?.[0], sw: "sw.js" in b.files }))').then((t) => JSON.parse(t));
    check('the itch build leaves out the tests and the notes, and tells the page it is "itch", not a debug build', !built.files.some((f) => /tests\/|notes\//.test(f)) && built.files.includes('game/src/main.js')
      && built.html === '"build":{"name":"itch","debug":false}' && built.sw === true, JSON.stringify(built.html));
    await SH('(() => { const s = p.querySelector("select[aria-label=\\"Build profile\\"]"); s.value = "debug"; s.dispatchEvent(new Event("change")); return 1; })()');
    await waitFor('window.studio.ship.profiles.selected === "debug"', 3000);
    const debugBuild = await S('s.ship.build().then((b) => JSON.stringify({ files: Object.keys(b.files), html: b.files["index.html"].match(/"build":\\{[^}]*\\}/)?.[0], sw: "sw.js" in b.files }))').then((t) => JSON.parse(t));
    check('the debug build keeps the tests and is a debug build that does not work offline', debugBuild.files.includes('game/tests/a.test.js') && debugBuild.html === '"build":{"name":"debug","debug":true}' && debugBuild.sw === false);
    await S('(s.setProfiles = null, s.ship.setProfiles(JSON.parse(JSON.stringify(Object.assign({}, s.ship.profiles, { selected: "debug", profiles: { ...s.ship.profiles.profiles, debug: { ...s.ship.profiles.profiles.debug, exclude: ["src/art"] } } })))), 1)');
    await waitFor('/imports src\\/art/.test(document.querySelector("[aria-label=\\"Ship\\"] .ship-profiles")?.textContent ?? "")', 3000);
    check('a profile that leaves out a file the game imports is warned about, and its build is refused with the reason',
      /would not work/.test(await SH('p.querySelector(".ship-profiles").textContent'))
      && /imports|leaves out/.test(await S('s.ship.build().then(() => "built", (e) => e.message)')));
    await S('(s.ship.setProfiles(s.ship.profiles && JSON.parse(JSON.stringify({ ...s.ship.profiles, selected: "release", profiles: { ...s.ship.profiles.profiles, debug: { ...s.ship.profiles.profiles.debug, exclude: [] } } }))), 1)');
    if (outDir) writeFileSync(join(outDir, 'ship-profiles.png'), await page.screenshot());
    // the game inside the studio is a debug build called dev
    await S('(s.run({ restart: true }), 1)');
    check('inside the studio the game is told it is the "dev" debug build', await waitFor('window.studio.runner.status === "running" && (window.studio.runner.summary?.n ?? 0) > 5', 15_000)
      && (await S('s.runner.summary.build')) === 'dev' && (await S('s.runner.summary.debug')) === 1, await S('JSON.stringify(s.runner.summary)'));

    // ---- Tests ----
    await S('(s.dock.show("tests"), 1)');
    check('the Tests panel shows tests (the one made above is a comment, so no checks) and offers a ready-made file', await waitFor('!!document.querySelector("[aria-label=\\"Tests\\"]")', 5000));
    await S('(s.project.remove("tests/a.test.js"), s.emit("files"), 1)');
    await sleep(200);
    check('with no test files it offers to make one', await T('p.textContent.includes("No tests yet")'));
    await click(T)('Make a test file');
    check('a ready-made test file is made and opened', await waitFor('window.studio.project.has("tests/game.test.js")', 3000));
    await click(T)('Run the tests');
    check('running it passes both checks (the game starts, and keeps going for a second of play)', await waitFor('/All 2 passed/.test(document.querySelector("[aria-label=\\"Tests\\"]")?.textContent ?? "")', 15_000));
    if (outDir) writeFileSync(join(outDir, 'tests-pass.png'), await page.screenshot());
    const bad = [
      "import { test, expect, simulate } from '@engine/arcade';",
      "import * as game from '../src/main.js';",
      "test('counts every tick', () => { expect(simulate(game, 60).n).toBe(60); });",
      "test('a wrong answer', () => { expect(simulate(game, 10).n).toBe(11); });",
      "test('an exact comparison', () => { expect({ a: [1, 2] }).toEqual({ a: [1, 3] }); });", '',
    ].join('\n');
    await S(`(s.project.write("tests/bad.test.js", ${JSON.stringify(bad)}), s.project.write("tests/broken.test.js", "this is not javascript {"), s.emit("files"), 1)`);
    await click(T)('Run the tests');
    await waitFor('/failed/.test(document.querySelector("[aria-label=\\"Tests\\"] .ship-verdict")?.textContent ?? "")', 15_000);
    const verdict = await T('p.querySelector(".ship-verdict").textContent');
    check('failures are counted: 3 passed, 3 failed (two wrong checks and a file that cannot load)', /3 failed, 3 passed/.test(verdict), verdict);
    check('a failed check says what was expected and what it got', await T('p.textContent.includes("Expected 10 to be 11.") && p.textContent.includes("expected 11, got 10")'));
    check('a file that cannot load is one failed check with a reason', await T('(() => { const f = [...p.querySelectorAll(".test-file")].find((x) => x.textContent.includes("broken.test.js")); return !!f && f.textContent.includes("(loading this file)"); })()'));
    check('clicking a file name opens it', await T('(() => { [...p.querySelectorAll(".test-file-head .link")].find((b) => b.textContent === "tests/bad.test.js").click(); return 1; })()')
      && await waitFor('window.studio.activeFile === "tests/bad.test.js"', 3000));
    // fix the failures: auto-run
    await T('(() => { const c = p.querySelector("input[type=checkbox]"); c.checked = true; c.dispatchEvent(new Event("change")); return 1; })()');
    await waitFor('/failed/.test(document.querySelector("[aria-label=\\"Tests\\"] .ship-verdict")?.textContent ?? "")', 15_000);
    await S('(s.project.write("tests/bad.test.js", "import { test, expect } from \'@engine/arcade\';\\ntest(\'fine now\', () => { expect(1).toBe(1); });\\n"), s.project.remove("tests/broken.test.js"), s.emit("files"), s.emit("file-changed", { path: "tests/bad.test.js" }), 1)');
    check('with "Run when I change a file" on, fixing the tests re-runs them by itself', await waitFor('/All 3 passed/.test(document.querySelector("[aria-label=\\"Tests\\"] .ship-verdict")?.textContent ?? "")', 20_000));
    await T('(() => { const c = p.querySelector("input[type=checkbox]"); c.checked = false; c.dispatchEvent(new Event("change")); return 1; })()');
    // a test stuck in a loop is stopped, and the game goes on
    await S('(s.project.write("tests/loop.test.js", "import { test } from \'@engine/arcade\';\\ntest(\'never ends\', () => { for (;;) {} });\\n"), s.emit("files"), 1)');
    await click(T)('Run the tests');
    check('a test stuck in a loop is stopped after a while with a plain message', await waitFor('/took too long/.test(document.querySelector("[aria-label=\\"Tests\\"] .ship-verdict")?.textContent ?? "")', 30_000));
    check('and the game itself is not disturbed', (await S('s.runner.status')) === 'running' && (await S('s.diagnostics.size')) === 0);
    const errs = page.errors.filter((e) => !/willReadFrequently|favicon/.test(e));
    check('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
  }, { width: 1500, height: 900 });
} finally { server.close(); }
process.exit(failed ? 1 : 0);
