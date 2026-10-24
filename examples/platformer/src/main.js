// The page: draws the game, reads the input, runs the rules at a fixed rate, plays sounds, and keeps your best times between visits.
// Arrows or A/D to run, Space/W/Up to jump, R to restart the level, N for the next one, Esc for the level list. A gamepad works too.
import { FixedLoop } from '../../../packages/core/src/index.js';
import { createRenderer, Atlas, SpriteBatch, Camera, Font, packTint } from '../../../packages/render/src/index.js';
import { createInput } from '../../../packages/input/src/index.js';
import { AudioEngine, onUserGesture, sfx } from '../../../packages/audio/src/index.js';
import { SaveGame, LocalStorageStorage, valueSection } from '../../../packages/save/src/index.js';
import { TILE, loadLevel } from './level.js';
import { createGame, step, DT, LEFT, RIGHT, JUMP } from './game.js';

// ---- the picture: a white square, circle and triangle, tinted to any colour ----
const atlas = new Atlas({ size: 512 });
const box = atlas.add('box', 16, 16, (g, x, y, w) => { g.fillStyle = '#fff'; g.fillRect(x, y, w, w); });
const dot = atlas.add('dot', 32, 32, (g, x, y, w) => {
  g.fillStyle = '#fff';
  g.beginPath();
  g.arc(x + w / 2, y + w / 2, w / 2 - 1, 0, Math.PI * 2);
  g.fill();
});
const tri = atlas.add('tri', 16, 16, (g, x, y, w) => {
  g.fillStyle = '#fff';
  g.beginPath();
  g.moveTo(x, y + w);
  g.lineTo(x + w / 2, y);
  g.lineTo(x + w, y + w);
  g.fill();
});
const font = new Font(atlas, { family: 'system-ui, sans-serif', size: 20, weight: 'bold', scale: devicePixelRatio || 1 });
const renderer = await createRenderer({ atlas });
document.getElementById('stage').append(renderer.canvas);
const camera = new Camera(), screenCamera = new Camera(), batch = new SpriteBatch(), hud = new SpriteBatch();
const VIEW_H = 13 * TILE;       // the screen always shows thirteen tiles from top to bottom
function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.resize(w, h, devicePixelRatio || 1);
  camera.setViewport(w, h); camera.zoom = h / VIEW_H; screenCamera.setScreenSpace(w, h);
}
addEventListener('resize', resize); resize();

// ---- the controls ----
const key = (code) => ({ type: 'key', code });
const pad = (button) => ({ type: 'gamepadButton', button });
const stick = (direction) => ({ type: 'gamepadAxis', axis: 'leftX', direction });
const touch = (id) => ({ type: 'touchButton', id });
const { input } = createInput({
  element: renderer.canvas,
  actions: {
    left: { type: 'button', bindings: [key('ArrowLeft'), key('KeyA'), pad('dpadLeft'), stick(-1), touch('left')] },
    right: { type: 'button', bindings: [key('ArrowRight'), key('KeyD'), pad('dpadRight'), stick(1), touch('right')] },
    jump: { type: 'button', bindings: [key('Space'), key('ArrowUp'), key('KeyW'), pad('south'), touch('jump')] },
    restart: { type: 'button', bindings: [key('KeyR'), { type: 'gamepadButton', button: 'west' }] },
    next: { type: 'button', bindings: [key('KeyN'), key('Enter'), { type: 'gamepadButton', button: 'start' }] },
    menu: { type: 'button', bindings: [key('Escape'), { type: 'gamepadButton', button: 'back' }] },
  },
});

// ---- the levels, and the best times saved in the browser ----
const files = await (await fetch('levels/index.json')).json();
const levels = await Promise.all(files.map(async (f) => loadLevel(await (await fetch(f)).json())));
const progress = { best: {}, coins: {} };
const saves = new SaveGame({ game: 'platformer', version: 1, storage: new LocalStorageStorage('platformer:') });
saves.section('progress', valueSection(() => progress, (d) => { Object.assign(progress, d); }));
try { await saves.load('progress'); } catch { /* nothing saved yet */ }

