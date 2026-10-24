// The arena level: one description builds the collision world (triangles) and the list of things to draw. The server and
// every client build it with this same function, so they agree on the geometry exactly. Deterministic: plain arithmetic.
import { TriWorld } from '../../../packages/physics/src/index.js';

/**
 * @typedef {{kind: 'box', x: number, y: number, z: number, hx: number, hy: number, hz: number, color: number[]} | {kind: 'quad', v: number[], color: number[]}} LevelPart
 * @returns {{world: TriWorld, parts: LevelPart[], spawns: number[][]}}
 */
export function buildArenaLevel() {
  const world = new TriWorld({ cellSize: 6 });
  const parts = [];
  const box = (x, y, z, hx, hy, hz, color) => { world.addBox(x, y, z, hx, hy, hz); parts.push({ kind: 'box', x, y, z, hx, hy, hz, color }); };
  const quad = (v, color) => { world.addQuad(...v); parts.push({ kind: 'quad', v, color }); };

  box(0, -1, 0, 60, 1, 60, [0.42, 0.5, 0.4]);                                       // ground, top at y = 0, 120 m square
  for (const [x, z, hx, hz] of [[-50, 0, 0.5, 50], [50, 0, 0.5, 50], [0, -50, 50, 0.5], [0, 50, 50, 0.5]]) box(x, 4, z, hx, 4, hz, [0.46, 0.48, 0.55]); // outer walls
  // a central tower (top at y = 6) with a walkable ramp (6 m up over 12 m, 27 degrees) on its north and south sides
  box(0, 3, 0, 10, 3, 10, [0.58, 0.58, 0.66]);
  quad([-4, 0, 22, 4, 0, 22, 4, 6, 10, -4, 6, 10], [0.72, 0.6, 0.42]);
  quad([-4, 0, -22, 4, 0, -22, 4, 6, -10, -4, 6, -10], [0.72, 0.6, 0.42]);
  for (let i = 0; i < 8; i++) { // a ring of pillars
    const a = (i / 8) * 6.283185307179586;
    const x = Math.round(Math.cos(a) * 26 * 100) / 100, z = Math.round(Math.sin(a) * 26 * 100) / 100; // determinism-ok: level layout is built once from constants, identically on every machine
    box(x, 1.2, z, 1.2, 1.2, 1.2, [0.35 + (i % 4) * 0.1, 0.45, 0.8 - (i % 4) * 0.1]);
  }
  for (let i = 0; i < 6; i++) box(-36 + i * 14, 0.5, -34 + (i % 2) * 68, 2.5, 0.5, 0.6, [0.8, 0.7, 0.35]); // low walls: jump over or walk around
  for (const dir of [-1, 1]) { // two staircases (0.25 m steps) up to raised platforms in the west and east
    for (let i = 0; i < 10; i++) box(dir * (34 + i * 0.7 + 0.35), ((i + 1) * 0.25) / 2, 30, 0.35, ((i + 1) * 0.25) / 2, 2.5, [0.55 + i * 0.02, 0.55, 0.65]);
    box(dir * 43.5, 1.25, 30, 2.2, 1.25, 2.5, [0.5, 0.55, 0.75]);                                  // platform, top at y = 2.5
  }
  box(-30, 1.5, -30, 4, 1.5, 4, [0.62, 0.5, 0.35]);                                  // a platform to jump onto (top at y = 3)
  box(30, 0.9, -30, 4, 0.9, 4, [0.62, 0.5, 0.35]);                                   // and a lower one (top at y = 1.8)
  world.build();
  const spawns = [[-40, 3, -40], [40, 3, -40], [-40, 3, 40], [40, 3, 40], [0, 8, -38], [0, 8, 38], [-20, 3, 0], [20, 3, 0]];
  return { world, parts, spawns };
}
