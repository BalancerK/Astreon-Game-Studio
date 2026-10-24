import { GEM_HALL_MAIN, SCENE_HALL_MAIN, HALL_SCENE_JSON } from './template-3d.js';
import { generateModule } from '../rules/rules-model.js';

// The projects a person can start from. Each is a few small files that work the moment they are opened. A game is a module `src/main.js` that exports
// `create()` (a new game state, plain data), `update(game, keys, dt)` (one tick, 1/60 s) and `render(game, g)` (draw it on a 2D canvas context), and
// optionally `summary(game)` (what the status bar shows).

const BLANK_MAIN = `// Your game. Edit anything and the game on the right changes as you type.

/** A new game: whatever the game needs to remember. Keep it plain data (numbers, text, lists, objects). */
export function create() {
  return { t: 0 };
}

/** One tick of the game: 60 of these run every second. \`keys\` is the set of keys held down, for example keys.has('ArrowLeft'). */
export function update(game, keys, dt) {
  game.t += dt;
}

/** Draw the game. \`g\` is a 2D canvas context; the screen is 480 by 320. */
export function render(game, g) {
  g.fillStyle = '#12161f';
  g.fillRect(0, 0, 480, 320);
  g.fillStyle = '#fff';
  g.font = '20px system-ui';
  g.fillText('Hello! Time: ' + game.t.toFixed(1), 20, 40);
}
`;

const BOUNCE_MAIN = `import { sin } from '@engine/math';
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

/** Draw the game. */
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
`;

const UTIL = `/** Keep a number between a lowest and a highest value. */
export function clamp(value, low, high) {
  return Math.max(low, Math.min(high, value));
}
`;

const HERO_MAIN = `import {
  newGame, loadMap, first, all, touches, despawn,
  walk, jump, gravity, moveAndCollide, clear, drawThings, label,
} from '@engine/arcade';

const SPEED = 160;            // how fast the hero runs: change me while the game runs
const JUMP = 620;             // how high the hero jumps

// The level is a picture made of letters: # ground, o coin, @ where the hero starts
const LEVEL = [
  '###############',
  '#.............#',
  '#.............#',
  '#.............#',
  '#.............#',
  '#...o.....o...#',
  '#..###...###..#',
  '#.............#',
  '#@.....o.....o#',
  '###############',
];

/** A new game: the level, with the hero and the coins in it. */
export function create() {
  const game = newGame();
  loadMap(game, LEVEL, {
    '#': { kind: 'wall', color: '#3b4a6b' },
    o: { kind: 'coin', emoji: '\\u{1FA99}' },
    '@': { kind: 'hero', w: 24, h: 30 },
  });
  return game;
}

/** One tick (1/60 s). \`keys\` is the set of keys held down. */
export function update(game, keys, dt) {
  const hero = first(game, 'hero');
  walk(hero, keys, SPEED);              // arrow keys or A and D
  jump(hero, keys, JUMP);               // space, up arrow or W
  gravity(hero, dt);
  moveAndCollide(game, hero, dt);       // the hero cannot walk through the ground
  const coin = touches(game, hero, 'coin');
  if (coin) {
    despawn(game, coin);
    game.score++;
  }
}

/** Draw the game. */
export function render(game, g) {
  clear(g, '#12161f');
  drawThings(g, game);
  label(g, 'Coins ' + game.score, 12, 24);
}

/** What the studio shows in its status bar. */
export function summary(game) {
  const hero = first(game, 'hero');
  const coinsLeft = all(game, 'coin').length;
  return { coins: game.score, coinsLeft, x: Math.round(hero.x), onGround: !!hero.onGround };
}
`;

