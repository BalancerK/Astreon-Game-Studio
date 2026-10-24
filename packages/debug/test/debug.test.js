import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TimeSeries, PacketLog, OverlayModel, drawGraph, niceCeil } from '../src/index.js';
import { MemoryNetwork, CHANNEL } from '../../transport/src/index.js';
import { BinaryWriter, MSG, writeSnapshotHeader, encodeHello } from '../../protocol/src/index.js';

/** Fake 2D context that records the path so graph geometry can be checked. */
function fakeCtx() {
  const ctx = { rects: [], strokes: [], path: [], alpha: 1 };
  Object.assign(ctx, {
    fillRect: (...a) => ctx.rects.push(a),
    beginPath: () => { ctx.path = []; },
    moveTo: (x, y) => ctx.path.push(['m', x, y]),
    lineTo: (x, y) => ctx.path.push(['l', x, y]),
    stroke: () => ctx.strokes.push({ color: ctx.strokeStyle, path: ctx.path.slice() }),
  });
  return ctx;
}

test('TimeSeries wraps around, keeps order, and ignores NaN in statistics', () => {
  const s = new TimeSeries(4);
  assert.deepEqual(Object.values(s.stats()).map((v) => (Number.isNaN(v) ? 'nan' : v)), ['nan', 'nan', 'nan', 'nan', 0]);
  for (const v of [1, 2, 3]) s.push(v);
  assert.equal(s.length, 3);
  s.push(NaN); s.push(10); s.push(20); // overwrites 1 and 2
  assert.deepEqual([...Array(4)].map((_, i) => s.at(i)).map((v) => (Number.isNaN(v) ? 'nan' : v)), [3, 'nan', 10, 20]);
  const st = s.stats();
  assert.deepEqual([st.last, st.min, st.max, st.samples], [20, 3, 20, 3]);
  assert.ok(Math.abs(st.avg - 11) < 1e-6);
  assert.equal(s.stats(2).min, 10, 'window of the newest 2 samples');
  s.clear();
  assert.equal(s.length, 0);
});

test('niceCeil rounds up to 1, 2, 5 x 10^n', () => {
  const cases = [[0, 1], [0.3, 0.5], [0.07, 0.1], [1, 1], [1.2, 2], [3, 5], [7, 10], [10, 10], [11, 20], [48, 50], [51, 100], [4096, 5000]];
  for (const [v, want] of cases) assert.ok(Math.abs(niceCeil(v) - want) < 1e-9, `niceCeil(${v}) = ${niceCeil(v)}, want ${want}`);
});

test('drawGraph maps values into the rectangle, newest at the right, gaps break the line', () => {
  const s = new TimeSeries(5);
  for (const v of [0, 5, NaN, 10, 5]) s.push(v);
  const ctx = fakeCtx();
  const range = drawGraph(ctx, s, { x: 10, y: 20, w: 100, h: 40 }, { color: '#fff' });
  assert.deepEqual(range, { min: 0, max: 10 });
  assert.deepEqual(ctx.rects[0].slice(0, 4), [10, 20, 100, 40], 'background fills the rectangle');
  const pts = ctx.strokes.flatMap((st) => st.path);
  for (const [, x, y] of pts) assert.ok(x >= 10 - 1e-9 && x <= 110 + 1e-9 && y >= 20 - 1e-9 && y <= 60 + 1e-9, `point ${x},${y} inside`);
  const last = pts[pts.length - 1];
  assert.deepEqual([last[1], last[2]], [110, 40], 'newest value 5 of max 10 sits mid-height at the right edge');
  const first = pts[0];
  assert.deepEqual([first[1], first[2]], [10, 60], 'oldest value 0 is on the baseline at the left edge');
  assert.equal(pts.filter((p) => p[0] === 'm').length, 2, 'NaN gap starts a new segment');
});

test('drawGraph clamps out-of-range values, honours a fixed max, and colours values above the warning level', () => {
  const s = new TimeSeries(3);
  for (const v of [50, 500, 50]) s.push(v);
  const ctx = fakeCtx();
  const range = drawGraph(ctx, s, { x: 0, y: 0, w: 60, h: 30 }, { max: 100, warnAbove: 80, color: 'ok', warnColor: 'hot' });
  assert.equal(range.max, 100);
  const ys = ctx.strokes.flatMap((st) => st.path).map((p) => p[2]);
  assert.ok(ys.every((y) => y >= 0 && y <= 30), 'clamped into the rectangle');
  assert.ok(ys.includes(0), 'the 500 spike is clamped to the top');
  assert.ok(ctx.strokes.some((st) => st.color === 'hot') && ctx.strokes.some((st) => st.color === 'ok'), 'warning segment coloured differently');
  assert.doesNotThrow(() => drawGraph(fakeCtx(), new TimeSeries(3), { x: 0, y: 0, w: 10, h: 10 }), 'empty series');
});

