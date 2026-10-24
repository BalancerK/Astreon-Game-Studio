// What an entity looks like in the editor: its world matrix (from the chain of parents) and the shapes its prefab is made of, worked out
// from the prefab data alone, so nothing needs to run to show a scene. Games can say more with a `describe` function.
import { mat4 } from '../../math/src/index.js';
import { expandPaths, mergeDeep } from '../../prefab/src/index.js';
import { atMatrix } from './transform.js';

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
const MARKER = { shape: { type: 'box', hx: 0.25, hy: 0.25, hz: 0.25 }, color: [0.72, 0.72, 0.8], marker: true };

/**
 * The default way to give a prefab part a shape and colour: a rigid body's shape (`extras.body.shape`), a door's slab, and the `colour`
 * component if there is one. Return `null` for a part that has no shape of its own.
 * @param {any} spec The part's resolved prefab data.
 * @returns {{shape: {type: 'box' | 'sphere' | 'capsule', hx?: number, hy?: number, hz?: number, radius?: number, halfHeight?: number}, color: number[]} | null}
 */
export function defaultDescribe(spec) {
  const c = spec.components?.colour ?? spec.components?.color;
  const color = c ? [c.r ?? 0.6, c.g ?? 0.6, c.b ?? 0.6] : [0.6, 0.6, 0.7];
  const s = spec.extras?.body?.shape;
  if (s) return { shape: s, color };
  const door = spec.extras?.door;
  if (door) return { shape: { type: 'box', hx: door.size[0], hy: door.size[1], hz: door.size[2] }, color };
  return null;
}

/** Half extents of a shape's bounding box, in the part's own frame. */
export function halfExtents(shape) {
  if (shape.type === 'box') return [shape.hx, shape.hy, shape.hz];
  if (shape.type === 'sphere') return [shape.radius, shape.radius, shape.radius];
  if (shape.type === 'capsule') return [shape.radius, shape.halfHeight + shape.radius, shape.radius];
  return [0.25, 0.25, 0.25];
}

/** The prefab data of an entity as it will really be: parameters and overrides applied (children's overrides too). */
export function effectiveSpec(library, entity) {
  const spec = library.resolve(entity.prefab);
  for (const [name, value] of Object.entries(entity.params ?? {})) {
    const target = spec.params?.[name];
    if (target) mergeDeep(spec, expandPaths({ [target]: value }));
  }
  const o = entity.overrides;
  if (o && Object.keys(o).length) {
    const flat = Object.keys(o).some((k) => k.includes('.')) ? expandPaths(o) : o;
    const { children, ...rest } = clone(flat);
    for (const [k, v] of Object.entries(rest.components ?? {})) if (v === null) { delete spec.components[k]; delete rest.components[k]; }
    mergeDeep(spec, rest);
    for (const [name, co] of Object.entries(children ?? {})) {
      const i = (spec.children ?? []).findIndex((c) => c.name === name);
      if (i < 0) continue;
      if (co === null) { spec.children.splice(i, 1); continue; }
      (spec.children[i].overrides ??= {}); mergeDeep(spec.children[i].overrides, co);
    }
  }
  return spec;
}

/** Walk a prefab and its children: `visit(part, matrix)` for each part with the part's matrix relative to the instance root. */
function walk(library, spec, parentMatrix, path, visit) {
  visit({ spec, path }, parentMatrix);
  for (const c of spec.children ?? []) {
    let child;
    if (c.prefab !== undefined) {
      child = library.resolve(c.prefab);
      mergeDeep(child.components, clone(c.components ?? {})); mergeDeep(child.extras, clone(c.extras ?? {}));
      if (c.overrides) {
        const { children, ...rest } = clone(c.overrides);
        mergeDeep(child, rest);
        if (children) child.children = (child.children ?? []).map((gc) => (children[gc.name] ? { ...gc, overrides: { ...(gc.overrides ?? {}), ...children[gc.name] } } : gc));
      }
    } else child = clone(c);
    const local = atMatrix(c.local ?? child.local ?? {});
    walk(library, child, mat4.multiply(new Float64Array(16), parentMatrix, local), path ? `${path}/${c.name}` : c.name, visit);
  }
}

