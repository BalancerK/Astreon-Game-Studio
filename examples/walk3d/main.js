// Walk 3D: a first-person walk around a test level. One person, no network: it exercises the 3D math, collision and
// rendering packages together. WASD to move, mouse to look (click to capture the mouse), Space to jump, Shift to run.
import { CharacterController } from '../../packages/physics/src/index.js';
import { vec3 } from '../../packages/math/src/index.js';
import {
  createRenderer3D, createRenderer, Camera3D, Camera, DrawList3D, createLighting, Atlas, SpriteBatch, Font, packTint,
} from '../../packages/render/src/index.js';
import { buildLevel } from './level.js';

const params = new URLSearchParams(location.search);
const stage = document.getElementById('stage');
const prefer3d = params.get('renderer') ? [params.get('renderer')] : undefined;
const renderer3d = await createRenderer3D({ prefer: prefer3d, antialias: params.get('aa') !== '0' });
stage.append(renderer3d.canvas);

// the HUD is a 2D renderer on a transparent canvas stacked over the 3D view
const atlas = new Atlas({ size: 512 });
const dot = atlas.add('dot', 8, 8, (g, x, y, w, h) => { g.fillStyle = '#fff'; g.fillRect(x, y, w, h); });
const font = new Font(atlas, { family: 'ui-monospace, Consolas, monospace', size: 13, weight: 'bold', scale: devicePixelRatio || 1 });
const hud = await createRenderer({ atlas, prefer: [renderer3d.kind === 'webgpu' ? 'webgpu' : 'webgl2'], transparent: true });
stage.append(hud.canvas);
hud.canvas.id = 'hud';

const { world, parts, spawn } = buildLevel();
const player = new CharacterController({ x: spawn[0], y: spawn[1], z: spawn[2] });
const camera = new Camera3D({ fovY: 1.15, far: 400 });
const list = new DrawList3D();
const light = { ...createLighting(), fogDensity: 0.006 };
const look = { yaw: 0, pitch: 0 };

function resize() {
  const w = innerWidth, h = innerHeight, dpr = devicePixelRatio || 1;
  renderer3d.resize(w, h, dpr);
  hud.resize(w, h, dpr);
  camera.setViewport(w, h);
}
addEventListener('resize', resize);
resize();

// ---- input ----
const keys = new Set();
addEventListener('keydown', (e) => { keys.add(e.code); if (e.code === 'Space') e.preventDefault(); });
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());
addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== renderer3d.canvas && document.pointerLockElement !== hud.canvas) return;
  look.yaw -= e.movementX * 0.0025;
  look.pitch = Math.max(-1.5, Math.min(1.5, look.pitch - e.movementY * 0.0025));
});
stage.addEventListener('click', () => stage.requestPointerLock?.());

// ---- simulation at a fixed 60 Hz, rendering every frame ----
const DT = 1 / 60;
let acc = 0, last = performance.now(), fps = 0, frames = 0, fpsClock = last;
const fwd = [0, 0, 0], right = [0, 0, 0];
function step() {
  const run = keys.has('ShiftLeft') || keys.has('ShiftRight');
  const speed = run ? 8 : 4.5;
  const f = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
  const s = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
  vec3.forward(fwd, look.yaw, 0); vec3.right(right, look.yaw);
  let wx = fwd[0] * f + right[0] * s, wz = fwd[2] * f + right[2] * s;
  const len = Math.sqrt(wx * wx + wz * wz);
  if (len > 1) { wx /= len; wz /= len; }
  player.update(world, wx * speed, wz * speed, keys.has('Space'), DT);
}

const screen = new Camera();
const hudBatch = new SpriteBatch(1024);
function drawHud() {
  hudBatch.clear();
  screen.setScreenSpace(innerWidth, innerHeight);
  const cx = innerWidth / 2, cy = innerHeight / 2;
  hudBatch.push(cx, cy, 14, 2, 0, dot, packTint(255, 255, 255, 200));
  hudBatch.push(cx, cy, 2, 14, 0, dot, packTint(255, 255, 255, 200));
  const lines = [
    `${renderer3d.kind}   ${fps.toFixed(0)} fps`,
    `feet ${player.feetY.toFixed(2)} m   ${player.grounded ? 'on ground' : 'in the air'}${player.blocked ? ' (blocked)' : ''}`,
    'WASD move   Shift run   Space jump   click: capture mouse',
  ];
  lines.forEach((t, i) => font.draw(hudBatch, t, 12, 10 + i * 16, { shadow: { dx: 1, dy: 1 } }));
  hud.render({ camera: screen, batch: hudBatch });
}

function frame(now) {
  acc += Math.min(0.1, (now - last) / 1000);
  last = now;
  while (acc >= DT) { step(); acc -= DT; }
  camera.x = player.x; camera.y = player.y + 0.7; camera.z = player.z;
  camera.yaw = look.yaw; camera.pitch = look.pitch;
  list.clear();
  for (const p of parts) list.addTransform(p.mesh, p.x, p.y, p.z, null, p.sx, p.sy, p.sz, p.color[0], p.color[1], p.color[2]);
  renderer3d.render({ camera, list, clear: [0.62, 0.72, 0.84, 1], lighting: light });
  frames++;
  if (now - fpsClock >= 500) { fps = (frames * 1000) / (now - fpsClock); frames = 0; fpsClock = now; }
  drawHud();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// for tests and tinkering from the console
window.__walk = { player, look, world, camera, renderer3d, hud, step };
