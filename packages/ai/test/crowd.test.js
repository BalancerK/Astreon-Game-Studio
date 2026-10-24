import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NavMesh, Crowd } from '../src/index.js';

function field(w, h, hole = () => false) {
  const v = [], idx = [];
  let n = 0;
  for (let z = 0; z < h; z++) for (let x = 0; x < w; x++) {
    if (hole(x, z)) continue;
    v.push(x, 0, z, x + 1, 0, z, x + 1, 0, z + 1, x, 0, z + 1);
    idx.push(n, n + 2, n + 1, n, n + 3, n + 2);
    n += 4;
  }
  return NavMesh.build(v, idx, { agentRadius: 0.4, maxEdge: 2 });
}
const DT = 1 / 30;
const run = (crowd, seconds, each) => { for (let i = 0; i < Math.round(seconds / DT); i++) { crowd.update(DT); each?.(crowd, i); } };
/** The deepest overlap between any two agents, as a fraction of their radii sum, over the whole run. */
function deepestOverlap(crowd) {
  let worst = 0;
  for (let i = 0; i < crowd.agents.length; i++) for (let j = i + 1; j < crowd.agents.length; j++) {
    const a = crowd.agents[i], b = crowd.agents[j], min = a.radius + b.radius, d = Math.hypot(a.x - b.x, a.z - b.z);
    worst = Math.max(worst, (min - d) / min);
  }
  return worst;
}

test('one agent walks to its goal, arrives, and never goes faster or accelerates harder than allowed', () => {
  const mesh = field(20, 20);
  const crowd = new Crowd(mesh);
  const a = crowd.addAgent({ x: 2, z: 2, maxSpeed: 3, maxAccel: 6 });
  let arrived = 0; crowd.onArrive = () => arrived++;
  crowd.moveTo(a, 17, 0, 15);
  let maxSpeed = 0, maxAcc = 0, px = 0, pz = 0, pvx = 0, pvz = 0;
  run(crowd, 12, () => {
    maxSpeed = Math.max(maxSpeed, Math.hypot(a.vx, a.vz));
    maxAcc = Math.max(maxAcc, Math.hypot(a.vx - pvx, a.vz - pvz) / DT);
    pvx = a.vx; pvz = a.vz; px = a.x; pz = a.z;
  });
  void px; void pz;
  assert.equal(a.state, 'arrived'); assert.equal(arrived, 1);
  assert.ok(Math.hypot(a.x - 17, a.z - 15) < 0.3);
  assert.ok(maxSpeed <= 3 + 1e-9, `speed ${maxSpeed}`); assert.ok(maxAcc <= 6 + 1e-6, `acceleration ${maxAcc}`);
  crowd.moveTo(a, 3, 0, 3);
  assert.equal(a.state, 'moving');
  crowd.stop(a);
  assert.equal(a.state, 'idle');
  assert.throws(() => crowd.addAgent({ x: 500, z: 500 }), /no place on the navigation mesh/);
});

test('two agents walking straight at each other pass without touching', () => {
  const crowd = new Crowd(field(30, 10));
  const a = crowd.addAgent({ x: 2, z: 5 }), b = crowd.addAgent({ x: 28, z: 5 });
  crowd.moveTo(a, 28, 0, 5); crowd.moveTo(b, 2, 0, 5);
  let worst = 0;
  run(crowd, 20, () => { worst = Math.max(worst, deepestOverlap(crowd)); });
  assert.equal(a.state, 'arrived'); assert.equal(b.state, 'arrived');
  assert.ok(worst < 0.15, `overlapped by ${(worst * 100).toFixed(0)}% of their size`);
});

test('twelve agents crossing a circle to the far side all arrive without piling up', () => {
  const crowd = new Crowd(field(40, 40));
  const n = 12, agents = [];
  const ring = [[1, 0], [0.866, 0.5], [0.5, 0.866], [0, 1], [-0.5, 0.866], [-0.866, 0.5], [-1, 0], [-0.866, -0.5], [-0.5, -0.866], [0, -1], [0.5, -0.866], [0.866, -0.5]];
  for (let i = 0; i < n; i++) {
    const a = crowd.addAgent({ x: 20 + ring[i][0] * 14, z: 20 + ring[i][1] * 14 });
    agents.push(a); crowd.moveTo(a, 20 - ring[i][0] * 14, 0, 20 - ring[i][1] * 14);
  }
  let worst = 0;
  run(crowd, 40, () => { worst = Math.max(worst, deepestOverlap(crowd)); });
  assert.ok(agents.every((a) => a.state === 'arrived'), agents.map((a) => a.state).join());
  assert.ok(agents.every((a, i) => Math.hypot(a.x - (20 - ring[i][0] * 14), a.z - (20 - ring[i][1] * 14)) < 1.2), 'each ended near its goal');
  assert.ok(worst < 0.3, `deepest overlap ${(worst * 100).toFixed(0)}%`);
});