/** A scene document seen as things to draw and pick. Cheap to ask repeatedly: it only recomputes what changed. */
export class SceneView {
  /**
   * @param {import('../../scene/src/document.js').SceneDocument} doc
   * @param {{library: import('../../prefab/src/library.js').PrefabLibrary, describe?: (spec: any) => ReturnType<typeof defaultDescribe>}} o
   */
  constructor(doc, { library, describe = defaultDescribe }) {
    this.doc = doc; this.library = library; this.describe = (spec) => describe(spec) ?? defaultDescribe(spec);
    this.partCache = new Map();   // entity json -> parts
    this.worlds = new Map();      // id -> matrix
    this.itemCache = null;
    this.errors = new Map();      // id -> message
    this.seen = -1;
    doc.onChange(() => this.invalidate());
  }
  invalidate() { this.worlds.clear(); this.itemCache = null; this.seen = this.doc.mutations; }
  #fresh() { if (this.seen !== this.doc.mutations) this.invalidate(); }

  /** World matrix of an entity (its own pose on top of its parents'). */
  worldMatrix(id) {
    this.#fresh();
    let m = this.worlds.get(id);
    if (m) return m;
    const e = this.doc.get(id);
    if (!e) return mat4.identity(new Float64Array(16));
    const local = atMatrix(e.at);
    m = e.parent && this.doc.has(e.parent) ? mat4.multiply(new Float64Array(16), this.worldMatrix(e.parent), local) : local;
    this.worlds.set(id, m);
    return m;
  }

  #parts(entity) {
    const key = JSON.stringify([entity.prefab, entity.params ?? null, entity.overrides ?? null, this.doc.prefabs.length]);
    let parts = this.partCache.get(key);
    if (parts) return parts;
    parts = [];
    try {
      for (const p of this.doc.prefabs) this.library.define(p); // scene-local prefabs
      walk(this.library, effectiveSpec(this.library, entity), mat4.identity(new Float64Array(16)), '', ({ spec, path }, m) => {
        const d = this.describe(spec);
        if (d) parts.push({ path, local: m, shape: d.shape, color: d.color, half: halfExtents(d.shape), ramp: !!d.ramp });
      });
      this.errors.delete(entity.id);
    } catch (e) { this.errors.set(entity.id, e.message); parts = []; }
    if (!parts.length) parts.push({ path: '', local: mat4.identity(new Float64Array(16)), shape: MARKER.shape, color: entity.disabled ? [0.4, 0.4, 0.4] : MARKER.color, half: halfExtents(MARKER.shape), marker: true });
    this.partCache.set(key, parts);
    if (this.partCache.size > 2000) this.partCache.delete(this.partCache.keys().next().value);
    return parts;
  }

  /** Every drawable part in the scene: `{id, path, matrix, shape, color, half, marker}`; `matrix` is the part's world matrix without any size. */
  items() {
    this.#fresh();
    if (this.itemCache) return this.itemCache;
    const out = [];
    for (const id of this.doc.order) {
      const e = this.doc.get(id), w = this.worldMatrix(id);
      for (const p of this.#parts(e)) out.push({ id, path: p.path, matrix: mat4.multiply(new Float64Array(16), w, p.local), shape: p.shape, color: p.color, half: p.half, ramp: !!p.ramp, marker: !!p.marker, disabled: !!e.disabled });
    }
    return (this.itemCache = out);
  }
  itemsOf(ids) { const s = new Set(ids); return this.items().filter((i) => s.has(i.id)); }

  /** World-space box around some entities, or null. @returns {{min: number[], max: number[]} | null} */
  bounds(ids) {
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    let any = false;
    for (const it of this.itemsOf(ids)) {
      any = true;
      const m = it.matrix, h = it.half;
      for (let i = 0; i < 3; i++) { // the box's extent along each world axis
        const c = m[12 + i], r = Math.abs(m[i] * h[0]) + Math.abs(m[4 + i] * h[1]) + Math.abs(m[8 + i] * h[2]);
        min[i] = Math.min(min[i], c - r); max[i] = Math.max(max[i], c + r);
      }
    }
    return any ? { min, max } : null;
  }
}
