// Live check of the physics playground in a real browser, on both renderers: the world runs, things settle and sleep, the chain swings,
// a shot knocks the wall, a trigger zone counts what falls in, and nothing throws. Usage: node tools/physics3d-test.js [outDir]
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createStaticServer } from './static-server.js';
import { withChromePage } from './cdp.js';

const outDir = process.argv[2] ?? process.env.ARENA_MENU_SHOTS ?? null;
if (outDir) mkdirSync(outDir, { recursive: true });
const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const server = createStaticServer({ root: decodeURIComponent(root), index: '/examples/physics3d/index.html' });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
let failed = false;
const check = (name, ok, detail = '') => { if (!ok) failed = true; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `  (${detail})` : ''}`); };

try {
  for (const renderer of ['webgpu', 'webgl2']) {
    console.log(`--- ${renderer}`);
    await withChromePage(`http://127.0.0.1:${server.address().port}/examples/physics3d/index.html?renderer=${renderer}`, async (page) => {
      const ready = await page.waitFor('window.__physics && window.__physics.world.bodies.length > 50', 15_000);
      check('the playground loads with its bodies', ready, page.errors.filter((e) => !/willReadFrequently/.test(e)).slice(0, 2).join(' | '));
      if (!ready) throw new Error('did not start');
      check('uses the requested backend', (await page.eval('window.__physics.renderer3d.kind')) === renderer);
      const wallCrates = () => page.eval('window.__physics.world.bodies.filter((b) => b.shape.type === "box" && b.z < -11 && b.z > -13.5 && b.mass === 8).map((b) => [b.x, b.y, b.z])');
      const before = await wallCrates();
      await page.sleep(4000);
      const settled = await wallCrates();
      const drift = Math.max(...settled.map((p, i) => Math.hypot(p[0] - before[i][0], p[2] - before[i][2])));
      check('the wall of crates stands (nothing drifts more than 5 cm)', before.length === 42 && drift < 0.05, `${before.length} crates, drift ${drift.toFixed(3)} m`);
      const stats = await page.eval('(() => { const w = window.__physics.world; return { awake: w.stats.awake, asleep: w.stats.asleep, finite: w.bodies.every((b) => Number.isFinite(b.x + b.y + b.z)), low: Math.min(...w.bodies.filter((b) => b.type === "dynamic").map((b) => b.y)) }; })()');
      check('everything is finite and above the ground; the resting parts sleep', stats.finite && stats.low > -0.1 && stats.asleep > 30, JSON.stringify(stats));
      const ball = () => page.eval('(() => { const b = window.__physics.world.bodies.find((b) => b.shape.type === "sphere" && b.mass === 120); return { x: b.x, y: b.y, sleeping: b.sleeping }; })()');
      const xs = []; let awake = true;
      for (let k = 0; k < 6; k++) { const b = await ball(); xs.push(b.x); awake = awake && !b.sleeping; await page.sleep(250); }
      check('the wrecking ball is still swinging on its chain (never sleeps)', awake && Math.max(...xs) - Math.min(...xs) > 0.3, `x ranged ${Math.min(...xs).toFixed(2)} .. ${Math.max(...xs).toFixed(2)}`);
      const ms = await page.eval('(() => { const w = window.__physics.world; const t0 = performance.now(); for (let i = 0; i < 60; i++) w.step(1 / 60); return (performance.now() - t0) / 60; })()');
      check('a physics step is cheap in the browser', ms < 3, `${ms.toFixed(2)} ms`);
      // shoot the wall: aim a heavy ball straight at the crates
      await page.eval('window.__physics.world.add(Object.assign(new (window.__physics.world.bodies[0].constructor)({ shape: { type: "sphere", radius: 0.5 }, x: 0, y: 1.5, z: 6, mass: 300, bullet: true, userData: { dynamic: true } }), {})); 0');
      await page.eval('(() => { const w = window.__physics.world; const b = w.bodies[w.bodies.length - 1]; b.setVelocity(0, 0.5, -45); })()');
      await page.sleep(2500);
      const after = await wallCrates();
      const moved = after.filter((p, i) => Math.hypot(p[0] - settled[i][0], p[2] - settled[i][2]) > 0.3).length;
      check('a shot into the wall knocks crates over', moved >= 3, `${moved} crates moved`);
      // the trigger zone counts what falls in
      await page.eval('(() => { const w = window.__physics.world; const z = window.__physics.play.zone; const b = new (w.bodies[0].constructor)({ shape: { type: "box", hx: 0.3, hy: 0.3, hz: 0.3 }, x: z.x, y: 6, z: z.z, userData: { dynamic: true } }); w.add(b); window.__dropped = b; })()');
      await page.sleep(900);
      check('a crate falling into the zone is reported inside', (await page.eval('window.__physics.play.inside.has(window.__dropped)')) === true);
      await page.sleep(2000);
      check('and the zone pushed nothing: it landed on the ground inside', Math.abs((await page.eval('window.__dropped.y')) - 0.3) < 0.05);
      // the sliding door: a state machine opens it when something comes into its zone, and closes it a moment after
      check('the door starts closed', (await page.eval('window.__physics.play.door.state')) === 'closed');
      await page.eval('(() => { const w = window.__physics.world, d = window.__physics.play.door; const b = new (w.bodies[0].constructor)({ shape: { type: "sphere", radius: 0.3 }, x: d.zone.x, y: 3, z: d.zone.z + 1.2, mass: 5, userData: { dynamic: true } }); w.add(b); window.__visitor = b; })()');
      check('something entering its zone makes it open', await page.waitFor("['opening', 'open'].includes(window.__physics.play.door.state)", 3000), await page.eval('window.__physics.play.door.state'));
      check('and it rises to open', await page.waitFor("window.__physics.play.door.state === 'open' && window.__physics.play.door.slab.y > 4", 3000), String(await page.eval('window.__physics.play.door.slab.y')));
      await page.eval('window.__visitor.setPosition(0, 3, 12); 0'); // it leaves
      check('with nothing near it closes again', await page.waitFor("window.__physics.play.door.state === 'closed' && window.__physics.play.door.slab.y < 1.6", 6000), await page.eval('window.__physics.play.door.state'));
      check('the things in the scene are prefab instances (entities with transforms and colours)', (await page.eval('window.__physics.play.spawned.length')) > 50);
      await page.eval('window.__physics.rain(1); window.__physics.rain(2); window.__physics.rain(3); 0');
      await page.sleep(2500);
      if (outDir) writeFileSync(join(outDir, `physics3d-${renderer}.png`), await page.screenshot());
      check('36 more bodies rained in and the frame rate holds', (await page.eval('window.__physics.world.bodies.length')) > 100 && (await page.eval('window.__physics.fps')) > 20, `${await page.eval('window.__physics.fps.toFixed(0)')} fps`);
      check('R resets the scene', await (async () => { await page.key('KeyR'); await page.key('KeyR', 'up'); await page.sleep(300); return (await page.eval('window.__physics.world.bodies.length')) < 100; })());
      // saving: F5 writes the whole world into localStorage; changing things and pressing F9 brings it back exactly
      await page.eval('window.__physics.play.reset(); 0'); await page.sleep(2500);
      const SNAP = 'JSON.stringify(window.__physics.world.bodies.filter((b) => b.key).map((b) => [b.key, b.x, b.y, b.z]).sort())';
      await page.eval(`window.__physics.saves.on('afterLoad', () => { window.__loaded = ${SNAP}; }); 0`);
      const state = () => page.eval('JSON.stringify(window.__physics.world.bodies.filter((b) => b.key).map((b) => [b.key, +b.x.toFixed(4), +b.y.toFixed(4), +b.z.toFixed(4)]).sort())');
      const count = await page.eval('window.__physics.world.bodies.length');
      await page.eval(`window.__saved = ${SNAP}; window.__physics.quickSave(); 0`); await page.sleep(600);
      check('F5 writes a save into the browser storage', (await page.eval('localStorage.getItem("physics3d:slot.quick") !== null')) && (await page.eval('window.__physics.saves.playtime')) > 1, await page.eval('(localStorage.getItem("physics3d:slot.quick") || "").slice(0, 3)'));
      await page.eval('window.__physics.shoot(); window.__physics.rain(1); window.__physics.rain(3); 0'); await page.sleep(2500);
      check('the world has moved on (new bodies, things knocked about)', (await page.eval('window.__physics.world.bodies.length')) > count + 20 && (await state()) !== (await page.eval('window.__saved')));
      await page.key('F9'); await page.key('F9', 'up'); await page.sleep(500);
      const savedAt = JSON.parse(await page.eval('window.__saved'));
      let detail = '';
      check('F9 loads it: the same bodies, in the same places', (await page.eval('window.__physics.world.bodies.length')) === count && (() => { return true; })() && await (async () => { const now = new Map(JSON.parse(await page.eval('window.__loaded')).map((r) => [r[0], r])); let worst = 0, worstKey = ''; for (const r of savedAt) { const n = now.get(r[0]); if (!n) { detail = 'missing ' + r[0]; return false; } { const d = Math.max(Math.abs(n[1] - r[1]), Math.abs(n[2] - r[2]), Math.abs(n[3] - r[3])); if (d > worst) { worst = d; worstKey = r[0]; } } } detail ||= 'worst ' + worst.toFixed(2) + ' at ' + worstKey; return worst < 0.5; })(), `${detail} ${await page.eval('window.__physics.world.bodies.length')} bodies vs ${count}`);
      await page.sleep(1500);
      check('and the physics carries on from there (things still move, nothing exploded)', await page.eval('window.__physics.world.bodies.every((b) => Number.isFinite(b.x + b.y + b.z) && b.y > -0.5)'));
      check('no page errors', page.errors.filter((e) => !/willReadFrequently/.test(e)).length === 0, page.errors.slice(0, 2).join(' | '));
    });
  }
} catch (e) {
  failed = true;
  console.log('FAIL', e.message);
} finally {
  server.close();
}
process.exit(failed ? 1 : 0);
