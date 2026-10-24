/**
 * Physically based materials for the 3D renderers: a `MaterialSet` holds up to 127 of them, and an instance picks one by its number
 * (`DrawList3D.setSurface`). A material says how a surface looks under light the way glTF does:
 *
 * - a **base colour** (the colour of the surface itself, or of its metal) with an optional picture,
 * - how **metallic** and how **rough** it is (a mirror-smooth metal and a rough plastic look nothing alike), with an optional picture whose
 *   green is the roughness and blue the metalness,
 * - a **normal map** (tiny bumps that only catch the light), an **occlusion map** (darkens creases), and an **emissive** colour with an
 *   optional picture (it glows, whatever the light does).
 *
 * The pictures are layers of a `TextureSet` (pass the layer numbers `TextureSet.add` gave); a layer of -1 means "none". The set is plain
 * data, so it works in Node as well as in the browser; a renderer uploads it when you give it with `renderer.setMaterials(set)`, and
 * again whenever it changes.
 */

import { environmentIrradiance, sampleEnvironment, rotateForEnvironment } from './environment.js';

/** The most materials a set can hold (numbers 1 to 127; 0 means "no material": the simple lighting). */
export const MAX_MATERIALS = 127;
/** Floats per material in the packed table the renderers read (five vec4s). */
export const MATERIAL_FLOATS = 20;
/** Slots in the packed table, including the unused slot 0. */
export const MATERIAL_SLOTS = MAX_MATERIALS + 1;

/**
 * @typedef {Object} MaterialSpec
 * @property {string} [name]
 * @property {number[]} [baseColor] RGBA, 0 to 1, in linear light as glTF writes it (default white). Multiplies the picture and the instance's colour.
 * @property {number} [baseColorTexture] Layer holding the base colour (sRGB, with alpha), or -1
 * @property {number} [metallic] 0 is plastic or stone, 1 is bare metal (default 0)
 * @property {number} [roughness] 0 is a mirror, 1 is chalk (default 0.5)
 * @property {number} [metallicRoughnessTexture] Layer whose green is roughness and blue is metalness (both multiply the numbers above), or -1
 * @property {number} [normalTexture] Layer holding a tangent-space normal map (green is up, as in glTF), or -1
 * @property {number} [normalScale] How strong the bumps are (default 1)
 * @property {number} [occlusionTexture] Layer whose red is how much ambient light reaches each point (1 fully), or -1
 * @property {number} [occlusionStrength] 0 ignores the occlusion picture, 1 uses it fully (default 1)
 * @property {number[]} [emissive] RGB the surface gives off by itself, in linear light (default black); values above 1 glow more
 * @property {number} [emissiveTexture] Layer holding the emissive picture (sRGB), or -1
 * @property {number} [alphaCutoff] 0 means the surface is not cut out; above 0, pixels whose alpha is below it are not drawn at all (leaves, fences)
 * @property {number} [uvScale] How many times the pictures repeat over the mesh's texture coordinates (default 1)
 * @property {boolean} [opaque] Ignore the alpha of the base colour and its picture (a PNG with alpha used as plain colour); glTF's `OPAQUE` mode. Default false
 */

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const num = (v, def, name) => {
  if (v === undefined) return def;
  if (!Number.isFinite(v)) throw new Error(`material ${name} must be a number (got ${v})`);
  return v;
};
const layer = (v, name) => {
  if (v === undefined || v === null) return -1;
  if (!Number.isInteger(v) || v < -1) throw new Error(`material ${name} must be a texture layer number, or -1 for none (got ${v})`);
  return v;
};
const colour = (v, def, n, name) => {
  if (v === undefined) return def.slice();
  if (!Array.isArray(v) && !ArrayBuffer.isView(v)) throw new Error(`material ${name} must be a list of ${n} numbers`);
  if (v.length < n || [...v].slice(0, n).some((x) => !Number.isFinite(x))) throw new Error(`material ${name} needs ${n} numbers (got ${JSON.stringify([...v])})`);
  return [...v].slice(0, n);
};

/**
 * Check a material and fill in what it leaves out, so the renderers always get the same complete shape.
 * @param {MaterialSpec} spec
 * @returns {Required<MaterialSpec>}
 */
export function cleanMaterial(spec = {}) {
  if (!spec || typeof spec !== 'object') throw new Error('a material is an object');
  return {
    name: typeof spec.name === 'string' ? spec.name.slice(0, 64) : '',
    baseColor: colour(spec.baseColor, [1, 1, 1, 1], 4, 'baseColor'),
    baseColorTexture: layer(spec.baseColorTexture, 'baseColorTexture'),
    metallic: clamp(num(spec.metallic, 0, 'metallic'), 0, 1),
    roughness: clamp(num(spec.roughness, 0.5, 'roughness'), 0, 1),
    metallicRoughnessTexture: layer(spec.metallicRoughnessTexture, 'metallicRoughnessTexture'),
    normalTexture: layer(spec.normalTexture, 'normalTexture'),
    normalScale: clamp(num(spec.normalScale, 1, 'normalScale'), 0, 8),
    occlusionTexture: layer(spec.occlusionTexture, 'occlusionTexture'),
    occlusionStrength: clamp(num(spec.occlusionStrength, 1, 'occlusionStrength'), 0, 1),
    emissive: colour(spec.emissive, [0, 0, 0], 3, 'emissive').map((x) => Math.max(0, x)),
    emissiveTexture: layer(spec.emissiveTexture, 'emissiveTexture'),
    alphaCutoff: clamp(num(spec.alphaCutoff, 0, 'alphaCutoff'), 0, 1),
    uvScale: clamp(num(spec.uvScale, 1, 'uvScale'), 0.001, 1000),
    opaque: spec.opaque === true,
  };
}

