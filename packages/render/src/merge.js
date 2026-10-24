/**
 * Merging static scenery. A level of five hundred different rocks, fences and crates is five hundred draw calls even though nothing moves. `mergeMeshes` bakes several
 * placed meshes into one mesh in world space, and `StaticBatcher` does it for a whole level: it groups the pieces that look the same (same colour and texture) by
 * where they are (a grid of cells, so the camera can still skip the far ones) and merges each group. The merged meshes are drawn with `DrawList3D.addBatch`.
 * Pieces that move, are skinned or change colour stay ordinary instances.
 */

import { VERTEX_FLOATS, createMesh } from './mesh.js';

/**
 * Bake placed meshes into one mesh in world space: positions go through each `model`, normals through its inverse transpose (so squashed things light correctly),
 * and a mirrored placement (a negative scale) has its triangles turned back round. Texture coordinates are kept (pieces without any get (0, 0); if none has any, the
 * result has none).
 * @param {{mesh: import('./mesh.js').Mesh, model: ArrayLike<number>}[]} parts
 * @param {string} [name]
 * @returns {import('./mesh.js').Mesh}
 */
export function mergeMeshes(parts, name = 'merged') {
  if (!parts.length) throw new Error('mergeMeshes needs at least one mesh');
  let vcount = 0, icount = 0, anyUv = false;
  for (const { mesh } of parts) {
    if (mesh.skin) throw new Error(`"${mesh.name}" is a skinned mesh: it moves with its skeleton and cannot be baked into a static mesh`);
    vcount += mesh.vertexCount; icount += mesh.indices.length; anyUv ||= Boolean(mesh.uv);
  }
  const vertices = new Float32Array(vcount * VERTEX_FLOATS), indices = new Uint32Array(icount), uv = anyUv ? new Float32Array(vcount * 2) : undefined;
  let vo = 0, io = 0, base = 0;
  for (const { mesh, model: m } of parts) {
    // the inverse transpose of the upper 3x3 (cofactors), which also gives the sign of the determinant
    const a = m[0], b = m[4], c = m[8], d = m[1], e = m[5], f = m[9], g = m[2], h = m[6], i = m[10];
    const c00 = e * i - f * h, c01 = f * g - d * i, c02 = d * h - e * g;
    const c10 = c * h - b * i, c11 = a * i - c * g, c12 = b * g - a * h;
    const c20 = b * f - c * e, c21 = c * d - a * f, c22 = a * e - b * d;
    const det = a * c00 + b * c01 + c * c02, flip = det < 0;
    const src = mesh.vertices;
    for (let k = 0; k < mesh.vertexCount; k++, vo += VERTEX_FLOATS) {
      const s = k * VERTEX_FLOATS, x = src[s], y = src[s + 1], z = src[s + 2];
      vertices[vo] = m[0] * x + m[4] * y + m[8] * z + m[12];
      vertices[vo + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
      vertices[vo + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
      let nx = c00 * src[s + 3] + c01 * src[s + 4] + c02 * src[s + 5], ny = c10 * src[s + 3] + c11 * src[s + 4] + c12 * src[s + 5], nz = c20 * src[s + 3] + c21 * src[s + 4] + c22 * src[s + 5];
      if (flip) { nx = -nx; ny = -ny; nz = -nz; }                     // cofactors of a mirrored matrix point the wrong way
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      vertices[vo + 3] = nx / len; vertices[vo + 4] = ny / len; vertices[vo + 5] = nz / len;
      if (uv && mesh.uv) { uv[(vo / VERTEX_FLOATS) * 2] = mesh.uv[k * 2]; uv[(vo / VERTEX_FLOATS) * 2 + 1] = mesh.uv[k * 2 + 1]; }
    }
    const idx = mesh.indices;
    for (let t = 0; t < idx.length; t += 3) {
      indices[io++] = base + idx[t];
      indices[io++] = base + (flip ? idx[t + 2] : idx[t + 1]);
      indices[io++] = base + (flip ? idx[t + 1] : idx[t + 2]);
    }
    base += mesh.vertexCount;
  }
  return createMesh(vertices, indices, name, uv);
}

/**
 * @typedef {Object} StaticBatch
 * @property {import('./mesh.js').Mesh} mesh The merged geometry, in world space.
 * @property {number[]} color RGBA the batch is drawn with. @property {number[]} material `[texture layer or -1, mapping, scale, surface]`, as for `DrawList3D.setMaterial` / `setSurface`.
 * @property {number} pieces How many placed meshes went into it.
 */

/** Collects placed meshes and merges them into as few meshes as it can without breaking culling or looks. */
export class StaticBatcher {
  /**
   * @param {object} [o]
   * @param {number} [o.cellSize] Pieces are only merged with others in the same cell of a grid this many metres wide (default 40), so that a batch is small enough to be
   *   skipped when it is out of view. A bigger cell merges more (fewer draws, less culling).
   * @param {number} [o.maxVertices] Start another batch when one would pass this many vertices (default 60000).
   */
  constructor({ cellSize = 40, maxVertices = 60000 } = {}) {
    if (!(cellSize > 0)) throw new Error('cellSize must be above 0');
    this.cellSize = cellSize; this.maxVertices = maxVertices;
    /** @type {Map<string, {color: number[], material: number[], parts: {mesh: any, model: ArrayLike<number>}[], vertices: number}[]>} */
    this.groups = new Map();
    /** Pieces added. */
    this.pieces = 0;
  }

  /**
   * Add a placed piece. Pieces that share `color` and the texture and surface settings can be merged; ones that differ cannot (a colour or texture is per batch, not per vertex).
   * @param {import('./mesh.js').Mesh} mesh @param {ArrayLike<number>} model Column-major 4x4 placement.
   * @param {{color?: number[], layer?: number | null, mapping?: 'uv' | 'planar', scale?: number, surface?: number}} [o]
   */
  add(mesh, model, { color = [1, 1, 1, 1], layer = null, mapping = 'uv', scale = 1, surface = 0 } = {}) {
    const material = layer === null || layer === undefined ? [-1, 0, 1, surface] : [layer, mapping === 'planar' ? 2 : 1, scale, surface];
    const col = [color[0], color[1], color[2], color[3] ?? 1];
    // the cell is where the piece's centre ends up
    const cx = (mesh.min[0] + mesh.max[0]) / 2, cy = (mesh.min[1] + mesh.max[1]) / 2, cz = (mesh.min[2] + mesh.max[2]) / 2;
    const x = model[0] * cx + model[4] * cy + model[8] * cz + model[12], y = model[1] * cx + model[5] * cy + model[9] * cz + model[13], z = model[2] * cx + model[6] * cy + model[10] * cz + model[14];
    const s = this.cellSize;
    const key = `${col.join(',')}|${material.join(',')}|${Math.floor(x / s)},${Math.floor(y / s)},${Math.floor(z / s)}`;
    let list = this.groups.get(key);
    if (!list) { list = []; this.groups.set(key, list); }
    let g = list[list.length - 1];
    if (!g || g.vertices + mesh.vertexCount > this.maxVertices) { g = { color: col, material, parts: [], vertices: 0 }; list.push(g); }
    g.parts.push({ mesh, model: Float32Array.from(model) });
    g.vertices += mesh.vertexCount;
    this.pieces++;
    return this;
  }

  /**
   * Merge everything added so far. A group with one piece is not merged (the piece is baked into world space all the same, so every batch is drawn the same way).
   * @returns {StaticBatch[]}
   */
  build() {
    const out = [];
    for (const list of this.groups.values()) for (const g of list) {
      out.push({ mesh: mergeMeshes(g.parts, `batch${out.length}`), color: g.color, material: g.material, pieces: g.parts.length });
    }
    return out;
  }
}