test('in a corridor, agents going opposite ways get past each other', () => {
  const crowd = new Crowd(field(30, 4));
  const left = [], right = [];
  for (let i = 0; i < 3; i++) { left.push(crowd.addAgent({ x: 2 + i, z: 1.2 + i * 0.8 })); right.push(crowd.addAgent({ x: 27 - i, z: 1.6 + i * 0.7 })); }
  left.forEach((a, i) => crowd.moveTo(a, 27, 0, 1.2 + i * 0.8)); right.forEach((a, i) => crowd.moveTo(a, 2, 0, 1.6 + i * 0.7));
  run(crowd, 40);
  assert.ok([...left, ...right].every((a) => a.state === 'arrived'), [...left, ...right].map((a) => a.state).join());
  for (const a of crowd.agents) assert.ok(mesh(crowd).polyAt(a.x, 0, a.z) >= 0, 'still on the mesh');
});
const mesh = (crowd) => crowd.mesh;

test('agents keep to the mesh while pushing against walls and each other', () => {
  const crowd = new Crowd(field(16, 16, (x, z) => x >= 6 && x <= 9 && z >= 6 && z <= 9));
  for (let i = 0; i < 10; i++) { const a = crowd.addAgent({ x: 1 + i * 0.4, z: 1 + (i % 3) * 0.3 }); crowd.moveTo(a, 14, 0, 14); }
  run(crowd, 25, (c) => { for (const a of c.agents) assert.ok(c.mesh.polyAt(a.x, 0, a.z) >= 0, `agent ${a.id} left the mesh at ${a.x}, ${a.z}`); });
  assert.ok(crowd.agents.every((a) => a.state === 'arrived'));
});

test('an obstacle put in the way makes agents find another route; one that closes the only way stops them as near as they can get', () => {
  const m = field(30, 10);
  const crowd = new Crowd(m);
  const a = crowd.addAgent({ x: 2, z: 5 });
  crowd.moveTo(a, 28, 0, 5);
  run(crowd, 3);
  assert.ok(a.x > 4 && a.x < 14 && a.state === 'moving');
  const wall = m.block(14, -1, 0, 16, 1, 8);                               // a wall from the bottom edge up to z = 8, leaving a gap at the top
  run(crowd, 25);
  assert.equal(a.state, 'arrived', 'went round the end of the wall');
  assert.ok(Math.abs(a.x - 28) < 0.5);
  m.unblock(wall);
  const b = crowd.addAgent({ x: 2, z: 5 });
  crowd.moveTo(b, 28, 0, 5);
  const full = m.block(14, -1, -1, 16, 1, 11);                              // across the whole width
  run(crowd, 12);
  assert.equal(b.state, 'blocked');
  assert.ok(b.x > 8 && b.x < 14.1, `waits at the wall: ${b.x}`);
  m.unblock(full);
  run(crowd, 20);
  assert.equal(b.state, 'arrived', 'and goes when it opens');
});

test('an agent standing where an obstacle appears is moved out', () => {
  const m = field(20, 20);
  const crowd = new Crowd(m);
  const a = crowd.addAgent({ x: 10, z: 10 });
  m.blockCircle(10, 10, 1.5);
  run(crowd, 1);
  assert.equal(m.blocked[a.poly], 0, 'standing on a free triangle again');
  assert.ok(Math.hypot(a.x - 10, a.z - 10) > 0.5);
});

test('the same crowd gives the same positions, every time', () => {
  const make = () => {
    const crowd = new Crowd(field(30, 30, (x, z) => x === 14 && z < 20));
    for (let i = 0; i < 20; i++) { const a = crowd.addAgent({ x: 2 + (i % 5) * 0.9, z: 2 + Math.floor(i / 5) * 0.9 }); crowd.moveTo(a, 27 - (i % 5), 0, 25 - Math.floor(i / 5)); }
    run(crowd, 10);
    return crowd.agents.map((a) => [a.x, a.z, a.vx, a.vz].join(',')).join('|');
  };
  assert.equal(make(), make());
});

test('two hundred agents cost a few milliseconds a step', () => {
  const crowd = new Crowd(field(60, 60));
  for (let i = 0; i < 200; i++) { const a = crowd.addAgent({ x: 3 + (i % 20) * 1.1, z: 3 + Math.floor(i / 20) * 1.1 }); crowd.moveTo(a, 57 - (i % 20) * 1.1, 0, 57 - Math.floor(i / 20) * 1.1); }
  run(crowd, 2);
  const t0 = performance.now();                                              // determinism-ok: timing a test
  run(crowd, 3);
  const per = (performance.now() - t0) / 90;
  assert.ok(per < 25, `${per.toFixed(1)} ms a step`);
});