const SHOOTER_MAIN = `import {
  newGame, spawn, all, first, despawn, touching, move, every, randomBetween, held, burst, shake, effects, clear, drawThings, label,
} from '@engine/arcade';

const SPEED = 220;            // how fast your ship moves: change me while the game runs
const FIRE_DELAY = 0.25;      // seconds between shots
const ENEMY_SPEED = 70;       // how fast the enemies fall
const SPAWN_EVERY = 0.9;      // seconds between new enemies
const LIVES = 3;

/** A new game: your ship at the bottom, nothing else yet. */
export function create() {
  const game = newGame();
  game.lives = LIVES;
  game.cool = 0;                                   // seconds until the ship may fire again
  spawn(game, 'ship', { x: 228, y: 280, w: 24, h: 24, color: '#5ac8ff' });
  return game;
}

/** One tick (1/60 s). \`keys\` is the set of keys held down. */
export function update(game, keys, dt) {
  effects(game, dt);
  if (game.lives <= 0) {
    if (held(keys, 'action')) Object.assign(game, create());     // Enter starts again
    return;
  }
  const ship = first(game, 'ship');
  ship.vx = ((held(keys, 'right') ? 1 : 0) - (held(keys, 'left') ? 1 : 0)) * SPEED;      // arrow keys or A and D
  ship.vy = ((held(keys, 'down') ? 1 : 0) - (held(keys, 'up') ? 1 : 0)) * SPEED;
  move(ship, dt);
  ship.x = Math.max(0, Math.min(456, ship.x));
  ship.y = Math.max(160, Math.min(296, ship.y));

  game.cool -= dt;
  if (held(keys, 'space') && game.cool <= 0) {                                              // space fires
    spawn(game, 'bullet', { x: ship.x + 10, y: ship.y - 8, w: 4, h: 12, vy: -420, color: '#ffd23c' });
    game.cool = FIRE_DELAY;
  }
  if (every(game, 'enemy', SPAWN_EVERY, dt)) {
    spawn(game, 'enemy', { x: randomBetween(game, 0, 448), y: -32, w: 32, h: 32, vy: ENEMY_SPEED + game.score * 2, color: '#e5484d' });
  }
  for (const thing of [...all(game, 'bullet'), ...all(game, 'enemy')]) move(thing, dt);

  for (const bullet of all(game, 'bullet')) {
    if (bullet.y < -20) { despawn(game, bullet); continue; }
    const enemy = all(game, 'enemy').find((e) => touching(bullet, e));
    if (!enemy) continue;
    burst(game, enemy.x + 16, enemy.y + 16, { color: '#ff9a3c' });
    despawn(game, bullet);
    despawn(game, enemy);
    game.score++;
  }
  for (const enemy of all(game, 'enemy')) {
    const crashed = touching(enemy, ship);
    if (!crashed && enemy.y < 320) continue;                                                // still falling
    despawn(game, enemy);
    game.lives--;
    shake(game, 8);
    if (crashed) burst(game, ship.x + 12, ship.y + 12, { color: '#5ac8ff', count: 20 });
  }
}

/** Draw the game. */
export function render(game, g) {
  clear(g, '#0d1220');
  drawThings(g, game);
  label(g, 'Score ' + game.score, 12, 24);
  label(g, 'Lives ' + Math.max(0, game.lives), 468, 24, { align: 'right' });
  if (game.lives <= 0) {
    label(g, 'Game over', 240, 150, { size: 32, align: 'center' });
    label(g, 'Press Enter to play again', 240, 184, { size: 16, align: 'center' });
  }
}

/** What the studio shows in its status bar. */
export function summary(game) {
  return { score: game.score, lives: game.lives, enemies: all(game, 'enemy').length };
}
`;

