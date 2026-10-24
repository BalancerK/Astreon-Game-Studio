// The feel of a game: sparks when something happens, a shake of the screen when something hits hard. Everything lives in the game's state as plain things and
// numbers (and uses the seeded random), so a recording of the game replays the same sparks. Call `effects(game, dt)` once per tick in `update`.
import { spawn, all, despawn, random, randomBetween } from './things.js';
import { getSetting } from './settings.js';

export const MAX_SPARKS = 400;

/**
 * Throw a burst of small sparks from a point.
 * @param {Object} game
 * @param {number} x
 * @param {number} y
 * @param {{count?: number, color?: string, speed?: number, life?: number, size?: number, gravity?: number}} [o]
 *   `count` how many, `speed` how fast they fly out (pixels per second), `life` seconds before they are gone, `gravity` how hard they fall
 */
export function burst(game, x, y, { count = 12, color = '#ffd23c', speed = 160, life = 0.5, size = 4, gravity = 400 } = {}) {
  const have = all(game, 'spark').length;
  for (let i = 0; i < Math.min(count, MAX_SPARKS - have); i++) {
    const angle = random(game) * Math.PI * 2;
    const v = randomBetween(game, speed * 0.3, speed);
    spawn(game, 'spark', {
      x: x - size / 2, y: y - size / 2, w: size, h: size, vx: Math.cos(angle) * v, vy: Math.sin(angle) * v,
      color, life, maxLife: life, pull: gravity, alpha: 1,
    });
  }
}

/**
 * Shake the screen for a moment.
 * @param {Object} game
 * @param {number} [amount] how far, in pixels
 * @param {number} [seconds]
 */
export function shake(game, amount = 6, seconds = 0.25) {
  if (getSetting('reducedMotion')) return;                 // a player who asked for less movement gets none
  game.shake = { amount, left: seconds, total: seconds, time: game.shake?.time ?? 0 };
}

/**
 * Move the sparks, fade them out, remove the ones that are done, and settle the shake. Call it every tick.
 * @param {Object} game
 * @param {number} dt
 */
export function effects(game, dt) {
  for (const t of all(game, 'spark')) {
    t.life -= dt;
    if (t.life <= 0) { despawn(game, t); continue; }
    if (t.drag) {
      const k = Math.max(0, 1 - t.drag * dt);
      t.vx *= k;
      t.vy *= k;
    }
    t.vy += t.pull * dt;
    t.x += t.vx * dt;
    t.y += t.vy * dt;
    const age = 1 - t.life / t.maxLife;
    if (t.size0 !== undefined) {                          // particles from an effect recipe change size as they age, around their middle
      const size = t.size0 + (t.size1 - t.size0) * age;
      t.x += (t.w - size) / 2;
      t.y += (t.h - size) / 2;
      t.w = size;
      t.h = size;
    }
    t.alpha = t.fades === false ? 1 : Math.max(0, t.life / t.maxLife);
  }
  const s = game.shake;
  if (s) {
    s.time += dt;
    s.left -= dt;
    if (s.left <= 0) game.shake = null;
  }
}

/**
 * Where the screen is pushed by the shake right now (zero when nothing is shaking). Used by `drawThings`.
 * @param {{shake?: {amount: number, left: number, total: number, time: number} | null}} game
 * @returns {{x: number, y: number}}
 */
export function shakeOffset(game) {
  const s = game.shake;
  if (!s) return { x: 0, y: 0 };
  const k = (s.amount * s.left) / s.total;
  return { x: Math.sin(s.time * 97) * k, y: Math.cos(s.time * 83) * k };
}
