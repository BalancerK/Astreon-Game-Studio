// A small test level: one description builds BOTH the collision world (triangles) and what is drawn.
import { TriWorld } from '../../packages/physics/src/index.js';
import { createBox, createMeshFromTriangles } from '../../packages/render/src/index.js';

const rise = (deg) => 10 * Math.tan((deg * Math.PI) / 180);

/**
 * @returns {{world: TriWorld, parts: {mesh: any, x: number, y: number, z: number, sx: number, sy: number, sz: number, color: number[]}[], spawn: number[]}}
 */
export function buildLevel() {
  const world = new TriWorld({ cellSize: 4 });
  const parts = [];
  const box = createBox(1, 1, 1);
  const addBox = (cx, cy, cz, hx, hy, hz, color) => {
    world.addBox(cx, cy, cz, hx, hy, hz);
    parts.push({ mesh: box, x: cx, y: cy, z: cz, sx: hx * 2, sy: hy * 2, sz: hz * 2, color });
  };
  const addQuad = (v, color) => { // four corners a, b, c, d: collision and a flat-shaded mesh
    world.addQuad(...v);
    const tri = [...v.slice(0, 9), ...v.slice(0, 3), ...v.slice(6, 12)];
    parts.push({ mesh: createMeshFromTriangles(tri), x: 0, y: 0, z: 0, sx: 1, sy: 1, sz: 1, color });
  };

  addBox(0, -1, 0, 60, 1, 60, [0.42, 0.5, 0.4]);                                  // ground (top at y = 0)
  // a walkable 30 degree ramp (left) and a 60 degree wall-like ramp (right)
  addQuad([-14, 0, -6, -10, 0, -6, -10, rise(30), -16, -14, rise(30), -16], [0.75, 0.6, 0.4]);
  addBox(-12, rise(30) / 2, -21, 2, rise(30) / 2, 5, [0.62, 0.5, 0.35]);          // a landing at the top of the ramp
  addQuad([8, 0, -6, 12, 0, -6, 12, rise(60), -16, 8, rise(60), -16], [0.8, 0.35, 0.3]);
  // stairs: 8 steps of 0.25 m going toward +x
  for (let i = 0; i < 8; i++) addBox(4 + i * 0.7 + 0.35, ((i + 1) * 0.25) / 2, 12, 0.35, ((i + 1) * 0.25) / 2, 2.5, [0.55 + i * 0.03, 0.55, 0.65]);
  addBox(11.5, 1, 12, 2.1, 1, 2.5, [0.5, 0.55, 0.75]);                            // the platform on top (top at y = 2)
  addBox(0, 0.3, 8, 2, 0.3, 2, [0.85, 0.75, 0.3]);                                // a 0.6 m block: too high to step onto, jump instead
  addBox(-24, 3, 0, 0.5, 3, 24, [0.5, 0.52, 0.58]);                               // walls around the play area
  addBox(24, 3, 0, 0.5, 3, 24, [0.5, 0.52, 0.58]);
  addBox(0, 3, -24, 24, 3, 0.5, [0.5, 0.52, 0.58]);
  addBox(0, 3, 24, 24, 3, 0.5, [0.5, 0.52, 0.58]);
  for (let i = 0; i < 6; i++) addBox(-16 + i * 3, 1 + (i % 3) * 0.5, 14, 0.8, 1 + (i % 3) * 0.5, 0.8, [0.3 + i * 0.1, 0.4, 0.8 - i * 0.1]); // pillars
  world.build();
  return { world, parts, spawn: [0, 3, 0] };
}
