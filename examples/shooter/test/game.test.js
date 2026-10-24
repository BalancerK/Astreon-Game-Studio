import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildArena } from '../src/level.js';
import { createGame, step, replay, stateHash, botInput, waveOf, raySphere, eyeOf, CFG, DT } from '../src/game.js';

const run = (g, input, ticks) => { const ev = []; for (let i = 0; i < ticks; i++) ev.push(...step(g, typeof input === 'function' ? input(i, g) : input)); return ev; };
/** A game with no waves running yet, the player settled on the floor and facing -z (yaw 0), and one enemy placed 10 m ahead (or none). */
function setup({ enemy = 'grunt', dist = 10, seed = 1 } = {}) {
  const g = createGame({ seed }); g.breakLeft = 1e9; g.player.ctl.x = 10;      // x = 10: a clear lane to the north, between the low walls
  run(g, {}, 30);
  if (enemy) {
    const e = { id: g.nextId++, type: enemy, ctl: null, hp: CFG.enemies[enemy].hp, windup: 0, fireCd: 1e9, meleeCd: 0, side: 1, flip: 99, flash: 0 };
    e.ctl = new g.player.ctl.constructor({ x: g.player.ctl.x, y: 0.9, z: g.player.ctl.z - dist }); g.enemies.push(e);
  }
  return g;
}
const aim = { fire: true, yaw: 0, pitch: 0 };                                   // the crosshair level with the eyes: on a standing robot that is its head
const body = { fire: true, yaw: 0, pitch: Math.atan2(0.85 - 1.6, 10) };           // and a little lower is the chest

test('the arena is one description for collision and drawing, with room to fight', () => {
  const a = buildArena();
  assert.ok(a.parts.length > 20 && a.enemySpawns.length >= 4 && a.pickupSpots.length >= 4 && a.lights.length >= 1);
  const hit = { t: 0, index: -1, nx: 0, ny: 0, nz: 0 };
  assert.ok(a.world.raycast(0, 5, 0, 0, -1, 0, 20, hit) && Math.abs(hit.t - 5) < 1e-6 && hit.ny > 0.99, 'the floor is at y = 0');
  assert.ok(a.world.raycast(0, 3, 0, 1, 0, 0, 100, hit) && hit.t > 20 && hit.t < 30, 'a wall at the edge');
  for (const s of a.enemySpawns) assert.ok(Math.hypot(s.x, s.z) > 16 && Math.abs(s.x) < a.size && Math.abs(s.z) < a.size, 'enemies come in at the edges, inside the walls');
});

test('walking: forward is where you look, speed is the walking speed, running is faster, walls stop you, you jump from the ground only', () => {
  const g = setup({ enemy: null }), p = g.player.ctl, z0 = p.z, X = p.x;
  run(g, { mz: 1, yaw: 0 }, 60); assert.ok(Math.abs((z0 - p.z) - CFG.player.walk) < 0.2 && Math.abs(p.x - X) < 0.01, `walked ${(z0 - p.z).toFixed(2)} m forward in a second`);
  const q = setup({ enemy: null }); q.player.ctl.x = 0; run(q, { mx: 1, yaw: 0 }, 40); assert.ok(q.player.ctl.x > 3, 'mx is to the right');
  const g2 = setup({ enemy: null }); g2.player.ctl.z = 5.5; run(g2, { mz: 1, yaw: Math.PI / 2, run: true }, 40); assert.ok(g2.player.ctl.x - X < -4.6, 'turned left: forward is now -x, and running is faster');
  const g3 = setup({ enemy: null }); run(g3, { mz: 1, mx: 1, yaw: 0 }, 60); const d = Math.hypot(g3.player.ctl.x - X, g3.player.ctl.z - z0); assert.ok(d < CFG.player.walk + 0.2, 'diagonals are not faster');
  const g4 = setup({ enemy: null }); run(g4, { mz: 1, yaw: 0, run: true }, 600); assert.ok(g4.player.ctl.z > -g4.arena.size - 0.01 && g4.player.ctl.z < -20, `stopped by the wall at z = ${g4.player.ctl.z.toFixed(1)}`);
  const g5 = setup({ enemy: null }); let top = 0; for (let i = 0; i < 60; i++) { step(g5, { jump: true }); top = Math.max(top, g5.player.ctl.feetY); } assert.ok(top > 1 && top < 1.6, `jumped ${top.toFixed(2)} m`);
});

