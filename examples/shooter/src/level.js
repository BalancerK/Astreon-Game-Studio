// The arena: one description builds BOTH the collision world (triangles) and the list of boxes the page draws. Nothing here touches a screen, so
// the rules and their tests can use it in Node. Units are metres, +y is up, the ground top is y = 0.
import { TriWorld } from '../../../packages/physics/src/index.js';

const WALL = [0.42, 0.45, 0.52], COVER = [0.55, 0.5, 0.4], CRATE = [0.62, 0.45, 0.25], PILLAR = [0.4, 0.48, 0.6];

/**
 * @typedef {{x: number, y: number, z: number}} Point
 * @returns {{
 *   world: TriWorld,
 *   parts: (Point & {sx: number, sy: number, sz: number, color: number[]})[],
 *   spawn: Point & {yaw: number},
 *   enemySpawns: {x: number, z: number}[],
 *   pickupSpots: {x: number, z: number}[],
 *   size: number,
 *   lights: (Point & {color: number[], radius: number})[],
 * }}
 */
export function buildArena() {
  const world = new TriWorld({ cellSize: 4 });
  const parts = [];
  /** A solid box, given by its centre and half sizes: it blocks movement and it is drawn. */
  const box = (cx, cy, cz, hx, hy, hz, color) => {
    world.addBox(cx, cy, cz, hx, hy, hz);
    parts.push({ x: cx, y: cy, z: cz, sx: hx * 2, sy: hy * 2, sz: hz * 2, color });
  };
  const S = 26;                                                       // half the size of the arena
  box(0, -1, 0, S + 4, 1, S + 4, [0.3, 0.33, 0.32]);                  // floor
  box(0, 2.5, -S, S, 2.5, 0.5, WALL); box(0, 2.5, S, S, 2.5, 0.5, WALL);   // four walls, 5 m high
  box(-S, 2.5, 0, 0.5, 2.5, S, WALL); box(S, 2.5, 0, 0.5, 2.5, S, WALL);
  // a ring of pillars, low walls to hide behind, and crates you can stand on
  for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2 + Math.PI / 8; box(Math.cos(a) * 14, 2, Math.sin(a) * 14, 0.9, 2, 0.9, PILLAR); }
  box(0, 0.6, -7, 4, 0.6, 0.35, COVER); box(0, 0.6, 7, 4, 0.6, 0.35, COVER);
  box(-7, 0.6, 0, 0.35, 0.6, 4, COVER); box(7, 0.6, 0, 0.35, 0.6, 4, COVER);
  box(-19, 0.5, -10, 1.2, 0.5, 1.2, CRATE); box(-19, 1.5, -10, 0.7, 0.5, 0.7, CRATE);
  box(19, 0.5, 10, 1.2, 0.5, 1.2, CRATE); box(19, 1.5, 10, 0.7, 0.5, 0.7, CRATE);
  box(17, 0.5, -17, 1.2, 0.5, 1.2, CRATE); box(-17, 0.5, 17, 1.2, 0.5, 1.2, CRATE);
  for (let i = 0; i < 4; i++) box(-3 + i * 0.7, 0.2 + i * 0.2, 21, 0.35, 0.2 + i * 0.2, 1.5, PILLAR);   // a few steps
  box(0.7, 1, 24, 4, 1, 1.5, PILLAR);                                 // and the platform they lead to
  world.build();
  return {
    world, parts, size: S - 0.5,
    spawn: { x: 0, y: 1, z: 0, yaw: 0 },
    // where enemies come in: the far edges and corners
    enemySpawns: [[-22, -22], [22, -22], [-22, 22], [22, 22], [0, -23], [-23, 0], [23, 0]].map(([x, z]) => ({ x, z })),
    pickupSpots: [[-10, -10], [10, -10], [-10, 10], [10, 10], [0, -3], [0, 3]].map(([x, z]) => ({ x, z })),
    lights: [
      { x: -14, y: 4, z: -14, color: [1, 0.7, 0.4], radius: 24 },
      { x: 14, y: 4, z: 14, color: [0.5, 0.7, 1], radius: 24 },
      { x: 0, y: 4, z: 0, color: [1, 1, 1], radius: 18 },
    ],
  };
}
