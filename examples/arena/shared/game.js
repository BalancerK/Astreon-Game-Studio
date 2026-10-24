// Game rules shared by the server and every client (so prediction can reuse them later).
// Keep this file deterministic: only + - * / and sqrt, no Math.random / Date.now / trig.
import { defineComponent } from '../../../packages/core/src/index.js';
import { NetSchema, InputSchema, q, u8, i8, u16 } from '../../../packages/protocol/src/index.js';
import { SpatialHash, moveAndSlide, createMoveResult } from '../../../packages/physics/src/index.js';
import { DEFAULT_RULES } from './rules.js';

export const WORLD = Object.freeze({ w: 2400, h: 2400 });
export const TICK_RATE = 60;
export const PLAYER_SPEED = 420;
export const DASH_MULT = 2.5;
export const BUTTON_DASH = 1;
export const BUTTON_FIRE = 2;
export const GROUP_WALL = 1;

/** Hitscan weapon, judged by the server (with lag compensation). */
export const WEAPON = DEFAULT_RULES.weapon; // defaults only: live values come from a `rules` object (data mods change them)

export const Pos = defineComponent('arena:pos', { x: 'f32', y: 'f32' });
export const Style = defineComponent('arena:style', { hue: 'u8', radius: 'u8' });
export const Health = defineComponent('arena:health', { hp: 'u8' });

export const netSchema = new NetSchema([
  { component: Pos, codecs: { x: q(0, WORLD.w, 16), y: q(0, WORLD.h, 16) } },
  { component: Style, codecs: { hue: u8, radius: u8 } },
  { component: Health, codecs: { hp: u8 } },
]);

/**
 * One input per tick. Axes and aim are integers (-127..127): a quantized float cannot represent exactly 0.
 * `view` is only meaningful with the fire button: the server tick (in quarter ticks, modulo 65536) the
 * shooter was looking at when they fired, which the server rewinds to (lag compensation). 0 = unknown.
 */
export const inputSchema = new InputSchema({ moveX: i8, moveY: i8, buttons: u8, aimX: i8, aimY: i8, view: u16 });

/** Small integer hash: deterministic map layout without Math.random. */
function hash2(i, j) {
  let h = Math.imul(i + 374761393, 668265263) ^ Math.imul(j + 1274126177, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

/** @returns {{x: number, y: number, hw: number, hh: number}[]} Border walls plus scattered pillars. */
export function buildWalls() {
  const { w, h } = WORLD;
  const t = 40;
  const walls = [
    { x: w / 2, y: t / 2, hw: w / 2, hh: t / 2 },
    { x: w / 2, y: h - t / 2, hw: w / 2, hh: t / 2 },
    { x: t / 2, y: h / 2, hw: t / 2, hh: h / 2 },
    { x: w - t / 2, y: h / 2, hw: t / 2, hh: h / 2 },
  ];
  const step = 300;
  for (let i = 1; i * step < w - step / 2; i++) {
    for (let j = 1; j * step < h - step / 2; j++) {
      const r = hash2(i, j);
      if (r % 3 !== 0) continue;
      const hw = 25 + (r >>> 8) % 60, hh = 25 + (r >>> 16) % 60;
      walls.push({ x: i * step + ((r >>> 4) % 80) - 40, y: j * step + ((r >>> 12) % 80) - 40, hw, hh });
    }
  }
  return walls;
}

/** Build the static collision hash for the wall set. */
export function buildWallHash(walls) {
  const hash = new SpatialHash({ width: WORLD.w, height: WORLD.h, cellSize: 128, capacity: walls.length });
  walls.forEach((b, i) => hash.insert(i, b.x, b.y, b.hw, b.hh, GROUP_WALL));
  hash.build();
  return hash;
}

export const PLAYER_RADIUS = 14;

const result = createMoveResult();

/**
 * Advance one mover by one tick. Same function on server (authoritative) and,
 * in M3, on the client (prediction).
 *
 * @param {import('../../../packages/physics/src/index.js').SpatialHash} walls
 * @param {{x: number, y: number}} p Position, updated in place.
 * @param {number} radius
 * @param {number} moveX -1..1
 * @param {number} moveY -1..1
 * @param {number} speed Units per second
 * @param {number} dt Seconds
 */
export function stepMover(walls, p, radius, moveX, moveY, speed, dt) {
  const len = Math.sqrt(moveX * moveX + moveY * moveY);
  if (len === 0) return;
  const k = (speed * dt) / (len > 1 ? len : 1);
  moveAndSlide(walls, p.x, p.y, radius, radius, moveX * k, moveY * k, GROUP_WALL, -1, result);
  p.x = result.x;
  p.y = result.y;
}

/**
 * One player input = one tick of movement. THE function both the server
 * (authoritative) and the client (prediction) call, so they agree exactly.
 * Positions are rounded to float32 after every step, matching the server's
 * Float32Array storage, so no hidden precision difference can build up.
 *
 * @param {import('../../../packages/physics/src/index.js').SpatialHash} walls
 * @param {{x: number, y: number}} p Updated in place.
 * @param {number} moveX -127..127
 * @param {number} moveY -127..127
 * @param {number} buttons
 * @param {number} dt Seconds per tick
 * @param {{playerSpeed: number, dashMult: number}} [rules] Server and client must use the same values (data mods can change them).
 */
export function applyInput(walls, p, moveX, moveY, buttons, dt, rules = DEFAULT_RULES) {
  const dash = (buttons & BUTTON_DASH) !== 0;
  stepMover(walls, p, PLAYER_RADIUS, moveX / 127, moveY / 127, rules.playerSpeed * (dash ? rules.dashMult : 1), dt);
  p.x = Math.fround(p.x);
  p.y = Math.fround(p.y);
}
