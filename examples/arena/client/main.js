import { FixedLoop } from '../../../packages/core/src/index.js';
import { Atlas, Camera, SpriteBatch, Font, createRenderer, packTint, WHITE } from '../../../packages/render/src/index.js';
import { ArenaClient } from './net.js';
import { verifyClientView } from '../../../packages/mods/src/index.js';
import { connectWebSocket, simulateLink } from '../../../packages/transport/src/index.js';
import { DebugOverlay } from '../../../packages/debug/src/index.js';
import { createSampleBuffer, sampleWorld } from './interp.js';
import { WORLD, TICK_RATE, BUTTON_DASH, BUTTON_FIRE, buildWalls } from '../shared/game.js';

const params = new URLSearchParams(location.search);
const stage = document.getElementById('stage');
const hud = document.getElementById('hud');
const msg = document.getElementById('msg');

// ---- sprites ----
const atlas = new Atlas({ size: 1024 }); // sprites plus the text glyphs
const square = atlas.add('square', 8, 8, (g, x, y, w, h) => { g.fillStyle = '#fff'; g.fillRect(x, y, w, h); });
const circle = atlas.add('circle', 64, 64, (g, x, y, w) => { g.fillStyle = '#fff'; g.beginPath(); g.arc(x + w / 2, y + w / 2, w / 2 - 1, 0, Math.PI * 2); g.fill(); });

// Text is drawn in a second, screen-space pass on top of the world (crisp, whatever the camera zoom is).
const font = new Font(atlas, { family: 'ui-monospace, Consolas, monospace', size: 13, weight: 'bold', scale: window.devicePixelRatio || 1 });
const toastFont = new Font(atlas, { family: 'system-ui, sans-serif', size: 18, weight: 'bold', scale: window.devicePixelRatio || 1 });
const overlay = new SpriteBatch(512);
// World-space text uses a scalable (signed distance field) font: it stays sharp as the camera zooms and when the label scales with the player.
const worldFont = new Font(atlas, { family: 'system-ui, sans-serif', weight: 'bold', size: 18, sdf: true });
const hudCamera = new Camera();
const hpLabels = []; // x, y, hp triples collected while drawing the world
const SHADOW = { dx: 1, dy: 1, tint: packTint(0, 0, 0, 170) };

function hueTint(hue) {
  const h = (hue / 256) * 6, f = h - Math.floor(h), s = 0.65, v = 1;
  const p = v * (1 - s), q = v * (1 - s * f), t = v * (1 - s * (1 - f));
  const [r, g, b] = [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][Math.floor(h) % 6];
  return packTint(r * 255, g * 255, b * 255);
}

// ---- renderer (WebGPU -> WebGL2 -> Canvas2D unless ?renderer= forces one) ----
const prefer = params.get('renderer') ? [params.get('renderer')] : undefined;
const renderer = await createRenderer({ atlas, prefer });
stage.append(renderer.canvas);
const camera = new Camera({ x: WORLD.w / 2, y: WORLD.h / 2 });
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.resize(w, h, window.devicePixelRatio || 1);
  camera.setViewport(w, h);
  camera.zoom = Math.min(w, h) / 900;
}
window.addEventListener('resize', resize);
resize();

// ?tamper=1 simulates a malicious mod download (one rule value changed in transit): the client must refuse to play.
const fetchMod = params.get('tamper') === '1'
  ? async (id, hash) => { const v = await (await fetch(`/mods/${id}/${hash}`)).json(); v.rules = { ...v.rules, playerSpeed: 2000 }; v.client = { ...v.client, tampered: true }; return v; }
  : undefined;

// ---- networking ----
// ?room=alpha joins (or creates) the room "alpha"; the default room is "lobby".
const wsUrl = params.get('ws') ?? `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/${encodeURIComponent(params.get('room') ?? 'lobby')}`;
// ?lag=80 adds 80 ms each way; also ?jitter=20 and ?loss=0.05. ?predict=0 turns prediction off to compare.
const lag = Number(params.get('lag') ?? 0), jitter = Number(params.get('jitter') ?? 0), loss = Number(params.get('loss') ?? 0);
const simulated = lag || jitter || loss;
// ?predictshots=0 turns shot prediction off: tracers then appear one round trip after you fire.
// F3 (or ?debug=1) opens the debug overlay: live graphs plus a decoded packet inspector.
const debug = new DebugOverlay({ title: 'Arena debug  (F3)', open: params.get('debug') === '1' });
// One transport per connection attempt; order matters: the tap sits outermost so the inspector shows what the game actually receives.
const makeTransport = () => {
  const base = connectWebSocket(wsUrl);
  return debug.tap(simulated
    ? simulateLink(base, { up: { latencyMs: lag, jitterMs: jitter, loss }, down: { latencyMs: lag, jitterMs: jitter, loss } })
    : base);
};
// ?delay=100 renders a fixed 100 ms behind instead of adapting to the measured jitter and loss.
const fixedDelayMs = params.get('delay') ? Number(params.get('delay')) : null;
// If the connection drops, retry with backoff and present the session token: the server gives back the same player.
const client = new ArenaClient({
  url: wsUrl, transport: makeTransport(), predict: params.get('predict') !== '0', predictShots: params.get('predictshots') !== '0', fixedDelayMs, fetchMod,
  reconnect: { createTransport: makeTransport },
}).start();

