import { mat4 } from '../../math/src/index.js';
import { createMesh, createSkinnedMesh, computeNormals, VERTEX_FLOATS } from './mesh.js';
import { Skeleton, AnimationClip } from './skeleton.js';
import { MorphTargets, MorphClip } from './morph.js';
import { decodeMeshoptBufferView } from './meshopt.js';

/**
 * glTF 2.0 and GLB loading: triangle meshes with positions, optional normals and indices, a base colour per material, the
 * node hierarchy (transforms), and skeletal animation (skins with joint weights, and translation/rotation/scale clips for the
 * joints). Right-handed, +y up, the same conventions as the engine.
 *
 * Materials: every material is read in full, the way glTF describes a surface: base colour, metallic and roughness, and the five kinds of picture
 * (base colour, metallic-roughness, normal, occlusion, emissive), with the factors that multiply them, the alpha mode (opaque, cut-out or blended) and
 * `KHR_materials_emissive_strength`. `loadGltfTextures` decodes the images into a `TextureSet`, `loadGltfMaterials` turns the materials into a `MaterialSet`,
 * and `addGltfToDrawList` then draws with physically based lighting; without those two calls a model is drawn as before, with its base colour and base
 * colour picture under the simple lighting. Texture coordinates (`TEXCOORD_0`) are read. Not supported (reported in `warnings`, or thrown when the file
 * cannot be read at all): a second set of coordinates, texture transforms and samplers (images always repeat and are filtered), double-sided surfaces
 * (drawn single-sided), sorting of blended surfaces, animations of plain nodes (only skin joints and morph weights animate), cameras and lights;
 * cubic-spline animation is read as linear; Draco compression throws. Sparse accessors are read. **Morph targets** (blend shapes: positions and normals, with the starting weights
 * and names) are read onto each instance's `morph`; `createGltfMorph(instance)` turns them into a `MorphTargets` you set weights on, and `model.morphClips` holds the file's weight animations.
 *
 * Compressed models are read: `EXT_meshopt_compression` (what `gltfpack` writes; see `meshopt.js`, no WebAssembly needed) and `KHR_mesh_quantization` (positions, normals and
 * coordinates stored as 8 or 16-bit numbers, which is only a matter of reading them as they are, and of the node's scale putting positions back).
 *
 * @typedef {Object} GltfInstance
 * @property {import('./mesh.js').Mesh} mesh
 * @property {Float32Array} matrix World matrix of the node that carries the mesh (column-major).
 * @property {number[]} color Base colour factor RGBA.
 * @property {string} name
 * @property {number} [image] Index into `images` of the base colour texture, if the material has one
 * @property {number} [material] Index into `materials` of the instance's material, when the primitive has one
 * @property {boolean} [textured] Whether the mesh has texture coordinates (without them the material's pictures cannot be used)
 * @property {number} [skin] Index into `skins` for a skinned mesh (its `matrix` is the identity: glTF ignores the node's transform for skins)
 * @property {number} [node] Index of the glTF node that carries the mesh (it matches `morphClips[].node`)
 * @property {{targets: import('./morph.js').MorphTarget[], weights: number[]}} [morph] The morph targets of the mesh and their starting weights; `createGltfMorph(instance)` makes them usable
 *
 * @typedef {Object} GltfMaterial A material as the file describes it (see `loadGltfMaterials` to make it drawable)
 * @property {string} name
 * @property {number[]} baseColor RGBA factor (linear)
 * @property {number} metallic Factor (glTF's default is 1)
 * @property {number} roughness Factor (glTF's default is 1)
 * @property {number} normalScale
 * @property {number} occlusionStrength
 * @property {number[]} emissive RGB (already multiplied by `KHR_materials_emissive_strength`)
 * @property {'OPAQUE' | 'MASK' | 'BLEND'} alphaMode
 * @property {number} alphaCutoff For `MASK`
 * @property {{base?: number, metallicRoughness?: number, normal?: number, occlusion?: number, emissive?: number}} images Indices into `images`, for the pictures the material uses
 *
 * @typedef {Object} GltfImage
 * @property {string} name
 * @property {string} mimeType e.g. image/png
 * @property {Uint8Array | null} bytes The encoded file (PNG, JPEG...), or null when it is a separate file `uri` still to be fetched (`loadGltf` does that)
 * @property {string | null} uri
 *
 * @typedef {Object} GltfSkin
 * @property {string} name
 * @property {import('./skeleton.js').Skeleton} skeleton
 * @property {import('./skeleton.js').AnimationClip[]} clips The file's animations, as far as they drive this skin's joints
 *
 * @typedef {Object} GltfResult
 * @property {import('./mesh.js').Mesh[]} meshes One per primitive
 * @property {GltfInstance[]} instances What to draw to see the scene
 * @property {GltfSkin[]} skins
 * @property {GltfMaterial[]} materials
 * @property {{name: string, node: number, clip: import('./morph.js').MorphClip}[]} morphClips The file's animations of morph weights, with the glTF node they drive
 * @property {GltfImage[]} images Images referred to by materials (decode them with `loadGltfTextures`)
 * @property {string[]} warnings Things in the file that were ignored
 */

