// The scene editor for the physics playground: `npm run editor`, then open the printed address. It edits scenes/*.json (the same files
// the game loads with ?scene=yard), previews prefabs from their data, and runs a scene for real with Play.
import { startEditor, HttpSceneStore } from '../../packages/editor/src/browser.js';
import { createLibrary } from './prefabs.js';
import { buildPlayground } from './scene.js';
import { createDrawer } from './draw.js';

const params = new URLSearchParams(location.search);
const drawer = createDrawer();
const level = buildPlayground({ scene: { format: 'engine-scene', version: 1, entities: [] } }); // only for the ground and walls it draws

window.__editor = await startEditor({
  title: 'Physics playground',
  library: createLibrary(),
  scenes: new HttpSceneStore('/__scenes'),
  scene: params.get('scene') ?? 'yard',
  renderer: params.get('renderer') ?? undefined,
  hidePrefabs: ['thing', 'chain_link'],
  scenery: (list) => drawer.drawLevel(list, level.statics),
  createRuntime(scene) {
    const play = buildPlayground({ scene });
    window.__play = play;
    return { step: (dt) => { play.tick(dt); play.world.step(dt); }, draw: (list) => drawer.drawBodies(list, play.world), dispose() { window.__play = null; } };
  },
});
