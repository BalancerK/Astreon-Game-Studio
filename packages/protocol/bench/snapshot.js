// Run: node packages/protocol/bench/snapshot.js [entities]
import { World, defineComponent } from '../../core/src/index.js';
import { BinaryWriter, BinaryReader, NetSchema, Snapshot, SnapshotCodec, q } from '../src/index.js';

const N = Number(process.argv[2] ?? 100);
const CAP = Math.max(256, N);
const Pos = defineComponent('g:pos', { x: 'f32', y: 'f32' });
const Vel = defineComponent('g:vel', { x: 'f32', y: 'f32' });
const schema = new NetSchema([
  { component: Pos, codecs: { x: q(-2000, 2000, 16), y: q(-2000, 2000, 16) } },
  { component: Vel, codecs: { x: q(-100, 100, 16), y: q(-100, 100, 16) } },
]);
const world = new World(CAP);
world.register(Pos); world.register(Vel);
const ids = new Uint32Array(CAP);
for (let i = 0; i < N; i++) {
  const e = world.create();
  world.add(e, Pos, { x: i * 10 % 3000 - 1500, y: i * 7 % 3000 - 1500 });
  world.add(e, Vel, { x: 20, y: 5 });
}
const codec = new SnapshotCodec(schema, CAP);
const a = new Snapshot(schema, CAP), b = new Snapshot(schema, CAP), w = new BinaryWriter(65536);
const n = world.query(ids, [Pos]);
a.capture(world, 1, ids, n);

console.log(`${N} entities, 2 components, 4 fields (16-bit quantized)`);
const px = world.data(Pos).x, py = world.data(Pos).y;
for (const moving of [N / 10, N / 2, N].map(Math.floor)) {
  for (let i = 0; i < moving; i++) { px[i] += 3; py[i] += 2; }
  b.capture(world, 2, ids, n);
  w.reset(); codec.encode(w, b, a);
  console.log(`  delta, ${String(moving).padStart(4)} moved: ${String(w.pos).padStart(5)} B`);
}
w.reset(); codec.encode(w, b, null);
console.log(`  full snapshot:        ${String(w.pos).padStart(5)} B`);

const ITER = 3000;
const t0 = performance.now();
for (let i = 0; i < ITER; i++) { b.capture(world, 2, ids, n); w.reset(); codec.encode(w, b, a); }
const per = ((performance.now() - t0) / ITER) * 1000;
console.log(`  capture + encode delta: ${per.toFixed(1)} us per snapshot`);
w.reset(); codec.encode(w, b, a);
const bytes = Uint8Array.from(w.finish()), out = new Snapshot(schema, CAP);
const held = new Map([[1, a]]);
const t1 = performance.now();
for (let i = 0; i < ITER; i++) codec.decode(new BinaryReader(bytes), (t) => held.get(t), out);
console.log(`  decode delta:           ${(((performance.now() - t1) / ITER) * 1000).toFixed(1)} us per snapshot`);
