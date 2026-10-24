// Cost of 3D character movement. Usage: node packages/physics/bench/character3d.js [characters] [boxes]
import { TriWorld, CharacterController } from '../src/index.js';

const N = Number(process.argv[2] ?? 200), BOXES = Number(process.argv[3] ?? 400);
function rng(seed) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }
const r = rng(5);
const w = new TriWorld({ cellSize: 6 });
w.addBox(0, -1, 0, 150, 1, 150);
for (let i = 0; i < BOXES; i++) w.addBox((r() - 0.5) * 280, 1 + r() * 2, (r() - 0.5) * 280, 0.5 + r() * 3, 0.5 + r() * 3, 0.5 + r() * 3);
w.build();
const chars = Array.from({ length: N }, () => new CharacterController({ x: (r() - 0.5) * 250, y: 8, z: (r() - 0.5) * 250 }));
const dirs = chars.map(() => [(r() - 0.5) * 12, (r() - 0.5) * 12]);
const DT = 1 / 60;
const tick = (t) => { for (let i = 0; i < N; i++) { const d = dirs[i]; chars[i].update(w, d[0], d[1], t % 90 === i % 90, DT); } };
for (let t = 0; t < 120; t++) tick(t); // settle and warm up
const TICKS = 600;
const times = [];
for (let t = 0; t < TICKS; t++) { const t0 = performance.now(); tick(t); times.push(performance.now() - t0); }
times.sort((a, b) => a - b);
const avg = times.reduce((a, b) => a + b, 0) / TICKS;
console.log(`${N} characters, ${w.triangleCount} triangles, grid ${w.cols}x${w.rows}x${w.layers}`);
console.log(`per tick (all ${N}): avg ${avg.toFixed(3)} ms, median ${times[TICKS >> 1].toFixed(3)} ms, p99 ${times[Math.floor(TICKS * 0.99)].toFixed(3)} ms, worst ${times[TICKS - 1].toFixed(3)} ms (budget 16.7 ms)`);
console.log(`per character update: ${((avg / N) * 1000).toFixed(2)} microseconds   (${chars.filter((c) => c.grounded).length}/${N} standing)`);