test('PacketLog keeps the newest entries, counts totals, and freezes while paused', () => {
  const log = new PacketLog(3);
  const e = (n, dir = 'in', type = 'SNAPSHOT') => ({ time: n, dir, channel: 1, size: 10 * n, type, summary: `#${n}` });
  for (let n = 1; n <= 5; n++) log.add(e(n));
  assert.deepEqual(log.entries().map((x) => x.summary), ['#5', '#4', '#3']);
  assert.deepEqual(log.entries(2).map((x) => x.summary), ['#5', '#4']);
  log.paused = true;
  log.add(e(6, 'out', 'INPUT'));
  assert.deepEqual(log.entries().map((x) => x.summary), ['#5', '#4', '#3'], 'list frozen');
  assert.deepEqual(log.total('in'), { count: 5, bytes: 150 });
  assert.deepEqual(log.total('out'), { count: 1, bytes: 60 }, 'totals keep counting');
  assert.equal(log.totals.get('out:INPUT').count, 1);
  log.clear();
  assert.equal(log.entries().length, 0);
});

test('OverlayModel samples gauges and rates, survives failing probes, and formats info lines', () => {
  let now = 0, bytes = 0, level = 5;
  const m = new OverlayModel({ now: () => now, samples: 10 });
  m.addSeries('level', { read: () => level, scale: 2, unit: 'x' });
  m.addSeries('down', { read: () => bytes, rate: true, scale: 1 / 1024, unit: 'KB/s' });
  m.addSeries('broken', { read: () => { throw new Error('boom'); } });
  m.addSeries('nan', { read: () => 'text' });
  m.addInfo('state', () => 'playing').addInfo('bad', () => { throw new Error('x'); });

  m.sample();                       // t = 0: first rate sample has nothing to diff against
  now = 500; bytes = 2048; level = 6; m.sample();   // 2 KB in 0.5 s = 4 KB/s
  now = 1500; bytes = 2048; m.sample();             // idle for 1 s
  const down = m.series.get('down').data, level2 = m.series.get('level').data;
  assert.ok(Number.isNaN(down.at(0)));
  assert.ok(Math.abs(down.at(1) - 4) < 1e-6 && Math.abs(down.at(2)) < 1e-9);
  assert.deepEqual([level2.at(0), level2.at(1)], [10, 12], 'scale applied');
  assert.ok(Number.isNaN(m.series.get('broken').data.at(0)) && Number.isNaN(m.series.get('nan').data.at(0)));
  assert.deepEqual(m.infoLines(), [['state', 'playing'], ['bad', '?']]);
});

test('OverlayModel.tap logs and decodes real packets in both directions', () => {
  const net = new MemoryNetwork({ link: { latencyMs: 10 } });
  let server;
  net.listen('g').onConnection = (c) => { server = c; };
  const raw = net.connect('g');
  net.clock.runUntil(100);
  const model = new OverlayModel({ now: () => net.clock.now() });
  const client = model.tap(raw);
  client.onMessage = () => {};

  const w = new BinaryWriter();
  encodeHello(w, { schemaHash: 0xbeef, inputHash: 2 });
  client.send(w.finish(), CHANNEL.RELIABLE);
  w.reset();
  writeSnapshotHeader(w, 12);
  w.u8(0); w.varuint(500); w.varuint(0); // full snapshot header with 0 entities
  server.send(w.finish(), CHANNEL.UNRELIABLE);
  server.send(Uint8Array.from([MSG.SNAPSHOT]), CHANNEL.UNRELIABLE); // truncated
  net.clock.runAll();

  const entries = model.packets.entries();
  assert.equal(entries.length, 3);
  assert.deepEqual(entries.map((e) => `${e.dir}:${e.type}:${e.channel}`).sort(), ['in:INVALID:1', 'in:SNAPSHOT:1', 'out:HELLO:0']);
  assert.equal(entries[entries.length - 1].type, 'HELLO', 'oldest (the first thing sent) is last: newest-first order');
  assert.match(entries.find((e) => e.type === 'SNAPSHOT').summary, /tick 500 full, 0 entities, input ack 12/);
  assert.match(entries.find((e) => e.type === 'HELLO').summary, /schema beef/);
});
