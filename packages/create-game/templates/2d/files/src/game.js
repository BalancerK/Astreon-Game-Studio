// The rules of the game. No page, no renderer, no timers: just state and a `step` function, so they can be tested (see test/game.test.js)
// and, if you make the game multiplayer later, run on a server unchanged.

export const WORLD = { width: 800, height: 450 };
const PLAYER_SPEED = 260;   // pixels per second
const PLAYER_RADIUS = 14, COIN_RADIUS = 9, HAZARD_RADIUS = 16;

/** A small seeded random number generator (the same seed always gives the same game). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function place(game, radius) {
  // somewhere that is not on top of the player
  for (let i = 0; i < 30; i++) {
    const x = radius + game.rng() * (WORLD.width - 2 * radius), y = radius + game.rng() * (WORLD.height - 2 * radius);
    if (Math.hypot(x - game.player.x, y - game.player.y) > 120) return { x, y };
  }
  return { x: radius, y: radius };
}

function addHazard(game) {
  const p = place(game, HAZARD_RADIUS), angle = game.rng() * Math.PI * 2, speed = 70 + game.rng() * 60;
  game.hazards.push({ x: p.x, y: p.y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, r: HAZARD_RADIUS });
}

/** A new game. `best` carries the best score over from earlier games. */
export function createGame(seed = 1, best = 0) {
  const game = {
    rng: mulberry32(seed), time: 0, score: 0, best, over: false,
    player: { x: WORLD.width / 2, y: WORLD.height / 2, r: PLAYER_RADIUS },
    coins: [], hazards: [],
  };
  for (let i = 0; i < 5; i++) game.coins.push({ ...place(game, COIN_RADIUS), r: COIN_RADIUS });
  for (let i = 0; i < 3; i++) addHazard(game);
  return game;
}

/**
 * Advance the game by `dt` seconds. `move` is the direction the player is pushing, each of x and y from -1 to 1.
 * @returns {{coin: boolean, hit: boolean}} what happened this step (for sounds and effects)
 */
export function step(game, move, dt) {
  const events = { coin: false, hit: false };
  if (game.over) return events;
  game.time += dt;
  const p = game.player, len = Math.hypot(move.x, move.y) || 1, k = Math.min(1, len) / len;
  p.x = Math.max(p.r, Math.min(WORLD.width - p.r, p.x + move.x * k * PLAYER_SPEED * dt));
  p.y = Math.max(p.r, Math.min(WORLD.height - p.r, p.y + move.y * k * PLAYER_SPEED * dt));

  for (const h of game.hazards) {
    h.x += h.vx * dt; h.y += h.vy * dt;
    if (h.x < h.r || h.x > WORLD.width - h.r) { h.vx = -h.vx; h.x = Math.max(h.r, Math.min(WORLD.width - h.r, h.x)); }
    if (h.y < h.r || h.y > WORLD.height - h.r) { h.vy = -h.vy; h.y = Math.max(h.r, Math.min(WORLD.height - h.r, h.y)); }
    if (Math.hypot(h.x - p.x, h.y - p.y) < h.r + p.r - 2) { game.over = true; events.hit = true; }
  }
  for (const c of game.coins) {
    if (Math.hypot(c.x - p.x, c.y - p.y) < c.r + p.r) {
      game.score++; events.coin = true;
      Object.assign(c, place(game, c.r));
      if (game.score % 5 === 0) addHazard(game); // it gets harder
    }
  }
  if (game.over) game.best = Math.max(game.best, game.score);
  return events;
}
