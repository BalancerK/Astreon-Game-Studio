import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  newGame, spawn, all, first, despawn, touching, overlaps, touches, move, every, random, randomBetween,
  held, walk, steer, jump, gravity, moveAndCollide, loadMap, clear, drawThings, label, follow,
} from '../src/index.js';

test('things are plain objects in a list: spawn, find, remove', () => {
  const g = newGame({ lives: 3 });
  assert.equal(g.lives, 3);
  const hero = spawn(g, 'hero', { x: 10, y: 20 });
  const coin = spawn(g, 'coin', { x: 50, y: 20, emoji: '🪙' });
  spawn(g, 'coin', { x: 90, y: 20 });
  assert.equal(hero.id, 1); assert.equal(coin.id, 2); assert.equal(hero.w, 32);
  assert.deepEqual(all(g, 'coin').map((t) => t.id), [2, 3]); assert.equal(all(g).length, 3); assert.equal(first(g, 'hero'), hero); assert.equal(first(g, 'none'), undefined);
  for (const c of all(g, 'coin')) despawn(g, c);                                  // safe while looping
  assert.equal(all(g, 'coin').length, 0); assert.equal(despawn(g, coin), false, 'already gone');
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(g)), 'the whole state is plain data');
  const bare = {}; spawn(bare, 'x'); assert.equal(bare.things.length, 1, 'works on a state that was not made with newGame');
});

test('touching: overlap only, never with itself, edges that merely meet do not count', () => {
  const g = newGame();
  const a = spawn(g, 'a', { x: 0, y: 0, w: 10, h: 10 });
  const b = spawn(g, 'b', { x: 5, y: 5, w: 10, h: 10 });
  const c = spawn(g, 'b', { x: 10, y: 0, w: 10, h: 10 });
  assert.equal(touching(a, b), true); assert.equal(touching(a, c), false, 'edges meet'); assert.equal(touching(a, a), false);
  assert.deepEqual(overlaps(g, a, 'b'), [b]); assert.equal(touches(g, a, 'b'), b); assert.equal(touches(g, a, 'zzz'), undefined);
});

test('move, timers and the seeded random are plain and repeatable', () => {
  const t = { x: 0, y: 0, vx: 60, vy: -30 }; move(t, 0.5); assert.deepEqual([t.x, t.y], [30, -15]);
  const g = newGame(); const fired = [];
  for (let i = 0; i < 10; i++) if (every(g, 'tick', 0.25, 0.1)) fired.push(i);
  assert.deepEqual(fired, [2, 4, 7, 9], 'every 0.25 s with 0.1 s ticks');
  const a = newGame(); const b = newGame();
  const run = (game) => Array.from({ length: 5 }, () => random(game));
  assert.deepEqual(run(a), run(b), 'the same seed gives the same numbers'); assert.ok(run(a).every((n) => n >= 0 && n < 1));
  const copy = JSON.parse(JSON.stringify(a)); assert.equal(random(a), random(copy), 'a copied game continues the same way');
  for (let i = 0; i < 200; i++) { const n = randomBetween(a, 5, 8); assert.ok(n >= 5 && n < 8); }
  assert.notEqual(random(newGame({ seed: 1 })), random(newGame({ seed: 2 })));
});

test('keys: easy names, real codes, walking, steering without faster diagonals', () => {
  const keys = new Set(['ArrowLeft']);
  assert.equal(held(keys, 'left'), true); assert.equal(held(keys, 'right'), false); assert.equal(held(new Set(['KeyD']), 'right'), true, 'WASD works too');
  assert.equal(held(new Set(['Space']), 'jump'), true); assert.equal(held(new Set(['KeyP']), 'KeyP'), true); assert.equal(held(new Set(), 'anything'), false);
  const t = { vx: 0, vy: 0 };
  walk(t, new Set(['ArrowRight']), 100); assert.equal(t.vx, 100); walk(t, new Set(['ArrowRight', 'ArrowLeft']), 100); assert.equal(t.vx, 0, 'both cancel'); walk(t, new Set(), 100); assert.equal(t.vx, 0);
  steer(t, new Set(['ArrowRight', 'ArrowDown']), 100); assert.ok(Math.abs(Math.hypot(t.vx, t.vy) - 100) < 1e-9, 'a diagonal is not faster');
  steer(t, new Set(['ArrowUp']), 100); assert.deepEqual([t.vx, t.vy], [0, -100]);
});

test('a hero falls, lands on the ground, jumps only from the ground and stops at walls', () => {
  const g = newGame();
  spawn(g, 'wall', { x: 0, y: 200, w: 400, h: 32 });                               // floor
  spawn(g, 'wall', { x: 300, y: 100, w: 32, h: 100 });                             // a wall to the right
  const hero = spawn(g, 'hero', { x: 50, y: 0, w: 24, h: 32 });
  const dt = 1 / 60;
  for (let i = 0; i < 120; i++) { gravity(hero, dt); moveAndCollide(g, hero, dt); }
  assert.equal(hero.onGround, true); assert.equal(hero.y, 200 - 32, 'standing exactly on the floor'); assert.equal(hero.vy, 0);
  const keys = new Set(['Space']);
  assert.equal(jump(hero, keys), true); assert.ok(hero.vy < 0); assert.equal(jump(hero, keys), false, 'no jumping in mid-air');
  let top = hero.y; for (let i = 0; i < 40; i++) { gravity(hero, dt); moveAndCollide(g, hero, dt); top = Math.min(top, hero.y); }
  assert.ok(top < 200 - 32 - 40, `rose ${200 - 32 - top}px`);
  for (let i = 0; i < 120; i++) { hero.vx = 200; gravity(hero, dt); const hit = moveAndCollide(g, hero, dt); if (hit.x) break; }
  assert.equal(hero.x, 300 - 24, 'stopped against the wall, not inside it');
});

