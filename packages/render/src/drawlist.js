import { mat4 } from '../../math/src/index.js';
import { lodLevel } from './lod.js';
import { lightType } from './shadow.js';

/** Floats per instance: a 4x4 model matrix (16), an RGBA colour (4) and a material (4: texture layer or -1, mapping, scale, surface material number or 0). */
export const INSTANCE3D_FLOATS = 24;
/** Bytes per instance in a 3D draw list (`INSTANCE3D_FLOATS` × 4). */
export const INSTANCE3D_BYTES = INSTANCE3D_FLOATS * 4;
/** Skinned instances have a vec4 after the colour whose x is where the instance's palette starts (in matrices; the renderer fills it in), then the material. */
export const SKINNED_INSTANCE_FLOATS = 28;
/** Bytes per instance of a skinned mesh in a draw list. */
export const SKINNED_INSTANCE_BYTES = SKINNED_INSTANCE_FLOATS * 4;

/** Most point lights a frame can use (the renderers read the first 32 of `lighting.pointLights`). */
export const MAX_POINT_LIGHTS = 32;

/**
 * The lights that matter most to a viewpoint, for when a scene has more than `MAX_POINT_LIGHTS`: the nearest ones (by distance to
 * the edge of each light's reach). Returns a new array; the input is left alone.
 * @param {{x: number, y: number, z: number, radius: number}[]} lights
 */
export function nearestLights(lights, x, y, z, max = MAX_POINT_LIGHTS) {
  return lights
    .map((l) => ({ l, d: Math.hypot(l.x - x, l.y - y, l.z - z) - l.radius }))
    .sort((a, b) => a.d - b.d)
    .slice(0, max)
    .map((e) => e.l);
}

/** The default lighting of a 3D scene: one directional light, a sky/ground hemisphere of ambient light, fog, and any number of point lights. */
export function createLighting() {
  return {
    /** Direction TO the light (need not be unit length). */
    direction: [0.4, 0.8, 0.5],
    /** Light colour times intensity. */
    color: [1, 0.96, 0.9],
    ambientSky: [0.45, 0.5, 0.6],
    ambientGround: [0.2, 0.18, 0.16],
    /** Specular highlight strength (0 = matte). */
    specular: 0.25,
    fogColor: [0.62, 0.7, 0.8],
    /** Exponential-squared fog density: 0 = none; 0.01 fades things out by about 150 units. */
    fogDensity: 0,
    /**
     * Lamps, muzzle flashes, fires, torches and panels: `{x, y, z, radius, color: [r, g, b], intensity}`. Light reaches `radius` metres and fades smoothly
     * to nothing there ((1 - (d / radius)^2)^2); it lights surfaces facing it (diffuse and specular). The first 32 are used (see `nearestLights`). Three kinds:
     * - **point** (the default): lights all round.
     * - **spot** (give a `direction: [x, y, z]`, or `type: 'spot'`): a cone along `direction` with half-angle `angle` in radians (0.7) whose edge is soft over the outer `penumbra`
     *   fraction of it (0.3).
     * - **area** (`type: 'area'`): a rectangular panel of `width` x `height` metres (1 x 1) facing along `direction`, giving light from its front only, as a window, a screen or a
     *   strip light would. `right` sets which way its width runs (default: level). `intensity` is how bright the panel is (about 2 to 5 is a bright window), so a bigger panel lights more.
     *
     * Point and spot lights can also cast shadows: `castShadow: true` (see `localShadows` in `render`). Area lights do not.
     * @type {{x: number, y: number, z: number, radius: number, color?: number[], intensity?: number, type?: 'point' | 'spot' | 'area', direction?: number[], angle?: number, penumbra?: number, width?: number, height?: number, right?: number[], castShadow?: boolean}[]}
     */
    pointLights: [],
  };
}

/**
 * The meshes to draw this frame, grouped by mesh so each one becomes a single instanced draw call. Reuse one list every
 * frame: `clear()`, then `add...` for everything visible.
 *
 * Lighting uses the model matrix's rotation for normals, so non-uniform scaling skews the shading a little; scale uniformly
 * where it matters.
 */
