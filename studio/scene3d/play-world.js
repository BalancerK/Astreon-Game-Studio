// Walking around a 3D scene made in the studio: the scene's solid shapes become the ground and walls (a collision world of triangles), a person stands in it
// (the engine's character controller: gravity, jumping, steps and slopes), and the red markers become things to collect. A marker named start (or spawn, or
// player) says where the person begins and which way they face. No page is needed to build or step it, so it is tested in Node; play.js adds the keys, the
// mouse, the camera and the words on the screen.
import { SceneDocument } from '../../packages/scene/src/index.js';
import { SceneView, defaultDescribe } from '../../packages/editor/src/index.js';
import { TriWorld, CharacterController } from '../../packages/physics/src/index.js';
import { vec3 } from '../../packages/math/src/index.js';

const START = /^(start|spawn|player)/i;
const EYE = 0.7;                                   // how far above the middle of the body the eyes are

const at = (m, x, y, z) => [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];

/** The rows of a rounded shape as [height, ring radius]: a sphere, or a capsule (a sphere cut in two with a straight piece between). */
function roundRows(radius, straight, rings = 8) {
  const rows = [];
  for (let r = 0; r <= rings; r++) {
    const phi = (r / rings) * Math.PI;
    rows.push([Math.cos(phi) * radius + (r <= rings / 2 ? straight : -straight), Math.sin(phi) * radius]);
  }
  return rows;
}

/** Put one solid shape (a box, sphere or capsule at a place in the scene) into a collision world as triangles. */
export function addSolid(world, item) {
  const m = item.matrix;
  const s = item.shape;
  if (s.type === 'box') {
    const { hx, hy, hz } = s;
    const p = (x, y, z) => at(m, x, y, z);
    const quad = (a, b, c, d) => world.addQuad(...a, ...b, ...c, ...d);
    if (item.ramp) {                                                  // a ramp: low at the +z end, full height at the -z end
      quad(p(-hx, -hy, hz), p(hx, -hy, hz), p(hx, hy, -hz), p(-hx, hy, -hz));
      quad(p(hx, -hy, -hz), p(-hx, -hy, -hz), p(-hx, hy, -hz), p(hx, hy, -hz));
      quad(p(-hx, -hy, -hz), p(hx, -hy, -hz), p(hx, -hy, hz), p(-hx, -hy, hz));
      world.addTriangle(...p(-hx, -hy, -hz), ...p(-hx, -hy, hz), ...p(-hx, hy, -hz));
      world.addTriangle(...p(hx, -hy, hz), ...p(hx, -hy, -hz), ...p(hx, hy, -hz));
      return;
    }
    quad(p(-hx, -hy, hz), p(hx, -hy, hz), p(hx, hy, hz), p(-hx, hy, hz));
    quad(p(hx, -hy, -hz), p(-hx, -hy, -hz), p(-hx, hy, -hz), p(hx, hy, -hz));
    quad(p(hx, -hy, hz), p(hx, -hy, -hz), p(hx, hy, -hz), p(hx, hy, hz));
    quad(p(-hx, -hy, -hz), p(-hx, -hy, hz), p(-hx, hy, hz), p(-hx, hy, -hz));
    quad(p(-hx, hy, hz), p(hx, hy, hz), p(hx, hy, -hz), p(-hx, hy, -hz));
    quad(p(-hx, -hy, -hz), p(hx, -hy, -hz), p(hx, -hy, hz), p(-hx, -hy, hz));
    return;
  }
  const rows = roundRows(s.radius, s.type === 'capsule' ? s.halfHeight : 0);
  const segments = 12;
  const ring = (row, k) => { const a = (k / segments) * Math.PI * 2; return at(m, Math.cos(a) * row[1], row[0], Math.sin(a) * row[1]); };
  for (let r = 0; r + 1 < rows.length; r++) {
    for (let k = 0; k < segments; k++) {
      const a = ring(rows[r], k);
      const b = ring(rows[r], k + 1);
      const c = ring(rows[r + 1], k + 1);
      const d = ring(rows[r + 1], k);
      if (rows[r][1] > 1e-6) world.addTriangle(...a, ...b, ...d);          // (at the top and bottom the ring is a point: only one triangle meets there)
      if (rows[r + 1][1] > 1e-6) world.addTriangle(...b, ...c, ...d);
    }
  }
}

