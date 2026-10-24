// Things: the objects of a small game (a hero, a coin, a wall). A thing is a plain object kept in a list inside the game's state, so a game made of them can
// be saved, copied, rewound and hot-reloaded without any special care: there are no classes and no hidden state anywhere.

/**
 * @typedef {Object} Thing
 * @property {number} id a number nothing else has
 * @property {string} kind what it is: 'hero', 'coin', 'wall'... (you choose)
 * @property {number} x left edge, in pixels
 * @property {number} y top edge, in pixels
 * @property {number} w width
 * @property {number} h height
 * @property {number} vx speed to the right, in pixels per second (negative: left)
 * @property {number} vy speed downwards, in pixels per second (negative: up)
 * @property {string} [color] a CSS colour to fill it with
 * @property {string} [emoji] a picture made of text, drawn instead of a colour, for example '🪙'
 * @property {boolean} [onGround] set by {@link moveAndCollide}: standing on something
 */

/**
 * A new game state with everything the kit uses. Add your own fields after it.
 * @param {Object} [extra] your own fields, for example `{ lives: 3 }`
 * @returns {{things: Thing[], nextId: number, seed: number, score: number, camera: {x: number, y: number}, timers: Object<string, number>}}
 */
export function newGame(extra = {}) {
  return { things: [], nextId: 1, seed: 12345, score: 0, camera: { x: 0, y: 0 }, timers: {}, ...extra };
}

/**
 * Add a thing to the game.
 * @param {Object} game the game state
 * @param {string} kind what it is, for example 'hero'
 * @param {Partial<Thing> & Object} [props] anything about it: x, y, w, h, color, emoji, and your own fields (hp, speed...)
 * @returns {Thing} the new thing, so you can keep working with it
 */
export function spawn(game, kind, props = {}) {
  game.things ??= [];
  game.nextId ??= 1;
  const thing = { id: game.nextId++, kind, x: 0, y: 0, w: 32, h: 32, vx: 0, vy: 0, color: '#5ac8ff', ...props };
  game.things.push(thing);
  return thing;
}

/**
 * All the things of one kind (or every thing). The list is a copy, so it is safe to {@link despawn} while looping over it.
 * @param {Object} game
 * @param {string} [kind]
 * @returns {Thing[]}
 */
export function all(game, kind) {
  const things = game.things ?? [];
  return kind === undefined ? things.slice() : things.filter((t) => t.kind === kind);
}

/**
 * The first thing of a kind, or undefined when there is none (for example the only 'hero').
 * @param {Object} game
 * @param {string} kind
 * @returns {Thing | undefined}
 */
export function first(game, kind) {
  return (game.things ?? []).find((t) => t.kind === kind);
}

/**
 * Take every thing out of the game (to start a level again), except the kinds you name.
 * @param {Object} game
 * @param {string[]} [keep] kinds to leave in place
 */
export function clearThings(game, keep = []) {
  game.things = (game.things ?? []).filter((t) => keep.includes(t.kind));
}

/**
 * Take a thing out of the game (a coin that was picked up). Does nothing if it is already gone.
 * @param {Object} game
 * @param {Thing} thing
 * @returns {boolean} whether it was there
 */
export function despawn(game, thing) {
  const i = (game.things ?? []).indexOf(thing);
  if (i < 0) return false;
  game.things.splice(i, 1);
  return true;
}

/**
 * Do two things overlap?
 * @param {Thing} a
 * @param {Thing} b
 * @returns {boolean}
 */
export function touching(a, b) {
  return a !== b && a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/**
 * Every thing of a kind that overlaps this one.
 * @param {Object} game
 * @param {Thing} thing
 * @param {string} kind
 * @returns {Thing[]}
 */
export function overlaps(game, thing, kind) {
  return (game.things ?? []).filter((t) => t.kind === kind && touching(thing, t));
}

/**
 * The first thing of a kind that overlaps this one, or undefined.
 * @param {Object} game
 * @param {Thing} thing
 * @param {string} kind
 * @returns {Thing | undefined}
 */
export function touches(game, thing, kind) {
  return (game.things ?? []).find((t) => t.kind === kind && touching(thing, t));
}

/**
 * Move a thing by its speed for one tick (no collisions: use {@link moveAndCollide} for things that must not pass through walls).
 * @param {Thing} thing
 * @param {number} dt the tick's length in seconds, as given to `update`
 */
export function move(thing, dt) {
  thing.x += thing.vx * dt;
  thing.y += thing.vy * dt;
}

/**
 * Do something every so many seconds. Call it once per tick with a name; it answers true on the ticks when the time is up.
 * @param {Object} game
 * @param {string} name any name, one per timer
 * @param {number} seconds
 * @param {number} dt
 * @returns {boolean}
 */
export function every(game, name, seconds, dt) {
  game.timers ??= {};
  game.timers[name] = (game.timers[name] ?? 0) + dt;
  if (game.timers[name] < seconds) return false;
  game.timers[name] -= seconds;
  return true;
}

/**
 * A random number from 0 up to (not including) 1. It uses a seed kept in the game state, so the same game plays out the same way every time, which is what
 * makes a recording or a rewind of the game possible.
 * @param {Object} game
 * @returns {number}
 */
export function random(game) {
  let t = (game.seed = ((game.seed ?? 12345) + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/**
 * A random number between two values.
 * @param {Object} game
 * @param {number} low
 * @param {number} high
 * @returns {number}
 */
export function randomBetween(game, low, high) {
  return low + random(game) * (high - low);
}
