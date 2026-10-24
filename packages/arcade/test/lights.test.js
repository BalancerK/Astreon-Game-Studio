import { test } from 'node:test';
import assert from 'node:assert/strict';
import { drawLights, flicker, lightProblems, shadowShapes } from '../src/lights.js';
import { setCanvasFactory } from '../src/art.js';

/** A pretend canvas that writes down what it was asked to do (and what it was set to). */
function recorder(calls = []) {
  const g = new Proxy({}, {
    get: (_, name) => {
      if (name === 'createRadialGradient') return (...args) => { calls.push(['gradient',
        ...args]); return { addColorStop: (...stop) => calls.push(['stop', ...stop]) }; };
      return (...args) => { calls.push([name, ...args]); };
    },
    set: (_, name, value) => { calls.push(['set', name, value]); return true; },
  });
  return { g, calls };
}

const view = { width: 200, height: 100 };
const darkCalls = [];
setCanvasFactory((w, h) => ({ width: w, height: h, getContext: () => recorder(darkCalls).g }));

const reset = () => { darkCalls.length = 0; };
const holes = () => darkCalls.filter((c) => c[0] === 'gradient').map((c) => [c[1], c[2], c[6]]);

test('a light that does not flicker is full, and one that does is dimmer, the same each time, and always from 0 to 1', () => {
  assert.equal(flicker(0, 5), 1);
  for (let t = 0; t < 20; t += 0.37) {
    const v = flicker(0.6, t, 3);
    assert.ok(v >= 0 && v <= 1);
    assert.equal(v, flicker(0.6, t, 3));
  }
  assert.ok(flicker(0.6, 1, 3) < 1);
  assert.notEqual(flicker(0.6, 1, 3), flicker(0.6, 1, 8), 'a different seed flickers differently');
});

test('darkness is drawn once, with a hole rubbed out for each light at its place on the screen', () => {
  reset();
  const { g, calls } = recorder();
  const file = { screen: { darkness: 0.8, ambient: '#000000' }, lights: [{ kind: 'point', x: 120, y: 60, radius: 50 }, { x: 10, y: 20,
    radius: 30 }] };
  drawLights(g, { camera: { x: 20, y: 10 }, things: [] }, file, view);
  assert.deepEqual(holes(), [[100, 50, 50], [-10, 10, 30]], 'the world place minus the camera, with each radius');
  assert.ok(darkCalls.some((c) => c[0] === 'set' && c[2] === 'destination-out'), 'the holes are rubbed out of the darkness');
  assert.equal(calls.filter((c) => c[0] === 'drawImage').length, 1, 'the darkness is put over the picture once');
});

test('a light that follows a kind appears on every thing of that kind, and moves with it', () => {
  reset();
  const { g } = recorder();
  const things = [{ kind: 'torch', x: 40, y: 30, w: 10, h: 10, id: 1 }, { kind: 'torch', x: 150, y: 30, w: 10, h: 10, id: 2 }, { kind: 'wall', x: 0,
    y: 0, w: 10, h: 10, id: 3 }];
  drawLights(g, { things }, { screen: { darkness: 0.5 }, lights: [{ follow: 'torch', radius: 40, dy: -5 }] }, view);
  assert.deepEqual(holes(), [[45, 30, 40], [155, 30, 40]], 'the middle of each torch, lifted by dy');
  reset();
  things[0].x = 60;
  drawLights(g, { things }, { screen: { darkness: 0.5 }, lights: [{ follow: 'torch', radius: 40 }] }, view);
  assert.equal(holes()[0][0], 65);
});

test('no darkness means no darkness layer; hidden lights are left out; tint and vignette are drawn when asked', () => {
  reset();
  const { g, calls } = recorder();
  drawLights(g, { things: [] }, { screen: { darkness: 0 }, lights: [{ x: 1, y: 1, radius: 10 }] }, view);
  assert.equal(darkCalls.length, 0);
  assert.equal(calls.filter((c) => c[0] === 'drawImage').length, 0);
  reset();
  const b = recorder();
  drawLights(b.g, { things: [] }, { screen: { darkness: 0.5 }, lights: [{ x: 1, y: 1, radius: 10, hidden: true }] }, view);
  assert.equal(holes().length, 0);
  const c = recorder();
  drawLights(c.g, { things: [] }, { screen: { tint: '#ff9a4a', tintAlpha: 0.2, vignette: 0.5 }, lights: [] }, view);
  assert.ok(c.calls.some((x) => x[0] === 'set' && x[1] === 'fillStyle' && /rgba\(255, 154, 74, 0.2\)/.test(x[2])), 'the tint');
  assert.ok(c.calls.some((x) => x[0] === 'gradient'), 'the vignette');
});

