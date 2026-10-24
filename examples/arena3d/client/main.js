// Browser front end for the 3D arena: WebGPU/WebGL2 view, mouse look, prediction of your own movement and shots.
// WASD move, mouse look (click to capture), Space jump, Shift run, left mouse fires.
import {
  createRenderer3D, createRenderer, Camera3D, Camera, DrawList3D, createLighting, nearestLights, createBox, createSphere, createMeshFromTriangles,
  Atlas, SpriteBatch, Font, packTint, TextureSet, proceduralTexture,
} from '../../../packages/render/src/index.js';
import { connectWebSocket } from '../../../packages/transport/src/index.js';
import { quat, mat4 } from '../../../packages/math/src/index.js';
import { Arena3dClient } from './net.js';
import { createCharacter, SKIN_COLOR, DARK_COLOR } from './character.js';
import { CharacterRig } from './locomotion.js';
import { createArenaAudio } from './sound.js';
import { onUserGesture } from '../../../packages/audio/src/index.js';
import { createInput, shooterTouchLayout } from '../../../packages/input/src/index.js';
import { Ui, createSpritePainter, createTheme, attachDom, menuActions, createMenuPump } from '../../../packages/ui/src/index.js';
import { createArenaMenus } from './menus.js';
import { createArenaEffects } from './effects.js';
import { createSampleBuffer, sampleWorld } from './interp.js';
import { netSchema, BUTTON_FIRE, BUTTON_JUMP, BUTTON_RUN, BODY } from '../shared/game.js';
import { EVENT } from '../shared/events.js';

const params = new URLSearchParams(location.search);
const stage = document.getElementById('stage');
const renderer3d = await createRenderer3D({ prefer: params.get('renderer') ? [params.get('renderer')] : undefined, antialias: params.get('aa') !== '0' });
stage.append(renderer3d.canvas);

// the HUD is a 2D renderer on a transparent canvas stacked over the 3D view
const atlas = new Atlas({ size: 1024 });
const dot = atlas.add('dot', 8, 8, (g, x, y, w, h) => { g.fillStyle = '#fff'; g.fillRect(x, y, w, h); });
const font = new Font(atlas, { family: 'ui-monospace, Consolas, monospace', size: 13, weight: 'bold', scale: devicePixelRatio || 1 });
const hud = await createRenderer({ atlas, prefer: [renderer3d.kind === 'webgpu' ? 'webgpu' : 'webgl2'], transparent: true });
hud.canvas.id = 'hud';
stage.append(hud.canvas);

// ?room=alpha joins (or creates) the room "alpha"; the default room is "lobby". If the connection drops, the client retries with
// backoff and presents its session token, so the server gives back the same character.
const wsUrl = params.get('ws') ?? `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/${encodeURIComponent(params.get('room') ?? 'lobby')}`;
const client = new Arena3dClient({ url: wsUrl, reconnect: { createTransport: () => connectWebSocket(wsUrl) }, predict: params.get('predict') !== '0', predictShots: params.get('predictshots') !== '0' }).start();
const healthComp = netSchema.comps[4], hpField = healthComp.fields[0];

