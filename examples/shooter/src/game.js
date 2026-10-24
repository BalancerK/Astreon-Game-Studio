// The rules of the shooter: waves of robots, a rifle, health and ammo pickups. No screen, no keyboard, no clock: `step(game, input)` moves the game
// on by one sixtieth of a second, and the same inputs always give the same game (the random numbers are seeded), so it is tested by calling it.
import { CharacterController } from '../../../packages/physics/src/index.js';
import { vec3, deltaAngle, atan2, asin } from '../../../packages/math/src/index.js';
import { buildArena } from './level.js';

export const DT = 1 / 60;

/** Every number that shapes the game, in metres and seconds. Change one and play. */
export const CFG = {
  player: { hp: 100, walk: 5, run: 8, eye: 0.7 },
  gun: { mag: 12, reserve: 36, damage: 25, headMult: 2, interval: 0.14, reload: 1.3, spread: 0.01, range: 90 },
  pickups: { dropChance: 0.35, health: 25, ammo: 18, life: 20, radius: 1.3 },
  enemies: {
    grunt: { hp: 50, speed: 3.2, bodyR: 0.55, headR: 0.27, aim: 0.45, every: 1.7, damage: 9, range: 24, keepAway: 10 },
    rusher: { hp: 35, speed: 5.6, bodyR: 0.5, headR: 0.25, every: 0.8, damage: 10, reach: 1.7 },
  },
  waves: { total: 5, maxAlive: 6, spawnEvery: 0.9, firstBreak: 2, breakTime: 4, clearHeal: 20, clearAmmo: 18 },
};

/** The enemies of wave `n` (1, 2, 3 ...), in the order they arrive. */
export function waveOf(n) {
  const grunts = Array(2 + n).fill('grunt');
  const rushers = Array(n >= 2 ? n - 1 : 0).fill('rusher');
  // odd waves send grunts first, even waves rushers first
  const order = n % 2 ? 1 : -1;
  return [...grunts, ...rushers].sort((a, b) => (a === b ? 0 : (a < b ? -1 : 1) * order));
}

/** A small seeded random number generator: the same seed always gives the same numbers (integer maths only). */
function mulberry(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const fwd = [0, 0, 0], rgt = [0, 0, 0], dir = [0, 0, 0], hit = { t: 0, index: -1, nx: 0, ny: 0, nz: 0 };

/** Where the player's eyes are. */
export const eyeOf = (p) => [p.ctl.x, p.ctl.y + CFG.player.eye, p.ctl.z];

/** Distance along a ray (unit direction) to a sphere, or -1. */
export function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r) {
  const mx = ox - cx, my = oy - cy, mz = oz - cz;
  const b = mx * dx + my * dy + mz * dz, c = mx * mx + my * my + mz * mz - r * r;
  if (c > 0 && b > 0) return -1;
  const disc = b * b - c;
  if (disc < 0) return -1;
  const t = -b - Math.sqrt(disc);
  return t < 0 ? 0 : t;
}

/** @param {{seed?: number, arena?: ReturnType<typeof buildArena>}} [o] */
export function createGame({ seed = 1, arena = buildArena() } = {}) {
  const g = CFG.gun, s = arena.spawn;
  return {
    arena, world: arena.world, rng: mulberry(seed), seed, tick: 0, time: 0, events: [], status: 'playing',
    player: {
      ctl: new CharacterController({ x: s.x, y: s.y, z: s.z }),
      hp: CFG.player.hp, yaw: s.yaw, pitch: 0,
      mag: g.mag, reserve: g.reserve, cooldown: 0, reloading: 0, reloadHeld: false,
    },
    enemies: [], pickups: [], nextId: 1,
    wave: 0, phase: 'break', breakLeft: CFG.waves.firstBreak, queue: [], spawnLeft: 0,
    score: 0, kills: 0, headshots: 0, shots: 0, hits: 0, damageTaken: 0,
  };
}

const emit = (game, e) => game.events.push(e);