const PUZZLE_MAIN = `import {
  newGame, loadMap, spawn, all, first, held, clear, drawThings, label,
} from '@engine/arcade';

// Push every box onto a target. # wall, @ you, B box, x target. Arrow keys or WASD move you, R starts the level again.
const LEVELS = [
  [
    '########',
    '#......#',
    '#.@B..x#',
    '#......#',
    '########',
  ],
  [
    '#########',
    '#x......#',
    '#.B..B..#',
    '#.@.....#',
    '#......x#',
    '#########',
  ],
];

const TILE = 32;
const REPEAT = 0.14;          // seconds before a held key moves you again: make it smaller for faster walking

/** Start level number \`n\`. */
function load(game, n) {
  game.things = [];
  loadMap(game, LEVELS[n], {
    '#': { kind: 'wall', color: '#3b4a6b' },
    x: { kind: 'target', color: '#3c7a4b', w: 20, h: 20 },
    B: { kind: 'box', color: '#c98a3c' },
    '@': { kind: 'player', color: '#5ac8ff' },
  });
  const order = { target: 0, box: 1, player: 2 };           // targets are drawn first, so a box can sit on top of one
  game.things.sort((a, b) => (order[a.kind] ?? -1) - (order[b.kind] ?? -1));
  for (const t of all(game, 'target')) { t.x += 6; t.y += 6; }
  game.level = n;
  game.moves = 0;
  game.won = false;
  game.wait = 0;
}

export function create() {
  const game = newGame();
  game.camera = { x: -112, y: -80 };                         // puts the level in the middle of the screen
  load(game, 0);
  return game;
}

const here = (game, kind, col, row) => all(game, kind).find((t) => Math.round(t.x / TILE) === col && Math.round(t.y / TILE) === row);
const blocked = (game, col, row) => here(game, 'wall', col, row) || here(game, 'box', col, row);

/** Try to walk one square, pushing a box if there is room behind it. */
function step(game, dx, dy) {
  const me = first(game, 'player');
  const col = Math.round(me.x / TILE) + dx;
  const row = Math.round(me.y / TILE) + dy;
  if (here(game, 'wall', col, row)) return;
  const box = here(game, 'box', col, row);
  if (box) {
    if (blocked(game, col + dx, row + dy)) return;
    box.x += dx * TILE;
    box.y += dy * TILE;
  }
  me.x += dx * TILE;
  me.y += dy * TILE;
  game.moves++;
  game.won = all(game, 'box').every((b) => onTarget(game, b));
}

/** Is a box standing on a target? (A target is drawn a little smaller than a square, so compare squares.) */
function onTarget(game, box) {
  const col = Math.round(box.x / TILE);
  const row = Math.round(box.y / TILE);
  return all(game, 'target').some((t) => Math.round((t.x - 6) / TILE) === col && Math.round((t.y - 6) / TILE) === row);
}

export function update(game, keys, dt) {
  if (held(keys, 'KeyR')) { load(game, game.level); return; }
  if (game.won) {
    if (held(keys, 'action') || held(keys, 'space')) load(game, (game.level + 1) % LEVELS.length);     // Enter or space for the next level
    return;
  }
  const dx = (held(keys, 'right') ? 1 : 0) - (held(keys, 'left') ? 1 : 0);
  const dy = dx === 0 ? (held(keys, 'down') ? 1 : 0) - (held(keys, 'up') ? 1 : 0) : 0;
  game.wait = Math.max(0, game.wait - dt);
  if (!dx && !dy) { game.wait = 0; return; }                 // let go of the keys: the next press moves at once
  if (game.wait > 0) return;
  step(game, dx, dy);
  game.wait = REPEAT;
}

export function render(game, g) {
  clear(g, '#12161f');
  drawThings(g, game);
  label(g, 'Level ' + (game.level + 1) + '   Moves ' + game.moves, 12, 24);
  label(g, 'R: start again', 468, 24, { align: 'right', size: 13, color: '#8a93a8' });
  if (game.won) {
    label(g, 'Solved!', 240, 150, { size: 36, align: 'center', color: '#7bdc8a' });
    label(g, 'Press Enter for the next level', 240, 184, { size: 16, align: 'center' });
  }
}

export function summary(game) {
  return { level: game.level + 1, moves: game.moves, solved: game.won };
}
`;

