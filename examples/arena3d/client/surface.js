// Which way does the surface at a point face? A shot only tells the client where it ended; to lay a bullet hole flat on the wall,
// or send sparks away from it, the client looks the point up in the level it already has.

const TOLERANCE = 0.09;

/**
 * @param {import('../shared/level.js').LevelPart[]} parts
 * @param {number[]} p Point on (or very near) a surface.
 * @param {number[]} towards A direction the surface should face (back toward the shooter): picks the side of a thin wall or a quad.
 * @returns {number[]} A unit normal.
 */
export function surfaceNormal(parts, p, towards) {
  let best = null, bestDist = TOLERANCE;
  for (const part of parts) {
    if (part.kind === 'box') {
      const d = [p[0] - part.x, p[1] - part.y, p[2] - part.z], h = [part.hx, part.hy, part.hz];
      if (d.some((v, i) => Math.abs(v) > h[i] + TOLERANCE)) continue;
      for (let a = 0; a < 3; a++) {
        const dist = Math.abs(h[a] - Math.abs(d[a]));
        if (dist < bestDist) { bestDist = dist; best = [0, 0, 0]; best[a] = Math.sign(d[a]) || 1; }
      }
    } else {
      const v = part.v;
      const e1 = [v[3] - v[0], v[4] - v[1], v[5] - v[2]], e2 = [v[9] - v[0], v[10] - v[1], v[11] - v[2]];
      let n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      const l = Math.hypot(...n) || 1; n = n.map((x) => x / l);
      const dist = Math.abs(n[0] * (p[0] - v[0]) + n[1] * (p[1] - v[1]) + n[2] * (p[2] - v[2]));
      if (dist >= bestDist) continue;
      let inside = true; // inside the quad's bounding box (a ramp is a convex quad, so this is close enough at the tolerance used)
      for (let a = 0; a < 3; a++) {
        const lo = Math.min(v[a], v[3 + a], v[6 + a], v[9 + a]) - TOLERANCE, hi = Math.max(v[a], v[3 + a], v[6 + a], v[9 + a]) + TOLERANCE;
        if (p[a] < lo || p[a] > hi) inside = false;
      }
      if (inside) { bestDist = dist; best = n[0] * towards[0] + n[1] * towards[1] + n[2] * towards[2] >= 0 ? n : n.map((x) => -x); }
    }
  }
  if (best) return best;
  const l = Math.hypot(...towards) || 1;
  return [towards[0] / l, towards[1] / l, towards[2] / l];
}
