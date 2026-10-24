import { test } from 'node:test';
import assert from 'node:assert/strict';
import { followSmooth, stepLayers, drawLayers, layerProblems } from '../src/camera.js';

const MAP = { width: 2000, height: 600 };
const hero = (x, y = 300) => ({ x, y, w: 20, h: 20 });
const opts = { width: 400, height: 300 };

/** A pretend canvas that writes down what it was asked to draw. */
function recorder() {
  const calls = [];
  const g = new Proxy({}, {
    get: (_, name) => (name === 'createLinearGradient' ? () => ({ addColorStop() {} }) : (...args) => { calls.push([name, ...args]); }),
    set: () => true,
  });
  return { g, calls };
}

test('the first call puts the camera right on the thing, and it stays inside the map', () => {
  const game = {};
  followSmooth(game, hero(1000), MAP, 1 / 60, opts);
  assert.equal(game.camera.x, 1000 + 10 - 200);
  const edge = {};
  followSmooth(edge, hero(5), MAP, 1 / 60, opts);
  assert.equal(edge.camera.x, 0, 'not past the left edge');
  const far = {};
  followSmooth(far, hero(1990), MAP, 1 / 60, opts);
  assert.equal(far.camera.x, 1600, 'not past the right edge');
});

test('the camera catches up with a delay: smooth 0 is at once, a bigger number is slower, and it gets there', () => {
  const run = (smooth, frames) => {
    const game = {};
    const h = hero(500);
    followSmooth(game, h, MAP, 1 / 60, { ...opts, smooth });
    h.x = 900;
    for (let i = 0; i < frames; i++) followSmooth(game, h, MAP, 1 / 60, { ...opts, smooth });
    return game.camera.x;
  };
  const target = 900 + 10 - 200;
  assert.equal(run(0, 1), target);
  assert.ok(run(0.3, 5) < run(0.1, 5), 'a slower camera is further behind');
  assert.ok(run(0.3, 5) > 500 + 10 - 200, 'but it has started to move');
  assert.ok(Math.abs(run(0.1, 120) - target) < 1, 'and in the end it is there');
});

test('looking ahead shows more of where the thing is heading', () => {
  const game = {};
  const h = hero(500);
  followSmooth(game, h, MAP, 1 / 60, { ...opts, smooth: 0.05, lookAhead: 80 });
  for (let i = 0; i < 60; i++) { h.x += 3; followSmooth(game, h, MAP, 1 / 60, { ...opts, smooth: 0.05, lookAhead: 80 }); }
  assert.ok(game.camera.x + 200 > h.x + 10 + 60, 'the middle of the screen is well ahead of the thing');
});

test('a dead zone lets the thing wander before the camera moves', () => {
  const game = {};
  const h = hero(500);
  const o = { ...opts, smooth: 0, deadZone: 50 };
  followSmooth(game, h, MAP, 1 / 60, o);
  const start = game.camera.x;
  h.x += 30;
  followSmooth(game, h, MAP, 1 / 60, o);
  assert.equal(game.camera.x, start, 'a small step does not move it');
  h.x += 100;
  followSmooth(game, h, MAP, 1 / 60, o);
  assert.ok(game.camera.x > start, 'a big one does');
});

test('followSmooth explains what it needs when it has no map', () => {
  assert.throws(() => followSmooth({}, hero(1), undefined, 0.016), /size of the level/);
});

test('the layers clock moves on with time', () => {
  const game = {};
  stepLayers(game, 0.5);
  stepLayers(game, 0.25);
  assert.equal(game.layerClock, 0.75);
});

test('layers far away move less than the camera, near ones as much, fixed ones not at all', () => {
  const at = (parallax, camX) => {
    const { g, calls } = recorder();
    drawLayers(g, { camera: { x: camX, y: 0 } }, [{ kind: 'buildings', color: '#123', size: 100, height: 100, y: 100, parallax, seed: 4 }], { width: 400, height: 300 });
    return calls.filter((c) => c[0] === 'fillRect')[0][1];
  };
  assert.equal(at([0, 0], 0), at([0, 0], 500), 'a fixed layer does not move');
  assert.equal(at([1, 0], 0) - at([1, 0], 50), 50, 'a layer that moves with the world moves as far as the camera');
  assert.equal(at([0.5, 0], 0) - at([0.5, 0], 50), 25, 'a far layer moves half as far');
});

test('drawing is the same every time, and scrolling layers use the clock', () => {
  const draw = (clock) => {
    const { g, calls } = recorder();
    drawLayers(g, { camera: { x: 120, y: 0 }, layerClock: clock }, { layers: [
      { kind: 'stars', color: '#fff', seed: 3, scroll: [0, 0] }, { kind: 'clouds', color: '#eee', scroll: [-20, 0], seed: 2 }, { kind: 'hills', color: '#264', y: 150 }] },
    { width: 400, height: 300 });
    return JSON.stringify(calls);
  };
  assert.equal(draw(1), draw(1), 'the same picture each time');
  assert.notEqual(draw(0), draw(2), 'clouds drift as the clock moves');
});

test('front layers are drawn only when asked for, hidden ones never', () => {
  const layers = [{ kind: 'color', color: '#111', parallax: [0, 0] }, { kind: 'color', color: '#222', front: true }, { kind: 'color', color: '#333', hidden: true }];
  const count = (front) => { const { g, calls } = recorder(); drawLayers(g, {}, layers, { front, width: 100, height: 100 }); return calls.filter((c) => c[0] === 'fillRect').length; };
  assert.equal(count(false), 1);
  assert.equal(count(true), 1);
});

test('layerProblems says what is wrong', () => {
  assert.deepEqual(layerProblems({ camera: { smooth: 0.2, lookAhead: 10, deadZone: 0 }, layers: [{ kind: 'hills', color: '#264' }] }), []);
  assert.match(layerProblems([{ kind: 'lava' }])[0], /not a kind/);
  assert.match(layerProblems([{ kind: 'sprite', name: 'far' }])[0], /needs a sprite/);
  assert.match(layerProblems([{ kind: 'image', name: 'far' }])[0], /picture file/);
  assert.match(layerProblems({ camera: { smooth: -1 }, layers: [] })[0], /camera/);
  assert.match(layerProblems(Array.from({ length: 13 }, () => ({ kind: 'color' })))[0], /13 layers/);
});
