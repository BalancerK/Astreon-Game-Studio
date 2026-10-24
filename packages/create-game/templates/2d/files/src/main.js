// The page: draws the game, reads the input, runs the rules at a fixed rate and keeps the best score between visits.
import { FixedLoop } from '@engine/core';
import { createRenderer, Atlas, SpriteBatch, Camera, Font, packTint } from '@engine/render';
import { createInput } from '@engine/input';
import { SaveGame, LocalStorageStorage, valueSection } from '@engine/save';
import { WORLD, createGame, step } from './game.js';

// ---- the picture: one round sprite, tinted to any colour ----
const atlas = new Atlas({ size: 512 });
const dot = atlas.add('dot', 32, 32, (g, x, y, w) => {
  g.fillStyle = '#fff';
  g.beginPath();
  g.arc(x + w / 2, y + w / 2, w / 2 - 1, 0, Math.PI * 2);
  g.fill();
});
const font = new Font(atlas, { family: 'system-ui, sans-serif', size: 20, weight: 'bold', scale: devicePixelRatio || 1 });
const renderer = await createRenderer({ atlas });          // WebGPU, else WebGL2, else Canvas2D
document.getElementById('stage').append(renderer.canvas);
const worldCamera = new Camera(), screenCamera = new Camera(), worldBatch = new SpriteBatch(), hudBatch = new SpriteBatch();
function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.resize(w, h, devicePixelRatio || 1);
  worldCamera.setViewport(w, h); worldCamera.x = WORLD.width / 2; worldCamera.y = WORLD.height / 2;
  worldCamera.zoom = Math.min(w / WORLD.width, h / WORLD.height);   // the whole world always fits
  screenCamera.setScreenSpace(w, h);
}
addEventListener('resize', resize); resize();

// ---- the controls: describe what the player can do, not which key does it ----
const { input } = createInput({
  element: renderer.canvas,
  actions: {
    move: {
      type: 'vector2',
      bindings: [
        { type: 'keys2d', up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD' },
        { type: 'keys2d', up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' },
        { type: 'gamepadStick', stick: 'left' },
      ],
    },
    restart: {
      type: 'button',
      bindings: [{ type: 'key', code: 'Space' }, { type: 'key', code: 'Enter' }, { type: 'gamepadButton', button: 'south' }],
    },
  },
});

// ---- the best score is saved in the browser ----
const saves = new SaveGame({ game: '{{name}}', version: 1, storage: new LocalStorageStorage('{{name}}:') });
let game = createGame(1);
saves.section('progress', valueSection(() => ({ best: game.best }), (d) => { game.best = d.best; }));
try { await saves.load('best'); } catch { /* nothing saved yet */ }

// ---- the loop: the rules run 60 times a second whatever the frame rate ----
let seed = 1;
const loop = new FixedLoop({
  tickRate: 60,
  update(dt) {
    input.update(dt);
    if (game.over) {
      if (input.pressed('restart')) { const best = game.best; game = createGame(++seed, best); }
      return;
    }
    const { x, y } = input.vector('move');
    const events = step(game, { x, y: -y }, dt);       // the input's forward (+y) is up the screen; the screen's y grows downwards
    if (events.hit) saves.save('best').catch(() => {});
  },
});

function draw() {
  worldBatch.clear(); hudBatch.clear();
  for (const c of game.coins) worldBatch.push(c.x, c.y, c.r * 2, c.r * 2, 0, dot, packTint(255, 210, 60));
  for (const h of game.hazards) worldBatch.push(h.x, h.y, h.r * 2, h.r * 2, 0, dot, packTint(235, 80, 80));
  const p = game.player;
  worldBatch.push(p.x, p.y, p.r * 2, p.r * 2, 0, dot, game.over ? packTint(120, 120, 130) : packTint(90, 200, 255));
  font.draw(hudBatch, `Coins ${game.score}    Best ${game.best}`, 16, 12, { shadow: {} });
  if (game.over) font.draw(hudBatch, 'Caught!  Space to play again', innerWidth / 2, innerHeight / 2 - 12, { align: 'center', shadow: {} });
  renderer.render({ camera: worldCamera, batch: worldBatch, clear: [0.07, 0.08, 0.11, 1] });
  renderer.render({ camera: screenCamera, batch: hudBatch, clear: null });
}

let last = performance.now();
function frame(now) {
  loop.advance((now - last) / 1000); last = now;
  draw();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
window.__game = { get state() { return game; } };   // handy in the browser console and for tests
