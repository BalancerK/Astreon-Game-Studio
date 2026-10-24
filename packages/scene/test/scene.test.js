import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World, defineComponent } from '../../core/src/index.js';
import { PrefabLibrary, ComponentRegistry, PrefabSpawner, Transform, TransformSystem } from '../../prefab/src/index.js';
import { AssetManager, basicLoaders } from '../../assets/src/index.js';
import { SceneDocument, loadScene, validateScene, migrateScene, emptyScene, SceneError, normalizeScene } from '../src/index.js';

const Health = defineComponent('health', { hp: 'f32', max: 'f32' });
const PREFABS = [
  { name: 'crate', components: { transform: {}, health: { hp: 40, max: 40 } }, params: { hp: 'components.health.hp' } },
  { name: 'lamp', components: { transform: {} } },
  { name: 'room', components: { transform: {} }, children: [{ name: 'light', prefab: 'lamp', local: { y: 3 } }] },
];
function setup() {
  const library = new PrefabLibrary(new ComponentRegistry().add(Health)).define(PREFABS);
  const world = new World(1024);
  const spawner = new PrefabSpawner(world, library);
  return { library, world, spawner };
}
const near = (a, b, eps = 1e-5) => assert.ok(Math.abs(a - b) <= eps, `${a} is not within ${eps} of ${b}`);
const pos = (world, e) => { const d = world.data(Transform), i = e & 0xfffff; return [d.x[i], d.y[i], d.z[i]]; };

const SCENE = {
  format: 'engine-scene', version: 1, name: 'Test', settings: { gravity: -9.8 },
  entities: [
    { id: 'room-1', prefab: 'room', at: { x: 10, z: 5 } },
    { id: 'crate-1', prefab: 'crate', at: { x: 1 }, params: { hp: 7 }, parent: 'room-1' },
    { id: 'crate-2', prefab: 'crate', at: { x: -3, y: 2 } },
  ],
};

test('a scene spawns its entities; children come after their parents and are placed relative to them, wherever they are in the file', async () => {
  const { world, spawner } = setup();
  const shuffled = { ...SCENE, entities: [SCENE.entities[1], SCENE.entities[2], SCENE.entities[0]] };
  const scene = await loadScene(shuffled, spawner);
  assert.equal(scene.instances.size, 3); assert.equal(scene.settings.gravity, -9.8);
  assert.equal(world.data(Health).hp[scene.get('crate-1').root & 0xfffff], 7, 'parameters');
  new TransformSystem().update(world);
  const d = world.data(Transform);
  const crate = scene.get('crate-1').root & 0xfffff, room = scene.get('room-1').root & 0xfffff;
  near(d.x[room], 10); near(d.z[room], 5);
  near(d.x[crate], 11, 1e-6); near(d.z[crate], 5, 1e-6); // placed at x = 1 inside the room at (10, 5)
  assert.equal(scene.get('crate-1').sceneId, 'crate-1'); assert.equal(scene.idOf(scene.get('crate-2')), 'crate-2');
  assert.throws(() => scene.get('nope'), /has no entity "nope"/);
});

test('an offset moves the top-level entities; unload removes everything and is safe to repeat', async () => {
  const { world, spawner } = setup();
  const scene = await loadScene(SCENE, spawner, { offset: { x: 100 } });
  near(pos(world, scene.get('crate-2').root)[0], 97);
  const before = spawner.instances.size; assert.equal(before, 3);
  scene.unload(); scene.unload();
  assert.equal(spawner.instances.size, 0);
});

