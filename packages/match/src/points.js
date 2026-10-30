// Control points: where they go on a map, and how a point is taken and scores. Pure: the same map and starts give the same points.
import { cos, sin } from '@engine/math';

/** How wide a control point is, in metres. */
export const POINT_RADIUS = 180;
/** How many seconds one actor alone takes to capture a point (a held point scores one a second). */
export const CAPTURE_SECONDS = 8;
/** How far out the flank points are from the middle one, as a share of the way between the teams; how many point widths apart any two are at least; how far and how finely a place for a point is looked for. */
const FLANK = 0.3;
const SEPARATION = 3;
const SEARCH = 1500;
const STEP = 100;
/** How much of the usual speed a point is taken at when the other team still has actors on it but fewer. */
export const CONTESTED = 0.4;

/**
 * The control points of a map: one in the middle between where the two teams start and one far out on each flank, on open land, each as near as can be to equally far from both teams, so that
 * neither starts with a point to itself. A point is found by looking over the land round where it ought to be for a place that is mostly above the sea all the way round and not steep (on a map
 * without land to look at, the spawn points stand in). Pure: the same map and starts give the same points.
 * @param {{spawns: number[][], heightAt?: (x: number, z: number) => number, half?: number}} map @param {number[]} [a] where the first team starts (x, z; the first spawn point if left out)
 * @param {number[]} [b] where the second does (the spawn furthest from the first)
 * @returns {Array<{x: number, z: number, r: number, control: number, owner: number, name: string}>}
 */
export function controlPoints(map, a, b) {
  const s = map.spawns;
  a ??= s[0];
  b ??= s.reduce((best, p) => (Math.hypot(p[0] - a[0], p[1] - a[1]) > Math.hypot(best[0] - a[0], best[1] - a[1]) ? p : best), s[0]);
  const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const ax = (b[0] - a[0]) / len, az = (b[1] - a[1]) / len;                                  // along the way from one team to the other
  const unfair = (x, z) => Math.abs(Math.hypot(x - a[0], z - a[1]) - Math.hypot(x - b[0], z - b[1]));
  const targets = [[mid[0] - az * len * FLANK, mid[1] + ax * len * FLANK], mid, [mid[0] + az * len * FLANK, mid[1] - ax * len * FLANK]];
  const taken = [];
  const clear = (x, z) => Math.hypot(x - a[0], z - a[1]) > POINT_RADIUS * 2 && Math.hypot(x - b[0], z - b[1]) > POINT_RADIUS * 2 && taken.every((t) => Math.hypot(x - t[0], z - t[1]) > POINT_RADIUS * SEPARATION);
  /** How bad a place is for a point (lower is better), or Infinity if it cannot be one: land all the way round, and the flatter the better. */
  const trouble = (x, z) => {
    const h = map.heightAt(x, z);
    if (!(h > 1) || Math.abs(x) > map.half - POINT_RADIUS * 2 || Math.abs(z) > map.half - POINT_RADIUS * 2) return Infinity;
    let rough = 0, wet = 0;
    for (let k = 0; k < 8; k++) {
      const ang = (k * Math.PI) / 4, ring = map.heightAt(x + cos(ang) * POINT_RADIUS * 0.8, z + sin(ang) * POINT_RADIUS * 0.8);
      if (!(ring > 0.5)) { if (++wet > 2) return Infinity; continue; }                              // (a little water at the edge is fine, a point in the sea is not)
      rough = Math.max(rough, Math.abs(ring - h));
    }
    return rough + wet * 15;
  };
  const pick = (target) => {
    let best = null, bestScore = Infinity;
    if (map.heightAt) {
      for (let dx = -SEARCH; dx <= SEARCH; dx += STEP) for (let dz = -SEARCH; dz <= SEARCH; dz += STEP) {
        const x = target[0] + dx, z = target[1] + dz;
        if (!clear(x, z)) continue;
        const rough = trouble(x, z);
        if (rough === Infinity) continue;
        const score = Math.hypot(dx, dz) + 4 * unfair(x, z) + 3 * rough;
        if (score < bestScore) { bestScore = score; best = [x, z]; }
      }
    }
    if (!best) best = s.filter((p) => clear(p[0], p[1])).sort((p, q) => Math.hypot(p[0] - target[0], p[1] - target[1]) - Math.hypot(q[0] - target[0], q[1] - target[1]))[0] ?? target;
    taken.push(best);
    return best;
  };
  const centre = pick(targets[1]), left = pick(targets[0]), right = pick(targets[2]);
  return [left, centre, right].map((p, i) => ({ x: p[0], z: p[1], r: POINT_RADIUS, control: 0, owner: 0, name: String.fromCharCode(65 + i) }));
}

/**
 * One tick of the control points: a point with only one team on it moves toward that team (a second actor helps, up to three), a point with equal numbers of both is held where it is (more of one team moves it slowly their way), and a point the
 * team has taken all the way scores for it every second. The first team is 1, the second 2.
 * @param {any} match @param {any[]} events
 */
export function stepPoints(match, events) {
  const { world } = match, tps = match.ticksPerSecond;
  for (const [i, p] of (world.points ?? []).entries()) {
    let a = 0, b = 0;
    for (const m of match.rules.actors(world)) {
      if (m.dead || Math.hypot(m.x - p.x, m.z - p.z) > p.r) continue;
      if (m.team === 1) a++; else if (m.team === 2) b++;
    }
    if (a !== b) {                                                                          // alone on it, or with more actors than the other team (then it goes slower, the fight is not over)
      const n = Math.min(3, Math.abs(a - b)), rate = (1 + 0.5 * (n - 1)) * (a > 0 && b > 0 ? CONTESTED : 1) / (CAPTURE_SECONDS * tps);
      p.control = Math.max(-1, Math.min(1, p.control + (a > b ? rate : -rate)));
      const was = p.owner;
      if (p.control >= 1) p.owner = 1; else if (p.control <= -1) p.owner = 2;
      else if ((was === 1 && p.control <= 0) || (was === 2 && p.control >= 0)) p.owner = 0;
      if (p.owner !== was) events.push(p.owner ? { type: 'capture', point: i, team: p.owner, name: p.name } : { type: 'neutral', point: i, team: was, name: p.name });
    }
    if (p.owner && world.tick % tps === 0) match.teamPoints.set(p.owner, (match.teamPoints.get(p.owner) ?? 0) + 1);
  }
}
