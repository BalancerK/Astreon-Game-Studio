import { createMesh } from './mesh.js';
import { SKY_BLOCK_AT, SKY_BLOCK_VEC4S } from './sky.js';

/**
 * Water: a surface of waves that reflects the sky, shows its depth in colour, and froths where it meets the shore. A water surface is an ordinary mesh (a flat grid made by `createWaterMesh`)
 * drawn in a water mode: the renderers lift its points with the waves and shade it per pixel, so it costs a few triangles and one draw call.
 *
 * ```js
 * const sea = createWaterMesh({ x0: -200, z0: -200, x1: 200, z1: 200, level: 0, cell: 2, ground: (x, z) => terrain.map.heightAt(x, z) });   // depth for the shore
 * const lighting = { ...createLighting(), sky, water: [createWaterStyle({ shallow: [0.1, 0.5, 0.5], deep: [0.0, 0.1, 0.25] })] };
 * // each frame, after everything solid is in the list:
 * list.setWater(0, time); list.add(sea, IDENTITY, 1, 1, 1, 0.4);
 * renderer.render({ camera, list, lighting });
 * const h = waterHeightAt(x, z, time, lighting.water[0]).height;                 // where a boat floats
 * ```
 * Draw water after the solid things in the list (it blends over them and writes depth); give its instance an alpha below 0.5 so it casts no shadow.
 */

/** Water styles a frame can use at once. */
export const WATER_STYLES = 4;
/** Waves that add up in one style. */
export const MAX_WAVES = 4;
/** Vec4s one style takes in the renderers' uniform table. */
export const WATER_STYLE_VEC4S = 12;
/** Vec4s of the whole water block: every style, then one more for settings shared by all. */
export const WATER_BLOCK_VEC4S = WATER_STYLES * WATER_STYLE_VEC4S + 1;
/** Where the water block starts in the uniform table (after the sky's). */
export const WATER_BLOCK_AT = SKY_BLOCK_AT + SKY_BLOCK_VEC4S;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

/**
 * @typedef {object} WaterStyle
 * @property {number[]} shallow Colour of the water where it is shallow, linear light. @property {number[]} deep Colour where it is deep. @property {number} clarity Depth in metres at which it has become the deep colour.
 * @property {number} opacity How opaque deep water is, 0 to 1. @property {number[]} foamColor @property {number} foamDepth How far from the shore (metres of depth) the froth reaches. @property {number} foamCrest 0..1: froth on wave crests.
 * @property {number} reflection How much of the sky shows in the water at glancing angles, 0..1. @property {number} specular Strength of the sun's glints. @property {number} shininess How tight they are. @property {number} ripple Strength of the fine ripples, 0..1.
 * @property {{angle: number, wavelength: number, amplitude: number, speed: number}[]} waves Up to four waves that add up. `angle`: the direction they travel, radians (0 is toward +x, pi/2 toward +z). `speed`: metres per second.
 */

/**
 * Describe a kind of water.
 * @param {Partial<WaterStyle>} [o] @returns {WaterStyle}
 */
export function createWaterStyle(o = {}) {
  const waves = (o.waves ?? [
    { angle: 0.3, wavelength: 14, amplitude: 0.22, speed: 2.2 }, { angle: 1.2, wavelength: 7, amplitude: 0.09, speed: 1.6 },
    { angle: -0.6, wavelength: 3.5, amplitude: 0.04, speed: 1.2 }, { angle: 2.2, wavelength: 1.8, amplitude: 0.015, speed: 0.9 },
  ]).slice(0, MAX_WAVES).map((w) => ({ angle: w.angle ?? 0, wavelength: Math.max(0.05, w.wavelength ?? 8), amplitude: Math.max(0, w.amplitude ?? 0.1), speed: w.speed ?? 1.5 }));
  return {
    shallow: o.shallow ?? [0.12, 0.45, 0.45], deep: o.deep ?? [0.01, 0.08, 0.2], clarity: Math.max(0.1, o.clarity ?? 5), opacity: clamp(o.opacity ?? 0.9, 0, 1),
    foamColor: o.foamColor ?? [0.95, 0.97, 1], foamDepth: Math.max(0.01, o.foamDepth ?? 0.6), foamCrest: clamp(o.foamCrest ?? 0.35, 0, 1),
    reflection: clamp(o.reflection ?? 1, 0, 1), specular: Math.max(0, o.specular ?? 1), shininess: Math.max(1, o.shininess ?? 220), ripple: clamp(o.ripple ?? 0.25, 0, 1), waves,
  };
}