test('all problems in a scene are reported together, before anything spawns', async () => {
  const { spawner, library } = setup();
  const bad = {
    format: 'engine-scene', version: 1,
    entities: [
      { id: 'a', prefab: 'crat' }, { id: 'a', prefab: 'crate' }, { id: 'b bad', prefab: 'crate' },
      { id: 'c', prefab: 'crate', params: { speed: 1 }, at: { x: 'far', rotation: [1] } }, { id: 'd', prefab: 'crate', parent: 'e' }, { id: 'e', prefab: 'crate', parent: 'd' },
      { id: 'f', prefab: 'crate', parent: 'ghost', colour: 'red' },
    ],
  };
  const problems = validateScene(bad, { library });
  const text = problems.map((p) => `${p.path}: ${p.message}`).join('\n');
  for (const want of [/entities\[0\]\.prefab: no prefab called "crat" \(did you mean "crate"\?\)/, /entities\[1\]\.id: "a" is used twice/, /entities\[2\]\.id: needs an id/, /entities\[3\]\.params\.speed: prefab "crate" has no parameter "speed"/, /entities\[3\]\.at\.x: must be a finite number/, /at\.rotation: must be four numbers/, /is its own ancestor/, /entities\[6\]\.parent: no entity called "ghost"/, /entities\[6\]\.colour: unknown field/]) assert.match(text, want);
  assert.equal(problems.find((p) => p.path.endsWith('colour')).severity, 'warning');
  await assert.rejects(loadScene(bad, spawner), (e) => e instanceof SceneError && e.problems.length >= 7 && /scene "Untitled" has \d+ problems/.test(e.message));
  assert.equal(spawner.instances.size, 0);
  assert.deepEqual(validateScene(SCENE, { library }), []);
  assert.equal(validateScene({ format: 'nope' })[0].path, 'format');
});

test('scene-local prefabs and assets: assets load first and are held until the scene unloads', async () => {
  const { spawner } = setup();
  const files = { 'sky.json': { sky: 1 }, 'music.txt': 'la' };
  const calls = [];
  const assets = new AssetManager({ fetch: async (u) => { calls.push(u); return files[u] === undefined ? new Response('x', { status: 404 }) : new Response(typeof files[u] === 'string' ? files[u] : JSON.stringify(files[u])); } }).registerAll(basicLoaders());
  const data = { ...SCENE, assets: [{ type: 'json', path: 'sky.json' }, { path: 'music.txt', type: 'text' }], prefabs: [{ name: 'boss', extends: 'crate', components: { health: { hp: 999, max: 999 } } }], entities: [{ id: 'boss-1', prefab: 'boss' }] };
  const seen = [];
  const scene = await loadScene(data, spawner, { assets, onProgress: (p) => seen.push(p.loaded) });
  assert.deepEqual(seen, [1, 2]); assert.deepEqual(assets.get('json', 'sky.json'), { sky: 1 });
  assert.equal(assets.peek('json', 'sky.json').refs, 1);
  scene.unload();
  assert.equal(assets.peek('json', 'sky.json').refs, 0); assert.equal(assets.collect(), 2);
  const missing = { ...data, assets: [{ type: 'json', path: 'gone.json' }] };
  await assert.rejects(loadScene(missing, spawner, { assets }), /gone\.json/);
  assert.equal(spawner.instances.size, 0, 'a failed load leaves nothing behind');
});

test('older scenes are upgraded step by step; newer or foreign files are refused', () => {
  assert.throws(() => migrateScene({ format: 'engine-scene', version: 9 }), /newer editor/);
  assert.throws(() => migrateScene({ hello: 1 }), /not a scene file/);
  const n = normalizeScene({ format: 'engine-scene', version: 1, entities: [{ id: 'a', prefab: 'crate' }] });
  assert.equal(n.entities[0].parent, null); assert.deepEqual(n.assets, []);
});

// ---- the editing model ----
const doc = (o) => new SceneDocument(SCENE, o);
const ids = (d) => d.order.join(',');

