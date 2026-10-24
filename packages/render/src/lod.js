/**
 * Levels of detail. Far away, a mesh covers a few pixels and its thousands of triangles are wasted: `simplifyMesh` makes a coarser copy of a mesh, `createLod` bundles
 * several versions of one thing with the size on screen at which each takes over, and `DrawList3D.addLod` picks the right one for the camera, every frame, at no cost
 * beyond a division. Below a size you choose, the thing is not drawn at all.
 */

import { VERTEX_FLOATS, SKIN_FLOATS, createMesh, createSkinnedMesh } from './mesh.js';

/**
 * Make a coarser copy of a mesh by vertex clustering: the mesh is cut into a grid of cells, the vertices in a cell become one (their average), triangles that collapse
 * to a line or a point are dropped. It is fast (linear in the size of the mesh), never fails on messy meshes, and works on skinned meshes (the joints of a cluster's
 * vertices are blended and the four strongest kept). It rounds off small features and sharp corners as the cells grow, which is what a distant LOD should do.
 *
 * Give `ratio` (0..1: the fraction of triangles to keep, found by trying cell sizes) or `cellSize` (metres, exactly). Texture seams may smear a little at coarse levels,
 * and a mesh with hard edges (a box with a normal per face) is rounded off unless you pass `keepEdges: true`, which keeps vertices with very different normals apart
 * (at the price of fewer triangles saved on smooth surfaces and tiny cracks between clusters).
 * @param {import('./mesh.js').Mesh} mesh
 * @param {{ratio?: number, cellSize?: number, keepEdges?: boolean, name?: string}} [o]
 * @returns {import('./mesh.js').Mesh}
 */
export function simplifyMesh(mesh, { ratio, cellSize, keepEdges = false, name } = {}) {
  if (ratio === undefined && cellSize === undefined) throw new Error('simplifyMesh needs a ratio (0..1) or a cellSize (metres)');
  const tris = mesh.indices.length / 3;
  if (cellSize === undefined) {
    if (!(ratio > 0 && ratio <= 1)) throw new Error(`ratio must be above 0 and at most 1 (got ${ratio})`);
    if (ratio === 1) return copyOf(mesh, name);
    const target = Math.max(1, Math.round(tris * ratio));
    const extent = Math.max(mesh.max[0] - mesh.min[0], mesh.max[1] - mesh.min[1], mesh.max[2] - mesh.min[2]) || 1;
    let lo = extent / 4096, hi = extent;                 // cell sizes: tiny keeps everything, the whole mesh collapses it
    let best = null;
    for (let i = 0; i < 18; i++) {
      const mid = Math.sqrt(lo * hi);                    // search on a log scale
      const r = cluster(mesh, mid, keepEdges);
      if (r.triangles >= target) { best = r; lo = mid; } else hi = mid;
      if (best && Math.abs(best.triangles - target) <= Math.max(1, target * 0.02)) break;
    }
    return build(mesh, best ?? cluster(mesh, lo, keepEdges), name);
  }
  if (!(cellSize > 0)) throw new Error(`cellSize must be above 0 (got ${cellSize})`);
  return build(mesh, cluster(mesh, cellSize, keepEdges), name);
}

function copyOf(mesh, name) {
  const n = name ?? `${mesh.name}-copy`;
  if (mesh.skin) return createSkinnedMesh(mesh.vertices.slice(), mesh.indices.slice(), skinJoints(mesh, mesh.vertexCount), skinWeights(mesh, mesh.vertexCount), mesh.jointCount, n, mesh.uv?.slice());
  return createMesh(mesh.vertices.slice(), mesh.indices.slice(), n, mesh.uv?.slice());
}

const skinJoints = (mesh, n) => { const a = new Array(n * 4); for (let i = 0; i < n; i++) for (let k = 0; k < 4; k++) a[i * 4 + k] = mesh.skin[i * SKIN_FLOATS + k]; return a; };
const skinWeights = (mesh, n) => { const a = new Array(n * 4); for (let i = 0; i < n; i++) for (let k = 0; k < 4; k++) a[i * 4 + k] = mesh.skin[i * SKIN_FLOATS + 4 + k]; return a; };

