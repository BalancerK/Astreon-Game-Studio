import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TriWorld } from '../../physics/src/index.js';
import { NavGrid, findPath, PathQuery } from '../src/index.js';

const near = (a, b, eps, msg = '') => assert.ok(Math.abs(a - b) <= eps, `${msg} ${a} is not within ${eps} of ${b}`);
const level = (fn, size = 20) => { const t = new TriWorld({ cellSize: 4 }); t.addBox(0, -1, 0, size, 1, size); fn?.(t); t.build(); return t; };
const grid = (world, o = {}) => NavGrid.build(world, { bounds: { minX: -20, minZ: -20, maxX: 20, maxZ: 20 }, top: 30, bottom: -3, ...o });
const P = (x, y, z) => ({ x, y, z });
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

test('a flat floor is one layer of nodes, and a path across it is almost a straight line', () => {
  const nav = grid(level());
  assert.equal(nav.count, 80 * 80);
  assert.ok(nav.walkableCount > 70 * 70 && nav.walkableCount < 80 * 80, 'the margin along the edge is eroded');
  const q = findPath(nav, P(-15, 0, -15), P(15, 0, 12));
  assert.equal(q.status, 'found');
  assert.ok(q.length < dist(P(-15, 0, -15), P(15, 0, 12)) * 1.02, `length ${q.length}`);
  assert.equal(q.path.length, 2, 'smoothed to the two end points');
  near(q.path[1].x, 15, 1e-9); near(q.path[1].z, 12, 1e-9);
});

test('a wall with a doorway makes the path go through the door; without a door the goal is unreachable', () => {
  const wall = (door) => level((t) => { t.addBox(0, 1, -10, 0.3, 1, 9.5); if (door) t.addBox(0, 1, 10, 0.3, 1, 9.5); else t.addBox(0, 1, 0, 0.3, 1, 20); });
  // a wall along z at x = 0 from z = -19.5 to -0.5, and from 0.5 (or everywhere) to 19.5: a doorway at z in (-0.5, 0.5) when door === true? (adjusted below)
  const w1 = level((t) => { t.addBox(0, 1, -10.7, 0.3, 1, 9.3); t.addBox(0, 1, 10.7, 0.3, 1, 9.3); }); // door: z from -1.4 to 1.4
  const nav = grid(w1);
  const q = findPath(nav, P(-10, 0, -8), P(10, 0, -8));
  assert.equal(q.status, 'found');
  assert.ok(q.length > 22 && q.length < 40, `it goes around through the door at z = 0: ${q.length}`);
  assert.ok(q.path.some((p) => Math.abs(p.x) < 1 && Math.abs(p.z) < 1.2), 'a point in the doorway');
  const closed = grid(wall(false));
  const none = findPath(closed, P(-10, 0, -8), P(10, 0, -8));
  assert.notEqual(none.status, 'found');
  assert.ok(none.path.length === 0 || none.path[none.path.length - 1].x < 0, 'a partial path stops on the near side');
});

test('a wall of zero thickness still blocks (nodes either side have no link across it)', () => {
  const nav = grid(level((t) => t.addQuad(0, 0, -20, 0, 0, 20, 0, 3, 20, 0, 3, -20)));
  assert.notEqual(findPath(nav, P(-8, 0, 0), P(8, 0, 0)).status, 'found');
});

test('stairs of 25 cm are walked; a 70 cm step is not, until a jump link is added', () => {
  const stairs = level((t) => { for (let i = 0; i < 8; i++) t.addBox(-4 + i * 0.8 + 0.4, ((i + 1) * 0.25) / 2, 0, 0.4, ((i + 1) * 0.25) / 2, 3, 0); t.addBox(-4 + 8 * 0.8 + 2, 1, 0, 2, 1, 3); });
  const nav = grid(stairs);
  const up = findPath(nav, P(-8, 0, 0), P(4, 2, 0));
  assert.equal(up.status, 'found'); near(up.path.at(-1).y, 2, 0.05, 'ends on top');
  const ledge = level((t) => t.addBox(5, 0.35, 0, 3, 0.35, 5)); // top at 0.7
  const nav2 = grid(ledge);
  assert.notEqual(findPath(nav2, P(-5, 0, 0), P(5, 0.7, 0)).status, 'found');
  const a = nav2.nearest(1.25, 0, 0), b = nav2.nearest(2.75, 0.7, 0);
  nav2.addLink(a, b, { cost: 2 });
  const jumped = findPath(nav2, P(-5, 0, 0), P(5, 0.7, 0));
  assert.equal(jumped.status, 'found');
  assert.ok(jumped.path.some((p) => Math.abs(p.y - 0.7) < 0.05), 'and it ends up on the ledge');
});