const RULES_MAIN = `import {
  newGame, loadMap, first, walk, jump, gravity, moveAndCollide, effects, clear, drawThings, label,
} from '@engine/arcade';
import { applyRules, drawRules } from './rules.js';        // the rules you build in the Rules panel; open src/rules.js to read the code they make

const SPEED = 160;
const JUMP = 620;

// # ground, o coin, ^ spike, @ where the hero starts
const LEVEL = [
  '###############',
  '#.............#',
  '#.............#',
  '#.............#',
  '#.............#',
  '#...o.....o...#',
  '#..###...###..#',
  '#.............#',
  '#@..^..o..^..o#',
  '###############',
];

export function create() {
  const game = newGame();
  game.lives = 3;
  loadMap(game, LEVEL, {
    '#': { kind: 'wall', color: '#3b4a6b' },
    o: { kind: 'coin', color: '#ffd23c', shape: 'circle' },
    '^': { kind: 'spike', color: '#e5484d' },
    '@': { kind: 'hero', w: 24, h: 30 },
  });
  return game;
}

export function update(game, keys, dt) {
  const hero = first(game, 'hero');
  walk(hero, keys, SPEED);
  jump(hero, keys, JUMP);
  gravity(hero, dt);
  moveAndCollide(game, hero, dt);
  applyRules(game, keys, dt);          // coins, spikes and the message all come from the rules
  effects(game, dt);
}

export function render(game, g) {
  clear(g, '#12161f');
  drawThings(g, game);
  drawRules(game, g);
  label(g, 'Score ' + game.score, 12, 24);
  label(g, 'Lives ' + game.lives, 468, 24, { align: 'right' });
}

export function summary(game) {
  return { score: game.score, lives: game.lives };
}
`;

const RULES_STARTER = [
  {
    id: 1, once: false, when: { type: 'touch', a: 'hero', b: 'coin' },
    then: [{ type: 'score', add: 1 }, { type: 'remove', who: 'b' }, { type: 'burst', who: 'b' }],
  },
  {
    id: 2, once: false, when: { type: 'touch', a: 'hero', b: 'spike' },
    then: [{ type: 'shake', amount: 8 }, { type: 'add', field: 'lives', n: -1 }, { type: 'move', who: 'a', x: 32, y: 258 }],
  },
  { id: 3, once: true, when: { type: 'none', kind: 'coin' }, then: [{ type: 'say', text: 'You got every coin!', seconds: 3 }] },
];

/** @type {Record<string, {title: string, description: string, files: Record<string, string>}>} */
export const TEMPLATES = {
  blank: {
    title: 'Blank',
    description: 'An empty game with the three functions every game has. Start here if you know what you want to make.',
    files: { 'src/main.js': BLANK_MAIN },
  },
  bounce: {
    title: 'Bouncing block',
    description: 'A block that bounces between two walls and scores. Small enough to read in a minute, and full of numbers to change.',
    files: { 'src/main.js': BOUNCE_MAIN, 'src/util.js': UTIL },
  },
  hero: {
    title: 'Run and jump',
    description: 'A hero that runs, jumps and collects coins, made with the arcade kit. The best first game: change a number, see the hero change.',
    files: { 'src/main.js': HERO_MAIN },
  },
  shooter: {
    title: 'Space shooter',
    description: 'Fly a ship, fire at falling enemies and keep your lives. Seen from above: move in four directions, hold space to fire.',
    files: { 'src/main.js': SHOOTER_MAIN },
  },
  puzzle: {
    title: 'Push the boxes',
    description: 'A thinking game: push every box onto a target without getting stuck. Two levels to start; the levels are pictures made of letters.',
    files: { 'src/main.js': PUZZLE_MAIN },
  },
  world3d: {
    title: 'Gem hall (3D)',
    description: 'A first-person 3D game: walk around a hall, step round walls and pillars, and pick up every gem. '
      + 'Drawn with the arcade kit, so everything in the studio works with it.',
    files: { 'src/main.js': GEM_HALL_MAIN },
  },
  hall3d: {
    title: 'Gem hall from a scene (3D)',
    description: 'The same hall, but built by dragging blocks in the 3D panel: the game reads the scene file, so change the level without code.',
    files: { 'src/main.js': SCENE_HALL_MAIN, 'scenes/hall.json': HALL_SCENE_JSON },
  },
  rules: {
    title: 'Made with rules',
    description: 'A platformer whose coins, spikes and message are rules, not code. Open the Rules panel to change them and read the code they make.',
    files: { 'src/main.js': RULES_MAIN, 'src/rules.js': generateModule(RULES_STARTER) },
  },
};

export const DEFAULT_TEMPLATE = 'bounce';
