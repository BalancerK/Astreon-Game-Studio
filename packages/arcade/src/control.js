// Controls and movement: reading the keys by easy names, walking, jumping, falling and not walking through walls. Everything works on the plain things from
// things.js and on `keys`, the set of keys held down that `update` is given.

import { keysFor } from './settings.js';

// The keys behind each easy name live in settings.js, so a game can add its own actions and a player can change them (see `controls` and `setBinding`).

/**
 * Is a key held down? Easy names work: 'left', 'right', 'up', 'down' (arrow keys and WASD), 'space', 'jump' (space, up or W), 'action' (X, Z or Enter), and
 * 'click' and 'rightClick' for the mouse buttons (once the game has asked for the mouse, see {@link mouseDelta}).
 * Any real key code works too: 'KeyP', 'Digit1', 'ShiftLeft'.
 * @param {Set<string>} keys the keys held down
 * @param {string} name
 * @returns {boolean}
 */
export function held(keys, name) {
  return keysFor(name).some((code) => keys.has(code));
}

/**
 * Walk left and right with the keys: sets the sideways speed.
 * @param {import('./things.js').Thing} thing
 * @param {Set<string>} keys
 * @param {number} [speed] pixels per second
 */
export function walk(thing, keys, speed = 160) {
  thing.vx = ((held(keys, 'right') ? 1 : 0) - (held(keys, 'left') ? 1 : 0)) * speed;
}

/**
 * Move in four directions with the keys (for a game seen from above): sets both speeds, and keeps diagonals from being faster.
 * @param {import('./things.js').Thing} thing
 * @param {Set<string>} keys
 * @param {number} [speed] pixels per second
 */
export function steer(thing, keys, speed = 160) {
  let dx = (held(keys, 'right') ? 1 : 0) - (held(keys, 'left') ? 1 : 0);
  let dy = (held(keys, 'down') ? 1 : 0) - (held(keys, 'up') ? 1 : 0);
  if (dx && dy) { dx *= Math.SQRT1_2; dy *= Math.SQRT1_2; }
  thing.vx = dx * speed;
  thing.vy = dy * speed;
}

/**
 * Jump if a jump key is held and the thing is standing on something.
 * @param {import('./things.js').Thing} thing
 * @param {Set<string>} keys
 * @param {number} [power] how fast it leaves the ground, in pixels per second
 * @returns {boolean} whether it jumped
 */
export function jump(thing, keys, power = 620) {
  if (!thing.onGround || !held(keys, 'jump')) return false;
  thing.vy = -power;
  thing.onGround = false;
  return true;
}

/**
 * Pull a thing downwards (call it every tick, before {@link moveAndCollide}). Falling speed is limited so nothing falls through the floor.
 * @param {import('./things.js').Thing} thing
 * @param {number} dt
 * @param {number} [pull] how strong, in pixels per second per second
 */
export function gravity(thing, dt, pull = 1800) {
  thing.vy = Math.min(thing.vy + pull * dt, 900);
}

/**
 * Is there a solid thing at this point?
 * @param {{things: import('./things.js').Thing[]}} game
 * @param {number} x
 * @param {number} y
 * @param {string} [solid] the kind of thing that blocks
 * @returns {boolean}
 */
export function solidAt(game, x, y, solid = 'wall') {
  return (game.things ?? []).some((t) => t.kind === solid && x >= t.x && x < t.x + t.w && y >= t.y && y < t.y + t.h);
}

/**
 * Walk back and forth along the ground: an enemy that turns round at a wall and at the end of a ledge. It sets `thing.dir` (1 or -1) and `thing.flip` (so a
 * picture faces the way it walks). Call it every tick instead of {@link gravity} and {@link moveAndCollide}.
 * @param {{things: import('./things.js').Thing[]}} game
 * @param {import('./things.js').Thing} thing
 * @param {number} dt
 * @param {number} [speed] pixels per second
 * @param {string} [solid] the kind of thing that blocks it
 */
export function patrol(game, thing, dt, speed = 60, solid = 'wall') {
  thing.dir ??= 1;
  thing.vx = thing.dir * speed;
  gravity(thing, dt);
  const hit = moveAndCollide(game, thing, dt, solid);
  const ahead = thing.dir > 0 ? thing.x + thing.w + 1 : thing.x - 1;
  if (hit.x || (thing.onGround && !solidAt(game, ahead, thing.y + thing.h + 2, solid))) thing.dir = -thing.dir;
  thing.flip = thing.dir < 0;
}

/**
 * Move a thing by its speed without going into solid things. It moves sideways first, then up or down, and stops against whatever is in the way. Afterwards
 * `thing.onGround` says whether it is standing on something.
 * @param {{things: import('./things.js').Thing[]}} game
 * @param {import('./things.js').Thing} thing
 * @param {number} dt
 * @param {string} [solid] the kind of thing that blocks it
 * @returns {{x: boolean, y: boolean}} whether it was stopped sideways, and whether it was stopped going up or down
 */
export function moveAndCollide(game, thing, dt, solid = 'wall') {
  const walls = (game.things ?? []).filter((t) => t.kind === solid && t !== thing);
  const dx = thing.vx * dt;
  const dy = thing.vy * dt;
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / 8));     // small steps: a fast thing cannot jump over a thin wall
  const hit = { x: false, y: false };
  thing.onGround = false;
  for (let i = 0; i < steps; i++) {
    thing.x += dx / steps;
    for (const w of walls) {
      if (thing.x < w.x + w.w && thing.x + thing.w > w.x && thing.y < w.y + w.h && thing.y + thing.h > w.y) {
        thing.x = dx > 0 ? w.x - thing.w : w.x + w.w;
        thing.vx = 0;
        hit.x = true;
      }
    }
    thing.y += dy / steps;
    for (const w of walls) {
      if (thing.x < w.x + w.w && thing.x + thing.w > w.x && thing.y < w.y + w.h && thing.y + thing.h > w.y) {
        if (dy > 0) { thing.y = w.y - thing.h; thing.onGround = true; } else thing.y = w.y + w.h;
        thing.vy = 0;
        hit.y = true;
      }
    }
  }
  return hit;
}

/**
 * How far the mouse has moved since the last time you asked. The first time a game asks for it the page learns that this game wants the mouse: a click on the
 * game then takes hold of it (the pointer disappears; Esc lets go) and moving it is reported here. The movement is one more held key, so the Time Machine
 * records it and a replay moves the same way. Without a mouse, or while the mouse is not held, it is `{dx: 0, dy: 0}`.
 * @param {Set<string>} keys the keys held down
 * @param {{mx?: number, my?: number}} memory an object kept in your game's state: it remembers where the mouse was (`game.mouse = {}` will do)
 * @returns {{dx: number, dy: number, locked: boolean}} the movement in pixels (right and down are positive); `locked` is true while the mouse is held
 */
export function mouseDelta(keys, memory) {
  globalThis.__engineInput?.wantMouse?.();
  let code = null;
  for (const k of keys) if (k.startsWith('Mouse:')) { code = k; break; }
  if (!code) return { dx: 0, dy: 0, locked: false };
  const [, x, y] = code.split(':');
  const tx = Number(x);
  const ty = Number(y);
  const first = memory.mx === undefined;
  const dx = first ? 0 : tx - memory.mx;
  const dy = first ? 0 : ty - memory.my;
  memory.mx = tx;
  memory.my = ty;
  return { dx, dy, locked: true };
}
