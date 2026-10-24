// Reading a scene made in the studio's 3D panel into the arcade kit's 3D world. In the panel you place cubes, floors, walls, pillars, balls, capsules and markers by
// dragging them; this turns that file into the `blocks`, `gems` and starting place that `drawWorld3d` and `move3d` use. Pure data in, pure data out.
//
//   hall = the default import of scenes/hall.json.js    (the studio makes this module from scenes/hall.json)
//   const world = loadWorld3d(hall);                    // { blocks, gems, start }
//
// A ramp (rising towards -z) becomes a ramp you can walk up. A shape becomes a block (a box standing on the floor, turned as it is in the panel). A marker named `start`
// (or `spawn`, or `player`) is where you begin, and which way you face; every other marker is a gem.
import { block, gem } from './view3d.js';

/** What each building block of the panel is like when nothing was changed: its shape and colour (the same numbers as the panel's). */
const PREFABS = {
  cube: { type: 'box', hx: 0.5, hy: 0.5, hz: 0.5, color: [0.82, 0.62, 0.35] },
  floor: { type: 'box', hx: 4, hy: 0.1, hz: 4, color: [0.45, 0.55, 0.45], floor: true },
  wall: { type: 'box', hx: 2, hy: 1.5, hz: 0.15, color: [0.6, 0.6, 0.65] },
  pillar: { type: 'box', hx: 0.3, hy: 1.5, hz: 0.3, color: [0.75, 0.72, 0.65] },
  ball: { type: 'sphere', radius: 0.5, color: [0.35, 0.65, 0.9] },
  capsule: { type: 'capsule', radius: 0.3, halfHeight: 0.5, color: [0.8, 0.8, 0.4] },
  ramp: { type: 'box', hx: 1, hy: 0.5, hz: 1.5, color: [0.62, 0.56, 0.45], ramp: true },
  marker: { type: 'marker', color: [0.95, 0.3, 0.25] },
};
/** The names the panel gives its size parameters, and the field each one sets. */
const PARAMS = { halfWidth: 'hx', halfHeight: 'hy', halfDepth: 'hz', radius: 'radius' };
const START = /^(start|spawn|player)/i;

const hex = ([r, g, b]) => `#${[r, g, b].map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0')).join('')}`;

/** The shape and colour of an entity once its parameters and overrides are applied. */
function look(entity) {
  const base = PREFABS[entity.prefab];
  if (!base) return null;
  const spec = { ...base, color: [...base.color] };
  for (const [name, value] of Object.entries(entity.params ?? {})) if (PARAMS[name] && Number.isFinite(value)) spec[PARAMS[name]] = value;
  const shape = entity.overrides?.extras?.shape;
  if (shape && typeof shape === 'object') for (const [k, v] of Object.entries(shape)) if (Number.isFinite(v)) spec[k] = v;
  const c = entity.overrides?.components?.colour;
  if (c && typeof c === 'object') spec.color = [c.r ?? spec.color[0], c.g ?? spec.color[1], c.b ?? spec.color[2]];
  return spec;
}

/** Where an entity is in the world: its place and which way it is turned, with its parents' places added in. */
function placeOf(scene, entity, byId, depth = 0) {
  const at = entity.at ?? {};
  let x = at.x ?? 0;
  let y = at.y ?? 0;
  let z = at.z ?? 0;
  let yaw = at.yaw ?? 0;
  const parent = depth < 16 && entity.parent ? byId.get(entity.parent) : null;
  if (parent) {
    const p = placeOf(scene, parent, byId, depth + 1);
    const c = Math.cos(p.yaw);
    const s = Math.sin(p.yaw);
    [x, z] = [p.x + x * c + z * s, p.z - x * s + z * c];
    y += p.y;
    yaw += p.yaw;
  }
  return { x, y, z, yaw, scale: at.scale ?? 1 };
}

/**
 * Turn a scene from the studio's 3D panel into a world for the 3D kit.
 * @param {{entities?: object[]}} scene what the scene file holds
 * @returns {{blocks: ReturnType<typeof block>[], gems: ReturnType<typeof gem>[], start: {x: number, z: number, yaw: number} | null, skipped: string[]}}
 *   `skipped` names the entities that were not understood (a block the kit does not know)
 */
export function loadWorld3d(scene) {
  if (!scene || !Array.isArray(scene.entities)) throw new Error('loadWorld3d needs a scene from the 3D panel (a file in scenes/, imported as scenes/name.json.js)');
  const byId = new Map(scene.entities.map((e) => [e.id, e]));
  const blocks = [];
  const gems = [];
  const skipped = [];
  let start = null;
  for (const e of scene.entities) {
    if (e.disabled) continue;
    const spec = look(e);
    if (!spec) { skipped.push(e.id ?? e.prefab); continue; }
    const p = placeOf(scene, e, byId);
    const color = hex(spec.color);
    if (spec.type === 'marker') {
      if (START.test(e.name ?? e.id ?? '')) start = { x: p.x, z: p.z, yaw: p.yaw };
      else gems.push(gem(p.x, p.z, p.y, color));
      continue;
    }
    const k = p.scale;
    let w;
    let d;
    let h;
    let bottom;
    if (spec.type === 'box') {
      w = spec.hx * 2 * k; d = spec.hz * 2 * k; h = spec.hy * 2 * k; bottom = p.y - spec.hy * k;
    } else if (spec.type === 'sphere') {
      w = d = h = spec.radius * 2 * k; bottom = p.y - spec.radius * k;
    } else {
      w = d = spec.radius * 2 * k; h = (spec.halfHeight + spec.radius) * 2 * k; bottom = p.y - (spec.halfHeight + spec.radius) * k;
    }
    const b = block(p.x, p.z, w, d, h, color, bottom, Math.abs(p.yaw) > 1e-9 ? p.yaw : 0);
    if (spec.floor) b.floor = true;
    if (spec.ramp) b.ramp = true;                                       // rises from the floor at its +z end to its full height at its -z end
    blocks.push(b);
  }
  return { blocks, gems, start, skipped };
}