// ---- scene ----
const boxMesh = createBox(1, 1, 1), sparkMesh = createSphere(0.5, 8, 6);
// other players: a skinned humanoid per player, posed every frame from what the network says about them
const character = createCharacter();
const rigs = new Map(); // entity id -> {rig, seen}
const modelMatrix = new Float64Array(16), yawQuat = [0, 0, 0, 1];
const stats = { playersCulled: 0 };
let frameNo = 0, prevNow = performance.now(), frameDt = 1 / 60;
function drawPlayer(i) {
  const id = samples.ids[i];
  let entry = rigs.get(id);
  if (!entry) { entry = { rig: new CharacterRig(character), seen: 0 }; rigs.set(id, entry); }
  entry.seen = frameNo;
  if (!camera.sphereVisible(samples.x[i], samples.y[i], samples.z[i], 1.6)) { entry.rig.skip(); stats.playersCulled++; return; } // off screen: no pose, no draw
  const palette = entry.rig.update(frameDt, samples.x[i], samples.z[i], samples.yaw[i], samples.pitch[i], samples.grounded[i] !== 0);
  quat.fromYawPitchRoll(yawQuat, samples.yaw[i], 0, 0);
  mat4.compose(modelMatrix, samples.x[i], samples.y[i] - BODY.halfHeight, samples.z[i], yawQuat, 1, 1, 1); // the model's feet are at its origin
  const [r, g, b] = hue(samples.hue[i]);
  list.addSkinned(character.meshes.body, modelMatrix, palette, r, g, b);
  list.addSkinned(character.meshes.skin, modelMatrix, palette, SKIN_COLOR[0], SKIN_COLOR[1], SKIN_COLOR[2]);
  list.addSkinned(character.meshes.dark, modelMatrix, palette, DARK_COLOR[0], DARK_COLOR[1], DARK_COLOR[2]);
}
// Surfaces: tileable textures made in code (no image files), projected from the world so every box and ramp is covered without
// texture coordinates. ?textures=0 shows the plain colours.
const texturesOn = params.get('textures') !== '0';
const textures = new TextureSet({ size: 256, maxLayers: 8 });
const layer = { grass: textures.add(proceduralTexture('grass', 256, { seed: 4 }), 'grass'), brick: textures.add(proceduralTexture('brick', 256, { seed: 9 }), 'brick'), concrete: textures.add(proceduralTexture('concrete', 256, { seed: 2 }), 'concrete'), plates: textures.add(proceduralTexture('plates', 256, { seed: 6 }), 'plates') };
if (texturesOn) renderer3d.setTextures(textures);
function surfaceOf(p) { // which texture a part of the level gets, by what it is
  if (p.kind === 'quad') return { layer: layer.plates, scale: 0.25 };                                           // ramps
  if (p.hx === 60) return { layer: layer.grass, scale: 0.25 };                                                    // the ground
  if (p.hy === 4) return { layer: layer.brick, scale: 0.25 };                                                     // outer walls
  if (p.hy < 3 && (p.hz === 2.5 || p.hx === 2.2 || p.hx === 0.35)) return { layer: layer.plates, scale: 0.5 };    // platforms and stairs
  return { layer: layer.concrete, scale: 0.3 };                                                                   // tower, pillars, low walls
}
const parts = client.level.parts.map((p) => ({ ...surfaceOf(p), ...(p.kind === 'box'
  ? { mesh: boxMesh, x: p.x, y: p.y, z: p.z, sx: p.hx * 2, sy: p.hy * 2, sz: p.hz * 2, color: p.color }
  : { mesh: createMeshFromTriangles([...p.v.slice(0, 9), ...p.v.slice(0, 3), ...p.v.slice(6, 12)]), x: 0, y: 0, z: 0, sx: 1, sy: 1, sz: 1, color: p.color }) }));
const camera = new Camera3D({ fovY: 1.15, far: 400 });
const list = new DrawList3D();
const light = { ...createLighting(), fogDensity: 0.006 };
const shadowsOn = params.get('shadows') !== '0'; // ?shadows=0 turns the sun's shadows off
// shadows: three nested maps (very sharp near you, soft far away) or one; the settings screen switches between them. ?post=0 turns off bloom and tone mapping.
const shadowModes = [undefined, { size: 2048, radius: 50 }, { size: 2048, radius: 60, cascades: 3 }];
const postOn = params.get('post') !== '0';
const postOptions = { bloom: { threshold: 0.9, intensity: 0.45 }, tonemap: 'aces', exposure: 0.82, saturation: 1.2, contrast: 1.12, vignette: { strength: 0.3, radius: 0.6 } };
let clearColor = [0.62, 0.72, 0.84, 1];
// Verified mod presentation data (already whitelisted and range-checked by the client).
client.onModsLoaded = () => {
  const t = client.theme;
  if (t.sky) { clearColor = [t.sky[0] / 255, t.sky[1] / 255, t.sky[2] / 255, 1]; updateLampIntensity(); light.fogColor = clearColor.slice(0, 3); light.ambientSky = [clearColor[0] * 0.9 + 0.1, clearColor[1] * 0.9 + 0.1, clearColor[2] * 0.9 + 0.15]; }
  if (t.fog !== undefined) light.fogDensity = t.fog;
  if (t.title) document.title = t.title;
};
const samples = createSampleBuffer();

