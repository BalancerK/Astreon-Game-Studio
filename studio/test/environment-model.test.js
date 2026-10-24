import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULTS, FIELDS, STARTERS, cleanWorld, setWorld, serializeWorld, parseWorld, groundHeight, rgb, skySetup, waterSetup, describeWorld,
} from '../app/paint/environment-model.js';

test('an empty or damaged file means the usual environment, and says what is wrong', () => {
  assert.deepEqual(parseWorld('').world, cleanWorld({}).world);
  assert.deepEqual(parseWorld(undefined).problems, []);
  assert.match(parseWorld('{nope').problems[0], /not valid JSON/);
  const r = cleanWorld({ sky: { hour: 'noon', stars: 1 }, water: { shallow: 'blue' }, terrain: 5 });
  assert.equal(r.problems.length, 4);
  assert.equal(r.world.sky.hour, DEFAULTS.sky.hour);
  assert.equal(cleanWorld([]).problems.length, 1);
});

test('numbers are kept inside their range, and the land number is whole', () => {
  const { world } = cleanWorld({ sky: { hour: 99, turbidity: -4 }, water: { opacity: 5 }, terrain: { seed: 3.7, hills: 100 } });
  assert.equal(world.sky.hour, 24);
  assert.equal(world.sky.turbidity, 1);
  assert.equal(world.water.opacity, 1);
  assert.equal(world.terrain.seed, 4);
  assert.equal(world.terrain.hills, 24);
});

test('changing one part keeps the rest, refuses nonsense, and the file reads back exactly', () => {
  let w = cleanWorld({}).world;
  w = setWorld(w, 'sky', { hour: 6.5 });
  w = setWorld(w, 'water', { on: false, deep: '#112233' });
  assert.equal(w.sky.hour, 6.5);
  assert.equal(w.sky.turbidity, DEFAULTS.sky.turbidity);
  assert.equal(w.water.on, false);
  assert.throws(() => setWorld(w, 'sky', { stars: 'yes' }), /true or false/);
  assert.throws(() => setWorld(w, 'moon', {}), /not a part/);
  assert.throws(() => setWorld(w, 'water', { deep: 'dark' }), /colour/);
  const text = serializeWorld(w);
  assert.ok(text.endsWith('\n'));
  assert.deepEqual(parseWorld(text), { world: w, problems: [] });
});

test('every starter is a clean environment and each setting has a range that contains its usual value', () => {
  for (const [name, make] of Object.entries(STARTERS)) assert.deepEqual(cleanWorld(make()).problems, [], name);
  for (const [part, fields] of Object.entries(FIELDS)) {
    for (const f of fields) {
      assert.ok(DEFAULTS[part][f.key] >= f.min && DEFAULTS[part][f.key] <= f.max, `${part}.${f.key}`);
      assert.ok(f.label && f.help);
    }
  }
  assert.equal(STARTERS.desert().water.on, false);
});

test('the ground is the same every time, changes with the land number, has hills and slopes down to the rim', () => {
  const t = DEFAULTS.terrain;
  assert.equal(groundHeight(t, 20, 30), groundHeight(t, 20, 30));
  assert.notEqual(groundHeight(t, 20, 30), groundHeight({ ...t, seed: 8 }, 20, 30));
  const heights = [];
  for (let x = 0; x <= 64; x += 4) for (let z = 0; z <= 64; z += 4) heights.push(groundHeight(t, x, z));
  assert.ok(Math.max(...heights) - Math.min(...heights) > 3, 'it is not flat');
  assert.ok(Math.max(...heights) < t.hills * 2 + 1, 'and not taller than the hills setting allows');
  const flat = { ...t, hills: 0 };
  assert.ok(Math.abs(groundHeight(flat, 32, 32)) < 0.01 && groundHeight(flat, 0, 0) < -2, 'no hills is flat in the middle and still dips at the rim');
});

test('what the engine needs is worked out from the file: colours as numbers, no clouds when 0, no water when off', () => {
  assert.deepEqual(rgb('#ff8000'), [1, 128 / 255, 0]);
  const w = cleanWorld({ sky: { clouds: 0 } }).world;
  assert.equal(skySetup(w).clouds, false);
  assert.deepEqual(skySetup(cleanWorld({ sky: { clouds: 0.5 } }).world).clouds, { coverage: 0.5 });
  assert.equal(waterSetup(cleanWorld({ water: { on: false } }).world), null);
  assert.deepEqual(waterSetup(w).shallow, rgb(w.water.shallow));
  assert.match(describeWorld(STARTERS.night()), /night sky/);
  assert.match(describeWorld(STARTERS.desert()), /no water/);
});
