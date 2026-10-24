// The page inside the studio's 3D scene panel: the engine's scene editor, keeping its scenes in the project through the studio (bridge.js).
import { startEditor } from '../../packages/editor/src/browser.js';
import { createLibrary, describe, HIDDEN } from './library.js';
import { BridgeSceneStore } from './bridge.js';
import { emptyScene } from '../../packages/scene/src/index.js';
import { createPlayRuntime } from './play.js';

const pending = new Map();
let next = 1;
const request = (message) => new Promise((resolve) => {
  const id = next++;
  pending.set(id, resolve);
  parent.postMessage({ source: 'scene3d', t: 'request', id, message }, location.origin);
});
addEventListener('message', (e) => {
  if (e.source !== parent || e.origin !== location.origin || e.data?.source !== 'studio') return;
  if (e.data.t === 'reply') {
    pending.get(e.data.id)?.(e.data.reply);
    pending.delete(e.data.id);
  }
});

const params = new URLSearchParams(location.search);
try {
  const scenes = new BridgeSceneStore(request);
  const names = await scenes.list().catch(() => []);
  if (!names.length && !params.get('scene')) {                       // a first scene to work in, so Save needs no questions
    await scenes.save('main', emptyScene('main'));
    names.push({ name: 'main' });
  }
  window.__editor = await startEditor({
    title: '3D scene',
    library: createLibrary(),
    scenes,
    scene: params.get('scene') ?? names[0]?.name ?? 'main',
    describe,
    hidePrefabs: HIDDEN,
    keymap: 'blender',                                                  // G R S with the mouse, Shift+D, the number pad views (press ? in the editor)
    createRuntime: (scene, { library }) => createPlayRuntime(scene, { library, describe }),            // Play: walk around the scene
    renderer: params.get('renderer') ?? undefined,
  });
  parent.postMessage({ source: 'scene3d', t: 'ready' }, location.origin);
} catch (error) {
  document.body.innerHTML = '';
  const p = document.createElement('p');
  p.id = 'problem';
  p.textContent = `The 3D editor could not start: ${error?.message ?? error}. It needs a browser with WebGPU or WebGL2.`;
  document.body.append(p);
  parent.postMessage({ source: 'scene3d', t: 'failed', error: String(error?.message ?? error) }, location.origin);
}