// Lamps on top of the pillars (decoration only: nothing in the simulation knows about them). They are faint by day and take over
// when a mod makes the sky dark.
const lamps = client.level.parts.filter((p) => p.kind === 'box' && p.hx === 1.2 && p.hy === 1.2)
  .map((p, i) => ({ x: p.x, y: p.y + p.hy + 1.3, z: p.z, radius: 12, color: i % 2 ? [1, 0.82, 0.55] : [0.6, 0.8, 1] }));
const bulbMesh = createSphere(0.5, 10, 8);
let lampIntensity = 0.3;
function updateLampIntensity() { const lum = 0.3 * clearColor[0] + 0.59 * clearColor[1] + 0.11 * clearColor[2]; lampIntensity = Math.max(0.3, Math.min(1.6, 1.8 * (1 - lum))); }
updateLampIntensity();

function hue(h) { // 0..255 -> an RGB colour with fixed saturation and value
  const k = (n) => (n + (h / 255) * 6) % 6;
  const f = (n) => 0.85 - 0.6 * Math.max(0, Math.min(k(n), 4 - k(n), 1));
  return [f(5), f(3), f(1)];
}

function resize() {
  const w = innerWidth, h = innerHeight, dpr = devicePixelRatio || 1;
  renderer3d.resize(w, h, dpr);
  hud.resize(w, h, dpr);
  camera.setViewport(w, h);
}
addEventListener('resize', resize);
resize();

// ---- input ---- (actions, not keys: the same game on keyboard and mouse, a gamepad, or a touch screen)
const look = { yaw: 0, pitch: 0 };
let forceFire = false; // tests and scripts can hold the trigger
let debug = params.get('debug') === '1';
const startedAt = performance.now();
const pad = { type: 'gamepadStick', stick: 'left' };
const { input, mouse: mouseInput } = createInput({
  element: stage,
  pointerLock: true,
  requireLock: true,
  contexts: { menu: { blocking: true } }, // while a menu is open the game's actions are silent
  // ?touch=1 shows the on-screen controls on any device; they appear by themselves on touch screens
  touch: params.get('touch') === '1' || matchMedia?.('(pointer: coarse)').matches ? shooterTouchLayout : false,
  actions: {
    move: { type: 'vector2', bindings: [
      { type: 'keys2d', up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD' }, { type: 'keys2d', up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' }, pad, { type: 'touchStick', id: 'move' },
    ] },
    look: { type: 'vector2', bindings: [{ type: 'mouseDelta', sensitivity: 0.0025 }, { type: 'gamepadStick', stick: 'right', sensitivity: 2.8 }, { type: 'touchLook', id: 'look', sensitivity: 0.005 }] },
    jump: { type: 'button', bindings: [{ type: 'key', code: 'Space' }, { type: 'gamepadButton', button: 'south' }, { type: 'touchButton', id: 'jump' }] },
    run: { type: 'button', bindings: [{ type: 'key', code: 'ShiftLeft' }, { type: 'key', code: 'ShiftRight' }, { type: 'gamepadButton', button: 'leftStick' }, { type: 'touchButton', id: 'run' }] },
    fire: { type: 'button', bindings: [{ type: 'mouseButton', button: 0 }, { type: 'gamepadButton', button: 'rightTrigger' }, { type: 'gamepadButton', button: 'rightBumper' }, { type: 'touchButton', id: 'fire' }] },
    debug: { type: 'button', bindings: [{ type: 'key', code: 'F3' }] },
    menu: { type: 'button', bindings: [{ type: 'key', code: 'Escape' }, { type: 'gamepadButton', button: 'start' }] },
    ...menuActions('menu'),
    mute: { type: 'button', bindings: [{ type: 'key', code: 'KeyM' }] },
    muteMusic: { type: 'button', bindings: [{ type: 'key', code: 'KeyN' }] },
  },
});
try { const saved = JSON.parse(localStorage.getItem('arena3d.bindings') ?? 'null'); if (saved) input.load(saved); } catch { /* no saved bindings, or storage is blocked */ }
// a click on the view captures the mouse (the first click is not a shot)
// (where the browser will not grant the lock, the mouse falls back to plain clicks and a pointer that turns the view as it moves)
stage.addEventListener('pointerdown', async (e) => {
  if (e.pointerType !== 'mouse' || mouseInput.locked) return;
  if (!(await mouseInput.lock())) { mouseInput.options.pointerLock = false; mouseInput.options.requireLock = false; }
});