test('slopes: a 30 degree ramp is walkable, a 60 degree one is not', () => {
  const ramp = (rise) => level((t) => t.addQuad(-4, 0, -3, -4 + 6, rise, -3, -4 + 6, rise, 3, -4, 0, 3));
  const gentle = grid(ramp(3.46)); // 6 m run, 3.46 m rise: 30 degrees
  const up = findPath(gentle, P(-8, 0, 0), P(1.5, 3, 0));
  assert.equal(up.status, 'found'); assert.ok(up.path.at(-1).y > 2.5, `it climbs: ends at ${up.path.at(-1).y}`);
  const steep = grid(ramp(10.4)); // 60 degrees
  const no = findPath(steep, P(-8, 0, 0), P(1.5, 8, 0));
  assert.ok(no.path.length === 0 || no.path.at(-1).y < 1, 'it never gets up the steep one');
});

test('a bridge over open ground has its own layer, and paths can go under it', () => {
  const bridge = level((t) => { t.addBox(0, 3.5, 0, 6, 0.25, 2); t.addBox(-7, 1.7, 0, 1.2, 1.7, 2); t.addBox(7, 1.7, 0, 1.2, 1.7, 2); });
  const nav = grid(bridge);
  const col = nav.columnAt(0.2, 0.2);
  assert.equal(nav.colStart[col + 1] - nav.colStart[col], 2, 'two floors in a column: the ground and the bridge deck');
  const under = findPath(nav, P(-10, 0, 0), P(10, 0, 0));
  assert.equal(under.status, 'found');
  assert.ok(under.path.every((p) => p.y < 0.5), 'the path under the bridge stays on the ground');
  const across = findPath(nav, P(0, 3.75, 0), P(-2, 3.75, 1));
  assert.equal(across.status, 'found'); assert.ok(across.path.every((p) => p.y > 3));
});

test('a low ceiling leaves no floor under it', () => {
  const nav = grid(level((t) => t.addBox(0, 1.5, 0, 4, 0.1, 4))); // a slab at 1.4 .. 1.6: 1.4 m of headroom, the agent needs 1.8
  const n = nav.nearest(0.2, 0, 0.2, 0);
  assert.equal(nav.nearest(0.2, 0, 0.2, 0) >= 0 && Math.abs(nav.y[n]) < 0.1, false, 'nothing to stand on under it');
  assert.ok(findPath(nav, P(-10, 0, 0), P(10, 0, 0)).length < 24, 'and the path goes around it');
});

test('agent radius: a narrow corridor lets a thin agent through but not a wide one', () => {
  const gate = (half) => level((t) => { t.addBox(0, 1, half + 9.5, 0.3, 1, 9.5); t.addBox(0, 1, -half - 9.5, 0.3, 1, 9.5); }); // a wall across x = 0 with a gap of 2 * half
  const corridor = gate(0.85), tight = gate(0.35);
  const thin = grid(tight, { agentRadius: 0.2 }), wide = grid(tight, { agentRadius: 0.45 });
  assert.equal(findPath(thin, P(-12, 0, 0), P(12, 0, 0)).status, 'found', 'a thin agent fits through 0.7 m');
  assert.notEqual(findPath(wide, P(-12, 0, 0), P(12, 0, 0)).status, 'found', 'a wide one does not');
  assert.equal(findPath(grid(corridor, { agentRadius: 0.45 }), P(-12, 0, 0), P(12, 0, 0)).status, 'found', 'but fits through 1.7 m');
});

test('a ledge: a one metre drop is stepped off (one way), a three metre drop is not', () => {
  const nav = grid(level((t) => { t.addBox(-8, 0.5, 0, 6, 0.5, 20); t.addBox(8, 1.5, 0, 6, 1.5, 20); })); // left part 1 m high, right part 3 m high, ground between
  const down1 = findPath(nav, P(-6, 1, 0), P(-1, 0, 0));
  assert.equal(down1.status, 'found');
  const up1 = findPath(nav, P(-1, 0, 0), P(-6, 1, 0));
  assert.notEqual(up1.status, 'found', 'a one metre climb needs a ladder');
  assert.notEqual(findPath(nav, P(8, 3, 0), P(0, 0, 0)).status, 'found', 'three metres is too far to drop');
});

test('a narrow crack between two platforms is stepped across', () => {
  const nav = grid(level((t) => { t.addBox(-3, 1, 0, 2.5, 1, 5); t.addBox(3.4, 1, 0, 2.5, 1, 5); }), { maxGap: 0.6 }); // gap from x = -0.5 to 0.9: 1.4 m ... made narrower below
  assert.notEqual(findPath(nav, P(-4, 2, 0), P(4, 2, 0)).status, 'found', '1.4 m is too wide');
  const narrow = grid(level((t) => { t.addBox(-3, 1, 0, 2.5, 1, 5); t.addBox(2.3, 1, 0, 2.5, 1, 5); }), { maxGap: 0.6 }); // gap 0.3 m
  assert.equal(findPath(narrow, P(-4, 2, 0), P(4, 2, 0)).status, 'found');
  const none = grid(level((t) => { t.addBox(-3, 1, 0, 2.5, 1, 5); t.addBox(2.3, 1, 0, 2.5, 1, 5); }), { maxGap: 0 });
  assert.notEqual(findPath(none, P(-4, 2, 0), P(4, 2, 0)).status, 'found', 'with maxGap 0 it is not');
});