const GLB_MAGIC = 0x46546c67, CHUNK_JSON = 0x4e4f534a, CHUNK_BIN = 0x004e4942;
const COMPONENT = { 5120: [1, Int8Array, 'getInt8'], 5121: [1, Uint8Array, 'getUint8'], 5122: [2, Int16Array, 'getInt16'], 5123: [2, Uint16Array, 'getUint16'], 5125: [4, Uint32Array, 'getUint32'], 5126: [4, Float32Array, 'getFloat32'] };
const TYPE_SIZE = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };

/** Decode base64 without relying on atob or Buffer. */
function decodeBase64(text) {
  const table = new Uint8Array(256).fill(255);
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  for (let i = 0; i < 64; i++) table[chars.charCodeAt(i)] = i;
  const clean = text.replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0, bits = 0, acc = 0;
  for (let i = 0; i < clean.length; i++) {
    acc = (acc << 6) | table[clean.charCodeAt(i)];
    bits += 6;
    if (bits >= 8) { bits -= 8; out[o++] = (acc >> bits) & 255; }
  }
  return out.buffer.slice(0, o);
}

/** Split a GLB into its JSON and binary chunk. */
function readGlb(buffer) {
  const view = new DataView(buffer);
  if (buffer.byteLength < 20 || view.getUint32(0, true) !== GLB_MAGIC) throw new Error('not a GLB file (bad magic)');
  if (view.getUint32(4, true) !== 2) throw new Error(`unsupported GLB version ${view.getUint32(4, true)} (need 2)`);
  const total = Math.min(view.getUint32(8, true), buffer.byteLength);
  let json = null, bin = null, offset = 12;
  while (offset + 8 <= total) {
    const length = view.getUint32(offset, true), type = view.getUint32(offset + 4, true);
    const start = offset + 8;
    if (start + length > buffer.byteLength) throw new Error('truncated GLB chunk');
    if (type === CHUNK_JSON) json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, start, length)));
    else if (type === CHUNK_BIN && bin === null) bin = buffer.slice(start, start + length);
    offset = start + length + ((4 - (length % 4)) % 4);
  }
  if (!json) throw new Error('GLB has no JSON chunk');
  return { json, bin };
}

/** Read an accessor into a flat typed array (floats for normalised integers), honouring byte strides. */
function readAccessor(json, buffers, index, asFloat) {
  const acc = json.accessors?.[index];
  if (!acc) throw new Error(`accessor ${index} does not exist`);
  const comp = COMPONENT[acc.componentType];
  if (!comp) throw new Error(`unknown accessor component type ${acc.componentType}`);
  const n = TYPE_SIZE[acc.type];
  if (!n) throw new Error(`unknown accessor type ${acc.type}`);
  const out = asFloat || acc.componentType === 5126 ? new Float32Array(acc.count * n) : new comp[1](acc.count * n);
  if (acc.bufferView === undefined) { if (acc.sparse) applySparse(json, buffers, acc, out, comp, n, asFloat); return out; } // zeros by definition, then the sparse changes
  const bv = json.bufferViews?.[acc.bufferView];
  if (!bv) throw new Error(`bufferView ${acc.bufferView} does not exist`);
  const buf = buffers[bv.buffer];
  if (!buf) throw new Error(`buffer ${bv.buffer} is missing`);
  const stride = bv.byteStride || comp[0] * n;
  const base = (bv.byteOffset || 0) + (acc.byteOffset || 0);
  if (base + stride * (acc.count - 1) + comp[0] * n > buf.byteLength) throw new Error(`accessor ${index} reads past the end of its buffer`);
  const view = new DataView(buf);
  const norm = acc.normalized && asFloat;
  const max = { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535, 5125: 4294967295 }[acc.componentType];
  for (let i = 0; i < acc.count; i++) {
    for (let k = 0; k < n; k++) {
      let v = view[comp[2]](base + i * stride + k * comp[0], true);
      if (norm && acc.componentType !== 5126) v = Math.max(v / max, -1);
      out[i * n + k] = v;
    }
  }
  if (acc.sparse) applySparse(json, buffers, acc, out, comp, n, asFloat);
  return out;
}

/** Sparse accessors store only the values that differ from the base (zeros, or the bufferView's data): the indices of the changed elements and their new values. */
function applySparse(json, buffers, acc, out, comp, n, asFloat) {
  const { count, indices, values } = acc.sparse;
  if (!indices || !values || !(count >= 0)) throw new Error('sparse accessor: it needs a count, indices and values');
  const view = (info, what) => {
    const bv = json.bufferViews?.[info.bufferView], buf = bv && buffers[bv.buffer];
    if (!bv || !buf) throw new Error(`sparse accessor: its ${what} bufferView does not exist`);
    return { dv: new DataView(buf), at: (bv.byteOffset || 0) + (info.byteOffset || 0) };
  };
  const idx = view(indices, 'indices'), val = view(values, 'values');
  const iComp = COMPONENT[indices.componentType];
  if (!iComp) throw new Error(`sparse accessor: unknown index type ${indices.componentType}`);
  if (idx.at + count * iComp[0] > idx.dv.byteLength || val.at + count * n * comp[0] > val.dv.byteLength) throw new Error('sparse accessor reads past the end of its buffer');
  const norm = acc.normalized && asFloat, max = { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535, 5125: 4294967295 }[acc.componentType];
  for (let s = 0; s < count; s++) {
    const target = idx.dv[iComp[2]](idx.at + s * iComp[0], true);
    if (target >= acc.count) throw new Error('sparse accessor: an index points past the last element');
    for (let k = 0; k < n; k++) {
      let v = val.dv[comp[2]](val.at + (s * n + k) * comp[0], true);
      if (norm && acc.componentType !== 5126) v = Math.max(v / max, -1);
      out[target * n + k] = v;
    }
  }
}

