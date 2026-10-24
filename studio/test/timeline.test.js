import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Timeline, hashState, setPath, getPath, validPath, verifyReplay, checkReplay } from '../runner/timeline.js';

const update = (speed = 100) => (s, keys, dt) => {
  if (keys.has('ArrowRight')) s.x += speed * dt;
  if (keys.has('ArrowLeft')) s.x -= speed * dt;
  s.n++;
  s.nested.t += dt;
};
const fresh = () => ({ x: 0, n: 0, label: 'hi', nested: { t: 0 }, list: [{ v: 1 }, { v: 2 }] });

/** Play `ticks` ticks live, pressing keys at random but repeatably, and remember the true state after every tick. */
function record(timeline, state, ticks, up = update(), seed = 5) {
  let r = seed;
  const rnd = () => { r = (r * 1664525 + 1013904223) >>> 0; return r / 4294967296; };
  const truth = [structuredClone(state)];
  for (let i = 0; i < ticks; i++) {
    if (rnd() < 0.08) timeline.key(!timeline.held.has('ArrowRight'), 'ArrowRight');
    if (rnd() < 0.05) timeline.key(!timeline.held.has('ArrowLeft'), 'ArrowLeft');
    timeline.step(state, up);
    truth.push(structuredClone(state));
  }
  return truth;
}

test('hashing and editing paths: equal states agree, unsafe or wrong edits are refused', () => {
  assert.equal(hashState({ a: 1 }), hashState({ a: 1 })); assert.notEqual(hashState({ a: 1 }), hashState({ a: 2 })); assert.match(hashState({}), /^[0-9a-f]{8}$/);
  const s = fresh();
  assert.equal(setPath(s, ['x'], 5), true); assert.equal(s.x, 5); assert.equal(setPath(s, ['list', 1, 'v'], 9), true); assert.equal(s.list[1].v, 9);
  assert.equal(setPath(s, ['label'], 'bye'), true); assert.equal(setPath(s, ['label'], true), true, 'a kind can change between plain values');
  assert.equal(setPath(s, ['x'], Infinity), false); assert.equal(setPath(s, ['x'], NaN), false); assert.equal(setPath(s, ['nested'], 3), false, 'objects are not replaced');
  assert.equal(setPath(s, ['x'], { a: 1 }), false); assert.equal(setPath(s, ['missing'], 1), false, 'no new keys'); assert.equal(setPath(s, ['nested', 'nope', 'x'], 1), false);
  assert.equal(setPath(s, ['__proto__', 'polluted'], 1), false); assert.equal({}.polluted, undefined); assert.equal(setPath(s, ['constructor', 'x'], 1), false);
  assert.equal(setPath(s, [], 1), false); assert.equal(setPath(s, [-1], 1), false); assert.equal(setPath(s, ['x'], 7, true), true); assert.notEqual(s.x, 7, 'a dry run changes nothing');
  assert.equal(validPath(['a', 0, 'b']), true); assert.equal(validPath(new Array(30).fill('a')), false); assert.equal(validPath('x'), false); assert.equal(validPath([1.5]), false);
  assert.equal(getPath(s, ['list', 0, 'v']), 1); assert.equal(getPath(s, ['nope', 'x']), undefined);
});

test('recording: copies once a second, inputs as they happen, repeated keys ignored', () => {
  const t = new Timeline(); const s = fresh(); t.reset(s);
  assert.equal(t.snapshots.length, 1);
  assert.equal(t.key(true, 'ArrowRight'), true); assert.equal(t.key(true, 'ArrowRight'), false, 'already down'); assert.equal(t.key(false, 'KeyZ'), false, 'never down');
  for (let i = 0; i < 125; i++) t.step(s, update());
  assert.deepEqual(t.snapshots.map((x) => x.tick), [0, 60, 120]); assert.equal(t.tick, 125); assert.equal(t.maxTick, 125);
  assert.deepEqual(t.events, [{ at: 0, k: 'key', down: true, code: 'ArrowRight' }]); assert.ok(Math.abs(s.x - 125 * 100 / 60) < 1e-9);
  t.paused = true; assert.equal(t.key(false, 'ArrowRight'), false, 'keys are ignored while paused');
  const st = t.status(); assert.equal(st.tick, 125); assert.equal(st.mode, 'live'); assert.deepEqual(st.snapshots, [0, 60, 120]); assert.equal(st.paused, true);
});