/**
 * The materials of a scene, packed the way the renderers read them. `add` returns the number an instance picks with
 * `DrawList3D.setSurface`; `set` changes one that is already there (a flickering emissive, a wet surface drying), and the renderer
 * uploads the change at the next `render`.
 */
export class MaterialSet {
  constructor() {
    /** @type {Required<MaterialSpec>[]} The materials; material number n is `materials[n - 1]`. */
    this.materials = [];
    /** The packed table: slot 0 is unused, slot n holds material n (`MATERIAL_FLOATS` floats). */
    this.data = new Float32Array(MATERIAL_SLOTS * MATERIAL_FLOATS);
    /** Increases whenever anything changes; renderers upload when it moves. */
    this.version = 0;
  }

  /**
   * Add a material and get its number (1 or more).
   * @param {MaterialSpec} spec
   * @returns {number}
   */
  add(spec) {
    if (this.materials.length >= MAX_MATERIALS) throw new Error(`the material set is full (${MAX_MATERIALS} materials)`);
    this.materials.push(cleanMaterial(spec));
    const id = this.materials.length;
    this.#pack(id);
    return id;
  }

  /**
   * Change some numbers of a material that is already in the set.
   * @param {number} id
   * @param {MaterialSpec} changes
   */
  set(id, changes) {
    if (!this.materials[id - 1]) throw new Error(`there is no material ${id}`);
    this.materials[id - 1] = cleanMaterial({ ...this.materials[id - 1], ...changes });
    this.#pack(id);
  }

  /** The number of the first material with this name, or 0. @param {string} name */
  find(name) {
    const i = this.materials.findIndex((m) => m.name === name);
    return i + 1;
  }

  #pack(id) {
    const m = this.materials[id - 1], d = this.data, o = id * MATERIAL_FLOATS;
    d.set(m.baseColor, o);
    d[o + 4] = m.metallic; d[o + 5] = m.roughness; d[o + 6] = m.normalScale; d[o + 7] = m.occlusionStrength;
    d[o + 8] = m.emissive[0]; d[o + 9] = m.emissive[1]; d[o + 10] = m.emissive[2]; d[o + 11] = m.alphaCutoff;
    d[o + 12] = m.baseColorTexture; d[o + 13] = m.metallicRoughnessTexture; d[o + 14] = m.normalTexture; d[o + 15] = m.occlusionTexture;
    d[o + 16] = m.emissiveTexture; d[o + 17] = m.uvScale; d[o + 18] = m.opaque ? 1 : 0; d[o + 19] = 0;
    this.version++;
  }
}

// ---------- the shading model, written out on the CPU ----------
// The renderers do this in their shaders; this is the same maths for tests, tools and anyone who wants to know what a pixel will be.

/** sRGB (0..1) to linear light. */
export const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
/** Linear light to sRGB (0..1). */
export const linearToSrgb = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);

const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm3 = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };

/**
 * What one light contributes to a point of a surface: the diffuse part and the specular part (GGX), both already multiplied by the
 * light's colour and the cosine of its angle. Colours are in linear light. A light colour of 1 lights a white matte surface to full white
 * (the same convention as the simple lighting, so the two kinds of surface sit together in one scene).
 * @param {{baseColor: number[], metallic: number, roughness: number}} s the surface: linear base colour, metallic, roughness
 * @param {number[]} n unit normal
 * @param {number[]} v unit vector to the eye
 * @param {number[]} l unit vector to the light
 * @param {number[]} radiance the light's colour times its intensity (and shadow)
 * @returns {{diffuse: number[], specular: number[]}}
 */
