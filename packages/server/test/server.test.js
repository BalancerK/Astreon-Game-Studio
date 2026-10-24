import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World, defineComponent } from '../../core/src/index.js';
import { BinaryWriter, BinaryReader, NetSchema, Snapshot, SnapshotCodec, SnapshotHistory, q, u8 } from '../../protocol/src/index.js';
import { InterestGrid, ClientReplicator } from '../src/index.js';

const SIZE = 2400;
const CAP = 2048;
const Pos = defineComponent('t:pos', { x: 'f32', y: 'f32' });
const Tag = defineComponent('t:tag', { kind: 'u8' });
const schema = new NetSchema([
  { component: Pos, codecs: { x: q(0, SIZE, 16), y: q(0, SIZE, 16) } },
  { component: Tag, codecs: { kind: u8 } },
]);

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

function makeWorld(n, r) {
  const world = new World(CAP);
  world.register(Pos);
  world.register(Tag);
  const ids = [];
  for (let i = 0; i < n; i++) {
    const e = world.create();
    world.add(e, Pos, { x: r() * SIZE, y: r() * SIZE });
    world.add(e, Tag, { kind: i % 7 });
    ids.push(e);
  }
  return { world, ids };
}

function wander(world, r, speed = 6) {
  const { x, y } = world.data(Pos);
  const n = world.entities.highWater;
  for (let i = 0; i < n; i++) {
    if (!world.entities.alive[i]) continue;
    x[i] = Math.min(SIZE - 1, Math.max(1, x[i] + (r() - 0.5) * speed));
    y[i] = Math.min(SIZE - 1, Math.max(1, y[i] + (r() - 0.5) * speed));
  }
}

const all = new Uint32Array(CAP);
function capture(world, tick, into) {
  const n = world.query(all, [Pos]);
  into.capture(world, tick, all, n);
  return into;
}

test('InterestGrid: radius, hysteresis, ordering, generations and the visible cap', () => {
  const world = new World(64);
  world.register(Pos);
  const mk = (x, y) => { const e = world.create(); world.add(e, Pos, { x, y }); return e; };
  const me = mk(1000, 1000);
  const near = mk(1100, 1000);   // 100 away
  const edge = mk(1000, 1190);   // 190 away: between enter (150) and leave (230)
  const far = mk(1000, 1400);    // 400 away
  const grid = new InterestGrid({ width: SIZE, height: SIZE, capacity: 64, cellSize: 200 });
  const prevMark = new Uint32Array(64);
  const out = new Uint32Array(64);
  const { x, y } = world.data(Pos);
  const run = (maxVisible = 64) => {
    const n = world.query(all, [Pos]);
    grid.rebuild(all, n, x, y);
    const m = grid.query({ cx: x[me & 0xfffff], cy: y[me & 0xfffff], enterRadius: 150, leaveRadius: 230, prevMark, generations: world.entities.generations, maxVisible, outIds: out });
    const ids = [...out.subarray(0, m)];
    prevMark.fill(0);
    for (const id of ids) prevMark[id & 0xfffff] = id + 1;
    return ids;
  };

  let ids = run();
  assert.deepEqual(ids, [me, near], 'only inside the enter radius, sorted by slot');
  assert.ok(!ids.includes(edge) && !ids.includes(far));

  y[near & 0xfffff] = 1190; // the neighbour drifts to the edge region: not yet visible would stay out, but it WAS visible
  assert.ok(run().includes(near), 'stays visible inside the leave radius (hysteresis)');
  y[near & 0xfffff] = 1300;
  assert.ok(!run().includes(near), 'dropped beyond the leave radius');
  y[edge & 0xfffff] = 1100; // inside enter radius now
  assert.ok(run().includes(edge), 'enters inside the enter radius');
  y[edge & 0xfffff] = 1190;
  assert.ok(run().includes(edge), 'then stays through the hysteresis band');
  y[edge & 0xfffff] = 1500;
  assert.ok(!run().includes(edge));

  // slot reuse: a recycled slot with a new generation is a different entity and does not inherit visibility
  world.destroy(near);
  const reborn = mk(1000, 1190);
  assert.equal(reborn & 0xfffff, near & 0xfffff);
  assert.ok(!run().includes(reborn), 'new generation in the hysteresis band is not "already visible"');

  // cap: the nearest win
  for (let i = 0; i < 20; i++) mk(1000 + i * 4, 1000 + (i % 3));
  const capped = run(6);
  assert.equal(capped.length, 6);
  assert.ok(capped.includes(me), 'the centre entity is always kept');
  assert.deepEqual(capped, [...capped].sort((a, b) => (a & 0xfffff) - (b & 0xfffff)), 'ids stay sorted by slot');
  void far;
});

