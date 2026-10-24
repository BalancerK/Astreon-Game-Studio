// The scene editor for this game: `npm run dev`, then open /editor.html. It edits scenes/*.json, shows your prefabs from their data,
// and Play runs the scene with exactly the code the game uses (src/play.js).
import { startEditor, HttpSceneStore } from '@engine/editor/src/browser.js';
import { createLibrary } from './prefabs.js';
import { createPlay } from './play.js';

window.__editor = await startEditor({
  title: '{{title}}',
  library: createLibrary(),
  scenes: new HttpSceneStore('/__scenes'),
  scene: 'main',
  hidePrefabs: ['thing'],
  // how a prefab looks in the editor: read it from the same components the game draws
  describe(spec) {
    const s = spec.components?.shape, c = spec.components?.colour;
    if (!s) return null;
    const color = c ? [c.r, c.g, c.b] : [0.7, 0.7, 0.7];
    if (s.kind === 'sphere') return { shape: { type: 'sphere', radius: s.sx / 2 }, color };
    return { shape: { type: 'box', hx: s.sx / 2, hy: s.sy / 2, hz: s.sz / 2 }, color };
  },
  createRuntime(scene) {
    const play = createPlay(scene);
    return { step: (dt) => play.step(dt), draw: (list, meshes) => play.draw(list, meshes), dispose: () => play.dispose() };
  },
});