// ---- sound ---- (made in code; starts at your first click or key press, as browsers require; ?audio=0 turns it off, M mutes, N mutes the music)
let sound = null;
const audioEnabled = params.get('audio') !== '0';
if (audioEnabled) { // the audio context is created at the first gesture: earlier, the browser would refuse it and complain
  onUserGesture(() => { try { sound = createArenaAudio(); menus?.applyAudio(); sound.startMusic(); } catch (e) { console.warn('no audio:', e.message); } });
}

// ---- menus ---- (@engine/ui drawn on the HUD canvas: pause menu, settings with key rebinding, room browser)
const uiFonts = new Map();
const uiFont = (size) => { // one font per pixel size, so menu text is crisp at any interface size
  const px = Math.max(8, Math.round(size));
  if (!uiFonts.has(px)) uiFonts.set(px, new Font(atlas, { family: 'system-ui, sans-serif', size: px, scale: devicePixelRatio || 1 }));
  return uiFonts.get(px);
};
const hudBatch = new SpriteBatch(4096);
const coarse = !!matchMedia?.('(pointer: coarse)').matches || params.get('touch') === '1';
const ui = new Ui({ painter: createSpritePainter({ batch: hudBatch, dot, fontFor: uiFont }), theme: createTheme() });
let menus = null;
const dom = attachDom(ui, stage, { scale: () => (menus?.settings.uiScale ?? 1) * (coarse ? 1.25 : 1) });
menus = createArenaMenus({ ui, input, mouse: mouseInput, getSound: () => sound, debug: (v) => { if (v !== undefined) debug = v; return debug; }, onScale: () => dom.resize() });
ui.onActiveChange = (active) => {
  if (active) { input.pushContext('menu'); input.releaseAll(); document.exitPointerLock?.(); } else input.popContext();
};
const menuPump = createMenuPump(ui, input);
// the browser takes the mouse back when Escape is pressed (and eats that key press): that is the player asking for the menu
let wasLocked = false;
document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement !== null;
  if (wasLocked && !locked && client.state === 'playing') menus.open();
  wasLocked = locked;
});

// ---- effects ---- (particles: muzzle flashes, impacts and bullet holes, hit bursts, dust, lamp halos; ?particles=0 turns them off)
const fx = createArenaEffects({ parts: client.level.parts, lamps });
fx.enabled = params.get('particles') !== '0';
let fxGrounded = true, fxFall = 0;
const tracers = [];
let hitFlash = -1e9, lastMessage = '';
const missColor = [1, 0.95, 0.5], hitColor = [1, 0.4, 0.3];
client.onPredictedShot = (s) => {
  tracers.push({ ...s, born: performance.now(), color: s.victim >= 0 ? hitColor : missColor });
  sound?.ownShot(); sound?.impact(s.x1, s.y1, s.z1);
  fx.shot({ ...s, hit: s.victim }, true);
};
client.onEvent = (e) => {
  if (e.kind === EVENT.SHOT) {
    tracers.push({ ...e, born: performance.now(), color: e.hit >= 0 ? hitColor : missColor });
    if (e.corrected) return; // the shot you already heard, as the server saw it
    fx.shot(e, e.shooter === client.selfId);
    if (e.shooter === client.selfId) sound?.ownShot(); else sound?.shotAt(e.x0, e.y0, e.z0);
    sound?.impact(e.x1, e.y1, e.z1);
  } else if (e.kind === EVENT.MESSAGE) { lastMessage = e.text; sound?.message(); }
};
client.onShotResult = (r) => { if (r.event.hit >= 0) { hitFlash = performance.now(); sound?.hitConfirm(); } };

