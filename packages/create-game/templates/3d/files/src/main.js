// The page: loads the scene through the asset manager (so a build can hash and cache it), runs it, and draws it with an orbit camera.
import { createRenderer3D, Camera3D, DrawList3D, createLighting, createBox, createSphere } from '@engine/render';
import { AssetManager, basicLoaders, inlineManifest } from '@engine/assets';
import { createPlay } from './play.js';

const renderer = await createRenderer3D({});               // WebGPU, else WebGL2
document.getElementById('stage').append(renderer.canvas);

// A built page carries a manifest of hashed file names; running from source there is none and paths are used as they are.
const { manifest, base } = inlineManifest();
const assets = new AssetManager({ base, manifest }).registerAll(basicLoaders());
const sceneJson = await assets.load('json', 'scenes/main.json');
const play = createPlay(sceneJson);

const meshes = { unitBox: createBox(1, 1, 1), unitSphere: createSphere(0.5, 24, 14) };
const camera = new Camera3D({ fovY: 1, far: 500 }), list = new DrawList3D();
const light = { ...createLighting(), direction: [0.4, 1, 0.3] };
const orbit = { yaw: 0.6, pitch: 0.5, distance: 18, target: [0, 1.5, 0] };

function resize() { renderer.resize(innerWidth, innerHeight, devicePixelRatio || 1); camera.setViewport(innerWidth, innerHeight); }
addEventListener('resize', resize); resize();

let drag = null;
renderer.canvas.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY }; renderer.canvas.setPointerCapture(e.pointerId); });
renderer.canvas.addEventListener('pointermove', (e) => {
  if (!drag) return;
  orbit.yaw -= (e.clientX - drag.x) * 0.006; orbit.pitch = Math.max(0.05, Math.min(1.5, orbit.pitch + (e.clientY - drag.y) * 0.005));
  drag = { x: e.clientX, y: e.clientY };
});
renderer.canvas.addEventListener('pointerup', () => { drag = null; });
renderer.canvas.addEventListener('wheel', (e) => {
  orbit.distance = Math.max(4, Math.min(80, orbit.distance * (1 + Math.sign(e.deltaY) * 0.1)));
  e.preventDefault();
}, { passive: false });

let last = performance.now(), acc = 0;
function frame(now) {
  acc += Math.min(0.1, (now - last) / 1000); last = now;
  while (acc >= 1 / 60) { play.step(1 / 60); acc -= 1 / 60; }       // fixed timestep
  const cp = Math.cos(orbit.pitch);
  camera.x = orbit.target[0] + Math.sin(orbit.yaw) * cp * orbit.distance;
  camera.y = orbit.target[1] + Math.sin(orbit.pitch) * orbit.distance;
  camera.z = orbit.target[2] + Math.cos(orbit.yaw) * cp * orbit.distance;
  camera.yaw = orbit.yaw; camera.pitch = -orbit.pitch; camera.update();
  list.clear(); list.setCamera(camera);
  play.draw(list, meshes);
  renderer.render({ camera, list, clear: [0.55, 0.7, 0.85, 1], lighting: light, shadows: { size: 2048, radius: 40 } });
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
window.__play = play;   // handy in the browser console and for tests
