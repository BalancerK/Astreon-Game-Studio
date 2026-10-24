/**
 * A triangle mesh ready for the 3D renderers: interleaved vertices (position xyz, normal xyz: 6 floats) and 32-bit indices.
 * Right-handed, +y up, counter-clockwise triangles face outward.
 *
 * @typedef {Object} Mesh
 * @property {string} name
 * @property {Float32Array} vertices 6 floats per vertex: x, y, z, nx, ny, nz
 * @property {Uint32Array} indices 3 per triangle
 * @property {number} vertexCount
 * @property {number[]} min Bounding box corner
 * @property {number[]} max
 * @property {Float32Array} [uv] Optional texture coordinates, 2 floats per vertex. (0, 0) is the top left of the image (the first row of its data), as in glTF.
 * @property {Float32Array} [skin] Skinned meshes only: 8 floats per vertex, four joint indices then four weights (see `createSkinnedMesh`)
 * @property {number} [jointCount] Skinned meshes only: how many joints the skin refers to
 */

export const VERTEX_FLOATS = 6;
/** Bytes per mesh vertex (`VERTEX_FLOATS` × 4). */
export const VERTEX_BYTES = VERTEX_FLOATS * 4;

/**
 * Wrap vertex data into a Mesh (computing the bounds).
 * @param {Float32Array | number[]} vertices interleaved position and normal
 * @param {Uint32Array | number[]} indices
 * @param {string} [name]
 * @param {ArrayLike<number>} [uv] 2 floats per vertex
 */
export function createMesh(vertices, indices, name = 'mesh', uv = undefined) {
  const v = vertices instanceof Float32Array ? vertices : Float32Array.from(vertices);
  const i = indices instanceof Uint32Array ? indices : Uint32Array.from(indices);
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let k = 0; k < v.length; k += VERTEX_FLOATS) {
    for (let a = 0; a < 3; a++) { if (v[k + a] < min[a]) min[a] = v[k + a]; if (v[k + a] > max[a]) max[a] = v[k + a]; }
  }
  if (v.length === 0) { min.fill(0); max.fill(0); }
  const mesh = { name, vertices: v, indices: i, vertexCount: v.length / VERTEX_FLOATS, min, max };
  if (uv) {
    if (uv.length !== mesh.vertexCount * 2) throw new Error(`uv needs 2 floats for each of the ${mesh.vertexCount} vertices (got ${uv.length})`);
    mesh.uv = uv instanceof Float32Array ? uv : Float32Array.from(uv);
  }
  return mesh;
}

/** Floats of skinning data per vertex (4 joint indices and 4 weights). */
export const SKIN_FLOATS = 8;
/** Bytes of skinning data per vertex (joint indices and weights). */
export const SKIN_BYTES = SKIN_FLOATS * 4;

/**
 * A mesh that follows a skeleton: every vertex is pulled by up to four joints, by weight. Draw it with
 * `DrawList3D.addSkinned` and the palette from `Skeleton.computePalette`. The vertices are the rest (bind) pose.
 *
 * @param {Float32Array | number[]} vertices interleaved position and normal, as for `createMesh`
 * @param {Uint32Array | number[]} indices
 * @param {ArrayLike<number>} joints 4 joint indices per vertex (use weight 0 for unused slots)
 * @param {ArrayLike<number>} weights 4 weights per vertex; normalised here so they sum to 1
 * @param {number} jointCount Number of joints in the skeleton (at most 255)
 * @param {string} [name]
 * @param {ArrayLike<number>} [uv] Texture coordinates, 2 per vertex
 */
export function createSkinnedMesh(vertices, indices, joints, weights, jointCount, name = 'skinned', uv = undefined) {
  const mesh = createMesh(vertices, indices, name, uv);
  const n = mesh.vertexCount;
  if (joints.length !== n * 4 || weights.length !== n * 4) throw new Error(`need 4 joints and 4 weights for each of the ${n} vertices`);
  if (!(jointCount >= 1 && jointCount <= 255)) throw new Error(`jointCount must be 1..255 (got ${jointCount})`);
  const skin = new Float32Array(n * SKIN_FLOATS);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let k = 0; k < 4; k++) {
      const j = joints[i * 4 + k], w = weights[i * 4 + k];
      if (!Number.isInteger(j) || j < 0 || j >= jointCount) throw new Error(`vertex ${i}: joint index ${j} is outside 0..${jointCount - 1}`);
      if (!(w >= 0)) throw new Error(`vertex ${i}: weights must be zero or positive`);
      skin[i * SKIN_FLOATS + k] = j;
      skin[i * SKIN_FLOATS + 4 + k] = w;
      sum += w;
    }
    if (sum <= 0) { skin[i * SKIN_FLOATS + 4] = 1; sum = 1; } // unweighted: follow joint 0 (or the first listed) rigidly
    for (let k = 0; k < 4; k++) skin[i * SKIN_FLOATS + 4 + k] /= sum;
  }
  mesh.skin = skin;
  mesh.jointCount = jointCount;
  return mesh;
}

