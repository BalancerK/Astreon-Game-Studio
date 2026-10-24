import { test } from 'node:test';
import assert from 'node:assert/strict';
import { answer, BridgeSceneStore, MAX_SCENE_BYTES } from '../scene3d/bridge.js';
import { createLibrary, describe, PREFABS } from '../scene3d/library.js';
import { SceneDocument, emptyScene } from '../../packages/scene/src/index.js';

const fakeProject = (files = {}) => ({
  files: { ...files },
  list() { return Object.keys(this.files); },
  has(p) { return p in this.files; },
  readText(p) { return this.files[p]; },
  write(p, t) { this.files[p] = t; },
  remove(p) { delete this.files[p]; },
});

test('the blocks are a valid library and each previews as a shape with a colour', () => {
  const lib = createLibrary();
  for (const p of PREFABS.filter((x) => x.name !== 'thing')) {
    const look = describe(lib.resolve(p.name));
    assert.ok(look && look.shape && look.color.length === 3, p.name);
  }
  assert.ok(new SceneDocument(emptyScene('t'), { library: lib }));
});

test('the studio answers the editor from scenes/*.json: list, save, load, remove, and refuses anything odd', () => {
  const p = fakeProject({
    'src/main.js': 'x', 'scenes/yard.json': '{}', 'scenes/bad name.json': '{}', 'scenes/sub/deep.json': '{}',
  });
  assert.deepEqual(answer(p, { op: 'list' }).value, [{ name: 'yard' }]);
  const scene = { format: 'engine-scene', version: 1, name: 'a', entities: [{ id: 'e1' }] };
  assert.equal(answer(p, { op: 'save', name: 'level-2', scene }).ok, true);
  assert.deepEqual(answer(p, { op: 'load', name: 'level-2' }).value, scene);
  assert.ok(p.files['scenes/level-2.json'].endsWith('\n'));
  assert.equal(answer(p, { op: 'remove', name: 'level-2' }).ok, true);
  assert.ok(!p.has('scenes/level-2.json'));
  assert.equal(answer(p, { op: 'remove', name: 'never-was' }).ok, true);
  for (const name of ['../src/main', 'a/b', '', 'x.json', '..', 'a b', 5, null]) {
    assert.equal(answer(p, { op: 'save', name, scene }).ok, false, String(name));
  }
  assert.match(answer(p, { op: 'load', name: 'nope' }).error, /no scene/);
  assert.match(answer(p, { op: 'save', name: 'ok', scene: { format: 'other', entities: [] } }).error, /not a scene/);
  assert.match(answer(p, { op: 'save', name: 'ok', scene: { ...scene, name: 'x'.repeat(MAX_SCENE_BYTES) } }).error, /too big/);
  assert.match(answer(p, { op: 'format-disk' }).error, /Unknown/);
  assert.equal(answer(p, null).ok, false);
  assert.deepEqual(Object.keys(p.files).sort(), ['scenes/bad name.json', 'scenes/sub/deep.json', 'scenes/yard.json', 'src/main.js']);
});

test('a damaged scene file is an error message, not a crash', () => {
  const p = fakeProject({ 'scenes/broken.json': '{ nope' });
  assert.equal(answer(p, { op: 'load', name: 'broken' }).ok, false);
});

test('the editor side turns replies into values and errors', async () => {
  const p = fakeProject();
  const store = new BridgeSceneStore(async (m) => answer(p, m));
  const scene = { format: 'engine-scene', version: 1, name: 'x', entities: [] };
  await store.save('a', scene);
  assert.deepEqual(await store.list(), [{ name: 'a' }]);
  assert.deepEqual(await store.load('a'), scene);
  await assert.rejects(() => store.load('missing'), /no scene/);
  await store.remove('a');
  assert.deepEqual(await store.list(), []);
  await assert.rejects(() => new BridgeSceneStore(async () => undefined).list(), /did not answer/);
});