/** Simulated client: decodes real packets with its own history and acks with a configurable lag. */
class FakeClient {
  constructor() {
    this.codec = new SnapshotCodec(schema, CAP);
    this.history = new SnapshotHistory(schema, CAP, 64);
    this.latest = 0;
    this.needFull = false;
  }

  receive(bytes) {
    const slot = this.history.acquire();
    try {
      this.codec.decode(new BinaryReader(bytes), (t) => this.history.get(t), slot);
    } catch (e) {
      if (e.name === 'MissingBaselineError') { this.needFull = true; return null; }
      throw e;
    }
    if (slot.tick <= this.latest) return null;
    this.history.commit(slot);
    this.latest = slot.tick;
    this.needFull = false;
    return slot;
  }
}

function sameView(a, b, F) {
  assert.equal(a.count, b.count, 'entity count');
  assert.deepEqual([...a.ids.subarray(0, a.count)], [...b.ids.subarray(0, b.count)], 'ids');
  assert.deepEqual([...a.masks.subarray(0, a.count)], [...b.masks.subarray(0, b.count)], 'masks');
  assert.deepEqual([...a.vals.subarray(0, a.count * F)], [...b.vals.subarray(0, b.count * F)], 'values');
}

/** Run a replicator for one wandering client for `ticks`, delivering packets with ack lag and loss. */
function simulate({ seed = 1, entities = 300, ticks = 300, replicator = {}, interest = { enter: 500, leave: 575 }, ackLag = () => 5, lossy = false, movingSelf = true }) {
  const r = rng(seed);
  const { world, ids } = makeWorld(entities, r);
  const self = ids[0];
  const full = new Snapshot(schema, CAP);
  const grid = new InterestGrid({ width: SIZE, height: SIZE, capacity: CAP, cellSize: 300 });
  const rep = new ClientReplicator({ schema, worldCapacity: CAP, maxVisible: 384, ...replicator });
  const client = new FakeClient();
  const vis = new Uint32Array(384);
  const w = new BinaryWriter(65536);
  const inFlight = [];
  const sent = []; // views the server sent, by tick, to compare with what the client reconstructs
  const { x, y } = world.data(Pos);
  const si = self & 0xfffff;
  const result = { checked: 0, bytes: [], freshByDistance: { near: 0, far: 0, nearN: 0, farN: 0 }, selfFresh: true, fulls: 0 };
  let ackAt = [];
  for (let tick = 1; tick <= ticks; tick++) {
    wander(world, r);
    if (movingSelf) { x[si] = Math.min(SIZE - 1, Math.max(1, x[si] + 4)); }
    capture(world, tick, full);
    const n = world.query(all, [Pos]);
    grid.rebuild(all, n, x, y);
    const m = grid.query({ cx: x[si], cy: y[si], enterRadius: interest.enter, leaveRadius: interest.leave, prevMark: rep.prevMark, generations: world.entities.generations, maxVisible: 384, outIds: vis });
    rep.setVisible(vis, m);
    const lastView = rep.history.latest();
    const lastCopy = lastView ? { ids: lastView.ids.slice(0, lastView.count), vals: lastView.vals.slice(0, lastView.count * schema.fieldCount), count: lastView.count } : null;
    const view = rep.buildView(full, tick, self, x[si], y[si], x, y);
    // self is always fresh: its row equals the world
    const selfRow = view.rowOf(self), srcRow = full.rowOf(self);
    for (let f = 0; f < schema.fieldCount; f++) if (view.vals[selfRow * schema.fieldCount + f] !== full.vals[srcRow * schema.fieldCount + f]) result.selfFresh = false;
    // per-distance freshness bookkeeping
    if (lastCopy) {
      for (let row = 0; row < view.count; row++) {
        const id = view.ids[row];
        if (id === self) continue;
        const lr = lastCopy.ids.indexOf(id);
        const freshNow = full.vals.subarray(full.rowOf(id) * schema.fieldCount, full.rowOf(id) * schema.fieldCount + 2).every((v, i) => v === view.vals[row * schema.fieldCount + i]);
        const wasSame = lr >= 0 && lastCopy.vals[lr * schema.fieldCount] === full.vals[full.rowOf(id) * schema.fieldCount] && lastCopy.vals[lr * schema.fieldCount + 1] === full.vals[full.rowOf(id) * schema.fieldCount + 1];
        const slot = id & 0xfffff;
        const d = Math.hypot(x[slot] - x[si], y[slot] - y[si]);
        const bucket = d < 200 ? 'near' : d > 380 ? 'far' : null;
        // every sighting counts in N; it counts as refreshed if the view holds this tick's value and it differs from last tick's
        if (bucket) { result.freshByDistance[bucket] += freshNow && !wasSame ? 1 : 0; result.freshByDistance[`${bucket}N`]++; }
      }
    }
    sent[tick] = { ids: view.ids.slice(0, view.count), masks: view.masks.slice(0, view.count), vals: view.vals.slice(0, view.count * schema.fieldCount), count: view.count };

    w.reset();
    const ack = client.needFull ? 0 : client.latest;
    rep.encode(w, ack, 3);
    result.bytes.push(w.pos + 3);
    inFlight.push({ at: tick + (lossy && r() < 0.15 ? 9999 : ackLag(tick, r)), tick, bytes: Uint8Array.from(w.finish()) });
    ackAt = inFlight.filter((p) => p.at <= tick).sort((a, b) => a.tick - b.tick);
    for (const p of ackAt) inFlight.splice(inFlight.indexOf(p), 1);
    for (const p of ackAt) {
      const got = client.receive(p.bytes);
      if (got) { sameView(got, { ...sent[got.tick], vals: sent[got.tick].vals }, schema.fieldCount); result.checked++; }
    }
  }
  result.rep = rep;
  result.client = client;
  return result;
}

