import { WATER_BLOCK_AT, WATER_STYLE_VEC4S, WATER_STYLES } from './water.js';

/**
 * The water shaders, in WGSL and GLSL ES 3.0. `waterWave` is what the vertex stage uses to lift the surface (the CPU version is `waterHeightAt`); `waterShade` is the pixel stage, which also needs the
 * sky's noise (`skyVnoise`, sky-shaders.js), the sky functions for reflections, and the renderer's own `scene` block and `envReflection`. Both read the styles from the renderers' uniform table (see
 * `writeWaterBlock`); `block(expr)` is the text that reads vec4 number `expr` (an expression) of the whole table.
 */
const GLOBAL_AT = WATER_BLOCK_AT + WATER_STYLES * WATER_STYLE_VEC4S;

/** @param {(expr: string) => string} block */
export function waterWaveWgsl(block) {
  return `
fn waterSmooth(a: f32, b: f32, x: f32) -> f32 { let t = clamp((x - a) / (b - a), 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }
// the height of the surface at p and its slope along x and z, for a style (0 to 3) at time t, where the water is this deep
fn waterWave(p: vec2f, style: i32, t: f32, depth: f32) -> vec3f {
  let b = ${WATER_BLOCK_AT} + style * ${WATER_STYLE_VEC4S};
  var h = 0.0;
  var dx = 0.0;
  var dz = 0.0;
  for (var k = 0; k < 4; k++) {
    let a = ${block('b + 4 + k * 2')};
    let w = ${block('b + 5 + k * 2')};
    if (w.y > 0.5) {
      let ph = a.z * (a.x * p.x + a.y * p.y) - w.x * t;
      h += a.w * sin(ph);
      dx += a.w * a.z * a.x * cos(ph);
      dz += a.w * a.z * a.y * cos(ph);
    }
  }
  let f = waterSmooth(0.0, 1.5, depth);
  return vec3f(h * f, dx * f, dz * f);
}
`;
}

/** @param {(expr: string) => string} block */
export function waterShadeWgsl(block) {
  return `
fn waterRipple(p: vec2f, t: f32) -> vec2f {
  let e = 0.12;
  let q1 = p * 1.7 + vec2f(t * 0.35, t * 0.2);
  let q2 = p * 3.1 + vec2f(5.2 - t * 0.3, 1.3 + t * 0.25);
  let a0 = skyVnoise(q1);
  let b0 = skyVnoise(q2);
  let gx = (skyVnoise(q1 + vec2f(e, 0.0)) - a0) * 0.7 + (skyVnoise(q2 + vec2f(e, 0.0)) - b0) * 0.3;
  let gz = (skyVnoise(q1 + vec2f(0.0, e)) - a0) * 0.7 + (skyVnoise(q2 + vec2f(0.0, e)) - b0) * 0.3;
  return vec2f(gx, gz) * (0.5 / e);
}
// the colour and opacity of water at a world point, where it is this deep; mat is the instance's material (style, mode, time)
fn waterShade(world: vec3f, depth: f32, mat: vec4f) -> vec4f {
  let style = i32(mat.x + 0.5);
  let b = ${WATER_BLOCK_AT} + style * ${WATER_STYLE_VEC4S};
  let t = mat.z;
  let st0 = ${block('b')};
  let st1 = ${block('b + 1')};
  let st2 = ${block('b + 2')};
  let st3 = ${block('b + 3')};
  let wv = waterWave(world.xz, style, t, depth);
  let rip = waterRipple(world.xz, t) * st3.w;
  let n = normalize(vec3f(-wv.y - rip.x, 1.0, -wv.z - rip.y));
  let v = normalize(scene.camera.xyz - world);
  let fres = 0.06 + 0.94 * pow(1.0 - max(dot(n, v), 0.0), 4.0);
  var r = reflect(-v, n);
  r.y = abs(r.y);
  let mode = ${block(String(GLOBAL_AT))}.x;
  var refl = mix(scene.ground.rgb, scene.sky.rgb, clamp(r.y * 0.5 + 0.5, 0.0, 1.0));
  if (mode > 1.5) { refl = skyColor(r); } else if (mode > 0.5) { refl = envReflection(r, 0.0); }
  let l = normalize(scene.lightDir.xyz);
  let lit = scene.sky.rgb * 0.6 + scene.lightColor.rgb * max(l.y, 0.0) * 0.5 + vec3f(0.04);
  let body = mix(st0.rgb, st1.rgb, waterSmooth(0.0, st0.w, depth)) * lit;
  let spec = pow(max(dot(n, normalize(l + v)), 0.0), st3.z) * st3.y * scene.lightColor.a * scene.lightColor.rgb * waterSmooth(0.0, 0.1, l.y);
  var col = mix(body, refl, fres * st3.x) + spec;
  var ampSum = 0.0;
  for (var k = 0; k < 4; k++) { ampSum += ${block('b + 4 + k * 2')}.w; }
  let crest = waterSmooth(0.55, 1.0, wv.x / max(ampSum, 0.001)) * ${block('b + 5')}.z;
  let fm = skyVnoise(world.xz * 2.3 + vec2f(t * 0.2, -t * 0.15)) * 0.6 + skyVnoise(world.xz * 5.1 - vec2f(t * 0.1, t * 0.25)) * 0.4;
  let foam = clamp((waterSmooth(st2.w, 0.0, depth) * 0.95 + crest) * waterSmooth(0.38, 0.72, fm), 0.0, 1.0);
  col = mix(col, st2.rgb * (0.35 + 0.65 * clamp(lit, vec3f(0.0), vec3f(1.5))), foam);
  let alpha = max(clamp(st1.w * waterSmooth(0.0, st0.w * 0.35, depth) + fres * 0.6, 0.0, 1.0), foam);
  return vec4f(col, alpha);
}
`;
}