function hurt(game, dmg, fx, fz) {
  const p = game.player;
  p.hp = Math.max(0, p.hp - dmg); game.damageTaken += dmg;
  emit(game, { e: 'hurt', dmg, from: [fx, fz], hp: p.hp });
  if (p.hp <= 0) { game.status = 'over'; emit(game, { e: 'over', wave: game.wave, score: game.score }); }
}

/** Can a line from `a` to `b` pass without touching the level? */
function clear(world, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
  return !world.raycast(a[0], a[1], a[2], dx, dy, dz, 1, hit);
}

/** The shot: the nearest enemy along the ray, if it is closer than the wall. */
function fire(game, input) {
  const p = game.player, G = CFG.gun, rng = game.rng;
  p.mag--; p.cooldown = G.interval; game.shots++;
  vec3.forward(fwd, p.yaw, p.pitch); vec3.right(rgt, p.yaw);
  const sx = (rng() - 0.5) * 2 * G.spread, sy = (rng() - 0.5) * 2 * G.spread;
  dir[0] = fwd[0] + rgt[0] * sx; dir[1] = fwd[1] + sy; dir[2] = fwd[2] + rgt[2] * sx;
  const len = Math.sqrt(dir[0] * dir[0] + dir[1] * dir[1] + dir[2] * dir[2]); dir[0] /= len; dir[1] /= len; dir[2] /= len;
  const [ox, oy, oz] = eyeOf(p);
  let wall = G.range, wallN = null;
  if (game.world.raycast(ox, oy, oz, dir[0], dir[1], dir[2], G.range, hit)) { wall = hit.t; wallN = [hit.nx, hit.ny, hit.nz]; }
  let best = null, bestT = wall, head = false;
  for (const en of game.enemies) {
    const T = CFG.enemies[en.type], c = en.ctl;
    const th = raySphere(ox, oy, oz, dir[0], dir[1], dir[2], c.x, c.y + 0.8, c.z, T.headR);
    const tb = raySphere(ox, oy, oz, dir[0], dir[1], dir[2], c.x, c.y - 0.05, c.z, T.bodyR);
    const t = th >= 0 && (tb < 0 || th <= tb + 0.3) ? th : tb;
    if (t >= 0 && t < bestT) { best = en; bestT = t; head = th >= 0 && t === th; }
  }
  const to = [ox + dir[0] * bestT, oy + dir[1] * bestT, oz + dir[2] * bestT];
  emit(game, { e: 'shot', from: [ox, oy, oz], to, dir: [dir[0], dir[1], dir[2]] });
  if (!best) { if (wallN) emit(game, { e: 'impact', at: to, n: wallN }); return; }
  game.hits++;
  const dmg = G.damage * (head ? G.headMult : 1);
  best.hp -= dmg; best.flash = 0.12;
  const killed = best.hp <= 0;
  emit(game, { e: 'hit', id: best.id, head, at: to, damage: dmg, killed });
  if (killed) kill(game, best, head);
}

function kill(game, en, head) {
  game.enemies.splice(game.enemies.indexOf(en), 1);
  game.kills++; if (head) game.headshots++;
  game.score += (en.type === 'rusher' ? 150 : 100) + (head ? 50 : 0);
  emit(game, { e: 'kill', id: en.id, type: en.type, head, at: [en.ctl.x, en.ctl.y, en.ctl.z] });
  if (game.rng() < CFG.pickups.dropChance) {
    const kind = game.player.hp < 60 || game.rng() < 0.4 ? 'health' : 'ammo';
    game.pickups.push({ kind, x: en.ctl.x, z: en.ctl.z, life: CFG.pickups.life });
    emit(game, { e: 'drop', kind, at: [en.ctl.x, 0.5, en.ctl.z] });
  }
}

