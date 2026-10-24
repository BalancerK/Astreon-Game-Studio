import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World, defineComponent } from '../../core/src/index.js';
import {
  BinaryWriter, BinaryReader, NetSchema, SnapshotCodec, SnapshotHistory, MissingBaselineError, ProtocolError,
  InputSchema, InputBatch, encodeInput, decodeInput, packetType, MSG, q, u8,
} from '../../protocol/src/index.js';
import { MemoryNetwork, CHANNEL, createRng } from '../src/index.js';

const Pos = defineComponent('g:pos', { x: 'f32', y: 'f32' });
const Hp = defineComponent('g:hp', { hp: 'u8' });
const schema = new NetSchema([
  { component: Pos, codecs: { x: q(-500, 500, 16), y: q(-500, 500, 16) } },
  { component: Hp, codecs: { hp: u8 } },
]);
const inputSchema = new InputSchema({ buttons: u8 });
const CAP = 64;
const TICK_MS = 50;

/**
 * Server simulates a random-walking world and streams delta snapshots over an
 * unreliable channel against the latest tick the client acked; the client
 * decodes with its own history and acks via input packets. Every snapshot the
 * client accepts must equal what the server had at that tick.
 */
function run({ link, seed, ticks = 300, quietTicks = 60, moveFraction = 0.5 }) {
  const net = new MemoryNetwork({ seed, link });
  const listener = net.listen('game');
  const rand = createRng(seed + 1000);

  // ---- server ----
  const world = new World(CAP);
  world.register(Pos);
  world.register(Hp);
  const serverCodec = new SnapshotCodec(schema, CAP);
  const serverHistory = new SnapshotHistory(schema, CAP, 32);
  const truth = new Map(); // tick -> copy of server snapshot values, for verification
  const ids = new Uint32Array(CAP);
  const w = new BinaryWriter(4096);
  const inBatch = new InputBatch(inputSchema);
  let serverConn = null, ackTick = 0, newestSeq = -1, serverTick = 0;
  const stats = { deltas: 0, fulls: 0, staleInputs: 0, deltaBytes: 0, fullBytes: 0 };

  listener.onConnection = (c) => {
    serverConn = c;
    c.onMessage = (bytes) => {
      if (packetType(bytes) !== MSG.INPUT) return;
      decodeInput(new BinaryReader(bytes), inBatch);
      const last = inBatch.firstSeq + inBatch.count - 1;
      if (last <= newestSeq) { stats.staleInputs++; return; } // duplicate or reordered
      newestSeq = last;
      ackTick = inBatch.ackTick; // 0 = "send me a full snapshot"
    };
  };

  for (let i = 0; i < 20; i++) {
    const e = world.create();
    world.add(e, Pos, { x: rand() * 400 - 200, y: rand() * 400 - 200 });
    if (i % 3 === 0) world.add(e, Hp, { hp: 100 });
  }

  function serverTickStep(active) {
    serverTick++;
    if (active) {
      const n = world.query(ids, [Pos]);
      for (let k = 0; k < n; k++) {
        if (rand() >= moveFraction) continue; // only some entities move each tick
        const i = ids[k] & 0xfffff;
        world.data(Pos).x[i] += (rand() - 0.5) * 8;
        world.data(Pos).y[i] += (rand() - 0.5) * 8;
      }
      if (rand() < 0.1 && n > 5) world.destroy(ids[(rand() * n) | 0]);
      if (rand() < 0.1) { const e = world.create(); world.add(e, Pos, { x: 0, y: 0 }); if (rand() < 0.5) world.add(e, Hp, { hp: 50 }); }
    }
    const slot = serverHistory.acquire();
    const n = world.query(ids, [Pos]);
    slot.capture(world, serverTick, ids, n);
    serverHistory.commit(slot);
    truth.set(serverTick, { ids: slot.ids.slice(0, n), masks: slot.masks.slice(0, n), vals: slot.vals.slice(0, n * schema.fieldCount) });
    if (!serverConn) return;
    const baseline = ackTick > 0 ? serverHistory.get(ackTick) : undefined;
    w.reset();
    w.u8(MSG.SNAPSHOT);
    serverCodec.encode(w, slot, baseline ?? null);
    if (w.bytes[1] === 1) { stats.deltas++; stats.deltaBytes += w.pos; } else { stats.fulls++; stats.fullBytes += w.pos; } // byte 1 = snapshot kind
    serverConn.send(w.finish(), CHANNEL.UNRELIABLE);
  }

  // ---- client ----
  const clientCodec = new SnapshotCodec(schema, CAP);
  const clientHistory = new SnapshotHistory(schema, CAP, 32);
  const client = net.connect('game');
  const batch = new InputBatch(inputSchema);
  const cw = new BinaryWriter(256);
  let latestTick = 0, seq = 0, needFull = false;
  const accepted = [];
  const errors = { missing: 0, stale: 0, protocol: 0 };

  client.onMessage = (bytes) => {
    if (packetType(bytes) !== MSG.SNAPSHOT) return;
    const r = new BinaryReader(bytes);
    r.u8();
    const slot = clientHistory.acquire();
    try {
      clientCodec.decode(r, (t) => clientHistory.get(t), slot);
    } catch (e) {
      if (e instanceof MissingBaselineError) { errors.missing++; needFull = true; return; }
      if (e instanceof ProtocolError) { errors.protocol++; return; }
      throw e;
    }
    if (slot.tick <= latestTick) { errors.stale++; return; } // duplicate / out of order: discard
    latestTick = slot.tick;
    needFull = false;
    clientHistory.commit(slot);
    accepted.push(slot.tick);
    // verify against the server's truth for that tick
    const t = truth.get(slot.tick);
    assert.equal(slot.count, t.ids.length, `tick ${slot.tick} entity count`);
    assert.deepEqual([...slot.ids.subarray(0, slot.count)], [...t.ids], `tick ${slot.tick} ids`);
    assert.deepEqual([...slot.masks.subarray(0, slot.count)], [...t.masks], `tick ${slot.tick} masks`);
    assert.deepEqual([...slot.vals.subarray(0, slot.count * schema.fieldCount)], [...t.vals], `tick ${slot.tick} values`);
  };

  function clientTickStep() {
    seq++;
    batch.clear();
    batch.ackTick = needFull ? 0 : latestTick;
    batch.firstSeq = Math.max(1, seq - 2);
    for (let s = batch.firstSeq; s <= seq; s++) batch.push(0, [s & 255]); // redundant last 3 inputs
    cw.reset();
    encodeInput(cw, batch);
    client.send(cw.finish(), CHANNEL.UNRELIABLE);
  }

  const total = ticks + quietTicks;
  for (let t = 0; t < total; t++) {
    net.clock.schedule(t * TICK_MS, () => serverTickStep(t < ticks));
    net.clock.schedule(t * TICK_MS + 7, clientTickStep);
  }
  net.clock.runAll();
  return { accepted, errors, stats, latestTick, serverTick, truth, clientHistory, total };
}

