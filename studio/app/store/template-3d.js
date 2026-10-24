// The "Gem hall" template: a first-person 3D game made with the arcade kit's view3d pieces (blocks, gems, a camera, walking that stops at walls). It is plain
// text with no backticks or dollar signs in it, so it sits in a string. The pathway "Make a 3D game" (learn/stage9.js) changes this file step by step.

export const GEM_HALL_MAIN = String.raw`// Gem hall: walk around a 3D room and pick up every gem, and keep away from the guardian.
// Arrow keys turn and walk, A and D sidestep. Click the game to look around with the mouse (Esc lets go).
import { newGame, camera3d, move3d, mouseLook3d, chase3d, drawWorld3d, block, gem, label, screen } from '@engine/arcade';

const SPEED = 4;      // how fast you walk, in metres a second
const TURN = 2;       // how fast you turn
const FOV = 70;       // how wide you see, in degrees
const EYE = 1.6;      // how tall you are, in metres
const GUARDIAN = 2.2; // how fast the guardian walks (you walk at SPEED, so you can outrun it)
const LIVES = 3;      // how many times it can catch you

const WALL = '#5b6b8c';
const STONE = '#8a93a6';
const WOOD = '#b0794a';

// block(x, z, width, depth, height, colour): x goes right, z comes towards you, the middle of the block is at x and z
const BLOCKS = [
  block(-5, -12, 10, 1, 3, WALL), block(5, -12, 10, 1, 3, WALL),     // the far wall, in two pieces
  block(-5, 12, 10, 1, 3, WALL), block(5, 12, 10, 1, 3, WALL),       // the wall behind where you start
  block(-10, -6, 1, 12, 3, WALL), block(-10, 6, 1, 12, 3, WALL),     // the left wall
  block(10, -6, 1, 12, 3, WALL), block(10, 6, 1, 12, 3, WALL),       // the right wall
  block(-5, -4, 1, 1, 3, STONE), block(5, -4, 1, 1, 3, STONE),       // four pillars
  block(-5, 4, 1, 1, 3, STONE), block(5, 4, 1, 1, 3, STONE),
  block(0, -8, 4, 1, 3, WALL),                                       // a wall to walk round
  block(7, -8, 1.5, 1.5, 1, WOOD), block(-7, 8, 1.5, 1.5, 1, WOOD),   // crates (you can hop onto them)
];

// gem(x, z, height, colour): things to collect
const GEMS = [
  gem(-8, -10, 1, '#4cf0c4'), gem(8, -10, 1, '#ff6bd6'), gem(0, 0, 1, '#ffd23c'),
  gem(-8, 10, 1, '#6bb6ff'), gem(8, 9, 1, '#ff8a5b'),
];

/** A new game: you stand near the back wall, looking into the room. */
export function create() {
  const game = newGame({ time: 0, walked: 0, lives: LIVES, hurt: 0, over: false });
  game.cam = camera3d({ x: 0, z: 9, eye: EYE, fov: FOV });
  game.guardian = { x: 0, z: -10 };
  game.gems = GEMS.map((g) => ({ ...g }));
  game.total = GEMS.length;
  return game;
}

/** One tick (1/60 s). keys is the set of keys held down. */
export function update(game, keys, dt) {
  if (game.over) {
    if (keys.has('Enter')) Object.assign(game, create());       // Enter starts again
    return;
  }
  game.cam.fov = FOV;
  mouseLook3d(game.cam, keys);                                    // the mouse turns you once you have clicked the game
  game.walked += move3d(game.cam, keys, dt, { speed: SPEED, turn: TURN, blocks: BLOCKS });
  if (game.gems.length) game.time += dt;
  game.hurt = Math.max(0, game.hurt - dt);
  if (game.time > 3 && game.gems.length) chase3d(game.guardian, game.cam, GUARDIAN, dt, BLOCKS);
  if (game.hurt === 0 && Math.hypot(game.guardian.x - game.cam.x, game.guardian.z - game.cam.z) < 1) {
    game.lives--;                                                 // caught: back to the start, and safe for two seconds
    game.hurt = 2;
    game.cam.x = 0;
    game.cam.z = 9;
    game.guardian = { x: 0, z: -10 };
    if (game.lives <= 0) game.over = true;
  }
  const near = (g) => Math.hypot(g.x - game.cam.x, g.z - game.cam.z) < 0.8;
  const got = game.gems.filter(near).length;
  game.gems = game.gems.filter((g) => !near(g));
  game.score += got;
}

/** Draw the game: the world first, then words on top. */
export function render(game, g) {
  const { width, height } = screen();
  const guardian = block(game.guardian.x, game.guardian.z, 0.9, 0.9, 2, '#d94a4a');
  drawWorld3d(g, game.cam, { blocks: [...BLOCKS, guardian], gems: game.gems }, { time: game.time });
  if (game.hurt > 0) { g.fillStyle = 'rgba(255, 40, 40, ' + Math.min(0.5, game.hurt * 0.3) + ')'; g.fillRect(0, 0, width, height); }
  label(g, 'Gems ' + game.score + ' of ' + game.total, 12, 24);
  label(g, 'Lives ' + game.lives, 12, 46);
  label(g, 'Time ' + game.time.toFixed(1), width - 12, 24, { align: 'right' });
  if (game.gems.length === 0) label(g, 'You found them all!', width / 2, height / 2, { size: 28, align: 'center' });
  if (game.over) label(g, 'Caught! Press Enter to try again', width / 2, height / 2, { size: 24, align: 'center' });
}

/** What the studio shows in its status bar. */
export function summary(game) {
  const cam = game.cam;
  return {
    gems: game.score, gemsLeft: game.gems.length, lives: game.lives, walked: Math.round(game.walked * 10) / 10,
    x: Math.round(cam.x * 10) / 10, z: Math.round(cam.z * 10) / 10, yaw: Math.round(cam.yaw * 100) / 100,
    height: Math.round((cam.y - cam.eye) * 100) / 100,
  };
}
`;

