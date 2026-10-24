// Cross-engine determinism suite for the AI: the navigation grid built from a level, the paths found over it, steering and behaviour trees
// with a seeded generator. Run in Node, Chrome and Firefox by `node tools/determinism.js`: every hash must match, so a server and a replay
// (or two servers) that run the same AI make the same decisions.
import { TriWorld } from '../../physics/src/index.js';
import { NavMesh, Crowd, NavGrid, findPath, SteeringAgent, seek, arrive, wander, separation, accelerate, avoidObstacles, PathFollower, bt, BehaviorTree, Memory, canSee, SUCCESS, FAILURE, RUNNING } from '../src/index.js';

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s; };
}
const unit = (u) => u / 4294967296;

class Hasher {
  constructor() { this.h = 0x811c9dc5; this.f64 = new Float64Array(1); this.u32 = new Uint32Array(this.f64.buffer); }
  word(w) { for (let i = 0; i < 4; i++) this.h = Math.imul(this.h ^ ((w >>> (i * 8)) & 255), 0x01000193); }
  num(v) { if (v !== v) { this.word(0x7ff80000); this.word(0); return; } this.f64[0] = v; this.word(this.u32[0]); this.word(this.u32[1]); }
  get hex() { return (this.h >>> 0).toString(16).padStart(8, '0'); }
}

function testLevel() {
  const r = rng(401), w = new TriWorld({ cellSize: 4 });
  w.addBox(0, -1, 0, 30, 1, 30);
  for (let i = 0; i < 40; i++) w.addBox((unit(r()) - 0.5) * 50, 0.5 + unit(r()) * 1.5, (unit(r()) - 0.5) * 50, 0.5 + unit(r()) * 3, 0.5 + unit(r()) * 1.5, 0.5 + unit(r()) * 3);
  for (let i = 0; i < 6; i++) w.addQuad(-20 + i * 7, 0, -25, -20 + i * 7 + 5, 2 + (i % 3), -25, -20 + i * 7 + 5, 2 + (i % 3), -20, -20 + i * 7, 0, -20);
  return w.build();
}

function navigation() {
  const h = new Hasher();
  const nav = NavGrid.build(testLevel(), { bounds: { minX: -30, minZ: -30, maxX: 30, maxZ: 30 }, cellSize: 0.5, top: 20, bottom: -2 });
  h.word(nav.count); h.word(nav.walkableCount);
  for (let n = 0; n < nav.count; n++) { h.num(nav.y[n]); h.word(nav.walk[n]); for (let d = 0; d < 8; d++) h.word(nav.adj[n * 8 + d] + 1); }
  return h.hex;
}

function paths() {
  const h = new Hasher(), r = rng(402);
  const nav = NavGrid.build(testLevel(), { bounds: { minX: -30, minZ: -30, maxX: 30, maxZ: 30 }, cellSize: 0.5, top: 20, bottom: -2 });
  const id = nav.block(-3, 0, -3, 3, 3, 3);
  for (let i = 0; i < 60; i++) {
    const a = { x: (unit(r()) - 0.5) * 56, y: 0, z: (unit(r()) - 0.5) * 56 }, b = { x: (unit(r()) - 0.5) * 56, y: 0, z: (unit(r()) - 0.5) * 56 };
    const q = findPath(nav, a, b, { maxExpansions: 8000 });
    h.word(q.status === 'found' ? 1 : q.status === 'partial' ? 2 : 0); h.word(q.expanded); h.num(q.length);
    for (const p of q.path) { h.num(p.x); h.num(p.y); h.num(p.z); }
  }
  nav.unblock(id);
  return h.hex;
}

function steering() {
  const h = new Hasher(), r = rng(403);
  const agents = Array.from({ length: 8 }, (_, i) => new SteeringAgent({ x: i * 0.7, z: (i % 3) * 0.6, maxSpeed: 3 + (i % 3), maxAccel: 20 }));
  const out = { x: 0, z: 0 }, tmp = { x: 0, z: 0 }, st = agents.map(() => ({ dx: 1, dz: 0 }));
  const gen = () => unit(r());
  const wall = (x0, z0, x1, z1) => x0 < 8 && x1 >= 8 && Math.abs(z0) < 4;
  const path = [{ x: 0, y: 0, z: 0 }, { x: 12, y: 0, z: 3 }, { x: 12, y: 0, z: 12 }, { x: -5, y: 0, z: 9 }];
  const follower = new PathFollower(path);
  for (let t = 0; t < 600; t++) {
    agents.forEach((a, i) => {
      if (i === 0) follower.desired(a, 1 / 60, out);
      else if (i < 3) arrive(a, 10, 5 + i, 2, out);
      else if (i < 6) { wander(a, st[i], gen, 0.3, out); separation(a, agents, 1.5, tmp); out.x += tmp.x; out.z += tmp.z; }
      else { seek(a, 0, 0, out); avoidObstacles(a, wall, 2, tmp); out.x += tmp.x; out.z += tmp.z; }
      accelerate(a, out, 1 / 60);
      a.x += a.vx / 60; a.z += a.vz / 60;
      h.num(a.x); h.num(a.z); h.num(a.vx); h.num(a.vz);
    });
  }
  return h.hex;
}

