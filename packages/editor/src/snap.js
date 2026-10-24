// Snapping to other objects: while you move something, or drag the side of a box, it jumps to line up with what is already there: the faces, the middle and the far side of
// the other boxes, and corner to corner. This is the maths only (no page): boxes are `{min, max}` in world coordinates (with `points`, their corners and middle, for
// corner snapping), and the answers say how far to nudge and what to draw as a guide.

/** The world box that holds an oriented box (its matrix and half sizes). @returns {{min: number[], max: number[]}} */
export function aabbOf(matrix, half) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < 8; i++) {
    const x = i & 1 ? half[0] : -half[0];
    const y = i & 2 ? half[1] : -half[1];
    const z = i & 4 ? half[2] : -half[2];
    for (let a = 0; a < 3; a++) {
      const v = matrix[a] * x + matrix[4 + a] * y + matrix[8 + a] * z + matrix[12 + a];
      if (v < min[a]) min[a] = v;
      if (v > max[a]) max[a] = v;
    }
  }
  return { min, max };
}

/** How far apart two boxes are along an axis (0 when they overlap there). */
const gap = (a, b, axis) => Math.max(0, a.min[axis] - b.max[axis], b.min[axis] - a.max[axis]);
const middle = (b, axis) => (b.min[axis] + b.max[axis]) / 2;

/** The nearby boxes worth lining up with: within `near` of the mover on the other two axes. */
function neighbours(box, targets, axis, near) {
  return targets.filter((t) => [0, 1, 2].every((a) => a === axis || gap(box, t, a) <= near));
}

/**
 * Nudge a move so that the moving box lines up with the other boxes: its near side, middle or far side meets a near side, middle or far side of another box, on each axis
 * that is allowed to move.
 * @param {{min: number[], max: number[]}} box where the moving thing was at the start
 * @param {number[]} vector how far it is being moved now
 * @param {{min: number[], max: number[]}[]} targets the other boxes
 * @param {{threshold: number, axes?: boolean[], near?: number}} o `threshold`: how close (world units) before it jumps; `axes`: which axes may snap; `near`: how far away on the other axes a box may be and still count
 * @returns {{vector: number[], guides: {axis: number, value: number, from: number[], to: number[]}[]}} the nudged move and a line to draw for each snap
 */
export function snapMove(box, vector, targets, { threshold, axes = [true, true, true], near = 3 } = {}) {
  const out = [...vector];
  const guides = [];
  for (let a = 0; a < 3; a++) {
    if (!axes[a]) continue;
    const moved = { min: box.min.map((v, i) => v + out[i]), max: box.max.map((v, i) => v + out[i]) };
    const mine = [moved.min[a], middle(moved, a), moved.max[a]];
    let best = null;
    for (const t of neighbours(moved, targets, a, near)) {
      for (const v of [t.min[a], middle(t, a), t.max[a]]) {
        for (const m of mine) {
          const d = v - m;
          if (Math.abs(d) <= threshold && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, value: v, target: t };
        }
      }
    }
    if (best) {
      out[a] += best.d;
      const here = { min: box.min.map((v, i) => v + out[i]), max: box.max.map((v, i) => v + out[i]) };
      const from = [0, 1, 2].map((i) => middle(here, i));
      const to = [0, 1, 2].map((i) => middle(best.target, i));
      from[a] = best.value;
      to[a] = best.value;
      guides.push({ axis: a, value: best.value, from, to });
    }
  }
  return { vector: out, guides };
}

/**
 * Snap one coordinate (the place of a face being dragged) to the sides and middles of other boxes on the same axis.
 * @param {number} value where the face is now, along world axis `axis`
 * @param {number} axis 0, 1 or 2
 * @param {{min: number[], max: number[]}} self the box being edited, as it is now (to say which others are near)
 * @param {{min: number[], max: number[]}[]} targets
 * @param {{threshold: number, near?: number}} o
 * @returns {{value: number, target: {min: number[], max: number[]}} | null} the place to snap to, or null
 */
export function snapCoordinate(value, axis, self, targets, { threshold, near = 3 } = {}) {
  let best = null;
  for (const t of neighbours(self, targets, axis, near)) {
    for (const v of [t.min[axis], middle(t, axis), t.max[axis], ...(t.points ?? []).map((p) => p[axis])]) {
      const d = v - value;
      if (Math.abs(d) <= threshold && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, value: v, target: t };
    }
  }
  return best ? { value: best.value, target: best.target } : null;
}

