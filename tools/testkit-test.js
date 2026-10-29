// Checks `@engine/testkit` against a real browser: a page is opened, evaluated, resized with a pixel ratio, its errors read, its frames timed, a raw DevTools call made, and the browser is gone afterwards.
import { withChromePage, measureFrames, processesOfProfile } from '../packages/testkit/src/index.js';

let bad = 0;
const check = (name, ok, detail = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ` ${detail}`}`); if (!ok) bad++; };
const page = 'data:text/html,' + encodeURIComponent('<!doctype html><title>kit</title><canvas id=c></canvas><script>window.ready = 1; setTimeout(() => { throw new Error("late failure"); }, 200); console.error("logged error");</script>');
const before = processesOfProfile('engine-cdp-').length;                              // (every browser the kit starts has a profile folder with this in its name)
await withChromePage(page, async (p) => {
  check('the page is evaluated', (await p.waitFor('window.ready === 1', 10_000)) && (await p.eval('document.title')) === 'kit');
  await new Promise((r) => setTimeout(r, 600));
  check('errors are collected (a throw and a console.error)', p.errors.some((e) => /late failure/.test(e)) && p.errors.some((e) => /logged error/.test(e)), JSON.stringify(p.errors));
  await p.setViewport(800, 500, 2);
  check('setViewport sets the size and the pixel ratio', (await p.eval('[innerWidth, innerHeight, devicePixelRatio].join()')) === '800,500,2');
  const f = await measureFrames(p, { seconds: 1 });
  check('frames are timed', f.frames > 5 && f.ms > 0 && Math.abs(f.fps - 1000 / f.ms) < 1e-9, JSON.stringify(f));
  const r = await p.send('Runtime.evaluate', { expression: '6 * 7', returnByValue: true });
  check('a raw DevTools call works', r.result.value === 42);
}, { width: 640, height: 360 });
await new Promise((r) => setTimeout(r, 1500));
check('no browser of that run is left behind', processesOfProfile('engine-cdp-').length <= before, `${processesOfProfile('engine-cdp-').length} processes, ${before} before`);
console.log(bad ? `${bad} failed` : 'testkit-test: PASS');
process.exit(bad ? 1 : 0);