test('chaotic world (half the entities move every tick): falls back to full snapshots, stays correct', () => {
  const r = run({ seed: 9, moveFraction: 0.5, link: { latencyMs: 40, jitterMs: 25, loss: 0.3, duplicate: 0.05, reorder: 0.1 } });
  assert.ok(r.accepted.length > r.total * 0.3, `accepted ${r.accepted.length}/${r.total}`);
  assert.ok(r.stats.fulls > 0, 'full snapshots were used when deltas would not pay off');
  assert.ok(r.latestTick >= r.serverTick - 10);
});

test('delta replication converges and every accepted snapshot matches the server (30% loss, dup, reorder)', () => {
  const r = run({ seed: 7, moveFraction: 0.08, link: { latencyMs: 40, jitterMs: 25, loss: 0.3, duplicate: 0.05, reorder: 0.1 } });
  assert.ok(r.accepted.length > r.total * 0.3, `client accepted ${r.accepted.length}/${r.total} snapshots`);
  assert.deepEqual(r.accepted, [...r.accepted].sort((a, b) => a - b), 'accepted ticks strictly increase');
  assert.ok(r.stats.deltas > r.stats.fulls, `mostly deltas (${r.stats.deltas} vs ${r.stats.fulls} fulls)`);
  const avgDelta = r.stats.deltaBytes / r.stats.deltas;
  const avgFull = r.stats.fullBytes / Math.max(1, r.stats.fulls);
  assert.ok(avgDelta < avgFull, `deltas (${avgDelta.toFixed(0)}B) smaller than fulls (${avgFull.toFixed(0)}B)`);
  assert.ok(r.latestTick >= r.serverTick - 10, `client caught up (latest ${r.latestTick} of ${r.serverTick})`);
});

test('replication recovers from extreme conditions via full-snapshot resync', () => {
  const r = run({ seed: 21, ticks: 400, link: { latencyMs: 80, jitterMs: 120, loss: 0.6, duplicate: 0.2, reorder: 0.3 } });
  assert.ok(r.accepted.length > 20, `still made progress (${r.accepted.length} snapshots)`);
  assert.ok(r.latestTick >= r.serverTick - 20, `caught up after the quiet period (latest ${r.latestTick} of ${r.serverTick})`);
});

test('perfect network: every snapshot after connect arrives and is verified', () => {
  const r = run({ seed: 1, link: { latencyMs: 20 } });
  assert.equal(r.errors.missing, 0);
  assert.equal(r.errors.stale, 0);
  assert.ok(r.accepted.length >= r.total - 3, `accepted ${r.accepted.length}/${r.total}`);
});
