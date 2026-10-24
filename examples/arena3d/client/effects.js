// The arena's visual effects, made with @engine/particles: muzzle flashes, tracer glows, bullet impacts and holes, hit bursts,
// jump and landing dust, and a soft halo around each lamp. Presentation only: nothing here touches the simulation.
import { ParticleSystem, effects } from '../../../packages/particles/src/index.js';
import { ParticleBatch } from '../../../packages/render/src/index.js';
import { surfaceNormal } from './surface.js';

/**
 * @param {object} o
 * @param {import('../shared/level.js').LevelPart[]} o.parts The level, to find the way surfaces face.
 * @param {{x: number, y: number, z: number, color: number[]}[]} o.lamps
 */
export function createArenaEffects({ parts, lamps }) {
  const system = new ParticleSystem({ capacity: 3000, floorY: 0, gravity: [0, -9.8, 0] });
  const batch = new ParticleBatch(512);
  const api = {
    system, batch, enabled: true,

    /**
     * A shot as everyone sees it. `own` is your own: its muzzle is your eye, so no flash there (it would fill the screen).
     * @param {{x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, hit: number}} s
     */
    shot(s, own = false) {
      if (!api.enabled) return;
      const dx = s.x1 - s.x0, dy = s.y1 - s.y0, dz = s.z1 - s.z0, len = Math.hypot(dx, dy, dz) || 1;
      const dir = [dx / len, dy / len, dz / len];
      if (!own) system.burst(effects.muzzleFlash, s.x0 + dir[0] * 0.5, s.y0 - 0.15 + dir[1] * 0.5, s.z0 + dir[2] * 0.5, { dir });
      // a faint glow along the bullet's path (for your own shot, starting a little way out so it does not smear across the view)
      const start = own ? Math.min(2.5, len) : 0;
      system.line(effects.tracerGlow, s.x0 + dir[0] * start, s.y0 - 0.15 + dir[1] * start, s.z0 + dir[2] * start, s.x1, s.y1, s.z1, 1.2);
      const away = [-dir[0], -dir[1], -dir[2]];
      if (s.hit >= 0) {
        system.burst(effects.hit, s.x1, s.y1, s.z1, { dir: away });
      } else {
        const n = surfaceNormal(parts, [s.x1, s.y1, s.z1], away);
        system.burst(effects.impact, s.x1 + n[0] * 0.03, s.y1 + n[1] * 0.03, s.z1 + n[2] * 0.03, { dir: n });
        system.burst(effects.bulletHole, s.x1, s.y1, s.z1, { dir: n });
      }
    },

    /** Dust at a character's feet: a jump, or a landing (harder falls kick up more). */
    jump(x, y, z) { if (api.enabled) system.burst(effects.dust, x, y + 0.05, z, { dir: [0, 1, 0], scale: 1 }); },
    land(x, y, z, fallSpeed) { if (api.enabled) system.burst(effects.landDust, x, y + 0.05, z, { scale: Math.min(1.6, 0.6 + fallSpeed / 12), amount: Math.min(1.5, 0.5 + fallSpeed / 10) }); },

    /** Advance the simulation and fill the batch the renderer draws. Call once per frame. */
    update(dt, camera) {
      batch.clear();
      if (!api.enabled) return;
      system.update(Math.min(dt, 0.05));
      system.writeTo(batch);
      for (const l of lamps) { // a soft halo around each lamp, if it is anywhere near the view
        const dx = l.x - camera.x, dy = l.y - camera.y, dz = l.z - camera.z, d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > 90 * 90 || !camera.sphereVisible(l.x, l.y, l.z, 2)) continue;
        batch.push(l.x, l.y, l.z, 0.9 + Math.sqrt(d2) * 0.01, l.color[0], l.color[1], l.color[2], (api.lampGlow ?? 0.3), 0, 0, 0, 0, 0, 1, 0, 0);
      }
    },
    lampGlow: 0.3,
  };
  return api;
}
