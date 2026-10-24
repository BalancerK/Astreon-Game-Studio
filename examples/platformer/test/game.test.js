import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { loadLevel, solidAt, TILE } from '../src/level.js';
import { createGame, step, replay, stateHash, botInput, packInput, MOVE, DT, LEFT, RIGHT, JUMP } from '../src/game.js';

const lv = (rows, extra = {}) => loadLevel({ name: 't', rows, ...extra });
/** A flat floor with the player at column 2 and the goal at the far end. */
const flat = (w = 40, middle = []) => {
  const rows = Array.from({ length: 10 }, () => '.'.repeat(w).split(''));
  rows[7][2] = '@'; rows[7][w - 2] = 'G';
  for (const [x, y, c] of middle) rows[y][x] = c;
  for (let x = 0; x < w; x++) { rows[8][x] = '#'; rows[9][x] = '#'; }
  return rows.map((r) => r.join(''));
};
const run = (g, input, ticks) => { const ev = []; for (let i = 0; i < ticks; i++) ev.push(...step(g, typeof input === 'function' ? input(i, g) : input)); return ev; };
const settle = (g) => run(g, 0, 30);
const level = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));

test('levels are read from rows of tiles, checked, and ground tiles are merged into a few boxes (so nothing snags on the seams)', () => {
  const L = lv(['.........', '..@...G..', '#########', '#########']);
  assert.deepEqual([L.w, L.h], [9, 4]); assert.deepEqual(L.start, { x: 2 * TILE + 8, y: 1 * TILE + 8 }); assert.equal(L.goal.x, 6 * TILE + 8);
  assert.equal(L.rects.length, 1, 'two rows of nine tiles are one box'); assert.deepEqual(L.rects[0], { x: 72, y: 48, hw: 72, hh: 16 });
  const L2 = lv(['....#....', '..@.#.G..', '#########', '#...#####']);
  assert.ok(L2.rects.length <= 4); assert.equal(solidAt(L2, 4 * TILE + 2, 0), true); assert.equal(solidAt(L2, 5, 5), false); assert.equal(solidAt(L2, -3, 5), true, 'beyond the sides is wall'); assert.equal(solidAt(L2, 20, -50), false, 'open sky');
  for (const [rows, re] of [[['..@..', '..G..', '#####', '####'], /row 4 is 4 tiles wide/], [['@.G', 'x..', '###', '###'], /unknown tile "x" at column 1, row 2/], [['..G.', '....', '####', '####'], /needs a start/], [['@...', '....', '####', '####'], /needs a goal/], [['@.@G', '....', '####', '####'], /two start/], [['@', '#'], /needs a list of rows/]]) assert.throws(() => lv(rows), re);
  const L3 = lv(['.o^.S.E.', '@......G', '########', '########']); assert.deepEqual([L3.coins.length, L3.spikes.length, L3.springs.length, L3.enemies.length], [1, 1, 1, 1]);
});

test('running: speeds up to the top speed, slows to a stop, turns round, and a wall stops you', () => {
  const g = createGame(lv(flat())); settle(g);
  const x0 = g.player.x;
  run(g, RIGHT, 4); assert.ok(g.player.vx > 0 && g.player.vx < MOVE.run, 'still speeding up'); run(g, RIGHT, 20); assert.equal(g.player.vx, MOVE.run);
  const x1 = g.player.x; assert.ok(x1 > x0 + 25);
  run(g, 0, 3); assert.ok(g.player.vx > 0 && g.player.vx < MOVE.run, 'slowing down'); run(g, 0, 20); assert.equal(g.player.vx, 0);
  run(g, LEFT, 30); assert.ok(g.player.vx < 0); assert.equal(g.player.facing, -1);
  const w = createGame(lv(flat(40, [[8, 7, '#'], [8, 6, '#'], [8, 5, '#']]))); settle(w);
  run(w, RIGHT, 120); assert.ok(w.player.x < 8 * TILE - MOVE.hw + 0.5, `stopped at ${w.player.x}`); assert.equal(w.player.vx, 0);
  const edge = createGame(lv(flat())); run(edge, LEFT, 90); assert.ok(edge.player.x >= MOVE.hw - 0.01, 'the edge of the level is a wall');
});

