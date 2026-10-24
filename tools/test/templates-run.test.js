import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadGame } from '../replay-run.js';
import { TEMPLATES } from '../../studio/app/store/templates.js';
import { parseRules, problemWith } from '../../studio/app/rules/rules-model.js';
import { setSoundSink, setCanvasFactory } from '../../packages/arcade/src/index.js';

const ctx = () => new Proxy({}, { get: (o, k) => (k in o ? o[k] : () => {}), set: (o, k, v) => { o[k] = v; return true; } });

async function open(name) {
  setSoundSink(() => {});
  setCanvasFactory(() => ({ getContext: ctx }));
  const { mod, cleanup } = await loadGame({ ...TEMPLATES[name].files });
  return { mod, cleanup, game: mod.create() };
}
const DT = 1 / 60;
const KEY = { left: 'ArrowLeft', right: 'ArrowRight', up: 'ArrowUp', down: 'ArrowDown', space: 'Space', enter: 'Enter' };

test('every starting project loads, runs, draws and reports a summary, with no keys and with random keys', async () => {
  for (const name of Object.keys(TEMPLATES)) {
    const { mod, cleanup, game } = await open(name);
    try {
      for (let t = 0; t < 120; t++) mod.update(game, new Set(), DT);
      mod.render(game, ctx(), 0);
      let seed = 7;
      const next = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
      const pool = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space', 'Enter', 'KeyR', 'KeyX'];
      for (let t = 0; t < 900; t++) mod.update(game, new Set(pool.filter(() => next() < 0.3)), DT);
      mod.render(game, ctx(), 0);
      const summary = mod.summary?.(game);
      assert.ok(summary === undefined || (summary && typeof summary === 'object'), `${name} summary`);
      JSON.parse(JSON.stringify(game));                                           // the whole game is plain data
    } finally { cleanup(); }
  }
});

test('space shooter: holding space fires, shots destroy enemies and score, enemies that get through cost lives, and Enter starts again', async () => {
  const { mod, cleanup, game } = await open('shooter');
  try {
    // sweep left and right while firing: some enemies must be hit
    for (let t = 0; t < 60 * 25; t++) {
      const sweep = Math.sin(t / 50) > 0 ? KEY.right : KEY.left;
      mod.update(game, new Set([KEY.space, sweep]), DT);
      if (game.lives <= 0) break;
    }
    assert.ok(game.score > 3, `score ${game.score}`);
    assert.ok(game.things.every((t) => t.y > -40 && t.y < 340), 'bullets and enemies that left the screen are removed');
    // doing nothing loses
    const idle = (await open('shooter')).game;
    for (let t = 0; t < 60 * 40 && idle.lives > 0; t++) mod.update(idle, new Set(), DT);
    assert.equal(idle.lives, 0);
    const before = idle.things.length;
    mod.update(idle, new Set(), DT); assert.equal(idle.things.length, before, 'nothing moves after the game is over');
    mod.update(idle, new Set([KEY.enter]), DT);
    assert.equal(idle.lives, 3); assert.equal(idle.score, 0);
    assert.equal(mod.summary(idle).lives, 3);
  } finally { cleanup(); }
});

/** The shortest list of moves that solves a level, found by searching (so the test proves each level can be solved). */
function solve(level) {
  const rows = level.map((r) => [...r]);
  const walls = new Set(); const targets = new Set(); const boxes = []; let player;
  rows.forEach((row, y) => row.forEach((c, x) => {
    if (c === '#') walls.add(`${x},${y}`); if (c === 'x') targets.add(`${x},${y}`);
    if (c === 'B') boxes.push(`${x},${y}`); if (c === '@') player = [x, y];
  }));
  const key = (p, b) => `${p}|${[...b].sort().join(';')}`;
  const start = { p: player, b: boxes, moves: [] };
  const seen = new Set([key(player, boxes)]);
  const queue = [start];
  const dirs = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] };
  while (queue.length) {
    const s = queue.shift();
    if (s.b.every((b) => targets.has(b))) return s.moves;
    for (const [name, [dx, dy]] of Object.entries(dirs)) {
      const nx = s.p[0] + dx; const ny = s.p[1] + dy;
      if (walls.has(`${nx},${ny}`)) continue;
      let boxesNow = s.b;
      const at = s.b.indexOf(`${nx},${ny}`);
      if (at >= 0) {
        const bx = `${nx + dx},${ny + dy}`;
        if (walls.has(bx) || s.b.includes(bx)) continue;
        boxesNow = s.b.map((b, i) => (i === at ? bx : b));
      }
      const k = key([nx, ny], boxesNow);
      if (seen.has(k)) continue;
      seen.add(k);
      queue.push({ p: [nx, ny], b: boxesNow, moves: [...s.moves, name] });
    }
  }
  return null;
}