test('the rifle: it fires at its rate, spends bullets, reloads in time, and stops when there is nothing left', () => {
  const g = setup({ enemy: null }), p = g.player;
  const shots = run(g, aim, 60).filter((e) => e.e === 'shot'); assert.equal(shots.length, 7, 'one shot every 9 ticks: about seven a second');
  assert.equal(p.mag, CFG.gun.mag - shots.length); assert.equal(g.shots, shots.length);
  const rl = setup({ enemy: null }); rl.player.mag = 0; run(rl, aim, 1); assert.ok(rl.player.reloading > 0, 'out of bullets with the trigger held: it reloads by itself');
  const ev = run(rl, { yaw: 0 }, Math.ceil(CFG.gun.reload / DT) + 3); assert.ok(ev.some((e) => e.e === 'reloaded')); assert.deepEqual([rl.player.mag, rl.player.reserve], [CFG.gun.mag, CFG.gun.reserve - CFG.gun.mag], 'the reserve pays for the magazine');
  const dry = setup({ enemy: null }); dry.player.mag = 0; dry.player.reserve = 0;
  const e2 = run(dry, aim, 40); assert.ok(e2.some((e) => e.e === 'empty')); assert.ok(!e2.some((e) => e.e === 'shot'));
  const partial = setup({ enemy: null }); partial.player.mag = 3; partial.player.reserve = 2;
  run(partial, { reload: true }, 1); run(partial, {}, 90); assert.deepEqual([partial.player.mag, partial.player.reserve], [5, 0], 'only what is left in the reserve');
  const mid = setup({ enemy: null }); run(mid, { fire: true, yaw: 0 }, 2); const m = mid.player.mag; run(mid, { reload: true, fire: true }, 30); assert.equal(mid.player.mag, m, 'no shooting while reloading');
});

test('shots hit what is under the crosshair: body, head for double damage, nothing when aimed to the side; walls are in the way', () => {
  const g = setup(); const e = g.enemies[0], eye = eyeOf(g.player);
  let ev = run(g, body, 1); const h = ev.find((x) => x.e === 'hit'); assert.ok(h, 'a hit'); assert.equal(h.head, false); assert.equal(h.damage, CFG.gun.damage);
  const headPitch = Math.atan2(e.ctl.y + 0.8 - eye[1], 10); const g2 = setup(); g2.player.cooldown = 0;
  ev = run(g2, { fire: true, yaw: 0, pitch: headPitch }, 1); const hh = ev.find((x) => x.e === 'hit'); assert.ok(hh && hh.head && hh.damage === CFG.gun.damage * CFG.gun.headMult, 'a headshot');
  const g3 = setup(); ev = run(g3, { fire: true, yaw: 0.3, pitch: 0 }, 1); assert.ok(!ev.some((x) => x.e === 'hit') && ev.some((x) => x.e === 'impact'), 'a miss hits the wall behind');
  const g4 = setup({ dist: 15 }); g4.enemies[0].ctl.z = -35; g4.enemies[0].ctl.x = 10; // behind the south... outside the arena: far beyond the wall at z = -26
  ev = run(g4, aim, 1); assert.ok(!ev.some((x) => x.e === 'hit'), 'the wall protects what is behind it');
  assert.equal(raySphere(0, 0, 0, 0, 0, -1, 0, 0, -5, 1), 4); assert.equal(raySphere(0, 0, 0, 0, 0, -1, 3, 0, -5, 1), -1); assert.equal(raySphere(0, 0, 0, 0, 0, 1, 0, 0, -5, 1), -1, 'not behind');
});

test('enemies die, score, and sometimes drop a pickup that heals or feeds the rifle', () => {
  const g = setup(); const ev = run(g, body, 40);
  assert.ok(ev.some((e) => e.e === 'kill'), 'two body shots kill a grunt'); assert.equal(g.kills, 1); assert.equal(g.enemies.length, 0); assert.equal(g.score, 100);
  const drops = []; for (let seed = 1; seed <= 60; seed++) { const s = setup({ seed }); s.player.hp = 40; const e = run(s, body, 40).find((x) => x.e === 'drop'); if (e) drops.push(e.kind); }
  assert.ok(drops.length > 8 && drops.length < 35, `${drops.length} drops in 60 kills (35% expected)`); assert.ok(drops.includes('health'));
  const k = setup({ enemy: null }); k.player.hp = 50; k.player.reserve = 0; const c = k.player.ctl;
  k.pickups.push({ kind: 'health', x: c.x + 3, z: c.z, life: 10 }, { kind: 'ammo', x: c.x - 3, z: c.z, life: 10 }, { kind: 'ammo', x: c.x, z: c.z + 9, life: 0.05 });
  run(k, { mx: 1, yaw: 0 }, 60); assert.equal(k.player.hp, 50 + CFG.pickups.health); run(k, { mx: -1, yaw: 0 }, 120); assert.equal(k.player.reserve, CFG.pickups.ammo); assert.equal(k.pickups.length, 0, 'the old one faded away');
});