/**
 * The points of a thing that can snap to a point: the corners and the middle of a box (the real corners, so a turned box has turned ones), the six corners of a ramp,
 * the middle and the two ends of a capsule, the middle of a ball.
 * @param {{matrix: ArrayLike<number>, half: number[], shape?: {type: string, radius?: number, halfHeight?: number}, ramp?: boolean}} item
 * @returns {number[][]}
 */
export function pointsOf(item) {
  const m = item.matrix;
  const h = item.half;
  const at = (x, y, z) => [0, 1, 2].map((a) => m[a] * x + m[4 + a] * y + m[8 + a] * z + m[12 + a]);
  const type = item.shape?.type ?? 'box';
  const centre = at(0, 0, 0);
  if (type === 'sphere') return [centre];
  if (type === 'capsule') return [centre, at(0, h[1], 0), at(0, -h[1], 0)];
  const corners = [];
  for (let i = 0; i < 8; i++) {
    const x = i & 1 ? h[0] : -h[0];
    const y = i & 2 ? h[1] : -h[1];
    const z = i & 4 ? h[2] : -h[2];
    if (item.ramp && y > 0 && z > 0) continue;                                  // a ramp has no top at its low end
    corners.push(at(x, y, z));
  }
  return [centre, ...corners];
}

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/**
 * Snap a move so that one of the moving thing's points lands exactly on a point of another thing (corner to corner, middle to middle, corner to middle).
 * @param {number[][]} mine the moving thing's points, where they were at the start
 * @param {number[]} vector how far it is being moved now
 * @param {{min: number[], max: number[], points?: number[][]}[]} targets the other things (a box that holds them, and their points)
 * @param {{threshold: number}} o how close (world units) a point must come before it jumps
 * @returns {{vector: number[], guide: {from: number[], to: number[]}} | null} null when no point is close enough
 */
export function snapPoints(mine, vector, targets, { threshold }) {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (const p of mine) for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], p[a] + vector[a]); hi[a] = Math.max(hi[a], p[a] + vector[a]); }
  let best = null;
  for (const t of targets) {
    if (!t.points || [0, 1, 2].some((a) => lo[a] - threshold > t.max[a] || hi[a] + threshold < t.min[a])) continue;     // too far away to have a point in reach
    for (const q of t.points) {
      for (const p of mine) {
        const moved = [p[0] + vector[0], p[1] + vector[1], p[2] + vector[2]];
        const d = dist(moved, q);
        if (d <= threshold && (!best || d < best.d)) best = { d, from: moved, to: q };
      }
    }
  }
  if (!best) return null;
  return { vector: vector.map((v, a) => v + best.to[a] - best.from[a]), guide: { from: best.to, to: best.to } };
}

// ---- turning: snap the angle of a rotation so that an object's sides line up with the world's or another object's ----
const rotate = (q, v) => {
  const [x, y, z, w] = q;
  const uvx = y * v[2] - z * v[1];
  const uvy = z * v[0] - x * v[2];
  const uvz = x * v[1] - y * v[0];
  const uuvx = y * uvz - z * uvy;
  const uuvy = z * uvx - x * uvz;
  const uuvz = x * uvy - y * uvx;
  return [v[0] + 2 * (w * uvx + uuvx), v[1] + 2 * (w * uvy + uuvy), v[2] + 2 * (w * uvz + uuvz)];
};
const AXES = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/**
 * Snap the angle of a turn about an axis so that the turned thing's sides run parallel to the sides of something else (the world's axes, another object, the 3D cursor).
 * For each side of the thing and each side of a target it works out the angle that makes them parallel (in the plane the turn happens in; a side that points along the axis
 * does not turn and is left out), and takes the one nearest the angle asked for if it is within reach. Sides count in both directions, so a box also meets a target a quarter
 * turn away.
 * @param {number[]} axis the unit axis of the turn (world)
 * @param {number[]} start the thing's orientation before the turn, a quaternion [x, y, z, w]
 * @param {number} angle the turn asked for, radians
 * @param {number[][]} targets orientations to line up with (quaternions)
 * @param {{threshold: number}} o how close (radians) before it jumps
 * @returns {{angle: number, target: number, from: number[], to: number[]} | null} the snapped angle, which target it met (an index into `targets`), and the directions of the thing's
 *   side and the target's side (after the turn) that are now parallel; null when nothing is in reach
 */