test('going back: any tick comes back exactly, going forward again too, and out-of-range ticks are clamped', () => {
  const t = new Timeline(); const s0 = fresh(); t.reset(s0); let s = s0;
  const truth = record(t, s, 400);
  for (const target of [0, 1, 59, 60, 61, 137, 250, 399, 400]) {
    s = t.seek(s, target, update());
    assert.equal(t.tick, target); assert.deepEqual(s, truth[target], `state at tick ${target}`);
  }
  s = t.seek(s, 90, update()); s = t.seek(s, 300, update()); assert.deepEqual(s, truth[300], 'forward from the past');
  s = t.seek(s, 99999, update()); assert.equal(t.tick, 400); assert.deepEqual(s, truth[400]); s = t.seek(s, -50, update()); assert.equal(t.tick, 0); assert.deepEqual(s, truth[0]);
  assert.equal(t.diverged, null, 'a deterministic game re-runs the same');
});

test('a game that is not deterministic is noticed when the past is re-run', () => {
  const noisy = (s) => { s.n++; s.r = (s.r ?? 0) + Math.random(); };
  const t = new Timeline(); let s = fresh(); t.reset(s);
  for (let i = 0; i < 200; i++) t.step(s, noisy);
  s = t.seek(s, 130, noisy);
  assert.ok(t.diverged, 'diverged'); assert.equal(t.diverged.tick, 120, 'at the first copy that was re-run');
  assert.equal(t.status().diverged.tick, 120);
});

test('what if: pausing in the past and re-running with new code gives a different end, and the same code gives the same end', () => {
  const t = new Timeline(); let s = fresh(); t.reset(s);
  const truth = record(t, s, 300);
  const original = truth[300].x;
  s = t.seek(s, 100, update());
  t.paused = true;
  t.startReplay(); t.paused = false;
  assert.equal(t.mode, 'replay'); assert.equal(t.key(true, 'ArrowLeft'), false, 'live keys are ignored during a replay');
  while (!t.replayEnded) t.step(s, update());
  assert.equal(t.tick, 300); assert.equal(t.paused, true); assert.equal(t.mode, 'live'); assert.deepEqual(s.x, original, 'same code, same result'); assert.equal(t.diverged, null);
  s = t.seek(s, 100, update()); t.run = 1; t.startReplay();                          // a new version of the code
  while (!t.replayEnded) t.step(s, update(300));
  assert.notEqual(s.x, original, 'a faster hero ends somewhere else'); assert.equal(t.tick, 300);
  assert.equal(t.diverged, null, 'different code is not a divergence');
});

test('playing live from the past forgets the old future; replaying keeps it', () => {
  const t = new Timeline(); let s = fresh(); t.reset(s);
  record(t, s, 300);
  const eventsBefore = t.events.length;
  s = t.seek(s, 130, update());
  assert.equal(t.events.length, eventsBefore, 'seeking forgets nothing'); assert.equal(t.maxTick, 300);
  t.playLive();
  assert.equal(t.maxTick, 130); assert.ok(t.snapshots.every((x) => x.tick <= 130)); assert.ok(t.events.length <= eventsBefore); assert.equal(t.paused, false);
  for (let i = 0; i < 70; i++) t.step(s, update()); assert.equal(t.tick, 200); assert.equal(t.maxTick, 200);
});