function trees() {
  const h = new Hasher(), r = rng(404);
  const gen = () => unit(r());
  const world = { x: 0, noise: 0 };
  const root = bt.selector(
    bt.reactiveSequence(bt.condition((c) => c.bb.danger > 0.7), bt.action((c) => { c.bb.fled = (c.bb.fled ?? 0) + 1; return RUNNING; })),
    bt.sequence(bt.condition((c) => c.bb.hungry), bt.cooldown(bt.action((c) => { c.bb.ate = (c.bb.ate ?? 0) + 1; }), 0.5)),
    bt.random([1, 2, 3], bt.wait(0.3), bt.repeat(bt.action((c) => { c.bb.steps = (c.bb.steps ?? 0) + 1; }), 4), bt.sequence(bt.action(() => SUCCESS), bt.wait(0.2), bt.action(() => FAILURE))),
  );
  const trees = Array.from({ length: 5 }, (_, i) => { const g = rng(500 + i); return new BehaviorTree(root, { bb: { danger: 0, hungry: false }, rng: () => unit(g()) }); });
  const mems = trees.map(() => new Memory(3));
  for (let t = 0; t < 500; t++) {
    trees.forEach((tree, i) => {
      tree.bb.danger = unit(r()); tree.bb.hungry = gen() < 0.3;
      const s = tree.tick(1 / 20);
      h.word(s); h.word(tree.bb.fled ?? 0); h.word(tree.bb.ate ?? 0); h.word(tree.bb.steps ?? 0);
      const m = mems[i];
      if (gen() < 0.2) m.see('t', world.x + gen() * 10, 0, gen() * 10, gen() - 0.5, gen() - 0.5);
      m.update(1 / 20);
      const g = m.guess('t'); if (g) { h.num(g.x); h.num(g.z); } else h.word(0);
      h.word(canSee({ x: 0, y: 1.6, z: 0 }, 0, -1, { x: gen() * 20 - 10, y: 1, z: -gen() * 30 }, { range: 25, cosFov: 0.5 }) ? 1 : 0);
    });
  }
  void FAILURE;
  return h.hex;
}


/** A navigation mesh of a field with a wall and a pillar: paths, an obstacle added and taken away, moves along walls. */
function navmesh() {
  const h = new Hasher(), r = rng(405);
  const v = [], idx = [];
  let n = 0;
  for (let z = 0; z < 24; z++) for (let x = 0; x < 24; x++) {
    if (x === 11 && z < 17) continue;
    const y = (x + z) % 7 === 0 ? 0.25 : 0;
    v.push(x, y, z, x + 1, y, z, x + 1, y, z + 1, x, y, z + 1);
    idx.push(n, n + 2, n + 1, n, n + 3, n + 2);
    n += 4;
  }
  const mesh = NavMesh.build(v, idx, { agentRadius: 0.4, maxEdge: 2 });
  h.word(mesh.count);
  const id = mesh.blockCircle(5, 5, 1.5);
  for (let i = 0; i < 40; i++) {
    const a = { x: unit(r()) * 23 + 0.5, y: 0, z: unit(r()) * 23 + 0.5 }, b = { x: unit(r()) * 23 + 0.5, y: 0, z: unit(r()) * 23 + 0.5 };
    const q = mesh.findPath(a, b, { partial: true });
    h.word(q.found ? 1 : q.partial ? 2 : 0); h.num(q.length);
    for (const c of q.points) h.num(c);
    const m = mesh.raycast(a, b);
    h.word(m.hit ? 1 : 0); h.num(m.t);
  }
  mesh.unblock(id);
  return h.hex;
}

/** A crowd crossing a field with a wall, ten agents each way. */
function crowd() {
  const h = new Hasher();
  const v = [], idx = [];
  let n = 0;
  for (let z = 0; z < 30; z++) for (let x = 0; x < 30; x++) {
    if (x === 14 && z < 20) continue;
    v.push(x, 0, z, x + 1, 0, z, x + 1, 0, z + 1, x, 0, z + 1);
    idx.push(n, n + 2, n + 1, n, n + 3, n + 2);
    n += 4;
  }
  const mesh = NavMesh.build(v, idx, { agentRadius: 0.4, maxEdge: 2 });
  const c = new Crowd(mesh);
  for (let i = 0; i < 10; i++) {
    const a = c.addAgent({ x: 2 + (i % 5) * 0.9, z: 3 + Math.floor(i / 5) * 0.9 }); c.moveTo(a, 27 - (i % 5), 0, 25 - Math.floor(i / 5));
    const b = c.addAgent({ x: 27 - (i % 5) * 0.9, z: 24 + Math.floor(i / 5) * 0.9 }); c.moveTo(b, 2 + (i % 5), 0, 4 + Math.floor(i / 5));
  }
  for (let t = 0; t < 400; t++) {
    c.update(1 / 30);
    if (t === 150) mesh.blockCircle(20, 22, 1);
    for (const a of c.agents) { h.num(a.x); h.num(a.z); h.num(a.vx); h.num(a.vz); }
  }
  for (const a of c.agents) h.word(a.state.length);
  return h.hex;
}

/** @returns {{exact: Record<string, string>, probe: Record<string, string>}} */
export function runAiSuite() {
  return { exact: { 'ai.navgrid': navigation(), 'ai.paths': paths(), 'ai.steering': steering(), 'ai.trees': trees(), 'ai.navmesh': navmesh(), 'ai.crowd': crowd() }, probe: {} };
}