test('enemies: grunts walk to a clear shot, warn before firing, miss at a distance; rushers run in and bite; both go round cover', () => {
  const g = setup({ dist: 20 }); const e = g.enemies[0]; e.fireCd = 0;
  const ev = run(g, { yaw: 0 }, 90); assert.ok(ev.some((x) => x.e === 'aim'), 'a warning first');
  const aimAt = ev.findIndex((x) => x.e === 'aim'), shotAt = ev.findIndex((x) => x.e === 'enemyShot'); assert.ok(shotAt > aimAt, 'then the shot');
  assert.ok(Math.hypot(e.ctl.x - g.player.ctl.x, e.ctl.z - g.player.ctl.z) < 20, 'it came closer');
  const r = setup({ enemy: 'rusher', dist: 12 }); const evr = run(r, { yaw: 0 }, 200);
  assert.ok(evr.some((x) => x.e === 'melee') && r.player.hp < CFG.player.hp, 'the rusher reaches and bites'); assert.ok(r.player.hp >= CFG.player.hp - CFG.enemies.rusher.damage * 3);
  // a pillar between them: it must go round (the pillar at about 14 m from the middle)
  const c = setup({ enemy: 'rusher', dist: 4 }); const pl = c.arena.parts.find((p) => p.sy === 4 && p.sx === 1.8); const pp = c.player.ctl; pp.x = pl.x - 5 * Math.sign(pl.x || 1); pp.z = pl.z; pp.y = 0.9;
  const en = c.enemies[0]; en.ctl.x = pl.x + 3 * Math.sign(pl.x || 1); en.ctl.z = pl.z; en.ctl.y = 0.9;
  run(c, { yaw: 0 }, 60 * 8); assert.ok(c.player.hp < CFG.player.hp, 'it found its way round the pillar');
  const idle = createGame(); let t = 0; while (idle.status === 'playing' && t < 60 * 120) { step(idle, {}); t++; }
  assert.equal(idle.status, 'over'); assert.equal(idle.wave, 1, 'standing still loses in the first wave');
});

test('waves: a break, then each wave arrives a few at a time, the next wave is bigger, a cleared wave heals and gives ammo, wave five wins', () => {
  assert.deepEqual([1, 2, 3, 4, 5].map((n) => waveOf(n).length), [3, 5, 7, 9, 11]); assert.ok(waveOf(1).every((t) => t === 'grunt') && waveOf(3).includes('rusher'));
  const g = createGame({ seed: 3 }); const ev = [];
  for (let i = 0; i < 60 * 40 && g.status === 'playing'; i++) { ev.push(...step(g, botInput(g))); if (g.enemies.length > CFG.waves.maxAlive) assert.fail('too many at once'); }
  const waves = ev.filter((e) => e.e === 'wave'); assert.equal(waves[0].n, 1); assert.ok(g.time > CFG.waves.firstBreak);
  assert.ok(ev.findIndex((e) => e.e === 'wave') < ev.findIndex((e) => e.e === 'clear') || !ev.some((e) => e.e === 'clear'));
  assert.ok(ev.filter((e) => e.e === 'spawn').length >= 3);
  const h = createGame({ seed: 2 }); h.player.hp = 30; h.wave = 1; h.phase = 'fight'; h.queue = []; h.enemies = [];
  const before = h.player.reserve; const c = step(h, {}); assert.ok(c.some((e) => e.e === 'clear')); assert.equal(h.player.hp, 30 + CFG.waves.clearHeal); assert.equal(h.player.reserve, before + CFG.waves.clearAmmo); assert.equal(h.phase, 'break');
  const w = createGame({ seed: 2 }); w.wave = CFG.waves.total; w.phase = 'fight'; w.queue = []; w.enemies = [];
  assert.ok(step(w, {}).some((e) => e.e === 'win')); assert.equal(w.status, 'won'); const tick = w.tick; step(w, {}); assert.equal(w.tick, tick, 'a won game stays won');
});

test('the same seed and inputs always give the same game; a different seed or input gives a different one', () => {
  const g = createGame({ seed: 5 }), inputs = [];
  for (let i = 0; i < 60 * 25; i++) { const inp = botInput(g); inputs.push(inp); step(g, inp); }
  const a = replay(inputs, { seed: 5 }), b = replay(inputs, { seed: 5 });
  assert.equal(stateHash(a), stateHash(g)); assert.equal(stateHash(a), stateHash(b)); assert.equal(a.tick, inputs.length);
  assert.notEqual(stateHash(replay(inputs, { seed: 6 })), stateHash(g));
  assert.notEqual(stateHash(replay(inputs.map((i, n) => (n > 600 && n < 700 ? { ...i, mx: 1 } : i)), { seed: 5 })), stateHash(g));
});

test('a computer player that turns at a human speed wins the game (in several different games), and one that turns too slowly can lose: the difficulty is fair', () => {
  let wins = 0;
  for (const seed of [1, 2, 3]) {
    const g = createGame({ seed }); let t = 0;
    while (g.status === 'playing' && t < 60 * 300) { step(g, botInput(g)); t++; }
    if (g.status === 'won') wins++;
    assert.ok(g.status === 'won', `seed ${seed}: ${g.status} in wave ${g.wave}`);
    assert.ok(g.kills === waveOf(1).length + waveOf(2).length + waveOf(3).length + waveOf(4).length + waveOf(5).length, 'every enemy was beaten'); assert.ok(g.hits / g.shots > 0.5 && g.hits / g.shots < 1);
    assert.ok(g.score >= 3500);
  }
  assert.equal(wins, 3);
  let lost = 0; for (const seed of [1, 3]) { const g = createGame({ seed }); let t = 0; while (g.status === 'playing' && t < 60 * 300) { step(g, botInput(g, { turn: 1.5 })); t++; } if (g.status === 'over') lost++; }
  assert.ok(lost >= 1, 'a slow-aiming player can lose');
});