// ---- sound: made in code, and only started after the first key press (browsers insist) ----
let audio = null; const sounds = {};
onUserGesture(() => {
  audio = new AudioEngine();
  const make = (name, spec) => { sounds[name] = audio.createSound(spec, name); };
  make('jump', sfx.jump()); make('land', sfx.land()); make('coin', sfx.coin()); make('spring', sfx.powerup());
  make('stomp', sfx.hit()); make('die', sfx.explosion()); make('win', sfx.powerup());
});
const play = (name) => { if (audio && sounds[name]) audio.play(sounds[name], { pitchVariation: 0.04 }); };

// ---- what is on screen ----
let levelIndex = 0, game = null, mode = 'menu', sparks = [], shake = 0;
function burst(x, y, count, tint, speed = 100) {
  for (let i = 0; i < count; i++) {
    sparks.push({ x, y, vx: (Math.random() - 0.5) * speed, vy: -Math.random() * speed * 0.7, life: 0.5, tint });
  }
}

function start(i) {
  levelIndex = i;
  game = createGame(levels[i]);
  mode = 'play';
  sparks = [];
  camera.x = game.player.x;
  camera.y = (levels[i].h * TILE) / 2;
}

const loop = new FixedLoop({
  tickRate: 1 / DT,
  update(dt) {
    input.update(dt);
    if (mode === 'menu') {
      if (input.pressed('next') || input.pressed('jump')) start(levelIndex);
      if (input.pressed('left')) levelIndex = (levelIndex + levels.length - 1) % levels.length;
      if (input.pressed('right')) levelIndex = (levelIndex + 1) % levels.length;
      return;
    }
    if (input.pressed('menu')) { mode = 'menu'; return; }
    if (input.pressed('restart')) { start(levelIndex); return; }
    if (game.status === 'won' && input.pressed('next')) { start((levelIndex + 1) % levels.length); return; }
    const bits = (input.held('left') ? LEFT : 0) | (input.held('right') ? RIGHT : 0) | (input.held('jump') ? JUMP : 0);
    for (const e of step(game, bits)) {
      play(e.e);
      if (e.e === 'coin') burst(e.at.x, e.at.y, 6, packTint(255, 220, 80), 90);
      if (e.e === 'stomp') { shake = 3; burst(e.at.x, e.at.y, 8, packTint(230, 120, 90), 120); }
      if (e.e === 'land') burst(game.player.x, game.player.y + 7, 4, packTint(200, 200, 210), 60);
      if (e.e === 'die') shake = 6;
      if (e.e === 'win') {
        const best = progress.best[levelIndex];
        if (best === undefined || e.time < best) progress.best[levelIndex] = e.time;
        progress.coins[levelIndex] = Math.max(progress.coins[levelIndex] ?? 0, e.coins);
        saves.save('progress').catch(() => {});
      }
    }
    for (const s of sparks) { s.x += s.vx * dt; s.y += s.vy * dt; s.vy += 400 * dt; s.life -= dt; }
    sparks = sparks.filter((s) => s.life > 0);
    const p = game.player, L = game.level, half = innerWidth / 2 / camera.zoom;
    camera.follow(Math.min(Math.max(p.x + p.facing * 18, half), Math.max(half, L.w * TILE - half)), (L.h * TILE) / 2, dt, 0.0005);
    shake = Math.max(0, shake - 12 * dt);
  },
});