/** Builds up vertices and indices. */
class Builder {
  constructor() { this.v = []; this.uv = []; this.i = []; }
  vertex(x, y, z, nx, ny, nz, u = 0, w = 0) { this.v.push(x, y, z, nx, ny, nz); this.uv.push(u, w); return this.v.length / VERTEX_FLOATS - 1; }
  tri(a, b, c) { this.i.push(a, b, c); }
  quad(a, b, c, d) { this.i.push(a, b, c, a, c, d); }
  build(name) { return createMesh(this.v, this.i, name, this.uv); }
}

/** An axis-aligned box centred on the origin with flat-shaded faces. */
export function createBox(sx = 1, sy = 1, sz = 1) {
  const b = new Builder();
  const hx = sx / 2, hy = sy / 2, hz = sz / 2;
  const face = (nx, ny, nz, ax, ay, az, bx, by, bz) => { // the face centre is n * half; a and b are its edge directions (half lengths)
    const cx = nx * hx, cy = ny * hy, cz = nz * hz;
    const i = b.vertex(cx - ax - bx, cy - ay - by, cz - az - bz, nx, ny, nz, 0, 1); // each face is 0..1 in both directions, upright on the sides
    b.vertex(cx + ax - bx, cy + ay - by, cz + az - bz, nx, ny, nz, 1, 1);
    b.vertex(cx + ax + bx, cy + ay + by, cz + az + bz, nx, ny, nz, 1, 0);
    b.vertex(cx - ax + bx, cy - ay + by, cz - az + bz, nx, ny, nz, 0, 0);
    b.quad(i, i + 1, i + 2, i + 3);
  };
  face(0, 0, 1, hx, 0, 0, 0, hy, 0);   // +z
  face(0, 0, -1, -hx, 0, 0, 0, hy, 0); // -z
  face(1, 0, 0, 0, 0, -hz, 0, hy, 0);  // +x
  face(-1, 0, 0, 0, 0, hz, 0, hy, 0);  // -x
  face(0, 1, 0, hx, 0, 0, 0, 0, -hz);  // +y
  face(0, -1, 0, hx, 0, 0, 0, 0, hz);  // -y
  return b.build('box');
}

/** A flat grid in the xz plane facing +y, centred on the origin. */
export function createPlane(width = 1, depth = 1, segmentsX = 1, segmentsZ = 1) {
  const b = new Builder();
  for (let z = 0; z <= segmentsZ; z++) for (let x = 0; x <= segmentsX; x++) b.vertex((x / segmentsX - 0.5) * width, 0, (z / segmentsZ - 0.5) * depth, 0, 1, 0, x / segmentsX, z / segmentsZ);
  for (let z = 0; z < segmentsZ; z++) for (let x = 0; x < segmentsX; x++) {
    const i = z * (segmentsX + 1) + x;
    b.quad(i, i + segmentsX + 1, i + segmentsX + 2, i + 1);
  }
  return b.build('plane');
}

/** A UV sphere with smooth normals. */
export function createSphere(radius = 0.5, segments = 24, rings = 16) {
  const b = new Builder();
  for (let r = 0; r <= rings; r++) {
    const phi = (r / rings) * Math.PI;
    for (let s = 0; s <= segments; s++) {
      const theta = (s / segments) * Math.PI * 2;
      const nx = Math.sin(phi) * Math.cos(theta), ny = Math.cos(phi), nz = Math.sin(phi) * Math.sin(theta);
      b.vertex(nx * radius, ny * radius, nz * radius, nx, ny, nz, s / segments, r / rings);
    }
  }
  for (let r = 0; r < rings; r++) for (let s = 0; s < segments; s++) {
    const i = r * (segments + 1) + s;
    b.quad(i, i + segments + 1, i + segments + 2, i + 1);
  }
  // quads above wind clockwise seen from outside with this vertex order: flip every triangle
  for (let k = 0; k < b.i.length; k += 3) { const t = b.i[k + 1]; b.i[k + 1] = b.i[k + 2]; b.i[k + 2] = t; }
  return b.build('sphere');
}

/** An upright cylinder (axis along y, centred on the origin) with capped ends. */
export function createCylinder(radius = 0.5, height = 1, segments = 24) {
  const b = new Builder();
  const h = height / 2;
  for (let s = 0; s <= segments; s++) {
    const a = (s / segments) * Math.PI * 2, c = Math.cos(a), n = Math.sin(a);
    b.vertex(c * radius, -h, n * radius, c, 0, n, s / segments, 1);
    b.vertex(c * radius, h, n * radius, c, 0, n, s / segments, 0);
  }
  for (let s = 0; s < segments; s++) { const i = s * 2; b.i.push(i, i + 1, i + 3, i, i + 3, i + 2); }
  for (const [y, ny] of [[h, 1], [-h, -1]]) { // caps
    const centre = b.vertex(0, y, 0, 0, ny, 0, 0.5, 0.5);
    const first = b.v.length / VERTEX_FLOATS;
    for (let s = 0; s <= segments; s++) { const a = (s / segments) * Math.PI * 2; b.vertex(Math.cos(a) * radius, y, Math.sin(a) * radius, 0, ny, 0, 0.5 + Math.cos(a) * 0.5, 0.5 + Math.sin(a) * 0.5); }
    for (let s = 0; s < segments; s++) { if (ny > 0) b.tri(centre, first + s + 1, first + s); else b.tri(centre, first + s, first + s + 1); }
  }
  return b.build('cylinder');
}

