// Run: node packages/physics/bench/movement.js [movers] [statics]
import { SpatialHash, moveAndSlide, createMoveResult } from '../src/index.js';

const MOVERS = Number(process.argv[2] ?? 5000);
const STATICS = Number(process.argv[3] ?? 2000);
const TICKS = 200;
const SIZE = 4000;

let seed = 1;
const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);

const hash = new SpatialHash({ width: SIZE, height: SIZE, cellSize: 32, capacity: MOVERS + STATICS });
const px = new Float64Array(MOVERS), py = new Float64Array(MOVERS);
const vx = new Float64Array(MOVERS), vy = new Float64Array(MOVERS);
for (let i = 0; i < MOVERS; i++) {
  px[i] = 50 + rnd() * (SIZE - 100); py[i] = 50 + rnd() * (SIZE - 100);
  const a = rnd() * Math.PI * 2, s = 600 + rnd() * 900; // 600-1500 units/s (10-25 per 60 Hz tick)
  vx[i] = Math.cos(a) * s; vy[i] = Math.sin(a) * s;
}
const statics = [];
for (let i = 0; i < STATICS; i++) statics.push([50 + rnd() * (SIZE - 100), 50 + rnd() * (SIZE - 100), 2 + rnd() * 20, 2 + rnd() * 20]);

const res = createMoveResult();
const dt = 1 / 60;
let hits = 0;
const t0 = performance.now();
let tHash = 0;
for (let tick = 0; tick < TICKS; tick++) {
  const h0 = performance.now();
  hash.clear();
  for (let i = 0; i < STATICS; i++) hash.insert(MOVERS + i, ...statics[i], 1);
  hash.build();
  tHash += performance.now() - h0;
  for (let i = 0; i < MOVERS; i++) {
    moveAndSlide(hash, px[i], py[i], 2, 2, vx[i] * dt, vy[i] * dt, 1, -1, res);
    px[i] = res.x; py[i] = res.y;
    if (res.hit) {
      hits++;
      // bounce off what we hit
      if (res.nx !== 0) vx[i] = -vx[i]; else vy[i] = -vy[i];
    }
    if (px[i] < 10 || px[i] > SIZE - 10) vx[i] = -vx[i];
    if (py[i] < 10 || py[i] > SIZE - 10) vy[i] = -vy[i];
    px[i] = Math.min(SIZE - 5, Math.max(5, px[i])); py[i] = Math.min(SIZE - 5, Math.max(5, py[i]));
  }
}
const total = performance.now() - t0;
console.log(`${MOVERS} movers x ${STATICS} statics, ${TICKS} ticks`);
console.log(`avg tick ${(total / TICKS).toFixed(3)} ms (hash build ${(tHash / TICKS).toFixed(3)} ms), ${(MOVERS * TICKS / total * 1000 / 1e6).toFixed(2)}M moves/s, ${hits} hits`);