/** @param {(expr: string) => string} block */
export function waterWaveGlsl(block) {
  return `
float waterSmooth(float a, float b, float x) { float t = clamp((x - a) / (b - a), 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }
// the height of the surface at p and its slope along x and z, for a style (0 to 3) at time t, where the water is this deep
vec3 waterWave(vec2 p, int style, float t, float depth) {
  int b = ${WATER_BLOCK_AT} + style * ${WATER_STYLE_VEC4S};
  float h = 0.0;
  float dx = 0.0;
  float dz = 0.0;
  for (int k = 0; k < 4; k++) {
    vec4 a = ${block('b + 4 + k * 2')};
    vec4 w = ${block('b + 5 + k * 2')};
    if (w.y > 0.5) {
      float ph = a.z * (a.x * p.x + a.y * p.y) - w.x * t;
      h += a.w * sin(ph);
      dx += a.w * a.z * a.x * cos(ph);
      dz += a.w * a.z * a.y * cos(ph);
    }
  }
  float f = waterSmooth(0.0, 1.5, depth);
  return vec3(h * f, dx * f, dz * f);
}
`;
}

/** @param {(expr: string) => string} block */
export function waterShadeGlsl(block) {
  return `
vec2 waterRipple(vec2 p, float t) {
  float e = 0.12;
  vec2 q1 = p * 1.7 + vec2(t * 0.35, t * 0.2);
  vec2 q2 = p * 3.1 + vec2(5.2 - t * 0.3, 1.3 + t * 0.25);
  float a0 = skyVnoise(q1);
  float b0 = skyVnoise(q2);
  float gx = (skyVnoise(q1 + vec2(e, 0.0)) - a0) * 0.7 + (skyVnoise(q2 + vec2(e, 0.0)) - b0) * 0.3;
  float gz = (skyVnoise(q1 + vec2(0.0, e)) - a0) * 0.7 + (skyVnoise(q2 + vec2(0.0, e)) - b0) * 0.3;
  return vec2(gx, gz) * (0.5 / e);
}
// the colour and opacity of water at a world point, where it is this deep; mat is the instance's material (style, mode, time)
vec4 waterShade(vec3 world, float depth, vec4 mat) {
  int style = int(mat.x + 0.5);
  int b = ${WATER_BLOCK_AT} + style * ${WATER_STYLE_VEC4S};
  float t = mat.z;
  vec4 st0 = ${block('b')};
  vec4 st1 = ${block('b + 1')};
  vec4 st2 = ${block('b + 2')};
  vec4 st3 = ${block('b + 3')};
  vec3 wv = waterWave(world.xz, style, t, depth);
  vec2 rip = waterRipple(world.xz, t) * st3.w;
  vec3 n = normalize(vec3(-wv.y - rip.x, 1.0, -wv.z - rip.y));
  vec3 v = normalize(scene.camera.xyz - world);
  float fres = 0.06 + 0.94 * pow(1.0 - max(dot(n, v), 0.0), 4.0);
  vec3 r = reflect(-v, n);
  r.y = abs(r.y);
  float mode = ${block(String(GLOBAL_AT))}.x;
  vec3 refl = mix(scene.ground.rgb, scene.sky.rgb, clamp(r.y * 0.5 + 0.5, 0.0, 1.0));
  if (mode > 1.5) { refl = skyColor(r); } else if (mode > 0.5) { refl = envReflection(r, 0.0); }
  vec3 l = normalize(scene.lightDir.xyz);
  vec3 lit = scene.sky.rgb * 0.6 + scene.lightColor.rgb * max(l.y, 0.0) * 0.5 + vec3(0.04);
  vec3 body = mix(st0.rgb, st1.rgb, waterSmooth(0.0, st0.w, depth)) * lit;
  vec3 spec = scene.lightColor.rgb * (pow(max(dot(n, normalize(l + v)), 0.0), st3.z) * st3.y * scene.lightColor.a * waterSmooth(0.0, 0.1, l.y));
  vec3 col = mix(body, refl, fres * st3.x) + spec;
  float ampSum = 0.0;
  for (int k = 0; k < 4; k++) { ampSum += ${block('b + 4 + k * 2')}.w; }
  float crest = waterSmooth(0.55, 1.0, wv.x / max(ampSum, 0.001)) * ${block('b + 5')}.z;
  float fm = skyVnoise(world.xz * 2.3 + vec2(t * 0.2, -t * 0.15)) * 0.6 + skyVnoise(world.xz * 5.1 - vec2(t * 0.1, t * 0.25)) * 0.4;
  float foam = clamp((waterSmooth(st2.w, 0.0, depth) * 0.95 + crest) * waterSmooth(0.38, 0.72, fm), 0.0, 1.0);
  col = mix(col, st2.rgb * (0.35 + 0.65 * clamp(lit, vec3(0.0), vec3(1.5))), foam);
  float alpha = max(clamp(st1.w * waterSmooth(0.0, st0.w * 0.35, depth) + fres * 0.6, 0.0, 1.0), foam);
  return vec4(col, alpha);
}
`;
}
