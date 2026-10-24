import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NavMesh } from '../src/index.js';

/** A flat field of 1 m squares from (0,0) to (w,h), minus the squares `hole(x, z)` says. Two triangles each, facing up. */
function field(w, h, hole = () => false, y = 0) {
  const v = [], idx = [];
  let n = 0;
  for (let z = 0; z < h; z++) for (let x = 0; x < w; x++) {
    if (hole(x, z)) continue;
    v.push(x, y, z, x + 1, y, z, x + 1, y, z + 1, x, y, z + 1);
    idx.push(n, n + 2, n + 1, n, n + 3, n + 2);
    n += 4;
  }
  return [v, idx];
}
const near = (a, b, tol, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} ${a} vs ${b}`);
const P = (x, z, y = 0) => ({ x, y, z });
/** Distance from a point to a segment on the ground. */
function segDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz, t = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2)) : 0;
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}
const minDistToPath = (path, px, pz) => { let d = Infinity; for (let i = 3; i < path.length; i += 3) d = Math.min(d, segDist(px, pz, path[i - 3], path[i - 1], path[i], path[i + 2])); return d; };
const wallMesh = () => { const [v, i] = field(20, 20, (x, z) => x === 9 && z < 15); return NavMesh.build(v, i, { agentRadius: 0.4 }); };

test('a mesh keeps the triangles that can be walked on, joins the corners, and links triangles that share an edge', () => {
  // a floor, a vertical wall, a ceiling facing down, a gentle ramp and a steep ramp
  const v = [0, 0, 0, 4, 0, 0, 4, 0, 4, 0, 0, 4,                // floor
    0, 0, 0, 4, 0, 0, 4, 3, 0,                                   // wall
    0, 3, 0, 4, 3, 4, 4, 3, 0,                                   // a ceiling (wound to face down)
    4, 0, 0, 4, 0, 4, 8, 1, 4, 8, 1, 0,                          // a ramp rising 1 in 4
    0, 0, 4, 4, 0, 4, 4, 4, 7];                                  // a steep one: 4 up over 3 along
  const idx = [0, 2, 1, 0, 3, 2, 4, 5, 6, 7, 9, 8, 10, 11, 12, 10, 12, 13, 14, 16, 15];
  const m = NavMesh.build(v, idx, { maxSlope: 45 });
  assert.equal(m.count, 4, 'two floor triangles and two ramp triangles: no wall, ceiling or steep ramp');
  assert.equal(m.vx.length, 6, 'corners that coincide are one vertex');
  let linked = 0;
  for (const n of m.nbr) if (n >= 0) linked++;
  assert.equal(linked, 6, 'floor/floor, ramp/ramp and floor/ramp: three shared edges counted from both sides');
  assert.throws(() => NavMesh.build([0, 0, 0], [0, 1, 2]), /vertex that does not exist|x, y, z/);
  assert.throws(() => NavMesh.build([0, 0], [0, 0, 0]), /x, y, z for each vertex/);
  assert.equal(NavMesh.build([], []).count, 0);
});

test('height and the triangle under a point, on a ramp and with two floors above each other', () => {
  const [v, i] = field(4, 4);
  const ramp = i.map((k) => k);
  const m = NavMesh.build(v.map((c, k) => (k % 3 === 1 ? 0 : c)), ramp);
  assert.ok(m.polyAt(2.5, 0, 1.5) >= 0); assert.equal(m.polyAt(9, 0, 1), -1); assert.equal(m.polyAt(-0.1, 0, 1), -1);
  // a slope: y = x / 4
  const sv = [], si = [];
  for (let x = 0; x < 4; x++) { sv.push(x, x / 4, 0, x + 1, (x + 1) / 4, 0, x + 1, (x + 1) / 4, 2, x, x / 4, 2); si.push(x * 4, x * 4 + 2, x * 4 + 1, x * 4, x * 4 + 3, x * 4 + 2); }
  const s = NavMesh.build(sv, si);
  near(s.heightAt(s.polyAt(2.5, 0.6, 1), 2.5, 1), 0.625, 1e-9);
  // a bridge 3 m above the ground
  const [gv, gi] = field(6, 6), [bv, bi] = field(6, 2, () => false, 3);
  const both = NavMesh.build([...gv, ...bv.map((c, k) => (k % 3 === 2 ? c + 2 : c))], [...gi, ...bi.map((k) => k + gv.length / 3)]);
  const low = both.polyAt(2.5, 0, 2.5, 1), high = both.polyAt(2.5, 3, 2.5, 1);
  assert.ok(low >= 0 && high >= 0 && low !== high, 'told apart by height');
  assert.equal(both.polyAt(2.5, 1.5, 2.5, 0.5), -1, 'nothing at a height that is neither');
});

test('a path across open ground is the straight line; around a wall it hugs the corner at the agent radius and stays on the mesh', () => {
  const m = wallMesh();
  const open = m.findPath(P(2, 2), P(5, 10));
  assert.equal(open.found, true); assert.deepEqual(open.points, [2, 0, 2, 5, 0, 10]); near(open.length, Math.hypot(3, 8), 1e-9);
  const p = m.findPath(P(2, 2), P(17, 2));
  assert.equal(p.found, true); assert.equal(p.partial, false);
  const ideal = Math.hypot(7 - 0.0, 13) + Math.hypot(8, 13);                 // via the wall's top corner, roughly
  assert.ok(p.length < ideal * 1.12 && p.length > 28, `length ${p.length}`);
  for (let k = 0; k < p.points.length; k += 3) assert.ok(m.polyAt(p.points[k], 0, p.points[k + 2]) >= 0, `corner ${k / 3} is on the mesh`);
  // the walls' corners (9,15) and (10,15) are kept at least the radius away by the path
  assert.ok(minDistToPath(p.points, 9, 15) >= 0.4 - 1e-6, 'clear of the near corner');
  assert.ok(minDistToPath(p.points, 10, 15) >= 0.4 - 1e-6, 'clear of the far corner');
  // and every straight stretch can really be walked
  for (let k = 3; k < p.points.length; k += 3) assert.equal(m.isVisible({ x: p.points[k - 3], y: 0, z: p.points[k - 1] }, { x: p.points[k], y: 0, z: p.points[k + 2] }), true);
  // a wider agent keeps further away
  const wide = m.findPath(P(2, 2), P(17, 2), { radius: 1 });
  assert.ok(minDistToPath(wide.points, 9, 15) >= 1 - 1e-6 && wide.length > p.length);
});

test('no route: not found, or a partial path to the nearest place that can be reached', () => {
  const [v, i] = field(10, 10, (x) => x === 5);                              // a wall right across
  const m = NavMesh.build(v, i);
  const none = m.findPath(P(1, 5), P(8, 5));
  assert.equal(none.found, false); assert.equal(none.points.length, 0);
  const part = m.findPath(P(1, 5), P(8, 5), { partial: true });
  assert.equal(part.found, false); assert.equal(part.partial, true);
  const [ex, ez] = [part.points[part.points.length - 3], part.points[part.points.length - 1]];
  assert.ok(ex >= 4 && ex <= 5 && Math.abs(ez - 5) < 1.5, `ends at the wall: ${ex}, ${ez}`);
  assert.equal(m.findPath(P(1, 5), P(1, 5)).found, true, 'already there');
  assert.equal(m.findPath(P(50, 0, 50), P(8, 5)).found, false, 'a start far from the mesh');
  assert.equal(m.findPath(P(1, 5, 0), P(1.5, 5, 0.5)).found, true);
  const snapped = m.findPath(P(1, 5), P(9, 5.5, 1.2));                       // 1.2 m above: still counts
  assert.equal(snapped.found, false, 'on the far side of the wall');
});

test('obstacles close a way and reopen it; areas of other cost bend the path', () => {
  const [v, i] = field(20, 3);
  const m = NavMesh.build(v, i, { agentRadius: 0.2, maxEdge: 1 });
  const before = m.findPath(P(1, 1.5), P(18, 1.5));
  near(before.length, 17, 1e-6);
  const v0 = m.version;
  const id = m.block(9, -1, 0, 11, 1, 3);                                    // a barricade across the whole corridor
  assert.ok(m.version > v0, 'agents can tell the mesh changed');
  assert.equal(m.findPath(P(1, 1.5), P(18, 1.5)).found, false);
  const half = m.blockCircle(10, 0.5, 1.4);
  m.unblock(id);
  const around = m.findPath(P(1, 1.5), P(18, 1.5));
  assert.equal(around.found, true); assert.ok(around.length > before.length, 'a pillar by one wall: the path goes round it');
  for (let k = 0; k < around.points.length; k += 3) assert.equal(m.nearest(around.points[k], 0, around.points[k + 2], 0.01) !== null, true);
  m.unblock(half);
  assert.deepEqual(m.findPath(P(1, 1.5), P(18, 1.5)).points, before.points, 'removed: as it was');
  m.unblock(12345);                                                           // an unknown id is harmless
  // mud on the straight way costs 5 times: the path curves away when it can
  const [wv, wi] = field(20, 8);
  const w = NavMesh.build(wv, wi, { maxEdge: 1 });
  const direct = w.findPath(P(1, 4), P(18, 4));
  w.areaCost[1] = 6;
  w.setArea(6, -1, 2, 12, 1, 6, 1);
  const detour = w.findPath(P(1, 4), P(18, 4));
  assert.ok(detour.length > direct.length + 0.5, 'longer');
  assert.ok(detour.points.some((c, k) => k % 3 === 2 && (c <= 2 + 1e-9 || c >= 6 - 1e-9)), 'but round the mud');
});

test('moving over the mesh passes triangles, slides along walls, and stops at the edge', () => {
  const m = wallMesh();
  const start = m.nearest(5, 0, 5, 1);
  const free = m.move(start.poly, 5, 5, 8, 7);
  assert.equal(free.hit, false); near(free.x, 8, 1e-9); near(free.z, 7, 1e-9);
  // walk into the wall (x = 9..10, z < 15) from the left, going up-right: slides up along it
  const s2 = m.nearest(8.5, 0, 5, 1);
  const slide = m.move(s2.poly, 8.5, 5, 10.5, 7);
  assert.equal(slide.hit, true); assert.ok(slide.x <= 9 + 1e-9, 'stopped at the wall'); assert.ok(slide.z > 5.5, 'and slid along it');
  // off the edge of the map
  const s3 = m.nearest(19.5, 0, 19.5, 1);
  const edge = m.move(s3.poly, 19.5, 19.5, 25, 19.5);
  assert.equal(edge.hit, true); near(edge.x, 20, 1e-9);
  assert.equal(m.raycast(P(1, 1), P(8, 1)).hit, false);
  const blocked = m.raycast(P(5, 5), P(15, 5));
  assert.equal(blocked.hit, true); assert.ok(blocked.t > 0.3 && blocked.t < 0.5, `t ${blocked.t}`); near(blocked.x, 9, 1e-6);
  assert.equal(m.isVisible(P(5, 5), P(5, 18)), true);
  assert.equal(m.isVisible(P(5, 5), P(15, 5)), false);
});

test('cutting big triangles smaller lets obstacles take small bites', () => {
  const v = [0, 0, 0, 20, 0, 0, 20, 0, 20, 0, 0, 20], idx = [0, 2, 1, 0, 3, 2];
  const coarse = NavMesh.build(v, idx), fine = NavMesh.build(v, idx, { maxEdge: 2 });
  assert.equal(coarse.count, 2); assert.ok(fine.count >= 200);
  coarse.blockCircle(10, 10, 1); fine.blockCircle(10, 10, 1);
  const open = (m) => { let n = 0; for (let p = 0; p < m.count; p++) if (m.blocked[p] === 0) n++; return n / m.count; };
  assert.equal(open(coarse), 0, 'the whole floor is one piece: all blocked');
  assert.ok(open(fine) > 0.95, 'only the patch around the circle is blocked');
  assert.ok(fine.findPath(P(2, 2), P(18, 18)).found);
});

test('the same input gives the same mesh and the same paths, and random points land on open ground', () => {
  const [v, i] = field(20, 20, (x, z) => x === 9 && z < 15);
  const a = NavMesh.build(v, i), b = NavMesh.build(v, i);
  assert.deepEqual(Array.from(a.nbr), Array.from(b.nbr));
  assert.deepEqual(a.findPath(P(2, 2), P(17, 2)).points, b.findPath(P(2, 2), P(17, 2)).points);
  let seed = 7;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  a.blockCircle(5, 5, 2);
  for (let k = 0; k < 200; k++) {
    const r = a.randomPoint(random);
    assert.ok(a.polyAt(r.x, 0, r.z) >= 0, 'on the mesh'); assert.ok(Math.hypot(r.x - 5, r.z - 5) > 1.4 - 1e-9 || a.blocked[r.poly] === 0, 'not in a blocked triangle');
    assert.equal(a.blocked[r.poly], 0);
  }
  assert.equal(NavMesh.build([], []).randomPoint(random), null);
});

test('a mesh of a hundred thousand triangles builds, and paths across it come back quickly', () => {
  const [v, i] = field(224, 224);                                             // 100,352 triangles
  const t0 = performance.now();                                               // determinism-ok: timing a test
  const m = NavMesh.build(v, i, { agentRadius: 0.3 });
  const built = performance.now() - t0;
  assert.equal(m.count, 224 * 224 * 2);
  const t1 = performance.now();
  const p = m.findPath(P(1, 1), P(222, 222));
  const found = performance.now() - t1;
  assert.equal(p.found, true); near(p.length, Math.hypot(221, 221), 1e-6);
  assert.ok(built < 5000 && found < 1500, `built in ${built.toFixed(0)} ms, path in ${found.toFixed(0)} ms`);
});