const fmt = (t) => `${t.toFixed(1)}s`;
const say = (text, x, y, align = 'center') => font.draw(hud, text, x, y, { align, shadow: {} });
function draw() {
  batch.clear(); hud.clear();
  const W = innerWidth;
  if (mode === 'menu') {
    say('PLATFORMER', W / 2, 60);
    levels.forEach((L, i) => {
      const marker = i === levelIndex ? '> ' : '  ';
      const record = progress.best[i] !== undefined
        ? `best ${fmt(progress.best[i])}  coins ${progress.coins[i] ?? 0}/${L.coins.length}`
        : 'not finished';
      say(`${marker}${i + 1}. ${L.name}    ${record}`, W / 2, 120 + i * 34);
    });
    say('Left / Right to choose, Space to play', W / 2, 140 + levels.length * 34);
    renderer.render({ camera: screenCamera, batch: hud, clear: [0.07, 0.08, 0.11, 1] });
    return;
  }
  const L = game.level, p = game.player;
  const sx = shake ? (Math.random() - 0.5) * shake : 0, sy = shake ? (Math.random() - 0.5) * shake : 0;
  camera.x += sx; camera.y += sy;
  for (const r of L.rects) {
    batch.push(r.x, r.y, r.hw * 2, r.hh * 2, 0, box, packTint(70, 80, 105));              // the ground
    batch.push(r.x, r.y - r.hh + 2, r.hw * 2, 4, 0, box, packTint(110, 190, 120));        // with grass on top
  }
  for (const s of L.spikes) batch.push(s.x, s.y, 14, 8, 0, tri, packTint(220, 90, 90));
  for (const s of L.springs) {
    batch.push(s.x, s.y + 1, 14, 5, 0, box, packTint(240, 200, 60));
    batch.push(s.x, s.y - 3, 12, 3, 0, box, packTint(255, 120, 60));
  }
  L.coins.forEach((c, i) => {
    if (!game.coins[i]) return;
    const bob = Math.sin(game.tick * 0.08 + i) * 1.5;
    batch.push(c.x, c.y + bob, 9, 9, 0, dot, packTint(255, 215, 60));
  });
  for (const e of game.enemies) {
    if (!e.alive) continue;
    batch.push(e.x, e.y, 12, 12, 0, dot, packTint(200, 90, 200));
    batch.push(e.x + Math.sign(e.vx) * 2, e.y - 2, 3, 3, 0, dot, packTint(255, 255, 255));   // an eye, looking where it walks
  }
  batch.push(L.goal.x, L.goal.y, 2, 16, 0, box, packTint(220, 220, 230));                // the flag pole
  batch.push(L.goal.x + 5, L.goal.y - 5, 9, 6, 0, tri, packTint(90, 220, 120));          // and the flag
  if (game.status !== 'dead') {
    const squash = p.grounded ? 1 : Math.min(1.25, 1 + Math.abs(p.vy) / 1500);
    batch.push(p.x, p.y, 10 / squash, 14 * squash, 0, box, packTint(90, 200, 255));
    batch.push(p.x + p.facing * 2, p.y - 3, 3, 3, 0, box, packTint(20, 30, 50));
  }
  for (const s of sparks) batch.push(s.x, s.y, 3, 3, 0, box, s.tint);
  say(`${L.name}   Coins ${game.collected}/${L.coins.length}   Time ${fmt(game.time)}   Deaths ${game.deaths}`, 16, 12, 'left');
  if (game.status === 'won') {
    say(`Level complete!  ${fmt(game.finalTime)}${progress.best[levelIndex] === game.finalTime ? '  (best!)' : ''}`, W / 2, innerHeight / 2 - 30);
    say('N: next level   R: again   Esc: levels', W / 2, innerHeight / 2 + 4);
  }
  renderer.render({ camera, batch, clear: [0.1, 0.12, 0.2, 1] });
  renderer.render({ camera: screenCamera, batch: hud, clear: null });
  camera.x -= sx; camera.y -= sy;
}

let last = performance.now();
function frame(now) { loop.advance(Math.min(0.1, (now - last) / 1000)); last = now; draw(); requestAnimationFrame(frame); }
requestAnimationFrame(frame);
window.__platformer = { get game() { return game; }, get mode() { return mode; }, start, progress };   // handy in the console and for tests