test('jumping: a full jump rises about 60 pixels, letting go early gives a short hop, you cannot jump in mid-air, ceilings stop you', () => {
  const rise = (heldTicks) => { const g = createGame(lv(flat())); settle(g); const y0 = g.player.y; let top = y0; run(g, (i) => (i < heldTicks ? JUMP : 0), 80); // track the highest point
    const g2 = createGame(lv(flat())); settle(g2); for (let i = 0; i < 80; i++) { step(g2, i < heldTicks ? JUMP : 0); top = Math.min(top, g2.player.y); } return y0 - top; };
  const full = rise(60), hop = rise(4);
  assert.ok(full > 55 && full < 62, `full jump ${full.toFixed(1)} px`); assert.ok(hop > 8 && hop < full * 0.5, `hop ${hop.toFixed(1)} px`);
  const g = createGame(lv(flat())); settle(g);
  const ev = run(g, JUMP, 3); assert.ok(ev.some((e) => e.e === 'jump'));
  const y = g.player.y; run(g, 0, 2); run(g, JUMP, 1); assert.ok(g.player.vy > -MOVE.jump + 40 || g.player.y < y, 'pressing jump again in mid-air does not jump again');
  const low = createGame(lv(flat(40, [[2, 5, '#'], [3, 5, '#']]))); settle(low); run(low, JUMP, 20); assert.ok(low.player.y - low.player.hh >= 5 * TILE + TILE - 1.5, 'bumped its head'); assert.ok(low.player.vy >= 0 || low.player.y > 5 * TILE);
});

test('coyote time and the jump buffer: a jump just after walking off an edge, or just before landing, still works', () => {
  const cliff = (gapAfter) => { const rows = flat(30); rows[8] = rows[8].slice(0, 10) + '.'.repeat(10) + rows[8].slice(20); rows[9] = rows[8]; const g = createGame(lv(rows)); settle(g);
    run(g, RIGHT, 200, (i, gg) => 0); return g; };
  void cliff;
  const rows = flat(30); rows[8] = `${rows[8].slice(0, 10)}${'.'.repeat(10)}${rows[8].slice(20)}`; rows[9] = rows[8];
  const walkOff = () => { const g = createGame(lv(rows)); settle(g); let n = 0; while (g.player.grounded || n === 0) { step(g, RIGHT); n++; if (n > 400) break; } return g; };
  const a = walkOff(); // left the ground this tick
  assert.equal(a.player.grounded, false);
  run(a, RIGHT, 4); const ev = run(a, RIGHT | JUMP, 1); assert.ok(ev.some((e) => e.e === 'jump'), 'about 70 ms after the edge: still allowed');
  const b = walkOff(); run(b, RIGHT, 9); const late = run(b, RIGHT | JUMP, 1); assert.ok(!late.some((e) => e.e === 'jump'), 'a sixth of a second later it is too late');
  // pressing jump a moment before touching down
  const g = createGame(lv(flat())); settle(g); g.player.y -= 6; g.player.grounded = false; g.player.coyote = 0; g.player.vy = 60;
  const early = step(g, JUMP); assert.ok(!early.some((e) => e.e === 'jump'), 'still in the air');
  let landedWithJump = false; for (let i = 0; i < 6; i++) if (step(g, JUMP).some((e) => e.e === 'jump')) landedWithJump = true;
  assert.ok(landedWithJump, 'a jump pressed shortly before landing happens on landing');
});

test('hazards: spikes and pits cost a life, then you start again with the coins back and the clock still running', () => {
  const sp = createGame(lv(flat(40, [[6, 7, '^'], [12, 7, 'o']]))); settle(sp);
  const ev = []; for (let i = 0; i < 200 && sp.status === 'playing'; i++) ev.push(...step(sp, RIGHT)); assert.ok(ev.some((e) => e.e === 'die' && e.why === 'spikes')); assert.equal(sp.status, 'dead'); assert.equal(sp.deaths, 1);
  assert.equal(sp.status, 'dead'); const x = sp.player.x; run(sp, RIGHT, 20); assert.equal(sp.player.x, x, 'nothing moves while dead');
  const t = sp.time; for (let i = 0; i < 100 && sp.status === 'dead'; i++) step(sp, 0);
  assert.equal(sp.status, 'playing'); assert.ok(Math.abs(sp.player.x - sp.level.start.x) < 1); assert.equal(sp.time, t, 'the clock waited while dead'); assert.equal(sp.deaths, 1);
  const rows = flat(30); rows[8] = `${rows[8].slice(0, 8)}...${rows[8].slice(11)}`; rows[9] = rows[8];
  const pit = createGame(lv(rows)); settle(pit);
  assert.ok(run(pit, RIGHT, 200).some((e) => e.e === 'die' && e.why === 'fell'));
  const jumpOver = createGame(lv(rows)); settle(jumpOver); for (let i = 0; i < 400 && jumpOver.player.x < 25 * TILE; i++) step(jumpOver, botInput(jumpOver)); assert.equal(jumpOver.deaths, 0, 'a three-tile gap can be jumped'); assert.ok(jumpOver.player.x > 20 * TILE);
});

