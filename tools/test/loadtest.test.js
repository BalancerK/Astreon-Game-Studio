import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Histogram, combine, summarize, evaluate, formatReport, DEFAULT_LIMITS } from '../loadtest-lib.js';

test('a histogram gives percentiles to its bucket width, keeps the true maximum, and adds up across threads', () => {
  const h = new Histogram(1, 100);
  for (let i = 1; i <= 100; i++) h.record(i - 0.5);          // 0.5 .. 99.5, one per bucket
  assert.equal(h.n, 100); assert.equal(h.percentile(0.5), 50); assert.equal(h.percentile(0.99), 99); assert.equal(h.percentile(1), 100 === 100 ? h.max : 0);
  assert.ok(Math.abs(h.mean - 50) < 1e-9);
  const big = new Histogram(1, 10); big.record(3); big.record(5000);
  assert.equal(big.percentile(1), 5000, 'the top bucket reports the real maximum, not its edge');
  assert.equal(new Histogram().percentile(0.5), 0, 'empty');
  const a = new Histogram(10, 50), b = new Histogram(10, 50);
  [5, 15, 25].forEach((v) => a.record(v)); [35, 45, 400].forEach((v) => b.record(v));
  a.merge(b); assert.equal(a.n, 6); assert.equal(a.max, 400); assert.equal(a.percentile(0.5), 30);
  const copy = Histogram.from(JSON.parse(JSON.stringify(a)));
  assert.equal(copy.percentile(0.5), 30); assert.equal(copy.n, 6); assert.equal(copy.max, 400);
});

const report = (t = {}) => ({
  bots: 100, started: 100, playing: 100, failedToJoin: 0, dropped: 0, snapshots: 100 * 60 * 10, bytesDown: 100 * 6000 * 10, bytesUp: 100 * 1600 * 10, loopLagP99: 5,
  handshake: (() => { const h = new Histogram(10, 3000); for (let i = 0; i < 100; i++) h.record(30 + i); return h.toJSON(); })(),
  gap: (() => { const h = new Histogram(1, 1000); for (let i = 0; i < 1000; i++) h.record(16 + (i % 3)); return h.toJSON(); })(), rejected: [], ...t,
});
const serverSide = (o = {}) => ({ seconds: 10, rooms: [{ players: 50, tickMsAvg: 1, tickMsMax: 4 }, { players: 50, tickMsAvg: 1.5, tickMsMax: 9 }], serverLoopLagP99: 4, serverHeapMb: 120, ...o });

test('worker reports are added up and turned into per-player numbers', () => {
  const total = combine([report(), report({ failedToJoin: 2, playing: 98, loopLagP99: 9, rejected: ['x'] })]);
  assert.equal(total.bots, 200); assert.equal(total.playing, 198); assert.equal(total.failedToJoin, 2); assert.equal(total.loopLagP99, 9); assert.equal(total.handshake.n, 200); assert.deepEqual(total.rejected, ['x']);
  const r = summarize(combine([report()]), serverSide());
  assert.equal(r.players.playing, 100); assert.equal(r.snapshotsPerSecondPerPlayer, 60); assert.equal(r.downKBpsPerPlayer, 6000 / 1024 * 1); assert.equal(r.server.rooms, 2);
  assert.equal(r.server.worstRoomTickMsAvg, 1.5); assert.equal(r.server.worstTickMs, 9); assert.ok(Math.abs(r.server.tickBudgetMs - 16.667) < 0.01); assert.equal(r.snapshotGapMs.p50, 18);
});

test('a healthy run passes; each kind of trouble is named, and overloaded bots are not blamed on the server', () => {
  const ok = summarize(combine([report()]), serverSide());
  assert.deepEqual(evaluate(ok), []);
  const bad = (t, s) => evaluate(summarize(combine([report(t)]), serverSide(s)));
  assert.match(bad({ failedToJoin: 5, playing: 95 })[0], /5 of 100 players could not join/);
  assert.match(bad({ dropped: 1 })[0], /1 players were disconnected/);
  assert.match(bad({}, { rooms: [{ players: 100, tickMsAvg: 12, tickMsMax: 30 }] })[0], /a room's average tick took 12\.00 ms/);
  const slow = report({ gap: (() => { const h = new Histogram(1, 1000); for (let i = 0; i < 100; i++) h.record(i < 90 ? 16 : 400); return h.toJSON(); })() });
  assert.match(evaluate(summarize(combine([slow]), serverSide()))[0], /snapshots arrived with gaps: p99 40[01] ms/);
  const overloaded = evaluate(summarize(combine([report({ loopLagP99: 200, gap: slow.gap })]), serverSide()));
  assert.equal(overloaded.length, 1); assert.match(overloaded[0], /bot threads were overloaded/);
  assert.deepEqual(evaluate(summarize(combine([slow]), serverSide()), { maxSnapshotGapP99Ms: 1000 }), [], 'limits can be changed');
  assert.ok(DEFAULT_LIMITS.maxWorstRoomTickMsAvg < 16.7, 'the default tick limit is well inside the 60 Hz budget');
  assert.match(formatReport(ok, ['PROBLEM here']), /PROBLEM: PROBLEM here/);
  assert.match(formatReport(ok), /100 playing of 100 requested[\s\S]*snapshot gaps[\s\S]*server +2 rooms, 100 players/);
});
