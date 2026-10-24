// Physics 3D: a playground for the rigid-body physics (boxes, balls, capsules, joints, a kinematic paddle, a trigger zone, sleeping).
// Drag to orbit, wheel to zoom, Space (or click) shoots a heavy ball, 1 / 2 / 3 rain crates / balls / capsules, R resets.
import {
  createRenderer3D, createRenderer, Camera3D, Camera, DrawList3D, createLighting,
  Atlas, SpriteBatch, Font, packTint,
} from '../../packages/render/src/index.js';
import { buildPlayground } from './scene.js';
import { createDrawer } from './draw.js';
import { SaveGame, AutoSaver, LocalStorageStorage } from '../../packages/save/src/index.js';

const params = new URLSearchParams(location.search);
const stage = document.getElementById('stage');
const renderer3d = await createRenderer3D({ prefer: params.get('renderer') ? [params.get('renderer')] : undefined, antialias: params.get('aa') !== '0' });
stage.append(renderer3d.canvas);
const atlas = new Atlas({ size: 512 });
const dot = atlas.add('dot', 8, 8, (g, x, y, w, h) => { g.fillStyle = '#fff'; g.fillRect(x, y, w, h); });
const font = new Font(atlas, { family: 'ui-monospace, Consolas, monospace', size: 13, weight: 'bold', scale: devicePixelRatio || 1 });
const hud = await createRenderer({ atlas, prefer: [renderer3d.kind === 'webgpu' ? 'webgpu' : 'webgl2'], transparent: true });
hud.canvas.id = 'hud';
stage.append(hud.canvas);

// `?scene=yard` builds the level from scenes/yard.json (what the scene editor edits); without it the same level is built by code
const sceneName = params.get('scene');
const play = buildPlayground({ scene: sceneName ? await (await fetch(`./scenes/${encodeURIComponent(sceneName)}.json`)).json() : undefined });
const { world } = play;
const camera = new Camera3D({ fovY: 1.0, far: 300 });
const list = new DrawList3D();
const light = { ...createLighting(), direction: [0.4, 1, 0.3], fogDensity: 0.004 };
const orbit = { yaw: 0.5, pitch: 0.45, distance: 30, tx: 0, ty: 2, tz: 0 };
const screen = new Camera();
const hudBatch = new SpriteBatch(512);

function resize() {
  const w = innerWidth, h = innerHeight, dpr = devicePixelRatio || 1;
  renderer3d.resize(w, h, dpr); hud.resize(w, h, dpr); camera.setViewport(w, h);
}
addEventListener('resize', resize);
resize();

const drawer = createDrawer();

// ---- input ----
let dragging = false, lastX = 0, lastY = 0, dragged = 0;
stage.addEventListener('pointerdown', (e) => { dragging = true; lastX = e.clientX; lastY = e.clientY; dragged = 0; stage.setPointerCapture(e.pointerId); });
stage.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  orbit.yaw -= (e.clientX - lastX) * 0.006; orbit.pitch = Math.max(0.05, Math.min(1.5, orbit.pitch + (e.clientY - lastY) * 0.005));
  dragged += Math.abs(e.clientX - lastX) + Math.abs(e.clientY - lastY);
  lastX = e.clientX; lastY = e.clientY;
});
stage.addEventListener('pointerup', () => { dragging = false; if (dragged < 6) shoot(); });
stage.addEventListener('wheel', (e) => { orbit.distance = Math.max(6, Math.min(80, orbit.distance * (1 + Math.sign(e.deltaY) * 0.1))); e.preventDefault(); }, { passive: false });
function cameraForward() {
  const cp = Math.cos(camera.pitch);
  return [-Math.sin(camera.yaw) * cp, Math.sin(camera.pitch), -Math.cos(camera.yaw) * cp];
}
// everything you add by hand is a prefab too, so it is saved with the rest
function shoot() {
  const f = cameraForward();
  play.spawn('cannonball', { x: camera.x + f[0] * 2, y: camera.y + f[1] * 2, z: camera.z + f[2] * 2 }, { overrides: { 'extras.body.velocity': [f[0] * 40, f[1] * 40, f[2] * 40] } });
}
let seed = 12345;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
function rain(kind) {
  for (let i = 0; i < 12; i++) {
    const at = { x: orbit.tx + (rnd() - 0.5) * 10, y: 12 + rnd() * 6, z: orbit.tz + (rnd() - 0.5) * 10, rotation: [rnd() - 0.5, rnd() - 0.5, rnd() - 0.5, 1] };
    const colour = { r: 0.4 + rnd() * 0.6, g: 0.4 + rnd() * 0.6, b: 0.4 + rnd() * 0.6 };
    const spin = [rnd() * 4, rnd() * 4, rnd() * 4];
    if (kind === 1) play.spawn('crate', at, { params: { mass: 4 }, overrides: { 'components.colour': colour, 'extras.body.shape': { type: 'box', hx: 0.3 + rnd() * 0.2, hy: 0.3 + rnd() * 0.2, hz: 0.3 + rnd() * 0.2 } } });
    else if (kind === 2) play.spawn('ball', at, { overrides: { 'components.colour': colour, 'extras.body.restitution': 0.5, 'extras.body.shape': { type: 'sphere', radius: 0.25 + rnd() * 0.25 } } });
    else play.spawn('pill', at, { overrides: { 'components.colour': colour } });
    const inst = play.spawned[play.spawned.length - 1];
    inst.data.bodies.get('').setAngularVelocity(...spin);
  }
}

