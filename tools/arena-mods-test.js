// Live mod check in a real browser: the page downloads mod data over HTTP, verifies its SHA-256, applies rules and
// theme, predicts with zero corrections, and a tampered download is refused.
// Usage: node tools/arena-mods-test.js [outDir]
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startArenaGateway } from '../examples/arena/server/gateway.js';
import { withChromePage } from './cdp.js';

const outDir = process.argv[2] ?? '.';
mkdirSync(outDir, { recursive: true });
const modsDir = fileURLToPath(new URL('../examples/arena/mods', import.meta.url));
const gateway = await startArenaGateway({ port: 0, host: '127.0.0.1', modsDir, roomOptions: { bots: 30, mods: { policy: { defaults: { tickEvery: 6 } } } }, idleCloseMs: 0 });
let failed = false;
const check = (name, ok, detail = '') => { if (!ok) failed = true; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `  (${detail})` : ''}`); };
const base = `http://127.0.0.1:${gateway.port}`;
try {
  await withChromePage(`${base}/?room=modded&renderer=webgl2`, async (page) => {
    const joined = await page.waitFor("window.__arena && window.__arena.client.state === 'playing' && window.__arena.client.stats.snapshots > 30", 20_000);
    check('joins a modded room', joined, page.errors.slice(0, 2).join(' | '));
    if (!joined) throw new Error('did not join');
    const info = await page.eval(`(() => { const c = window.__arena.client; return { mods: c.mods.map((m) => m.id), hashes: c.mods.map((m) => m.hash.length), speed: c.rules.playerSpeed, cooldown: c.rules.weapon.cooldownTicks, damage: c.rules.weapon.damage, theme: c.theme, title: document.title }; })()`);
    check('verified the advertised mods', info.mods.join() === 'fast-weapons,neon-theme' && info.hashes.every((n) => n === 64), JSON.stringify(info.mods));
    check('rules came from the data mod', info.speed === 480 && info.cooldown === 5 && info.damage === 15, `speed ${info.speed}, cooldown ${info.cooldown}, damage ${info.damage}`);
    check('theme applied', info.title === 'NEON ARENA' && info.theme.wall?.join() === '255,40,160', info.title);

    await page.key('KeyD'); await page.key('ShiftLeft');
    await page.sleep(1500);
    await page.key('ShiftLeft', 'up'); await page.key('KeyD', 'up');
    await page.key('KeyS'); await page.sleep(1000); await page.key('KeyS', 'up');
    const pred = await page.eval(`({ corrections: window.__arena.client.predicted.stats.corrections, reconciles: window.__arena.client.predicted.stats.reconciles })`);
    check('prediction matches the modded server exactly', pred.corrections === 0 && pred.reconciles > 30, `${pred.corrections} corrections in ${pred.reconciles} reconciles`);
    writeFileSync(join(outDir, 'arena-modded.png'), await page.screenshot());

    const rooms = await (await fetch(`${base}/rooms`)).json();
    check('room runs with mods and a healthy tick', rooms.rooms[0].players === 1 && rooms.rooms[0].tickMsMax < 20, `max tick ${rooms.rooms[0].tickMsMax?.toFixed(2)} ms`);

    // the route serves the same bytes the page verified; a flipped byte must fail verification in the page itself
    const ok = await page.eval(`(async () => {
      const m = window.__arena.client.mods[0];
      const view = await (await fetch('/mods/' + m.id + '/' + m.hash)).json();
      const good = await window.__arena.verify(view, m.hash);
      view.rules.playerSpeed = 2000;
      const bad = await window.__arena.verify(view, m.hash);
      return { good, bad };
    })()`);
    check('browser verification accepts the real data and rejects an edit', ok.good === true && ok.bad === false, JSON.stringify(ok));
  });

  // a page whose downloads are tampered with must refuse to play
  await withChromePage(`${base}/?room=modded2&renderer=webgl2&tamper=1`, async (page) => {
    const refused = await page.waitFor("window.__arena && window.__arena.client.state === 'rejected'", 20_000);
    check('tampered mod data is refused in the browser', refused);
    const state = await page.eval(`({ reason: window.__arena.client.closeReason, inputs: window.__arena.client.seq })`);
    check('with a clear reason, and no inputs sent', /mod verification failed/.test(state.reason) && state.inputs === 0, state.reason);
    writeFileSync(join(outDir, 'arena-mod-refused.png'), await page.screenshot());
  });
} finally {
  await gateway.close();
}
process.exit(failed ? 1 : 0);
