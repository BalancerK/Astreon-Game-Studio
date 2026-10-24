import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newGame, spawn, first } from '../src/things.js';
import { loadMap } from '../src/map.js';
import { behaviors, behave } from '../src/behaviors.js';
import { navGrid, route } from '../src/paths.js';

const DT = 1 / 60;
const run = (game, seconds) => { for (let i = 0; i < Math.round(seconds / DT); i++) behave(game, DT, new Set()); };
const LEGEND = { '#': { kind: 'wall' } };
// the hero is on the right of a wall that has one gap, at the bottom
const LEVEL = [
  '##########',
  '#....#...#',
  '#....#...#',
  '#....#...#',
  '#........#',
  '##########',
];
const make = () => {
  const game = newGame();
  loadMap(game, LEVEL, LEGEND, 32);
  return game;
};
const centre = (t) => ({ x: t.x + t.w / 2, y: t.y + t.h / 2 });

test('the grid blocks the squares the walls cover, and follows the level', () => {
  const grid = navGrid(make());
  assert.equal(grid.columns, 10);
  assert.equal(grid.rows, 6);
  assert.equal(grid.blocked[0], 1);
  assert.equal(grid.blocked[1 * 10 + 1], 0);
  assert.equal(grid.blocked[1 * 10 + 5], 1);
  assert.equal(grid.blocked[4 * 10 + 5], 0, 'the gap is open');
  const bare = navGrid({ things: [{ kind: 'wall', x: 64, y: 0, w: 32, h: 64 }] }, 'wall', 32);
  assert.equal(bare.columns, 15, 'without a level it covers the screen');
  assert.equal(bare.blocked[0 * 15 + 2], 1);
  assert.equal(bare.blocked[1 * 15 + 2], 1);
  assert.equal(bare.blocked[2 * 15 + 2], 0);
});

test('a route goes round the wall through the gap, and never through a wall', () => {
  const game = make();
  const grid = navGrid(game);
  const way = route(grid, { x: 48, y: 48 }, { x: 240, y: 48 });
  assert.ok(way.length > 6, 'it is a long way round');
  assert.deepEqual(way.at(-1), { x: 7 * 32 + 16, y: 1 * 32 + 16 }, 'it ends in the square the hero is in');
  for (const p of way) assert.equal(grid.blocked[Math.floor(p.y / 32) * 10 + Math.floor(p.x / 32)], 0);
  assert.ok(way.some((p) => p.x === 5 * 32 + 16 && p.y === 4 * 32 + 16), 'it uses the gap');
  for (let i = 1; i < way.length; i++) assert.ok(Math.hypot(way[i].x - way[i - 1].x, way[i].y - way[i - 1].y) < 46, 'one square at a time');
});

test('a route to where there is no way leads as near as it can, and the same square needs no route', () => {
  const grid = navGrid({ things: [] , mapInfo: undefined });
  assert.deepEqual(route(grid, { x: 20, y: 20 }, { x: 20, y: 20 }), []);
  const walled = { columns: 5, rows: 3, tile: 10, blocked: new Uint8Array([0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0]) };
  const way = route(walled, { x: 5, y: 5 }, { x: 45, y: 5 });
  assert.ok(way.length && way.at(-1).x <= 15, 'it goes up to the wall and stops');
});

test('"go to" walks round the wall to the hero, where "follow" would be stuck against it', () => {
  const game = make();
  const hero = spawn(game, 'hero', { x: 240, y: 40, w: 20, h: 20 });
  const enemy = spawn(game, 'enemy', { x: 50, y: 40, w: 20, h: 20 });
  behaviors({ enemy: [{ type: 'goTo', target: 'hero', speed: 120, stopAt: 14 }] });
  let met = false;
  for (let i = 0; i < 60 * 8 && !met; i++) {
    behave(game, DT, new Set());
    const a = centre(enemy);
    const b = centre(hero);
    met = Math.hypot(a.x - b.x, a.y - b.y) <= 16;
    const col = Math.floor(a.x / 32);
    const row = Math.floor(a.y / 32);
    assert.equal(navGrid(game).blocked[row * 10 + col], 0, 'the enemy is never inside a wall');
  }
  assert.ok(met, 'it reached the hero');
  assert.equal(first(game, 'enemy'), enemy);
});

