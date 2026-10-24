// Drawing the playground: the level's solid boxes, the ramp, and every rigid body, as instanced meshes. The page and the scene editor share it.
import { mat4 } from '../../packages/math/src/index.js';
import { createBox, createSphere, createCapsule } from '../../packages/render/src/index.js';

export function createDrawer() {
  const unitBox = createBox(1, 1, 1), unitSphere = createSphere(0.5, 20, 12);
  const capsules = new Map();
  const capsuleMesh = (r, hh) => { const k = `${r}|${hh}`; if (!capsules.has(k)) capsules.set(k, createCapsule(r, 2 * hh + 2 * r, 16, 6)); return capsules.get(k); };
  const model = new Float64Array(16), q = [0, 0, 0, 1];

  /** The ground, the walls and the ramp. */
  function drawLevel(list, statics) {
    for (const s of statics) list.addTransform(unitBox, s.x, s.y, s.z, null, s.hx * 2, s.hy * 2, s.hz * 2, s.color[0], s.color[1], s.color[2]);
    // the ramp is a triangle mesh: draw it as a thin tilted slab
    mat4.compose(model, 18, 1.2, 0, [0, 0, 0.14523, 0.9894], 8.35, 0.12, 12); // tilted by atan(2.4 / 8)
    list.add(unitBox, model, 0.6, 0.55, 0.45);
  }
  /** Every rigid body (resting ones a little darker). */
  function drawBodies(list, world) {
    for (const b of world.bodies) {
      if (b.sensor) continue;
      const s = b.shape, c = b.userData?.color ?? [0.6, 0.6, 0.7], k = b.sleeping ? 0.62 : 1;
      q[0] = b.qx; q[1] = b.qy; q[2] = b.qz; q[3] = b.qw;
      if (s.type === 'box') mat4.compose(model, b.x, b.y, b.z, q, s.hx * 2, s.hy * 2, s.hz * 2);
      else if (s.type === 'sphere') mat4.compose(model, b.x, b.y, b.z, q, s.radius * 2, s.radius * 2, s.radius * 2);
      else mat4.compose(model, b.x, b.y, b.z, q, 1, 1, 1);
      list.add(s.type === 'box' ? unitBox : s.type === 'sphere' ? unitSphere : capsuleMesh(s.radius, s.halfHeight), model, c[0] * k, c[1] * k, c[2] * k);
    }
  }
  return { unitBox, unitSphere, capsuleMesh, drawLevel, drawBodies, drawAll(list, play) { drawLevel(list, play.statics); drawBodies(list, play.world); } };
}
