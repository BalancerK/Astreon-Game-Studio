import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World, defineComponent } from '../../core/src/index.js';
import {
  BinaryWriter, BinaryReader, NetSchema, Snapshot, SnapshotCodec, InputSchema, InputBatch, MSG, REJECT, q, u16,
  encodeHello, encodeWelcome, encodeReject, encodeInput, writeSnapshotHeader, peekSnapshotHeader, describePacket,
} from '../src/index.js';

const Pos = defineComponent('d:pos', { x: 'f32', y: 'f32' });
const schema = new NetSchema([{ component: Pos, codecs: { x: q(-100, 100, 16), y: q(-100, 100, 16) } }]);
const CAP = 32;

function snapshotOf(world, tick) {
  const ids = new Uint32Array(CAP);
  const n = world.query(ids, [Pos]);
  const s = new Snapshot(schema, CAP);
  s.capture(world, tick, ids, n);
  return s;
}

test('describePacket summarises every message type', () => {
  const w = new BinaryWriter();
  encodeHello(w, { schemaHash: 0xabc, inputHash: 1 });
  assert.match(describePacket(w.finish()).summary, /protocol v1, schema abc/);

  w.reset();
  encodeWelcome(w, { clientId: 5, tickRate: 60, serverTick: 99, plugins: [{ id: 'a', version: '1.0.0', hash: 'ab' }] });
  assert.equal(describePacket(w.finish()).summary, 'client 5, 60 Hz, server tick 99, 1 plugin(s)');

  w.reset();
  encodeReject(w, REJECT.SERVER_FULL, 'full');
  assert.equal(describePacket(w.finish()).summary, 'SERVER_FULL: full');

  const batch = new InputBatch(new InputSchema({ buttons: u16 }));
  batch.ackTick = 40; batch.firstSeq = 7;
  batch.push(0, [1]); batch.push(0, [2]); batch.push(0, [3]);
  w.reset();
  encodeInput(w, batch);
  const input = describePacket(w.finish());
  assert.equal(input.type, 'INPUT');
  assert.equal(input.summary, 'seq 7..9 (3), snapshot ack 40');
});

test('describePacket reads snapshot headers exactly as the codec wrote them', () => {
  const codec = new SnapshotCodec(schema, CAP);
  const world = new World(CAP);
  world.register(Pos);
  const entities = [];
  for (let i = 0; i < 6; i++) { const e = world.create(); entities.push(e); world.add(e, Pos, { x: i, y: i }); }
  const base = snapshotOf(world, 10);
  world.data(Pos).x[entities[2] & 0xfffff] += 9; // one entity moves
  world.destroy(entities[3]);                     // one disappears
  const cur = snapshotOf(world, 11);

  const w = new BinaryWriter();
  writeSnapshotHeader(w, 77);
  codec.encode(w, base, null);
  assert.equal(describePacket(w.finish()).summary, 'tick 10 full, 6 entities, input ack 77');

  w.reset();
  writeSnapshotHeader(w, 78);
  codec.encode(w, cur, base);
  const d = describePacket(w.finish());
  assert.equal(d.type, 'SNAPSHOT');
  assert.deepEqual(
    [d.fields.kind, d.fields.tick, d.fields.baselineTick, d.fields.removed, d.fields.changed, d.fields.inputAck],
    ['delta', 11, 10, 1, 1, 78],
  );

  const r = new BinaryReader(w.finish());
  r.u8(); r.varuint();
  assert.equal(peekSnapshotHeader(r).tick, 11);
});

test('describePacket never throws, whatever the bytes', () => {
  assert.equal(describePacket(new Uint8Array(0)).type, 'INVALID');
  assert.equal(describePacket(Uint8Array.from([99, 1])).type, 'UNKNOWN');
  assert.equal(describePacket(Uint8Array.from([MSG.SNAPSHOT, 1])).type, 'INVALID', 'truncated snapshot');
  let seed = 5;
  for (let i = 0; i < 3000; i++) {
    const junk = new Uint8Array(1 + (i % 40)).map(() => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) >>> 24);
    junk[0] = 1 + (i % 5);
    assert.equal(typeof describePacket(junk).type, 'string');
  }
});
