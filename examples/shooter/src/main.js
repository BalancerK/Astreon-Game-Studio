// The page: draws the arena in 3D, reads the keyboard / mouse / gamepad, runs the rules at a fixed rate, plays sound, and draws the HUD on top.
// WASD move, mouse look (click to capture the mouse), left click fire, R reload, Space jump, Shift run.
// Enter starts and restarts. A gamepad works too.
//
// Nothing here decides anything about the game: it calls `step` from game.js and turns the events that come back
// (shot, hit, kill, hurt, wave...) into sound, sparks and screen shake.
import { FixedLoop } from '../../../packages/core/src/index.js';
import { vec3, quat } from '../../../packages/math/src/index.js';
import {
  createRenderer3D, createRenderer, Camera3D, Camera, DrawList3D, createLighting, ParticleBatch,
  createBox, createSphere, createCapsule, Atlas, SpriteBatch, Font, packTint,
} from '../../../packages/render/src/index.js';
import { createInput } from '../../../packages/input/src/index.js';
import { AudioEngine, onUserGesture, sfx } from '../../../packages/audio/src/index.js';
import { SaveGame, LocalStorageStorage, valueSection } from '../../../packages/save/src/index.js';
import { createGame, step, eyeOf, CFG, DT } from './game.js';

const params = new URLSearchParams(location.search);
const stage = document.getElementById('stage');

// ---- the 3D view, and a 2D renderer on a transparent canvas stacked over it for the HUD ----
const renderer3d = await createRenderer3D({ prefer: params.get('renderer') ? [params.get('renderer')] : undefined });
stage.append(renderer3d.canvas);

const atlas = new Atlas({ size: 512 });
const dot = atlas.add('dot', 8, 8, (g, x, y, w, h) => {
  g.fillStyle = '#fff';
  g.fillRect(x, y, w, h);
});
const fontOptions = { family: 'system-ui, sans-serif', weight: 'bold', scale: devicePixelRatio || 1 };
const font = new Font(atlas, { ...fontOptions, size: 20 });
const big = new Font(atlas, { ...fontOptions, size: 44 });
const hud = await createRenderer({ atlas, prefer: [renderer3d.kind === 'webgpu' ? 'webgpu' : 'webgl2'], transparent: true });
stage.append(hud.canvas);
hud.canvas.style.cssText = 'position:absolute;inset:0;pointer-events:none';

const camera = new Camera3D({ fovY: 1.2, far: 200 });
const screen = new Camera();
const hudBatch = new SpriteBatch(2048);
const list = new DrawList3D();
const particles = new ParticleBatch(512);

function resize() {
  const w = innerWidth;
  const h = innerHeight;
  const dpr = devicePixelRatio || 1;
  renderer3d.resize(w, h, dpr);
  hud.resize(w, h, dpr);
  camera.setViewport(w, h);
  screen.setScreenSpace(w, h);
}
addEventListener('resize', resize);
resize();

// ---- meshes: everything is a box, a sphere or a capsule, tinted ----
const box = createBox(1, 1, 1);
const ball = createSphere(0.5, 14, 10);
const capsule = createCapsule(0.5, 1.8, 14, 6);

