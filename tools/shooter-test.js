// Live check of the shooter tutorial game in a real browser, on both renderers: the title screen, Enter starts a game, a computer player
// walks with the real W A S D keys and fires with real mouse clicks while it aims (the view angle is set from the bot, standing in for the mouse),
// robots arrive and die, the HUD and 3D scene draw without errors, and a finished game is remembered. Usage: node tools/shooter-test.js [outDir]
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createStaticServer } from './static-server.js';
import { withChromePage } from './cdp.js';

const outDir = process.argv[2] ?? null;
if (outDir) mkdirSync(outDir, { recursive: true });
const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const server = createStaticServer({ root: decodeURIComponent(root), index: '/examples/shooter/index.html' });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
let failed = false;
const check = (name, ok, detail = '') => { if (!ok) failed = true; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `  (${detail})` : ''}`); };
const PLAY_MS = Number(process.env.SHOOTER_MS ?? 40_000);

try {
  for (const renderer of ['webgpu', 'webgl2']) {
    console.log(`--- ${renderer}`);
    await withChromePage(`http://127.0.0.1:${server.address().port}/examples/shooter/index.html?renderer=${renderer}&seed=3`, async (page) => {
      const errors = () => page.errors.filter((e) => !/willReadFrequently/.test(e)).slice(0, 2).join(' | ');
      check('the title screen appears', await page.waitFor('window.__shooter && window.__shooter.mode === "title"', 20_000), errors());
      check('uses the requested backend', (await page.eval('window.__shooter.renderer3d.kind')) === renderer);
      await page.eval('localStorage.clear()');
      if (outDir) writeFileSync(join(outDir, `shooter-title-${renderer}.png`), await page.screenshot());
      await page.key('Enter', 'down'); await page.key('Enter', 'up');
      check('Enter starts a game', await page.waitFor('window.__shooter.mode === "play" && window.__shooter.game', 5000));
      await page.eval('import("/examples/shooter/src/game.js").then((m) => { window.__bot = m.botInput; })');

      const held = { KeyW: false, KeyA: false, KeyS: false, KeyD: false };
      const keyset = async (code, on) => { if (held[code] !== on) { held[code] = on; await page.key(code, on ? 'down' : 'up'); } };
      let mouse = false;
      const setMouse = async (on) => { if (mouse !== on) { mouse = on; await page.mouse(on ? 'mousePressed' : 'mouseReleased', 600, 400, { button: 'left', buttons: on ? 1 : 0, clickCount: 1 }); } };
      const t0 = Date.now(); let shot = false, state = null;
      while (Date.now() - t0 < PLAY_MS) {
        const s = JSON.parse(await page.eval(`(() => { const S = window.__shooter, g = S.game; let b; for (let n = Math.max(1, g.tick - (window.__lastTick ?? g.tick)); n > 0; n--) b = window.__bot(g); window.__lastTick = g.tick; S.view.yaw = b.yaw; S.view.pitch = b.pitch; return JSON.stringify({ b: { mx: b.mx, mz: b.mz, fire: b.fire }, status: g.status, wave: g.wave, kills: g.kills, shots: g.shots, hp: g.player.hp, mode: S.mode }); })()`));
        state = s;
        if (outDir && !shot && s.kills >= 2) { writeFileSync(join(outDir, `shooter-play-${renderer}.png`), await page.screenshot()); shot = true; }
        if (s.status !== 'playing') break;
        await keyset('KeyW', s.b.mz > 0.3); await keyset('KeyS', s.b.mz < -0.3); await keyset('KeyD', s.b.mx > 0.3); await keyset('KeyA', s.b.mx < -0.3);
        await setMouse(s.b.fire);
        await page.sleep(20);
      }
      await setMouse(false); for (const c of Object.keys(held)) await keyset(c, false);
      check('the real mouse clicks fire the rifle', state.shots >= 20, `${state.shots} shots`);
      check('robots arrive and are shot down', state.kills >= 3 && state.wave >= 1, `wave ${state.wave}, ${state.kills} kills`);
      check('the player moved with the real keys', (await page.eval('(() => { const p = window.__shooter.game.player.ctl; return Math.hypot(p.x, p.z) > 1; })()')));
      check('no page errors while playing', errors() === '', errors());
      if (state.status === 'playing') {                                  // make the finish quick: end the game by force and see the end screen and the saved best
        await page.eval('(() => { const g = window.__shooter.game; g.player.hp = 1; g.score = 777; g.wave = 2; })()');
        await page.eval('(() => { const g = window.__shooter.game; g.enemies.length = 0; g.queue = []; g.phase = "fight"; g.wave = 5; })()');
      }
      check('a finished game shows the end screen', await page.waitFor('window.__shooter.mode === "end"', 8000));
      await page.sleep(400);
      check('and the best score is saved in the browser', await page.waitFor('(() => { const d = Object.entries(localStorage).filter(([k]) => k.startsWith("shooter:")); return d.length > 0 && window.__shooter.best.score > 0; })()', 4000));
      if (outDir) writeFileSync(join(outDir, `shooter-end-${renderer}.png`), await page.screenshot());
      await page.key('Enter', 'down'); await page.key('Enter', 'up');
      check('Enter plays again', await page.waitFor('window.__shooter.mode === "play" && window.__shooter.game.status === "playing" && window.__shooter.game.tick < 120', 5000));
      check('still no page errors', errors() === '', errors());
    });
  }
} finally { server.close(); }
process.exit(failed ? 1 : 0);