function spawnEnemy(game, type) {
  const p = game.player.ctl, sp = game.arena.enemySpawns;
  const far = sp.filter((s) => Math.hypot(s.x - p.x, s.z - p.z) > 16);
  const at = (far.length ? far : sp)[Math.floor(game.rng() * (far.length || sp.length))];
  const T = CFG.enemies[type];
  game.enemies.push({
    id: game.nextId++, type, hp: T.hp,
    ctl: new CharacterController({ x: at.x, y: 1, z: at.z, radius: 0.4, halfHeight: 0.9 }),
    windup: 0, fireCd: 1 + game.rng(), meleeCd: 0, flash: 0,
    side: game.rng() < 0.5 ? 1 : -1, flip: 1 + game.rng() * 2,
  });
  emit(game, { e: 'spawn', id: game.nextId - 1, type, at: [at.x, 1, at.z] });
}

function moveEnemy(game, en) {
  const T = CFG.enemies[en.type], c = en.ctl, p = game.player.ctl;
  const dx = p.x - c.x, dz = p.z - c.z, dist = Math.hypot(dx, dz) || 1, nx = dx / dist, nz = dz / dist;
  let wx = 0, wz = 0;
  if (en.type === 'rusher') { wx = nx; wz = nz; }
  else {
    en.flip -= DT; if (en.flip <= 0) { en.side = -en.side; en.flip = 1.5 + game.rng() * 2; }
    const sees = en.sees;
    if (!sees || dist > T.keepAway + 5) { wx = nx; wz = nz; }                           // walk until there is a clear shot
    else if (dist < T.keepAway - 2) { wx = -nx * 0.8 - nz * en.side * 0.4; wz = -nz * 0.8 + nx * en.side * 0.4; }
    else { wx = -nz * en.side; wz = nx * en.side; }                                     // strafe at a comfortable distance
  }
  if (c.blocked) { const sx = -nz * en.side, sz = nx * en.side; wx = wx * 0.3 + sx; wz = wz * 0.3 + sz; if (game.rng() < 0.02) en.side = -en.side; }
  for (const o of game.enemies) {                                                       // do not stand inside each other
    if (o === en) continue;
    const ox = c.x - o.ctl.x, oz = c.z - o.ctl.z, d = Math.hypot(ox, oz);
    if (d < 1.3 && d > 1e-4) { wx += (ox / d) * (1.3 - d); wz += (oz / d) * (1.3 - d); }
  }
  const l = Math.hypot(wx, wz); if (l > 1) { wx /= l; wz /= l; }
  c.update(game.world, wx * T.speed, wz * T.speed, false, DT);
}

function actEnemy(game, en) {
  const T = CFG.enemies[en.type], c = en.ctl, p = game.player;
  const eye = eyeOf(p), me = [c.x, c.y + 0.6, c.z];
  const dist = Math.hypot(eye[0] - me[0], eye[2] - me[2]);
  en.sees = clear(game.world, me, eye);
  if (en.flash > 0) en.flash -= DT;
  if (en.type === 'rusher') {
    en.meleeCd = Math.max(0, en.meleeCd - DT);
    if (dist < T.reach && Math.abs(eye[1] - me[1]) < 1.6 && en.meleeCd <= 0) {
      en.meleeCd = T.every;
      emit(game, { e: 'melee', id: en.id });
      hurt(game, T.damage, c.x, c.z);
    }
    return;
  }
  en.fireCd -= DT;
  if (en.windup > 0) {                                                                    // aiming: a warning, then the shot
    en.windup -= DT;
    if (en.windup <= 0) {
      const chance = Math.max(0.15, Math.min(0.8, 0.9 - dist * 0.035));
      const miss = game.rng() >= chance;
      emit(game, { e: 'enemyShot', id: en.id, from: me, to: eye, hit: !miss });
      if (!miss && en.sees) hurt(game, T.damage, c.x, c.z);
    }
  } else if (en.sees && dist < T.range && en.fireCd <= 0) { en.windup = T.aim; en.fireCd = T.every; emit(game, { e: 'aim', id: en.id, at: me }); }
}