test('"go to" notices from a range, stops close enough, and finds a new way when the hero moves', () => {
  const game = make();
  const hero = spawn(game, 'hero', { x: 240, y: 40, w: 20, h: 20 });
  const near = spawn(game, 'a', { x: 50, y: 40, w: 20, h: 20 });
  behaviors({ a: [{ type: 'goTo', target: 'hero', speed: 100, range: 50 }] });
  run(game, 1);
  assert.equal(near.x, 50, 'out of range: it stays');
  behaviors({ a: [{ type: 'goTo', target: 'hero', speed: 100, stopAt: 400 }] });
  run(game, 1);
  assert.equal(near.x, 50, 'already close enough: it stays');
  behaviors({ a: [{ type: 'goTo', target: 'hero', speed: 100, stopAt: 5, rethink: 0.1 }] });
  run(game, 1.5);
  hero.x = 40;
  hero.y = 120;
  run(game, 6);
  const a = centre(near);
  const b = centre(hero);
  assert.ok(Math.hypot(a.x - b.x, a.y - b.y) < 10, 'it went after the hero to its new place');
});

test('a wall that is broken opens the way at once', () => {
  const game = make();
  const hero = spawn(game, 'hero', { x: 240, y: 40, w: 20, h: 20 });
  const enemy = spawn(game, 'e', { x: 120, y: 40, w: 20, h: 20 });
  for (const t of game.things.filter((x) => x.kind === 'wall' && x.x === 5 * 32 && x.y >= 32 && x.y <= 96)) t.kind = 'rubble';
  behaviors({ e: [{ type: 'goTo', target: 'hero', speed: 100, stopAt: 5, rethink: 0.1 }] });
  run(game, 1.2);
  assert.ok(enemy.y < 80, 'now it goes straight across and does not dip down to the gap');
  assert.ok(centre(enemy).x > 150);
  assert.ok(hero);
});

test('"keep away" runs from the hero, slides along walls, and stops in a corner', () => {
  const game = make();
  const hero = spawn(game, 'hero', { x: 100, y: 100, w: 20, h: 20 });
  const mouse = spawn(game, 'mouse', { x: 130, y: 100, w: 20, h: 20 });
  behaviors({ mouse: [{ type: 'keepAway', from: 'hero', speed: 100, range: 120 }] });
  const start = Math.hypot(mouse.x - hero.x, mouse.y - hero.y);
  run(game, 0.5);
  assert.ok(Math.hypot(mouse.x - hero.x, mouse.y - hero.y) > start + 20, 'it got further away');
  run(game, 6);
  const grid = navGrid(game);
  const c = centre(mouse);
  assert.equal(grid.blocked[Math.floor(c.y / 32) * 10 + Math.floor(c.x / 32)], 0, 'never into a wall');
  const left = { x: mouse.x, y: mouse.y };
  run(game, 2);
  assert.ok(Math.hypot(mouse.x - left.x, mouse.y - left.y) < 80, 'it is in a corner of the room and has stopped');
});

test('"keep away" ignores a hero that is far away, and always runs with range 0', () => {
  const game = make();
  spawn(game, 'hero', { x: 40, y: 40, w: 20, h: 20 });
  const mouse = spawn(game, 'mouse', { x: 130, y: 100, w: 20, h: 20 });
  behaviors({ mouse: [{ type: 'keepAway', from: 'hero', speed: 100, range: 50 }] });
  run(game, 1);
  assert.deepEqual([mouse.x, mouse.y], [130, 100]);
  behaviors({ mouse: [{ type: 'keepAway', from: 'hero', speed: 100, range: 0 }] });
  run(game, 0.5);
  assert.ok(mouse.x !== 130 || mouse.y !== 100);
});

test('what they remember is plain data, and the run is the same each time', () => {
  const play = () => {
    const game = make();
    spawn(game, 'hero', { x: 240, y: 40, w: 20, h: 20 });
    spawn(game, 'enemy', { x: 50, y: 40, w: 20, h: 20 });
    behaviors({ enemy: [{ type: 'goTo', target: 'hero', speed: 90 }] });
    run(game, 2);
    return JSON.stringify(game.things.map((t) => [t.kind, t.x, t.y, t.bs]));
  };
  assert.equal(play(), play());
  assert.doesNotThrow(() => JSON.parse(play()));
});
