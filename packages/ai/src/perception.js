// What an agent can see and hear, and what it remembers. Sight is a cone plus a line-of-sight test you provide (a ray cast against the
// level); hearing is distance against how loud a sound was; memory keeps the last place something was seen, and forgets. Only + - * / and sqrt.

/**
 * Can an agent at `eye` looking along (fx, fz) see a point? A cone (`cosFov`: the cosine of half the field of view, from `cos` in
 * @engine/math), a range, and `blocked(x0, y0, z0, x1, y1, z1)` true when something solid is in the way.
 * @param {{x: number, y: number, z: number}} eye
 * @param {number} fx @param {number} fz Unit facing direction on the ground plane.
 * @param {{x: number, y: number, z: number}} target
 * @param {{range?: number, cosFov?: number, blocked?: (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) => boolean}} [o]
 */
export function canSee(eye, fx, fz, target, { range = 40, cosFov = 0.5, blocked = null } = {}) {
  const dx = target.x - eye.x, dz = target.z - eye.z, dy = target.y - eye.y, d2 = dx * dx + dz * dz + dy * dy;
  if (d2 > range * range) return false;
  const d = Math.sqrt(dx * dx + dz * dz);
  if (d > 1 && (dx * fx + dz * fz) / d < cosFov) return false; // outside the cone (anything within a metre is noticed whichever way you face)
  return !blocked || !blocked(eye.x, eye.y, eye.z, target.x, target.y, target.z);
}

/** Did a sound at (x, y, z) of this loudness (metres it carries in the open) reach the listener? `muffled(…)` may say a wall is between. */
export function canHear(listener, sound, { sensitivity = 1, muffled = null } = {}) {
  const dx = sound.x - listener.x, dy = (sound.y ?? listener.y) - listener.y, dz = sound.z - listener.z;
  let reach = sound.loudness * sensitivity;
  if (muffled && muffled(listener.x, listener.y, listener.z, sound.x, sound.y ?? listener.y, sound.z)) reach *= 0.5;
  return dx * dx + dy * dy + dz * dz <= reach * reach;
}

/** What an agent remembers about things it has noticed: where it last saw each, how long ago, and how sure it is. */
export class Memory {
  /** @param {number} [forgetAfter] Seconds until a memory is dropped (10). */
  constructor(forgetAfter = 10) { this.forgetAfter = forgetAfter; /** @type {Map<any, {x: number, y: number, z: number, vx: number, vz: number, age: number, seen: boolean}>} */ this.items = new Map(); }
  /** Note that `id` was seen at a place now (with its velocity, if known). */
  see(id, x, y, z, vx = 0, vz = 0) { this.items.set(id, { x, y, z, vx, vz, age: 0, seen: true }); }
  /** Note a sound or a hint: a place worth checking, less certain than a sighting. */
  suspect(id, x, y, z) { const m = this.items.get(id); if (!m || !m.seen || m.age > 1) this.items.set(id, { x, y, z, vx: 0, vz: 0, age: 0, seen: false }); }
  get(id) { return this.items.get(id) ?? null; }
  forget(id) { this.items.delete(id); }
  /** Age everything; things not seen this tick lose their "currently visible" flag. Call once per tick after the `see` calls. */
  update(dt) {
    for (const [id, m] of this.items) {
      m.age += dt;
      if (m.age > this.forgetAfter) this.items.delete(id);
    }
  }
  /** Where something probably is now: the last known place, carried forward by its last known velocity for a moment. */
  guess(id, maxExtrapolate = 1.5) {
    const m = this.items.get(id);
    if (!m) return null;
    const t = Math.min(m.age, maxExtrapolate);
    return { x: m.x + m.vx * t, y: m.y, z: m.z + m.vz * t };
  }
  /** The memories as plain data. */
  save() { return [...this.items].map(([id, m]) => [id, { ...m }]); }
  load(data) { this.items = new Map(data.map(([id, m]) => [id, { ...m }])); return this; }
  /** The remembered thing seen most recently, or null. */
  freshest() { let best = null, bestId = null; for (const [id, m] of this.items) if (!best || m.age < best.age) { best = m; bestId = id; } return best ? { id: bestId, ...best } : null; }
}
