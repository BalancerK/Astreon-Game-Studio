import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World, defineComponent } from '../../core/src/index.js';
import { NetSchema, Snapshot, BinaryWriter, ProtocolError, q, u8 } from '../../protocol/src/index.js';
import { ReplayRecorder, ReplayPlayer, SpectatorFeed, SnapshotReceiver, REPLAY_FORMAT_VERSION } from '../src/index.js';

const Pos = defineComponent('game:pos', { x: 'f32', y: 'f32' });
const Hp = defineComponent('game:hp', { hp: 'u8' });
const schema = new NetSchema([{ component: Pos, codecs: { x: q(-1000, 1000, 16), y: q(-1000, 1000, 16) } }, { component: Hp, codecs: { hp: u8 } }]);
const CAP = 128;

/** A small world that moves: 40 entities walking, a few spawned and a few removed along the way. Returns the snapshots a server would take, one per tick. */
function match(ticks, { seed = 7, moveChance = 0.5 } = {}) {
  let s = seed; const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  const world = new World(CAP); world.register(Pos); world.register(Hp);
  const ids = []; for (let i = 0; i < 40; i++) { const e = world.create(); world.add(e, Pos, { x: rnd() * 800 - 400, y: rnd() * 800 - 400 }); world.add(e, Hp, { hp: 100 }); ids.push(e); }
  const out = [];
  for (let t = 1; t <= ticks; t++) {
    const buf = new Uint32Array(CAP), n = world.query(buf, [Pos]);
    const px = world.data(Pos), hp = world.data(Hp);
    for (let k = 0; k < n; k++) { const slot = buf[k] & 0xfffff; if (rnd() < moveChance) { px.x[slot] += (rnd() - 0.5) * 6; px.y[slot] += (rnd() - 0.5) * 6; } if (rnd() < 0.02) hp.hp[slot] = Math.max(0, hp.hp[slot] - 3); }
    if (t % 50 === 0) { const e = world.create(); world.add(e, Pos, { x: 1, y: 2 }); world.add(e, Hp, { hp: 50 }); }
    if (t % 70 === 0 && ids.length) world.destroy(ids.shift());
    const ids2 = new Uint32Array(CAP), m = world.query(ids2, [Pos]);
    const snap = new Snapshot(schema, CAP); snap.capture(world, t, ids2, m);
    out.push(snap);
  }
  return out;
}
const same = (a, b, msg = '') => {
  assert.equal(a.tick, b.tick, `${msg} tick`); assert.equal(a.count, b.count, `${msg} count at tick ${a.tick}`);
  for (let i = 0; i < a.count; i++) { assert.equal(a.ids[i], b.ids[i], `${msg} id ${i}`); assert.equal(a.masks[i], b.masks[i]); }
  assert.deepEqual([...a.vals.subarray(0, a.count * schema.fieldCount)], [...b.vals.subarray(0, b.count * schema.fieldCount)], `${msg} values at tick ${a.tick}`);
};
const clone = (snap) => { const c = new Snapshot(schema, CAP); c.tick = snap.tick; c.count = snap.count; c.ids.set(snap.ids.subarray(0, snap.count)); c.masks.set(snap.masks.subarray(0, snap.count)); c.vals.set(snap.vals.subarray(0, snap.count * schema.fieldCount)); return c; };
const record = (snaps, o = {}) => { const rec = new ReplayRecorder({ schema, capacity: CAP, keyframeEvery: 60, meta: { map: 'dunes' }, ...o }); for (const s of snaps) rec.record(s); return rec; };

test('a recording is small, and plays back every snapshot exactly as it was', () => {
  const snaps = match(300), rec = record(snaps, { meta: { map: 'dunes', players: ['ann', 'bob'] } });
  const bytes = rec.finish();
  assert.equal(rec.stats.frames, 300); assert.ok(rec.stats.keyframes >= 5 && rec.stats.keyframes <= 8, `keyframes ${rec.stats.keyframes}`);
  const fullOnly = record(snaps, { keyframeEvery: 1 }).finish();
  assert.ok(bytes.length < fullOnly.length * 0.85, `even when half the world moves every tick, deltas beat full snapshots: ${bytes.length} vs ${fullOnly.length}`);
  const quiet = match(300, { moveChance: 0.1 }), quietBytes = record(quiet).finish().length, quietFull = record(quiet, { keyframeEvery: 1 }).finish().length;
  assert.ok(quietBytes < quietFull * 0.4, `and when a tenth of it moves they are under 40%: ${quietBytes} vs ${quietFull}`);
  const seen = [];
  const player = new ReplayPlayer(bytes, { schema, capacity: CAP, onSnapshot: (s, i) => seen.push([i, clone(s)]) });
  assert.deepEqual(player.meta, { map: 'dunes', players: ['ann', 'bob'] }); assert.equal(player.tickRate, 60); assert.equal(player.header.version, REPLAY_FORMAT_VERSION);
  assert.equal(player.frameCount, 300); assert.equal(player.firstTick, 1); assert.equal(player.lastTick, 300); assert.ok(Math.abs(player.duration - 299 / 60) < 1e-9);
  seen.length = 0;
  for (let i = 0; i < 400; i++) player.update(1 / 60);
  assert.equal(player.finished, true);
  assert.ok(seen.length >= 298, `every frame was played: ${seen.length}`);
  for (const [i, s] of seen) same(s, snaps[i], `frame ${i}`);
  assert.equal(player.truncated, false);
});

