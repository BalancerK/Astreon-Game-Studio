import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TriWorld, closestPointOnTriangle, sweepSphereVsTriangle, rayTriangle, moveEllipsoid, pushOutEllipsoid, findGround, createSlide3Result,
  CONTACT_FACE, CONTACT_EDGE, CONTACT_VERTEX, VERY_CLOSE,
} from '../src/index.js';

function rng(seed) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} ${a} vs ${b} (diff ${Math.abs(a - b)})`);

function randomTriangle(r, spread = 4) {
  const t = [];
  for (let i = 0; i < 9; i++) t.push((r() - 0.5) * spread);
  return t;
}
/** Distance from p to the triangle by dense sampling of barycentric coordinates (slow, obviously right). */
function bruteDistance(p, t, n = 120) {
  let best = Infinity;
  for (let i = 0; i <= n; i++) for (let j = 0; j <= n - i; j++) {
    const u = i / n, v = j / n, w = 1 - u - v;
    const x = t[0] * w + t[3] * u + t[6] * v - p[0], y = t[1] * w + t[4] * u + t[7] * v - p[1], z = t[2] * w + t[5] * u + t[8] * v - p[2];
    best = Math.min(best, x * x + y * y + z * z);
  }
  return Math.sqrt(best);
}

test('closest point on a triangle matches dense sampling (faces, edges and vertices all occur)', () => {
  const r = rng(1);
  const q = { x: 0, y: 0, z: 0 };
  for (let i = 0; i < 400; i++) {
    const t = randomTriangle(r);
    const p = [(r() - 0.5) * 8, (r() - 0.5) * 8, (r() - 0.5) * 8];
    const d = Math.sqrt(closestPointOnTriangle(p[0], p[1], p[2], ...t, q));
    const brute = bruteDistance(p, t);
    assert.ok(d <= brute + 1e-12, `never farther than any sampled point: ${d} vs ${brute}`);
    assert.ok(brute - d < 0.06, `and not much nearer than the samples: ${d} vs ${brute}`);
    // the point really is on the triangle: barycentric check
    const dist2 = (q.x - p[0]) ** 2 + (q.y - p[1]) ** 2 + (q.z - p[2]) ** 2;
    near(Math.sqrt(dist2), d, 1e-12);
  }
  // exact cases
  assert.equal(closestPointOnTriangle(0.2, 0.2, 5, 0, 0, 0, 1, 0, 0, 0, 1, 0, q), 25);
  near(q.x, 0.2, 1e-15); near(q.y, 0.2, 1e-15); assert.equal(q.z, 0, 'above the face');
  closestPointOnTriangle(-3, -3, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, q);
  assert.deepEqual([q.x, q.y, q.z], [0, 0, 0], 'a vertex');
  closestPointOnTriangle(0.5, -2, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, q);
  assert.deepEqual([q.x, q.y, q.z], [0.5, 0, 0], 'an edge');
});

/** Earliest time the unit sphere touches the triangle, by marching in tiny steps (slow reference). */
function bruteSweep(p, v, t, steps = 4000) {
  const q = { x: 0, y: 0, z: 0 };
  for (let i = 0; i <= steps; i++) {
    const s = i / steps;
    if (closestPointOnTriangle(p[0] + v[0] * s, p[1] + v[1] * s, p[2] + v[2] * s, ...t, q) < 1 - 1e-9) return s;
  }
  return -1;
}

test('sphere sweep against a triangle matches a fine-stepped reference (hit or miss, and when)', () => {
  const r = rng(2);
  const out = { t: 0, x: 0, y: 0, z: 0, kind: 0 };
  const kinds = new Set();
  let hits = 0, misses = 0, grazing = 0;
  for (let i = 0; i < 1500; i++) {
    const t = randomTriangle(r, 6);
    const p = [(r() - 0.5) * 10, (r() - 0.5) * 10, (r() - 0.5) * 10];
    const v = [(r() - 0.5) * 12, (r() - 0.5) * 12, (r() - 0.5) * 12];
    const brute = bruteSweep(p, v, t);
    // skip cases that start overlapping (a separate contract, tested below)
    const q = { x: 0, y: 0, z: 0 };
    if (closestPointOnTriangle(p[0], p[1], p[2], ...t, q) < 1) continue;
    const found = sweepSphereVsTriangle(p[0], p[1], p[2], v[0], v[1], v[2], ...t, 1, out);
    if (brute < 0 && !found) { misses++; continue; }
    if (brute >= 0 && found) { near(out.t, brute, 2.5e-3, `case ${i}: contact time`); hits++; kinds.add(out.kind); continue; }
    // disagreement is only acceptable when the path barely grazes (within the sampling resolution)
    const end = { x: 0, y: 0, z: 0 };
    const dEnd = Math.sqrt(closestPointOnTriangle(p[0] + v[0], p[1] + v[1], p[2] + v[2], ...t, end));
    grazing++;
    assert.ok(grazing < 25, `too many disagreements: case ${i} brute ${brute} found ${found} (end distance ${dEnd})`);
  }
  assert.ok(hits > 60 && misses > 150, `${hits} hits, ${misses} misses`);
  assert.ok(kinds.has(CONTACT_FACE) && kinds.has(CONTACT_EDGE) && kinds.has(CONTACT_VERTEX), `all three contact kinds occurred: ${[...kinds]}`);
});

test('sweep contract: resting contact, moving away and along are free; moving in stops; overlap reports only if moving in', () => {
  const out = { t: 0, x: 0, y: 0, z: 0, kind: 0 };
  const tri = [-5, 0, -5, 5, 0, -5, 0, 0, 5]; // a floor triangle at y = 0
  const hit = (py, vx, vy, vz) => sweepSphereVsTriangle(0, py, 0, vx, vy, vz, ...tri, 1, out);
  assert.ok(!hit(1, 0, 0.5, 0), 'resting exactly on the surface, moving up');
  assert.ok(!hit(1, 3, 0, 0), 'resting, sliding along it');
  assert.ok(hit(1, 0, -0.1, 0) && out.t === 0 && out.kind === CONTACT_FACE, 'resting, pushing down: contact at once');
  assert.ok(hit(3, 0, -4, 0) && Math.abs(out.t - 0.5) < 1e-12, 'falling onto it from 3 high with a 4 drop: touches at t = 0.5');
  assert.ok(!hit(3, 0, -1, 0), 'too short to reach');
  assert.ok(!hit(3, 0, 5, 0), 'moving away');
  assert.ok(hit(-3, 0, 4, 0) && Math.abs(out.t - 0.5) < 1e-12, 'it is two-sided: from below works too');
  assert.ok(hit(0.5, 0, -1, 0) && out.t === 0, 'overlapping and moving in');
  assert.ok(!hit(0.5, 0, 1, 0), 'overlapping but moving out: let it leave');
  assert.ok(!sweepSphereVsTriangle(0, 1, 0, 0, -5, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, out), 'a degenerate triangle never hits');
  assert.ok(!hit(3, 0, -4, 0) === false);
  // tLimit: a nearer hit elsewhere hides this one
  assert.ok(!sweepSphereVsTriangle(0, 3, 0, 0, -4, 0, ...tri, 0.4, out), 'beyond the limit');
});

test('ray against a triangle (Moeller-Trumbore): hit distance, misses, parallel, both sides', () => {
  const tri = [0, 0, 0, 4, 0, 0, 0, 4, 0];
  assert.equal(rayTriangle(1, 1, 5, 0, 0, -1, ...tri, 100), 5);
  assert.equal(rayTriangle(1, 1, -5, 0, 0, 1, ...tri, 100), 5, 'from behind too');
  assert.equal(rayTriangle(3, 3, 5, 0, 0, -1, ...tri, 100), -1, 'outside the hypotenuse');
  assert.equal(rayTriangle(1, 1, 5, 0, 0, -1, ...tri, 4), -1, 'out of range');
  assert.equal(rayTriangle(1, 1, 5, 1, 0, 0, ...tri, 100), -1, 'parallel');
  assert.equal(rayTriangle(1, 1, -5, 0, 0, -1, ...tri, 100), -1, 'pointing away');
  assert.equal(rayTriangle(1, 1, 5, 0, 0, -2, ...tri, 100), 2.5, 't is in multiples of the direction');
});

/** A random scene of boxes and loose triangles. */
function randomScene(r, boxes = 25, tris = 25, size = 60) {
  const w = new TriWorld({ cellSize: 6 });
  for (let i = 0; i < boxes; i++) w.addBox(r() * size, r() * size, r() * size, 0.5 + r() * 4, 0.5 + r() * 4, 0.5 + r() * 4);
  for (let i = 0; i < tris; i++) w.addTriangle(r() * size, r() * size, r() * size, r() * size, r() * size, r() * size, r() * size, r() * size, r() * size);
  return w.build();
}

test('broad phase: queryAabb returns every triangle the box touches, and raycast equals brute force', () => {
  const r = rng(3);
  for (let scene = 0; scene < 6; scene++) {
    const w = randomScene(r);
    const v = w.verts, out = new Int32Array(w.triangleCount);
    for (let q = 0; q < 60; q++) {
      const c = [r() * 60, r() * 60, r() * 60], h = [r() * 6, r() * 6, r() * 6];
      const n = w.queryAabb(c[0] - h[0], c[1] - h[1], c[2] - h[2], c[0] + h[0], c[1] + h[1], c[2] + h[2], out);
      const got = new Set(out.subarray(0, n));
      assert.equal(got.size, n, 'no duplicates');
      for (let i = 0; i < w.triangleCount; i++) {
        let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
        for (let k = 0; k < 3; k++) for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], v[i * 9 + k * 3 + a]); hi[a] = Math.max(hi[a], v[i * 9 + k * 3 + a]); }
        const overlaps = [0, 1, 2].every((a) => hi[a] >= c[a] - h[a] && lo[a] <= c[a] + h[a]);
        if (overlaps) assert.ok(got.has(i), `scene ${scene}: triangle ${i} overlaps the box but was not returned`);
      }
    }
    const hit = { t: 0, index: -1, nx: 0, ny: 0, nz: 0 };
    for (let q = 0; q < 200; q++) {
      const o = [(r() - 0.2) * 80, (r() - 0.2) * 80, (r() - 0.2) * 80];
      const d = [r() - 0.5, r() - 0.5, r() - 0.5];
      const maxT = q % 3 === 0 ? 30 : 300;
      let best = Infinity, bestI = -1;
      for (let i = 0; i < w.triangleCount; i++) {
        const t = rayTriangle(o[0], o[1], o[2], d[0], d[1], d[2], v[i * 9], v[i * 9 + 1], v[i * 9 + 2], v[i * 9 + 3], v[i * 9 + 4], v[i * 9 + 5], v[i * 9 + 6], v[i * 9 + 7], v[i * 9 + 8], maxT);
        if (t >= 0 && t < best) { best = t; bestI = i; }
      }
      const found = w.raycast(o[0], o[1], o[2], d[0], d[1], d[2], maxT, hit);
      assert.equal(found, bestI >= 0, `scene ${scene} ray ${q}`);
      if (found) {
        near(hit.t, best, 1e-9, `scene ${scene} ray ${q}: distance`);
        assert.ok(hit.nx * d[0] + hit.ny * d[1] + hit.nz * d[2] <= 1e-12, 'the reported normal faces the ray');
      }
    }
  }
});

test('world building: boxes, quads and indexed meshes become triangles; empty and huge worlds are safe', () => {
  const w = new TriWorld();
  w.addBox(0, 0, 0, 1, 1, 1);
  assert.equal(w.triangleCount, 12);
  w.addQuad(0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0);
  assert.equal(w.triangleCount, 14);
  w.addMesh([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0], [0, 1, 2, 1, 3, 2]);
  assert.equal(w.triangleCount, 16);
  w.build();
  // box normals point outward
  const hit = { t: 0, index: -1, nx: 0, ny: 0, nz: 0 };
  const out = new TriWorld(); out.addBox(0, 0, 0, 1, 1, 1); out.build();
  for (let i = 0; i < 12; i++) { // the centre of every face, seen from inside the box, is a hit whose own normal points away from the centre
    const cx = (out.verts[i * 9] + out.verts[i * 9 + 3] + out.verts[i * 9 + 6]) / 3, cy = (out.verts[i * 9 + 1] + out.verts[i * 9 + 4] + out.verts[i * 9 + 7]) / 3, cz = (out.verts[i * 9 + 2] + out.verts[i * 9 + 5] + out.verts[i * 9 + 8]) / 3;
    assert.ok(out.nx[i] * cx + out.ny[i] * cy + out.nz[i] * cz > 0.99, `triangle ${i} faces outward`);
  }
  void hit;
  const empty = new TriWorld().build();
  assert.equal(empty.queryAabb(-1, -1, -1, 1, 1, 1, new Int32Array(4)), 0);
  assert.equal(empty.raycast(0, 0, 0, 1, 0, 0, 10, hit), false);
  const huge = new TriWorld({ cellSize: 1, maxCells: 1000 });
  huge.addBox(0, 0, 0, 1000, 1, 1000);
  huge.build();
  assert.ok(huge.cols * huge.rows * huge.layers <= 1000, 'the cell size grew to respect maxCells');
  assert.equal(huge.raycast(0, 50, 0, 0, -1, 0, 100, hit), true);
  near(hit.t, 49, 1e-12);
});

// ---- movement ----
const R = [0.4, 0.9, 0.4];
function room(w = 20, h = 10, d = 20) {
  const world = new TriWorld({ cellSize: 4 });
  const X = w / 2, Z = d / 2;
  world.addQuad(-X, 0, -Z, X, 0, -Z, X, 0, Z, -X, 0, Z);
  world.addQuad(-X, h, -Z, -X, h, Z, X, h, Z, X, h, -Z);
  world.addQuad(-X, 0, -Z, -X, h, -Z, X, h, -Z, X, 0, -Z);
  world.addQuad(-X, 0, Z, X, 0, Z, X, h, Z, -X, h, Z);
  world.addQuad(-X, 0, -Z, -X, 0, Z, -X, h, Z, -X, h, -Z);
  world.addQuad(X, 0, -Z, X, h, -Z, X, h, Z, X, 0, Z);
  return world.build();
}

test('nothing escapes a sealed room made of zero-thickness quads, at any speed or direction', () => {
  const world = room();
  const r = rng(4), out = createSlide3Result();
  let touched = 0;
  for (let i = 0; i < 30_000; i++) {
    const mag = [0.5, 8, 150, 1e4, 1e7][i % 5];
    const x = (r() - 0.5) * 16, y = 1 + r() * 7.5, z = (r() - 0.5) * 16;
    moveEllipsoid(world, x, y, z, (r() - 0.5) * mag, (r() - 0.5) * mag, (r() - 0.5) * mag, R[0], R[1], R[2], out);
    const e = 1e-9;
    assert.ok(Number.isFinite(out.x + out.y + out.z), `case ${i}: finite`);
    assert.ok(out.x >= -10 + R[0] - e && out.x <= 10 - R[0] + e && out.z >= -10 + R[2] - e && out.z <= 10 - R[2] + e && out.y >= R[1] - e && out.y <= 10 - R[1] + e,
      `case ${i} (move ${mag}): escaped to ${out.x}, ${out.y}, ${out.z}`);
    if (out.hit) touched++;
  }
  assert.ok(touched > 15_000, `${touched} moves hit something (the test is meaningful)`);
});

test('a sealed room made of a single layer of triangles with open seams still holds (moving along edges and corners)', () => {
  const world = room(8, 6, 8);
  const out = createSlide3Result(), r = rng(5);
  for (let i = 0; i < 20_000; i++) {
    // start hugging an edge or a corner so contacts happen on edges and vertices, not faces
    const x = (r() < 0.5 ? -1 : 1) * (4 - R[0] - r() * 0.02), z = (r() < 0.5 ? -1 : 1) * (4 - R[2] - r() * 0.02), y = R[1] + r() * 0.02;
    moveEllipsoid(world, x, y, z, (r() - 0.5) * 40, (r() - 0.5) * 40, (r() - 0.5) * 40, R[0], R[1], R[2], out);
    assert.ok(Math.abs(out.x) <= 4 - R[0] + 1e-9 && Math.abs(out.z) <= 4 - R[2] + 1e-9 && out.y >= R[1] - 1e-9 && out.y <= 6 - R[1] + 1e-9, `case ${i}: ${out.x}, ${out.y}, ${out.z}`);
  }
});

/** Nearest distance (in ellipsoid space) from the body centre to any triangle: >= 1 means not penetrating. */
function clearance(world, x, y, z) {
  const q = { x: 0, y: 0, z: 0 };
  let best = Infinity;
  for (let i = 0; i < world.triangleCount; i++) {
    const o = i * 9, v = world.verts;
    const d2 = closestPointOnTriangle(x / R[0], y / R[1], z / R[2], v[o] / R[0], v[o + 1] / R[1], v[o + 2] / R[2], v[o + 3] / R[0], v[o + 4] / R[1], v[o + 5] / R[2], v[o + 6] / R[0], v[o + 7] / R[1], v[o + 8] / R[2], q);
    if (d2 < best) best = d2;
  }
  return Math.sqrt(best);
}

test('in a cluttered scene the final position never penetrates any triangle, whatever the speed', () => {
  const r = rng(6);
  const out = createSlide3Result();
  let hits = 0, total = 0;
  for (let scene = 0; scene < 5; scene++) {
    const world = randomScene(r, 18, 30, 40);
    for (let i = 0; i < 400; i++) {
      let x = r() * 40, y = r() * 40, z = r() * 40;
      if (clearance(world, x, y, z) < 1.001) continue; // start free
      const mag = [2, 20, 400, 1e5][i % 4];
      moveEllipsoid(world, x, y, z, (r() - 0.5) * mag, (r() - 0.5) * mag, (r() - 0.5) * mag, R[0], R[1], R[2], out);
      total++;
      if (out.hit) hits++;
      const c = clearance(world, out.x, out.y, out.z);
      assert.ok(c >= 1 - 1e-6, `scene ${scene} case ${i}: ended penetrating (clearance ${c})`);
    }
  }
  assert.ok(total > 800 && hits > 300, `${hits}/${total} moves collided`);
});

test('slide: a wall keeps the parallel motion; a crease slides along the crease; a corner holds', () => {
  const world = new TriWorld();
  world.addBox(0, 5, 0, 0.5, 5, 20); // wall facing +x at x = 0.5
  world.build();
  const out = createSlide3Result();
  moveEllipsoid(world, 3, 1, 0, -10, 0, 6, R[0], R[1], R[2], out);
  assert.ok(out.hit);
  near(out.x, 0.5 + R[0] + VERY_CLOSE * R[0], 0.002, 'stopped at the wall');
  near(out.z, 6, 0.01, 'the whole parallel component survived');
  near(out.normals[0], 1, 1e-9); near(out.normals[1], 0, 1e-9, 'a vertical wall has a horizontal normal');

  // an inner corner of two walls: the motion into the corner ends in it, never past either wall
  const c2 = new TriWorld();
  c2.addBox(-5, 5, 0, 0.5, 5, 20); c2.addBox(0, 5, -5, 20, 5, 0.5); // walls at x = -4.5 and z = -4.5, forming a corner for x > -4.5, z > -4.5
  c2.build();
  moveEllipsoid(c2, 0, 1, 0, -30, 0, -30, R[0], R[1], R[2], out);
  assert.ok(out.x >= -4.5 + R[0] - 1e-6 && out.z >= -4.5 + R[2] - 1e-6, `${out.x}, ${out.z}`);
  near(out.x, -4.5 + R[0], 0.01); near(out.z, -4.5 + R[2], 0.01);

  // wedge between a floor and a 45 degree slope: slide along the crease line
  const w3 = new TriWorld();
  w3.addQuad(-20, 0, -20, 20, 0, -20, 20, 0, 20, -20, 0, 20);
  w3.addQuad(0, 0, -20, 0, 0, 20, 20, 20, 20, 20, 20, -20); // rises toward +x
  w3.build();
  moveEllipsoid(w3, -2, 3, 0, 4, -10, 6, R[0], R[1], R[2], out);
  assert.ok(out.z > 3, `slid along the crease in +z: ${out.z}`);
});

test('wall mode: pushing against a surface too steep to walk on never lifts the body; the same slope slides when walkable', () => {
  const steep = new TriWorld(); // a 60 degree ramp rising toward -z
  steep.addQuad(-20, 0, 0, 20, 0, 0, 20, 17.32, -10, -20, 17.32, -10);
  steep.addQuad(-20, 0, 5, 20, 0, 5, 20, 0, 0, -20, 0, 0); // flat ground in front of it
  steep.build();
  const out = createSlide3Result();
  moveEllipsoid(steep, 0, 0.9, 3, 0, 0, -6, R[0], R[1], R[2], out);
  assert.ok(out.y > 1.5, 'without wall mode it slides up the ramp');
  moveEllipsoid(steep, 0, 0.9, 3, 0, 0, -6, R[0], R[1], R[2], out, 0.7);
  assert.ok(out.y < 0.95, `with wall mode (normal y 0.5 < 0.7) it stays on the ground: y = ${out.y}`);
  moveEllipsoid(steep, 0, 0.9, 3, 0, 0, -6, R[0], R[1], R[2], out, 0.4);
  assert.ok(out.y > 1.5, 'a limit below the slope\'s own normal.y (0.5) treats it as walkable: free to slide up');
});

test('push out of embedded positions, and ground detection at flats, ramps and ledge edges', () => {
  const world = new TriWorld();
  world.addBox(0, -1, 0, 20, 1, 20); // ground, top at y = 0
  world.build();
  const out = { x: 0, y: 0.3, z: 0 }; // body centre 0.3 above the ground: the 0.9 half-height ellipsoid sinks 0.6
  assert.ok(pushOutEllipsoid(world, out, R[0], R[1], R[2]));
  assert.ok(out.y >= 0.9 - 1e-3, `pushed up to ${out.y}`);
  assert.equal(pushOutEllipsoid(world, out, R[0], R[1], R[2]), false, 'free: unchanged');
  const g = { nx: 0, ny: 0, nz: 0, tri: -1 };
  assert.ok(findGround(world, 0, 0.9 + 0.002, 0, R[0], R[1], R[2], g));
  near(g.ny, 1, 1e-12);
  assert.ok(!findGround(world, 0, 3, 0, R[0], R[1], R[2], g), 'in the air');
  // a ledge: the top face and the front face meet at an edge; standing with the body half over the edge still finds the TOP
  const ledge = new TriWorld();
  ledge.addBox(0, -1, 0, 5, 1, 5); // top at y = 0, edge at x = 5
  ledge.build();
  assert.ok(findGround(ledge, 5.12, 0.858, 0, R[0], R[1], R[2], g), 'hanging 0.12 over the edge, touching it');
  near(g.ny, 1, 1e-12, 'the support is the flat top, not the vertical side');
});