const IDENTITY = new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

/** Split a column-major matrix into translation, rotation (quaternion) and scale. */
function decompose(m) {
  const sx0 = Math.hypot(m[0], m[1], m[2]), sy = Math.hypot(m[4], m[5], m[6]), sz = Math.hypot(m[8], m[9], m[10]);
  const det = m[0] * (m[5] * m[10] - m[6] * m[9]) - m[4] * (m[1] * m[10] - m[2] * m[9]) + m[8] * (m[1] * m[6] - m[2] * m[5]);
  const sx = det < 0 ? -sx0 : sx0;
  const a = [m[0] / sx, m[1] / sx, m[2] / sx], b = [m[4] / sy, m[5] / sy, m[6] / sy], c = [m[8] / sz, m[9] / sz, m[10] / sz];
  const trace = a[0] + b[1] + c[2];
  let q;
  if (trace > 0) { const s = Math.sqrt(trace + 1) * 2; q = [(b[2] - c[1]) / s, (c[0] - a[2]) / s, (a[1] - b[0]) / s, s / 4]; }
  else if (a[0] > b[1] && a[0] > c[2]) { const s = Math.sqrt(1 + a[0] - b[1] - c[2]) * 2; q = [s / 4, (b[0] + a[1]) / s, (c[0] + a[2]) / s, (b[2] - c[1]) / s]; }
  else if (b[1] > c[2]) { const s = Math.sqrt(1 + b[1] - a[0] - c[2]) * 2; q = [(b[0] + a[1]) / s, s / 4, (c[1] + b[2]) / s, (c[0] - a[2]) / s]; }
  else { const s = Math.sqrt(1 + c[2] - a[0] - b[1]) * 2; q = [(c[0] + a[2]) / s, (c[1] + b[2]) / s, s / 4, (a[1] - b[0]) / s]; }
  return { t: [m[12], m[13], m[14]], r: q, s: [sx, sy, sz] };
}

/** A node's local transform as translation, rotation and scale. */
function nodeTrs(node) {
  if (node.matrix) return decompose(node.matrix);
  return { t: node.translation ?? [0, 0, 0], r: node.rotation ?? [0, 0, 0, 1], s: node.scale ?? [1, 1, 1] };
}

const SUPPORTED_EXTENSIONS = new Set(['KHR_mesh_quantization', 'EXT_meshopt_compression', 'KHR_materials_emissive_strength']);

/**
 * Decompress the buffer views that `EXT_meshopt_compression` compressed. Each decoded view is added to `buffers` as a buffer of its own and the returned document points the view at it
 * (so everything after reads plain data). A document with nothing compressed is returned as it is.
 */
function withDecompressedViews(json, buffers) {
  if (!json.bufferViews?.some((bv) => bv.extensions?.EXT_meshopt_compression)) return json;
  const views = json.bufferViews.map((bv, i) => {
    const ext = bv.extensions?.EXT_meshopt_compression;
    if (!ext) return bv;
    const source = buffers[ext.buffer];
    if (!source) throw new Error(`bufferView ${i}: the compressed data's buffer ${ext.buffer} is missing`);
    const start = ext.byteOffset ?? 0;
    if (start + ext.byteLength > source.byteLength) throw new Error(`bufferView ${i}: the compressed data runs past the end of its buffer`);
    let decoded;
    try { decoded = decodeMeshoptBufferView(ext, new Uint8Array(source, start, ext.byteLength)); } catch (e) { throw new Error(`bufferView ${i}: ${e.message}`); }
    buffers.push(decoded.buffer);
    const { extensions, ...rest } = bv;
    void extensions;
    return { ...rest, buffer: buffers.length - 1, byteOffset: 0, byteLength: decoded.length, byteStride: ext.mode === 'ATTRIBUTES' ? ext.byteStride : undefined };
  });
  return { ...json, bufferViews: views };
}

/**
 * Parse a glTF or GLB.
 * @param {ArrayBuffer | string | object} input A GLB (ArrayBuffer), glTF JSON text, or an already parsed glTF object.
 * @param {object} [o]
 * @param {Record<string, ArrayBuffer>} [o.buffers] External `.bin` files by their `uri` (data: URIs are decoded automatically).
 * @returns {GltfResult}
 */