test('seeking lands on the right snapshot, forward or back, between frames or past the ends', () => {
  const snaps = match(300), player = new ReplayPlayer(record(snaps).finish(), { schema, capacity: CAP });
  for (const tick of [150, 20, 299, 1, 61, 60, 59, 240, 241, 120]) { player.seekTick(tick); same(player.current, snaps[tick - 1], `seek ${tick}`); assert.equal(player.index, tick - 1); }
  player.seekTick(1000); assert.equal(player.current.tick, 300); player.seekTick(-5); assert.equal(player.current.tick, 1);
  player.seek(2); same(player.current, snaps[121 - 1], 'two seconds in (tick 121)');
  const rec = record(snaps, { every: 1 }), spread = new ReplayPlayer(rec.finish(), { schema, capacity: CAP });
  spread.seekTick(100.7); assert.equal(spread.current.tick, 100, 'between frames: the one before');
  assert.equal(spread.frameAt(100.7), 99);
});

test('speed, pause and loop; the history holds the frames around the playhead for interpolation', () => {
  const snaps = match(120), player = new ReplayPlayer(record(snaps).finish(), { schema, capacity: CAP });
  player.update(1);                                                                      // 60 ticks
  assert.equal(player.current.tick, 61);
  player.speed = 2; player.update(0.5); assert.equal(player.current.tick, 121 > 120 ? 120 : 121, 'twice as fast: one more second of match');
  player.speed = 1; player.playing = false; const t = player.time; player.update(5); assert.equal(player.time, t, 'paused');
  player.playing = true; player.seekTick(10); player.update(0.5 / 60);
  const { before, after } = player.history.around(player.tickAt);
  assert.ok(before && after && before.tick <= player.tickAt && after.tick >= player.tickAt, 'a pair to interpolate between');
  const looping = new ReplayPlayer(record(snaps).finish(), { schema, capacity: CAP }); looping.loop = true;
  for (let i = 0; i < 200; i++) looping.update(1 / 30);
  assert.ok(looping.time >= 0 && looping.time < looping.duration + 1e-9); assert.equal(looping.finished === true && looping.loop === true, looping.finished);
  looping.seekTick(looping.lastTick); looping.update(0.5); assert.ok(looping.current.tick < 60, `after the end it starts again: ${looping.current.tick}`);
});

test('events are recorded with the match and told once, in order, as the playhead passes them', () => {
  const snaps = match(200), rec = new ReplayRecorder({ schema, capacity: CAP, keyframeEvery: 50 });
  for (const s of snaps) { rec.record(s); if (s.tick === 40) rec.event(40, 'kill', { by: 'ann', who: 'bob' }); if (s.tick === 120) rec.event(120, 'chat', { text: 'gg ✓' }); }
  const got = [];
  const player = new ReplayPlayer(rec.finish(), { schema, capacity: CAP, onEvent: (e) => got.push(e) });
  assert.equal(rec.stats.events, 2); assert.deepEqual(player.events.map((e) => [e.tick, e.type]), [[40, 'kill'], [120, 'chat']]);
  for (let i = 0; i < 100; i++) player.update(1 / 60);
  assert.deepEqual(got.map((e) => e.type), ['kill'], 'only the first so far');
  player.seekTick(10); player.seekTick(150); assert.equal(got.length, 1, 'a seek does not replay or fire events');
  player.seekTick(100); for (let i = 0; i < 100; i++) player.update(1 / 60);
  assert.deepEqual(got.map((e) => e.type), ['kill', 'chat']); assert.deepEqual(got[1].data, { text: 'gg ✓' });
  assert.deepEqual(player.eventsBetween(30, 100).map((e) => e.type), ['kill']);
});

