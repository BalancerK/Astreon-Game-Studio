// Live check, in a real Chrome, of the mouse and full screen in the studio's game frame: a game that asks for the mouse (the 3D template) gets it when the game
// is clicked, moving the mouse turns the view (the movement arrives as a held key and so is recorded by the Time Machine), Esc lets go, the Full screen button makes
// the game fill the screen with the keyboard still working, and Esc leaves it. A game that never asks keeps its pointer. Usage: node tools/studio-mouse-test.js [outDir]
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

try {
  await withChromePage(`http://localhost:${port}/studio/index.html`, async (page) => {
    const S = (expr) => page.eval(`(() => { const s = window.studio; return ${expr}; })()`);
    const waitFor = (expr, ms = 10_000) => page.waitFor(expr, ms);
    const rect = async () => JSON.parse(await page.eval('JSON.stringify(document.querySelector(".game-frame").getBoundingClientRect())'));
    const clickGame = async () => {
      const b = await rect();
      const x = b.left + b.width / 2;
      const y = b.top + b.height / 2;
      await page.mouse('mouseMoved', x, y);
      await page.mouse('mousePressed', x, y);
      await page.mouse('mouseReleased', x, y);
      return { x, y };
    };
    const summary = async () => JSON.parse(await S('JSON.stringify(s.runner.summary)'));
    const hold = async (code, ms) => { await page.key(code, 'down'); await sleep(ms); await page.key(code, 'up'); };

    check('the studio opens', await waitFor('!!window.studio && !!document.getElementById("dock")', 20_000));

    // a game that never asks for the mouse keeps its pointer
    await S('(s.createProject({ name: "No mouse", template: "hero" }), 1)');
    await waitFor('window.studio.project?.name === "No mouse"', 10_000);
    await S('(s.run({ restart: true }), 1)');
    await waitFor('window.studio.runner.status === "running"', 15_000);
    await clickGame();
    await sleep(500);
    check('a game that does not want the mouse never takes it (a click does not even try)', (await S('s.runner.mouseLocked')) !== true && !(await S('s.runner.mouseProblem')));

    // the 3D game asks, and gets it on a click
    await S('(s.createProject({ name: "Look test", template: "world3d" }), 1)');
    await waitFor('window.studio.project?.name === "Look test"', 10_000);
    await S('(s.run({ restart: true }), 1)');
    check('the 3D game runs', await waitFor('window.studio.runner.status === "running" && window.studio.runner.summary?.gemsLeft === 5', 15_000));
    if (outDir) writeFileSync(join(outDir, 'mouse-hint.png'), await page.screenshot());
    const before = await summary();
    await clickGame();
    await waitFor('window.studio.runner.mouseLocked === true || !!window.studio.runner.mouseProblem', 5000);
    const lockedNow = await S('s.runner.mouseLocked');
    const problem = await S('s.runner.mouseProblem');
    // headless Chrome has no real pointer to hold ("not valid for pointer lock"): there the click is still tried, and its refusal is reported, not hidden
    check('a click on the game tries to take hold of the mouse, and the studio hears whether it did', lockedNow === true || /not allow|not valid|pointer/i.test(problem), `locked ${lockedNow}; ${problem}`);
    // the movement itself: the same held key the page sends while the mouse is held (real mouse hardware is not available to a headless browser)
    await S('(s.runner.key("Mouse:0:0", true), 1)');
    await sleep(150);
    await S('(s.runner.key("Mouse:0:0", false), s.runner.key("Mouse:-120:0", true), 1)');
    await sleep(300);
    const after = await summary();
    check('mouse movement turns the view: left is a positive turn', after.yaw > before.yaw + 0.2, `yaw ${before.yaw} -> ${after.yaw}`);
    await S('(s.runner.key("Mouse:-120:0", false), s.runner.key("Mouse:-120:-60", true), 1)');
    await sleep(300);
    check('and up and down move nothing but the tilt', (await summary()).yaw === after.yaw);
    check('and the keyboard still walks at the same time', await (async () => { const z0 = (await summary()).z; await hold('KeyW', 700); return (await summary()).z < z0 - 1; })());
    if (outDir) writeFileSync(join(outDir, 'mouse-look.png'), await page.screenshot());

    // full screen
    await page.eval('document.querySelector(".game-frame").scrollIntoView?.()');
    const button = JSON.parse(await page.eval('JSON.stringify((() => { const b = [...document.querySelectorAll("button")].find((x) => x.textContent === "Full screen"); const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })())'));
    await page.mouse('mouseMoved', button.x, button.y);
    await page.mouse('mousePressed', button.x, button.y);
    await page.mouse('mouseReleased', button.x, button.y);
    const isFull = await waitFor('document.fullscreenElement === document.querySelector(".game-frame")', 6000);
    check('the Full screen button makes the game fill the screen', isFull);
    if (isFull) {
      const size = JSON.parse(await page.eval('JSON.stringify({ w: document.querySelector(".game-frame").getBoundingClientRect().width, h: document.querySelector(".game-frame").getBoundingClientRect().height, iw: innerWidth, ih: innerHeight })'));
      check('and the frame is as big as the screen', size.w >= size.iw - 2 && size.h >= size.ih - 2, JSON.stringify(size));
      const z0 = (await summary()).z;
      await hold('KeyW', 600);
      check('the keyboard still works in full screen', (await summary()).z < z0 - 0.8);
      if (outDir) writeFileSync(join(outDir, 'fullscreen.png'), await page.screenshot());
      await page.eval('document.exitFullscreen()');
      check('leaving full screen puts the game back in its place', await waitFor('!document.fullscreenElement && document.querySelector(".game-frame").getBoundingClientRect().width < innerWidth - 100', 6000));
    }
    const errs = page.errors.filter((e) => !/willReadFrequently|favicon/.test(e));
    check('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
  }, { width: 1500, height: 900 });
} finally { server.close(); }
process.exit(failed ? 1 : 0);
