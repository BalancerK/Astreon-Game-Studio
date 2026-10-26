// The rules of the platformer. No screen, no keyboard, no clock: `step(game, inputBits)` moves the game on by one sixtieth of a second, so the
// same inputs always give the same game (a replay is just the list of inputs), and it is tested by calling it.
import { SpatialHash, moveAndSlide, createMoveResult } from '../../../packages/physics/src/index.js';
import { TILE, solidAt } from './level.js';

export const DT = 1 / 60;

/** How the player moves: pixels and seconds. Change a number and feel the difference. */
export const MOVE = {
  hw: 5, hh: 7,                // the player's box is 10 x 14 pixels
  run: 100, accel: 800, airAccel: 520, friction: 900,
  gravity: 900, maxFall: 380,
  jump: 330,                   // upward speed of a jump: it rises about 60 pixels (v² / 2g), nearly four tiles
  cut: 0.45,                   // let go of jump early and the rise is cut short: a short hop, a full jump
  coyote: 0.1,                 // you can still jump this long after walking off an edge
  buffer: 0.12,                // and a jump pressed this long before landing still counts
  spring: 470, stomp: 230,
  walker: 32,
  deathPause: 0.9,
};

// ---- inputs: three bits per tick, so a whole run is a short list of small numbers ----
export const LEFT = 1;
export const RIGHT = 2;
export const JUMP = 4;
export const packInput = ({ left = false, right = false, jump = false } = {}) => (left ? LEFT : 0) | (right ? RIGHT : 0) | (jump ? JUMP : 0);

const overlaps = (a, b) => Math.abs(a.x - b.x) < a.hw + b.hw && Math.abs(a.y - b.y) < a.hh + b.hh;

/** @param {ReturnType<import('./level.js').loadLevel>} level */
export function createGame(level) {
  const hash = new SpatialHash({
    width: level.w * TILE + 64, height: level.h * TILE + 64, originX: -32, originY: -32,
    cellSize: 32, capacity: level.rects.length + 2,
  });
  level.rects.forEach((r, i) => hash.insert(i, r.x, r.y, r.hw, r.hh));
  hash.insert(level.rects.length, -8, (level.h * TILE) / 2, 8, level.h * TILE * 2);               // the edges of the level are walls
  hash.insert(level.rects.length + 1, level.w * TILE + 8, (level.h * TILE) / 2, 8, level.h * TILE * 2);
  hash.build();
  const game = { level, hash, out: createMoveResult(), tick: 0, time: 0, deaths: 0, status: 'playing', events: [], finalTime: null, deadFor: 0 };
  respawn(game);
  return game;
}

/** Put the player back at the start and the level as it was (the clock and the death count carry on). */
function respawn(game) {
  const L = game.level;
  game.player = {
    x: L.start.x, y: L.start.y + 1, vx: 0, vy: 0, hw: MOVE.hw, hh: MOVE.hh,
    grounded: false, coyote: 0, buffer: 0, held: false, jumping: false, facing: 1,
  };
  game.coins = L.coins.map(() => true); game.collected = 0;
  game.enemies = L.enemies.map((e) => ({ ...e, vx: -MOVE.walker, alive: true }));
  game.status = 'playing'; game.deadFor = 0;
}

const die = (game, why) => { game.status = 'dead'; game.deadFor = MOVE.deathPause; game.deaths++; game.events.push({ e: 'die', why }); };

const approach = (v, target, by) => (v < target ? Math.min(target, v + by) : Math.max(target, v - by));

/**
 * One tick. `input` is the packed bits (LEFT, RIGHT, JUMP held).
 * Returns the events of this tick: `jump`, `land`, `coin`, `stomp`, `spring`, `die`, `win`.
 * @param {ReturnType<typeof createGame>} game @param {number} input
 */