export class DrawList3D {
  constructor() {
    /** @type {Map<import('./mesh.js').Mesh, {data: Float32Array, count: number}>} */
    this.groups = new Map();
    /** @type {Map<import('./mesh.js').Mesh, {data: Float32Array, palettes: Float32Array, count: number, jointCount: number}>} skinned meshes: per instance a model matrix, colour and palette */
    this.skinned = new Map();
    this.count = 0;
    /** Instances skipped this frame because they were outside the view (see `setCamera`). */
    this.culled = 0;
    /** Instances skipped this frame because something in front of them hides them (see `setOcclusion`). */
    this.occluded = 0;
    /** Instances of a `Lod` skipped this frame because they were too small to matter (see `createLod`). */
    this.tooSmall = 0;
    /** Multiplies the size at which `addLod` changes level: above 1 uses coarser levels sooner (faster), below 1 holds the detailed ones longer. */
    this.lodBias = 1;
    /** @type {import('./occlusion.js').OcclusionBuffer | null} */ this.occlusion = null;
    this.camera = null;
    /** What is applied to instances added from now on: [texture layer or -1, mapping (0 none, 1 mesh uv, 2 planar, 3 terrain splat, 4 water), scale, surface material number or 0 (a terrain's first layer)]. See `setMaterial`, `setSurface` and `setTerrain`. */
    this.material = [-1, 0, 1, 0];
    this.light = null; // [x, y, z] unit direction TO the light, and how far a shadow may reach (see setCamera)
    this.shadowReach = 0;
    this.localCasters = null; // [x, y, z, radius] of each point or spot light that casts shadows (see setCamera)
    this.scratch = new Float64Array(16);
  }

  /**
   * Texture the instances you add next (until the next call, or `clear()`). The layer is what `TextureSet.add` returned.
   * - `'uv'`: use the mesh's texture coordinates (meshes without any show one texel), multiplied by `scale` (2 = the texture repeats twice).
   * - `'planar'`: no coordinates needed: the texture is projected along whichever world axis the surface faces most, `scale`
   *   times per metre (0.25 = one repeat per 4 m). Good for ground, walls and boxes; the texture stays put as objects move around it.
   * The instance colour multiplies the texture, so a white texture shows the colour and a coloured one tints it.
   * @param {number | null} layer
   * @param {'uv' | 'planar'} [mapping]
   * @param {number} [scale]
   */
  setMaterial(layer, mapping = 'uv', scale = 1) {
    if (this.material[1] >= 3) this.material[3] = 0;                  // leaving a terrain or water: its fourth number was not a material
    if (layer === null || layer === undefined) { this.material[0] = -1; this.material[1] = 0; this.material[2] = 1; return; }
    if (!Number.isInteger(layer) || layer < 0) throw new Error(`texture layer must be a whole number from 0 (got ${layer})`);
    if (mapping !== 'uv' && mapping !== 'planar') throw new Error(`mapping must be 'uv' or 'planar' (got ${mapping})`);
    this.material[0] = layer; this.material[1] = mapping === 'uv' ? 1 : 2; this.material[2] = scale;
  }

  /**
   * Draw the instances you add next (until the next call, or `clear()`) with a physically based material from the `MaterialSet` the renderer was given
   * (`renderer.setMaterials`): a number `MaterialSet.add` returned. Such a surface is lit with metal and roughness, bump and occlusion pictures and
   * emission instead of the simple lighting, and takes its pictures from the material, so `setMaterial` has no effect on it; the instance colour still
   * tints it. Pass 0 (or nothing) to go back to the simple lighting.
   * @param {number} [id]
   */
  setSurface(id = 0) {
    if (!Number.isInteger(id) || id < 0 || id > 127) throw new Error(`a surface material is a number from 1 to 127, or 0 for none (got ${id})`);
    if (this.material[1] >= 3) { this.material[0] = -1; this.material[1] = 0; this.material[2] = 1; }        // a surface material replaces a terrain's texturing or water
    this.material[3] = id;
  }

  /**
   * Draw the instances you add next as water (see `createWaterMesh` and `createWaterStyle`): lifted by waves, coloured by depth, reflecting the sky. `style` is an index into `lighting.water`
   * (0 to 3), `time` the clock in seconds that moves the waves. Add water after the solid things, with an alpha below 0.5 so it casts no shadow. Anything set with `setMaterial`,
   * `setSurface` or `setTerrain` afterwards replaces this.
   * @param {number} [style] @param {number} [time]
   */
  setWater(style = 0, time = 0) {
    if (!Number.isInteger(style) || style < 0 || style > 3) throw new Error(`a water style is 0 to 3 (got ${style})`);
    this.material[0] = style; this.material[1] = 4; this.material[2] = time; this.material[3] = 0;
  }

