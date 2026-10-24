import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve, join } from 'node:path';
import { TEMPLATES } from '../app/store/templates.js';
import { withSceneModules } from '../export/scene-modules.js';
import { buildWebExport } from '../export/export.js';
import { createLibrary, describe } from '../scene3d/library.js';
import { SceneDocument } from '../../packages/scene/src/index.js';

const KIT = pathToFileURL(resolve('packages/arcade/src/index.js')).href;
const files = TEMPLATES.hall3d.files;

async function loadGame(project) {
  const modules = withSceneModules(project);
  const scene = modules['scenes/hall.json.js'].replace('export default ', 'const hall = ').trim();
  const main = modules['src/main.js'].replace("'@engine/arcade'", JSON.stringify(KIT)).replace(/import hall from [^\n]+\n/, `${scene}\n`);
  return import(`data:text/javascript;base64,${Buffer.from(main).toString('base64')}`);
}

const canvas = () => new Proxy({}, {
  get: (t, k) => (k === 'createLinearGradient' ? () => ({ addColorStop() {} }) : () => {}),
  set: () => true,
});

test('a scene file gets a module for a game to import, and nothing else is touched', () => {
  const out = withSceneModules({ 'src/main.js': 'x', 'scenes/hall.json': files['scenes/hall.json'], 'scenes/notes.json': '{"a":1}', 'scenes/bad.json': '{oops' });
  assert.ok(out['scenes/hall.json.js'].startsWith('export default {'));
  assert.equal(Object.keys(out).filter((p) => p.endsWith('.json.js')).length, 1, 'only real scenes');
  assert.equal(JSON.parse(out['scenes/hall.json.js'].replace(/^export default |;\s*$/g, '')).name, 'Hall');
  const plain = { 'src/main.js': 'x' };
  assert.equal(withSceneModules(plain), plain, 'no scene: the same object comes back');
  assert.equal(withSceneModules({ 'scenes/hall.json': files['scenes/hall.json'], 'scenes/hall.json.js': 'mine' })['scenes/hall.json.js'], 'mine');
});

test('the scene of the hall is a valid scene for the 3D panel (every block is one the panel knows, with no problems)', () => {
  const doc = new SceneDocument(JSON.parse(files['scenes/hall.json']), { library: createLibrary() });
  assert.ok(doc.size >= 20);
  assert.deepEqual(doc.validate?.().filter?.((p) => p.level === 'error') ?? [], []);
  assert.ok(describe({ extras: { shape: { type: 'box' } } }));
});

test('the hall template runs as a game: it starts at the start marker, draws, and every gem can be picked up', async () => {
  const game = await loadGame(files);
  const state = game.create();
  assert.deepEqual([state.cam.x, state.cam.z], [0, 9]);
  assert.equal(state.total, 5);
  for (let i = 0; i < 60 * 3; i++) game.update(state, new Set(['KeyW']), 1 / 60);
  assert.ok(state.walked > 5 && state.cam.z < 8 && state.cam.z > -12);
  for (const gem of [...state.gems]) { state.cam.x = gem.x; state.cam.z = gem.z; game.update(state, new Set(), 1 / 60); }
  assert.equal(state.gems.length, 0);
  assert.equal(game.summary(state).gemsLeft, 0);
  assert.doesNotThrow(() => game.render(state, canvas()));
});

test('changing the scene changes the game: a removed gem and a moved start show up after a restart', async () => {
  const scene = JSON.parse(files['scenes/hall.json']);
  scene.entities = scene.entities.filter((e) => e.id !== 'gem-5');
  scene.entities.find((e) => e.id === 'start').at = { x: 4, y: 0.3, z: 5, yaw: 1 };
  const game = await loadGame({ ...files, 'scenes/hall.json': JSON.stringify(scene) });
  const state = game.create();
  assert.equal(state.total, 4);
  assert.deepEqual([state.cam.x, state.cam.z, state.cam.yaw], [4, 5, 1]);
});

test('an export of the project carries the scene module and the loader', async () => {
  const root = resolve('.');
  const readEngine = async (path) => { const f = join(root, 'packages', path); return existsSync(f) ? readFileSync(f, 'utf8') : null; };
  const built = await buildWebExport({
    files, title: 'Hall', readEngine, runtime: readFileSync(join(root, 'studio/export/runtime.js'), 'utf8'),
    controls: readFileSync(join(root, 'studio/runner/controls.js'), 'utf8'),
  });
  assert.ok('game/scenes/hall.json.js' in built.files, 'the module is in the export');
  assert.ok('engine/arcade/src/scene3d.js' in built.files && 'engine/arcade/src/view3d.js' in built.files, 'and the kit pieces it needs');
  assert.deepEqual(built.report.missing, []);
});

test('the hall from a scene has the guardian and the mouse too, and starts the guardian well away from where you begin', async () => {
  const game = await loadGame(files);
  const state = game.create();
  assert.equal(state.lives, 3);
  assert.ok(state.guardian.z < state.cam.z - 15);
  game.update(state, new Set(['Mouse:0:0']), 1 / 60);
  game.update(state, new Set(['Mouse:-100:0']), 1 / 60);
  assert.ok(state.cam.yaw > 0.2);
  state.guardian = { x: state.cam.x, z: state.cam.z - 0.3 };
  game.update(state, new Set(), 1 / 60);
  assert.equal(state.lives, 2);
  assert.deepEqual([state.cam.x, state.cam.z], [0, 9], 'back at the start marker');
});

test('the gem on the platform can be reached by walking up the ramp', async () => {
  const game = await loadGame(files);
  const state = game.create();
  const gem = state.gems.find((g) => g.x === 8 && g.z === -2);
  assert.ok(gem, 'the gem is on the platform');
  state.cam.x = 8;
  state.cam.z = 4;
  state.cam.yaw = 0;
  for (let i = 0; i < 60 * 4; i++) game.update(state, new Set(['KeyW']), 1 / 60);
  assert.ok(state.gems.every((g) => !(g.x === 8 && g.z === -2)), 'picked up');
  assert.ok(state.cam.y - state.cam.eye > 0.9 || state.cam.z < -2, 'having climbed to the platform');
});
