// Changing the shape of an object in the editor: which of a prefab's size parameters make up its width, height and depth, and what a stretch along an axis
// does to them. A box prefab (halfWidth, halfHeight, halfDepth), a ball (radius) and a capsule (radius, halfHeight) all work from the names their parameters
// point at (`extras.shape.hx`, `hy`, `hz`, `radius`, `halfHeight`); a prefab without a shape has none, and is scaled as a whole instead.
import { effectiveSpec } from './visuals.js';

const AXIS_OF = { hx: ['x'], hy: ['y'], hz: ['z'], halfHeight: ['y'] };

const valueAt = (spec, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), spec);

/**
 * The size parameters of an entity that a stretch can change.
 * @param {import('../../prefab/src/library.js').PrefabLibrary} library
 * @param {any} entity an entity of a scene
 * @returns {{name: string, axes: string[], value: number}[] | null} null when the entity's prefab has no shape with size parameters
 */
export function shapeHandles(library, entity) {
  let spec;
  try { spec = effectiveSpec(library, entity); } catch { return null; }
  const type = spec.extras?.shape?.type;
  if (!type || !spec.params) return null;
  const out = [];
  for (const [name, target] of Object.entries(spec.params)) {
    if (typeof target !== 'string' || !target.startsWith('extras.shape.')) continue;
    const field = target.slice('extras.shape.'.length);
    const value = valueAt(spec, target);
    if (!Number.isFinite(value)) continue;
    let axes = AXIS_OF[field];
    if (field === 'radius') axes = type === 'sphere' ? ['x', 'y', 'z'] : ['x', 'z'];
    if (axes) out.push({ name, axes, value });
  }
  return out.length ? out : null;
}

/**
 * The parameters to set when an object is stretched along its own axes.
 * @param {{name: string, axes: string[], value: number}[]} handles from {@link shapeHandles}
 * @param {number[]} factors how much along x, y and z (1 leaves it)
 * @returns {Record<string, number>} parameter name -> new value (only those that change)
 */
export function stretch(handles, factors) {
  const f = { x: factors[0], y: factors[1], z: factors[2] };
  const patch = {};
  for (const h of handles) {
    const k = h.axes.reduce((m, a) => m * f[a], 1) ** (1 / h.axes.length);                 // a radius follows the mean of its axes
    if (Math.abs(k - 1) > 1e-9) patch[h.name] = Math.round(h.value * k * 1e4) / 1e4;
  }
  return patch;
}

/** The width, height and depth of an entity's shape, in its own axes (twice the half sizes), or null. */
export function sizeOf(library, entity) {
  let spec;
  try { spec = effectiveSpec(library, entity); } catch { return null; }
  const s = spec.extras?.shape;
  if (!s) return null;
  if (s.type === 'box') return [s.hx * 2, s.hy * 2, s.hz * 2];
  if (s.type === 'sphere') return [s.radius * 2, s.radius * 2, s.radius * 2];
  if (s.type === 'capsule') return [s.radius * 2, (s.halfHeight + s.radius) * 2, s.radius * 2];
  return null;
}
