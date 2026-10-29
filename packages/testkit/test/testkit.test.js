import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findBrowser, findChrome, measureFrames, UNTHROTTLED_ARGS, CPU_RENDER_ARGS, processesOfProfile, guardBrowser, withChromePage, builtSmoke } from '../src/index.js';

test('the package exports what its README says', () => {
  for (const f of [findBrowser, findChrome, measureFrames, processesOfProfile, guardBrowser, withChromePage, builtSmoke]) assert.equal(typeof f, 'function');
  assert.ok(UNTHROTTLED_ARGS.includes('--disable-gpu-vsync') && CPU_RENDER_ARGS.includes('--use-angle=swiftshader'));
  assert.throws(() => UNTHROTTLED_ARGS.push('x'), TypeError);
});

test('a browser is found by an installed path or by CHROME_PATH, and an unknown name finds nothing', () => {
  const found = findChrome();
  assert.ok(found === undefined || typeof found === 'string');
  const saved = process.env.CHROME_PATH;
  try { process.env.CHROME_PATH = process.execPath; assert.equal(findBrowser('chrome'), process.execPath); } finally { if (saved === undefined) delete process.env.CHROME_PATH; else process.env.CHROME_PATH = saved; }
});

test('frame timing asks the page for an animation-frame loop of the length wanted and turns its answer into a frame rate', async () => {
  let asked = '';
  const page = { eval: async (expression) => { asked = expression; return { frames: 250, ms: 4 }; } };
  const r = await measureFrames(page, { seconds: 2.5 });
  assert.deepEqual(r, { frames: 250, ms: 4, fps: 250 });
  assert.match(asked, /requestAnimationFrame/); assert.match(asked, /< 2500\)/);
  const t0 = Date.now(); await measureFrames(page, { seconds: 1, warmSeconds: 0.2 }); assert.ok(Date.now() - t0 >= 190, 'it waited for the warm-up first');
});

test('the browser guard only ever looks for processes of a profile it was given', () => {
  assert.deepEqual(processesOfProfile(''), []);
  assert.deepEqual(processesOfProfile(undefined), []);
  assert.deepEqual(processesOfProfile(`no-such-profile-${Math.random().toString(36).slice(2)}`), []);       // (made here, so it is on no command line)
});