/** Group the vertices into cells; returns for each original vertex its cluster, and the number of triangles that survive. */
function cluster(mesh, size, keepEdges) {
  const v = mesh.vertices, n = mesh.vertexCount, inv = 1 / size;
  const ids = new Map(), of = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * VERTEX_FLOATS;
    const cx = Math.floor((v[o] - mesh.min[0]) * inv), cy = Math.floor((v[o + 1] - mesh.min[1]) * inv), cz = Math.floor((v[o + 2] - mesh.min[2]) * inv);
    let key = `${cx},${cy},${cz}`;
    if (keepEdges) key += `,${Math.round(v[o + 3] * 1.5)},${Math.round(v[o + 4] * 1.5)},${Math.round(v[o + 5] * 1.5)}`;      // normals within about 35 degrees stay together
    let id = ids.get(key);
    if (id === undefined) { id = ids.size; ids.set(key, id); }
    of[i] = id;
  }
  const idx = mesh.indices, kept = [];
  const seen = new Set();
  for (let t = 0; t < idx.length; t += 3) {
    const a = of[idx[t]], b = of[idx[t + 1]], c = of[idx[t + 2]];
    if (a === b || b === c || a === c) continue;
    // the same triangle from the same side twice (two thin sheets pressed together) is drawn once
    const k = a <= b && a <= c ? `${a},${b},${c}` : b <= c ? `${b},${c},${a}` : `${c},${a},${b}`;
    if (seen.has(k)) continue;
    seen.add(k);
    kept.push(a, b, c);
  }
  return { of, count: ids.size, kept, triangles: kept.length / 3 };
}

/** Make the mesh from clusters: average position, normal, uv and skin of each cluster that is used. */
function build(mesh, cl, name) {
  const { of, kept } = cl, n = mesh.vertexCount, v = mesh.vertices;
  const used = new Int32Array(cl.count).fill(-1);
  let m = 0;
  for (const c of kept) if (used[c] < 0) used[c] = m++;
  const sum = new Float64Array(m * 8), cnt = new Uint32Array(m);          // x y z nx ny nz u v
  const skinned = Boolean(mesh.skin);
  const weights = skinned ? Array.from({ length: m }, () => new Map()) : null;
  for (let i = 0; i < n; i++) {
    const c = used[of[i]];
    if (c < 0) continue;
    const o = i * VERTEX_FLOATS, s = c * 8;
    for (let k = 0; k < 6; k++) sum[s + k] += v[o + k];
    if (mesh.uv) { sum[s + 6] += mesh.uv[i * 2]; sum[s + 7] += mesh.uv[i * 2 + 1]; }
    cnt[c]++;
    if (skinned) for (let k = 0; k < 4; k++) {
      const w = mesh.skin[i * SKIN_FLOATS + 4 + k];
      if (w > 0) { const j = mesh.skin[i * SKIN_FLOATS + k]; weights[c].set(j, (weights[c].get(j) ?? 0) + w); }
    }
  }
  const verts = new Float32Array(m * VERTEX_FLOATS), uv = mesh.uv ? new Float32Array(m * 2) : undefined;
  const joints = skinned ? new Array(m * 4).fill(0) : null, wts = skinned ? new Array(m * 4).fill(0) : null;
  for (let c = 0; c < m; c++) {
    const s = c * 8, k = 1 / cnt[c], o = c * VERTEX_FLOATS;
    verts[o] = sum[s] * k; verts[o + 1] = sum[s + 1] * k; verts[o + 2] = sum[s + 2] * k;
    const nx = sum[s + 3], ny = sum[s + 4], nz = sum[s + 5], len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (len > 1e-9) { verts[o + 3] = nx / len; verts[o + 4] = ny / len; verts[o + 5] = nz / len; } else { verts[o + 3] = 0; verts[o + 4] = 1; verts[o + 5] = 0; }
    if (uv) { uv[c * 2] = sum[s + 6] * k; uv[c * 2 + 1] = sum[s + 7] * k; }
    if (skinned) {
      const top = [...weights[c].entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, 4);
      top.forEach(([j, w], i) => { joints[c * 4 + i] = j; wts[c * 4 + i] = w; });
    }
  }
  const indices = new Uint32Array(kept.length);
  for (let i = 0; i < kept.length; i++) indices[i] = used[kept[i]];
  const label = name ?? `${mesh.name}-lod`;
  return skinned ? createSkinnedMesh(verts, indices, joints, wts, mesh.jointCount, label, uv) : createMesh(verts, indices, label, uv);
}

