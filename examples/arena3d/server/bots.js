// The arena's bots: they walk the real level (a navigation grid built from the same triangles the physics uses), look for players with a
// field of view and line of sight, remember where they last saw one, chase, shoot back with some inaccuracy, retreat when hurt, and
// patrol when there is nothing to do. Built from @engine/ai: path finding, steering, behaviour trees and perception.
import { NavGrid, PathQuery, PathFollower, SteeringAgent, bt, BehaviorTree, SUCCESS, RUNNING, canSee, Memory } from '../../../packages/ai/src/index.js';
import { cos } from '../../../packages/math/src/index.js';

const navCache = new WeakMap();
/** The level's navigation grid, built once per level object (about 0.15 s). */
export function levelNav(level3) {
  let nav = navCache.get(level3);
  if (!nav) {
    nav = NavGrid.build(level3, { bounds: { minX: -60, minZ: -60, maxX: 60, maxZ: 60 }, cellSize: 0.5, agentRadius: 0.45, agentHeight: 1.8, stepHeight: 0.45, maxSlope: 40, maxDrop: 1.2, top: 20, bottom: -2 });
    navCache.set(level3, nav);
  }
  return nav;
}

const COS_FOV = cos(1.05); // about 120 degrees across
const SEE_EVERY = 6;        // look around ten times a second
const ray = { t: 0, index: -1, nx: 0, ny: 0, nz: 0 };

/**
 * @param {object} d
 * @param {import('../../../packages/physics/src/index.js').TriWorld} d.level3
 * @param {() => number} d.rand
 * @param {object} d.rules
 * @param {object} d.body BODY dimensions (radius, halfHeight, eye)
 * @param {() => {entity: number, slot: number}[]} d.targets Who the bots are hostile to (the players), alive or not.
 * @param {(slot: number) => {x: number, y: number, z: number, hp: number}} d.stateOf
 * @param {(shooter: {entity: number, slot: number}, tx: number, ty: number, tz: number) => void} d.shoot Fire at a point (the server judges the hit).
 * @param {{spawns: number[][]}} d.level
 */