test('blocking a box makes paths go around it, and unblocking brings the short way back; the version changes', () => {
  const nav = grid(level());
  const a = P(-10, 0, 0), b = P(10, 0, 0);
  const straight = findPath(nav, a, b);
  near(straight.length, 20, 0.1);
  const v = nav.version;
  const id = nav.block(-1, 0, -6, 1, 3, 6);
  assert.ok(nav.version > v);
  const around = findPath(nav, a, b);
  assert.ok(around.length > 22 && around.length < 30, `around the barricade: ${around.length}`);
  assert.ok(around.path.every((p) => !(Math.abs(p.x) < 1 && Math.abs(p.z) < 6)), 'never through it');
  nav.unblock(id);
  near(findPath(nav, a, b).length, 20, 0.1);
  const start = nav.block(-11, 0, -1, -9, 3, 1);
  const q = findPath(nav, a, b);
  assert.equal(q.status, 'found', 'a start inside an obstacle begins from the nearest free node'); nav.unblock(start);
});

test('areas with a cost multiplier are avoided when there is a cheap way round', () => {
  const nav = grid(level());
  nav.areaCost[1] = 5;
  nav.setArea(-2, -1, -8, 2, 1, 8, 1); // a swamp strip across the direct route
  const q = findPath(nav, P(-10, 0, 0), P(10, 0, 0));
  assert.equal(q.status, 'found');
  assert.ok(q.length > 23, `it went around the swamp: ${q.length}`);
  nav.areaCost[1] = 1.1;
  near(findPath(nav, P(-10, 0, 0), P(10, 0, 0)).length, 20, 0.2, 'a cheap swamp is just crossed');
});

test('a goal that cannot be reached gives a partial path to the closest point, or nothing when asked not to', () => {
  const nav = grid(level((t) => t.addBox(0, 1, 0, 5, 1, 5))); // a solid block in the middle
  const q = findPath(nav, P(-15, 0, 0), P(0, 3, 0));
  assert.notEqual(q.status, 'found');
  const none = findPath(nav, P(-15, 0, 0), P(0, 3, 0), { partial: false });
  assert.equal(none.status, 'none'); assert.equal(none.path.length, 0);
  assert.equal(findPath(nav, P(100, 0, 100), P(0, 0, 0)).status, 'none', 'a start far outside the grid');
});

test('a path query can be run a little at a time, and gives the same path as running it at once; many can be in flight', () => {
  const nav = grid(level((t) => t.addBox(0, 1, 0, 0.3, 1, 15)));
  const all = findPath(nav, P(-15, 0, -10), P(15, 0, 10));
  const queries = [0, 1, 2, 3].map((k) => new PathQuery(nav, P(-15, 0, -10 + k), P(15, 0, 10 - k)));
  let rounds = 0;
  while (queries.some((q) => q.status === 'running')) { for (const q of queries) q.step(60); rounds++; }
  assert.ok(rounds > 5, 'it really did take several rounds');
  const first = new PathQuery(nav, P(-15, 0, -10), P(15, 0, 10));
  while (first.step(50) === 'running');
  assert.deepEqual(first.path, all.path);
  assert.deepEqual(queries[0].path, all.path, 'interleaving does not change a result');
  const dropped = new PathQuery(nav, P(-15, 0, -10), P(15, 0, 10));
  dropped.step(10); dropped.cancel();
  assert.equal(dropped.status, 'none');
  assert.deepEqual(findPath(nav, P(-15, 0, -10), P(15, 0, 10)).path, all.path, 'the pool survives a cancel');
});

test('line of walk: true across open floor, false through a wall, false across a gap link', () => {
  const nav = grid(level((t) => t.addBox(0, 1, 0, 0.3, 1, 8)));
  assert.equal(nav.lineOfWalk(nav.nearest(-8, 0, 0), nav.nearest(-2, 0, 6)), true);
  assert.equal(nav.lineOfWalk(nav.nearest(-5, 0, 0), nav.nearest(5, 0, 0)), false);
});

test('building is repeatable: the same level gives the same grid and the same paths', () => {
  const make = () => grid(level((t) => { t.addBox(0, 1, 0, 3, 1, 3); t.addBox(8, 1, 8, 2, 1, 2); }));
  const a = make(), b = make();
  assert.equal(a.count, b.count);
  assert.deepEqual(Array.from(a.adj), Array.from(b.adj));
  assert.deepEqual(findPath(a, P(-15, 0, -15), P(15, 0, 15)).path, findPath(b, P(-15, 0, -15), P(15, 0, 15)).path);
});