export function parseGltf(input, { buffers: external = {} } = {}) {
  let json, bin = null;
  if (input instanceof ArrayBuffer) ({ json, bin } = readGlb(input));
  else if (ArrayBuffer.isView(input)) ({ json, bin } = readGlb(input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength)));
  else json = typeof input === 'string' ? JSON.parse(input) : input;
  if (!json?.asset?.version?.startsWith('2')) throw new Error('not a glTF 2.0 document');
  const warnings = [];
  for (const ext of json.extensionsRequired ?? []) {
    if (ext === 'KHR_draco_mesh_compression') throw new Error('this model requires KHR_draco_mesh_compression (Draco), which needs a WebAssembly decoder this engine does not include; re-export it without Draco, or with meshopt compression (gltfpack)');
    if (!SUPPORTED_EXTENSIONS.has(ext)) throw new Error(`required glTF extension "${ext}" is not supported`);
  }
  const materials = (json.materials ?? []).map((m, mi) => describeMaterial(json, m, mi, warnings));

  const buffers = (json.buffers ?? []).map((b, i) => {
    if (b.uri === undefined) {
      if (i === 0 && bin) return bin;
      if (b.extensions?.EXT_meshopt_compression?.fallback) return new ArrayBuffer(0);   // a stand-in for readers that cannot decompress: the compressed views replace it
      throw new Error(`buffer ${i} has no data`);
    }
    if (b.uri.startsWith('data:')) return decodeBase64(b.uri.slice(b.uri.indexOf(',') + 1));
    if (external[b.uri]) return external[b.uri];
    throw new Error(`buffer "${b.uri}" was not provided`);
  });

  json = withDecompressedViews(json, buffers);

  // one Mesh per primitive
  const primitives = (json.meshes ?? []).map((m, mi) => (m.primitives ?? []).map((p, pi) => {
    if ((p.mode ?? 4) !== 4) { warnings.push(`mesh ${mi} primitive ${pi}: only triangle lists are supported (mode ${p.mode}), skipped`); return null; }
    if (p.attributes?.POSITION === undefined) throw new Error(`mesh ${mi} primitive ${pi} has no POSITION`);
    const pos = readAccessor(json, buffers, p.attributes.POSITION, true);
    const count = pos.length / 3;
    let indices;
    if (p.indices !== undefined) indices = Uint32Array.from(readAccessor(json, buffers, p.indices, false));
    else indices = Uint32Array.from({ length: count }, (_, i) => i);
    for (const i of indices) if (i >= count) throw new Error(`mesh ${mi} primitive ${pi}: an index (${i}) points past the last vertex`);
    const nor = p.attributes.NORMAL !== undefined ? readAccessor(json, buffers, p.attributes.NORMAL, true) : computeNormals(pos, indices);
    const v = new Float32Array(count * VERTEX_FLOATS);
    for (let i = 0; i < count; i++) { v.set(pos.subarray(i * 3, i * 3 + 3), i * VERTEX_FLOATS); v.set(nor.subarray(i * 3, i * 3 + 3), i * VERTEX_FLOATS + 3); }
    const mat = json.materials?.[p.material]?.pbrMetallicRoughness;
    let uv;
    if (p.attributes.TEXCOORD_0 !== undefined) {
      uv = readAccessor(json, buffers, p.attributes.TEXCOORD_0, true);
      if (uv.length !== count * 2) throw new Error(`mesh ${mi} primitive ${pi}: TEXCOORD_0 needs two values for each of the ${count} vertices`);
    }
    let morph;
    if (p.targets?.length) {
      const targets = p.targets.map((t, ti) => {
        const position = t.POSITION !== undefined ? readAccessor(json, buffers, t.POSITION, true) : new Float32Array(count * 3);
        const normal = t.NORMAL !== undefined ? readAccessor(json, buffers, t.NORMAL, true) : null;
        if (position.length !== count * 3 || (normal && normal.length !== count * 3)) throw new Error(`mesh ${mi} primitive ${pi}: morph target ${ti} needs offsets for each of the ${count} vertices`);
        return { position, normal, name: m.extras?.targetNames?.[ti] ?? `target${ti}` };
      });
      morph = { targets, weights: Array.from(m.weights ?? []) };
    }
    let image;
    if (mat?.baseColorTexture) {
      if ((mat.baseColorTexture.texCoord ?? 0) !== 0) warnings.push(`mesh ${mi} primitive ${pi}: only the first set of texture coordinates is used`);
      else if (uv) image = json.textures?.[mat.baseColorTexture.index]?.source;
      else warnings.push(`mesh ${mi} primitive ${pi}: has a texture but no TEXCOORD_0; drawn with its colour only`);
    }
    const name = m.name ? `${m.name}${m.primitives.length > 1 ? `#${pi}` : ''}` : `mesh${mi}#${pi}`;
    const skinData = p.attributes.JOINTS_0 !== undefined && p.attributes.WEIGHTS_0 !== undefined
      ? { joints: readAccessor(json, buffers, p.attributes.JOINTS_0, false), weights: readAccessor(json, buffers, p.attributes.WEIGHTS_0, true), cache: new Map() } : null;
    if (skinData && (skinData.joints.length !== count * 4 || skinData.weights.length !== count * 4)) throw new Error(`mesh ${mi} primitive ${pi}: JOINTS_0 and WEIGHTS_0 need four values for each of the ${count} vertices`);
    return { morph, mesh: createMesh(v, indices, name, uv), color: mat?.baseColorFactor ?? [1, 1, 1, 1], skinData, name, image, material: json.materials?.[p.material] ? p.material : undefined, textured: !!uv };
  }).filter(Boolean));

  // skeletons: one per glTF skin, with the file's animations cut down to the joints of that skin
  const nodes = json.nodes ?? [];
  const parentOf = new Array(nodes.length).fill(-1);
  nodes.forEach((n, i) => { for (const c of n.children ?? []) if (nodes[c]) parentOf[c] = i; });
  const worldOfNode = (i) => { // transform of a node in the scene (product of the chain above it)
    const chain = [];
    for (let k = i, guard = 0; k >= 0; k = parentOf[k]) { if (++guard > 64) throw new Error('node hierarchy is too deep (a cycle?)'); chain.push(k); }
    const m = new Float64Array(IDENTITY), local = new Float64Array(16), tmp = new Float64Array(16);
    for (let k = chain.length - 1; k >= 0; k--) {
      const { t, r, s } = nodeTrs(nodes[chain[k]]);
      mat4.compose(local, t[0], t[1], t[2], r, s[0], s[1], s[2]);
      mat4.multiply(tmp, m, local);
      m.set(tmp);
    }
    return m;
  };
  const skins = (json.skins ?? []).map((sk, si) => {
    const jointNodes = sk.joints ?? [];
    if (jointNodes.length === 0) throw new Error(`skin ${si} has no joints`);
    const jointIndex = new Map(jointNodes.map((n, k) => [n, k]));
    let rootMatrix = null;
    const joints = jointNodes.map((n, k) => {
      if (!nodes[n]) throw new Error(`skin ${si}: joint node ${n} does not exist`);
      let p = parentOf[n];
      while (p >= 0 && !jointIndex.has(p)) p = parentOf[p];
      if (p < 0) { // a root joint: whatever sits above it in the scene is the skeleton's root transform
        const above = parentOf[n] >= 0 ? worldOfNode(parentOf[n]) : IDENTITY;
        if (!rootMatrix) rootMatrix = above;
        else if (above.some((v, i) => Math.abs(v - rootMatrix[i]) > 1e-6)) warnings.push(`skin ${si}: root joints hang from different transforms; the first is used`);
      }
      return { name: nodes[n].name ?? `joint${k}`, parent: p >= 0 ? jointIndex.get(p) : -1, ...nodeTrs(nodes[n]) };
    });
    const ibm = sk.inverseBindMatrices !== undefined ? readAccessor(json, buffers, sk.inverseBindMatrices, true) : null;
    const skeleton = new Skeleton(joints, { inverseBind: ibm ?? undefined, rootMatrix: rootMatrix ?? IDENTITY });
    if (!ibm) { skeleton.inverseBind.fill(0); for (let k = 0; k < jointNodes.length; k++) skeleton.inverseBind.set(IDENTITY, k * 16); } // glTF: missing means identity, not "invert the rest pose"
    const clips = [];
    for (const [ai, a] of (json.animations ?? []).entries()) {
      const tracks = [];
      for (const ch of a.channels ?? []) {
        const joint = jointIndex.get(ch.target?.node);
        const path = { translation: 't', rotation: 'r', scale: 's' }[ch.target?.path];
        if (joint === undefined || !path) continue;
        const sampler = a.samplers?.[ch.sampler];
        if (!sampler) throw new Error(`animation ${ai}: channel refers to a sampler that does not exist`);
        const times = readAccessor(json, buffers, sampler.input, true);
        let values = readAccessor(json, buffers, sampler.output, true);
        const size = path === 'r' ? 4 : 3;
        if (sampler.interpolation === 'CUBICSPLINE') { // each key is in-tangent, value, out-tangent: keep the values and play them linearly
          const keep = new Float32Array(times.length * size);
          for (let k = 0; k < times.length; k++) keep.set(values.subarray(k * size * 3 + size, k * size * 3 + size * 2), k * size);
          values = keep;
          if (!warnings.some((w) => w.includes('cubic'))) warnings.push('cubic-spline animation is played as linear');
        }
        tracks.push({ joint, path, times, values, step: sampler.interpolation === 'STEP' });
      }
      if (tracks.length > 0) clips.push(new AnimationClip(a.name ?? `animation${ai}`, tracks));
    }
    return { name: sk.name ?? `skin${si}`, skeleton, clips, bindPalette: null };
  });
  for (const [ai, a] of (json.animations ?? []).entries()) {
    const jointSet = new Set(skins.flatMap((_, si) => json.skins[si].joints));
    if ((a.channels ?? []).some((ch) => ch.target?.path !== 'weights' && !jointSet.has(ch.target?.node))) {
      const msg = `animation ${ai}: channels that drive plain nodes are ignored (only skin joints and morph weights animate)`;
      if (!warnings.includes(msg)) warnings.push(msg);
    }
  }
  const skinnedCache = new Map();
  const skinnedMesh = (prim, si) => {
    const key = prim.mesh.name + '|' + si;
    let m = skinnedCache.get(key);
    if (!m) {
      const sd = prim.skinData;
      m = createSkinnedMesh(prim.mesh.vertices, prim.mesh.indices, sd.joints, sd.weights, skins[si].skeleton.count, prim.name, prim.mesh.uv);
      skinnedCache.set(key, m);
    }
    return m;
  };

  const morphOf = (p, node) => (p.morph ? { morph: { targets: p.morph.targets, weights: Array.from(node.weights ?? p.morph.weights) } } : {});
  const instances = [];
  const visit = (nodeIndex, parent, depth) => {
    if (depth > 64) throw new Error('node hierarchy is too deep (a cycle?)');
    const node = json.nodes?.[nodeIndex];
    if (!node) throw new Error(`node ${nodeIndex} does not exist`);
    const local = new Float64Array(16);
    if (node.matrix) for (let i = 0; i < 16; i++) local[i] = node.matrix[i];
    else {
      const t = node.translation ?? [0, 0, 0], r = node.rotation ?? [0, 0, 0, 1], s = node.scale ?? [1, 1, 1];
      mat4.compose(local, t[0], t[1], t[2], r, s[0], s[1], s[2]);
    }
    const world = new Float64Array(16);
    mat4.multiply(world, parent, local);
    if (node.mesh !== undefined) {
      for (const p of primitives[node.mesh] ?? []) {
        if (node.skin !== undefined && p.skinData) {
          if (!skins[node.skin]) throw new Error(`node ${nodeIndex}: skin ${node.skin} does not exist`);
          instances.push({ mesh: skinnedMesh(p, node.skin), skin: node.skin, image: p.image, material: p.material, textured: p.textured, matrix: Float32Array.from(IDENTITY), color: p.color, name: node.name ?? p.mesh.name, node: nodeIndex, ...morphOf(p, node) });
        } else {
          if (node.skin !== undefined) warnings.push(`node ${nodeIndex}: has a skin but the mesh has no JOINTS_0/WEIGHTS_0; drawn unskinned`);
          instances.push({ mesh: p.mesh, image: p.image, material: p.material, textured: p.textured, matrix: Float32Array.from(world), color: p.color, name: node.name ?? p.mesh.name, node: nodeIndex, ...morphOf(p, node) });
        }
      }
    }
    for (const child of node.children ?? []) visit(child, world, depth + 1);
  };
  const scene = json.scenes?.[json.scene ?? 0];
  if (scene) for (const n of scene.nodes ?? []) visit(n, IDENTITY, 0);
  else for (const [i, ps] of primitives.entries()) for (const p of ps) instances.push({ mesh: p.mesh, material: p.material, textured: p.textured, matrix: Float32Array.from(IDENTITY), color: p.color, name: `mesh${i}` }); // no scene: show every mesh
  const images = (json.images ?? []).map((im, ii) => {
    let bytes = null, uri = null;
    if (im.bufferView !== undefined) {
      const bv = json.bufferViews?.[im.bufferView], buf = bv && buffers[bv.buffer];
      if (!bv || !buf) throw new Error(`image ${ii}: its bufferView does not exist`);
      if ((bv.byteOffset || 0) + bv.byteLength > buf.byteLength) throw new Error(`image ${ii} reads past the end of its buffer`);
      bytes = new Uint8Array(buf, bv.byteOffset || 0, bv.byteLength);
    } else if (typeof im.uri === 'string' && im.uri.startsWith('data:')) bytes = new Uint8Array(decodeBase64(im.uri.slice(im.uri.indexOf(',') + 1)));
    else if (typeof im.uri === 'string') { if (external[im.uri]) bytes = new Uint8Array(external[im.uri]); else uri = im.uri; }
    return { name: im.name ?? `image${ii}`, mimeType: im.mimeType ?? (im.uri?.startsWith('data:') ? im.uri.slice(5, im.uri.indexOf(';')) : 'image/png'), bytes, uri };
  });
  for (const inst of instances) if (inst.image !== undefined && !images[inst.image]) throw new Error(`a material refers to image ${inst.image}, which does not exist`);
  for (const m of materials) for (const i of Object.values(m.images)) if (!images[i]) throw new Error(`material "${m.name}" refers to image ${i}, which does not exist`);
  // animations of morph weights
  const morphClips = [];
  for (const [ai, a] of (json.animations ?? []).entries()) {
    for (const ch of a.channels ?? []) {
      if (ch.target?.path !== 'weights') continue;
      const sampler = a.samplers?.[ch.sampler], nodeIndex = ch.target.node;
      const meshIndex = json.nodes?.[nodeIndex]?.mesh;
      const count = json.meshes?.[meshIndex]?.primitives?.find((q) => q.targets?.length)?.targets.length;
      if (!sampler || !count) { warnings.push(`animation ${ai}: a weights channel for a node with no morph targets is ignored`); continue; }
      const times = readAccessor(json, buffers, sampler.input, true);
      let values = readAccessor(json, buffers, sampler.output, true);
      if (sampler.interpolation === 'CUBICSPLINE') {                      // in-tangents, values, out-tangents: keep the values
        const keep = new Float32Array(times.length * count);
        for (let k = 0; k < times.length; k++) keep.set(values.subarray(k * count * 3 + count, k * count * 3 + count * 2), k * count);
        values = keep;
        if (!warnings.some((w) => w.includes('cubic'))) warnings.push('cubic-spline animation is played as linear');
      }
      morphClips.push({ name: a.name ?? `animation${ai}`, node: nodeIndex, clip: new MorphClip(a.name ?? `animation${ai}`, count, times, values, { step: sampler.interpolation === 'STEP' }) });
    }
  }
  return { meshes: primitives.flat().map((p) => p.mesh), instances, skins, materials, images, morphClips, warnings };
}

