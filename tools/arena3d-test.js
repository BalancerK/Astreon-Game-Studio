// Live check of the 3D arena in a real browser: the real server, the real client page, real key events, on both renderers.
// Usage: node tools/arena3d-test.js
import { startArena3dServer } from '../examples/arena3d/server/arena3d-server.js';
import { startArena3dGateway } from '../examples/arena3d/server/gateway.js';
import { withChromePage } from './cdp.js';

let failed = false;
const check = (name, ok, detail = '') => { if (!ok) failed = true; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `  (${detail})` : ''}`); };

const server = await startArena3dServer({ port: 0, bots: 12, seed: 7, botAi: false }); // (the live checks stand still and walk about: bots must not shoot the player)
try {
  for (const renderer of ['webgpu', 'webgl2']) {
    console.log(`--- ${renderer}`);
    await withChromePage(`http://127.0.0.1:${server.port}/?renderer=${renderer}&debug=1`, async (page) => {
      const ready = await page.waitFor("window.__arena3d && window.__arena3d.client.state === 'playing' && window.__arena3d.client.predicted && window.__arena3d.client.predicted.initialized", 15_000);
      check('connects, joins and starts predicting', ready, page.errors.filter((e) => !/willReadFrequently/.test(e)).slice(0, 2).join(' | '));
      if (!ready) throw new Error('did not start');
      check('uses the requested backend', (await page.eval('window.__arena3d.renderer3d.kind')) === renderer);
      const me = () => page.eval('(() => { const p = window.__arena3d.client.predicted; return { x: p.x, y: p.y, z: p.z, grounded: p.body.grounded }; })()');
      const srv = () => {
        const [c] = server.clients;
        const b = server.bodies.get(c.entity & 0xfffff);
        return { x: b.x, y: b.y, z: b.z };
      };
      const place = async (x, y, z, yaw) => {
        const [c] = server.clients;
        const slot = c.entity & 0xfffff, b = server.bodies.get(slot);
        b.x = x; b.y = y; b.z = z; b.vy = 0; b.grounded = false;
        await page.eval(`window.__arena3d.look.yaw = ${yaw}; window.__arena3d.look.pitch = 0`);
        await page.sleep(600);
      };
      const hold = async (code, ms) => { await page.key(code); await page.sleep(ms); await page.key(code, 'up'); };

      await place(-15, 0.9, 44, 0);
      const a = await me();
      await hold('KeyW', 1000);
      const b = await me();
      check('W walks forward at about 4.5 m/s on the predicted player', a.z - b.z > 3.6 && a.z - b.z < 5.4, `moved ${(a.z - b.z).toFixed(2)} m`);
      await page.sleep(400);
      const s = srv(), m = await me();
      check('the server agrees with the prediction', Math.hypot(s.x - m.x, s.y - m.y, s.z - m.z) < 0.1, `${Math.hypot(s.x - m.x, s.y - m.y, s.z - m.z).toFixed(3)} m apart`);

      await place(-15, 0.9, 44, Math.PI); // face +z, the wall at z = 50
      await hold('KeyW', 3000);
      const w = srv();
      check('the wall stops the player', w.z < 49.7 && w.z > 48.8, `z ${w.z.toFixed(2)}`);

      await place(-15, 0.9, 40, 0);
      const snaps0 = await page.eval('window.__arena3d.client.predicted.stats.snaps');
      await page.key('Space');
      let peak = 0;
      for (let i = 0; i < 10; i++) { await page.sleep(60); peak = Math.max(peak, (await me()).y); }
      await page.key('Space', 'up');
      check('Space jumps about 1.3 m', peak > 0.9 + 0.9 && peak < 0.9 + 1.6, `peak ${(peak - 0.9).toFixed(2)} m`);

      const stats0 = await page.eval('({ ...window.__arena3d.client.shotStats })');
      await page.eval('window.__arena3d.setFiring(true)');
      await page.sleep(900);
      await page.eval('window.__arena3d.setFiring(false)');
      await page.sleep(500);
      const stats1 = await page.eval('({ ...window.__arena3d.client.shotStats })');
      check('holding fire predicts shots and the server confirms them', stats1.predicted - stats0.predicted >= 3 && stats1.confirmed - stats0.confirmed >= 3, `predicted ${stats1.predicted - stats0.predicted}, confirmed ${stats1.confirmed - stats0.confirmed}`);
      const audio = await page.eval('({ state: window.__arena3d.sound?.audio.state, played: window.__arena3d.sound?.audio.stats.played, skipped: window.__arena3d.sound?.audio.stats.skipped, music: !!window.__arena3d.sound?.audio.music })');
      check('sound starts at the first key press and the shots, steps and jump made noise', audio.state === 'running' && audio.played >= 4 && audio.music, JSON.stringify(audio));
      check('no snap corrections while jumping and firing (after the last teleport)', (await page.eval('window.__arena3d.client.predicted.stats.snaps')) === snaps0);
      const rigInfo = await page.eval('({ n: window.__arena3d.rigs.size, moving: [...window.__arena3d.rigs.values()].filter((e) => e.rig.speed > 1.5).length, flying: [...window.__arena3d.rigs.values()].filter((e) => e.rig.air > 0.5).length })');
      check('other players are drawn as skinned, animated characters', rigInfo.n >= 3 && rigInfo.moving >= 1, JSON.stringify(rigInfo));
      check('the sun casts shadows, and the pillars carry point-light lamps (the renderer reports no GPU errors below)', (await page.eval('window.__arena3d.shadowsOn')) === true && (await page.eval('window.__arena3d.lamps.length')) === 8);
      check('the level is textured (four procedural textures: grass, brick, concrete, plates)', (await page.eval('window.__arena3d.texturesOn')) === true && (await page.eval('window.__arena3d.textures.layers.length')) === 4);
      check('the renderer reports no GPU errors', !(await page.eval('window.__arena3d.renderer3d.lastError')), String(await page.eval('window.__arena3d.renderer3d.lastError')));
      check('no page errors', page.errors.filter((e) => !/willReadFrequently/.test(e)).length === 0, page.errors.slice(0, 2).join(' | '));
    });
  }

  // mods: a data mod's rules and theme reach the real page after hash verification
  const { fileURLToPath } = await import('node:url');
  const modded = await startArena3dServer({ port: 0, bots: 3, mods: { dir: fileURLToPath(new URL('../examples/arena3d/mods', import.meta.url)), ids: ['low-gravity', 'night-sky'], mode: 'inline' } });
  try {
    console.log('--- mods');
    await withChromePage(`http://127.0.0.1:${modded.port}/`, async (page) => {
      const ok = await page.waitFor("window.__arena3d && window.__arena3d.client.state === 'playing'", 15_000);
      check('joins a server that advertises mods', ok, page.errors.slice(0, 2).join(' | '));
      check('both mods loaded and verified', (await page.eval('window.__arena3d.client.mods.length')) === 2);
      check('rules from the mod are in force on the client (gravity 9)', (await page.eval('window.__arena3d.client.rules.gravity')) === 9);
      check('the theme is applied (title)', (await page.eval('document.title')) === 'ARENA 3D: NIGHT');
    });
  } finally { await modded.close(); }

  // particles: firing makes flashes, impacts and bullet holes; ?particles=0 turns them all off
  for (const [label, query] of [['on', '?renderer=webgl2'], ['off', '?renderer=webgl2&particles=0']]) {
    console.log(`--- particles: ${label}`);
    await withChromePage(`http://127.0.0.1:${server.port}/${query}`, async (page) => {
      const ready = await page.waitFor("window.__arena3d && window.__arena3d.client.state === 'playing' && window.__arena3d.client.predicted?.initialized", 15_000);
      if (!ready) throw new Error('did not start');
      const [c] = server.clients;
      const b = server.bodies.get(c.entity & 0xfffff);
      b.x = -30; b.y = 0.9; b.z = 30; b.vy = 0; b.grounded = false;
      await page.eval('window.__arena3d.look.yaw = 0.6; window.__arena3d.look.pitch = -0.35');
      await page.sleep(500);
      const lamps = await page.eval('window.__arena3d.lamps.length');
      await page.sleep(300);
      await page.eval('window.__arena3d.setFiring(true)');
      let peak = 0;
      for (let i = 0; i < 8; i++) { await page.sleep(100); peak = Math.max(peak, await page.eval('window.__arena3d.fx.system.count')); }
      if (label === 'on' && process.env.ARENA_MENU_SHOTS) (await import('node:fs')).writeFileSync(`${process.env.ARENA_MENU_SHOTS}/particles.png`, await page.screenshot());
      await page.eval('window.__arena3d.setFiring(false)');
      if (label === 'on') {
        check('firing makes particles', peak > 10, `peak ${peak}`);
        check('bullet holes are left on the ground (flat decals)', (await page.eval('(() => { const s = window.__arena3d.fx.system; let n = 0; for (let i = 0; i < s.count; i++) if (s.orient[i] === 2) n++; return n; })()')) >= 2);
        check('the renderer is handed the batch', (await page.eval('window.__arena3d.fx.batch.count')) > 0);
      } else {
        check('with ?particles=0 there are none', peak === 0 && (await page.eval('window.__arena3d.fx.batch.count')) === 0, `peak ${peak}`);
      }
      check(`no page errors (particles ${label})`, page.errors.filter((e) => !/willReadFrequently/.test(e)).length === 0, page.errors.slice(0, 2).join(' | '));
    });
  }

  // input devices: the same game from a gamepad, a touch screen and the mouse, through the action layer
  for (const [label, query] of [['gamepad', '?renderer=webgl2'], ['touch', '?renderer=webgl2&touch=1']]) {
    console.log(`--- input: ${label}`);
    await withChromePage(`http://127.0.0.1:${server.port}/${query}`, async (page) => {
      const ready = await page.waitFor("window.__arena3d && window.__arena3d.client.state === 'playing' && window.__arena3d.client.predicted?.initialized", 15_000);
      if (!ready) throw new Error('did not start');
      const me = () => page.eval('(() => { const p = window.__arena3d.client.predicted; return { x: p.x, y: p.y, z: p.z }; })()');
      const place = async (x, y, z) => {
        const [c] = server.clients;
        const b = server.bodies.get(c.entity & 0xfffff);
        b.x = x; b.y = y; b.z = z; b.vy = 0; b.grounded = false;
        await page.eval('window.__arena3d.look.yaw = 0; window.__arena3d.look.pitch = 0');
        await page.sleep(600);
      };
      const shots = () => page.eval('window.__arena3d.client.shotStats.predicted');
      if (label === 'gamepad') {
        await page.eval("window.__pad = { index: 0, connected: true, buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })), axes: [0, 0, 0, 0] }; navigator.getGamepads = () => [window.__pad]; 0");
        await place(-15, 0.9, 44);
        const a = await me();
        await page.eval('window.__pad.axes[1] = -1');            // left stick pushed forward
        await page.sleep(1000);
        await page.eval('window.__pad.axes[1] = 0');
        const b = await me();
        check('a gamepad: pushing the left stick forward walks forward', a.z - b.z > 3, `moved ${(a.z - b.z).toFixed(2)} m`);
        await place(-15, 0.9, 44);
        await page.eval('window.__pad.axes[1] = -0.5');          // half push: half speed
        await page.sleep(1000);
        await page.eval('window.__pad.axes[1] = 0');
        const half = await me();
        check('and a half push walks at about half the speed', Math.abs((44 - half.z) - 2.0) < 1.2, `moved ${(44 - half.z).toFixed(2)} m`);
        const yaw0 = await page.eval('window.__arena3d.look.yaw');
        await page.eval('window.__pad.axes[2] = 1');             // right stick right: turn right
        await page.sleep(500);
        await page.eval('window.__pad.axes[2] = 0');
        const yaw1 = await page.eval('window.__arena3d.look.yaw');
        check('the right stick turns the view (about 2.8 rad/s at full tilt)', yaw0 - yaw1 > 0.9 && yaw0 - yaw1 < 2.0, `turned ${(yaw0 - yaw1).toFixed(2)} rad`);
        await place(-15, 0.9, 40);
        let peak = 0;
        await page.eval('window.__pad.buttons[0] = { pressed: true, value: 1 }');   // A: jump
        for (let i = 0; i < 10; i++) { await page.sleep(60); peak = Math.max(peak, (await me()).y); }
        await page.eval('window.__pad.buttons[0] = { pressed: false, value: 0 }');
        check('A jumps', peak > 0.9 + 0.9, `peak ${(peak - 0.9).toFixed(2)} m`);
        const s0 = await shots();
        await page.eval('window.__pad.buttons[7] = { pressed: true, value: 1 }');   // right trigger: fire
        await page.sleep(900);
        await page.eval('window.__pad.buttons[7] = { pressed: false, value: 0 }');
        check('the right trigger fires', (await shots()) - s0 >= 3, `${(await shots()) - s0} shots`);
        check('the page knows a gamepad is in use and shows its button names', (await page.eval('window.__arena3d.input.lastDevice')) === 'gamepad' && (await page.eval("window.__arena3d.input.promptFor('jump')")) === 'Gamepad A', await page.eval("window.__arena3d.input.promptFor('jump')"));
        // the mouse: a click asks for the pointer lock (headless Chrome refuses it, and the page copes: the click is then an ordinary one)
        await page.mouse('mousePressed', 600, 400); await page.mouse('mouseReleased', 600, 400);
        await page.sleep(500);
        check('a mouse click asks for the pointer lock, and a refusal is handled quietly', page.errors.filter((e) => !/willReadFrequently/.test(e)).length === 0, page.errors.slice(0, 2).join(' | '));
      } else {
        await place(-15, 0.9, 44);
        const overlay = await page.eval("[...document.getElementById('stage').querySelectorAll('div')].map((d) => d.textContent).filter(Boolean).join(',')");
        check('on-screen touch controls are drawn (fire, jump, run)', /FIRE/.test(overlay) && /JUMP/.test(overlay) && /RUN/.test(overlay), overlay);
        const a = await me();
        await page.touch('touchStart', [[150, 600, 1]]);
        await page.touch('touchMove', [[150, 480, 1]]);           // dragged up from where the finger landed: forward
        await page.sleep(1000);
        await page.touch('touchEnd', []);
        const b = await me();
        check('a finger dragged up on the left half walks forward', a.z - b.z > 3, `moved ${(a.z - b.z).toFixed(2)} m`);
        const yaw0 = await page.eval('window.__arena3d.look.yaw');
        await page.touch('touchStart', [[800, 300, 2]]);
        await page.touch('touchMove', [[900, 300, 2]]);           // dragged right on the right half: look right
        await page.sleep(200);
        await page.touch('touchEnd', []);
        const yaw1 = await page.eval('window.__arena3d.look.yaw');
        check('dragging on the right half turns the view (100 px is 0.5 rad)', Math.abs((yaw0 - yaw1) - 0.5) < 0.15, `turned ${(yaw0 - yaw1).toFixed(2)} rad`);
        const s0 = await shots();
        await page.touch('touchStart', [[1259, 589, 3]]);         // the FIRE button
        await page.sleep(900);
        await page.touch('touchEnd', []);
        check('the FIRE button fires', (await shots()) - s0 >= 3, `${(await shots()) - s0} shots`);
        await place(-15, 0.9, 40);
        let peak = 0;
        await page.touch('touchStart', [[1400 - 3.3 * 88, 800 - 1.3 * 88, 4]]); // the JUMP button
        for (let i = 0; i < 10; i++) { await page.sleep(60); peak = Math.max(peak, (await me()).y); }
        await page.touch('touchEnd', []);
        check('the JUMP button jumps', peak > 0.9 + 0.9, `peak ${(peak - 0.9).toFixed(2)} m`);
        check('the page knows a touch screen is in use', (await page.eval('window.__arena3d.input.lastDevice')) === 'touch' && (await page.eval("window.__arena3d.input.promptFor('move')")) === 'Touch stick');
      }
      check(`no page errors (${label})`, page.errors.filter((e) => !/willReadFrequently/.test(e)).length === 0, page.errors.slice(0, 2).join(' | '));
    });
  }

  // rooms and reconnect: the gateway routes ?room=NAME, and a dropped socket gives back the same character
  const gw = await startArena3dGateway({ port: 0, mode: 'worker', idleCloseMs: 0, roomOptions: { bots: 3, botAi: false } });
  try {
    console.log('--- rooms and reconnect');
    await withChromePage(`http://127.0.0.1:${gw.port}/?room=live`, async (page) => {
      const ok = await page.waitFor("window.__arena3d && window.__arena3d.client.state === 'playing' && window.__arena3d.client.predicted?.initialized", 15_000);
      check('joins the room named in the URL', ok && gw.manager.list().some((r) => r.name === 'live' && r.players === 1), page.errors.slice(0, 2).join(' | '));
      if (!ok) throw new Error('did not start');
      const id = await page.eval('window.__arena3d.client.selfId'), token = await page.eval('window.__arena3d.client.session');
      await page.key('KeyW'); await page.sleep(500); await page.key('KeyW', 'up');
      const before = await page.eval('window.__arena3d.client.predicted.z');
      for (const conn of gw.listener.connections) conn.socket.destroy(); // abrupt, like a dropped network
      check('the page notices and shows it is reconnecting', await page.waitFor("window.__arena3d.client.state === 'reconnecting' || window.__arena3d.client.stats.reconnects > 0", 5000));
      const back = await page.waitFor("window.__arena3d.client.stats.reconnects === 1 && window.__arena3d.client.state === 'playing' && window.__arena3d.client.predicted?.initialized", 15_000);
      check('it reconnects by itself', back);
      check('and gets the same character back', back && (await page.eval('window.__arena3d.client.resumed')) === true && (await page.eval('window.__arena3d.client.selfId')) === id && (await page.eval('window.__arena3d.client.session')) === token);
      await page.sleep(500);
      const after = await page.eval('window.__arena3d.client.predicted.z');
      check('at the position it left', Math.abs(after - before) < 1, `${before.toFixed(2)} -> ${after.toFixed(2)}`);
      check('no page errors', page.errors.filter((e) => !/willReadFrequently/.test(e)).length === 0, page.errors.slice(0, 2).join(' | '));
    });
  } finally { await gw.close(); }

  // bots with minds: they find the player, shoot, and the page shows it (shots from other shooters arrive and hurt)
  const fighters = await startArena3dServer({ port: 0, bots: 5, seed: 11 });
  try {
    console.log('--- bots');
    await withChromePage(`http://127.0.0.1:${fighters.port}/?renderer=webgl2`, async (page) => {
      const ok = await page.waitFor("window.__arena3d && window.__arena3d.client.state === 'playing' && window.__arena3d.client.predicted?.initialized", 15_000);
      if (!ok) throw new Error('did not start');
      const [c] = fighters.clients, slot = c.entity & 0xfffff, me = fighters.bodies.get(slot);
      me.x = 30; me.y = 0.9; me.z = 30; me.vy = 0;
      let n = 0;
      for (const [s, b] of fighters.bodies) { if (s === slot) continue; b.x = 30 + (n % 2 ? 14 : -14); b.y = 0.9; b.z = 30 - 5 - n * 3; b.vy = 0; n++; } // around the player, in the open
      const hp0 = fighters.world.data((await import('../examples/arena3d/shared/game.js')).Health).hp[slot];
      await page.sleep(9000);
      const hp = fighters.world.data((await import('../examples/arena3d/shared/game.js')).Health).hp[slot];
      check('bots shoot at a player they can see', fighters.stats.shots > 0, `${fighters.stats.shots} shots`);
      check('and hurt them (or have killed and respawned them)', hp < hp0 || fighters.stats.kills > 0, `hp ${hp0} -> ${hp}, kills ${fighters.stats.kills}`);
      check('the page shows their muzzle flashes and impacts (particles are alive)', (await page.eval('window.__arena3d.fx.system.spawned')) > 10, `${await page.eval('window.__arena3d.fx.system.spawned')} spawned`);
      check('no page errors (bots)', page.errors.filter((e) => !/willReadFrequently/.test(e)).length === 0, page.errors.slice(0, 2).join(' | '));
    });
  } finally { await fighters.close(); }

  // menus: the UI toolkit in the real page, driven by a real mouse, keyboard, touch screen and gamepad
  const gw2 = await startArena3dGateway({ port: 0, mode: 'worker', idleCloseMs: 0, roomOptions: { bots: 3, botAi: false } });
  try {
    console.log('--- menus');
    await withChromePage(`http://127.0.0.1:${gw2.port}/?room=menu1&renderer=webgl2`, async (page) => {
      const ok = await page.waitFor("window.__arena3d && window.__arena3d.client.state === 'playing' && window.__arena3d.client.predicted?.initialized", 15_000);
      if (!ok) throw new Error('did not start');
      // where a widget is, in page pixels (the UI works in logical pixels times its scale)
      const find = (pred) => page.eval(`(() => { const ui = window.__arena3d.ui; let r = null; for (const root of [ui.hud, ...ui.screens.map((s) => s.root)]) root.walk((w) => { if (!r && w.visible && (${pred})) r = w; }); return r ? { x: (r.x + r.w / 2) * ui.scale, y: (r.y + r.h / 2) * ui.scale, w: r.w * ui.scale, h: r.h * ui.scale } : null; })()`);
      const click = async (p) => { await page.mouse('mouseMoved', p.x, p.y); await page.mouse('mousePressed', p.x, p.y); await page.mouse('mouseReleased', p.x, p.y); await page.sleep(150); };
      const clickText = async (text) => { const p = await find(`w.text === ${JSON.stringify(text)}`); if (!p) throw new Error(`no button "${text}"`); await click(p); };
      const info = () => page.eval('({ open: window.__arena3d.ui.isOpen, screens: window.__arena3d.ui.screens.length, ctx: window.__arena3d.input.context })');
      const me = () => page.eval('(() => { const p = window.__arena3d.client.predicted; return { x: p.x, y: p.y, z: p.z }; })()');
      const walkFor = async (ms) => { const a = await me(); await page.key('KeyW'); await page.sleep(ms); await page.key('KeyW', 'up'); const b = await me(); return Math.hypot(b.x - a.x, b.z - a.z); };

      const shot = async (name) => { if (process.env.ARENA_MENU_SHOTS) (await import('node:fs')).writeFileSync(`${process.env.ARENA_MENU_SHOTS}/menu-${name}.png`, await page.screenshot()); };
      check('a Menu button is on the HUD', !!(await find("w.text === 'Menu'")));
      await clickText('Menu');
      let s = await info();
      check('clicking it opens the pause menu and the game stops listening', s.open && s.ctx === 'menu', JSON.stringify(s));
      const still = await walkFor(600);
      check('with the menu open, W does not move the player', still < 0.3, `moved ${still.toFixed(2)} m`);
      await page.key('Escape'); await page.key('Escape', 'up'); await page.sleep(150);
      s = await info();
      check('Escape closes it and the game listens again', !s.open && s.ctx === 'gameplay', JSON.stringify(s));
      check('and W walks again', (await walkFor(700)) > 2);
      await page.key('Escape'); await page.key('Escape', 'up'); await page.sleep(150);
      check('Escape opens the menu from the game', (await info()).open);
      await shot('pause');

      // settings: tabs, rebinding, conflicts, sliders
      await clickText('Settings');
      check('Settings opens on top of the menu', (await info()).screens === 2);
      await clickText('Controls');
      const jumpKey = await find("w.text === 'Space'");
      check('the Controls tab lists the keys', !!jumpKey);
      await shot('controls');
      await click(jumpKey);
      await shot('waiting');
      check('clicking a key waits for a new one', !!(await find("w.text === 'Press a control...'")) && (await page.eval('window.__arena3d.ui.captureKeys')));
      await page.key('KeyJ'); await page.key('KeyJ', 'up'); await page.sleep(150);
      const jump = await page.eval('JSON.stringify(window.__arena3d.input.bindings("jump")[0])');
      check('pressing J rebinds Jump to J', jump === '{"type":"key","code":"KeyJ"}', jump);
      check('and it is saved', JSON.parse(await page.eval('localStorage.getItem("arena3d.bindings")')).bindings.jump[0].code === 'KeyJ');
      check('and the wait is over', !(await page.eval('window.__arena3d.ui.captureKeys')) && (await info()).screens === 2);
      const runKey = await find("w.text === 'Left Shift'");
      await click(runKey);
      await page.key('Escape'); await page.key('Escape', 'up'); await page.sleep(150);
      check('Escape while waiting cancels the wait, not the screen', (await info()).screens === 2 && !!(await find("w.text === 'Left Shift'")));
      // give Run the key Jump has now: Jump loses it
      await click(await find("w.text === 'Left Shift'"));
      await page.key('KeyJ'); await page.key('KeyJ', 'up'); await page.sleep(150);
      const jumpAfter = await page.eval('JSON.stringify(window.__arena3d.input.bindings("jump").map((b) => b.type))');
      check('a control used by another action is taken from it', jumpAfter === '["gamepadButton","touchButton"]', jumpAfter);
      check('and the screen says so', /no longer uses/.test(await page.eval("(() => { let t = ''; window.__arena3d.ui.screens.at(-1).root.walk((w) => { if (w.text && /no longer/.test(w.text)) t = w.text; }); return t; })()")));
      await clickText('Sound');
      const track = await page.eval("(() => { let r = null; window.__arena3d.ui.screens.at(-1).root.walk((w) => { if (w.label === 'Master volume') r = w.track(); }); const k = window.__arena3d.ui.scale; return r && { x: r.x * k, w: r.w * k, y: r.cy * k }; })()");
      await page.mouse('mouseMoved', track.x + track.w * 0.5, track.y);
      await page.mouse('mousePressed', track.x + track.w * 0.5, track.y);
      await page.mouse('mouseMoved', track.x + track.w * 0.25, track.y);
      await page.mouse('mouseReleased', track.x + track.w * 0.25, track.y);
      await page.sleep(150);
      const master = await page.eval('window.__arena3d.menus.settings.master');
      check('dragging the volume slider sets the volume', Math.abs(master - 0.25) < 0.06, String(master));
      const engine = await page.eval('window.__arena3d.sound ? window.__arena3d.sound.audio.getVolume("master") : -1');
      check('and the sound engine follows', engine === -1 || Math.abs(engine - master) < 1e-6, String(engine));
      check('and it is remembered', Math.abs(JSON.parse(await page.eval('localStorage.getItem("arena3d.settings")')).master - master) < 1e-6);
      await shot('sound');
      await clickText('Display');
      const before = await page.eval('window.__arena3d.ui.scale');
      const choice = await page.eval("(() => { let r = null; window.__arena3d.ui.screens.at(-1).root.walk((w) => { if (w.label === 'Interface size') r = w.area(); }); const k = window.__arena3d.ui.scale; return r && { x: (r.x + r.w - 13) * k, y: (r.y + r.h / 2) * k }; })()");
      await click(choice); // the right arrow: Normal -> Large
      check('the interface size choice rescales the whole UI', (await page.eval('window.__arena3d.ui.scale')) > before, `${before} -> ${await page.eval('window.__arena3d.ui.scale')}`);
      await shot('display');
      await clickText('Back');
      check('Back closes settings, the pause menu stays', (await info()).screens === 1);

      // rooms: a list from the server, a text field typed into like a soft keyboard, and a real navigation
      await clickText('Rooms');
      check('the room browser lists the rooms on the server', await page.waitFor("window.__arena3d.ui.screens.at(-1).widget.list.items.some((i) => i.value === 'menu1')", 5000));
      const field = await find('w.isText');
      await click(field);
      check('clicking the text field focuses it (a hidden input takes the typing)', (await page.eval('document.activeElement && document.activeElement.tagName')) === 'INPUT' && (await page.eval('!!window.__arena3d.ui.textTarget')));
      await page.type('Zeta 9!');
      check('typed text arrives, filtered to allowed characters', (await page.eval('window.__arena3d.ui.textTarget.value')) === 'Zeta9', await page.eval('window.__arena3d.ui.textTarget.value'));
      await page.key('Backspace'); await page.key('Backspace', 'up');
      check('Backspace works in the field', (await page.eval('window.__arena3d.ui.textTarget.value')) === 'Zeta', await page.eval('window.__arena3d.ui.textTarget.value'));
      check('the Join button names the room', !!(await find("w.text === 'Join zeta'")));
      await shot('rooms');
      await page.key('Enter'); await page.key('Enter', 'up');
      check('Enter joins it: the page goes to ?room=zeta', await page.waitFor("location.search.includes('room=zeta')", 8000), await page.eval('location.search'));
      check('no page errors', page.errors.filter((e) => !/willReadFrequently/.test(e)).length === 0, page.errors.slice(0, 2).join(' | '));
    });

    console.log('--- menus: gamepad and touch');
    await withChromePage(`http://127.0.0.1:${gw2.port}/?room=menu2&renderer=webgl2&touch=1`, async (page) => {
      const ok = await page.waitFor("window.__arena3d && window.__arena3d.client.state === 'playing' && window.__arena3d.client.predicted?.initialized", 15_000);
      if (!ok) throw new Error('did not start');
      const find = (pred) => page.eval(`(() => { const ui = window.__arena3d.ui; let r = null; for (const root of [ui.hud, ...ui.screens.map((s) => s.root)]) root.walk((w) => { if (!r && w.visible && (${pred})) r = w; }); return r ? { x: (r.x + r.w / 2) * ui.scale, y: (r.y + r.h / 2) * ui.scale } : null; })()`);
      const tap = async (p) => { await page.touch('touchStart', [[p.x, p.y, 1]]); await page.sleep(60); await page.touch('touchEnd', []); await page.sleep(200); };
      const info = () => page.eval('({ open: window.__arena3d.ui.isOpen, screens: window.__arena3d.ui.screens.length, ctx: window.__arena3d.input.context, focus: window.__arena3d.ui.focus && window.__arena3d.ui.focus.text })');
      await tap(await find("w.text === 'Menu'"));
      check('a tap on Menu opens the pause menu', (await info()).open);
      check('the UI is bigger on a touch screen', (await page.eval('window.__arena3d.ui.scale')) === 1.25);
      await tap(await find("w.text === 'Settings'"));
      check('taps work in the screens above it', (await info()).screens === 2);
      const yaw0 = await page.eval('window.__arena3d.look.yaw');
      await page.touch('touchStart', [[1100, 650, 5]]); await page.touch('touchMove', [[1200, 650, 5]]); await page.sleep(150); await page.touch('touchEnd', []);
      check('a swipe over a menu does not turn the view', Math.abs((await page.eval('window.__arena3d.look.yaw')) - yaw0) < 1e-6);
      await tap(await find("w.text === 'Back'"));
      await page.eval("window.__pad = { index: 0, connected: true, buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })), axes: [0, 0, 0, 0] }; navigator.getGamepads = () => [window.__pad]; 0");
      const press = async (i) => { await page.eval(`window.__pad.buttons[${i}] = { pressed: true, value: 1 }`); await page.sleep(90); await page.eval(`window.__pad.buttons[${i}] = { pressed: false, value: 0 }`); await page.sleep(90); };
      await press(12); // d-pad up
      check('the d-pad moves the focus', (await info()).focus === 'Rooms', JSON.stringify(await info()));
      await press(0);  // A
      check('A presses the focused button', (await info()).screens === 2);
      await press(1);  // B
      check('B goes back one screen', (await info()).screens === 1);
      await press(1);
      check('B on the last screen resumes the game', !(await info()).open && (await info()).ctx === 'gameplay', JSON.stringify(await info()));
      await press(9);  // start
      check('Start opens the pause menu', (await info()).open);
      check('no page errors', page.errors.filter((e) => !/willReadFrequently/.test(e)).length === 0, page.errors.slice(0, 2).join(' | '));
    });
  } finally { await gw2.close(); }
} catch (e) {
  failed = true;
  console.log('FAIL', e.message);
} finally {
  await server.close();
}
process.exit(failed ? 1 : 0);