  /**
   * Texture the instances you add next as terrain: ground that blends four pictures by a **splat map**. `splatLayer` is a layer of the `TextureSet` whose red, green, blue and alpha
   * say how much of the first, second, third and fourth picture shows at each place (stretched over the terrain by the mesh's texture coordinates, so give the terrain mesh `uv` running 0 to 1
   * over the whole terrain); `firstLayer` is the first of four layers in a row that hold the pictures. They tile `scale` times per metre, projected along the axis the ground faces most
   * (so steep slopes are not stretched). `terrain.js` makes the mesh and the splat map. Anything set with `setMaterial` or `setSurface` afterwards replaces this.
   * @param {number} splatLayer @param {number} firstLayer @param {number} [scale]
   */
  setTerrain(splatLayer, firstLayer, scale = 0.25) {
    for (const [name, v] of [['splatLayer', splatLayer], ['firstLayer', firstLayer]]) if (!Number.isInteger(v) || v < 0) throw new Error(`${name} must be a whole number from 0 (got ${v})`);
    this.material[0] = splatLayer; this.material[1] = 3; this.material[2] = scale; this.material[3] = firstLayer;
  }

  /**
   * Skip instances that cannot be on screen: from now on `add` and `addSkinned` test each instance's bounding sphere against
   * the camera's frustum (as of its last `update()`) and drop the ones outside. Pass null to draw everything. Set it every
   * frame after `camera.update()`; a skinned mesh's bound is its bind pose enlarged by half again plus 25 cm (set
   * `mesh.cullRadius` if your animations reach further).
   *
   * With shadows on, pass the light too: something behind you or off to the side can still throw its shadow into view, so
   * instances whose shadow could reach the view are kept (they are drawn into the shadow map, and cost only vertex work in
   * the main pass).
   * @param {import('./camera3d.js').Camera3D | null} camera
   * Point and spot lights that cast shadows (`castShadow: true`) need the same: pass `lights` (the `pointLights` of the lighting) and instances inside the reach of
   * such a light are kept even when out of view, so that a wall behind you still throws its shadow in front of you.
   * @param {{light?: ArrayLike<number>, reach?: number, lights?: {x: number, y: number, z: number, radius: number, castShadow?: boolean}[]}} [shadows] `light`: direction TO the sun; `reach`: the farthest a shadow is worth following, in metres (default 60); `lights`: the lights that may cast shadows
   */
  setCamera(camera, shadows) {
    this.camera = camera;
    this.light = null;
    this.localCasters = null;
    if (camera && shadows?.lights) {
      const c = [];
      for (const l of shadows.lights) if (l.castShadow && lightType(l) !== 'area') c.push([l.x, l.y, l.z, l.radius]);
      if (c.length) this.localCasters = c;
    }
    if (camera && shadows?.light) {
      const l = shadows.light, len = Math.hypot(l[0], l[1], l[2]) || 1;
      this.light = [l[0] / len, l[1] / len, l[2] / len];
      this.shadowReach = shadows.reach ?? 60;
    }
  }

  /**
   * Skip instances hidden behind what the buffer holds (fill it each frame with `begin(camera)` and `addBox` / `addMesh` for the walls, then set it here). Only
   * instances that pass the frustum test are asked. With shadows on (`setCamera(camera, { light })`) nothing is dropped for being hidden, because a hidden thing can
   * still throw a shadow into view and the shadow map is drawn from this list. Pass null to stop.
   * @param {import('./occlusion.js').OcclusionBuffer | null} buffer
   */
  setOcclusion(buffer) { this.occlusion = buffer; }