test('recording only every third tick keeps a third of the frames and plays on the same clock', () => {
  const snaps = match(300), all = record(snaps), third = record(snaps, { every: 3, keyframeEvery: 60 });
  assert.equal(third.stats.frames, 100); assert.ok(third.finish().length < all.finish().length * 0.6);
  const player = new ReplayPlayer(third.finish(), { schema, capacity: CAP });
  assert.equal(player.frameCount, 100); assert.equal(player.lastTick, 298);
  player.seekTick(150); assert.ok(player.current.tick <= 150 && player.current.tick > 147); same(player.current, snaps[player.current.tick - 1]);
  assert.throws(() => { const r = record(snaps.slice(0, 5)); r.record(snaps[2]); }, /must increase/);
});

test('a recording cut short by a crash plays up to where it stopped; damaged and foreign files are refused', () => {
  const snaps = match(200), bytes = record(snaps).finish();
  const cut = bytes.slice(0, Math.floor(bytes.length * 0.6)), player = new ReplayPlayer(cut, { schema, capacity: CAP });
  assert.equal(player.truncated, true); assert.ok(player.frameCount > 80 && player.frameCount < 200, `${player.frameCount} frames survive`);
  player.seekTick(player.lastTick); same(player.current, snaps[player.lastTick - 1]);
  assert.throws(() => new ReplayPlayer(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), { schema, capacity: CAP }), /not a replay/);
  assert.throws(() => new ReplayPlayer(bytes.slice(0, 7), { schema, capacity: CAP }), ProtocolError);
  const other = new NetSchema([{ component: Pos, codecs: { x: q(-100, 100, 16), y: q(-100, 100, 16) } }]);
  assert.throws(() => new ReplayPlayer(bytes, { schema: other, capacity: CAP }), /different replicated-state schema/);
  const newer = bytes.slice(); newer[4] = REPLAY_FORMAT_VERSION + 1;
  assert.throws(() => new ReplayPlayer(newer, { schema, capacity: CAP }), /file format/);
  const empty = new ReplayRecorder({ schema, capacity: CAP }).finish(), none = new ReplayPlayer(empty, { schema, capacity: CAP });
  assert.equal(none.frameCount, 0); assert.equal(none.update(1), 0); assert.equal(none.duration, 0);
});

test('a recording can be written as it goes, and the pieces make the same file', () => {
  const snaps = match(150), pieces = [];
  const streamed = new ReplayRecorder({ schema, capacity: CAP, keyframeEvery: 60, onChunk: (b) => pieces.push(b), meta: { a: 1 } });
  for (const s of snaps) streamed.record(s); streamed.event(10, 'x', 1);
  assert.equal(streamed.finish().length, 0, 'nothing is kept in memory');
  const whole = record(snaps, { meta: { a: 1 } }); whole.event(10, 'x', 1);
  const joined = new Uint8Array(pieces.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of pieces) { joined.set(p, o); o += p.length; }
  assert.deepEqual(joined, whole.finish());
  assert.equal(streamed.stats.bytes, joined.length);
});

// ------------------------------------------------------------------ spectating

test('spectators see the match a fixed delay behind, from full snapshots then small deltas, and share the bytes', () => {
  const snaps = match(200, { moveChance: 0.1 }), feed = new SpectatorFeed({ schema, worldCapacity: CAP, delayTicks: 30 });
  assert.equal(feed.packet('ann'), null, 'nothing to show yet');
  const alice = new SnapshotReceiver({ schema, capacity: CAP }), bob = new SnapshotReceiver({ schema, capacity: CAP });
  feed.add('alice'); feed.add('bob'); assert.equal(feed.size, 2);
  for (let i = 0; i < 29; i++) feed.push(snaps[i]);
  assert.equal(feed.packet('alice'), null, 'fewer than 30 ticks old: not yet');
  let fullBytes = 0, deltaBytes = 0;
  for (let i = 29; i < 120; i++) {
    feed.push(snaps[i]);
    const target = snaps[i].tick - 30;
    for (const [name, rx] of [['alice', alice], ['bob', bob]]) {
      if (name === 'bob' && i % 3 === 0) continue;                                   // bob acknowledges late sometimes
      const p = feed.packet(name, name === 'bob' && i % 3 === 1 ? rx.ackTick : rx.ackTick);
      if (!p) continue;
      const got = rx.receive(p); assert.ok(got, `${name} read a packet at ${i}`);
      assert.ok(got.tick <= target && got.tick >= target - 0, `the viewer is shown tick ${got.tick} when the game is at ${snaps[i].tick}`);
      same(got, snaps[got.tick - 1], `${name} at ${got.tick}`);
      if (rx.stats.snapshots === 1) fullBytes = p.length; else deltaBytes = Math.max(deltaBytes, p.length);
    }
  }
  assert.ok(deltaBytes < fullBytes * 0.6, `deltas are smaller than the first full snapshot: ${deltaBytes} vs ${fullBytes}`);
  assert.equal(alice.latestTick, 120 - 30); assert.ok(feed.stats.cacheHits > 0, 'spectators with the same starting point got the same bytes');
  assert.ok(feed.stats.encodes < feed.stats.cacheHits + feed.stats.encodes, 'and were encoded once');
  const a = feed.packet('x', 100), b = feed.packet('y', 100); assert.ok(a === b || (a === null && b === null), 'one packet object for the same baseline');
  assert.equal(feed.packet('alice', feed.targetTick), null, 'a spectator who is up to date gets nothing');
  feed.remove('bob'); assert.equal(feed.size, 1);
});

