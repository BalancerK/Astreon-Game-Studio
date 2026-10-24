import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InputRecorder, InputPlayer, ReplayDesyncError, hashState, INPUT_REPLAY_VERSION } from '../src/index.js';

/** A tiny deterministic game: two players move a dot about, collect coins that appear from a seeded generator, and the score and the generator are the state. */
function makeGame(rule = 1) {
  const state = { tick: 0, rng: 12345, players: { a: { x: 0, y: 0 }, b: { x: 10, y: 10 } }, coin: [5, 5], score: { a: 0, b: 0 } };
  const next = () => { state.rng = (Math.imul(state.rng, 1664525) + 1013904223) >>> 0; return state.rng / 4294967296; };
  return {
    state,
    step(inputs, tick) {
      for (const id of ['a', 'b']) {
        const i = inputs?.[id]; if (!i) continue;
        state.players[id].x += (i.right ? 1 : 0) - (i.left ? 1 : 0); state.players[id].y += ((i.down ? 1 : 0) - (i.up ? 1 : 0)) * rule;
        if (state.players[id].x === state.coin[0] && state.players[id].y === state.coin[1]) { state.score[id]++; state.coin = [Math.floor(next() * 20) - 10, Math.floor(next() * 20) - 10]; }
      }
      state.tick = tick + 1;
    },
    save: () => state,
    load(s) { Object.assign(state, JSON.parse(JSON.stringify(s))); },
    hash: () => hashState(state),
  };
}
/** Random-looking but repeatable play: players hold a direction for a while. */
function inputsFor(tick) {
  const phase = Math.floor(tick / 17);
  const dir = (p) => ['right', 'down', 'left', 'up'][(phase + p + (phase % 3)) % 4];
  return { a: { [dir(0)]: true }, b: tick % 40 < 10 ? {} : { [dir(1)]: true } };
}
function playMatch(ticks, { save = true, checkpointEvery = 100, hashEvery = 20 } = {}) {
  const g = makeGame();
  const rec = new InputRecorder({ game: 'dots', version: 3, tickRate: 30, meta: { seed: 12345 }, save: save ? g.save : null, hash: g.hash, checkpointEvery, hashEvery });
  for (let t = 0; t < ticks; t++) { const inputs = inputsFor(t); rec.record(t, inputs); g.step(inputs, t); }
  return { g, rec, finalHash: g.hash(), replay: rec.finish() };
}

test('a match is recorded as its inputs, in a small file, and playing them reproduces the match exactly', () => {
  const { finalHash, replay, rec } = playMatch(3000);
  assert.equal(replay.format, 'engine-input-replay'); assert.equal(replay.version, INPUT_REPLAY_VERSION); assert.equal(replay.game, 'dots'); assert.equal(replay.gameVersion, 3);
  assert.equal(replay.ticks, 3000); assert.equal(replay.tickRate, 30); assert.deepEqual(replay.meta, { seed: 12345 });
  const text = rec.toText();
  assert.ok(text.length < 60000, `a hundred seconds of two players in ${text.length} characters`);
  assert.ok(replay.runs.length < 3000 * 0.2, `held buttons are run-length encoded: ${replay.runs.length} runs for 3000 ticks`);
  const g = makeGame();
  const player = new InputPlayer(text, { step: g.step, load: g.load, hash: g.hash });
  assert.equal(player.advance(3000), 3000); assert.equal(player.finished, true);
  assert.equal(g.hash(), finalHash, 'the same match');
  assert.equal(player.advance(5), 0, 'and it stops at the end');
  assert.equal(player.desyncs.length, 0);
});

test('inputsAt finds the inputs of any tick, and refuses ticks outside the recording', () => {
  const { replay } = playMatch(500);
  const player = new InputPlayer(replay, { step() {} });
  for (const t of [0, 1, 16, 17, 18, 99, 250, 499]) assert.deepEqual(player.inputsAt(t), inputsFor(t), `tick ${t}`);
  assert.throws(() => player.inputsAt(500), /outside the recording/); assert.throws(() => player.inputsAt(-1), RangeError);
});

test('seeking forward and back lands on exactly the state of that tick', () => {
  const { replay } = playMatch(1000, { checkpointEvery: 100 });
  const reference = (tick) => { const g = makeGame(); for (let t = 0; t < tick; t++) g.step(inputsFor(t), t); return g.hash(); };
  const g = makeGame(), player = new InputPlayer(replay, { step: g.step, load: g.load, hash: g.hash });
  for (const tick of [250, 900, 120, 120, 0, 777, 1000, 301, 300]) { player.seek(tick); assert.equal(player.tick, tick); assert.equal(g.hash(), reference(tick), `at tick ${tick}`); }
  player.seek(5000); assert.equal(player.tick, 1000); player.seek(-9); assert.equal(player.tick, 0);
  assert.equal(g.hash(), reference(0));
});

