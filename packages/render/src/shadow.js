import { mat4 } from '../../math/src/index.js';

/**
 * Directional-light shadow mapping, shared by the WebGPU and WebGL2 renderers.
 *
 * One orthographic depth map of the world seen from the light, fitted to a box around the camera's view: everything that can
 * cast a shadow is drawn into it from the light's point of view, and the main pass asks, for each pixel, whether something
 * is between it and the light (a 3x3 percentage-closer filter softens the edge).
 *
 * @typedef {Object} ShadowOptions
 * @property {number} [size] Shadow map resolution in texels per side (default 2048).
 * @property {number} [radius] Half the width of the covered box in metres, centred ahead of the camera (default 45). A bigger
 *   radius covers more of the world with coarser shadows: texel size is 2 * radius / size.
 * @property {number} [bias] Depth bias in light-space depth units (default 0.0004: about 8 cm over the default 200 m depth range).
 * @property {number} [strength] 0..1, how dark shadows are (default 0.75; the rest is ambient light that shadows never remove).
 * @property {number} [cascades] Split the covered area into this many nested boxes (1 to 4, default 1), each with its own shadow map of `size`:
 *   the nearest is small and very sharp, the farthest is `radius`. Shadows near the camera get far more detail for the same cost per pixel.
 * @property {number} [ratio] Each cascade is this fraction of the size of the next one out (0.15 to 0.9, default 0.35).
 */
export const SHADOW_DEFAULTS = Object.freeze({ size: 2048, radius: 45, bias: 0.0004, strength: 0.75, cascades: 1, ratio: 0.35 });
export const MAX_CASCADES = 4;
const LIGHT_DISTANCE = 120; // the light's eye sits this far from the centre of the box: casters up to here (toward the light) are included

/** Fill in defaults and check ranges. */
export function resolveShadowOptions(opts) {
  const o = { ...SHADOW_DEFAULTS, ...opts };
  if (!(o.size >= 64 && o.size <= 8192) || !Number.isInteger(o.size)) throw new Error(`shadow size must be a whole number from 64 to 8192 (got ${o.size})`);
  if (!(o.radius > 0)) throw new Error('shadow radius must be positive');
  o.strength = Math.max(0, Math.min(1, o.strength));
  if (!Number.isInteger(o.cascades) || o.cascades < 1 || o.cascades > MAX_CASCADES) throw new Error(`shadow cascades must be a whole number from 1 to ${MAX_CASCADES} (got ${o.cascades})`);
  if (!(o.ratio >= 0.15 && o.ratio <= 0.9)) throw new Error(`shadow ratio must be between 0.15 and 0.9 (got ${o.ratio})`);
  return o;
}

const focus = [0, 0, 0], eye = [0, 0, 0], up = [0, 1, 0], view = new Float64Array(16), proj = new Float64Array(16);

/**
 * The matrix that takes world positions to the shadow map's clip space (depth 0..1), for a camera and a light.
 * The box is moved in whole texels so shadows do not shimmer as the camera moves.
 * @param {Float64Array | Float32Array} out 16 floats
 * @param {import('./camera3d.js').Camera3D} camera
 * @param {ArrayLike<number>} lightDirection Direction TO the light (any length)
 * @param {{size: number, radius: number}} opts
 * @returns {number} Size of one shadow texel in metres
 */