test('add / remove / reparent keep the hierarchy valid, in order, and refuse impossible edits', () => {
  const { library } = setup();
  const d = doc({ library });
  assert.equal(d.add({ prefab: 'lamp', at: { y: 4 } }), 'lamp-1');
  assert.equal(d.add({ prefab: 'lamp', parent: 'room-1' }), 'lamp-2');
  assert.equal(ids(d), 'room-1,crate-1,lamp-2,crate-2,lamp-1', 'a child goes right after its parent\'s subtree');
  assert.throws(() => d.add({ prefab: 'lampp' }), /no prefab called "lampp"/);
  assert.throws(() => d.add({ prefab: 'lamp', id: 'lamp-1' }), /already an entity/);
  assert.throws(() => d.add({ prefab: 'lamp', parent: 'ghost' }), /no entity "ghost"/);
  assert.throws(() => d.reparent('room-1', 'crate-1'), /cannot be placed inside itself/);
  d.reparent('crate-2', 'room-1', { before: 'crate-1' });
  assert.equal(ids(d), 'room-1,crate-2,crate-1,lamp-2,lamp-1');
  assert.deepEqual(d.children('room-1'), ['crate-2', 'crate-1', 'lamp-2']);
  assert.deepEqual(d.remove('room-1'), ['room-1', 'crate-2', 'crate-1', 'lamp-2']); assert.equal(ids(d), 'lamp-1');
  assert.deepEqual(d.validate(), []);
  const e = doc({ library }); e.remove('room-1', { keepChildren: true });
  assert.equal(e.get('crate-1').parent, null); assert.equal(ids(e), 'crate-1,crate-2');
});

test('every edit undoes and redoes exactly, including order, renames and scene settings', () => {
  const { library } = setup();
  const d = doc({ library });
  const start = JSON.stringify(d.toJSON());
  const states = [start];
  const step = (fn) => { fn(); states.push(JSON.stringify(d.toJSON())); };
  step(() => d.add({ prefab: 'crate', at: { x: 9 } }));
  step(() => d.update('crate-2', { at: { x: 5 }, params: { hp: 3 } }));
  step(() => d.set('crate-2', 'overrides.components.health.max', 80));
  step(() => d.rename('room-1', 'hall'));
  step(() => d.duplicate('hall', { offset: { x: 20 } }));
  step(() => d.reparent('crate-3', 'hall'));
  step(() => d.setSettings({ gravity: null, sky: 'night' }));
  step(() => d.addAsset('json', 'sky.json'));
  step(() => d.remove('crate-2'));
  step(() => d.setName('Renamed'));
  assert.equal(d.children('hall').join(), 'crate-1,light'.replace('light', 'crate-3').replace('crate-1,crate-3', 'crate-1,crate-3'));
  for (let i = states.length - 2; i >= 0; i--) { assert.ok(d.undo()); assert.equal(JSON.stringify(d.toJSON()), states[i], `undo to state ${i}`); }
  assert.equal(d.undo(), false);
  for (let i = 1; i < states.length; i++) { assert.ok(d.redo()); assert.equal(JSON.stringify(d.toJSON()), states[i], `redo to state ${i}`); }
  assert.equal(d.redo(), false);
  d.undo(); d.add({ prefab: 'lamp' }); assert.equal(d.canRedo, false, 'a new edit drops the redo history');
});

test('duplicating copies the whole subtree under fresh ids, with the children pointing at the copies', () => {
  const d = doc();
  const copy = d.duplicate('room-1', { offset: { x: 5 } });
  assert.equal(copy, 'room-2');
  assert.deepEqual(d.children('room-2').length, 1);
  const child = d.get(d.children('room-2')[0]);
  assert.notEqual(child.id, 'crate-1'); assert.equal(child.parent, 'room-2'); assert.deepEqual(child.params, { hp: 7 });
  assert.equal(d.get('room-2').at.x, 15); assert.equal(d.get('room-1').at.x, 10, 'the original is untouched');
  assert.equal(d.get('room-2').parent, null);
  d.get('room-2').at.x = 0; assert.equal(d.get('room-1').at.x, 10);
});

test('dragging is one undo step, a batch is one undo step, and a failing batch changes nothing', () => {
  const d = doc();
  const before = JSON.stringify(d.toJSON());
  for (let x = 0; x < 30; x++) d.update('crate-2', { at: { x } }, { merge: 'drag' });
  assert.equal(d.undoStack.length, 1); assert.equal(d.get('crate-2').at.x, 29);
  d.undo(); assert.equal(JSON.stringify(d.toJSON()), before);
  d.redo();
  d.batch('Build a corner', () => { d.add({ prefab: 'crate', id: 'k1' }); d.add({ prefab: 'crate', id: 'k2', parent: 'k1' }); d.update('k1', { at: { x: 1 } }); });
  assert.equal(d.undoStack.length, 2);
  const mid = JSON.stringify(d.toJSON());
  assert.throws(() => d.batch('Broken', () => { d.remove('k2'); d.update('crate-1', { at: { x: 99 } }); d.add({ prefab: 'crate', id: 'k1' }); }), /already an entity/);
  assert.equal(JSON.stringify(d.toJSON()), mid, 'rolled back'); assert.equal(d.undoStack.length, 2);
  d.undo(); assert.equal(d.has('k1'), false);
  d.update('crate-1', { at: { x: 7 } }, { merge: 'drag' }); d.update('crate-2', { at: { x: 1 } }, { merge: 'drag' });
  assert.equal(d.undoStack.length, 3, 'different entities are different drags');
});