test('a coloured light glows on the picture, a white one only clears the dark', () => {
  const colourful = (color) => {
    reset();
    const { g, calls } = recorder();
    drawLights(g, { things: [] }, { screen: { darkness: 0.5 }, lights: [{ x: 50, y: 50, radius: 40, color }] }, view);
    return calls.filter((c) => c[0] === 'gradient').length;
  };
  assert.equal(colourful('#ffffff'), 0);
  assert.equal(colourful('#ffaa33'), 1);
});

test('the pictures are the same each time for the same clock, and a flickering light changes with the clock', () => {
  const draw = (clock) => {
    reset();
    const { g, calls } = recorder();
    drawLights(g, { layerClock: clock, things: [] }, { screen: { darkness: 0.6 }, lights: [{ x: 50, y: 50, radius: 40, color: '#ffaa33',
      flicker: 0.7 }] }, view);
    return JSON.stringify([calls, darkCalls]);
  };
  assert.equal(draw(1), draw(1));
  assert.notEqual(draw(1), draw(1.3));
});

test('lightProblems says what is wrong', () => {
  const ok = { screen: { darkness: 0.5, tint: '#ff9a4a', tintAlpha: 0.1 }, lights: [{ name: 'a', x: 1, y: 1, radius: 20, color: '#ffd27a' }] };
  assert.deepEqual(lightProblems(ok), []);
  assert.match(lightProblems({ lights: [{ name: 'a', radius: 0 }] })[0], /radius above 0/);
  assert.match(lightProblems({ lights: [{ name: 'a', radius: 5, color: 'red' }] })[0], /colour/);
  assert.match(lightProblems({ lights: [{ name: 'a', radius: 5, follow: '!!' }] })[0], /not a name/);
  assert.match(lightProblems({ screen: { darkness: 0.5 }, lights: [] })[0], /no lights/);
  assert.match(lightProblems({ screen: { tint: 'red', tintAlpha: 0.5 }, lights: [] })[0], /tint/);
  assert.match(lightProblems({ screen: { darkness: 2 }, lights: [{ radius: 5 }] })[0], /0 to 1/);
  assert.match(lightProblems(Array.from({ length: 25 }, () => ({ radius: 5 })))[0], /25 lights/);
});

test('a box throws a shadow from the sides that face the light, running out to the reach', () => {
  const shapes = shadowShapes({ x: 0, y: 50 }, [{ x: 40, y: 40, w: 10, h: 20 }], 100);
  assert.equal(shapes.length, 1, 'only the left edge faces a light on the left');
  const [a, b, c, d] = shapes[0];
  assert.deepEqual([a, b], [[40, 60], [40, 40]]);
  assert.ok(c[0] > 40 + 90 && d[0] > 40 + 90, 'the shadow runs away from the light');
  assert.ok(Math.abs(c[1] - d[1]) > Math.abs(a[1] - b[1]), 'and spreads: the far end is wider than the near end');
  assert.equal(shadowShapes({ x: 45, y: 50 }, [{ x: 40, y: 40, w: 10, h: 20 }], 100).length, 0, 'a light inside a box is not shadowed by it');
  assert.equal(shadowShapes({ x: 0, y: 0 }, [{ x: 40, y: 40, w: 10, h: 20 }], 100).length, 2, 'from a corner, two sides face the light');
});

test('shadows are cut out of a light only when some kinds block light, and a light can opt out', () => {
  const game = { things: [{ id: 1, kind: 'wall', x: 60, y: 40, w: 10, h: 40 }], camera: { x: 0, y: 0 } };
  const run = (screen, light = {}) => { reset(); const { g } = recorder(); drawLights(g, game, { screen: { darkness: 0.8, ...screen }, lights: [{ x: 20, y: 60, radius: 50, ...light }] }, view);
    return darkCalls.filter((c) => c[0] === 'fill').length; };
  assert.equal(run({}), 0, 'no blocking kinds: no shadows');
  assert.ok(run({ occluders: ['wall'] }) > 0, 'a wall blocks the light');
  assert.equal(run({ occluders: ['wall'] }, { shadows: false }), 0, 'unless this light ignores it');
  assert.equal(run({ occluders: ['crate'] }), 0, 'other kinds do not');
});

test('a core keeps the light at full strength out to there, and bad occluders or cores are reported', () => {
  reset();
  drawLights(recorder().g, { things: [], camera: { x: 0, y: 0 } }, { screen: { darkness: 0.5 }, lights: [{ x: 10, y: 10, radius: 40, core: 0.5 }] }, view);
  const stops = darkCalls.filter((c) => c[0] === 'stop').map((c) => c[1]);
  assert.deepEqual(stops, [0, 0.5, 0.775, 1]);
  assert.equal(lightProblems({ screen: { occluders: ['wall'] }, lights: [{ radius: 5, core: 0.5 }] }).length, 0);
  assert.equal(lightProblems({ screen: { occluders: ['bad name!'] }, lights: [] }).length, 1);
  assert.equal(lightProblems({ lights: [{ radius: 5, core: 2 }] }).length, 1);
});