/**
 * The surface of the water at a point and time: its height above the water's level and its upward unit normal (from the waves; fine ripples are left out). The shaders use these same
 * waves, so this is where a floating thing should sit.
 * @param {number} x @param {number} z @param {number} time Seconds. @param {WaterStyle} style @param {number} [depth] Water depth here: waves die away toward the shore (1.5 m and deeper: full).
 * @returns {{height: number, normal: number[]}}
 */
export function waterHeightAt(x, z, time, style, depth = Infinity) {
  let h = 0, dx = 0, dz = 0;
  for (const w of style.waves.slice(0, MAX_WAVES)) {
    const k = (2 * Math.PI) / w.wavelength, omega = k * w.speed, dirx = Math.cos(w.angle), dirz = Math.sin(w.angle), ph = k * (dirx * x + dirz * z) - omega * time;
    h += w.amplitude * Math.sin(ph); dx += w.amplitude * k * dirx * Math.cos(ph); dz += w.amplitude * k * dirz * Math.cos(ph);
  }
  const f = smooth(0, 1.5, depth), len = Math.hypot(dx * f, 1, dz * f);
  return { height: h * f, normal: [-dx * f / len, 1 / len, -dz * f / len] };
}

/**
 * A flat grid of water. Each point carries the water's depth there (in the texture coordinate `uv.x`, metres) so the shaders can colour the shallows and froth the shore.
 * @param {{x0: number, z0: number, x1: number, z1: number, level?: number, cell?: number, ground?: (x: number, z: number) => number, depth?: number, name?: string}} o
 * `level`: the water's height. `cell`: metres between points (smaller means the shore is drawn more exactly). `ground`: the height of the ground at a point (so depth is `level - ground`), or give a constant `depth`.
 * @returns {import('./mesh.js').Mesh}
 */
export function createWaterMesh({ x0, z0, x1, z1, level = 0, cell = 2, ground, depth = 10, name = 'water' }) {
  const nx = Math.max(1, Math.round((x1 - x0) / cell)), nz = Math.max(1, Math.round((z1 - z0) / cell)), verts = [], uvs = [], index = [];
  for (let j = 0; j <= nz; j++) {
    for (let i = 0; i <= nx; i++) {
      const x = x0 + ((x1 - x0) * i) / nx, z = z0 + ((z1 - z0) * j) / nz;
      verts.push(x, level, z, 0, 1, 0);
      uvs.push(Math.max(0, ground ? level - ground(x, z) : depth), 0);
    }
  }
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { const a = j * (nx + 1) + i, b = (j + 1) * (nx + 1) + i; index.push(a, b, a + 1, a + 1, b, b + 1); }
  return createMesh(verts, index, name, uvs);
}

/**
 * Write the water styles (and how reflections are found) into a renderer's uniform table.
 * @param {Float32Array} table @param {number} at The vec4 to start at. @param {WaterStyle[]} styles @param {0 | 1 | 2} mode Where reflections come from: 0 the scene's own sky and ground colours, 1 the environment, 2 a procedural sky.
 */
export function writeWaterBlock(table, at, styles, mode) {
  const o = at * 4;
  table.fill(0, o, o + WATER_BLOCK_VEC4S * 4);
  styles.slice(0, WATER_STYLES).forEach((s, n) => {
    const b = o + n * WATER_STYLE_VEC4S * 4;
    table.set([s.shallow[0], s.shallow[1], s.shallow[2], s.clarity], b);
    table.set([s.deep[0], s.deep[1], s.deep[2], s.opacity], b + 4);
    table.set([s.foamColor[0], s.foamColor[1], s.foamColor[2], s.foamDepth], b + 8);
    table.set([s.reflection, s.specular, s.shininess, s.ripple], b + 12);
    s.waves.slice(0, MAX_WAVES).forEach((w, k) => {
      const kk = (2 * Math.PI) / w.wavelength;
      table.set([Math.cos(w.angle), Math.sin(w.angle), kk, w.amplitude], b + 16 + k * 8);
      table.set([kk * w.speed, w.amplitude > 0 ? 1 : 0, k === 0 ? s.foamCrest : 0, 0], b + 20 + k * 8);   // the first wave's spare number carries the crest froth
    });
  });
  table[o + WATER_STYLES * WATER_STYLE_VEC4S * 4] = mode;
}