test('push the boxes: both levels can be solved, boxes push only when there is room, R restarts, Enter goes on', async () => {
  const { mod, cleanup, game } = await open('puzzle');
  try {
    const source = TEMPLATES.puzzle.files['src/main.js'];
    const levels = [...source.matchAll(/\[\s*((?:'[^']*',?\s*)+)\]/g)].map((m) => [...m[1].matchAll(/'([^']*)'/g)].map((x) => x[1])).filter((l) => l[0].startsWith('#'));
    assert.equal(levels.length, 2);
    const play = (moves) => { for (const m of moves) { mod.update(game, new Set([KEY[m]]), DT); mod.update(game, new Set(), DT); } };
    for (let n = 0; n < levels.length; n++) {
      const moves = solve(levels[n]);
      assert.ok(moves && moves.length > 2, `level ${n + 1} has a solution`);
      assert.equal(game.level, n); assert.equal(game.won, false);
      play(moves);
      assert.equal(game.won, true, `level ${n + 1} is solved by its shortest solution (${moves.length} moves)`);
      assert.equal(game.moves, moves.length); assert.equal(mod.summary(game).solved, true);
      const stay = JSON.stringify(game.things);
      mod.update(game, new Set([KEY.left]), DT); assert.equal(JSON.stringify(game.things), stay, 'no moving once solved');
      mod.update(game, new Set(), DT);
      mod.update(game, new Set([KEY.enter]), DT);
    }
    assert.equal(game.level, 0, 'after the last level it starts again from the first');
    // walls and boxes that cannot be pushed
    const player = () => game.things.find((t) => t.kind === 'player');
    const at = { x: player().x, y: player().y };
    play(['up', 'up', 'up']); assert.ok(player().y >= 32, 'the wall stops the player');
    mod.update(game, new Set(['KeyR']), DT);
    assert.deepEqual({ x: player().x, y: player().y }, at); assert.equal(game.moves, 0);
    play(['right', 'right', 'right', 'right', 'right']);                         // push the box until it meets the wall, then keep pushing
    const box = game.things.find((t) => t.kind === 'box');
    assert.ok(box.x <= 6 * 32, 'a box never goes into a wall');
  } finally { cleanup(); }
});

test('made with rules: the starter rules are valid, coins and spikes work through them, and the message appears when the coins are gone', async () => {
  const rules = parseRules(TEMPLATES.rules.files['src/rules.js']);
  assert.equal(rules.length, 3); for (const r of rules) assert.equal(problemWith(r), null);
  const { mod, cleanup, game } = await open('rules');
  try {
    const hero = () => game.things.find((t) => t.kind === 'hero');
    const x0 = hero().x;
    for (let t = 0; t < 60 * 2.5 && game.lives === 3; t++) mod.update(game, new Set([KEY.right]), DT);
    assert.equal(game.lives, 2, 'walking into the spike costs a life');
    assert.equal(hero().x, 32, 'and sends the hero back to the start'); assert.ok(x0 === 32);
    // an AI that jumps over spikes collects every coin
    const play = (await open('rules')).game;
    for (let t = 0; t < 60 * 40; t++) {
      const h = play.things.find((x) => x.kind === 'hero');
      const spikeAhead = play.things.some((s) => s.kind === 'spike' && s.x - h.x > 0 && s.x - h.x < 70);
      mod.update(play, new Set([KEY.right, ...(spikeAhead && h.onGround ? [KEY.space] : [])]), DT);
    }
    assert.equal(play.lives, 3); assert.ok(play.score >= 2, `score ${play.score}`);
    const rest = TEMPLATES.rules.files['src/main.js'];
    assert.match(rest, /applyRules\(game, keys, dt\)/); assert.match(rest, /drawRules\(game, g\)/);
    // all coins gone: the message shows, and goes away
    const done = (await open('rules')).game;
    done.things = done.things.filter((t) => t.kind !== 'coin');
    mod.update(done, new Set(), DT); assert.equal(done.say?.text, 'You got every coin!');
    for (let t = 0; t < 60 * 4; t++) mod.update(done, new Set(), DT);
    assert.equal(done.say, null);
  } finally { cleanup(); }
});
