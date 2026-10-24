import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World, defineComponent, INDEX_MASK } from '../../core/src/index.js';
import {
  BinaryWriter, BinaryReader, ProtocolError, NetSchema, Snapshot, SnapshotCodec, MissingBaselineError,
  q, u8, u16, i16, f32, quantizationStep, InputSchema, InputBatch, encodeInput, decodeInput,
  encodeHello, decodeHello, encodeWelcome, decodeWelcome, encodeReject, decodeReject, REJECT, PROTOCOL_VERSION,
} from '../src/index.js';

const Pos = defineComponent('game:pos', { x: 'f32', y: 'f32' });
const Hp = defineComponent('game:hp', { hp: 'u8' });
const schema = new NetSchema([
  { component: Pos, codecs: { x: q(-1000, 1000, 16), y: q(-1000, 1000, 16) } },
  { component: Hp, codecs: { hp: u8 } },
]);
const CAP = 64;

function makeWorld() {
  const w = new World(CAP);
  w.register(Pos);
  w.register(Hp);
  return w;
}

function capture(world, tick) {
  const ids = new Uint32Array(CAP);
  const n = world.query(ids, [Pos]);
  // query is ascending by slot already; also include hp-only entities if any
  const s = new Snapshot(schema, CAP);
  s.capture(world, tick, ids, n);
  return s;
}

const roundTrip = (codec, cur, base, held) => {
  const w = new BinaryWriter(16);
  codec.encode(w, cur, base);
  const bytes = w.finish();
  const out = new Snapshot(schema, CAP);
  codec.decode(new BinaryReader(bytes), (t) => held.get(t), out);
  return { out, size: bytes.length };
};

function assertSame(a, b) {
  assert.equal(a.tick, b.tick);
  assert.equal(a.count, b.count);
  for (let i = 0; i < a.count; i++) {
    assert.equal(a.ids[i], b.ids[i], `id row ${i}`);
    assert.equal(a.masks[i], b.masks[i], `mask row ${i}`);
  }
  assert.deepEqual([...a.vals.subarray(0, a.count * schema.fieldCount)], [...b.vals.subarray(0, b.count * schema.fieldCount)]);
}

test('binary writer/reader round trip all types and enforce bounds', () => {
  const w = new BinaryWriter(2); // forces growth
  w.u8(255); w.i8(-5); w.u16(65535); w.i16(-300); w.u32(4294967295); w.i32(-7);
  w.f32(1.5); w.f64(Math.PI); w.varuint(0); w.varuint(127); w.varuint(128); w.varuint(4294967295); w.string('héllo ✓');
  const r = new BinaryReader(w.finish());
  assert.deepEqual([r.u8(), r.i8(), r.u16(), r.i16(), r.u32(), r.i32(), r.f32(), r.f64()], [255, -5, 65535, -300, 4294967295, -7, 1.5, Math.PI]);
  assert.deepEqual([r.varuint(), r.varuint(), r.varuint(), r.varuint()], [0, 127, 128, 4294967295]);
  assert.equal(r.string(), 'héllo ✓');
  assert.equal(r.remaining, 0);
  assert.throws(() => r.u8(), ProtocolError);
  assert.throws(() => new BinaryReader(new Uint8Array([0xff, 0xff, 0xff, 0xff, 0xff, 0x7f])).varuint(), ProtocolError);
  assert.throws(() => new BinaryReader(new Uint8Array([200, 1])).string(), ProtocolError); // length > remaining
  assert.throws(() => new BinaryReader(new Uint8Array([2, 0xff, 0xfe])).string(), ProtocolError); // bad utf-8
});

test('quantization stays within half a step and clamps', () => {
  const c = q(-1000, 1000, 16);
  const step = quantizationStep(-1000, 1000, 16);
  for (let v = -1000; v <= 1000; v += 13.37) {
    assert.ok(Math.abs(c.dequantize(c.quantize(v)) - v) <= step / 2 + 1e-9);
  }
  assert.equal(c.dequantize(c.quantize(5000)), 1000);
  assert.equal(c.dequantize(c.quantize(NaN)), -1000);
  assert.equal(i16.quantize(40000), 32767);
});

test('full snapshot round trips', () => {
  const world = makeWorld();
  for (let i = 0; i < 5; i++) {
    const e = world.create();
    world.add(e, Pos, { x: i * 10.5, y: -i * 3 });
    if (i % 2 === 0) world.add(e, Hp, { hp: 100 - i });
  }
  const cur = capture(world, 7);
  const { out } = roundTrip(new SnapshotCodec(schema, CAP), cur, null, new Map());
  assertSame(cur, out);
  assert.ok(Math.abs(out.get(2, 0, 'x') - 21) <= quantizationStep(-1000, 1000, 16));
});