// ---- loop: inputs and prediction at 60 Hz, rendering every frame ----
const DT = 1 / 60;
let acc = 0, last = performance.now(), fps = 0, frames = 0, fpsClock = last;
const moveVec = { x: 0, y: 0 }, lookVec = { x: 0, y: 0 };
/** One tick of input: read the actions, turn the view, send what the server needs. */
function sendInput() {
  input.update(DT);
  menuPump.update(DT);
  if (input.pressed('menu') && client.state === 'playing') menus.open();
  if (input.pressed('debug')) debug = !debug;
  if (input.pressed('mute')) sound?.toggleMute();
  if (input.pressed('muteMusic')) sound?.toggleMusic();
  if (client.state !== 'playing') return;
  input.vector('look', lookVec);
  look.yaw -= lookVec.x; // looking right turns clockwise: yaw is positive to the left
  look.pitch = Math.max(-1.5, Math.min(1.5, look.pitch + lookVec.y));
  input.vector('move', moveVec);
  const b = (input.held('jump') ? BUTTON_JUMP : 0) | (input.held('run') ? BUTTON_RUN : 0) | (input.held('fire') || forceFire ? BUTTON_FIRE : 0);
  client.sendInput(moveVec.x, moveVec.y, b, look.yaw, look.pitch);
}