/**
 * Read one glTF material in full. Pictures with a second set of coordinates and texture transforms are reported and ignored.
 * @returns {GltfMaterial}
 */
function describeMaterial(json, m, index, warnings) {
  const pbr = m.pbrMetallicRoughness ?? {};
  const label = `material ${index}${m.name ? ` ("${m.name}")` : ''}`;
  const picture = (info, what) => {
    if (!info) return undefined;
    if ((info.texCoord ?? 0) !== 0) { warnings.push(`${label}: the ${what} picture uses the second set of texture coordinates, which is not supported; it is left out`); return undefined; }
    if (info.extensions?.KHR_texture_transform) warnings.push(`${label}: the ${what} picture has a texture transform, which is ignored`);
    const source = json.textures?.[info.index]?.source;
    if (source === undefined) { warnings.push(`${label}: the ${what} picture points at a texture that has no image; it is left out`); return undefined; }
    return source;
  };
  const images = {};
  for (const [key, info, what] of [['base', pbr.baseColorTexture, 'base colour'], ['metallicRoughness', pbr.metallicRoughnessTexture, 'metallic-roughness'],
    ['normal', m.normalTexture, 'normal'], ['occlusion', m.occlusionTexture, 'occlusion'], ['emissive', m.emissiveTexture, 'emissive']]) {
    const source = picture(info, what);
    if (source !== undefined) images[key] = source;
  }
  const strength = m.extensions?.KHR_materials_emissive_strength?.emissiveStrength ?? 1;
  const alphaMode = m.alphaMode === 'MASK' || m.alphaMode === 'BLEND' ? m.alphaMode : 'OPAQUE';
  if (alphaMode === 'BLEND' && !warnings.some((w) => w.includes('BLEND'))) warnings.push('materials with alphaMode BLEND are blended in the order they are added, not sorted by distance');
  if (m.doubleSided && !warnings.some((w) => w.includes('double-sided'))) warnings.push('double-sided materials are drawn single-sided');
  return {
    name: m.name ?? `material${index}`,
    baseColor: pbr.baseColorFactor ?? [1, 1, 1, 1],
    metallic: pbr.metallicFactor ?? 1,
    roughness: pbr.roughnessFactor ?? 1,
    normalScale: m.normalTexture?.scale ?? 1,
    occlusionStrength: m.occlusionTexture?.strength ?? 1,
    emissive: (m.emissiveFactor ?? [0, 0, 0]).map((c) => c * strength),
    alphaMode,
    alphaCutoff: m.alphaCutoff ?? 0.5,
    images,
  };
}