export function createBots({ level3, level, rand, rules, body: BODY, targets, stateOf, shoot }) {
  const nav = levelNav(level3);
  const blocked = (x0, y0, z0, x1, y1, z1) => level3.raycast(x0, y0, z0, x1 - x0, y1 - y0, z1 - z0, 1, ray);

  // --- the shared behaviour tree: what a bot does, in priority order ---
  const tree = bt.selector(
    // 1. hurt and someone is after us: get away from them
    bt.guard((c) => c.bb.hp < 35 && c.agent.threat(), bt.action((c) => c.agent.retreat(c))),
    // 2. a player in sight: close in to a good range, keep facing them, shoot
    bt.reactiveSequence(bt.condition((c) => c.agent.visible), bt.action((c) => c.agent.engage(c))),
    // 3. one we remember: go to where we last saw them
    bt.reactiveSequence(bt.condition((c) => c.agent.memory.freshest() !== null), bt.action((c) => c.agent.investigate(c))),
    // 4. nothing going on: wander between places
    bt.action((c) => c.agent.patrol(c)),
  );

  class Bot {
    constructor(entity, slot, index) {
      this.entity = entity; this.slot = slot;
      this.steer = new SteeringAgent({ maxSpeed: 3.8 + rand() * 2.4, maxAccel: 30, radius: 0.45 });
      this.accuracy = 0.6 + rand() * 0.35;       // 1 is deadly
      this.reaction = 0.25 + rand() * 0.45;      // seconds from first sight to first shot
      this.memory = new Memory(12);
      this.follower = new PathFollower([], { reach: 0.5, slowRadius: 1.2, stuckTime: 1.0 });
      this.query = null; this.pathVersion = -1; this.goal = null;
      this.visible = null; this.seenFor = 0; this.cool = 0; this.wait = 0; this.age = index;
      this.out = { x: 0, z: 0 }; this.tmp = { x: 0, z: 0 }; this.face = { x: 0, z: -1 };
      this.wishX = 0; this.wishZ = 0; this.yaw = 0; this.pitch = 0; this.jump = false;
      this.hp = 100; this.lastX = 0; this.lastZ = 0;
      this.tree = new BehaviorTree(tree, { agent: this, rng: rand, bb: this });
      this.body = null;
    }
    threat() { const m = this.memory.freshest(); return m !== null && m.age < 6; }

    /** Set the path goal (a new search starts when the goal moved far or the map changed). */
    goTo(x, y, z) {
      const g = this.goal;
      if (g && Math.abs(g.x - x) + Math.abs(g.z - z) < 1.5 && this.pathVersion === nav.version && (this.query || !this.follower.done)) return;
      this.goal = { x, y, z };
      this.query?.cancel();
      this.query = new PathQuery(nav, { x: this.body.x, y: this.body.y - BODY.halfHeight, z: this.body.z }, { x, y, z }, { maxExpansions: 6000 });
      this.pathVersion = nav.version;
    }
    pump() { // spend a little of the frame on a running search, then start following what it found
      const q = this.query;
      if (!q) return;
      if (q.step(250) === 'running') return;
      this.query = null;
      if (q.path.length > 0) this.follower.set(q.path); else { this.follower.done = true; this.goal = null; }
    }
    /** Walk along the current path (or hold still), avoiding bumping into other bots. */
    move(c, speedScale = 1) {
      this.pump();
      const s = this.steer, o = this.out;
      s.x = this.body.x; s.y = this.body.y; s.z = this.body.z;
      this.follower.desired(s, c.dt, o);
      if (this.follower.stuck && this.goal) { this.pathVersion = -1; const g = this.goal; this.goal = null; this.follower.stuck = false; this.goTo(g.x, g.y, g.z); }
      o.x *= speedScale; o.z *= speedScale;
      this.wishX = o.x; this.wishZ = o.z;
    }
    look(dx, dz) { const l = Math.sqrt(dx * dx + dz * dz); if (l > 1e-6) { this.face.x = dx / l; this.face.z = dz / l; this.yaw = Math.atan2(-dx, -dz); } } // determinism-ok: server-only, a bot's facing

    engage(c) {
      const t = this.visible, b = this.body;
      const dx = t.x - b.x, dz = t.z - b.z, d = Math.sqrt(dx * dx + dz * dz);
      this.look(dx, dz);
      this.pitch = Math.max(-1.2, Math.min(1.2, Math.atan2(t.y + 0.1 - (b.y + BODY.eye), d))); // determinism-ok: server-only aim
      // keep a fighting distance: close in when far, back off when too near, otherwise strafe a little
      if (d > 16) { this.goTo(t.x, t.y - BODY.halfHeight, t.z); this.move(c); } else {
        this.follower.done = true; this.query?.cancel(); this.query = null; this.goal = null;
        const side = ((this.age >> 6) & 1) ? 1 : -1, k = d < 7 ? -0.6 : 0;
        this.wishX = (-dz / (d || 1)) * side * this.steer.maxSpeed * 0.5 + (dx / (d || 1)) * k * this.steer.maxSpeed;
        this.wishZ = (dx / (d || 1)) * side * this.steer.maxSpeed * 0.5 + (dz / (d || 1)) * k * this.steer.maxSpeed;
      }
      if (this.seenFor >= this.reaction && this.cool <= 0 && d < rules.weapon.range * 0.5) {
        const miss = (1 - this.accuracy) * (0.4 + d * 0.06); // metres of error at the target
        shoot(this, t.x + (rand() - 0.5) * 2 * miss, t.y + (rand() - 0.5) * miss * 0.6, t.z + (rand() - 0.5) * 2 * miss);
        this.cool = rules.weapon.cooldownTicks / 60 * (1.4 + rand());
      }
      return RUNNING;
    }

    investigate(c) {
      const m = this.memory.freshest(), g = this.memory.guess(m.id);
      const d = Math.hypot(g.x - this.body.x, g.z - this.body.z);
      if (d < 2.5) { this.memory.forget(m.id); this.follower.done = true; this.wait = 0.8 + rand(); return SUCCESS; } // got there and nothing: give up on it
      this.goTo(g.x, g.y, g.z); this.move(c);
      this.look(this.wishX, this.wishZ);
      return RUNNING;
    }

    retreat(c) {
      const m = this.memory.freshest(), tx = m.x, tz = m.z;
      if (!this.goal || this.follower.done) { // the spawn point farthest from the threat
        let best = level.spawns[0], bd = -1;
        for (const s of level.spawns) { const d = (s[0] - tx) * (s[0] - tx) + (s[2] - tz) * (s[2] - tz); if (d > bd) { bd = d; best = s; } }
        this.goTo(best[0], best[1] - 2.5, best[2]);
      }
      this.move(c, 1.2);
      this.look(this.wishX, this.wishZ);
      return RUNNING;
    }

    patrol(c) {
      if (this.wait > 0) { this.wait -= c.dt; this.wishX = this.wishZ = 0; return RUNNING; }
      if (!this.goal || (this.follower.done && !this.query)) {
        if (this.goal) { this.goal = null; this.wait = 0.5 + rand() * 2.5; return RUNNING; } // arrived: rest a moment
        const b = this.body;
        for (let tries = 0; tries < 6; tries++) { // somewhere to walk to: a random walkable spot not too close
          const n = (rand() * nav.count) | 0;
          if (!nav.walk[n] || Math.abs(nav.x[n] - b.x) + Math.abs(nav.z[n] - b.z) < 12) continue;
          this.goTo(nav.x[n], nav.y[n], nav.z[n]);
          break;
        }
      }
      this.move(c, 0.7);
      this.look(this.wishX, this.wishZ);
      return RUNNING;
    }

    /** One tick: look around (now and then), think, and leave the velocity to walk with in wishX / wishZ. */
    step(body, dt, hp, tick) {
      this.body = body; this.hp = hp; this.age++;
      this.cool -= dt;
      if (Math.abs(body.x - this.lastX) + Math.abs(body.z - this.lastZ) > 6) { this.follower.done = true; this.query?.cancel(); this.query = null; this.goal = null; this.memory.items.clear(); } // died and respawned
      this.lastX = body.x; this.lastZ = body.z;
      if ((tick + this.slot) % SEE_EVERY === 0) this.look3();
      this.memory.update(dt);
      this.wishX = 0; this.wishZ = 0;
      this.tree.ctx.dt = dt;
      this.tree.tick(dt);
      this.jump = false;
    }

    look3() {
      const b = this.body, eye = { x: b.x, y: b.y + BODY.eye, z: b.z };
      let best = null, bestD = Infinity;
      for (const t of targets()) {
        const s = stateOf(t.slot);
        if (s.hp <= 0) continue;
        const target = { x: s.x, y: s.y, z: s.z };
        if (canSee(eye, this.face.x, this.face.z, target, { range: 55, cosFov: COS_FOV, blocked })) {
          const d = (s.x - b.x) * (s.x - b.x) + (s.z - b.z) * (s.z - b.z);
          if (d < bestD) { bestD = d; best = target; best.slot = t.slot; }
          this.memory.see(t.slot, s.x, s.y, s.z, 0, 0);
        }
      }
      if (best) { this.seenFor += SEE_EVERY / 60; this.visible = best; } else { this.visible = null; this.seenFor = 0; }
    }
  }
  return { nav, Bot, tree };
}
