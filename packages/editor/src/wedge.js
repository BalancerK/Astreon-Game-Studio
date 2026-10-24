// A ramp, as a mesh: a box cut along its diagonal, one unit each way, low at the +z end and full height at the -z end (the same ramp the arcade kit's `ramp` draws
// and its `loadWorld3d` reads from a scene). Scaled by an entity's width, height and depth, it is that entity's ramp.
import { createMeshFromTriangles } from '../../render/src/index.js';

const A = [-0.5, -0.5, 0.5];
const B = [0.5, -0.5, 0.5];
const C = [0.5, 0.5, -0.5];
const D = [-0.5, 0.5, -0.5];
const E = [-0.5, -0.5, -0.5];
const F = [0.5, -0.5, -0.5];

/** The corners of the faces, each three or four, going round counter-clockwise as seen from outside. */
export const WEDGE_FACES = [[A, B, C, D], [F, E, D, C], [E, F, B, A], [E, A, D], [B, F, C]];

/** The ramp as a mesh for the 3D renderers (flat shaded). */
export function createWedge() {
  const triangles = [];
  for (const face of WEDGE_FACES) {
    for (let i = 1; i + 1 < face.length; i++) triangles.push(...face[0], ...face[i], ...face[i + 1]);
  }
  return createMeshFromTriangles(triangles, triangles.length / 9, 'wedge');
}
