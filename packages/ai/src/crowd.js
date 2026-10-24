// A crowd of agents walking over a navigation mesh. Each follows its own path to its own goal; on the way it looks at the agents near it and chooses, from a handful of
// velocities, the one that stays closest to where it wants to go without running into anyone in the next couple of seconds (velocity-obstacle sampling, the method the Detour
// crowd uses), then slides along the walls of the mesh. Agents whose path is cut by a new obstacle find another way by themselves.
//
// Deterministic: only + - * / and sqrt, a fixed order of agents and of the sampled velocities, no random numbers; the same crowd stepped the same way gives the same positions.

const cross2 = (ax, az, bx, bz) => ax * bz - az * bx;
/** Length of a vector of two or three parts (Math.hypot is not guaranteed to give the same bits everywhere; a square root is). */
function hyp(a, b, c = 0) { return Math.sqrt(a * a + b * b + c * c); }

// The velocities tried, as fractions of the top speed: nothing, then three rings of twelve directions (turned by exact steps of 30 degrees, no trigonometry).
const PATTERN = (() => {
  const out = [[0, 0]];
  const c = 0.8660254037844386, s = 0.5;
  for (const ring of [1 / 3, 2 / 3, 1]) {
    let x = 1, z = 0;
    for (let k = 0; k < 12; k++) { out.push([x * ring, z * ring]); const nx = x * c - z * s; z = x * s + z * c; x = nx; }
  }
  return out;
})();

/**
 * @typedef {object} CrowdAgent
 * @property {number} id
 * @property {number} x @property {number} y @property {number} z Position on the mesh.
 * @property {number} vx @property {number} vz Velocity (metres per second).
 * @property {number} radius @property {number} maxSpeed @property {number} maxAccel
 * @property {'idle' | 'moving' | 'arrived' | 'blocked' | 'lost'} state `idle`: no goal; `moving`: on its way; `arrived`: at its goal (or as near as the crowd let it get); `blocked`: no route to the goal
 *   (it went as near as it could); `lost`: pushed off the mesh with nowhere to stand.
 * @property {number[]} path The corners it is following (x, y, z, ...).
 * @property {any} userData Anything you want to keep with the agent.
 */

/**
 * Agents walking a `NavMesh`.
 */
export class Crowd {
  /**
   * @param {import('./navmesh.js').NavMesh} mesh
   * @param {object} [o]
   * @param {number} [o.horizon] Seconds ahead agents look for collisions (2.5).
   * @param {number} [o.neighborDistance] How far away other agents are taken into account (6 metres).
   * @param {number} [o.arriveDistance] How close to its goal an agent has to get (0.25 metres).
   * @param {number} [o.repathDelay] Least seconds between an agent's searches for a new path (0.5).
   */
  constructor(mesh, { horizon = 2.5, neighborDistance = 6, arriveDistance = 0.25, repathDelay = 0.5 } = {}) {
    this.mesh = mesh; this.horizon = horizon; this.neighborDistance = neighborDistance; this.arriveDistance = arriveDistance; this.repathDelay = repathDelay;
    /** @type {CrowdAgent[]} */
    this.agents = [];
    this.time = 0;
    this.nextId = 1;
    /** Called with an agent when it reaches its goal. */
    this.onArrive = null;
    this.grid = new Map();
  }

  /**
   * Put an agent on the mesh (at the nearest place to the position given).
   * @param {{x: number, y?: number, z: number, radius?: number, maxSpeed?: number, maxAccel?: number, userData?: any}} o
   * @returns {CrowdAgent}
   */
  addAgent({ x, y = 0, z, radius = 0.4, maxSpeed = 3.5, maxAccel = 8, userData = null }) {
    const spot = this.mesh.nearest(x, y, z, 3);
    if (!spot) throw new Error(`there is no place on the navigation mesh near (${x}, ${y}, ${z}) to put an agent`);
    const a = {
      id: this.nextId++, x: spot.x, y: spot.y, z: spot.z, vx: 0, vz: 0, radius, maxSpeed, maxAccel, userData, state: 'idle', poly: spot.poly,
      target: null, path: [], pathIndex: 0, pathVersion: -1, nextRepath: 0, partial: false, stuck: 0, dvx: 0, dvz: 0, nvx: 0, nvz: 0,
    };
    this.agents.push(a);
    return a;
  }

  removeAgent(agent) {
    const i = this.agents.indexOf(agent);
    if (i >= 0) this.agents.splice(i, 1);
  }

  /** Send an agent to a place; it finds its own way, and finds another if the way is closed on the road. */
  moveTo(agent, x, y, z) {
    agent.target = { x, y, z };
    agent.state = 'moving';
    agent.pathVersion = -1; agent.nextRepath = 0; agent.stuck = 0;
  }

  /** Stop an agent where it is. */
  stop(agent) {
    agent.target = null; agent.path = []; agent.state = 'idle';
  }

