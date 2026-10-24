import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { TEMPLATES } from '../app/store/templates.js';
import { instrumentSource } from '../app/profile/instrument.js';

const KIT = pathToFileURL(resolve('packages/arcade/src/index.js')).href;

/** Load a game file the way the runner does: its kit import points at the kit's file. */
async function load(source) {
  const text = source.replace("'@engine/arcade'", JSON.stringify(KIT));
  return import(`data:text/javascript;base64,${Buffer.from(text).toString('base64')}`);
}

function fakeCanvas() {
  let calls = 0;
  const g = new Proxy({}, {
    get: (t, k) => (k === 'calls' ? calls : k === 'createLinearGradient' ? () => ({ addColorStop() {} }) : () => { calls++; }),
    set: () => true,
  });
  return g;
}

const SOURCE = TEMPLATES.world3d.files['src/main.js'];

test('the 3D template is a listed template with a description and runs as a game', async () => {
  assert.ok(TEMPLATES.world3d.title.includes('3D') && TEMPLATES.world3d.description.length > 40);
  const game = await load(SOURCE);
  const state = game.create();
  const g = fakeCanvas();
  game.update(state, new Set(['KeyW']), 1 / 60);
  game.render(state, g);
  assert.ok(g.calls > 20, 'it draws things');
  const s = game.summary(state);
  assert.deepEqual(Object.keys(s).sort(), ['gems', 'gemsLeft', 'height', 'lives', 'walked', 'x', 'yaw', 'z']);
  assert.equal(s.gemsLeft, 5);
  assert.ok(s.walked > 0);
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(state)), 'the state is plain data (the Time Machine and saving need that)');
});

test('walking forward from the start goes into the room and the walls stop you', async () => {
  const game = await load(SOURCE);
  const state = game.create();
  for (let i = 0; i < 60 * 12; i++) game.update(state, new Set(['KeyW']), 1 / 60);
  assert.ok(state.cam.z < 8 && state.cam.z > -12, `stopped in the room (${state.cam.z})`);
  assert.ok(state.walked > 10);
});

test('every gem can be reached, and collecting them all finishes the game', async () => {
  const game = await load(SOURCE);
  const state = game.create();
  const start = { x: state.cam.x, z: state.cam.z };
  for (const gem of [...state.gems]) {
    state.cam.x = gem.x;
    state.cam.z = gem.z;
    game.update(state, new Set(), 1 / 60);
  }
  assert.equal(state.gems.length, 0);
  assert.equal(state.score, 5);
  assert.equal(game.summary(state).gemsLeft, 0);
  const g = fakeCanvas();
  assert.doesNotThrow(() => game.render(state, g));
  assert.notDeepEqual(start, { x: state.cam.x, z: state.cam.z });
});

test('the gems are not inside blocks (each can be walked up to without a wall in the way)', async () => {
  const game = await load(SOURCE);
  const state = game.create();
  const kit = await import(KIT);
  const blocks = [...SOURCE.matchAll(/block\(([^)]*)\)/g)].map((m) => m[1].split(',').map((s) => s.trim())).filter((a) => a.length >= 5)
    .map(([x, z, w, d]) => ({ x: Number(x), z: Number(z), w: Number(w), d: Number(d) })).filter((b) => [b.x, b.z, b.w, b.d].every(Number.isFinite));
  for (const gem of state.gems) {
    const stuck = kit.slideAgainst({ x: gem.x, z: gem.z }, 0.01, 0.01, blocks, 0.35);
    assert.ok(stuck.x !== gem.x || stuck.z !== gem.z, `gem at ${gem.x}, ${gem.z} is free`);
  }
});

test('the template still works when every function is timed (the Profiler\'s rewrite)', async () => {
  let names = 0;
  globalThis.__pf = (name, fn) => { names++; return fn(); };
  const game = await load(instrumentSource(SOURCE, 'src/main.js').text);
  const state = game.create();
  game.update(state, new Set(['KeyW']), 1 / 60);
  game.render(state, fakeCanvas());
  assert.ok(names >= 3, `create, update and render were timed (${names})`);
  delete globalThis.__pf;
});

test('the guardian waits three seconds, then walks towards you; being caught costs a life and sends you back to the start', async () => {
  const game = await load(SOURCE);
  const state = game.create();
  const start = { ...state.guardian };
  for (let i = 0; i < 60 * 2.5; i++) game.update(state, new Set(), 1 / 60);
  assert.deepEqual(state.guardian, start, 'it does not move at first');
  for (let i = 0; i < 60 * 3; i++) game.update(state, new Set(), 1 / 60);
  assert.ok(state.guardian.z > start.z, 'then it comes');
  assert.equal(state.lives, 3);
  state.guardian = { x: state.cam.x, z: state.cam.z - 0.3 };
  game.update(state, new Set(), 1 / 60);
  assert.equal(state.lives, 2, 'caught');
  assert.ok(state.hurt > 1.9 && state.cam.z === 9, 'safe for a moment, back at the start');
  state.guardian = { x: state.cam.x, z: state.cam.z - 0.3 };
  game.update(state, new Set(), 1 / 60);
  assert.equal(state.lives, 2, 'not caught again while safe');
});

test('three catches end the game, Enter starts again, and the mouse turns you once it is held', async () => {
  const game = await load(SOURCE);
  const state = game.create();
  for (let n = 0; n < 3; n++) {
    state.hurt = 0;
    state.guardian = { x: state.cam.x, z: state.cam.z - 0.3 };
    game.update(state, new Set(), 1 / 60);
  }
  assert.equal(state.over, true);
  assert.equal(state.lives, 0);
  const g = fakeCanvas();
  assert.doesNotThrow(() => game.render(state, g));
  game.update(state, new Set(), 1 / 60);
  assert.equal(state.over, true, 'nothing happens until Enter');
  game.update(state, new Set(['Enter']), 1 / 60);
  assert.equal(state.over, false);
  assert.equal(state.lives, 3);
  const fresh = game.create();
  game.update(fresh, new Set(['Mouse:0:0']), 1 / 60);
  game.update(fresh, new Set(['Mouse:-200:0']), 1 / 60);
  assert.ok(fresh.cam.yaw > 0.4, `the mouse turned the view (${fresh.cam.yaw})`);
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(fresh)), 'and the game is still plain data');
});