// ---- the same hall, but built in the 3D panel: the game reads scenes/hall.json (the template "Gem hall from a scene") ----

const SIZE = (hx, hy, hz) => ({ halfWidth: hx, halfHeight: hy, halfDepth: hz });
const gemAt = (id, x, z, [r, g, b], y = 1) => ({
  id, prefab: 'marker', name: id, at: { x, y, z }, overrides: { components: { colour: { r, g, b } } },
});

/** The scene file of the hall: floor, walls, pillars, crates, a start marker and five gem markers. */
export const HALL_SCENE = {
  format: 'engine-scene', version: 1, name: 'Hall', settings: {}, assets: [], prefabs: [],
  entities: [
    { id: 'floor', prefab: 'floor', at: { y: -0.1 }, params: SIZE(10, 0.1, 12) },
    { id: 'wall-far-left', prefab: 'wall', at: { x: -5, y: 1.5, z: -12 }, params: SIZE(5, 1.5, 0.5) },
    { id: 'wall-far-right', prefab: 'wall', at: { x: 5, y: 1.5, z: -12 }, params: SIZE(5, 1.5, 0.5) },
    { id: 'wall-near-left', prefab: 'wall', at: { x: -5, y: 1.5, z: 12 }, params: SIZE(5, 1.5, 0.5) },
    { id: 'wall-near-right', prefab: 'wall', at: { x: 5, y: 1.5, z: 12 }, params: SIZE(5, 1.5, 0.5) },
    { id: 'wall-left-back', prefab: 'wall', at: { x: -10, y: 1.5, z: -6 }, params: SIZE(0.5, 1.5, 6) },
    { id: 'wall-left-front', prefab: 'wall', at: { x: -10, y: 1.5, z: 6 }, params: SIZE(0.5, 1.5, 6) },
    { id: 'wall-right-back', prefab: 'wall', at: { x: 10, y: 1.5, z: -6 }, params: SIZE(0.5, 1.5, 6) },
    { id: 'wall-right-front', prefab: 'wall', at: { x: 10, y: 1.5, z: 6 }, params: SIZE(0.5, 1.5, 6) },
    { id: 'wall-turned', prefab: 'wall', at: { x: 5, y: 1.5, z: 0, yaw: 0.8 }, params: SIZE(1.5, 1.5, 0.3) },
    { id: 'wall-middle', prefab: 'wall', at: { x: 0, y: 1.5, z: -8 }, params: SIZE(2, 1.5, 0.5) },
    { id: 'pillar-1', prefab: 'pillar', at: { x: -5, y: 1.5, z: -4 } },
    { id: 'pillar-2', prefab: 'pillar', at: { x: 5, y: 1.5, z: -4 } },
    { id: 'pillar-3', prefab: 'pillar', at: { x: -5, y: 1.5, z: 4 } },
    { id: 'pillar-4', prefab: 'pillar', at: { x: 5, y: 1.5, z: 4 } },
    { id: 'crate-1', prefab: 'cube', at: { x: 7, y: 0.5, z: -8 }, params: SIZE(0.75, 0.5, 0.75) },
    { id: 'crate-2', prefab: 'cube', at: { x: -7, y: 0.5, z: 8 }, params: SIZE(0.75, 0.5, 0.75) },
    { id: 'platform', prefab: 'cube', at: { x: 8, y: 0.5, z: -2 }, params: SIZE(1.5, 0.5, 1.5) },
    { id: 'ramp', prefab: 'ramp', at: { x: 8, y: 0.5, z: 1 } },
    { id: 'start', prefab: 'marker', name: 'start', at: { x: 0, y: 0.3, z: 9 } },
    gemAt('gem-1', -8, -10, [0.3, 0.94, 0.77]), gemAt('gem-2', 8, -10, [1, 0.42, 0.84]), gemAt('gem-3', 8, -2, [1, 0.82, 0.24], 1.6),
    gemAt('gem-4', -8, 10, [0.42, 0.71, 1]), gemAt('gem-5', 8, 9, [1, 0.54, 0.36]),
  ],
};