  /** Is this instance (mesh placed by `model`) inside the view? Always true without a camera. */
  #visible(mesh, model, skinned) {
    const cam = this.camera;
    if (!cam) return true;
    const b = (mesh.bound ??= {
      cx: (mesh.min[0] + mesh.max[0]) / 2, cy: (mesh.min[1] + mesh.max[1]) / 2, cz: (mesh.min[2] + mesh.max[2]) / 2,
      r: Math.hypot(mesh.max[0] - mesh.min[0], mesh.max[1] - mesh.min[1], mesh.max[2] - mesh.min[2]) / 2,
    });
    const sx = model[0] * model[0] + model[1] * model[1] + model[2] * model[2], sy = model[4] * model[4] + model[5] * model[5] + model[6] * model[6], sz = model[8] * model[8] + model[9] * model[9] + model[10] * model[10];
    const scale2 = sx > sy ? (sx > sz ? sx : sz) : (sy > sz ? sy : sz);
    const radius = (mesh.cullRadius ?? (skinned ? b.r * 1.5 + 0.25 : b.r)) * (scale2 === 1 ? 1 : Math.sqrt(scale2)); // the largest axis scale
    const x = model[0] * b.cx + model[4] * b.cy + model[8] * b.cz + model[12];
    const y = model[1] * b.cx + model[5] * b.cy + model[9] * b.cz + model[13];
    const z = model[2] * b.cx + model[6] * b.cy + model[10] * b.cz + model[14];
    if (cam.sphereVisible(x, y, z, radius)) {
      if (this.occlusion && !this.light && !this.localCasters && this.occlusion.sphereHidden(x, y, z, radius)) { this.occluded++; return false; }
      return true;
    }
    if (this.light && cam.sweptSphereVisible(x, y, z, radius, -this.light[0] * this.shadowReach, -this.light[1] * this.shadowReach, -this.light[2] * this.shadowReach)) return true; // its shadow may fall into view
    if (this.localCasters) for (const c of this.localCasters) if (Math.hypot(x - c[0], y - c[1], z - c[2]) < c[3] + radius) return true; // it may throw a point or spot light's shadow into view
    this.culled++;
    return false;
  }

  clear() {
    this.culled = 0; this.occluded = 0; this.tooSmall = 0;
    this.material[0] = -1; this.material[1] = 0; this.material[2] = 1; this.material[3] = 0;
    for (const g of this.groups.values()) g.count = 0;
    for (const g of this.skinned.values()) g.count = 0;
    this.count = 0;
  }

  #slot(mesh) {
    let g = this.groups.get(mesh);
    if (!g) { g = { data: new Float32Array(INSTANCE3D_FLOATS * 16), count: 0 }; this.groups.set(mesh, g); }
    if ((g.count + 1) * INSTANCE3D_FLOATS > g.data.length) {
      const next = new Float32Array(g.data.length * 2);
      next.set(g.data);
      g.data = next;
    }
    return g;
  }

  /**
   * @param {import('./mesh.js').Mesh} mesh
   * @param {ArrayLike<number>} model Column-major 4x4 model matrix
   * @param {number} [r] Colour channels 0..1
   * @param {number} [g]
   * @param {number} [b]
   * @param {number} [a]
   */
  add(mesh, model, r = 1, g = 1, b = 1, a = 1) {
    if (this.camera && !this.#visible(mesh, model, false)) return;
    const slot = this.#slot(mesh);
    const o = slot.count++ * INSTANCE3D_FLOATS, d = slot.data;
    for (let i = 0; i < 16; i++) d[o + i] = model[i];
    d[o + 16] = r; d[o + 17] = g; d[o + 18] = b; d[o + 19] = a;
    d[o + 20] = this.material[0]; d[o + 21] = this.material[1]; d[o + 22] = this.material[2]; d[o + 23] = this.material[3];
    this.count++;
  }

  /**
   * Add an instance of a skinned mesh. The palette (one 4x4 matrix per joint, from `Skeleton.computePalette`) is copied now,
   * so you can reuse your palette array straight away. Skinned instances are drawn after the plain ones.
   * @param {import('./mesh.js').Mesh} mesh Made with `createSkinnedMesh`
   * @param {ArrayLike<number>} model Column-major 4x4 placement of the whole character
   * @param {ArrayLike<number>} palette `mesh.jointCount * 16` floats
   */
  addSkinned(mesh, model, palette, r = 1, g = 1, b = 1, a = 1) {
    if (!mesh.skin) throw new Error('addSkinned needs a mesh made with createSkinnedMesh');
    const jc = mesh.jointCount;
    if (palette.length < jc * 16) throw new Error(`palette has ${palette.length} floats, ${mesh.name} needs ${jc * 16}`);
    if (this.camera && !this.#visible(mesh, model, true)) return;
    let slot = this.skinned.get(mesh);
    if (!slot) { slot = { data: new Float32Array(SKINNED_INSTANCE_FLOATS * 8), palettes: new Float32Array(jc * 16 * 8), count: 0, jointCount: jc }; this.skinned.set(mesh, slot); }
    if ((slot.count + 1) * SKINNED_INSTANCE_FLOATS > slot.data.length) {
      const d = new Float32Array(slot.data.length * 2); d.set(slot.data); slot.data = d;
      const p = new Float32Array(slot.palettes.length * 2); p.set(slot.palettes); slot.palettes = p;
    }
    const o = slot.count * SKINNED_INSTANCE_FLOATS, d = slot.data;
    for (let i = 0; i < 16; i++) d[o + i] = model[i];
    d[o + 16] = r; d[o + 17] = g; d[o + 18] = b; d[o + 19] = a;
    d[o + 24] = this.material[0]; d[o + 25] = this.material[1]; d[o + 26] = this.material[2]; d[o + 27] = this.material[3];
    slot.palettes.set(palette.length === jc * 16 ? palette : palette.subarray(0, jc * 16), slot.count * jc * 16);
    slot.count++;
    this.count++;
  }

  /** The size of a `Lod` placed by `model` on screen, as a fraction of the view's height; 1 without a camera (so the finest level is used). */
  #lodSize(lod, model) {
    const cam = this.camera;
    if (!cam) return 1;
    const sx = model[0] * model[0] + model[1] * model[1] + model[2] * model[2], sy = model[4] * model[4] + model[5] * model[5] + model[6] * model[6], sz = model[8] * model[8] + model[9] * model[9] + model[10] * model[10];
    const scale = Math.sqrt(sx > sy ? (sx > sz ? sx : sz) : (sy > sz ? sy : sz));
    const radius = lod.radius * scale;
    if (cam.ortho > 0) return radius / cam.ortho;
    const c = lod.center;
    const x = model[0] * c[0] + model[4] * c[1] + model[8] * c[2] + model[12] - cam.x, y = model[1] * c[0] + model[5] * c[1] + model[9] * c[2] + model[13] - cam.y, z = model[2] * c[0] + model[6] * c[1] + model[10] * c[2] + model[14] - cam.z;
    const d = Math.sqrt(x * x + y * y + z * z);
    return d > radius ? radius / (d * Math.tan(cam.fovY / 2)) : 1;       // inside its own bounding sphere: as large as it gets
  }

  /**
   * Add an instance of a `Lod` (see `createLod`): the level that suits its size on screen is chosen, or nothing if it is too small to matter. Needs `setCamera` to know
   * the distance (without one, the most detailed level is drawn).
   * @param {import('./lod.js').Lod} lod @param {ArrayLike<number>} model @returns {number} the level drawn, or -1
   */
  addLod(lod, model, r = 1, g = 1, b = 1, a = 1) {
    const level = lodLevel(lod, this.#lodSize(lod, model), this.lodBias);
    if (level < 0) { this.tooSmall++; return -1; }
    this.add(lod.levels[level].mesh, model, r, g, b, a);
    return level;
  }

  /** Like `addLod`, for levels made with `createSkinnedMesh` that share one skeleton (so one palette fits every level). */
  addSkinnedLod(lod, model, palette, r = 1, g = 1, b = 1, a = 1) {
    const level = lodLevel(lod, this.#lodSize(lod, model), this.lodBias);
    if (level < 0) { this.tooSmall++; return -1; }
    this.addSkinned(lod.levels[level].mesh, model, palette, r, g, b, a);
    return level;
  }

  /**
   * Add a batch made by `StaticBatcher.build()`: its geometry is already in world space, so it is drawn as one instance with its own colour and texture settings.
   * @param {import('./merge.js').StaticBatch} batch
   */
  addBatch(batch) {
    const m = this.material;
    const keep0 = m[0], keep1 = m[1], keep2 = m[2], keep3 = m[3];
    m[0] = batch.material[0]; m[1] = batch.material[1]; m[2] = batch.material[2]; m[3] = batch.material[3];
    this.add(batch.mesh, IDENTITY, batch.color[0], batch.color[1], batch.color[2], batch.color[3]);
    m[0] = keep0; m[1] = keep1; m[2] = keep2; m[3] = keep3;
  }

  /**
   * Add an instance from a position, an optional rotation quaternion [x, y, z, w] and a scale.
   */
  addTransform(mesh, x, y, z, rotation, sx = 1, sy = sx, sz = sx, r = 1, g = 1, b = 1, a = 1) {
    mat4.compose(this.scratch, x, y, z, rotation ?? IDENTITY_QUAT, sx, sy, sz);
    this.add(mesh, this.scratch, r, g, b, a);
  }
}

const IDENTITY_QUAT = [0, 0, 0, 1];
const IDENTITY = Float32Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