test('a very fast thing cannot jump over a thin wall, and a head bump stops a rising jump', () => {
  const g = newGame();
  spawn(g, 'wall', { x: 100, y: 0, w: 2, h: 100 });
  const bullet = spawn(g, 'bullet', { x: 0, y: 40, w: 4, h: 4, vx: 6000 });
  moveAndCollide(g, bullet, 1 / 60);
  assert.ok(bullet.x + bullet.w <= 100, `stopped at ${bullet.x}`);
  const g2 = newGame(); spawn(g2, 'wall', { x: 0, y: 0, w: 100, h: 20 });
  const hero = spawn(g2, 'hero', { x: 10, y: 30, w: 20, h: 20, vy: -500 });
  const hit = moveAndCollide(g2, hero, 1 / 30);
  assert.equal(hit.y, true); assert.equal(hero.y, 20, 'under the ceiling'); assert.equal(hero.vy, 0); assert.equal(hero.onGround, false);
});

test('maps: letters become things with the legend, with clear messages when it is wrong', () => {
  const g = newGame();
  const map = loadMap(g, ['####', '#@o#', '####'], { '#': { kind: 'wall', color: '#345' }, '@': { kind: 'hero' }, o: { kind: 'coin', emoji: '🪙', w: 16, h: 16 } });
  assert.deepEqual(map, { columns: 4, rows: 3, width: 128, height: 96 }); assert.equal(all(g).length, 12);
  assert.equal(all(g, 'wall').length, 10); const hero = first(g, 'hero'); assert.deepEqual([hero.x, hero.y, hero.w], [32, 32, 32]);
  assert.equal(first(g, 'coin').w, 16, 'the legend can change the size'); assert.equal(first(g, 'wall').color, '#345');
  { const e = newGame(); loadMap(e, ['..', '. '], {}); assert.equal(all(e).length, 0, '. and space are empty'); } assert.equal(loadMap(newGame(), ['ab'], { a: { kind: 'x' }, b: { kind: 'y' } }, 10).width, 20);
  assert.throws(() => loadMap(newGame(), ['#?'], { '#': { kind: 'wall' } }), /Unknown map symbol "\?" at row 1, column 2.*legend/);
  assert.throws(() => loadMap(newGame(), ['###', '##'], { '#': { kind: 'wall' } }), /Row 2 is 2 characters long but the first row is 3/);
  assert.throws(() => loadMap(newGame(), [], {}), /list of rows/);
});

test('drawing: a fake context records what is drawn, with the camera and without hidden things', () => {
  const calls = [];
  const g = new Proxy({}, { get: (o, k) => (k in o ? o[k] : (...a) => calls.push([String(k), ...a])), set: (o, k, v) => { o[k] = v; calls.push(['set', String(k), v]); return true; } });
  const game = newGame(); game.camera = { x: 10.4, y: 0 };
  spawn(game, 'a', { x: 0, y: 0, w: 10, h: 10, color: '#f00' }); spawn(game, 'b', { hidden: true }); spawn(game, 'c', { shape: 'circle', w: 8, h: 8 }); spawn(game, 'd', { emoji: '🪙' });
  clear(g, '#000'); drawThings(g, game); label(g, 42, 5, 6, { align: 'right' });
  const names = calls.map((c) => c[0]);
  assert.ok(names.includes('fillRect') && names.includes('ellipse') && names.includes('fillText') && names.includes('save') && names.includes('restore'));
  assert.deepEqual(calls.find((c) => c[0] === 'translate'), ['translate', -10, 0]); assert.equal(calls.filter((c) => c[0] === 'fillRect').length, 2, 'the background and one box: the hidden one is skipped');
  assert.deepEqual(calls.at(-1), ['fillText', '42', 5, 6]);
});

test('the camera follows a thing and stays inside the map', () => {
  const game = newGame(); const map = { width: 1000, height: 600 };
  const t = { x: 500, y: 300, w: 20, h: 20 };
  follow(game, t, map); assert.deepEqual(game.camera, { x: 270, y: 150 });
  follow(game, { x: 0, y: 0, w: 20, h: 20 }, map); assert.deepEqual(game.camera, { x: 0, y: 0 }, 'not past the left or top');
  follow(game, { x: 990, y: 590, w: 20, h: 20 }, map); assert.deepEqual(game.camera, { x: 520, y: 280 }, 'not past the right or bottom');
  follow(game, { x: 10, y: 10, w: 1, h: 1 }, { width: 100, height: 100 }); assert.deepEqual(game.camera, { x: 0, y: 0 }, 'a map smaller than the screen');
  assert.doesNotThrow(() => follow({}, undefined, map));
  assert.throws(() => follow(game, t, undefined), /game\.map = loadMap.*press Run/, 'a missing map says what to do');
  assert.throws(() => follow(game, t, {}), /size of the level/);
});