test('delta covers move, add, remove, slot reuse, component add/remove', () => {
  const codec = new SnapshotCodec(schema, CAP);
  const world = makeWorld();
  const e = [];
  for (let i = 0; i < 6; i++) { e.push(world.create()); world.add(e[i], Pos, { x: i, y: i }); }
  world.add(e[1], Hp, { hp: 50 });
  const base = capture(world, 10);
  const held = new Map([[10, base]]);

  world.data(Pos).x[e[0] & INDEX_MASK] = 500;      // field change
  world.destroy(e[2]);                              // removal
  const reused = world.create();                    // same slot, new generation
  world.add(reused, Pos, { x: 9, y: 9 });
  world.remove(e[1], Hp);                           // component removed
  world.add(e[3], Hp, { hp: 7 });                   // component added
  const newcomer = world.create();                  // brand new entity at the end
  world.add(newcomer, Pos, { x: -4, y: 4 });
  assert.equal(reused & INDEX_MASK, e[2] & INDEX_MASK);

  const cur = capture(world, 11);
  const { out, size } = roundTrip(codec, cur, base, held);
  assertSame(cur, out);

  const full = roundTrip(codec, cur, null, held);
  assert.ok(size < full.size, `delta (${size}B) smaller than full (${full.size}B)`);
});

test('unchanged world encodes as a tiny delta', () => {
  const codec = new SnapshotCodec(schema, CAP);
  const world = makeWorld();
  for (let i = 0; i < 20; i++) world.add(world.create(), Pos, { x: i, y: i });
  const base = capture(world, 1);
  const cur = capture(world, 2);
  const { out, size } = roundTrip(codec, cur, base, new Map([[1, base]]));
  assertSame(cur, out);
  assert.ok(size <= 6, `empty delta is ${size} bytes`);
});

test('missing baseline is reported so the client can request a full snapshot', () => {
  const codec = new SnapshotCodec(schema, CAP);
  const world = makeWorld();
  world.add(world.create(), Pos, { x: 1, y: 1 });
  const base = capture(world, 1), cur = capture(world, 2);
  const w = new BinaryWriter();
  codec.encode(w, cur, base);
  try {
    codec.decode(new BinaryReader(w.finish()), () => undefined, new Snapshot(schema, CAP));
    assert.fail('should throw');
  } catch (e) {
    assert.ok(e instanceof MissingBaselineError);
    assert.equal(e.baselineTick, 1);
  }
});

test('decoder only ever throws ProtocolError on garbage and truncation', () => {
  const codec = new SnapshotCodec(schema, CAP);
  const world = makeWorld();
  for (let i = 0; i < 10; i++) { const e = world.create(); world.add(e, Pos, { x: i, y: i }); world.add(e, Hp, { hp: i }); }
  const base = capture(world, 1);
  world.data(Pos).x[3] = 77;
  const cur = capture(world, 2);
  const w = new BinaryWriter();
  codec.encode(w, cur, base);
  const good = Uint8Array.from(w.finish());
  const held = new Map([[1, base]]);
  let seed = 99;
  const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  const out = new Snapshot(schema, CAP);
  for (let n = 0; n < good.length; n++) {
    assert.throws(() => codec.decode(new BinaryReader(good.subarray(0, n)), (t) => held.get(t), out), ProtocolError);
  }
  for (let trial = 0; trial < 5000; trial++) {
    const bad = Uint8Array.from(good);
    for (let k = 0; k < 1 + (rnd() * 4 | 0); k++) bad[(rnd() * bad.length) | 0] = (rnd() * 256) | 0;
    try { codec.decode(new BinaryReader(bad), (t) => held.get(t), out); } catch (e) {
      assert.ok(e instanceof ProtocolError, `unexpected ${e}`);
    }
  }
  for (let trial = 0; trial < 2000; trial++) {
    const junk = new Uint8Array((rnd() * 64) | 0).map(() => (rnd() * 256) | 0);
    try { codec.decode(new BinaryReader(junk), (t) => held.get(t), out); } catch (e) {
      assert.ok(e instanceof ProtocolError, `unexpected ${e}`);
    }
  }
});

test('schema hash changes when layout changes', () => {
  const a = new NetSchema([{ component: Pos, codecs: { x: q(-1000, 1000, 16), y: q(-1000, 1000, 16) } }]);
  const b = new NetSchema([{ component: Pos, codecs: { x: q(-1000, 1000, 16), y: q(-1000, 1000, 8) } }]);
  const c = new NetSchema([{ component: Pos, codecs: { x: q(-1000, 1000, 16), y: q(-1000, 1000, 16) } }]);
  assert.notEqual(a.hash, b.hash);
  assert.equal(a.hash, c.hash);
  assert.throws(() => new NetSchema([{ component: Pos, codecs: { nope: u8 } }]), /no field "nope"/);
});