/**
 * Several versions of one thing, from most to least detailed, with the size on screen at which each takes over.
 * @typedef {{levels: {mesh: import('./mesh.js').Mesh, below: number}[], cullBelow: number, radius: number, center: number[], name: string}} Lod
 */

/**
 * Bundle levels of detail. `levels` run from the most detailed: each says the screen size (the height of the thing as a fraction of the height of the view,
 * 0..1) *below which* it is replaced by the next one. The last level is used all the way down to `cullBelow`, under which nothing is drawn. Or give `ratios` and a
 * mesh and the levels are made for you with `simplifyMesh`.
 *
 * ```js
 * const tree = createLod({ mesh: highTree, ratios: [0.35, 0.12], screens: [0.25, 0.08], cullBelow: 0.01 });
 * // levels: highTree while taller than a quarter of the screen, 35% of its triangles from 25% down to 8%, 12% below that, nothing under 1%
 * list.addLod(tree, model);
 * ```
 * @param {{mesh?: import('./mesh.js').Mesh, ratios?: number[], screens?: number[], levels?: {mesh: import('./mesh.js').Mesh, below?: number}[], cullBelow?: number, name?: string}} o
 * @returns {Lod}
 */
export function createLod({ mesh, ratios, screens, levels, cullBelow = 0, name } = {}) {
  let list;
  if (levels) list = levels.map((l) => ({ mesh: l.mesh, below: l.below ?? 0 }));
  else {
    if (!mesh || !ratios?.length) throw new Error('createLod needs `levels`, or a `mesh` and `ratios` for the coarser versions');
    if (!screens || screens.length !== ratios.length) throw new Error(`createLod needs one screen size for each of the ${ratios.length} coarser levels`);
    list = [{ mesh, below: screens[0] }];
    ratios.forEach((r, i) => list.push({ mesh: simplifyMesh(mesh, { ratio: r, name: `${mesh.name}-lod${i + 1}` }), below: i + 1 < screens.length ? screens[i + 1] : 0 }));
  }
  if (!list.length || list.some((l) => !l.mesh)) throw new Error('every level of detail needs a mesh');
  for (let i = 0; i + 1 < list.length; i++) if (!(list[i].below > list[i + 1].below)) throw new Error(`level ${i} switches at ${list[i].below} but the next at ${list[i + 1].below}: sizes must get smaller as the levels get coarser`);
  const m = list[0].mesh;
  const center = [(m.min[0] + m.max[0]) / 2, (m.min[1] + m.max[1]) / 2, (m.min[2] + m.max[2]) / 2];
  const radius = Math.sqrt((m.max[0] - m.min[0]) ** 2 + (m.max[1] - m.min[1]) ** 2 + (m.max[2] - m.min[2]) ** 2) / 2;
  return { levels: list, cullBelow, radius, center, name: name ?? `${m.name}-lod` };
}

/**
 * Which level of a `Lod` to draw at a given screen size (the thing's height as a fraction of the view's), or -1 for none. `bias` above 1 prefers coarser levels
 * (it scales the size down), below 1 finer ones.
 * @param {Lod} lod @param {number} size @param {number} [bias]
 */
export function lodLevel(lod, size, bias = 1) {
  const s = size / bias;
  if (s < lod.cullBelow) return -1;
  const last = lod.levels.length - 1;
  let i = 0;
  while (i < last && s < lod.levels[i].below) i++;
  return i;
}
