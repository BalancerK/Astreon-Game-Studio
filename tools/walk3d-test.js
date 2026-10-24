// Live check of the 3D stack in a real browser: the Walk 3D example is driven with real key events and the character's
// state is read back. Usage: node tools/walk3d-test.js [outDir]
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createStaticServer } from './static-server.js';
import { withChromePage } from './cdp.js';

const outDir = process.argv[2] ?? '.';
mkdirSync(outDir, { recursive: true });
const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const server = createStaticServer({ root: decodeURIComponent(root), index: '/examples/walk3d/index.html' });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
let failed = false;
const check = (name, ok, detail = '') => { if (!ok) failed = true; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `  (${detail})` : ''}`); };

try {
  for (const renderer of ['webgpu', 'webgl2']) {
    console.log(`--- ${renderer}`);
    await withChromePage(`http://127.0.0.1:${server.address().port}/examples/walk3d/index.html?renderer=${renderer}`, async (page) => {
      const ready = await page.waitFor("window.__walk && window.__walk.player.grounded", 15_000);
      check('loads, the character falls to the ground', ready, page.errors.filter((e) => !/willReadFrequently/.test(e)).slice(0, 2).join(' | '));
      if (!ready) throw new Error('did not start');
      check('uses the requested backend', (await page.eval('window.__walk.renderer3d.kind')) === renderer);
      const state = () => page.eval('(() => { const p = window.__walk.player; return { x: p.x, y: p.y, z: p.z, feet: p.feetY, grounded: p.grounded, blocked: p.blocked }; })()');
      const place = (x, y, z, yaw) => page.eval(`(() => { const w = window.__walk; w.player.x = ${x}; w.player.y = ${y}; w.player.z = ${z}; w.player.vy = 0; w.player.grounded = false; w.look.yaw = ${yaw}; w.look.pitch = 0; })()`);
      const hold = async (code, ms) => { await page.key(code); await page.sleep(ms); await page.key(code, 'up'); };

      // flat ground: walking moves at the walking speed
      await place(-5, 1, -2, 0); await page.sleep(500);
      const a = await state();
      await hold('KeyW', 1000);
      const b = await state();
      check('W walks forward (-z) at about 4.5 m/s', b.z < a.z - 3.8 && b.z > a.z - 5.2 && Math.abs(b.x - a.x) < 0.1, `moved ${(a.z - b.z).toFixed(2)} m in 1 s`);

      // stairs: 8 steps of 0.25 m
      await place(2, 1, 12, -Math.PI / 2); await page.sleep(500);
      await hold('KeyW', 2200);
      const s = await state();
      check('climbs a staircase onto the platform (feet at 2 m)', Math.abs(s.feet - 2) < 0.05 && s.grounded && s.x > 9.5, `feet ${s.feet.toFixed(2)}, x ${s.x.toFixed(2)}`);

      // jump
      await page.key('Space');
      let peak = 0;
      for (let i = 0; i < 12; i++) { await page.sleep(60); peak = Math.max(peak, (await state()).feet); }
      await page.key('Space', 'up');
      check('Space jumps about 1.3 m', peak > s.feet + 0.9 && peak < s.feet + 1.6, `peak ${(peak - s.feet).toFixed(2)} m above the platform`);
      await page.sleep(1200);

      // the 0.6 m block cannot be stepped onto
      await place(0, 1, 14, 0); await page.sleep(500);
      await hold('KeyW', 2000);
      const blk = await state();
      check('a 0.6 m block is a wall (not a step)', blk.z > 10.2 && blk.feet < 0.1, `z ${blk.z.toFixed(2)}, feet ${blk.feet.toFixed(2)}`);

      // walkable ramp
      await place(-12, 1, -1, 0); await page.sleep(500);
      await hold('KeyW', 3600);
      const ramp = await state();
      check('walks up the 30 degree ramp to the landing', ramp.feet > 5.4 && ramp.grounded, `feet ${ramp.feet.toFixed(2)}`);

      // steep ramp
      await place(10, 1, -1, 0); await page.sleep(500);
      await hold('KeyW', 2000);
      const steep = await state();
      check('the 60 degree ramp cannot be climbed', steep.z > -6.8 && steep.feet < 0.3, `z ${steep.z.toFixed(2)}, feet ${steep.feet.toFixed(2)}`);

      // rendering is alive and the HUD canvas is stacked above the 3D canvas
      const fps = await page.eval('window.__walk.hud && document.querySelectorAll("#stage canvas").length');
      check('a 3D canvas and a transparent HUD canvas are on the page', fps === 2);
      await place(-8, 1, 0, 0.6); await page.sleep(600);
      writeFileSync(join(outDir, `walk3d-${renderer}.png`), await page.screenshot());
      const errs = page.errors.filter((e) => !/willReadFrequently/.test(e));
      check('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
    });
  }
} finally {
  server.close();
}
process.exit(failed ? 1 : 0);