const screen = new Camera();
const pos = { x: 0, y: 0, z: 0 };
function selfHp() {
  const snap = client.history.latest();
  const row = snap ? snap.rowOf(client.selfId) : -1;
  return row < 0 ? 100 : hpField.codec.dequantize(snap.vals[row * netSchema.fieldCount + hpField.col]);
}
function drawHud(now) {
  hudBatch.clear();
  screen.setScreenSpace(innerWidth, innerHeight);
  const cx = innerWidth / 2, cy = innerHeight / 2;
  const flash = now - hitFlash < 150;
  const c = flash ? packTint(255, 90, 70, 255) : packTint(255, 255, 255, 200);
  const gap = flash ? 9 : 5;
  hudBatch.push(cx - gap - 6, cy, 12, 2, 0, dot, c); hudBatch.push(cx + gap + 6, cy, 12, 2, 0, dot, c);
  hudBatch.push(cx, cy - gap - 6, 2, 12, 0, dot, c); hudBatch.push(cx, cy + gap + 6, 2, 12, 0, dot, c);
  const lines = client.state === 'playing'
    ? [`${renderer3d.kind}  ${fps.toFixed(0)} fps  ping ${Number.isNaN(client.rttMs) ? '-' : client.rttMs.toFixed(0)} ms  ${client.lastSnapshotBytes || 0} B/snapshot`,
      `audio ${sound ? `${sound.audio.state}, ${sound.audio.activeVoices} voices${sound.audio.isMuted('master') ? ', muted' : ''}` : audioEnabled ? 'starts at your first click or key press' : 'off'}`,
      `players in view ${samples.count} (${stats.playersCulled} off screen)   particles ${fx.system.count}   drawn ${list.count}, culled ${list.culled}   corrections ${client.predicted?.stats.corrections ?? 0}   shots agreed ${client.shotStats.agreed}/${client.shotStats.confirmed}`,
      `${input.promptFor('move')} move   ${input.promptFor('look')} look   ${input.promptFor('jump')} jump   ${input.promptFor('run')} run   ${input.promptFor('fire')} fire   (click to capture the mouse)   M mute  N music  F3 debug`]
    : [client.state === 'reconnecting' ? `connection lost - reconnecting (attempt ${client.attempt})...` : `${client.state}${client.closeReason ? ': ' + client.closeReason : ''}`];
  lines.forEach((t, i) => font.draw(hudBatch, t, 12, 10 + i * 16, { shadow: { dx: 1, dy: 1 } }));
  if (debug && client.state === 'playing') { // F3: the numbers behind the netcode
    const ps = client.predicted?.stats, ns = client.stats, ss = client.shotStats;
    const kbps = (ns.bytes * 8) / 1000 / Math.max(1, (now - startedAt) / 1000);
    const rows = [
      `tick ${client.latestTick}  render tick ${Number.isFinite(client.renderTick()) ? client.renderTick().toFixed(1) : '-'}  rtt ${Number.isNaN(client.rttMs) ? '-' : client.rttMs.toFixed(0)} ms`,
      `snapshots ${ns.snapshots} (${ns.fullSnapshots} full)  stale ${ns.stale}  missing baseline ${ns.missingBaseline}  protocol errors ${ns.protocolErrors}`,
      `down ${kbps.toFixed(1)} kbit/s  last snapshot ${client.lastSnapshotBytes || 0} B`,
      `prediction: reconciles ${ps?.reconciles ?? 0}  corrections ${ps?.corrections ?? 0}  snaps ${ps?.snaps ?? 0}  last error ${(ps?.lastError ?? 0).toFixed(3)} m  max ${(ps?.maxError ?? 0).toFixed(3)} m`,
      `shots: predicted ${ss.predicted}  confirmed ${ss.confirmed}  agreed ${ss.agreed}  disagreed ${ss.disagreed}  unconfirmed ${ss.unconfirmed}`,
      `position ${pos.x.toFixed(2)} ${pos.y.toFixed(2)} ${pos.z.toFixed(2)}  yaw ${look.yaw.toFixed(2)}  pitch ${look.pitch.toFixed(2)}`,
    ];
    rows.forEach((t, i) => font.draw(hudBatch, t, 12, 90 + i * 16, { shadow: { dx: 1, dy: 1 } }));
  }
  if (client.state === 'playing') {
    const hp = Math.max(0, Math.min(100, selfHp()));
    hudBatch.push(100, innerHeight - 24, 164, 12, 0, dot, packTint(0, 0, 0, 140));
    hudBatch.push(20 + hp * 0.8, innerHeight - 24, hp * 1.6, 8, 0, dot, packTint(90, 220, 110, 230));
    if (lastMessage) font.draw(hudBatch, lastMessage, cx, 60, { shadow: { dx: 1, dy: 1 } });
  }
  ui.update(frameDt);
  ui.draw();
  hud.render({ camera: screen, batch: hudBatch });
}