test('values edited by hand are part of the recording and are made again in a replay', () => {
  const t = new Timeline(); let s = fresh(); t.reset(s);
  for (let i = 0; i < 40; i++) t.step(s, update());
  assert.equal(t.edit(s, ['x'], 1000), true); assert.equal(s.x, 1000);
  assert.equal(t.edit(s, ['nested'], 1), false); assert.equal(t.edit(s, ['nope'], 1), false); assert.equal(t.events.length, 1, 'refused edits are not recorded');
  for (let i = 0; i < 80; i++) t.step(s, update());
  const after = structuredClone(s);
  s = t.seek(s, 10, update()); assert.ok(s.x < 100, 'before the edit');
  s = t.seek(s, 120, update()); assert.deepEqual(s, after, 'the edit is made again on the way there'); assert.deepEqual(t.status().edits, [40]);
  s = t.seek(s, 20, update()); t.startReplay();
  while (!t.replayEnded) t.step(s, update());
  assert.deepEqual(s, after);
  t.mode = 'replay'; assert.equal(t.edit(s, ['x'], 1), false, 'no hand edits during a replay');
});

test('an edit made while paused in the past is placed there, and a replay carries it forward', () => {
  const t = new Timeline(); let s = fresh(); t.reset(s);
  const truth = record(t, s, 200);
  s = t.seek(s, 50, update());
  t.paused = true; assert.equal(t.edit(s, ['label'], 'edited'), true); t.paused = false;
  t.startReplay();
  while (!t.replayEnded) t.step(s, update());
  assert.equal(s.label, 'edited'); assert.equal(s.x, truth[200].x, 'the rest of the run is unchanged'); assert.equal(t.tick, 200);
});

test('only a limited past is kept: the oldest copies go, their inputs go with them, and what is kept still comes back exactly', () => {
  const t = new Timeline({ maxSnapshots: 4 }); let s = fresh(); t.reset(s);
  const truth = record(t, s, 600);
  assert.equal(t.snapshots.length, 4); const { from, to } = t.range; assert.equal(to, 600); assert.ok(from >= 360, `from ${from}`);
  assert.ok(t.events.length < 200); assert.ok(t.snapshots.every((x) => x.eventIndex >= 0 && x.eventIndex <= t.events.length));
  for (const target of [from, from + 1, 450, 599]) { s = t.seek(s, target, update()); assert.deepEqual(s, truth[target], `tick ${target}`); }
  s = t.seek(s, 5, update()); assert.equal(t.tick, from, 'earlier than kept: the oldest kept moment');
  const big = new Timeline({ maxBytes: 4000 }); const bs = { blob: 'x'.repeat(500) }; big.reset(bs);
  for (let i = 0; i < 600; i++) big.step(bs, () => {});
  assert.ok(big.snapshots.length < 10, `kept ${big.snapshots.length}`); assert.ok(big.snapshots.length >= 2);
});

test('a replay file: export, check, run again anywhere, and say where it stops matching', () => {
  const t = new Timeline(); const s = fresh(); t.reset(s);
  record(t, s, 500);
  const file = t.exportReplay();
  const clean = checkReplay(JSON.parse(JSON.stringify({ ...file, files: { 'src/main.js': 'export const a = 1;' }, name: 'My bug' })));
  assert.equal(clean.name, 'My bug'); assert.deepEqual(clean.files, { 'src/main.js': 'export const a = 1;' }); assert.equal(clean.endTick, 500);
  assert.deepEqual(verifyReplay(clean, update()), { ok: true, ticks: 500, divergedAt: null, checked: clean.checkpoints.length - 1 });
  const other = verifyReplay(clean, update(150)); assert.equal(other.ok, false); assert.ok(other.divergedAt > 0 && other.divergedAt <= 60, `diverged at ${other.divergedAt}`);
  const noisy = new Timeline(); const ns = fresh(); noisy.reset(ns); for (let i = 0; i < 200; i++) noisy.step(ns, (x) => { x.n += Math.random(); });
  assert.equal(verifyReplay(checkReplay(noisy.exportReplay()), (x) => { x.n += Math.random(); }).ok, false, 'a game that uses Math.random cannot be reproduced');
  assert.equal(new Timeline().exportReplay(), null, 'nothing recorded: nothing to export');
  const trimmed = new Timeline({ maxSnapshots: 3 }); const ts = fresh(); trimmed.reset(ts); record(trimmed, ts, 500);
  assert.equal(verifyReplay(checkReplay(trimmed.exportReplay()), update()).ok, true, 'a replay of the kept part starts from its first copy');
});

