import { WHITE } from './batch.js';

/**
 * Flat triangles for the 2D renderers: whatever a quad cannot do (a deforming skeleton mesh, a rope, a flag, a torn sprite). Every vertex has a position in world units, a place in the atlas,
 * a tint and an atlas page, so one `MeshBatch2D` is one draw call whatever it holds. Draw it with `renderer.render({ camera, batch, meshes })`: meshes are drawn after the sprites of the
 * same call (use `renderLayers` to interleave).
 *
 * Each vertex is 6 words (24 bytes):
 *
 *  word 0-1  x, y      position in world units
 *  word 2-3  u, v      position in the atlas page, 0..1 (use the sprite's `u0 v0 u1 v1` range)
 *  word 4    tint      RGBA8, see `packTint` (straight alpha; the shader premultiplies)
 *  word 5    meta      atlas page in bits 0-7; bit 10 = additive (the colour is added to what is behind it instead of covering it)
 */
export const MESH_VERTEX_WORDS = 6;
/** Bytes per vertex in a `MeshBatch2D`. */
export const MESH_VERTEX_BYTES = MESH_VERTEX_WORDS * 4;
/** Flag in the vertex meta word: the mesh adds its light to the picture instead of covering it. */
export const META_ADDITIVE = 1024;

/** Accumulates triangles for one frame. Reuse it every frame: `clear()` then `push()` / `pushQuad()` (or, for speed, `begin()` and write the words yourself). */
export class MeshBatch2D {
  /** @param {number} [vertexCapacity] Initial vertex capacity (grows as needed). @param {number} [indexCapacity] Initial index capacity. */
  constructor(vertexCapacity = 1024, indexCapacity = 3072) {
    this.f32 = new Float32Array(vertexCapacity * MESH_VERTEX_WORDS);
    this.u32 = new Uint32Array(this.f32.buffer);
    this.indices = new Uint32Array(indexCapacity);
    this.vertexCount = 0;
    this.indexCount = 0;
  }

  clear() { this.vertexCount = 0; this.indexCount = 0; }

  /**
   * Make room for `vertices` and `indices` and count them in. Returns the index of the first new vertex; write the vertex words at `base * MESH_VERTEX_WORDS` in `f32` / `u32` and the indices
   * (each plus `base`) at `indexCount - indices` in `indices`. This is the fast path `push*` use; skeleton drawing uses it directly.
   * @param {number} vertices @param {number} indices @returns {number}
   */
  begin(vertices, indices) {
    if ((this.vertexCount + vertices) * MESH_VERTEX_WORDS > this.f32.length) {
      let n = this.f32.length / MESH_VERTEX_WORDS;
      while ((this.vertexCount + vertices) > n) n *= 2;
      const next = new Float32Array(n * MESH_VERTEX_WORDS);
      next.set(this.f32.subarray(0, this.vertexCount * MESH_VERTEX_WORDS));
      this.f32 = next; this.u32 = new Uint32Array(next.buffer);
    }
    if (this.indexCount + indices > this.indices.length) {
      let n = this.indices.length;
      while (this.indexCount + indices > n) n *= 2;
      const next = new Uint32Array(n);
      next.set(this.indices.subarray(0, this.indexCount));
      this.indices = next;
    }
    const base = this.vertexCount;
    this.vertexCount += vertices; this.indexCount += indices;
    return base;
  }

  /**
   * Add a triangle mesh.
   * @param {ArrayLike<number>} positions x, y for each vertex (world units) @param {ArrayLike<number>} uvs u, v for each vertex (atlas page, 0..1) @param {ArrayLike<number>} triangles three vertex numbers for each triangle
   * @param {number} page Atlas page. @param {number} [tint] See `packTint`. @param {boolean} [additive] Add to the picture instead of covering it.
   */
  push(positions, uvs, triangles, page, tint = WHITE, additive = false) {
    const n = positions.length >> 1;
    const base = this.begin(n, triangles.length), f = this.f32, u = this.u32, meta = (page | 0) | (additive ? META_ADDITIVE : 0);
    for (let i = 0; i < n; i++) {
      const o = (base + i) * MESH_VERTEX_WORDS;
      f[o] = positions[i * 2]; f[o + 1] = positions[i * 2 + 1]; f[o + 2] = uvs[i * 2]; f[o + 3] = uvs[i * 2 + 1]; u[o + 4] = tint; u[o + 5] = meta;
    }
    const at = this.indexCount - triangles.length;
    for (let i = 0; i < triangles.length; i++) this.indices[at + i] = base + triangles[i];
  }

  /**
   * Add an atlas sprite as two triangles, optionally squeezed into any four corners (clockwise from the top left: a flag, a sheared card, a sprite bent by a spring).
   * @param {{u0: number, v0: number, u1: number, v1: number, page: number}} sprite @param {ArrayLike<number>} corners x, y of the top left, top right, bottom right and bottom left
   * @param {number} [tint] @param {boolean} [additive]
   */
  pushQuad(sprite, corners, tint = WHITE, additive = false) {
    this.push(corners, [sprite.u0, sprite.v0, sprite.u1, sprite.v0, sprite.u1, sprite.v1, sprite.u0, sprite.v1], QUAD_TRIANGLES, sprite.page, tint, additive);
  }
}

const QUAD_TRIANGLES = Uint16Array.of(0, 1, 2, 0, 2, 3);