test('handshake messages round trip', () => {
  const w = new BinaryWriter();
  encodeHello(w, { schemaHash: schema.hash, inputHash: 5, token: 'abc' });
  assert.deepEqual(decodeHello(new BinaryReader(w.finish())), { version: PROTOCOL_VERSION, schemaHash: schema.hash, inputHash: 5, token: 'abc' });
  w.reset();
  encodeWelcome(w, { clientId: 9, tickRate: 60, serverTick: 1234, plugins: [{ id: 'fx', version: '1.2.3', hash: 'c0ffee' }] });
  assert.deepEqual(decodeWelcome(new BinaryReader(w.finish())), { version: PROTOCOL_VERSION, clientId: 9, tickRate: 60, serverTick: 1234, plugins: [{ id: 'fx', version: '1.2.3', hash: 'c0ffee' }], resumed: false, session: '' });
  w.reset();
  encodeWelcome(w, { clientId: 9, tickRate: 60, serverTick: 1234, session: 'abc123', resumed: true });
  const resumedWelcome = decodeWelcome(new BinaryReader(w.finish()));
  assert.deepEqual([resumedWelcome.session, resumedWelcome.resumed], ['abc123', true]);
  w.reset();
  encodeReject(w, REJECT.SCHEMA_MISMATCH, 'nope');
  assert.deepEqual(decodeReject(new BinaryReader(w.finish())), { reason: REJECT.SCHEMA_MISMATCH, message: 'nope' });
  assert.throws(() => decodeHello(new BinaryReader(new Uint8Array([2]))), ProtocolError);
});

test('input packet carries redundant inputs and the snapshot ack', () => {
  const is = new InputSchema({ buttons: u16, moveX: q(-1, 1, 8), aim: q(0, 6.2832, 16), dash: f32 });
  const batch = new InputBatch(is);
  batch.ackTick = 300; batch.firstSeq = 1000;
  batch.push(10, [3, 1, 1.5, 0.25]);
  batch.push(200, [0, -1, 6.2832, 0]);
  batch.push(5, [65535, 0, 0, -2]);
  const w = new BinaryWriter();
  encodeInput(w, batch);
  const out = decodeInput(new BinaryReader(w.finish()), new InputBatch(is));
  assert.equal(out.ackTick, 300);
  assert.equal(out.firstSeq, 1000);
  assert.equal(out.count, 3);
  assert.deepEqual([...out.subTicks.subarray(0, 3)], [10, 200, 5]);
  assert.equal(out.values[0], 3);
  assert.ok(Math.abs(out.values[1] - 1) < 1e-9);
  assert.ok(Math.abs(out.values[2] - 1.5) < quantizationStep(0, 6.2832, 16));
  assert.equal(out.values[4 + 3], 0, 'input 1 dash');
  assert.equal(out.values[8 + 3], -2, 'input 2 dash');
  assert.throws(() => decodeInput(new BinaryReader(Uint8Array.from([4, 0, 0, 200])), new InputBatch(is)), ProtocolError);
});

test('encoder falls back to a full snapshot when most entities changed', () => {
  const codec = new SnapshotCodec(schema, CAP);
  const world = makeWorld();
  for (let i = 0; i < 8; i++) world.add(world.create(), Pos, { x: i, y: i });
  const base = capture(world, 1);
  for (let i = 0; i < 7; i++) world.data(Pos).x[i] += 5; // 7 of 8 changed
  const cur = capture(world, 2);
  const w = new BinaryWriter();
  codec.encode(w, cur, base);
  assert.equal(w.finish()[0], 1 - 1, 'kind byte is FULL (0)');
  // and it decodes without any baseline
  const out = new Snapshot(schema, CAP);
  codec.decode(new BinaryReader(w.finish()), () => undefined, out);
  assertSame(cur, out);
  // few changes still use a delta
  world.data(Pos).x[0] += 1;
  const cur2 = capture(world, 3);
  w.reset();
  codec.encode(w, cur2, cur);
  assert.equal(w.finish()[0], 1, 'kind byte is DELTA (1)');
});

test('SnapshotHistory: acquire/commit/get/around, evicts oldest, ignores uncommitted slots', async () => {
  const { SnapshotHistory } = await import('../src/index.js');
  const h = new SnapshotHistory(schema, 4, 3);
  const put = (tick) => { const s = h.acquire(); s.tick = tick; h.commit(s); };
  put(10); put(20); put(30);
  assert.equal(h.get(20).tick, 20);
  assert.equal(h.latest().tick, 30);
  const mid = h.around(25);
  assert.deepEqual([mid.before.tick, mid.after.tick], [20, 30]);
  assert.equal(h.around(20).before.tick, 20);
  assert.equal(h.around(5).before, undefined);
  assert.equal(h.around(99).after, undefined);
  put(40); // evicts tick 10
  assert.equal(h.get(10), undefined);
  const half = h.acquire(); // evicts 20; never committed
  half.tick = 999;
  assert.equal(h.get(999), undefined, 'uncommitted slot is invisible');
  assert.equal(h.get(20), undefined);
  assert.deepEqual([h.get(30).tick, h.get(40).tick], [30, 40]);
});

test('snapshot header carries the input ack', async () => {
  const { writeSnapshotHeader, readSnapshotHeader, MSG } = await import('../src/index.js');
  const w = new BinaryWriter();
  writeSnapshotHeader(w, 123456);
  const bytes = w.finish();
  assert.equal(bytes[0], MSG.SNAPSHOT);
  const r = new BinaryReader(bytes);
  assert.equal(readSnapshotHeader(r), 123456);
  assert.equal(r.remaining, 0);
  assert.throws(() => readSnapshotHeader(new BinaryReader(Uint8Array.from([1, 0]))), ProtocolError);
});