/** An upright capsule (a cylinder with hemispherical ends): `height` is the total height. Handy for characters. */
export function createCapsule(radius = 0.4, height = 1.8, segments = 20, rings = 8) {
  const b = new Builder();
  const straight = Math.max(0, height - 2 * radius) / 2;
  const rowsPerCap = rings;
  const rows = [];
  for (let r = 0; r <= rowsPerCap; r++) rows.push({ phi: (r / rowsPerCap) * (Math.PI / 2), dy: straight }); // top cap, pole to equator
  for (let r = 0; r <= rowsPerCap; r++) rows.push({ phi: Math.PI / 2 + (r / rowsPerCap) * (Math.PI / 2), dy: -straight }); // bottom cap
  for (const [rowIndex, row] of rows.entries()) {
    for (let s = 0; s <= segments; s++) {
      const theta = (s / segments) * Math.PI * 2;
      const nx = Math.sin(row.phi) * Math.cos(theta), ny = Math.cos(row.phi), nz = Math.sin(row.phi) * Math.sin(theta);
      b.vertex(nx * radius, ny * radius + row.dy, nz * radius, nx, ny, nz, s / segments, rowIndex / (rows.length - 1));
    }
  }
  for (let r = 0; r < rows.length - 1; r++) for (let s = 0; s < segments; s++) {
    const i = r * (segments + 1) + s;
    b.i.push(i, i + 1, i + segments + 2, i, i + segments + 2, i + segments + 1);
  }
  return b.build('capsule');
}

/**
 * A flat-shaded mesh from raw triangles (9 numbers each: a, b, c), e.g. the collision geometry of a `TriWorld`.
 * Every triangle gets its own three vertices so each face is shaded by its own normal.
 * @param {ArrayLike<number>} triangles
 * @param {number} [count] Number of triangles (default: all of `triangles`)
 */
export function createMeshFromTriangles(triangles, count = Math.floor(triangles.length / 9), name = 'triangles') {
  const v = new Float32Array(count * 3 * VERTEX_FLOATS), idx = new Uint32Array(count * 3);
  for (let t = 0; t < count; t++) {
    const o = t * 9;
    const e1x = triangles[o + 3] - triangles[o], e1y = triangles[o + 4] - triangles[o + 1], e1z = triangles[o + 5] - triangles[o + 2];
    const e2x = triangles[o + 6] - triangles[o], e2y = triangles[o + 7] - triangles[o + 1], e2z = triangles[o + 8] - triangles[o + 2];
    let nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    nx /= len; ny /= len; nz /= len;
    for (let k = 0; k < 3; k++) {
      const d = (t * 3 + k) * VERTEX_FLOATS;
      v[d] = triangles[o + k * 3]; v[d + 1] = triangles[o + k * 3 + 1]; v[d + 2] = triangles[o + k * 3 + 2];
      v[d + 3] = nx; v[d + 4] = ny; v[d + 5] = nz;
      idx[t * 3 + k] = t * 3 + k;
    }
  }
  return createMesh(v, idx, name);
}

/**
 * Smooth vertex normals from positions and indices (area-weighted average of the faces around each vertex).
 * @param {ArrayLike<number>} positions x, y, z per vertex
 * @param {ArrayLike<number>} indices
 * @returns {Float32Array} nx, ny, nz per vertex
 */
export function computeNormals(positions, indices) {
  const n = new Float32Array(positions.length);
  for (let t = 0; t + 2 < indices.length; t += 3) {
    const a = indices[t] * 3, b = indices[t + 1] * 3, c = indices[t + 2] * 3;
    const e1x = positions[b] - positions[a], e1y = positions[b + 1] - positions[a + 1], e1z = positions[b + 2] - positions[a + 2];
    const e2x = positions[c] - positions[a], e2y = positions[c + 1] - positions[a + 1], e2z = positions[c + 2] - positions[a + 2];
    const x = e1y * e2z - e1z * e2y, y = e1z * e2x - e1x * e2z, z = e1x * e2y - e1y * e2x; // length = twice the area: the weight
    for (const i of [a, b, c]) { n[i] += x; n[i + 1] += y; n[i + 2] += z; }
  }
  for (let i = 0; i < n.length; i += 3) {
    const len = Math.sqrt(n[i] * n[i] + n[i + 1] * n[i + 1] + n[i + 2] * n[i + 2]);
    if (len > 0) { n[i] /= len; n[i + 1] /= len; n[i + 2] /= len; } else n[i + 1] = 1;
  }
  return n;
}