function frame(now) {
  frameNo++;
  frameDt = Math.min(0.1, Math.max(1e-4, (now - prevNow) / 1000)); prevNow = now;
  for (const [id, e] of rigs) if (frameNo - e.seen > 180) rigs.delete(id); // players out of sight for a few seconds
  acc += Math.min(0.1, (now - last) / 1000);
  last = now;
  while (acc >= DT) { sendInput(); acc -= DT; }
  const alpha = acc / DT;
  list.clear();
  stats.playersCulled = 0;
  if (client.state === 'playing') { // where the camera is comes first: everything else is culled against it
    const rt = client.renderTick();
    samples.count = 0;
    if (Number.isFinite(rt)) {
      sampleWorld(client.history, rt, samples);
      if (!client.predicted?.initialized) {
        for (let i = 0; i < samples.count; i++) if (samples.ids[i] === client.selfId) { pos.x = samples.x[i]; pos.y = samples.y[i]; pos.z = samples.z[i]; }
      }
    }
    const p = client.predicted;
    if (p?.initialized) { p.smooth(DT * alpha); p.renderPosition(alpha, pos); }
    camera.x = pos.x; camera.y = pos.y + BODY.eye; camera.z = pos.z;
    camera.yaw = look.yaw; camera.pitch = look.pitch;
  }
  camera.update();
  const shadowOptions = shadowsOn ? shadowModes[menus.settings.shadows] : undefined;
  list.setCamera(camera, shadowOptions ? { light: light.direction } : undefined); // instances outside the view are dropped as they are added (unless their shadow could reach it)
  for (const p of parts) {
    if (texturesOn) list.setMaterial(p.layer, 'planar', p.scale);
    list.addTransform(p.mesh, p.x, p.y, p.z, null, p.sx, p.sy, p.sz, p.color[0], p.color[1], p.color[2]);
  }
  list.setMaterial(null);
  if (client.state === 'playing') {
    const live = sound ? new Set() : null;
    for (let i = 0; i < samples.count; i++) {
      if (samples.ids[i] === client.selfId) continue; // you are drawn by the camera
      drawPlayer(i);
      if (sound) { live.add(samples.ids[i]); sound.otherMove(samples.ids[i], samples.x[i], samples.y[i] - BODY.halfHeight, samples.z[i], samples.grounded[i] !== 0); }
    }
    if (sound) {
      sound.forget(live);
      const body = client.predicted?.initialized ? client.predicted.body : null;
      if (body) sound.selfMove(pos.x, pos.z, body.grounded, body.vy);
      sound.watchHealth(selfHp());
    }
  }
  sound?.update(camera);
  const sb = client.state === 'playing' && client.predicted?.initialized ? client.predicted.body : null;
  if (sb) { // dust when you jump and when you land
    const feet = pos.y - BODY.halfHeight;
    if (!sb.grounded) fxFall = Math.min(fxFall, sb.vy);
    if (fxGrounded && !sb.grounded && sb.vy > 2) fx.jump(pos.x, feet, pos.z);
    if (!fxGrounded && sb.grounded) { if (fxFall < -3) fx.land(pos.x, feet, pos.z, -fxFall); fxFall = 0; }
    fxGrounded = !!sb.grounded;
  }
  fx.update(frameDt, camera);
  const frameLights = [];
  for (const l of lamps) { // each lamp: a glowing bulb and a point light
    list.addTransform(bulbMesh, l.x, l.y, l.z, null, 0.5, 0.5, 0.5, l.color[0], l.color[1], l.color[2]);
    frameLights.push({ ...l, intensity: lampIntensity });
  }
  for (let i = tracers.length - 1; i >= 0; i--) { // short-lived tracers: a row of glowing dots from muzzle to impact
    const t = tracers[i], age = (now - t.born) / 1000;
    if (age > 0.18) { tracers.splice(i, 1); continue; }
    if (age < 0.1) { // a flash of light at the muzzle and where the shot lands
      const fade = 1 - age / 0.1;
      frameLights.push({ x: t.x0, y: t.y0, z: t.z0, radius: 7, color: [1, 0.8, 0.5], intensity: 2.2 * fade });
      frameLights.push({ x: t.x1, y: t.y1, z: t.z1, radius: 4, color: t.color, intensity: 1.6 * fade });
    }
    const len = Math.hypot(t.x1 - t.x0, t.y1 - t.y0, t.z1 - t.z0), n = Math.max(2, Math.min(40, Math.floor(len / 1.5)));
    for (let k = 1; k <= n; k++) {
      const u = k / n;
      list.addTransform(sparkMesh, t.x0 + (t.x1 - t.x0) * u, t.y0 - 0.15 + (t.y1 - t.y0) * u, t.z0 + (t.z1 - t.z0) * u, null, 0.07, 0.07, 0.07, t.color[0], t.color[1], t.color[2], 1 - age / 0.18);
    }
  }
  light.pointLights = nearestLights(frameLights, camera.x, camera.y, camera.z); // the 32 that matter most to where you stand
  renderer3d.render({ camera, list, clear: clearColor, lighting: light, shadows: shadowOptions, particles: fx.batch, post: postOn && menus.settings.post ? postOptions : undefined });
  frames++;
  if (now - fpsClock >= 500) { fps = (frames * 1000) / (now - fpsClock); frames = 0; fpsClock = now; }
  drawHud(now);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

window.__arena3d = { ui, menus, fx, get sound() { return sound; }, textures, texturesOn, lamps, shadowsOn, rigs, list, stats, character, client, look, camera, renderer3d, samples, input, setFiring: (v) => { forceFire = v; } };