/**
 * Fetch and parse a glTF or GLB, loading the external `.bin` files a `.gltf` refers to.
 * @param {string} url
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<GltfResult>}
 */
export async function loadGltf(url, fetchImpl = globalThis.fetch) {
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`could not load ${url} (${res.status})`);
  const data = await res.arrayBuffer();
  if (new DataView(data).getUint32(0, true) === GLB_MAGIC) return parseGltf(data);
  const json = JSON.parse(new TextDecoder().decode(data));
  const buffers = {};
  for (const b of json.buffers ?? []) {
    if (b.uri && !b.uri.startsWith('data:') && !buffers[b.uri]) {
      const r = await fetchImpl(new URL(b.uri, new URL(url, globalThis.location?.href ?? 'http://localhost/')).href);
      if (!r.ok) throw new Error(`could not load ${b.uri} (${r.status})`);
      buffers[b.uri] = await r.arrayBuffer();
    }
  }
  const model = parseGltf(json, { buffers });
  for (const im of model.images) { // separate image files
    if (im.uri && !im.bytes) {
      const r = await fetchImpl(new URL(im.uri, new URL(url, globalThis.location?.href ?? 'http://localhost/')).href);
      if (!r.ok) throw new Error(`could not load ${im.uri} (${r.status})`);
      im.bytes = new Uint8Array(await r.arrayBuffer());
    }
  }
  return model;
}