export function step(game, input) {
  game.events = [];
  if (game.status === 'won') return game.events;
  game.tick++;
  if (game.status === 'dead') { game.deadFor -= DT; if (game.deadFor <= 0) respawn(game); return game.events; }
  game.time += DT;
  const L = game.level, p = game.player, out = game.out;
  const dir = ((input & RIGHT) ? 1 : 0) - ((input & LEFT) ? 1 : 0), held = (input & JUMP) !== 0, pressed = held && !p.held;
  p.held = held;
  if (dir !== 0) p.facing = dir;

  // running: speed up towards the wanted speed, slow down when you let go
  const target = dir * MOVE.run;
  if (dir !== 0) {
    p.vx = approach(p.vx, target, (p.grounded ? MOVE.accel : MOVE.airAccel) * DT);
  } else {
    p.vx = approach(p.vx, 0, (p.grounded ? MOVE.friction : MOVE.friction * 0.35) * DT);
  }

  // jumping: a press shortly before landing, or shortly after leaving the ground, counts
  p.coyote = p.grounded ? MOVE.coyote : Math.max(0, p.coyote - DT);
  p.buffer = pressed ? MOVE.buffer : Math.max(0, p.buffer - DT);
  if (p.buffer > 0 && p.coyote > 0) {
    p.vy = -MOVE.jump;
    p.buffer = 0;
    p.coyote = 0;
    p.grounded = false;
    p.jumping = true;
    game.events.push({ e: 'jump' });
  }
  if (p.jumping && !held && p.vy < 0) { p.vy *= MOVE.cut; p.jumping = false; }   // let go early: a shorter jump
  if (p.vy >= 0) p.jumping = false;
  p.vy = Math.min(MOVE.maxFall, p.vy + MOVE.gravity * DT);

  // moving: sideways first, then up or down, so we know exactly what we landed on
  moveAndSlide(game.hash, p.x, p.y, p.hw, p.hh, p.vx * DT, 0, 1, -1, out);
  p.x = out.x; if (out.hit) p.vx = 0;
  const wasGrounded = p.grounded, fell = p.vy;
  moveAndSlide(game.hash, p.x, p.y, p.hw, p.hh, 0, p.vy * DT, 1, -1, out);
  p.y = out.y;
  p.grounded = out.hit && out.ny < -0.5;
  if (out.hit) p.vy = 0;
  if (p.grounded && !wasGrounded && fell > 120) game.events.push({ e: 'land', speed: fell });

  const box = { x: p.x, y: p.y, hw: p.hw - 1, hh: p.hh - 1 };
  // things that hurt, help or can be picked up
  if (p.y - p.hh > L.h * TILE + 24) return (die(game, 'fell'), game.events);
  for (const s of L.spikes) if (overlaps(box, s)) return (die(game, 'spikes'), game.events);
  for (const s of L.springs) {
    if (p.vy >= 0 && overlaps(box, { ...s, hh: s.hh + 2 })) {
      p.vy = -MOVE.spring;
      p.grounded = false;
      p.jumping = false;
      p.coyote = 0;                       // a leftover edge-jump must not overwrite the bounce
      game.events.push({ e: 'spring' });
    }
  }
  L.coins.forEach((c, i) => {
    if (game.coins[i] && overlaps(box, { x: c.x, y: c.y, hw: 5, hh: 5 })) {
      game.coins[i] = false;
      game.collected++;
      game.events.push({ e: 'coin', at: c });
    }
  });

  // enemies walk back and forth, turning at walls and edges
  for (const en of game.enemies) {
    if (!en.alive) continue;
    const ahead = en.x + Math.sign(en.vx) * (en.hw + 1);
    if (solidAt(L, ahead, en.y) || !solidAt(L, ahead, en.y + en.hh + 3)) en.vx = -en.vx;
    en.x += en.vx * DT;
    if (overlaps(box, en)) {
      if (p.vy > 20 && p.y + p.hh < en.y + 3) {                           // landed on top of it
        en.alive = false;
        p.vy = -MOVE.stomp;
        p.grounded = false;
        p.coyote = 0;
        game.events.push({ e: 'stomp', at: { x: en.x, y: en.y } });
      }
      else return (die(game, 'enemy'), game.events);
    }
  }
  if (overlaps(box, L.goal)) {
    game.status = 'won';
    game.finalTime = game.time;
    game.events.push({ e: 'win', time: game.time, coins: game.collected, of: L.coins.length });
  }
  return game.events;
}

/** A number that stands for the whole state of a game (for tests and for checking a replay): equal games have equal hashes. */
export function stateHash(game) {
  let h = 0x811c9dc5;
  const mix = (v) => { h = Math.imul(h ^ (Math.round(v * 256) | 0), 0x01000193) >>> 0; };
  const p = game.player;
  [p.x, p.y, p.vx, p.vy, game.tick, game.collected, game.deaths, game.status === 'won' ? 1 : game.status === 'dead' ? 2 : 0].forEach(mix);
  game.enemies.forEach((e) => { mix(e.x); mix(e.alive ? 1 : 0); });
  return h;
}

/** Play a list of inputs from the start; the finished game. */
export function replay(level, inputs) {
  const g = createGame(level);
  for (const i of inputs) { step(g, i); if (g.status === 'won') break; }
  return g;
}

/**
 * A simple computer player: runs right and jumps over what is in the way (a wall, a gap, spikes, an enemy). It is how the tests know every
 * level can be finished, and a ghost to race against.
 */
export function botInput(game) {
  const L = game.level, p = game.player;
  if (game.status !== 'playing') return 0;
  const ahead = (dx, dy) => solidAt(L, p.x + dx, p.y + dy);
  const footY = p.y + p.hh + 3;
  let jump = false;
  const wall = ahead(p.hw + 5, 0) || ahead(p.hw + 5, p.hh - 2);
  const nearWall = ahead(p.hw + 14, 0) && p.grounded;
  const gap = p.grounded && !ahead(p.hw + 6, footY - p.y + 2) && !ahead(p.hw + 12, footY - p.y + 2);
  const spike = L.spikes.some((s) => s.x > p.x && s.x - p.x < 26 && Math.abs(s.y - p.y) < 14);
  const enemy = game.enemies.some((e) => e.alive && e.x > p.x - 4 && e.x - p.x < 38 && Math.abs(e.y - p.y) < 10);
  const spring = L.springs.some((s) => s.x > p.x && s.x - p.x < 40 && Math.abs(s.y - p.y) < 14);   // walk onto springs: they do the jumping
  if (p.grounded && !spring && (wall || nearWall || gap || spike || enemy)) jump = true;
  if (!p.grounded && p.vy < 0) jump = true;                               // hold the jump while rising for the full height
  return RIGHT | (jump ? JUMP : 0);
}