// ---- controls: what the player can do, and which controls do it ----
const key = (code) => ({ type: 'key', code });
const pad = (button) => ({ type: 'gamepadButton', button });
const { input } = createInput({
  element: renderer3d.canvas,
  pointerLock: true,
  actions: {
    move: {
      type: 'vector2',
      bindings: [{ type: 'keys2d', up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD' }, { type: 'gamepadStick', stick: 'left' }],
    },
    look: {
      type: 'vector2',
      bindings: [{ type: 'mouseDelta', sensitivity: 0.0022 }, { type: 'gamepadStick', stick: 'right', sensitivity: 2.6 }],
    },
    fire: { type: 'button', bindings: [{ type: 'mouseButton', button: 0 }, pad('rightTrigger')] },
    jump: { type: 'button', bindings: [key('Space'), pad('south')] },
    reload: { type: 'button', bindings: [key('KeyR'), pad('west')] },
    run: { type: 'button', bindings: [key('ShiftLeft'), pad('leftStick')] },
    start: { type: 'button', bindings: [key('Enter'), pad('start')] },
  },
});
stage.addEventListener('click', () => {
  // refused in some embedded pages: then the mouse just does not look
  Promise.resolve(renderer3d.canvas.requestPointerLock?.()).catch(() => {});
});

// ---- the best score is kept in the browser ----
const best = { score: 0, wave: 0, wins: 0 };
const saves = new SaveGame({ game: 'shooter', version: 1, storage: new LocalStorageStorage('shooter:') });
saves.section('best', valueSection(() => best, (d) => { Object.assign(best, d); }));
try {
  await saves.load('best');
} catch {
  /* nothing saved yet */
}

// ---- sound: made in code, started after the first key press or click (browsers insist) ----
let audio = null;
const sounds = {};
onUserGesture(() => {
  audio = new AudioEngine();
  const made = {
    shot: sfx.shot(), enemyShot: sfx.shot(3), hit: sfx.hit(), ping: sfx.ping(), kill: sfx.explosion(),
    hurt: sfx.land(), reload: sfx.click(), empty: sfx.click(), pickup: sfx.coin(), wave: sfx.alarm(), aim: sfx.click(),
  };
  for (const [name, spec] of Object.entries(made)) sounds[name] = audio.createSound(spec, name);
});

/** Play a sound. Given a position it comes from there in the world, otherwise it is heard evenly. */
function play(name, at, volume = 1) {
  if (!audio || !sounds[name]) return;
  const options = at
    ? { position: at, refDistance: 4, maxDistance: 60, volume, pitchVariation: 0.05 }
    : { volume, pitchVariation: 0.03 };
  audio.play(sounds[name], options);
}

// ---- the game, and what is only for show (tracers, sparks, shake) ----
let mode = 'title'; // title, play, end
let game = null;
let view = { yaw: 0, pitch: 0 };
let tracers = [];
let sparks = [];
let flashes = [];
let hurtMarks = [];
let banner = { text: '', time: 0 };
let hitMarker = 0;
let kick = 0;
let shake = 0;
let muzzle = 0;

const light = {
  ...createLighting(),
  direction: [0.35, 0.9, 0.25],
  color: [0.4, 0.42, 0.5],
  ambientSky: [0.2, 0.23, 0.3],
  ambientGround: [0.08, 0.08, 0.09],
  fogColor: [0.07, 0.08, 0.11],
  fogDensity: 0.012,
  pointLights: [],
};

function start() {
  const seed = Number(params.get('seed')) || (Date.now() & 0xffffff);
  game = createGame({ seed });
  view = { yaw: game.player.yaw, pitch: 0 };
  tracers = [];
  sparks = [];
  flashes = [];
  hurtMarks = [];
  mode = 'play';
  banner = { text: 'Get ready', time: 1.6 };
  window.__shooter.game = game;
}

function burst(at, count, speed, rgb, life = 0.45, size = 0.05) {
  for (let i = 0; i < count; i++) {
    sparks.push({
      x: at[0], y: at[1], z: at[2],
      vx: (Math.random() - 0.5) * speed,
      vy: Math.random() * speed * 0.7,
      vz: (Math.random() - 0.5) * speed,
      life, max: life, rgb, size,
    });
  }
}

/** One event from the rules becomes sound and effects. */
function react(e) {
  switch (e.e) {
    case 'shot':
      play('shot');
      tracers.push({ a: e.from, b: e.to, life: 0.07 });
      muzzle = 0.06;
      kick = Math.min(0.06, kick + 0.02);
      break;
    case 'impact':
      burst(e.at, 5, 3, [1, 0.8, 0.5], 0.3, 0.03);
      break;
    case 'hit':
      play('ping');
      burst(e.at, e.killed ? 4 : 7, 4, e.head ? [1, 0.9, 0.3] : [1, 0.45, 0.2]);
      hitMarker = e.killed ? 0.35 : 0.15;
      break;
    case 'kill':
      play('kill', e.at, 0.7);
      burst(e.at, 30, 7, [1, 0.6, 0.25], 0.7, 0.09);
      flashes.push({ x: e.at[0], y: e.at[1], z: e.at[2], life: 0.25, max: 0.25, color: [1, 0.55, 0.2] });
      if (e.head) banner = { text: 'HEADSHOT', time: 0.8 };
      break;
    case 'aim':
      play('aim', e.at, 0.6);
      break;
    case 'enemyShot':
      play('enemyShot', e.from, 0.8);
      tracers.push({ a: e.from, b: e.to, life: 0.08, enemy: true });
      break;
    case 'melee':
      play('hurt', undefined, 0.6);
      break;
    case 'hurt':
      play('hurt');
      shake = Math.min(0.3, 0.12 + e.dmg * 0.01);
      hurtMarks.push({ from: e.from, life: 1.2 });
      break;
    case 'reload':
      play('reload');
      break;
    case 'reloaded':
      play('reload', undefined, 0.7);
      break;
    case 'empty':
      play('empty', undefined, 0.5);
      break;
    case 'pickup':
      play('pickup');
      banner = { text: e.kind === 'health' ? '+ health' : '+ ammo', time: 0.8 };
      break;
    case 'drop':
      burst(e.at, 8, 2, e.kind === 'health' ? [0.4, 1, 0.5] : [1, 0.9, 0.4], 0.8, 0.05);
      break;
    case 'wave':
      play('wave', undefined, 0.5);
      banner = { text: `Wave ${e.n}`, time: 1.8 };
      break;
    case 'clear':
      banner = { text: `Wave ${e.n} cleared`, time: 2 };
      break;
    case 'win':
      banner = { text: 'YOU WIN', time: 99 };
      finish(true);
      break;
    case 'over':
      banner = { text: 'DEAD', time: 99 };
      finish(false);
      break;
  }
}

function finish(won) {
  if (game.score > best.score) best.score = game.score;
  best.wave = Math.max(best.wave, game.wave);
  if (won) best.wins++;
  saves.save('best').catch(() => {});
  document.exitPointerLock?.();
}

// the rules run 60 times a second whatever the frame rate
const loop = new FixedLoop({
  tickRate: 1 / DT,
  update() {
    if (mode !== 'play') return;
    const move = input.vector('move');
    const events = step(game, {
      mx: move.x,
      mz: move.y,
      yaw: view.yaw,
      pitch: view.pitch,
      fire: input.held('fire'),
      jump: input.held('jump'),
      reload: input.held('reload'),
      run: input.held('run'),
    });
    for (const e of events) react(e);
  },
});

// ---- drawing the world ----
const q = [0, 0, 0, 1];
const fwd = [0, 0, 0];
const rgt = [0, 0, 0];
const ENEMY = { grunt: [0.35, 0.45, 0.7], rusher: [0.75, 0.25, 0.22] };

/** Add one tinted mesh to this frame's draw list. */
function part(mesh, x, y, z, size, color, rotation = null) {
  list.addTransform(mesh, x, y, z, rotation, size[0], size[1], size[2], color[0], color[1], color[2]);
}

function drawEnemies() {
  const player = game.player.ctl;
  for (const enemy of game.enemies) {
    const c = enemy.ctl;
    const rusher = enemy.type === 'rusher';
    const flash = enemy.flash > 0 ? 0.6 : 0;      // white for a moment when hit
    const aiming = enemy.windup > 0;              // the eye glows red while it aims
    const base = ENEMY[enemy.type];
    const body = [base[0] + flash, base[1] + flash, base[2] + flash];
    const dx = player.x - c.x;
    const dz = player.z - c.z;
    const d = Math.hypot(dx, dz) || 1;
    const width = rusher ? 0.9 : 1.1;
    part(capsule, c.x, c.y - 0.1, c.z, [width, 0.95, width], body);
    part(ball, c.x, c.y + 0.8, c.z, [0.5, 0.5, 0.5], [body[0] * 0.8, body[1] * 0.8, body[2] * 0.8]);
    const eye = aiming ? [3, 0.4, 0.2] : [1.2, 1.1, 0.3];
    part(ball, c.x + (dx / d) * 0.2, c.y + 0.85, c.z + (dz / d) * 0.2, [0.18, 0.14, 0.18], eye);
  }
}

function drawPickups(now) {
  for (const k of game.pickups) {
    const bob = Math.sin(now * 0.004 + k.x) * 0.12;
    const color = k.kind === 'health' ? [0.3, 1, 0.45] : [1, 0.85, 0.3];
    part(box, k.x, 0.55 + bob, k.z, [0.4, 0.4, 0.4], color, quat.fromYawPitchRoll(q, now * 0.002, 0, 0));
    particles.push(k.x, 0.55 + bob, k.z, 0.5, color[0], color[1], color[2], 0.35, 0, 0, 0, 0, 0, 1, 0, 0);
  }
}

/** The rifle in the corner of the view: a few boxes placed in front of the camera, following where it looks. */
function drawRifle(eye) {
  vec3.forward(fwd, camera.yaw, camera.pitch);
  vec3.right(rgt, camera.yaw);
  quat.fromYawPitchRoll(q, camera.yaw, camera.pitch, 0);
  const player = game.player;
  const dip = player.reloading > 0 ? Math.sin((1 - player.reloading / CFG.gun.reload) * Math.PI) * 0.25 : 0;
  const at = (forward, right, up) => [
    eye[0] + fwd[0] * forward + rgt[0] * right,
    eye[1] + fwd[1] * forward + up - dip,
    eye[2] + fwd[2] * forward + rgt[2] * right,
  ];
  const recoil = kick * 3;
  let a = at(0.7 - recoil, 0.24, -0.2);
  part(box, a[0], a[1], a[2], [0.05, 0.07, 0.38], [0.18, 0.19, 0.22], q);       // barrel
  a = at(0.55 - recoil, 0.26, -0.29);
  part(box, a[0], a[1], a[2], [0.045, 0.13, 0.07], [0.12, 0.12, 0.14], q);      // grip
  if (muzzle > 0) {
    a = at(1.0, 0.26, -0.22);
    particles.push(a[0], a[1], a[2], 0.09, 1, 0.8, 0.4, 0.9, 0, 0, 0, 0, Math.random() * 6, 1, 0.3, 0);
  }
}

function drawEffects() {
  for (const t of tracers) {
    const mid = [(t.a[0] + t.b[0]) / 2, (t.a[1] + t.b[1]) / 2, (t.a[2] + t.b[2]) / 2];
    const along = [t.b[0] - t.a[0], t.b[1] - t.a[1], t.b[2] - t.a[2]];
    const c = t.enemy ? [1, 0.3, 0.2] : [1, 0.9, 0.6];
    const size = t.enemy ? 0.05 : 0.025;
    particles.push(mid[0], mid[1], mid[2], size, c[0], c[1], c[2], 0.8, along[0], along[1], along[2], 0.5, 0, 1, 1, 1);
  }
  for (const s of sparks) {
    const fade = s.life / s.max;
    particles.push(s.x, s.y, s.z, s.size, s.rgb[0], s.rgb[1], s.rgb[2], fade, 0, 0, 0, 0, 0, 1, 0.5, 0);
  }
}

/** The lamps of the arena, plus a flash at the muzzle and at each explosion. */
function setLights(eye) {
  light.pointLights = game.arena.lights.map((l) => ({ ...l, intensity: 0.7 }));
  if (muzzle > 0) {
    light.pointLights.push({ x: eye[0] + fwd[0], y: eye[1] + fwd[1], z: eye[2] + fwd[2], radius: 8, color: [1, 0.75, 0.4], intensity: 1.8 });
  }
  for (const f of flashes) {
    light.pointLights.push({ x: f.x, y: f.y, z: f.z, radius: 9, color: f.color, intensity: 2.5 * (f.life / f.max) });
  }
}

/** Age every effect by one frame. */
function updateEffects(frameDt) {
  const dt = Math.min(0.05, frameDt);
  for (const s of sparks) {
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    s.z += s.vz * dt;
    s.vy -= 9 * dt;
    s.life -= dt;
  }
  sparks = sparks.filter((s) => s.life > 0 && s.y > 0);
  tracers = tracers.filter((t) => (t.life -= dt) > 0);
  flashes = flashes.filter((f) => (f.life -= dt) > 0);
  hurtMarks = hurtMarks.filter((m) => (m.life -= dt) > 0);
  muzzle = Math.max(0, muzzle - dt);
  hitMarker = Math.max(0, hitMarker - dt);
  kick = Math.max(0, kick - dt * 0.25);
  shake = Math.max(0, shake - dt * 0.6);
  banner.time -= dt;
}

function drawWorld(now, frameDt) {
  const eye = eyeOf(game.player);
  const jitterX = shake ? (Math.random() - 0.5) * shake * 0.1 : 0;
  const jitterY = shake ? (Math.random() - 0.5) * shake * 0.1 : 0;
  camera.x = eye[0];
  camera.y = eye[1];
  camera.z = eye[2];
  camera.yaw = view.yaw + jitterX;
  camera.pitch = view.pitch + kick + jitterY;

  list.clear();
  particles.clear();
  for (const p of game.arena.parts) part(box, p.x, p.y, p.z, [p.sx, p.sy, p.sz], p.color);
  drawEnemies();
  drawPickups(now);
  drawRifle(eye);
  drawEffects();
  setLights(eye);
  renderer3d.render({ camera, list, particles, clear: [0.05, 0.06, 0.09, 1], lighting: light, shadows: true, post: true });
  updateEffects(frameDt);
}

// ---- drawing the HUD ----
const say = (text, x, y, align = 'left', f = font) => f.draw(hudBatch, text, x, y, { align, shadow: { dx: 1, dy: 1 } });

function bar(x, y, w, h, fraction, rgb) {
  hudBatch.push(x + w / 2, y + h / 2, w + 4, h + 4, 0, dot, packTint(0, 0, 0, 150));
  hudBatch.push(x + (w * fraction) / 2, y + h / 2, Math.max(0, w * fraction), h, 0, dot, packTint(rgb[0], rgb[1], rgb[2], 230));
}

/** Four ticks around the middle of the screen; red, with a cross, for a moment after a hit. */
function drawCrosshair(cx, cy) {
  const gap = 6 + kick * 120;
  const len = 9;
  const hit = hitMarker > 0;
  const c = hit ? packTint(255, 70, 60, 255) : packTint(255, 255, 255, 210);
  hudBatch.push(cx - gap - len / 2, cy, len, 2, 0, dot, c);
  hudBatch.push(cx + gap + len / 2, cy, len, 2, 0, dot, c);
  hudBatch.push(cx, cy - gap - len / 2, 2, len, 0, dot, c);
  hudBatch.push(cx, cy + gap + len / 2, 2, len, 0, dot, c);
  if (!hit) return;
  for (const side of [-1, 1]) {
    hudBatch.push(cx + side * 12, cy - 12, 2, 8, 0.8 * side, dot, packTint(255, 60, 50));
    hudBatch.push(cx + side * 12, cy + 12, 2, 8, -0.8 * side, dot, packTint(255, 60, 50));
  }
}

/** A red mark on a circle around the crosshair, towards whoever hurt you. */
function drawHurtMarks(cx, cy) {
  const player = game.player.ctl;
  const forwardX = -Math.sin(view.yaw);
  const forwardZ = -Math.cos(view.yaw);
  for (const m of hurtMarks) {
    const dx = m.from[0] - player.x;
    const dz = m.from[1] - player.z;
    const d = Math.hypot(dx, dz) || 1;
    const right = (dx / d) * Math.cos(view.yaw) - (dz / d) * Math.sin(view.yaw);
    const up = -((dx / d) * forwardX + (dz / d) * forwardZ);
    const angle = Math.atan2(up, right) + Math.PI / 2;
    hudBatch.push(cx + right * 110, cy + up * 110, 34, 8, angle, dot, packTint(255, 40, 40, Math.min(255, m.life * 255)));
  }
}

function drawPlayingHud(W, H) {
  const p = game.player;
  drawCrosshair(W / 2, H / 2);
  drawHurtMarks(W / 2, H / 2);
  bar(20, H - 40, 220, 14, p.hp / CFG.player.hp, p.hp > 35 ? [90, 220, 120] : [230, 70, 60]);
  say(`${Math.ceil(p.hp)}`, 250, H - 46);
  say(p.reloading > 0 ? 'reloading...' : `${p.mag} / ${p.reserve}`, W - 20, H - 46, 'right');
  const robots = game.enemies.length + game.queue.length;
  say(`Wave ${Math.max(1, game.wave)}/${CFG.waves.total}   Score ${game.score}   Robots ${robots}`, 20, 14);
  if (banner.time > 0) say(banner.text, W / 2, H * 0.22, 'center', big);
  if (mode === 'play' && game.status !== 'playing') mode = 'end';
}

function drawTitleHud(W, H) {
  const cx = W / 2;
  const cy = H / 2;
  say('SHOOTER', cx, cy - 120, 'center', big);
  say('Five waves of robots. Click the game to capture the mouse, then press Enter.', cx, cy - 50, 'center');
  say('WASD move   Mouse aim   Left click fire   R reload   Space jump   Shift run', cx, cy - 20, 'center');
  say(best.score ? `Best score ${best.score}   Furthest wave ${best.wave}   Wins ${best.wins}` : 'No best score yet', cx, cy + 30, 'center');
}

function drawEndHud(W, H) {
  const accuracy = game.shots ? Math.round((100 * game.hits) / game.shots) : 0;
  const result = game.status === 'won' ? 'Victory' : 'Game over';
  say(`${result}   score ${game.score}   kills ${game.kills}   headshots ${game.headshots}   accuracy ${accuracy}%`, W / 2, H / 2 + 20, 'center');
  say(`Best score ${best.score}.  Press Enter to play again`, W / 2, H / 2 + 52, 'center');
}

function drawHud() {
  hudBatch.clear();
  const W = innerWidth;
  const H = innerHeight;
  if (mode === 'title') drawTitleHud(W, H);
  else drawPlayingHud(W, H);
  if (mode === 'end') drawEndHud(W, H);
  hud.render({ camera: screen, batch: hudBatch });
}

// ---- every frame ----
let last = performance.now();
function frame(now) {
  const frameDt = Math.min(0.1, (now - last) / 1000);
  last = now;
  input.update(frameDt);
  if (mode === 'play') {
    const look = input.vector('look');
    view.yaw -= look.x;
    view.pitch = Math.max(-1.5, Math.min(1.5, view.pitch + look.y));
  }
  if (mode !== 'play' && input.pressed('start')) start();
  loop.advance(frameDt);
  if (game) {
    drawWorld(now, frameDt);
  } else {
    list.clear();
    renderer3d.render({ camera, list, clear: [0.05, 0.06, 0.09, 1], lighting: light });
  }
  drawHud();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// for tests and the console
window.__shooter = {
  game: null,
  get mode() { return mode; },
  get view() { return view; },
  best,
  renderer3d,
  start,
};