test('dirty follows the saved point; change events say what changed', () => {
  const d = doc();
  const events = []; const off = d.onChange((e) => events.push(`${e.kind}:${e.label}:${e.ids.join('+')}`));
  assert.equal(d.dirty, false);
  d.update('crate-2', { at: { x: 1 } }); assert.equal(d.dirty, true);
  d.markSaved(); assert.equal(d.dirty, false);
  d.undo(); assert.equal(d.dirty, true); d.redo(); assert.equal(d.dirty, false);
  d.update('crate-2', { at: { x: 1 } }); assert.equal(d.undoStack.length, 1, 'no change, no step');
  assert.deepEqual(events, ['edit:Change crate-2:crate-2', 'undo:Change crate-2:crate-2', 'redo:Change crate-2:crate-2']);
  off(); d.update('crate-2', { at: { x: 2 } }); assert.equal(events.length, 3);
});

test('an edited scene saves to a file that loads into the game as edited', async () => {
  const { library, world, spawner } = setup();
  const d = doc({ library });
  d.add({ prefab: 'crate', id: 'extra', at: { x: 50 }, params: { hp: 1 } });
  d.update('crate-2', { at: { y: null } });
  const file = JSON.parse(JSON.stringify(d.toJSON()));
  const scene = await loadScene(file, spawner);
  assert.equal(scene.instances.size, 4); near(pos(world, scene.get('extra').root)[0], 50);
  assert.equal(world.data(Health).hp[scene.get('extra').root & 0xfffff], 1);
  assert.equal(emptyScene('x').entities.length, 0);
});

test('an editor keeps notes with the scene (the 3D cursor): saved in the file, not an edit, not undone, and absent when empty', async () => {
  const { SceneDocument, emptyScene, validateScene, normalizeScene } = await import('../src/index.js');
  const doc = new SceneDocument(emptyScene('Notes'));
  assert.equal('editor' in doc.toJSON(), false, 'a scene nobody left notes in has no editor key');
  doc.add({ id: 'a', prefab: 'x' }, {});
  const steps = doc.undoStack.length;
  const dirty = doc.dirty;
  doc.setEditor('cursor', { position: [1, 2, 3] });
  assert.equal(doc.dirty, dirty, 'a note does not make the scene changed');
  assert.equal(doc.undoStack.length, steps, 'and is not an undo step');
  assert.deepEqual(doc.toJSON().editor, { cursor: { position: [1, 2, 3] } });
  doc.undo();
  assert.deepEqual(doc.editor.cursor, { position: [1, 2, 3] }, 'undo leaves it alone');
  const copy = new SceneDocument(JSON.parse(JSON.stringify(doc.toJSON())));
  assert.deepEqual(copy.editor.cursor, { position: [1, 2, 3] }, 'it comes back when the file is opened');
  doc.setEditor('cursor', null);
  assert.equal('editor' in doc.toJSON(), false, 'forgetting the last note takes the key away');
  assert.deepEqual(normalizeScene({ format: 'engine-scene', version: 1, entities: [], editor: { a: 1 } }).editor, { a: 1 });
  assert.equal(validateScene({ format: 'engine-scene', version: 1, entities: [], editor: 5 }).some((p) => p.path === 'editor'), true, 'it has to be an object');
  const note = { cursor: { position: [1, 2, 3] } };
  doc.setEditor('cursor', note.cursor);
  note.cursor.position[0] = 99;
  assert.equal(doc.editor.cursor.position[0], 1, 'the note is a copy');
});