export function computeShadowMatrix(out, camera, lightDirection, { size, radius }) {
  const len = Math.hypot(lightDirection[0], lightDirection[1], lightDirection[2]) || 1;
  const lx = lightDirection[0] / len, ly = lightDirection[1] / len, lz = lightDirection[2] / len;
  // centre of the covered box: ahead of the camera along the ground, so most of the box is in front of it
  const fx = -Math.sin(camera.yaw), fz = -Math.cos(camera.yaw);
  focus[0] = camera.x + fx * radius * 0.5; focus[1] = camera.y - Math.min(camera.y, 2) ; focus[2] = camera.z + fz * radius * 0.5;
  up[0] = 0; up[1] = Math.abs(ly) > 0.99 ? 0 : 1; up[2] = Math.abs(ly) > 0.99 ? -1 : 0;
  eye[0] = focus[0] + lx * LIGHT_DISTANCE; eye[1] = focus[1] + ly * LIGHT_DISTANCE; eye[2] = focus[2] + lz * LIGHT_DISTANCE;
  mat4.lookAt(view, eye, focus, up);
  // snap the centre to the texel grid in light space
  const texel = (2 * radius) / size;
  const ax = view[0], ay = view[4], az = view[8], bx = view[1], by = view[5], bz = view[9]; // light-space right and up in world coordinates
  const px = focus[0] * ax + focus[1] * ay + focus[2] * az, py = focus[0] * bx + focus[1] * by + focus[2] * bz;
  const dx = Math.round(px / texel) * texel - px, dy = Math.round(py / texel) * texel - py;
  for (let k = 0; k < 3; k++) { const shift = (k === 0 ? ax : k === 1 ? ay : az) * dx + (k === 0 ? bx : k === 1 ? by : bz) * dy; focus[k] += shift; eye[k] += shift; }
  mat4.lookAt(view, eye, focus, up);
  mat4.orthographic(proj, -radius, radius, -radius, radius, 0.1, LIGHT_DISTANCE * 2);
  mat4.multiply(out, proj, view);
  return texel;
}

/**
 * The matrices of every cascade, nearest first: cascade i covers a box of half-width `radius * ratio^(cascades - 1 - i)`.
 * @param {(Float64Array | Float32Array)[]} out One 16-float array per cascade.
 * @param {import('./camera3d.js').Camera3D} camera
 * @param {ArrayLike<number>} lightDirection
 * @param {{size: number, radius: number, cascades: number, ratio: number}} opts
 * @returns {number[]} The size of one shadow texel in metres, per cascade.
 */
export function computeCascades(out, camera, lightDirection, { size, radius, cascades, ratio }) {
  const texels = [];
  for (let i = 0; i < cascades; i++) texels.push(computeShadowMatrix(out[i], camera, lightDirection, { size, radius: radius * ratio ** (cascades - 1 - i) }));
  return texels;
}

// ---------------------------------------------------------------- shadows from point and spot lights

/** Most layers of local shadow map a frame can use: a spot light takes one, a point light six (one per face of a cube). */
export const MAX_LOCAL_SHADOW_LAYERS = 12;

/**
 * @typedef {Object} LocalShadowOptions
 * @property {number} [size] Resolution of each layer in texels per side (default 1024).
 * @property {number} [layers] Layers in the budget, up to 12 (default 12): twelve spot lights, or two point lights, or any mix that fits.
 * @property {number} [bias] How far, in metres, a surface is moved toward the light before it is compared with the map (default 0.03). Raise it if surfaces shadow themselves.
 * @property {number} [strength] 0..1, how dark local shadows are (default 0.9).
 */
export const LOCAL_SHADOW_DEFAULTS = Object.freeze({ size: 1024, layers: MAX_LOCAL_SHADOW_LAYERS, bias: 0.03, strength: 0.9 });

/** Fill in defaults and check ranges. @param {LocalShadowOptions | true} [opts] */
export function resolveLocalShadowOptions(opts = {}) {
  const o = { ...LOCAL_SHADOW_DEFAULTS, ...(opts === true ? {} : opts) };
  if (!(o.size >= 64 && o.size <= 4096) || !Number.isInteger(o.size)) throw new Error(`local shadow size must be a whole number from 64 to 4096 (got ${o.size})`);
  if (!Number.isInteger(o.layers) || o.layers < 1 || o.layers > MAX_LOCAL_SHADOW_LAYERS) throw new Error(`local shadow layers must be a whole number from 1 to ${MAX_LOCAL_SHADOW_LAYERS} (got ${o.layers})`);
  o.strength = Math.max(0, Math.min(1, o.strength)); o.bias = Math.max(0, o.bias);
  return o;
}