/**
 * One tick. `input`: `{ mx, mz, yaw, pitch, fire, jump, reload, run }` where mx is right (+) and mz forward (+), each -1..1;
 * yaw and pitch are where the player looks; `fire`, `jump`, `reload` and `run` are held buttons.
 * Returns this tick's events: `shot`, `impact`, `hit`, `kill`, `drop`, `spawn`, `aim`, `enemyShot`,
 * `melee`, `hurt`, `reload`, `empty`, `pickup`, `wave`, `clear`, `win`, `over`.
 * @param {ReturnType<typeof createGame>} game
 */
export function step(game, input) {
  game.events = [];
  if (game.status !== 'playing') return game.events;
  game.tick++; game.time += DT;
  const p = game.player, G = CFG.gun, W = CFG.waves;
  p.yaw = input.yaw ?? p.yaw; p.pitch = Math.max(-1.5, Math.min(1.5, input.pitch ?? p.pitch));

  // moving
  vec3.forward(fwd, p.yaw, 0); vec3.right(rgt, p.yaw);
  let wx = fwd[0] * (input.mz ?? 0) + rgt[0] * (input.mx ?? 0), wz = fwd[2] * (input.mz ?? 0) + rgt[2] * (input.mx ?? 0);
  const l = Math.hypot(wx, wz); if (l > 1) { wx /= l; wz /= l; }
  const speed = input.run ? CFG.player.run : CFG.player.walk;
  p.ctl.update(game.world, wx * speed, wz * speed, !!input.jump, DT);
  const lim = game.arena.size;
  p.ctl.x = Math.max(-lim, Math.min(lim, p.ctl.x)); p.ctl.z = Math.max(-lim, Math.min(lim, p.ctl.z));

  // the rifle
  p.cooldown = Math.max(0, p.cooldown - DT);
  const wantReload = (input.reload && !p.reloadHeld) || (p.mag === 0 && input.fire && p.reserve > 0);
  p.reloadHeld = !!input.reload;
  if (p.reloading > 0) {
    p.reloading -= DT;
    if (p.reloading <= 0) {
      const n = Math.min(G.mag - p.mag, p.reserve);
      p.mag += n;
      p.reserve -= n;
      p.reloading = 0;
      emit(game, { e: 'reloaded', mag: p.mag });
    }
  } else if (wantReload && p.mag < G.mag && p.reserve > 0) { p.reloading = G.reload; emit(game, { e: 'reload' }); }
  else if (input.fire && p.cooldown <= 0) {
    if (p.mag > 0) fire(game, input);
    else { p.cooldown = 0.3; emit(game, { e: 'empty' }); }
  }

  // enemies
  for (const en of game.enemies) { moveEnemy(game, en); actEnemy(game, en); }
  if (game.status !== 'playing') return game.events;

  // pickups
  for (let i = game.pickups.length - 1; i >= 0; i--) {
    const k = game.pickups[i]; k.life -= DT;
    if (Math.hypot(k.x - p.ctl.x, k.z - p.ctl.z) < CFG.pickups.radius) {
      if (k.kind === 'health') p.hp = Math.min(CFG.player.hp, p.hp + CFG.pickups.health); else p.reserve += CFG.pickups.ammo;
      emit(game, { e: 'pickup', kind: k.kind }); game.pickups.splice(i, 1);
    } else if (k.life <= 0) game.pickups.splice(i, 1);
  }

  // waves
  if (game.phase === 'break') {
    game.breakLeft -= DT;
    if (game.breakLeft <= 0) {
      game.wave++;
      game.queue = waveOf(game.wave);
      game.spawnLeft = 0;
      game.phase = 'fight';
      emit(game, { e: 'wave', n: game.wave, enemies: game.queue.length });
    }
  } else {
    game.spawnLeft -= DT;
    if (game.queue.length && game.spawnLeft <= 0 && game.enemies.length < W.maxAlive) {
      spawnEnemy(game, game.queue.shift());
      game.spawnLeft = W.spawnEvery;
    }
    if (!game.queue.length && !game.enemies.length) {
      if (game.wave >= W.total) { game.status = 'won'; emit(game, { e: 'win', score: game.score, time: game.time }); }
      else {
        game.phase = 'break'; game.breakLeft = W.breakTime;
        p.hp = Math.min(CFG.player.hp, p.hp + W.clearHeal); p.reserve += W.clearAmmo;
        game.score += 200; emit(game, { e: 'clear', n: game.wave });
      }
    }
  }
  return game.events;
}