// ---- input ----
const keys = new Set();
addEventListener('keydown', (e) => { keys.add(e.code); if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault(); });
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());
// Mouse: aim with the cursor, hold the button (or Space) to fire. The shot is judged by the server against what you SEE (lag compensation).
const mouse = { x: 0, y: 0, down: false };
addEventListener('pointermove', (e) => { mouse.x = e.clientX; mouse.y = e.clientY; });
addEventListener('pointerdown', (e) => { mouse.x = e.clientX; mouse.y = e.clientY; mouse.down = true; });
addEventListener('pointerup', () => { mouse.down = false; });
function readInput() {
  const x = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
  const y = (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0) - (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0);
  const fire = mouse.down || keys.has('Space');
  const buttons = (keys.has('ShiftLeft') || keys.has('ShiftRight') ? BUTTON_DASH : 0) | (fire ? BUTTON_FIRE : 0);
  // aim: from the player's position on screen toward the cursor
  const me = camera.worldToScreen(shownSelf.x, shownSelf.y, aimScratch);
  return [x, y, buttons, mouse.x - me.x, mouse.y - me.y];
}
const aimScratch = { x: 0, y: 0 };

// ---- shot tracers (from server shot events) ----
const tracers = [];
const toasts = []; // messages from the server (e.g. from mods), shown for a few seconds
client.onEvent = (e) => {
  if (e.kind === 2) { toasts.push({ text: e.text, until: performance.now() + 4000 }); if (toasts.length > 4) toasts.shift(); return; }
  tracers.push({ ...e, until: performance.now() + 140, born: performance.now() }); if (tracers.length > 64) tracers.shift();
};
// Your own shots are predicted: the tracer appears the moment you fire, and the server's event only draws again if it disagrees.
client.onPredictedShot = (s) => { tracers.push({ ...s, hit: s.victim, until: performance.now() + 140, born: performance.now() }); if (tracers.length > 64) tracers.shift(); };
let shotsSeen = 0, hitsSeen = 0;

// ---- scene ----
const walls = buildWalls();
const batch = new SpriteBatch(4096);
const samples = createSampleBuffer();
const BAR_BG = packTint(10, 12, 20, 200), BAR_OK = packTint(90, 220, 120), BAR_WARN = packTint(240, 200, 80), BAR_LOW = packTint(240, 80, 70);
let WALL = packTint(74, 84, 112), FLOOR = packTint(22, 26, 38), DOT = packTint(44, 52, 74);
const RING = packTint(255, 255, 255);
// Verified mod presentation data (already whitelisted and range-checked by the client).
client.onModsLoaded = () => {
  const t = client.theme;
  if (t.floor) FLOOR = packTint(...t.floor);
  if (t.wall) WALL = packTint(...t.wall);
  if (t.dot) DOT = packTint(...t.dot);
  if (t.title) document.title = t.title;
};
let fps = 0, frames = 0, fpsClock = performance.now(), lastBytes = 0, kbps = 0;