test('replication with interest management reconstructs exactly what was sent, under ack lag and loss', () => {
  const r = simulate({ seed: 3, ticks: 250, lossy: true, ackLag: (t, rr) => 2 + Math.floor(rr() * 10) });
  assert.ok(r.checked > 100, `verified ${r.checked} views`);
  assert.ok(r.selfFresh, "the client's own entity is always current");
  assert.ok(r.rep.stats.visible > 5 && r.rep.stats.visible < 200, `sees ${r.rep.stats.visible} of 300 entities`);
});

test('interest management cuts bandwidth compared with sending the whole world', () => {
  const focused = simulate({ seed: 4, ticks: 200, interest: { enter: 450, leave: 520 } });
  const everything = simulate({ seed: 4, ticks: 200, interest: { enter: 5000, leave: 5000 } });
  const avg = (r) => r.bytes.slice(50).reduce((a, b) => a + b, 0) / (r.bytes.length - 50);
  assert.ok(avg(focused) < avg(everything) * 0.25, `focused ${avg(focused).toFixed(0)} B/tick vs everything ${avg(everything).toFixed(0)} B/tick`);
});

test('a bandwidth budget holds the average, favours near entities, and stays exactly consistent', () => {
  const scene = { seed: 5, ticks: 600, entities: 400, interest: { enter: 600, leave: 690 } };
  const perSec = (res) => (res.bytes.slice(200).reduce((a, b) => a + b, 0) / (res.bytes.length - 200)) * 60;
  const unbudgeted = perSec(simulate(scene));
  const budget = Math.round(unbudgeted * 0.4);
  const r = simulate({ ...scene, replicator: { bytesPerSecond: budget, tickRate: 60, minUpdates: 2 } });
  const avgPerSec = perSec(r);
  assert.ok(avgPerSec < budget * 1.3, `used ${avgPerSec.toFixed(0)} B/s against a ${budget} B/s budget (unbudgeted ${unbudgeted.toFixed(0)} B/s)`);
  assert.ok(avgPerSec > budget * 0.6, `and actually uses most of it (${avgPerSec.toFixed(0)} B/s)`);
  assert.ok(r.selfFresh, 'own entity stays fresh even when the budget is tight');
  const { near, nearN, far, farN } = r.freshByDistance;
  assert.ok(nearN > 50 && farN > 50, `enough samples (${nearN}, ${farN})`);
  assert.ok(near / nearN > (far / farN) * 1.5, `near entities refreshed more often (${(near / nearN).toFixed(2)} vs ${(far / farN).toFixed(2)} per sighting)`);
  assert.ok(r.checked > 300, 'every received view matched what the server sent');
});

test('a generous budget changes nothing: every visible entity stays fresh', () => {
  const free = simulate({ seed: 6, ticks: 200, replicator: { bytesPerSecond: Infinity } });
  const roomy = simulate({ seed: 6, ticks: 200, replicator: { bytesPerSecond: 10_000_000 } });
  assert.equal(roomy.rep.stats.stale, 0);
  assert.deepEqual(roomy.bytes, free.bytes, 'identical bytes on the wire');
});