  #relocate(a) {
    const spot = this.mesh.nearest(a.x, a.y, a.z, 4);
    if (!spot) { a.state = 'lost'; a.vx = a.vz = 0; return false; }
    a.x = spot.x; a.y = spot.y; a.z = spot.z; a.poly = spot.poly;
    if (a.state === 'lost') a.state = a.target ? 'moving' : 'idle';
    return true;
  }

  #repath(a) {
    const r = this.mesh.findPath({ x: a.x, y: a.y, z: a.z }, a.target, { radius: a.radius, partial: true });
    a.pathVersion = this.mesh.version;
    a.nextRepath = this.time + this.repathDelay;
    a.partial = r.partial;
    if (r.points.length >= 6) { a.path = r.points; a.pathIndex = 1; a.state = r.found ? 'moving' : 'blocked'; }
    else { a.path = []; a.state = r.found ? 'arrived' : 'blocked'; }
  }

  /** Advance every agent by `dt` seconds (call it with a fixed step, like the rest of the simulation). */
  update(dt) {
    const agents = this.agents, mesh = this.mesh;
    this.time += dt;
    // 1. where does each want to go
    for (const a of agents) {
      a.dvx = a.dvz = 0;
      if (a.state === 'lost' && !this.#relocate(a)) continue;
      if (mesh.blocked[a.poly] > 0 || a.poly < 0) { if (!this.#relocate(a)) continue; }
      if (!a.target) continue;
      if ((a.pathVersion !== mesh.version || a.path.length === 0) && this.time >= a.nextRepath) this.#repath(a);
      if (a.path.length < 6 || (a.state !== 'moving' && a.state !== 'blocked')) continue;
      const n = a.path.length / 3;
      // the next corner is reached when the agent is at it, or when it can walk straight on to the one after (it has come round the corner another way)
      while (a.pathIndex < n - 1 && (hyp(a.path[a.pathIndex * 3] - a.x, a.path[a.pathIndex * 3 + 2] - a.z) < 0.15
        || mesh.canWalk(a.x, a.y, a.z, a.path[a.pathIndex * 3 + 3], a.path[a.pathIndex * 3 + 5], a.radius))) a.pathIndex++;
      const tx = a.path[a.pathIndex * 3], tz = a.path[a.pathIndex * 3 + 2], dx = tx - a.x, dz = tz - a.z, dist = hyp(dx, dz);
      const last = a.pathIndex === n - 1;
      if (dist < 1e-6) continue;
      const slow = last ? Math.min(1, dist / Math.max(0.5, a.maxSpeed * 0.5)) : 1;           // ease in to the last stop
      const speed = a.maxSpeed * Math.max(slow, 0.15);
      a.dvx = dx / dist * speed; a.dvz = dz / dist * speed;
    }
    // 2. choose a velocity that avoids the others
    this.#fillGrid();
    for (const a of agents) {
      if (a.state === 'lost') { a.nvx = a.nvz = 0; continue; }
      const neighbors = this.#neighbors(a);
      let vx = a.dvx, vz = a.dvz;
      if (neighbors.length > 0 && (a.dvx !== 0 || a.dvz !== 0 || this.#nearAny(a, neighbors))) [vx, vz] = this.#avoid(a, neighbors);
      // limited acceleration
      const ax = vx - a.vx, az = vz - a.vz, al = hyp(ax, az), maxDv = a.maxAccel * dt;
      if (al > maxDv) { vx = a.vx + ax / al * maxDv; vz = a.vz + az / al * maxDv; }
      a.nvx = vx; a.nvz = vz;
    }
    // 3. move, and keep to the mesh
    for (const a of agents) {
      if (a.state === 'lost') continue;
      const r = mesh.move(a.poly, a.x, a.z, a.x + a.nvx * dt, a.z + a.nvz * dt);
      a.vx = (r.x - a.x) / dt; a.vz = (r.z - a.z) / dt;
      if (hyp(a.vx, a.vz) > hyp(a.nvx, a.nvz) + 1e-9) { a.vx = a.nvx; a.vz = a.nvz; }
      a.x = r.x; a.y = r.y; a.z = r.z; a.poly = r.poly;
    }
    // 4. no two agents inside each other
    this.#fillGrid();
    for (let pass = 0; pass < 2; pass++) {
      for (const a of agents) {
        if (a.state === 'lost') continue;
        for (const b of this.#neighbors(a, a.radius * 4 + 1)) {
          if (b.id < a.id) continue;
          const dx = b.x - a.x, dz = b.z - a.z, d = hyp(dx, dz), min = a.radius + b.radius;
          if (d >= min) continue;
          const nx = d > 1e-9 ? dx / d : 1, nz = d > 1e-9 ? dz / d : 0, push = (min - d) * 0.5 * 0.8;
          const ra = mesh.move(a.poly, a.x, a.z, a.x - nx * push, a.z - nz * push); a.x = ra.x; a.y = ra.y; a.z = ra.z; a.poly = ra.poly;
          const rb = mesh.move(b.poly, b.x, b.z, b.x + nx * push, b.z + nz * push); b.x = rb.x; b.y = rb.y; b.z = rb.z; b.poly = rb.poly;
        }
      }
    }
    // 5. who has arrived
    for (const a of agents) {
      if (!a.target || a.state === 'lost' || a.state === 'idle' || a.state === 'arrived') continue;
      const dist = hyp(a.target.x - a.x, a.target.z - a.z);
      const slowed = hyp(a.vx, a.vz) < a.maxSpeed * 0.1;
      a.stuck = slowed ? a.stuck + dt : 0;
      const atGoal = dist < this.arriveDistance + (a.partial ? 0 : 0);
      let crowded = false;                                                              // the spot is taken (others are standing there): close enough
      if (a.stuck > 0.75 && dist < a.radius * 12) {
        let waiting = 0;
        for (const b of this.agents) if (b !== a && b.state === 'arrived' && hyp(b.x - a.target.x, b.z - a.target.z) < dist + a.radius * 2) waiting++;
        crowded = dist < a.radius * (2 + 2 * Math.sqrt(waiting));
      }
      const end = a.path.length >= 6 && a.pathIndex === a.path.length / 3 - 1 && hyp(a.path[a.path.length - 3] - a.x, a.path[a.path.length - 1] - a.z) < this.arriveDistance;
      if (atGoal || crowded || (end && a.state === 'moving')) { a.state = 'arrived'; this.onArrive?.(a); }
      
    }
  }

  #cellOf(v) { return Math.floor(v / this.neighborDistance); }

  #fillGrid() {
    this.grid.clear();
    for (const a of this.agents) {
      const key = this.#cellOf(a.x) * 65536 + this.#cellOf(a.z);
      const list = this.grid.get(key);
      if (list) list.push(a); else this.grid.set(key, [a]);
    }
  }

  /** The agents near `a`, nearest first (at most 8), not including `a`. */
  #neighbors(a, range = this.neighborDistance) {
    const found = [], cx = this.#cellOf(a.x), cz = this.#cellOf(a.z), r2 = range * range;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const list = this.grid.get((cx + dx) * 65536 + (cz + dz));
      if (!list) continue;
      for (const b of list) {
        if (b === a || b.state === 'lost') continue;
        const d2 = (b.x - a.x) * (b.x - a.x) + (b.z - a.z) * (b.z - a.z);
        if (d2 <= r2) found.push([d2, b]);
      }
    }
    found.sort((p, q) => p[0] - q[0] || p[1].id - q[1].id);
    if (found.length > 8) found.length = 8;
    return found.map((f) => f[1]);
  }

  #nearAny(a, neighbors) {
    for (const b of neighbors) if (hyp(b.x - a.x, b.z - a.z) < a.radius + b.radius + 0.5) return true;
    return false;
  }

  /** From the velocities in the pattern (and the wanted one), the one with the lowest cost: close to the wanted velocity, to the current one, and not about to collide. */
  #avoid(a, neighbors) {
    const horizon = this.horizon, speed = a.maxSpeed, pushing = a.stuck > 1 && a.state === 'moving';
    const dl = hyp(a.dvx, a.dvz), dirx = dl > 0 ? a.dvx / dl : 0, dirz = dl > 0 ? a.dvz / dl : 0;
    let bestX = a.dvx, bestZ = a.dvz, bestCost = Infinity, anyFree = false;
    const candidate = (vx, vz) => {
      let tmin = horizon;
      for (const b of neighbors) {
        if (pushing && b.id > a.id) continue;                                            // an agent that has been held up for a while does not wait for newer ones
        const px = b.x - a.x, pz = b.z - a.z, R = a.radius + b.radius + 0.05;
        const wx = 2 * vx - a.vx - b.vx, wz = 2 * vz - a.vz - b.vz;                       // reciprocal: each takes half of the dodging
        const c = px * px + pz * pz - R * R, bq = px * wx + pz * wz, aq = wx * wx + wz * wz;
        let t = Infinity;
        if (c <= 0) { if (bq > 0) t = 0; }                                                // already overlapping: bad only if still closing
        else if (aq > 1e-12 && bq > 0) { const disc = bq * bq - aq * c; if (disc >= 0) t = (bq - Math.sqrt(disc)) / aq; }
        if (t < tmin) tmin = t;
      }
      if (tmin > 0.2) anyFree = true;
      const toDes = hyp(vx - a.dvx, vz - a.dvz), toCur = hyp(vx - a.vx, vz - a.vz);
      const side = Math.max(0, cross2(dirx, dirz, vx, vz)) / speed;                         // prefer to pass on the right, so two head-on agents choose opposite sides
      const cost = 2 * toDes / speed + 0.75 * toCur / speed + 0.4 * side + 2.5 / (0.1 + tmin / horizon);
      if (cost < bestCost) { bestCost = cost; bestX = vx; bestZ = vz; }
    };
    candidate(a.dvx, a.dvz);
    for (const [fx, fz] of PATTERN) candidate(fx * speed, fz * speed);
    if (!anyFree) return [a.dvx * 0.3, a.dvz * 0.3];                    // hemmed in on every side: creep toward the goal and let the pushing apart sort it out
    return [bestX, bestZ];
  }
}