export function pbrLight(s, n, v, l, radiance) {
  const ndl = Math.max(dot3(n, l), 0);
  if (ndl <= 0) return { diffuse: [0, 0, 0], specular: [0, 0, 0] };
  const nv = Math.max(dot3(n, v), 1e-4);
  const h = norm3([l[0] + v[0], l[1] + v[1], l[2] + v[2]]);
  const nh = Math.max(dot3(n, h), 0), vh = Math.max(dot3(v, h), 0);
  const rough = clamp(s.roughness, 0.045, 1), a = rough * rough, a2 = a * a;
  const dd = nh * nh * (a2 - 1) + 1;
  const D = a2 / (Math.PI * dd * dd);                                       // GGX normal distribution
  const ggxV = ndl * Math.sqrt(nv * nv * (1 - a2) + a2);
  const ggxL = nv * Math.sqrt(ndl * ndl * (1 - a2) + a2);
  const V = 0.5 / Math.max(ggxV + ggxL, 1e-5);                              // Smith height-correlated visibility
  const fresnel = (1 - vh) ** 5;
  const diffuse = [], specular = [];
  for (let k = 0; k < 3; k++) {
    const f0 = 0.04 + (s.baseColor[k] - 0.04) * s.metallic;
    const F = f0 + (1 - f0) * fresnel;
    diffuse.push(s.baseColor[k] * (1 - s.metallic) * radiance[k] * ndl);
    specular.push(F * D * V * Math.PI * radiance[k] * ndl);
  }
  return { diffuse, specular };
}

/**
 * How much of the light from all around a surface of this roughness, seen at this angle, reflects: Karis' analytic approximation, as `A` and `B` so that the
 * reflected share for a surface with F0 is `F0 * A + B`.
 * @param {number} rough 0 to 1
 * @param {number} nv cosine of the angle between the normal and the eye
 * @returns {[number, number]}
 */
export function environmentBrdf(rough, nv) {
  const c0 = [-1, -0.0275, -0.572, 0.022], c1 = [1, 0.0425, 1.04, -0.04];
  const rr = [0, 1, 2, 3].map((i) => rough * c0[i] + c1[i]);
  const a004 = Math.min(rr[0] * rr[0], 2 ** (-9.28 * nv)) * rr[0] + rr[1];
  return [-1.04 * a004 + rr[2], 1.04 * a004 + rr[3]];
}

/**
 * What a surface receives from an `Environment` (see `environment.js`): the diffuse light, from the spherical harmonics, and the specular part, the environment reflected at a
 * blur that matches the roughness, scaled by how much a surface like this reflects. The same maths as the shaders, for tests and tools.
 * @param {{baseColor: number[], metallic: number, roughness: number}} s
 * @param {number[]} n unit normal
 * @param {number[]} v unit vector to the eye
 * @param {import('./environment.js').Environment} env
 * @param {{intensity?: number, rotation?: number}} [settings] as in `lighting.environment`
 * @returns {{diffuse: number[], specular: number[]}}
 */
export function pbrAmbientEnvironment(s, n, v, env, { intensity = 1, rotation = 0 } = {}) {
  const rough = clamp(s.roughness, 0.045, 1);
  const nv = Math.max(dot3(n, v), 1e-4);
  const r = norm3([2 * dot3(n, v) * n[0] - v[0], 2 * dot3(n, v) * n[1] - v[1], 2 * dot3(n, v) * n[2] - v[2]]);
  const irradiance = environmentIrradiance(env, rotateForEnvironment(n, rotation));
  const reflected = sampleEnvironment(env, rotateForEnvironment(r, rotation), rough * env.maxLod);
  const [A, B] = environmentBrdf(rough, nv);
  const diffuse = [], specular = [];
  for (let k = 0; k < 3; k++) {
    const f0 = 0.04 + (s.baseColor[k] - 0.04) * s.metallic;
    diffuse.push(s.baseColor[k] * (1 - s.metallic) * irradiance[k] * intensity);
    specular.push(reflected[k] * intensity * (f0 * A + B));
  }
  return { diffuse, specular };
}

/**
 * The light from all around (the hemisphere of sky and ground), as seen by a surface: its diffuse part, and its specular part (the sky
 * reflected in it, scaled by an analytic approximation of how much a surface of this roughness and angle reflects).
 * @param {{baseColor: number[], metallic: number, roughness: number}} s
 * @param {number[]} n unit normal
 * @param {number[]} v unit vector to the eye
 * @param {number[]} sky ambient sky colour (linear)
 * @param {number[]} ground ambient ground colour (linear)
 * @returns {{diffuse: number[], specular: number[]}}
 */
export function pbrAmbient(s, n, v, sky, ground) {
  const rough = clamp(s.roughness, 0.045, 1);
  const nv = Math.max(dot3(n, v), 1e-4);
  const r = norm3([2 * dot3(n, v) * n[0] - v[0], 2 * dot3(n, v) * n[1] - v[1], 2 * dot3(n, v) * n[2] - v[2]]);
  const mixc = (t) => [0, 1, 2].map((k) => ground[k] + (sky[k] - ground[k]) * t);
  const diffuseLight = mixc(n[1] * 0.5 + 0.5);
  const mirror = mixc(r[1] * 0.5 + 0.5), dull = mixc(0.5), blur = rough * rough;
  const [A, B] = environmentBrdf(rough, nv);
  const diffuse = [], specular = [];
  for (let k = 0; k < 3; k++) {
    const f0 = 0.04 + (s.baseColor[k] - 0.04) * s.metallic;
    diffuse.push(s.baseColor[k] * (1 - s.metallic) * diffuseLight[k]);
    specular.push((mirror[k] + (dull[k] - mirror[k]) * blur) * (f0 * A + B));
  }
  return { diffuse, specular };
}