test('a spectator whose acknowledgement is too old, or missing, gets a full snapshot; one dropped packet only costs a resend', () => {
  const snaps = match(300), feed = new SpectatorFeed({ schema, worldCapacity: CAP, delayTicks: 0, ackLag: 8 }), rx = new SnapshotReceiver({ schema, capacity: CAP });
  let drops = 0, lastFull = 0;
  for (let i = 0; i < 300; i++) {
    feed.push(snaps[i]);
    const p = feed.packet('v', rx.ackTick);
    if (!p) continue;
    if (i % 7 === 3) { drops++; continue; }                                               // lost in transit
    const got = rx.receive(p); assert.ok(got); same(got, snaps[got.tick - 1], `tick ${got.tick}`);
    if (p.length > 600) lastFull++;
  }
  assert.ok(drops > 30); assert.equal(rx.latestTick, 300);
  const late = new SnapshotReceiver({ schema, capacity: CAP }), p0 = feed.packet('late', 1);  // acknowledges something long gone
  const got = late.receive(p0); assert.ok(got); same(got, snaps[299]);
  void lastFull;
});

test('the receiver asks for a full snapshot when it lacks a baseline, ignores late and repeated packets, and survives garbage', () => {
  const snaps = match(60), feed = new SpectatorFeed({ schema, worldCapacity: CAP }), rx = new SnapshotReceiver({ schema, capacity: CAP });
  feed.push(snaps[0]); const full = feed.packet('v', -1); assert.ok(rx.receive(full));
  feed.push(snaps[1]); feed.packet('w', -1);                                              // a packet the viewer never gets
  feed.push(snaps[2]); const delta = feed.packet('v', 2);                                 // a delta from tick 2, which `rx` does not have
  assert.equal(rx.receive(delta), null); assert.equal(rx.needsFull, true); assert.equal(rx.ackTick, -1); assert.equal(rx.stats.missing, 1);
  const again = feed.packet('v', rx.ackTick); const ok = rx.receive(again); assert.ok(ok); assert.equal(rx.needsFull, false); assert.equal(rx.ackTick, 3);
  assert.equal(rx.receive(again), null); assert.equal(rx.stats.stale, 1);
  assert.equal(rx.receive(new Uint8Array([5, 0, 99, 1, 2, 3])), null); assert.equal(rx.receive(new Uint8Array(0)), null); assert.ok(rx.stats.bad >= 2);
  const w = new BinaryWriter(); w.u8(0); w.varuint(9); w.varuint(0);                      // a bare, header-less snapshot (as in a replay file)
  assert.ok(new SnapshotReceiver({ schema, capacity: CAP }).receive(w.finish(), { header: false }) !== undefined);
});

test('spectating every third tick sends a third of the packets and still shows a consistent world', () => {
  const snaps = match(120), feed = new SpectatorFeed({ schema, worldCapacity: CAP, delayTicks: 10, every: 3 }), rx = new SnapshotReceiver({ schema, capacity: CAP });
  let sent = 0;
  for (const s of snaps) { feed.push(s); const p = feed.packet('v', rx.ackTick); if (p) { sent++; const got = rx.receive(p); same(got, snaps[got.tick - 1]); } }
  assert.ok(sent > 25 && sent < 55, `${sent} packets for 120 ticks`);
  assert.equal(feed.stats.stored, 40);
  assert.throws(() => feed.push(snaps[0]), /must increase/);
});