function drawScene() {
  batch.clear();
  hpLabels.length = 0;
  batch.push(WORLD.w / 2, WORLD.h / 2, WORLD.w, WORLD.h, 0, square, FLOOR);
  for (let gx = 100; gx < WORLD.w; gx += 100) for (let gy = 100; gy < WORLD.h; gy += 100) batch.push(gx, gy, 5, 5, 0, square, DOT);
  for (const w of walls) batch.push(w.x, w.y, w.hw * 2, w.hh * 2, 0, square, WALL);
  sampleWorld(client.history, client.renderTick(), samples);
  let selfX = camera.x, selfY = camera.y;
  const predicted = client.predicted?.initialized ? client.predicted.renderPosition(alpha, selfPos) : null;
  for (let i = 0; i < samples.count; i++) {
    const r = samples.radius[i];
    let x = samples.x[i], y = samples.y[i];
    if (samples.ids[i] === client.selfId) {
      // The local player is drawn from prediction (no network delay); everyone else is interpolated.
      if (predicted) { x = predicted.x; y = predicted.y; }
      selfX = x; selfY = y;
      batch.push(x, y, r * 2 + 10, r * 2 + 10, 0, circle, RING);
    }
    batch.push(x, y, r * 2, r * 2, 0, circle, hueTint(samples.hue[i]));
    if (samples.hp[i] < client.rules.weapon.maxHp) { // health bar
      const frac = samples.hp[i] / client.rules.weapon.maxHp, bw = 34;
      batch.push(x, y - r - 9, bw + 2, 5, 0, square, BAR_BG);
      batch.push(x - (bw * (1 - frac)) / 2, y - r - 9, bw * frac, 3, 0, square, frac > 0.5 ? BAR_OK : frac > 0.25 ? BAR_WARN : BAR_LOW);
      hpLabels.push(x, y - r - 12, samples.hp[i]);
    }
  }
  const now = performance.now();
  for (let i = tracers.length - 1; i >= 0; i--) {
    const t = tracers[i];
    if (now > t.until) { tracers.splice(i, 1); continue; }
    const k = 1 - (now - t.born) / 140; // fades out
    const dx = t.x1 - t.x0, dy = t.y1 - t.y0, len = Math.sqrt(dx * dx + dy * dy);
    batch.push((t.x0 + t.x1) / 2, (t.y0 + t.y1) / 2, len, 3, Math.atan2(dy, dx), square, packTint(255, 240, 160, 255 * k));
    if (t.hit >= 0) { const s = 22 + (1 - k) * 26; batch.push(t.x1, t.y1, s, s, 0, circle, packTint(255, 80, 70, 230 * k)); }
  }
  worldFont.draw(batch, 'you', selfX, selfY + 26, { align: 'center', size: 20, tint: packTint(255, 255, 255, 210) });
  shownSelf.x = selfX; shownSelf.y = selfY;
  return [selfX, selfY];
}

function interpLine(c) {
  const mode = fixedDelayMs !== null ? 'fixed' : 'adaptive';
  return `interp    ${mode}: ${c.behindNewestMs.toFixed(0)} ms behind, jitter ${c.jitterMs.toFixed(1)} ms, gap ${c.gapPeak.toFixed(1)}, speed x${c.rate.toFixed(2)}\n`;
}

let frameTime = performance.now();
let frameMs = 0;
let alpha = 0;
const selfPos = { x: 0, y: 0 };
const shownSelf = { x: 0, y: 0 }; // where the local player was last drawn (for tests)
const loop = new FixedLoop({
  tickRate: TICK_RATE,
  update: () => { const [x, y, b, ax, ay] = readInput(); client.sendInput(x, y, b, ax, ay); },
  render: (a) => {
    alpha = a;
    const now = performance.now();
    const dt = Math.min(0.1, (now - frameTime) / 1000);
    frameTime = now;
    frameMs += (dt * 1000 - frameMs) * 0.1;
    client.predicted?.smooth(dt);
    const [sx, sy] = drawScene();
    camera.follow(sx, sy, dt, 0.0005);
    camera.update(dt);
    renderer.render({ camera, batch, clear: [0.05, 0.05, 0.08, 1] });
    drawHud(now);
    frames++;
    if (now - fpsClock >= 500) {
      fps = (frames * 1000) / (now - fpsClock);
      kbps = ((client.stats.bytes - lastBytes) / (now - fpsClock)) * (1000 / 1024);
      lastBytes = client.stats.bytes;
      frames = 0; fpsClock = now;
      const s = client.stats;
      hud.textContent =
        `renderer  ${renderer.kind}\n` +
        `fps       ${fps.toFixed(0)}\n` +
        `entities  ${samples.count}\n` +
        `tick      ${client.latestTick}   rtt ${Number.isNaN(client.rttMs) ? '-' : client.rttMs.toFixed(0)} ms\n` +
        (client.clock ? interpLine(client.clock.status(now)) : '') +
        `down      ${kbps.toFixed(1)} KB/s (${s.fullSnapshots}/${s.snapshots} full)\n` +
        `stale ${s.stale}  resync ${s.missingBaseline}\n` +
        (client.predicted
          ? `predict   on, pending ${client.predicted.pending}, corrections ${client.predicted.stats.corrections}, last err ${client.predicted.stats.lastError.toFixed(3)}\n`
          : 'predict   off\n') +
        (simulated ? `network   +${lag} ms each way, jitter ${jitter}, loss ${loss}\n` : '') +
        `WASD move, Shift dash, mouse aim + click/Space fire, F3 debug`;
    }
  },
});

