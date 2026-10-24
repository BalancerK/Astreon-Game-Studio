// Character-vs-character collision. Bodies walk the level on their own (the shared movement step knows nothing of other
// players, so prediction stays exact); after every tick the server pushes overlapping players apart on the ground plane.
// The push is small per tick, so a crowd leans apart instead of jumping, and the client's reconciliation absorbs the
// difference as a normal correction. Bodies are pushed out of walls afterwards, so nobody is squeezed into geometry.
import { pushOutEllipsoid } from '../../../packages/physics/src/index.js';

/**
 * @param {Map<number, {x: number, y: number, z: number}>} bodies slot -> body
 * @param {import('../../../packages/physics/src/index.js').TriWorld} level
 * @param {{radius: number, halfHeight: number}} shape
 * @param {number} [maxPush] Most a body moves in one call, metres.
 * @returns {number} How many pairs were pushed apart.
 */
export function separateBodies(bodies, level, shape, maxPush = 0.08) {
  const slots = [...bodies.keys()].sort((a, b) => a - b); // fixed order, so the result does not depend on insertion history
  const minDist = shape.radius * 2, minDistSq = (minDist - 1e-4) * (minDist - 1e-4), // 0.1 mm of slack: pairs resting exactly in contact do not flicker
    reachY = shape.halfHeight * 2 - 0.1;
  const dx = new Map(), dz = new Map(); // accumulated push per slot
  let pairs = 0;
  for (let i = 0; i < slots.length; i++) {
    const a = bodies.get(slots[i]);
    for (let j = i + 1; j < slots.length; j++) {
      const b = bodies.get(slots[j]);
      const ox = b.x - a.x, oz = b.z - a.z;
      if (ox > minDist || ox < -minDist || oz > minDist || oz < -minDist) continue;
      const dy = b.y - a.y;
      if (dy > reachY || dy < -reachY) continue;
      const d2 = ox * ox + oz * oz;
      if (d2 >= minDistSq) continue;
      let nx, nz, d = Math.sqrt(d2);
      if (d < 1e-6) { nx = (slots[i] & 1) === 0 ? 1 : -1; nz = 0; d = 0; } else { nx = ox / d; nz = oz / d; }
      const half = (minDist - d) * 0.5; // each takes half of the overlap
      dx.set(slots[i], (dx.get(slots[i]) ?? 0) - nx * half); dz.set(slots[i], (dz.get(slots[i]) ?? 0) - nz * half);
      dx.set(slots[j], (dx.get(slots[j]) ?? 0) + nx * half); dz.set(slots[j], (dz.get(slots[j]) ?? 0) + nz * half);
      pairs++;
    }
  }
  for (const [slot, px] of dx) {
    const body = bodies.get(slot), pz = dz.get(slot);
    const len = Math.sqrt(px * px + pz * pz), k = len > maxPush ? maxPush / len : 1;
    body.x += px * k; body.z += pz * k;
    pushOutEllipsoid(level, body, shape.radius, shape.halfHeight, shape.radius);
  }
  return pairs;
}
