import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPlayground } from '../scene.js';
import { SaveGame, MemoryStorage } from '../../../packages/save/src/index.js';

const run = (play, seconds) => { for (let i = 0; i < Math.round(seconds * 60); i++) { play.tick(1 / 60); play.world.step(1 / 60); } };
const snapshot = (play) => Object.fromEntries(play.world.bodies.filter((b) => b.key).map((b) => [b.key, [b.x, b.y, b.z, b.qx, b.qy, b.qz, b.qw, b.vx, b.vy, b.vz]]));
const newGame = (storage) => { const play = buildPlayground(); const saves = play.attach(new SaveGame({ game: 'physics3d', version: 1, storage })); return { play, saves }; };

test('the whole playground (prefab instances, bodies, joints, a ragdoll, the door\'s state machine) is saved and loaded into a freshly built one, which then carries on exactly the same', async () => {
  const storage = new MemoryStorage();
  const a = newGame(storage);
  run(a.play, 2);
  a.play.spawn('cannonball', { x: 0, y: 3, z: 20 }, { overrides: { 'extras.body.velocity': [0, 2, -8] } }); // by hand, near the door
  run(a.play, 1.5);
  assert.ok(['opening', 'open'].includes(a.play.door.state) || a.play.door.state === 'closed', 'whatever state the door is in, it is saved');
  const doorBefore = a.play.door.state;
  const { bytes, file } = await a.saves.save('slot', { title: 'mid game' });
  assert.ok(bytes > 1000);
  assert.deepEqual(Object.keys(file.sections), ['scene', 'physics', 'doors']);
  const instanceCount = a.play.spawned.length;
  assert.equal(file.sections.scene.data.instances.length, instanceCount, 'every instance is in the scene section');
  run(a.play, 3);
  const expected = snapshot(a.play);

  const b = newGame(storage); // a new world with its own ids, as in a new session; the load replaces its scene
  run(b.play, 0.5); // it is busy doing its own thing
  const r = await b.saves.load('slot');
  assert.equal(r.meta.title, 'mid game');
  assert.equal(b.play.door.state, doorBefore, 'the door state machine was restored');
  assert.equal(b.play.world.bodies.length, a.play.world.bodies.length);
  run(b.play, 3);
  const got = snapshot(b.play);
  assert.deepEqual(Object.keys(got).sort(), Object.keys(expected).sort());
  let worst = 0;
  for (const k of Object.keys(expected)) for (let i = 0; i < 10; i++) worst = Math.max(worst, Math.abs(got[k][i] - expected[k][i]));
  assert.ok(worst < 1e-9, `three seconds after loading, every body is where it would have been (largest difference ${worst})`);
});

test('loading puts back what was destroyed and removes what was added since, and a damaged file leaves the running game alone', async () => {
  const storage = new MemoryStorage();
  const { play, saves } = newGame(storage);
  run(play, 1);
  const before = play.spawned.length, bodies = play.world.bodies.length;
  await saves.save('s');
  for (const inst of play.spawned.slice(0, 20)) inst.destroy();         // the crate wall is gone
  play.spawn('cannonball', { x: 0, y: 5, z: 0 });
  assert.notEqual(play.world.bodies.length, bodies);
  await saves.load('s');
  assert.equal(play.prefabs.spawner.instances.size, before);
  assert.equal(play.world.bodies.length, bodies);
  const text = await storage.get('slot.s');
  await storage.set('slot.s', text.slice(0, text.length - 40)); await storage.delete('slot.s.bak');
  play.spawn('cannonball', { x: 1, y: 5, z: 1 });
  const during = play.world.bodies.length;
  await assert.rejects(saves.load('s'), (e) => e.code === 'corrupt');
  assert.equal(play.world.bodies.length, during, 'a bad file touched nothing');
});

test('a prefab instance saves as its name plus only what changed, not as a dump', async () => {
  const { play, saves } = newGame(new MemoryStorage());
  run(play, 0.2);
  const file = saves.capture();
  const crate = file.sections.scene.data.instances.find((i) => i.prefab === 'crate');
  assert.ok(Object.keys(crate.overrides).length <= 3, JSON.stringify(crate.overrides));
  assert.ok(JSON.stringify(file.sections.scene.data).length < JSON.stringify(file.sections.physics.data).length, 'the scene is the small part');
});