test('entities entering view are sent immediately even when the budget is exhausted', () => {
  const r = simulate({ seed: 7, ticks: 400, entities: 300, interest: { enter: 300, leave: 345 }, replicator: { bytesPerSecond: 1500, minUpdates: 2 } });
  assert.ok(r.checked > 200);
  // every entity visible in the client's latest view has a fresh-enough value: not NaN/zeroed placeholders
  const view = r.client.history.latest();
  assert.ok(view.count > 0);
  for (let i = 0; i < view.count; i++) assert.ok(view.masks[i] & 1, 'every row carries a position');
});

test('positionAt reconstructs what the client was shown: interpolation, teleports, visibility', () => {
  const world = new World(CAP);
  world.register(Pos);
  world.register(Tag);
  const mk = (x, y) => { const e = world.create(); world.add(e, Pos, { x, y }); world.add(e, Tag, { kind: 1 }); return e; };
  const me = mk(500, 500), mover = mk(100, 100), hidden = mk(2300, 2300);
  const { x, y } = world.data(Pos);
  const full = new Snapshot(schema, CAP);
  const rep = new ClientReplicator({ schema, worldCapacity: CAP, maxVisible: 16, historySize: 16 });
  const vis = new Uint32Array(16);
  const path = [100, 140, 180, 2000, 2040]; // ticks 1..5: steady motion, then a respawn-style teleport
  for (let tick = 1; tick <= 5; tick++) {
    x[mover & 0xfffff] = path[tick - 1];
    capture(world, tick, full);
    vis[0] = me; vis[1] = mover; // `hidden` is never in this client's view
    rep.setVisible(vis, 2);
    rep.buildView(full, tick, me, x[me & 0xfffff], y[me & 0xfffff], x, y);
    rep.encode(new BinaryWriter(), 0);
  }
  const p = { x: 0, y: 0 };
  const near = (a, b) => Math.abs(a - b) < 0.1; // 16-bit quantization over 2400 units is ~0.04
  assert.ok(rep.positionAt(1.5, mover, p) && near(p.x, 120) && near(p.y, 100), 'halfway between ticks 1 and 2');
  assert.ok(rep.positionAt(2.25, mover, p) && near(p.x, 150), 'quarter of the way from tick 2 to 3');
  assert.ok(rep.positionAt(3, mover, p) && near(p.x, 180), 'exactly on a tick');
  assert.ok(rep.positionAt(3.5, mover, p) && near(p.x, 2000), 'does not interpolate across a teleport (respawn): shown at the new place');
  assert.ok(rep.positionAt(99, mover, p) && near(p.x, 2040), 'a tick beyond the newest view uses the newest');
  assert.ok(rep.positionAt(0.2, mover, p) && near(p.x, 100), 'before the oldest view uses the oldest');
  assert.equal(rep.positionAt(3, hidden, p), false, 'an entity the client never saw cannot be located');
  assert.equal(rep.positionAt(3, 0xdeadbee & 0xfffff, p), false, 'unknown id');
});

test('positionAt in 3D: interpolates all three coordinates and does not smear across a teleport', () => {
  const P3 = defineComponent('t:pos3', { x: 'f32', y: 'f32', z: 'f32' });
  const s3 = new NetSchema([{ component: P3, codecs: { x: q(-100, 100, 16), y: q(-100, 100, 16), z: q(-100, 100, 16) } }]);
  const world = new World(64);
  world.register(P3);
  const e = world.create();
  world.add(e, P3, { x: 0, y: 0, z: 0 });
  const d = world.data(P3);
  const full = new Snapshot(s3, 64);
  const rep = new ClientReplicator({ schema: s3, worldCapacity: 64, maxVisible: 8, historySize: 8, position: { component: 0, x: 'x', y: 'y', z: 'z' } });
  const vis = new Uint32Array(8);
  const path = [[0, 0, 0], [10, 4, -6], [20, 8, -12], [90, 8, -12]];
  for (let tick = 1; tick <= 4; tick++) {
    [d.x[0], d.y[0], d.z[0]] = path[tick - 1];
    const ids = new Uint32Array([e]);
    full.capture(world, tick, ids, 1);
    vis[0] = e;
    rep.setVisible(vis, 1);
    rep.buildView(full, tick, e, 0, 0, d.x, d.z);
    rep.encode(new BinaryWriter(), 0);
  }
  const p = { x: 0, y: 0, z: 0 };
  const near = (a, b) => Math.abs(a - b) < 0.01;
  assert.ok(rep.positionAt(1.5, e, p) && near(p.x, 5) && near(p.y, 2) && near(p.z, -3), 'halfway between ticks 1 and 2');
  assert.ok(rep.positionAt(2.5, e, p) && near(p.x, 15) && near(p.y, 6) && near(p.z, -9));
  assert.ok(rep.positionAt(3.5, e, p, 50) && near(p.x, 90), 'a jump of 70 m (respawn) is not interpolated across');
});
