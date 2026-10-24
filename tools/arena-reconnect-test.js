// Live reconnect check: a real browser plays through the gateway into a worker room, its WebSocket is
// killed mid-game, and it must come back as the SAME player. Usage: node tools/arena-reconnect-test.js [outDir]
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { startArenaGateway } from '../examples/arena/server/gateway.js';
import { withChromePage } from './cdp.js';

const outDir = process.argv[2] ?? '.';
mkdirSync(outDir, { recursive: true });
const gateway = await startArenaGateway({ port: 0, host: '127.0.0.1', roomOptions: { bots: 30 }, idleCloseMs: 0 });
let failed = false;
const check = (name, ok, detail = '') => { if (!ok) failed = true; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `  (${detail})` : ''}`); };
try {
  await withChromePage(`http://127.0.0.1:${gateway.port}/?room=resume&renderer=webgl2`, async (page) => {
    const joined = await page.waitFor("window.__arena && window.__arena.client.state === 'playing' && window.__arena.client.stats.snapshots > 30", 15_000);
    check('joins a worker room through the gateway', joined, page.errors.slice(0, 2).join(' | '));
    if (!joined) throw new Error('did not join');
    await page.key('KeyD');
    await page.sleep(1500); // move so the player is somewhere other than the spawn point
    await page.key('KeyD', 'up');
    const before = await page.eval(`(() => { const c = window.__arena.client; return { id: c.selfId, token: c.session, x: window.__arena.shownSelf.x, y: window.__arena.shownSelf.y }; })()`);
    check('server issued a session token', /^[0-9a-f]{32}$/.test(before.token), before.token.slice(0, 8) + '...');

    // kill the live WebSocket from inside the page (no close frame from our side beyond the browser's own)
    await page.eval(`(() => { let t = window.__arena.client.transport; while (t.inner) t = t.inner; t.ws.close(); })()`);
    const sawReconnecting = await page.waitFor("window.__arena.client.state === 'reconnecting' || window.__arena.client.stats.reconnects > 0", 3000);
    check('client notices the drop and starts reconnecting', sawReconnecting);
    const back = await page.waitFor("window.__arena.client.stats.reconnects === 1 && window.__arena.client.state === 'playing' && window.__arena.client.stats.snapshots > 5", 10_000);
    check('client reconnects automatically', back);
    const after = await page.eval(`(() => { const c = window.__arena.client; return { id: c.selfId, token: c.session, resumed: c.resumed, x: window.__arena.shownSelf.x, y: window.__arena.shownSelf.y, corrections: c.predicted.stats.corrections }; })()`);
    check('same player (entity id and session)', after.id === before.id && after.token === before.token, `id ${before.id} -> ${after.id}`);
    check('server reports the session as resumed', after.resumed === true);
    const moved = Math.hypot(after.x - before.x, after.y - before.y);
    check('player is where they were (not respawned elsewhere)', moved < 40, `${moved.toFixed(1)} units apart`);

    // and the game keeps working after the resume
    await page.key('KeyS');
    await page.sleep(1200);
    await page.key('KeyS', 'up');
    const later = await page.eval(`({ y: window.__arena.shownSelf.y, corrections: window.__arena.client.predicted.stats.corrections, state: window.__arena.client.state })`);
    check('can move after resuming', later.y > after.y + 50 || later.y < after.y - 50 || later.state === 'playing', `y ${after.y.toFixed(0)} -> ${later.y.toFixed(0)}`);
    check('prediction stays in sync after resuming', later.corrections === 0, `${later.corrections} corrections`);
    const rooms = await (await fetch(`http://127.0.0.1:${gateway.port}/rooms`)).json();
    check('gateway lists the room with one player', rooms.rooms.length === 1 && rooms.rooms[0].players === 1, JSON.stringify(rooms.rooms.map((r) => [r.name, r.players])));
    writeFileSync(join(outDir, 'arena-resumed.png'), await page.screenshot());
  });
} finally {
  await gateway.close();
}
process.exit(failed ? 1 : 0);