export class PlayWorld {
  /**
   * @param {any} scene a scene file as the editor holds it
   * @param {{library: any, describe?: (spec: any) => any}} o
   */
  constructor(scene, { library, describe = defaultDescribe }) {
    this.doc = new SceneDocument(scene, { library });
    this.view = new SceneView(this.doc, { library, describe });
    this.items = this.view.items().filter((i) => !this.doc.get(i.id)?.disabled);
    const isMarker = (i) => i.marker || this.doc.get(i.id)?.prefab === 'marker';                  // the red balls of the 3D scene panel
    this.solids = this.items.filter((i) => !isMarker(i));
    this.markers = this.items.filter(isMarker);
    const start = this.markers.find((i) => START.test(this.doc.get(i.id)?.name ?? ''));
    this.pickups = this.markers.filter((i) => i !== start);
    this.collected = new Set();
    this.world = new TriWorld({ cellSize: 4 });
    for (const item of this.solids) addSolid(this.world, item);
    this.hasGround = this.solids.length > 0;
    if (!this.hasGround) this.world.addBox(0, -0.5, 0, 100, 0.5, 100);                // an empty scene still has a floor to stand on
    this.world.build();
    this.player = new CharacterController({ x: 0, y: 0, z: 0 });
    let x = 0;
    let z = 0;
    this.yaw = 0;
    this.startPoint = { x: 0, z: 0 };
    if (start) { x = start.matrix[12]; z = start.matrix[14]; this.yaw = Math.atan2(start.matrix[8], start.matrix[10]); this.startPoint = { x, z }; }
    const hit = { t: 0, index: 0, nx: 0, ny: 0, nz: 0 };
    const fromY = start ? start.matrix[13] + 0.5 : 200;
    const ground = this.world.raycast(x, fromY, z, 0, -1, 0, 400, hit) ? fromY - hit.t : 0;
    this.player.x = x;
    this.player.z = z;
    this.player.y = ground + this.player.halfHeight + 0.05;
    this.pitch = 0;
    this.ticks = 0;
  }

  get total() { return this.pickups.length; }

  get count() { return this.collected.size; }

  get done() { return this.total > 0 && this.count === this.total; }

  /** Where the eyes are, and which way they look. */
  get eye() { return { x: this.player.x, y: this.player.y + EYE, z: this.player.z, yaw: this.yaw, pitch: this.pitch }; }

  /**
   * One tick.
   * @param {number} dt
   * @param {{forward: number, strafe: number, run: boolean, jump: boolean}} input forward and strafe run from -1 to 1
   */
  step(dt, input) {
    this.ticks++;
    const speed = input.run ? 8 : 4.5;
    const fwd = [0, 0, 0];
    const right = [0, 0, 0];
    vec3.forward(fwd, this.yaw, 0);
    vec3.right(right, this.yaw);
    let wx = fwd[0] * input.forward + right[0] * input.strafe;
    let wz = fwd[2] * input.forward + right[2] * input.strafe;
    const len = Math.hypot(wx, wz);
    if (len > 1) { wx /= len; wz /= len; }
    this.player.update(this.world, wx * speed, wz * speed, !!input.jump, dt);
    if (this.player.y < -60) this.respawn();                                          // fell off the world
    for (const p of this.pickups) {
      if (this.collected.has(p.id)) continue;
      const dx = p.matrix[12] - this.player.x;
      const dy = p.matrix[13] - this.player.y;
      const dz = p.matrix[14] - this.player.z;
      if (dx * dx + dy * dy * 0.25 + dz * dz < 1.1) this.collected.add(p.id);
    }
  }

  respawn() {
    this.player.x = this.startPoint.x;
    this.player.z = this.startPoint.z;
    this.player.y = 4;
    this.player.vy = 0;
  }

  /** The shapes to draw: everything but the markers that have been collected. */
  drawable() { return this.items.filter((i) => !this.collected.has(i.id)); }
}