// ---- saving: F5 quicksave, F9 quickload, an autosave every 30 s (F10 loads the newest); kept in the browser's localStorage ----
const saves = play.attach(new SaveGame({ game: 'physics3d', version: 1, storage: new LocalStorageStorage('physics3d:'), compress: true }));
const autosaver = new AutoSaver(saves, { every: 30, onError: (e) => note(`autosave failed: ${e.message}`) });
let message = '', messageUntil = 0;
const note = (m) => { message = m; messageUntil = performance.now() + 3500; };
async function quickSave() { try { const r = await saves.quicksave(); note(`saved ${play.spawned.length} prefabs and ${world.bodies.length} bodies (${(r.bytes / 1024).toFixed(0)} KB)`); } catch (e) { note(`save failed: ${e.message}`); } }
async function quickLoad(slot = 'quick') { try { await saves.load(slot); note(`loaded ${slot}`); } catch (e) { note(e.code === 'missing' ? 'nothing saved yet (F5 saves)' : `load failed: ${e.message}`); } }
addEventListener('keydown', (e) => {
  if (e.code === 'Space') { shoot(); e.preventDefault(); }
  else if (e.code === 'KeyR') play.reset();
  else if (e.code === 'F5') { quickSave(); e.preventDefault(); } else if (e.code === 'F9') { quickLoad(); e.preventDefault(); } else if (e.code === 'F10') { quickLoad('auto-1'); e.preventDefault(); }
  else if (e.code === 'Digit1') rain(1); else if (e.code === 'Digit2') rain(2); else if (e.code === 'Digit3') rain(3);
});

// ---- loop: physics at 60 Hz, drawing every frame ----
const DT = 1 / 60;
let acc = 0, last = performance.now(), stepMs = 0, fps = 0, frames = 0, fpsClock = last;
function frame(now) {
  acc += Math.min(0.1, (now - last) / 1000); last = now;
  const t0 = performance.now();
  let steps = 0;
  while (acc >= DT) { play.tick(DT); world.step(DT); saves.tick(DT); autosaver.tick(DT); acc -= DT; steps++; }
  if (steps > 0) stepMs += ((performance.now() - t0) / steps - stepMs) * 0.1;
  camera.x = orbit.tx + Math.sin(orbit.yaw) * Math.cos(orbit.pitch) * orbit.distance;
  camera.y = orbit.ty + Math.sin(orbit.pitch) * orbit.distance;
  camera.z = orbit.tz + Math.cos(orbit.yaw) * Math.cos(orbit.pitch) * orbit.distance;
  camera.yaw = orbit.yaw; camera.pitch = -orbit.pitch;
  camera.update();
  list.clear();
  list.setCamera(camera);
  drawer.drawAll(list, play);
  renderer3d.render({ camera, list, clear: [0.62, 0.72, 0.84, 1], lighting: light, shadows: { size: 2048, radius: 40 } });
  frames++;
  if (now - fpsClock >= 500) { fps = (frames * 1000) / (now - fpsClock); frames = 0; fpsClock = now; }
  hudBatch.clear();
  screen.setScreenSpace(innerWidth, innerHeight);
  const lines = [
    `${renderer3d.kind}  ${fps.toFixed(0)} fps   physics ${stepMs.toFixed(2)} ms/step`,
    `${world.bodies.length} bodies: ${world.stats.awake} awake, ${world.stats.asleep} asleep   ${world.stats.contacts} contacts   ${play.inside.size} in the trigger zone   door: ${play.door.state}`,
    'drag orbit   wheel zoom   Space / click shoot   1 crates  2 balls  3 capsules   R reset   F5 save  F9 load',
    ...(performance.now() < messageUntil ? [message] : []),
  ];
  lines.forEach((t, i) => font.draw(hudBatch, t, 12, 10 + i * 16, { shadow: { dx: 1, dy: 1 } }));
  hud.render({ camera: screen, batch: hudBatch });
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
window.__physics = { world, play, saves, quickSave, quickLoad, orbit, camera, renderer3d, shoot, rain, get fps() { return fps; } };