/** What kind of light this is: `'area'` if it says so, `'spot'` if it has a `direction` (or says so), otherwise `'point'`. @param {{type?: string, direction?: ArrayLike<number>}} light */
export function lightType(light) {
  if (light.type === 'area' || light.type === 'spot' || light.type === 'point') return light.type;
  return light.direction ? 'spot' : 'point';
}

/** The spot cone's half-angle in radians (default 0.7), and where its soft edge starts as a fraction of it (`penumbra`, default 0.3). @returns {{outer: number, inner: number}} */
export function spotAngles(light) {
  const outer = Math.max(0.01, Math.min(1.5, light.angle ?? 0.7)), pen = Math.max(0, Math.min(1, light.penumbra ?? 0.3));
  return { outer, inner: outer * (1 - pen) };
}

/**
 * Decide which lights get shadow maps this frame. Lights with `castShadow` (point and spot ones: area lights cast none) are taken nearest the camera first
 * (by the distance to the edge of their reach), each given the layers it needs, until the budget runs out; a light that does not fit is skipped and the next
 * smaller one tried.
 * @param {{x: number, y: number, z: number, radius: number, castShadow?: boolean, type?: string, direction?: ArrayLike<number>}[]} lights
 * @param {{x: number, y: number, z: number}} camera @param {number} budget Layers available
 * @returns {{slots: Int32Array, layers: {light: number, face: number}[]}} `slots[i]` is light i's first layer, or -1; `layers` lists every layer in order
 */
export function planLocalShadows(lights, camera, budget) {
  const slots = new Int32Array(lights.length).fill(-1), layers = [];
  const order = [];
  lights.forEach((l, i) => { if (l.castShadow && lightType(l) !== 'area') order.push({ i, d: Math.hypot(l.x - camera.x, l.y - camera.y, l.z - camera.z) - l.radius }); });
  order.sort((a, b) => a.d - b.d || a.i - b.i);
  for (const { i } of order) {
    const need = lightType(lights[i]) === 'spot' ? 1 : 6;
    if (layers.length + need > budget) continue;
    slots[i] = layers.length;
    for (let f = 0; f < need; f++) layers.push({ light: i, face: f });
  }
  return { slots, layers };
}

const FACE_AXES = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const CUBE_FOV = 1.65; // a little over 90 degrees, so the filter at the edge of a face has something to read
const lview = new Float64Array(16), lproj = new Float64Array(16), ltarget = [0, 0, 0], lup = [0, 1, 0], leye = [0, 0, 0];

/**
 * The matrix that takes world positions to a light's shadow map layer (depth 0..1): a perspective view down the spot light's axis, or down one face of a point light's cube.
 * @param {Float64Array | Float32Array} out 16 floats
 * @param {{x: number, y: number, z: number, radius: number, direction?: ArrayLike<number>}} light @param {number} face 0..5 for a point light (+x -x +y -y +z -z); ignored for a spot
 * @param {number} size Texels per side
 * @returns {number} How wide one texel is, in metres per metre of distance from the light
 */
export function computeLocalMatrix(out, light, face, size) {
  const spot = lightType(light) === 'spot';
  let ax, ay, az, fov;
  if (spot) {
    const d = light.direction ?? [0, -1, 0], len = Math.hypot(d[0], d[1], d[2]) || 1;
    ax = d[0] / len; ay = d[1] / len; az = d[2] / len;
    fov = Math.min(3.0, 2 * (spotAngles(light).outer + 0.05));
  } else { [ax, ay, az] = FACE_AXES[face]; fov = CUBE_FOV; }
  leye[0] = light.x; leye[1] = light.y; leye[2] = light.z;
  ltarget[0] = light.x + ax; ltarget[1] = light.y + ay; ltarget[2] = light.z + az;
  lup[0] = 0; lup[1] = Math.abs(ay) > 0.99 ? 0 : 1; lup[2] = Math.abs(ay) > 0.99 ? 1 : 0;
  mat4.lookAt(lview, leye, ltarget, lup);
  mat4.perspective(lproj, fov, 1, Math.max(0.05, light.radius * 0.01), light.radius);
  mat4.multiply(out, lproj, lview);
  return (2 * Math.tan(fov / 2)) / size;
}
