import { createMesh } from './mesh.js';

/**
 * Decals as meshes: a picture stuck onto whatever geometry is in a box. A bullet hole, a scorch mark, a blood splat, a footprint, a road marking, a spell circle: `createDecal` cuts the
 * triangles of the surface to the decal's box and gives the pieces texture coordinates projected along the box, so the picture follows bumps, steps and corners. The result is an
 * ordinary mesh: draw it with a material that has the picture and lets its alpha blend (`MaterialSet`'s `baseColorTexture`, or `opaque: false`), and a decal is just a few triangles.
 *
 * ```js
 * const hit = terrain.map.raycast(origin, dir);
 * const mesh = terrain.createDecal({ position: [hit.x, hit.y, hit.z], normal: hit.normal, size: 2, depth: 1.5, rotation: Math.random() * 6.28 });
 * list.setSurface(scorchMaterial); list.add(mesh, IDENTITY, 1, 1, 1, 0.9);
 * ```
 */

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

/**
 * The triangles of a mesh as nine numbers each (three corners), placed in the world.
 * @param {import('./mesh.js').Mesh} mesh @param {ArrayLike<number> | null} [matrix] Column-major 4x4 placement, or null for none.
 * @returns {Float32Array}
 */
export function meshTriangles(mesh, matrix = null) {
  const out = new Float32Array(mesh.indices.length * 3), v = mesh.vertices;
  for (let k = 0; k < mesh.indices.length; k++) {
    const o = mesh.indices[k] * 6, x = v[o], y = v[o + 1], z = v[o + 2];
    if (matrix) { out[k * 3] = matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12]; out[k * 3 + 1] = matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13]; out[k * 3 + 2] = matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14]; } else { out[k * 3] = x; out[k * 3 + 1] = y; out[k * 3 + 2] = z; }
  }
  return out;
}

/** Cut a polygon (list of [x, y, z]) to the half space where `axis` coordinate times `sign` is at most `limit`. */
function clipPolygon(poly, axis, sign, limit) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], da = limit - sign * a[axis], db = limit - sign * b[axis];
    if (da >= 0) out.push(a);
    if ((da >= 0) !== (db >= 0)) { const t = da / (da - db); out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]); }
  }
  return out;
}

/**
 * Make a decal mesh.
 * @param {ArrayLike<number>} triangles The surface to stick it to: nine numbers per triangle, counter-clockwise from outside, in the world (`Heightmap.toTriangles`, `meshTriangles`, a collision world's triangles).
 * @param {object} o
 * @param {number[]} o.position Where the middle of the decal's box is. @param {number[]} [o.normal] The way the decal faces (away from the surface it lands on); the picture is projected along it. Default up.
 * @param {number | number[]} [o.size] Width and height in metres (one number for a square). @param {number} [o.depth] How far the box reaches along the normal in total, in metres: surfaces further than half of it from `position` are left alone.
 * @param {number} [o.rotation] Radians to turn the picture about the normal. @param {number} [o.offset] Metres the decal is lifted off the surface, so it does not flicker against it.
 * @param {number} [o.maxAngle] Surfaces turned more than this many degrees away from the decal's facing are skipped (a decal on a wall does not wrap onto the floor behind it). Default 80.
 * @param {number[]} [o.uvRect] [u0, v0, u1, v1]: which part of the texture to use (an atlas cell). @param {string} [o.name]
 * @returns {import('./mesh.js').Mesh | null} `null` if the box holds no surface.
 */
export function createDecal(triangles, { position, normal = [0, 1, 0], size = 1, depth = 1, rotation = 0, offset = 0.01, maxAngle = 80, uvRect = [0, 0, 1, 1], name = 'decal' }) {
  if (!position || position.length < 3) throw new Error('a decal needs a position [x, y, z]');
  const [w, h] = Array.isArray(size) ? size : [size, size];
  if (!(w > 0 && h > 0 && depth > 0)) throw new Error('a decal needs a positive size and depth');
  const n = norm(normal), up = Math.abs(n[1]) < 0.99 ? [0, 1, 0] : [0, 0, 1];
  let t = norm(cross(up, n)), b = cross(n, t);
  const c = Math.cos(rotation), s = Math.sin(rotation);
  [t, b] = [[t[0] * c + b[0] * s, t[1] * c + b[1] * s, t[2] * c + b[2] * s], [-t[0] * s + b[0] * c, -t[1] * s + b[1] * c, -t[2] * s + b[2] * c]];
  const cosMax = Math.cos((maxAngle * Math.PI) / 180), half = [w / 2, h / 2, depth / 2];
  const verts = [], uvs = [], indices = [];
  for (let k = 0; k + 8 < triangles.length; k += 9) {
    const v0 = [triangles[k], triangles[k + 1], triangles[k + 2]], v1 = [triangles[k + 3], triangles[k + 4], triangles[k + 5]], v2 = [triangles[k + 6], triangles[k + 7], triangles[k + 8]];
    const tn = cross(sub(v1, v0), sub(v2, v0)), len = Math.hypot(...tn);
    if (len < 1e-12) continue;
    tn[0] /= len; tn[1] /= len; tn[2] /= len;
    if (dot(tn, n) < cosMax) continue;
    let poly = [v0, v1, v2].map((p) => { const d = sub(p, position); return [dot(d, t), dot(d, b), dot(d, n)]; });
    for (let axis = 0; axis < 3 && poly.length >= 3; axis++) { poly = clipPolygon(poly, axis, 1, half[axis]); if (poly.length >= 3) poly = clipPolygon(poly, axis, -1, half[axis]); }
    if (poly.length < 3) continue;
    const base = verts.length / 6;
    for (const p of poly) {
      verts.push(position[0] + t[0] * p[0] + b[0] * p[1] + n[0] * p[2] + tn[0] * offset, position[1] + t[1] * p[0] + b[1] * p[1] + n[1] * p[2] + tn[1] * offset, position[2] + t[2] * p[0] + b[2] * p[1] + n[2] * p[2] + tn[2] * offset, tn[0], tn[1], tn[2]);
      uvs.push(uvRect[0] + (p[0] / w + 0.5) * (uvRect[2] - uvRect[0]), uvRect[1] + (0.5 - p[1] / h) * (uvRect[3] - uvRect[1]));
    }
    for (let i = 1; i + 1 < poly.length; i++) indices.push(base, base + i, base + i + 1);
  }
  return indices.length ? createMesh(verts, indices, name, uvs) : null;
}