const labelPos = { x: 0, y: 0 };
function drawHud(now) {
  overlay.clear();
  hudCamera.setScreenSpace(camera.viewW, camera.viewH);
  for (let i = 0; i < hpLabels.length; i += 3) {
    camera.worldToScreen(hpLabels[i], hpLabels[i + 1], labelPos);
    if (labelPos.x < -20 || labelPos.y < -20 || labelPos.x > camera.viewW + 20 || labelPos.y > camera.viewH + 20) continue;
    font.draw(overlay, String(hpLabels[i + 2]), labelPos.x, labelPos.y - font.lineHeight, { align: 'center', shadow: SHADOW });
  }
  let y = 14;
  for (const t of toasts) {
    if (t.until <= now) continue;
    const box = toastFont.draw(overlay, t.text, camera.viewW / 2, y, { align: 'center', shadow: SHADOW, maxWidth: camera.viewW - 40, tint: packTint(255, 240, 160) });
    y += box.height + 4;
  }
  if (overlay.count > 0) renderer.render({ camera: hudCamera, batch: overlay, clear: null });
}

let last = performance.now();
function frame(now) {
  loop.advance((now - last) / 1000);
  while (toasts.length && toasts[0].until <= now) toasts.shift();
  last = now;
  msg.textContent =
    client.state === 'connecting' || client.state === 'handshaking' ? 'connecting...' :
    client.state === 'loading-mods' ? 'loading and verifying mods...' :
    client.state === 'reconnecting' ? `connection lost - reconnecting (attempt ${client.attempt})...` :
    client.state === 'rejected' ? `rejected: ${client.closeReason}` :
    client.state === 'closed' ? `disconnected${client.closeReason ? `: ${client.closeReason}` : ''}` : '';
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ---- debug overlay: what to graph ----
debug
  .addSeries('rtt', { label: 'RTT (input to ack)', unit: 'ms', read: () => client.rttMs, warnAbove: 150 })
  .addSeries('down', { label: 'Download', unit: 'KB/s', read: () => client.stats.bytes, rate: true, scale: 1 / 1024 })
  .addSeries('snap', { label: 'Snapshot size', unit: 'B', read: () => client.lastSnapshotBytes, decimals: 0 })
  .addSeries('behind', { label: 'Render behind newest', unit: 'ms', read: () => client.clock?.status(performance.now()).behindNewestMs })
  .addSeries('jitter', { label: 'Arrival jitter', unit: 'ms', read: () => client.clock?.status(performance.now()).jitterMs })
  .addSeries('stale', { label: 'Late/duplicate snapshots', unit: '/s', read: () => client.stats.stale, rate: true, decimals: 1 })
  .addSeries('err', { label: 'Prediction error', unit: 'u', read: () => client.predicted?.stats.lastError, decimals: 3, warnAbove: 0.08 })
  .addSeries('visible', { label: 'Entities in view', unit: '', read: () => samples.count, decimals: 0 })
  .addSeries('fps', { label: 'FPS', unit: '', read: () => fps, decimals: 0 })
  .addSeries('frame', { label: 'Frame time', unit: 'ms', read: () => frameMs, warnAbove: 20 })
  .addInfo('renderer', () => renderer.kind)
  .addInfo('state', () => client.state)
  .addInfo('entities', () => samples.count)
  .addInfo('tick', () => client.latestTick)
  .addInfo('predict', () => (client.predicted ? `${client.predicted.stats.corrections} corrections, ${client.predicted.stats.snaps} snaps, ${client.predicted.pending} pending` : 'off'))
  .addInfo('shots', () => { const s = client.shotStats; return client.predictShots ? `${s.predicted} predicted, ${s.agreed}/${s.confirmed} confirmed same, ${s.disagreed} corrected, ${s.unconfirmed} unconfirmed` : 'off'; })
  .addInfo('snapshots', () => `${client.stats.fullSnapshots}/${client.stats.snapshots} full, ${client.stats.stale} stale, ${client.stats.missingBaseline} resync`)
  .addInfo('interp', () => { const c = client.clock?.status(performance.now()); return c ? `speed x${c.rate.toFixed(2)}, peak gap ${c.gapPeak.toFixed(1)}, buffer ${c.bufferMs.toFixed(0)} ms` : '-'; });

// Expose for the headless smoke test.
window.__arena = { verify: verifyClientView, client, renderer, shownSelf, debug, camera, get samples() { return samples; } };
void WHITE;