test('a replay that stops matching the game is caught at the next hash, with the tick, not by a wrong ending', () => {
  const { replay } = playMatch(600, { hashEvery: 25 });
  const changed = makeGame(2);                                                       // a patch changed how far a step moves vertically
  const player = new InputPlayer(replay, { step: changed.step, load: changed.load, hash: changed.hash });
  assert.throws(() => player.advance(600), (e) => e instanceof ReplayDesyncError && e.tick > 0 && e.tick <= 600 && e.expected !== e.actual && /drifted/.test(e.message));
  const seen = [];
  const lenient = new InputPlayer(replay, { step: changed.step, load: changed.load, hash: makeGame(2).hash, onDesync: (e) => seen.push(e.tick) });
  const g2 = makeGame(2); const p2 = new InputPlayer(replay, { step: g2.step, load: g2.load, hash: g2.hash, onDesync: (e) => seen.push(e.tick) });
  p2.advance(600); assert.ok(seen.length > 5, `reported at every hash after it drifted: ${seen.length}`); assert.equal(p2.desyncs.length, seen.length);
  void lenient;
  const quiet = makeGame(); const fine = new InputPlayer(replay, { step: quiet.step, load: quiet.load, hash: quiet.hash }); fine.advance(600); assert.equal(fine.desyncs.length, 0);
  const unchecked = makeGame(2); new InputPlayer(replay, { step: unchecked.step, load: unchecked.load }).advance(600);        // without a hash function nothing is verified
});

test('playing along: speed, pause, rewinding and loop', () => {
  const { replay } = playMatch(300, { checkpointEvery: 60 });
  const g = makeGame(), player = new InputPlayer(replay, { step: g.step, load: g.load, hash: g.hash });
  assert.equal(player.update(1), 30, 'one second at 30 ticks a second'); assert.equal(player.tick, 30);
  player.speed = 2; assert.equal(player.update(0.5), 30);
  player.playing = false; assert.equal(player.update(10), 0);
  player.playing = true; player.speed = 0.5; let ran = 0; for (let i = 0; i < 10; i++) ran += player.update(1 / 30); assert.ok(ran >= 4 && ran <= 6, `half speed: ${ran}`);
  assert.ok(Math.abs(player.time - player.tick / 30) < 1e-9); assert.equal(player.duration, 10);
  player.rewind(); assert.equal(player.tick, 0); assert.equal(g.state.tick, 0);
  player.loop = true; player.speed = 1; let total = 0; for (let i = 0; i < 400; i++) total += player.update(1 / 30);
  assert.ok(total >= 395 && player.tick < 300, `it went round more than once: ${total} ticks, now at ${player.tick}`);
  assert.equal(g.state.tick >= 0, true);
});

test('without saved states a replay still plays from the start; it cannot jump back, and says why', () => {
  const { replay } = playMatch(200, { save: false });
  assert.deepEqual(replay.checkpoints, []); assert.ok(replay.hashes.length > 0, 'hashes still catch drift');
  const g = makeGame(), player = new InputPlayer(replay, { step: g.step, hash: g.hash });
  player.advance(100);
  assert.throws(() => player.seek(10), /needs a recorded save/); assert.throws(() => player.rewind(), /no saved state/);
  player.advance(100); assert.equal(player.finished, true);
});

test('the recorder checks ticks are consecutive and the player checks what it is given', () => {
  const rec = new InputRecorder({ game: 'x' });
  rec.record(5, { a: 1 }); rec.record(6, null);
  assert.throws(() => rec.record(8, {}), /consecutive/);
  assert.equal(rec.ticks, 2); const r = rec.finish(); assert.equal(r.startTick, 5);
  const seen = []; const p = new InputPlayer(r, { step: (i, t) => seen.push([t, i]) }); p.advance(2);
  assert.deepEqual(seen, [[5, { a: 1 }], [6, null]]);
  assert.throws(() => new InputPlayer({ format: 'nope' }, { step() {} }), /not an input replay/);
  assert.throws(() => new InputPlayer({ ...r, version: 99 }, { step() {} }), /layout 99/);
  assert.throws(() => new InputPlayer('not json', { step() {} }));
  const empty = new InputRecorder({}).finish(); assert.equal(empty.ticks, 0); assert.equal(new InputPlayer(empty, { step() {} }).advance(5), 0);
});

test('hashState is stable and sensitive', () => {
  assert.equal(hashState({ a: 1, b: [1, 2] }), hashState({ a: 1, b: [1, 2] }));
  assert.notEqual(hashState({ a: 1 }), hashState({ a: 2 })); assert.match(hashState('x'), /^[0-9a-f]{8}$/);
});