export const HALL_SCENE_JSON = `${JSON.stringify(HALL_SCENE, null, 2)}\n`;

export const SCENE_HALL_MAIN = String.raw`// Gem hall, built in the 3D panel: the hall is the scene scenes/hall.json.
// Open the 3D workspace, move a wall or add a pillar, press Save, and run the game again.
// Arrow keys turn and walk, A and D sidestep, Space jumps. Click the game to look around with the mouse (Esc lets go).
// A marker called start is where you begin; every other marker is a gem. Keep away from the guardian.
import { newGame, camera3d, move3d, mouseLook3d, chase3d, jump3d, drawWorld3d, loadWorld3d, block, label, screen } from '@engine/arcade';
import hall from '../scenes/hall.json.js';

const SPEED = 4;      // how fast you walk, in metres a second
const TURN = 2;       // how fast you turn
const FOV = 70;       // how wide you see, in degrees
const EYE = 1.6;      // how tall you are, in metres
const GUARDIAN = 2.2; // how fast the guardian walks (you walk at SPEED, so you can outrun it)
const LIVES = 3;      // how many times it can catch you

const WORLD = loadWorld3d(hall);        // { blocks, gems, start }: the shapes you placed, the markers, and where you begin

/** A new game: you stand on the start marker, facing the way it faces. */
export function create() {
  const game = newGame({ time: 0, walked: 0, lives: LIVES, hurt: 0, over: false });
  const start = WORLD.start ?? { x: 0, z: 0, yaw: 0 };
  game.start = start;
  game.cam = camera3d({ x: start.x, z: start.z, yaw: start.yaw, eye: EYE, fov: FOV });
  game.guardian = { x: start.x, z: start.z - 19 };
  game.gems = WORLD.gems.map((g) => ({ ...g }));
  game.total = game.gems.length;
  return game;
}

/** One tick (1/60 s). keys is the set of keys held down. */
export function update(game, keys, dt) {
  if (game.over) {
    if (keys.has('Enter')) Object.assign(game, create());       // Enter starts again
    return;
  }
  game.cam.fov = FOV;
  mouseLook3d(game.cam, keys);                                    // the mouse turns you once you have clicked the game
  game.walked += move3d(game.cam, keys, dt, { speed: SPEED, turn: TURN, blocks: WORLD.blocks });
  jump3d(game.cam, keys, dt);
  if (game.gems.length) game.time += dt;
  game.hurt = Math.max(0, game.hurt - dt);
  if (game.time > 3 && game.gems.length) chase3d(game.guardian, game.cam, GUARDIAN, dt, WORLD.blocks);
  if (game.hurt === 0 && Math.hypot(game.guardian.x - game.cam.x, game.guardian.z - game.cam.z) < 1) {
    game.lives--;                                                 // caught: back to the start, and safe for two seconds
    game.hurt = 2;
    game.cam.x = game.start.x;
    game.cam.z = game.start.z;
    game.guardian = { x: game.start.x, z: game.start.z - 19 };
    if (game.lives <= 0) game.over = true;
  }
  const near = (g) => Math.hypot(g.x - game.cam.x, g.z - game.cam.z) < 0.8;
  const got = game.gems.filter(near).length;
  game.gems = game.gems.filter((g) => !near(g));
  game.score += got;
}

/** Draw the game: the world first, then words on top. */
export function render(game, g) {
  const { width, height } = screen();
  const guardian = block(game.guardian.x, game.guardian.z, 0.9, 0.9, 2, '#d94a4a');
  drawWorld3d(g, game.cam, { blocks: [...WORLD.blocks, guardian], gems: game.gems }, { time: game.time });
  if (game.hurt > 0) { g.fillStyle = 'rgba(255, 40, 40, ' + Math.min(0.5, game.hurt * 0.3) + ')'; g.fillRect(0, 0, width, height); }
  label(g, 'Gems ' + game.score + ' of ' + game.total, 12, 24);
  label(g, 'Lives ' + game.lives, 12, 46);
  label(g, 'Time ' + game.time.toFixed(1), width - 12, 24, { align: 'right' });
  if (game.total > 0 && game.gems.length === 0) label(g, 'You found them all!', width / 2, height / 2, { size: 28, align: 'center' });
  if (game.over) label(g, 'Caught! Press Enter to try again', width / 2, height / 2, { size: 24, align: 'center' });
}

/** What the studio shows in its status bar. */
export function summary(game) {
  const cam = game.cam;
  return {
    gems: game.score, gemsLeft: game.gems.length, lives: game.lives, walked: Math.round(game.walked * 10) / 10,
    x: Math.round(cam.x * 10) / 10, z: Math.round(cam.z * 10) / 10, yaw: Math.round(cam.yaw * 100) / 100,
    height: Math.round((cam.y - cam.eye) * 100) / 100,
  };
}
`;
