import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WORLD, createGame, step } from '../src/game.js';

const still = { x: 0, y: 0 };

test('the same seed gives the same game', () => {
  const a = createGame(7), b = createGame(7);
  assert.deepEqual(a.coins, b.coins);
  for (let i = 0; i < 100; i++) { step(a, { x: 1, y: 0 }, 1 / 60); step(b, { x: 1, y: 0 }, 1 / 60); }
  assert.deepEqual(a.player, b.player);
});

test('the player moves at a steady speed in any direction and stays inside the world', () => {
  const g = createGame(1);
  g.hazards.length = 0;
  const x0 = g.player.x;
  step(g, { x: 1, y: 0 }, 1);
  assert.ok(Math.abs(g.player.x - x0 - 260) < 1e-9);
  const d = createGame(1); d.hazards.length = 0; const { x, y } = d.player;
  step(d, { x: 1, y: 1 }, 0.5);
  assert.ok(Math.abs(Math.hypot(d.player.x - x, d.player.y - y) - 130) < 1e-9, 'diagonals are not faster');
  for (let i = 0; i < 600; i++) step(g, { x: 1, y: -1 }, 1 / 60);
  assert.ok(g.player.x <= WORLD.width - g.player.r && g.player.y >= g.player.r);
});

test('collecting a coin scores, moves the coin, and every fifth makes the game harder', () => {
  const g = createGame(3);
  g.hazards.length = 0;
  const before = g.hazards.length;
  for (let n = 0; n < 5; n++) {
    g.coins[0].x = g.player.x; g.coins[0].y = g.player.y;
    const e = step(g, still, 1 / 60);
    assert.equal(e.coin, true);
  }
  assert.equal(g.score, 5);
  assert.equal(g.hazards.length, before + 1);
  assert.ok(Math.hypot(g.coins[0].x - g.player.x, g.coins[0].y - g.player.y) > 100);
});

test('touching a hazard ends the game and keeps the best score', () => {
  const g = createGame(5, 2);
  g.score = 9; g.hazards[0].x = g.player.x; g.hazards[0].y = g.player.y;
  const e = step(g, still, 1 / 60);
  assert.equal(e.hit, true); assert.equal(g.over, true); assert.equal(g.best, 9);
  const t = g.time; step(g, { x: 1, y: 0 }, 1); assert.equal(g.time, t, 'nothing moves once it is over');
});
