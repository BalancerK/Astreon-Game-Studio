// Rigid-body cost: a pile of mixed bodies on a ground, stepped at 60 Hz. Usage: node packages/physics/bench/rigid.js [bodies] [seconds]
import { PhysicsWorld, RigidBody, sphere, box, capsule } from '../src/index.js';
import { TriWorld } from '../src/tri-world.js';

const n = Number(process.argv[2] ?? 500), seconds = Number(process.argv[3] ?? 6);
const t = new TriWorld({ cellSize: 4 });
t.addBox(0, -1, 0, 60, 1, 60);
for (const [x, z, hx, hz] of [[-20, 0, 0.5, 20], [20, 0, 0.5, 20], [0, -20, 20, 0.5], [0, 20, 20, 0.5]]) t.addBox(x, 2, z, hx, 2, hz);
t.build();
const w = new PhysicsWorld({ terrain: t });
for (let i = 0; i < n; i++) {
  const shape = i % 3 === 0 ? sphere(0.3 + (i % 5) * 0.04) : i % 3 === 1 ? box(0.3, 0.3 + (i % 4) * 0.04, 0.4) : capsule(0.22, 0.35);
  w.add(new RigidBody({ shape, x: ((i * 37) % 31) * 0.9 - 14, y: 1 + Math.floor(i / 60) * 1.1, z: ((i * 53) % 29) * 0.9 - 13, rotation: [0.1 * (i % 7), 0.2, 0.1 * (i % 5), 1], mass: 5 }));
}
const steps = Math.round(seconds * 60), times = [];
for (let i = 0; i < steps; i++) { const t0 = performance.now(); w.step(1 / 60); times.push(performance.now() - t0); }
const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const early = times.slice(0, 120), late = times.slice(-120);
console.log(`${n} bodies: first 2 s ${avg(early).toFixed(2)} ms/step (max ${Math.max(...early).toFixed(1)}), last 2 s ${avg(late).toFixed(2)} ms/step; asleep ${w.stats.asleep}/${n}; contacts ${w.stats.contacts}`);