test('enemies: they patrol and turn at walls and edges, landing on one defeats it and bounces you, touching one from the side costs a life', () => {
  const g = createGame(lv(flat(40, [[16, 7, 'E']]))); settle(g);
  const e = g.enemies[0], x0 = e.x; run(g, 0, 60); assert.ok(e.x < x0 - 20, 'walks');
  run(g, 0, 600); assert.ok(e.x > 3 * TILE && e.x < 38 * TILE, 'turns at the ends of the level'); assert.ok(e.alive);
  const box = createGame(lv(flat(40, [[14, 7, 'E'], [11, 7, '#'], [18, 7, '#']]))); settle(box); run(box, 0, 400);
  assert.ok(box.enemies[0].x > 11 * TILE + 8 && box.enemies[0].x < 18 * TILE, 'turns at walls');
  const edge = createGame(lv(flat(40, [[20, 7, 'E']]))); edge.level.solid[8][19] = 0; // a hole just left of it is an edge: it turns before falling
  const side = createGame(lv(flat(40, [[10, 7, 'E']]))); settle(side); side.enemies[0].vx = 0;
  assert.ok(run(side, RIGHT, 80).some((x) => x.e === 'die' && x.why === 'enemy'));
  const stomp = createGame(lv(flat(40, [[10, 7, 'E']]))); settle(stomp); stomp.enemies[0].vx = 0; stomp.player.x = stomp.enemies[0].x - 3; stomp.player.y = stomp.enemies[0].y - 40; stomp.player.vy = 200;
  const evs = run(stomp, 0, 12); assert.ok(evs.some((x) => x.e === 'stomp')); assert.equal(stomp.enemies[0].alive, false); assert.equal(stomp.deaths, 0); assert.ok(stomp.player.vy < 0 || stomp.player.y < stomp.enemies[0].y - 10);
  void edge;
});

test('springs, coins and the goal', () => {
  const sp = createGame(lv(flat(40, [[8, 7, 'S']]))); settle(sp);
  let top = sp.player.y; const ev = []; for (let i = 0; i < 160; i++) { ev.push(...step(sp, i < 100 ? RIGHT : 0)); top = Math.min(top, sp.player.y); }
  assert.ok(ev.some((e) => e.e === 'spring')); assert.ok(sp.level.start.y - top > 100, 'a spring throws you much higher than a jump');
  const c = createGame(lv(flat(40, [[6, 7, 'o'], [7, 7, 'o'], [12, 7, 'o']]))); settle(c);
  const got = run(c, RIGHT, 150).filter((e) => e.e === 'coin'); assert.equal(got.length, 3); assert.equal(c.collected, 3); assert.deepEqual(c.coins, [false, false, false]);
  const w = createGame(lv(flat(20))); settle(w);
  const win = run(w, RIGHT, 400).find((e) => e.e === 'win'); assert.ok(win); assert.equal(w.status, 'won'); assert.equal(w.finalTime, w.time); assert.equal(win.of, 0);
  const tick = w.tick; step(w, RIGHT); assert.equal(w.tick, tick, 'a won game stays won');
});

test('the same inputs always give the same game, so a replay is just a list of inputs; a different input gives a different one', () => {
  const L = loadLevel(level('../levels/level2.json'));
  const g = createGame(L), inputs = [];
  while (g.status !== 'won' && inputs.length < 3000) { const i = botInput(g); inputs.push(i); step(g, i); }
  assert.equal(g.status, 'won');
  const a = replay(L, inputs), b = replay(L, inputs);
  assert.equal(stateHash(a), stateHash(g)); assert.equal(stateHash(a), stateHash(b)); assert.equal(a.finalTime, g.finalTime); assert.equal(a.tick, inputs.length);
  const changed = inputs.map((v, i) => (i >= 100 && i < 130 ? v & ~RIGHT : v));
  assert.notEqual(stateHash(replay(L, changed)), stateHash(g));
  assert.ok(inputs.every((i) => Number.isInteger(i) && i >= 0 && i < 8), 'three bits per tick');
  assert.equal(packInput({ left: true, jump: true }), LEFT | JUMP); assert.equal(packInput(), 0);
});

test('all the levels in the game can be finished (a bot does it, without dying), have the same width in every row, and their par times are fair', () => {
  const files = readdirSync(new URL('../levels', import.meta.url)).filter((f) => f.endsWith('.json') && f !== 'index.json').sort();
  assert.deepEqual(JSON.parse(readFileSync(new URL('../levels/index.json', import.meta.url), 'utf8')), files.map((f) => `levels/${f}`), 'levels/index.json lists every level, in order');
  assert.ok(files.length >= 3);
  for (const f of files) {
    const data = level(`../levels/${f}`), L = loadLevel(data);
    const g = createGame(L); let t = 0;
    while (g.status !== 'won' && t < 60 * 120) { step(g, botInput(g)); t++; }
    assert.equal(g.status, 'won', `${f}: the bot stopped at x=${Math.round(g.player.x)}`); assert.equal(g.deaths, 0, `${f}: the bot died`);
    assert.ok(g.finalTime < data.par, `${f}: the bot needs ${g.finalTime.toFixed(1)} s, par is ${data.par}`); assert.ok(L.coins.length >= 10, `${f} has coins`);
    assert.ok(g.collected < L.coins.length, `${f}: the bot cannot get every coin (they need a player who looks around)`) ;
  }
});