/** A number that stands for the whole state of a game, for tests and for checking a replay. */
export function stateHash(game) {
  let h = 0x811c9dc5;
  const mix = (v) => { h = Math.imul(h ^ (Math.round(v * 1024) | 0), 0x01000193) >>> 0; };
  const p = game.player;
  [p.ctl.x, p.ctl.y, p.ctl.z, p.hp, p.mag, p.reserve, game.tick, game.score, game.wave, game.kills].forEach(mix);
  game.enemies.forEach((e) => { mix(e.ctl.x); mix(e.ctl.z); mix(e.hp); });
  return h;
}

/** Play a list of inputs from the start. */
export function replay(inputs, opts) {
  const g = createGame(opts);
  for (const i of inputs) { step(g, i); if (g.status !== 'playing') break; }
  return g;
}

/**
 * A computer player: turns towards the nearest enemy it can see at a human speed, shoots when it is on target, keeps its distance (backing away from
 * rushers), reloads, and fetches pickups. It shows the game can be won, and tests use it as a player.
 * @param {ReturnType<typeof createGame>} game @param {{turn?: number}} [skill]
 */
export function botInput(game, { turn = 3 } = {}) {
  const p = game.player, eye = eyeOf(p);
  const bot = (game.bot ??= { yaw: p.yaw, pitch: p.pitch, strafe: 1, flip: 0 });
  bot.flip -= DT; if (bot.flip <= 0) { bot.strafe = -bot.strafe; bot.flip = 0.9; }
  let target = null, td = Infinity, nearest = null, nd = Infinity;
  for (const en of game.enemies) {
    const d = Math.hypot(en.ctl.x - p.ctl.x, en.ctl.z - p.ctl.z);
    if (d < nd) { nd = d; nearest = en; }
    if (d < td && clear(game.world, eye, [en.ctl.x, en.ctl.y, en.ctl.z])) { td = d; target = en; }
  }
  const aimAt = target ?? nearest;
  let fireNow = false, mz = 0, mx = 0;
  if (aimAt) {
    const c = aimAt.ctl;
    const dx = c.x - eye[0], dy = c.y + 0.35 - eye[1], dz = c.z - eye[2], d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const wantYaw = atan2(-dx, -dz), wantPitch = asin(dy / d);
    const dyaw = deltaAngle(bot.yaw, wantYaw), dpit = wantPitch - bot.pitch, step_ = turn * DT;
    bot.yaw += Math.max(-step_, Math.min(step_, dyaw)); bot.pitch += Math.max(-step_, Math.min(step_, dpit));
    fireNow = !!target && Math.abs(dyaw) < 0.06 && Math.abs(dpit) < 0.06 && p.reloading <= 0;
  }
  const rusherClose = nearest && nearest.type === 'rusher' && nd < 8;
  if (rusherClose) { mz = -1; mx = bot.strafe * 0.6; }                                   // back away from rushers
  else if (target) { mx = bot.strafe; mz = td > 14 ? 0.6 : td < 7 ? -0.6 : 0; }
  else if (nearest) mz = 0.7;
  else {                                                              // between waves: go and get a pickup, or stay in the middle
    const k = game.pickups[0];
    if (k) {
      const want = atan2(-(k.x - p.ctl.x), -(k.z - p.ctl.z));
      bot.yaw += Math.max(-turn * DT, Math.min(turn * DT, deltaAngle(bot.yaw, want)));
      mz = 1;
    }
  }
  // stay out of the walls and pillars: if blocked, slide sideways
  if (p.ctl.blocked) mx += bot.strafe * 0.8;
  const reload = p.mag < 5 && (!target || td > 12) && p.reserve > 0;
  return { mx, mz, yaw: bot.yaw, pitch: bot.pitch, fire: fireNow, jump: false, reload, run: !target && !!game.pickups.length };
}
