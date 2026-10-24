// The project a new studio starts with: two files. `src/main.js` is the game (create, update, render, and an optional summary for the studio's status bar);
// `src/util.js` is a helper it imports, to show that imports between a project's own files work.
export const STARTER = {
  'src/main.js': `import { sin } from '@engine/math';
import { clamp } from './util.js';

const SPEED = 120;            // pixels per second: change me while the game runs

/** A new game. */
export function create() {
  return { t: 0, x: 240, vx: SPEED, score: 0 };
}

/** One tick (1/60 s). \`keys\` is the set of keys held down. */
export function update(game, keys, dt) {
  game.t += dt;
  if (keys.has('ArrowRight')) game.vx = Math.abs(game.vx);
  if (keys.has('ArrowLeft')) game.vx = -Math.abs(game.vx);
  game.vx = Math.sign(game.vx) * SPEED;
  game.x = clamp(game.x + game.vx * dt, 16, 464);
  if (game.x <= 16 || game.x >= 464) {      // bounce off the walls, and score
    game.vx = -game.vx;
    game.score++;
  }
}

/** Draw the game. \`alpha\` says how far we are between two ticks. */
export function render(game, g) {
  g.fillStyle = '#12161f';
  g.fillRect(0, 0, 480, 320);
  g.fillStyle = '#ffd23c';
  g.beginPath();
  g.arc(240, 80 + sin(game.t * 3) * 10, 12, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#5ac8ff';
  g.fillRect(game.x - 16, 240, 32, 32);
  g.fillStyle = '#fff';
  g.font = '16px system-ui';
  g.fillText('Score ' + game.score, 12, 24);
}

/** What the studio shows in its status bar. */
export function summary(game) {
  return { score: game.score, x: Math.round(game.x), t: Math.round(game.t * 10) / 10 };
}
`,
  'src/util.js': `/** Keep a number between a lowest and a highest value. */
export function clamp(value, low, high) {
  return Math.max(low, Math.min(high, value));
}
`,
};