/** Decode an encoded image (PNG, JPEG, ...) to RGBA pixels with the browser's own decoder. */
export async function decodeImageInBrowser(bytes, mimeType) {
  const bitmap = await createImageBitmap(new Blob([bytes], { type: mimeType }), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(bitmap.width, bitmap.height) : Object.assign(document.createElement('canvas'), { width: bitmap.width, height: bitmap.height });
  const g = canvas.getContext('2d', { willReadFrequently: true });
  g.drawImage(bitmap, 0, 0);
  const img = g.getImageData(0, 0, bitmap.width, bitmap.height);
  bitmap.close?.();
  return { width: img.width, height: img.height, data: img.data };
}

/**
 * Decode the images a model uses (every kind of picture its materials refer to, and the base colour pictures of simply lit instances) and add them to a texture set
 * (resampled to its size). One image used twice is added once.
 * @param {GltfResult} model
 * @param {import('./textures.js').TextureSet} set
 * @param {(bytes: Uint8Array, mimeType: string) => Promise<import('./textures.js').ImageLike>} [decode] Default: the browser's decoder
 * @returns {Promise<Map<number, number>>} image index -> texture layer, to hand to `addGltfToDrawList`
 */
export async function loadGltfTextures(model, set, decode = decodeImageInBrowser) {
  const layers = new Map();
  const wanted = new Set();
  for (const inst of model.instances) {
    if (inst.image !== undefined) wanted.add(inst.image);
    const m = inst.material !== undefined ? model.materials[inst.material] : null;
    if (m && inst.textured !== false) for (const i of Object.values(m.images)) wanted.add(i);
  }
  for (const index of wanted) {
    if (layers.has(index)) continue;
    const im = model.images[index];
    if (!im.bytes) throw new Error(`image "${im.name}" has no data (it is the file ${im.uri}: use loadGltf, or pass it in \`buffers\`)`);
    layers.set(index, set.add(await decode(im.bytes, im.mimeType), im.name));
  }
  return layers;
}

/**
 * Turn the materials a model uses into physically based materials of a `MaterialSet` (the one you give the renderer with `setMaterials`). Pass the layers
 * `loadGltfTextures` returned so the pictures are found. A material is added once however many meshes use it.
 * @param {GltfResult} model
 * @param {Map<number, number>} textureLayers From `loadGltfTextures`
 * @param {import('./materials.js').MaterialSet} set
 * @returns {Map<number, number>} Material index (and `-1 - index` for the same material without its pictures, for meshes that have no texture coordinates) to the number in the set, to hand to `addGltfToDrawList`
 */
export function loadGltfMaterials(model, textureLayers, set) {
  const ids = new Map();
  const layer = (index) => (index === undefined ? -1 : (textureLayers.get(index) ?? -1));
  for (const inst of model.instances) {
    if (inst.material === undefined) continue;
    const plain = inst.textured === false;
    const key = plain ? -1 - inst.material : inst.material;
    if (ids.has(key)) continue;
    const m = model.materials[inst.material];
    ids.set(key, set.add({
      name: m.name,
      baseColor: m.baseColor, baseColorTexture: plain ? -1 : layer(m.images.base),
      metallic: m.metallic, roughness: m.roughness, metallicRoughnessTexture: plain ? -1 : layer(m.images.metallicRoughness),
      normalTexture: plain ? -1 : layer(m.images.normal), normalScale: m.normalScale,
      occlusionTexture: plain ? -1 : layer(m.images.occlusion), occlusionStrength: m.occlusionStrength,
      emissive: m.emissive, emissiveTexture: plain ? -1 : layer(m.images.emissive),
      alphaCutoff: m.alphaMode === 'MASK' ? Math.max(m.alphaCutoff, 0.001) : 0, opaque: m.alphaMode === 'OPAQUE',
    }));
  }
  return ids;
}

/**
 * Add everything a loaded model draws to a DrawList3D. Skinned meshes are drawn in their bind pose unless you pass palettes.
 * @param {import('./drawlist.js').DrawList3D} list
 * @param {GltfResult} model
 * @param {ArrayLike<number>} [transform] Placement of the whole model (column-major 4x4)
 * @param {Record<number, Float32Array>} [palettes] Skinning matrices per skin index (from `skeleton.computePalette(pose)`)
 * @param {Map<number, number>} [textureLayers] From `loadGltfTextures`: which layer holds each image; instances whose image is not in it are drawn without a texture
 * @param {Map<GltfInstance, import('./mesh.js').Mesh>} [meshes] A mesh to draw in place of an instance's own, for morphed models: `new Map([[instance, morph.mesh]])`
 * @param {Map<number, number>} [materialIds] From `loadGltfMaterials`: instances whose material is in it are drawn with physically based lighting (the renderer needs the same set, `renderer.setMaterials`)
 */
export function addGltfToDrawList(list, model, transform = IDENTITY, palettes = {}, textureLayers = new Map(), materialIds = new Map(), meshes = new Map()) {
  const m = new Float64Array(16);
  for (const inst of model.instances) {
    const surface = inst.material === undefined ? undefined : materialIds.get(inst.textured === false ? -1 - inst.material : inst.material);
    const layer = inst.image === undefined ? undefined : textureLayers.get(inst.image);
    if (surface !== undefined) { list.setMaterial(null); list.setSurface(surface); } else {
      list.setSurface(0);
      if (layer === undefined) list.setMaterial(null); else list.setMaterial(layer, 'uv', 1);
    }
    const c = surface === undefined ? inst.color : [1, 1, 1, 1];            // a physically based material carries the base colour factor itself
    if (inst.skin !== undefined) {
      const skin = model.skins[inst.skin];
      skin.bindPalette ??= skin.skeleton.computePalette(skin.skeleton.createPose().setRest(skin.skeleton));
      list.addSkinned(meshes.get(inst) ?? inst.mesh, transform, palettes[inst.skin] ?? skin.bindPalette, c[0], c[1], c[2], c[3]);
      continue;
    }
    mat4.multiply(m, transform, inst.matrix);
    list.add(meshes.get(inst) ?? inst.mesh, m, c[0], c[1], c[2], c[3]);
  }
  list.setMaterial(null);
  list.setSurface(0);
}

/**
 * Make the morph targets of a loaded instance usable: a `MorphTargets` with a mesh of its own (draw `morph.mesh`, for example through the `meshes` map of `addGltfToDrawList`),
 * starting at the weights the file gives. Make one per character so each can have its own expression.
 * @param {GltfInstance} instance An entry of `model.instances` that has a `morph`
 * @returns {MorphTargets}
 */
export function createGltfMorph(instance) {
  if (!instance.morph) throw new Error(`the instance "${instance.name}" has no morph targets`);
  return new MorphTargets(instance.mesh, instance.morph.targets, { weights: instance.morph.weights });
}