test('a replay from outside is checked before anything uses it', () => {
  const t = new Timeline(); const s = fresh(); t.reset(s); record(t, s, 130);
  const good = () => JSON.parse(JSON.stringify(t.exportReplay()));
  assert.doesNotThrow(() => checkReplay(good()));
  const refuses = (mutate, pattern) => { const d = good(); mutate(d); assert.throws(() => checkReplay(d), pattern); };
  assert.throws(() => checkReplay(null), /not a replay file/); assert.throws(() => checkReplay({ format: 'other' }), /not a replay file/); assert.throws(() => checkReplay('text'), /not a replay/);
  refuses((d) => { d.version = 2; }, /version 2/); refuses((d) => { d.every = 0; }, /spacing/); refuses((d) => { delete d.start; }, /starting state/);
  refuses((d) => { d.events = 'x'; }, /list of inputs/); refuses((d) => { d.events = new Array(200_001).fill({ at: 0, k: 'key', down: true, code: 'a' }); }, /too long/);
  refuses((d) => { d.events = [{ at: 5, k: 'key', down: true, code: 'a' }, { at: 2, k: 'key', down: false, code: 'a' }]; }, /time order/);
  refuses((d) => { d.events = [{ at: 0, k: 'jump' }]; }, /unknown kind/); refuses((d) => { d.events = [{ at: 0, k: 'edit', path: ['__proto__', 'x'], value: 1 }]; }, /unsafe path/);
  refuses((d) => { d.events = [{ at: 0, k: 'edit', path: ['x'], value: { a: 1 } }]; }, /unsupported value/); refuses((d) => { d.events = [{ at: -1, k: 'key', down: true, code: 'a' }]; }, /not a tick/);
  refuses((d) => { d.checkpoints = [[1, 'zzzz']]; }, /checkpoint 1/); refuses((d) => { d.start.held = [1]; }, /held keys/); refuses((d) => { d.endTick = 1.5; }, /not a tick/);
  refuses((d) => { d.files = { '../x.js': 'a' }; }, /not allowed/); refuses((d) => { d.files = { '/abs.js': 'a' }; }, /not allowed/); refuses((d) => { d.files = { 'a.js': 5 }; }, /not allowed/);
  refuses((d) => { d.files = { 'a.js': 'x'.repeat(2_000_001) }; }, /too big/); refuses((d) => { d.start.state = 'x'.repeat(5_000_001); }, /too big/);
  const d = good(); d.extra = 'ignored'; d.events.push({ at: 130, k: 'key', down: true, code: 'KeyQ', evil: 1 }); const clean = checkReplay(d);
  assert.equal(clean.extra, undefined); assert.equal(clean.events.at(-1).evil, undefined, 'only known fields are kept');
});

test('a timeline made from a replay starts paused at its first tick and can be moved through', () => {
  const t = new Timeline(); let s = fresh(); t.reset(s); const truth = record(t, s, 300);
  const { timeline, state } = Timeline.fromReplay(checkReplay(t.exportReplay()));
  assert.equal(timeline.paused, true); assert.equal(timeline.tick, 0); let at = state;
  at = timeline.seek(at, 250, update()); assert.deepEqual(at, truth[250]);
  at = timeline.seek(at, 70, update()); assert.deepEqual(at, truth[70]);
  assert.deepEqual(timeline.range, { from: 0, to: 300 });
});