export function snapAngle(axis, start, angle, targets, { threshold }) {
  const p0 = Math.abs(axis[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const p = cross3(p0, axis);
  const pl = Math.hypot(...p);
  const pu = p.map((v) => v / pl);
  const qu = cross3(axis, pu);
  const phi = (v) => {
    const along = dot3(v, axis);
    const flat = [v[0] - axis[0] * along, v[1] - axis[1] * along, v[2] - axis[2] * along];
    return Math.hypot(...flat) < 0.3 ? null : Math.atan2(dot3(flat, qu), dot3(flat, pu));
  };
  const mine = AXES.map((e) => rotate(start, e));
  const mineAngles = mine.map(phi);
  let best = null;
  targets.forEach((q, index) => {
    AXES.forEach((e) => {
      const side = rotate(q, e);
      const psi = phi(side);
      if (psi === null) return;
      mineAngles.forEach((own, i) => {
        if (own === null) return;
        const d = psi - own;
        const theta = d + Math.PI * Math.round((angle - d) / Math.PI);                    // the angle that makes them parallel, nearest the one asked for
        const off = Math.abs(theta - angle);
        if (off <= threshold && (!best || off < best.off)) best = { off, theta, index, own: i, side };
      });
    });
  });
  if (!best) return null;
  const c = Math.cos(best.theta);
  const s = Math.sin(best.theta);
  const turn = (v) => {                                                                            // Rodrigues: v turned by theta about the axis
    const k = cross3(axis, v);
    const d = dot3(axis, v);
    return [v[0] * c + k[0] * s + axis[0] * d * (1 - c), v[1] * c + k[1] * s + axis[1] * d * (1 - c), v[2] * c + k[2] * s + axis[2] * d * (1 - c)];
  };
  return { angle: best.theta, target: best.index, from: turn(mine[best.own]), to: best.side };
}

// ---- stretching: snap how big a box gets so that its sides meet other boxes' sides, or it matches their size ----

/**
 * Snap the size of a box that is being stretched about its middle. Each side of the box moves out (or in) by the same amount, so the question is how far from the middle a side may
 * be: it snaps to a place where it meets a side or the middle of another box, to the floor and the world's other planes (zero), or to the other box's own half size (the same width,
 * height or depth).
 * @param {number} factor the stretch asked for (1 leaves the box as it is); the same on every axis that is stretching
 * @param {{half: number, centre: number, k: number | null}[]} axes the axes that stretch: the half size now, where the middle is along the world axis `k` (null when the box's
 *   axis does not run along a world axis: nothing can snap on it)
 * @param {{min: number[], max: number[], id?: string}[]} targets the other boxes
 * @param {{min: number[], max: number[]}} self the box that holds the stretching one now (to say which others are near)
 * @param {{threshold: number, near?: number, floor?: boolean}} o `threshold`: how close (world units) before it jumps; `near`: how far away on the other axes a box may be and still count
 * @returns {{factor: number, kind: 'side' | 'size', axis: number, k: number, value: number, target: object | null} | null} the snapped stretch, or null when nothing is in reach
 */
export function snapStretch(factor, axes, targets, self, { threshold, near = 3, floor = true }) {
  let best = null;
  axes.forEach((a, index) => {
    if (a.k === null || !(a.half > 0)) return;
    const want = a.half * factor;
    const consider = (half, kind, target, value) => {
      if (half < 0.025) return;
      const off = Math.abs(half - want);
      if (off <= threshold && (!best || off < best.off)) best = { off, factor: half / a.half, kind, axis: index, k: a.k, value, target };
    };
    if (floor) consider(Math.abs(0 - a.centre), 'side', null, 0);
    for (const t of neighbours(self, targets, a.k, near)) {
      for (const v of [t.min[a.k], middle(t, a.k), t.max[a.k]]) consider(Math.abs(v - a.centre), 'side', t, v);
      consider((t.max[a.k] - t.min[a.k]) / 2, 'size', t, null);
    }
  });
  return best ? { factor: best.factor, kind: best.kind, axis: best.axis, k: best.k, value: best.value, target: best.target } : null;
}
