// Particle effects: fire, smoke, sparkles, rain, confetti. An effect is a plain recipe (made in the studio's Particles panel and kept in `src/particles.js`), and playing
// it makes the same small sparks `burst` makes, so everything lives in the game's state, uses the seeded random, and a recording of the game replays the same effect.
// `emit` throws a burst from a point; `stream` keeps making particles for as long as you call it (a campfire, a rocket's flame). Call `effects(game, dt)` once per tick.
//
//   const fire = { rate: 40, colors: ['#ffd23c', '#ff7a3c'], shape: 'circle', speed: [20, 60], angle: -90, spread: 40, life: [0.4, 0.9], size: [8, 1], gravity: -60 };
//   stream(game, fire, x, y, dt);          // every tick while it burns
//   emit(game, explosion, x, y);           // once, when something blows up
import { spawn, all, random, randomBetween } from './things.js';
import { MAX_SPARKS } from './effects.js';

/**
 * @typedef {object} Recipe
 * @property {number} [count] particles in one `emit`
 * @property {number} [rate] particles a second for `stream`
 * @property {string[]} [colors] each particle picks one of these
 * @property {'square' | 'circle'} [shape]
 * @property {[number, number]} [speed] pixels a second, a fastest and a slowest
 * @property {number} [angle] the direction in degrees (0 is right, 90 is down, -90 is up)
 * @property {number} [spread] how wide the spray is in degrees (360 goes every way)
 * @property {[number, number]} [life] seconds a particle lasts
 * @property {[number, number]} [size] the size it starts at and the size it ends at
 * @property {number} [gravity] pixels a second, added downward each second (negative floats up)
 * @property {number} [drag] how fast it slows down, 0 (not at all) to 5
 * @property {number} [radius] it starts anywhere within this many pixels of the point
 * @property {boolean} [fade] it fades out as it ages (default true)
 */

export const PARTICLE_LIMITS = { count: 200, rate: 300, speed: 1200, life: 5, size: 64, gravity: 2000, drag: 5, radius: 200, colors: 6 };

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const num = (v, fallback) => (Number.isFinite(v) ? v : fallback);
const pair = (v, fallback, lo, hi) => {
  const [a, b] = Array.isArray(v) && v.length === 2 ? v : fallback;
  return [clamp(num(a, fallback[0]), lo, hi), clamp(num(b, fallback[1]), lo, hi)];
};

/**
 * Make a recipe safe to use: known fields only, numbers kept in a sane range, at most 6 colors, a pair of numbers for the ranges. Anything missing gets a plain default.
 * @param {unknown} spec
 * @returns {Required<Recipe>}
 */
export function cleanRecipe(spec) {
  const r = spec && typeof spec === 'object' ? spec : {};
  const L = PARTICLE_LIMITS;
  const colors = (Array.isArray(r.colors) ? r.colors : []).filter((c) => typeof c === 'string' && /^#[0-9a-f]{3,8}$/i.test(c)).slice(0, L.colors);
  return {
    count: Math.round(clamp(num(r.count, 16), 0, L.count)),
    rate: clamp(num(r.rate, 30), 0, L.rate),
    colors: colors.length ? colors : ['#ffd23c'],
    shape: r.shape === 'circle' ? 'circle' : 'square',
    speed: pair(r.speed, [40, 160], 0, L.speed),
    angle: clamp(num(r.angle, -90), -360, 360),
    spread: clamp(num(r.spread, 360), 0, 360),
    life: pair(r.life, [0.3, 0.8], 0.05, L.life),
    size: pair(r.size, [4, 1], 0, L.size),
    gravity: clamp(num(r.gravity, 0), -L.gravity, L.gravity),
    drag: clamp(num(r.drag, 0), 0, L.drag),
    radius: clamp(num(r.radius, 0), 0, L.radius),
    fade: r.fade !== false,
  };
}

function one(game, r, x, y) {
  const spreadRad = (r.spread * Math.PI) / 180;
  const angle = (r.angle * Math.PI) / 180 + (random(game) - 0.5) * spreadRad;
  const v = randomBetween(game, r.speed[0], r.speed[1]);
  const life = randomBetween(game, r.life[0], r.life[1]);
  const [s0, s1] = r.size;
  const around = r.radius ? Math.sqrt(random(game)) * r.radius : 0;
  const turn = random(game) * Math.PI * 2;
  const color = r.colors[Math.floor(random(game) * r.colors.length) % r.colors.length];
  spawn(game, 'spark', {
    x: x + Math.cos(turn) * around - s0 / 2, y: y + Math.sin(turn) * around - s0 / 2, w: s0, h: s0, vx: Math.cos(angle) * v, vy: Math.sin(angle) * v,
    color, shape: r.shape, life, maxLife: life, pull: r.gravity, alpha: 1, size0: s0, size1: s1, drag: r.drag, fades: r.fade,
  });
}

/**
 * Throw one burst of an effect from a point.
 * @param {object} game
 * @param {Recipe} recipe
 * @param {number} x
 * @param {number} y
 */
export function emit(game, recipe, x, y) {
  const r = cleanRecipe(recipe);
  const room = MAX_SPARKS - all(game, 'spark').length;
  for (let i = 0; i < Math.min(r.count, room); i++) one(game, r, x, y);
}

/**
 * Keep an effect going: call it every tick and it makes `rate` particles a second (the part of a particle that does not fit in this tick is kept for the next, so the
 * rate is right at any frame rate). Give each flame its own `key` when there are several.
 * @param {object} game
 * @param {Recipe} recipe
 * @param {number} x
 * @param {number} y
 * @param {number} dt
 * @param {string} [key]
 * @returns {number} how many particles were made this tick
 */
export function stream(game, recipe, x, y, dt, key = 'stream') {
  const r = cleanRecipe(recipe);
  game.streams ??= {};
  const owed = (game.streams[key] ?? 0) + r.rate * dt;
  const n = Math.floor(owed + 1e-9);                     // (not 29.999999 of 30: sums of small steps are never quite exact)
  game.streams[key] = owed - n;
  const room = MAX_SPARKS - all(game, 'spark').length;
  for (let i = 0; i < Math.min(n, room); i++) one(game, r, x, y);
  return Math.min(n, room);
}

/**
 * Look an effect over and say what is wrong, in plain words (it is always made safe by `cleanRecipe`; this tells the person what was changed).
 * @param {unknown} spec
 * @returns {{field: string, message: string}[]}
 */
export function recipeProblems(spec) {
  const out = [];
  if (!spec || typeof spec !== 'object') return [{ field: '', message: 'An effect is an object of settings.' }];
  const clean = cleanRecipe(spec);
  const add = (field, message) => out.push({ field, message });
  if (!Array.isArray(spec.colors) || !spec.colors.length) add('colors', 'No colors: the particles will be yellow.');
  else if (spec.colors.length > PARTICLE_LIMITS.colors) add('colors', `At most ${PARTICLE_LIMITS.colors} colors are used.`);
  for (const f of ['count', 'rate', 'angle', 'spread', 'gravity', 'drag', 'radius']) {
    if (spec[f] !== undefined && clean[f] !== spec[f]) add(f, `"${f}" was ${spec[f]}; it is kept between its limits (${clean[f]}).`);
  }
  for (const f of ['speed', 'life', 'size']) {
    if (spec[f] !== undefined && JSON.stringify(clean[f]) !== JSON.stringify(spec[f])) add(f, `"${f}" should be two numbers within its limits.`);
  }
  if (clean.life[1] < clean.life[0]) add('life', 'The longest life is shorter than the shortest.');
  return out;
}
