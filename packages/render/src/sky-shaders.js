import { SKY_CONSTANTS, SKY_VIEW_STEPS, SKY_LIGHT_STEPS } from './sky.js';

const { RE, RA, HR, HM, OBSERVER, BETA_R, BETA_M } = SKY_CONSTANTS;
const BETA_R_TEXT = BETA_R.map((b) => b.toString()).join(', ');

/**
 * The sky in WGSL: defines `skyRadiance(dir)` and `skyColor(dir)` as the CPU functions in sky.js do, line for line. `block(n)` is the text that reads vec4 number n of the sky block (see `writeSkyBlock`).
 * @param {(n: number) => string} block @param {{lut?: boolean}} [o] `lut`: read the scattered light from the baked textures `skyLutR`, `skyLutM` (sampler `skyLutS`) instead of working it out for each pixel (see `SKY_LUT_WGSL`)
 */
export function skyWgsl(block, { lut = false } = {}) {
  const B = block;
  return `
const SKY_RE = ${RE}.0; const SKY_RA = ${RA}.0; const SKY_HR = ${HR}; const SKY_HM = ${HM}; const SKY_OBS = ${OBSERVER};
const SKY_BETA_R = vec3f(${BETA_R_TEXT});
const SKY_BETA_M = ${BETA_M};
fn skySmooth(a: f32, b: f32, x: f32) -> f32 { let t = clamp((x - a) / (b - a), 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }
fn skyExit(o: vec3f, d: vec3f, r: f32) -> f32 { let b = dot(o, d); let c = dot(o, o) - r * r; return -b + sqrt(max(b * b - c, 0.0)); }
fn skyHitsPlanet(o: vec3f, d: vec3f) -> bool {
  let b = dot(o, d);
  let c = dot(o, o) - SKY_RE * SKY_RE;
  let disc = b * b - c;
  return disc > 0.0 && -b - sqrt(disc) > 0.0;
}
fn skyHash(x: i32, y: i32, z: i32) -> u32 {
  var h = (u32(x) * 0x27d4eb2du) ^ (u32(y) * 0x165667b1u) ^ (u32(z) * 0x9e3779b1u);
  h = (h ^ (h >> 15u)) * 0x85ebca6bu;
  h = (h ^ (h >> 13u)) * 0xc2b2ae35u;
  return h ^ (h >> 16u);
}
fn skyUnit(h: u32) -> f32 { return f32(h >> 8u) / 16777216.0; }
fn skyVnoise(p: vec2f) -> f32 {
  let i = floor(p);
  let f = p - i;
  let u = f * f * (3.0 - 2.0 * f);
  let ix = i32(i.x);
  let iy = i32(i.y);
  let a = skyUnit(skyHash(ix, iy, 11));
  let b = skyUnit(skyHash(ix + 1, iy, 11));
  let c = skyUnit(skyHash(ix, iy + 1, 11));
  let d = skyUnit(skyHash(ix + 1, iy + 1, 11));
  return a + (b - a) * u.x + (c - a) * u.y + (a - b - c + d) * u.x * u.y;
}
fn skyCloudNoise(p: vec2f) -> f32 { return (skyVnoise(p) * 0.5 + skyVnoise(p * 2.0) * 0.25 + skyVnoise(p * 4.0) * 0.125 + skyVnoise(p * 8.0) * 0.0625) / 0.9375; }
struct SkyScatter { r: vec3f, m: vec3f };
${lut ? '' : `// the part of the atmosphere that follows from the direction alone (and the sun, and how much of each kind of air): the light scattered by air and by haze, before the phase functions
fn skyScatter(d: vec3f, s: vec3f, rs: f32, ms: f32) -> SkyScatter {
  let o = vec3f(0.0, SKY_RE + SKY_OBS, 0.0);
  let tMax = skyExit(o, d, SKY_RA);
  var sumR = vec3f(0.0);
  var sumM = vec3f(0.0);
  var odR = 0.0;
  var odM = 0.0;
  for (var i = 0; i < ${SKY_VIEW_STEPS}; i++) {
    let f0 = f32(i) / ${SKY_VIEW_STEPS}.0;
    let f1 = f32(i + 1) / ${SKY_VIEW_STEPS}.0;
    let t0 = tMax * f0 * f0;
    let t1 = tMax * f1 * f1;
    let ds = t1 - t0;
    let p = o + d * ((t0 + t1) * 0.5);
    let h = length(p) - SKY_RE;
    let hr = exp(-h / SKY_HR) * ds;
    let hm = exp(-h / SKY_HM) * ds;
    odR += hr;
    odM += hm;
    if (skyHitsPlanet(p, s)) { continue; }
    let dl = skyExit(p, s, SKY_RA) / ${SKY_LIGHT_STEPS}.0;
    var lR = 0.0;
    var lM = 0.0;
    for (var j = 0; j < ${SKY_LIGHT_STEPS}; j++) {
      let hl = length(p + s * ((f32(j) + 0.5) * dl)) - SKY_RE;
      lR += exp(-hl / SKY_HR) * dl;
      lM += exp(-hl / SKY_HM) * dl;
    }
    let att = exp(-(SKY_BETA_R * rs * (odR + lR) + vec3f(SKY_BETA_M * ms * 1.1 * (odM + lM))));
    sumR += att * hr;
    sumM += att * hm;
  }
  return SkyScatter(sumR * SKY_BETA_R * rs, sumM * SKY_BETA_M * ms);
}
`}
fn skyRadiance(dir: vec3f) -> vec3f {
  let s = ${B(0)}.xyz;
  let sunI = ${B(0)}.w;
  let ms = ${B(1)}.x;
  let rs = ${B(1)}.y;
  let g = ${B(1)}.z;
  let tSun = ${B(7)}.xyz;
  let d = normalize(vec3f(dir.x, max(dir.y, 0.0005), dir.z));
${lut ? `  let lutUv = vec2f(atan2(d.z, d.x) * 0.15915494309 + 0.5, sqrt(d.y));
  let sc = SkyScatter(textureSampleLevel(skyLutR, skyLutS, lutUv, 0.0).rgb, textureSampleLevel(skyLutM, skyLutS, lutUv, 0.0).rgb);
` : `  let sc = skyScatter(d, s, rs, ms);
`}  let mu = dot(d, s);
  let phaseR = 3.0 / (16.0 * 3.14159265358979) * (1.0 + mu * mu);
  let phaseM = 3.0 / (8.0 * 3.14159265358979) * ((1.0 - g * g) * (1.0 + mu * mu)) / ((2.0 + g * g) * pow(1.0 + g * g - 2.0 * g * mu, 1.5));
  let sky0 = (sc.r * phaseR + sc.m * phaseM) * sunI;
  let gl = (sky0.x + sky0.y + sky0.z) / 3.0 * 0.5;
  let groundRad = ${B(2)}.xyz * (vec3f(gl) + tSun * max(s.y, 0.0) * sunI * 0.05);
  var out = mix(sky0, groundRad, skySmooth(0.0, -0.06, dir.y));
  if (dir.y <= 0.0) { return out; }
  let night = skySmooth(0.0, -0.18, s.y);
  let view = dir.y;
  if (${B(6)}.w > 0.5) {
    let cp = vec2f(dir.x, dir.z) * (1.0 / (view + 0.1)) * ${B(3)}.z + vec2f(${B(4)}.x, ${B(4)}.y);
    let n = skyCloudNoise(cp);
    let n2 = skyCloudNoise(cp + vec2f(s.x, s.z) * 0.12);
    let a = skySmooth(1.0 - ${B(3)}.x - 0.12, 1.0 - ${B(3)}.x + 0.12, n) * ${B(3)}.y * skySmooth(0.0, 0.15, view);
    let shade = clamp(1.0 - (n2 - n) * 2.5, 0.35, 1.0);
    let gray = (out.x + out.y + out.z) / 3.0;
    let cloud = (tSun * (0.9 * max(s.y + 0.15, 0.0) + 0.1) * shade * 1.3 + vec3f(gray * 1.6)) * ${B(3)}.w;
    out = mix(out, cloud, a);
  }
  if (${B(4)}.z > 0.0 && night > 0.0) {
    let gv = dir * 90.0;
    let cell = floor(gv);
    let cx = i32(cell.x);
    let cy = i32(cell.y);
    let cz = i32(cell.z);
    if (skyUnit(skyHash(cx, cy, cz)) < 0.015) {
      let sp = vec3f(0.25 + 0.5 * skyUnit(skyHash(cx + 31, cy, cz)), 0.25 + 0.5 * skyUnit(skyHash(cx, cy + 31, cz)), 0.25 + 0.5 * skyUnit(skyHash(cx, cy, cz + 31)));
      let dd = length(gv - cell - sp);
      let tw = 0.8 + 0.2 * sin(${B(4)}.w * 3.0 + skyUnit(skyHash(cx, cy, cz + 77)) * 40.0);
      out += vec3f(skySmooth(0.14, 0.0, dd) * (0.3 + 0.7 * skyUnit(skyHash(cx, cy + 53, cz))) * tw * ${B(4)}.z * 2.0 * night * skySmooth(0.0, 0.1, view));
    }
  }
  if (${B(7)}.w > 0.5) {
    let cm = dot(dir, ${B(5)}.xyz);
    let r = ${B(6)}.z;
    let dsc = skySmooth(${B(6)}.x, ${B(6)}.y, cm);
    let halo = exp(-(1.0 - cm) / (r * r * 40.0)) * 0.02;
    out += vec3f(0.96, 0.96, 1.0) * (${B(5)}.w * (dsc * 0.85 + halo) * (0.2 + 0.8 * night));
  }
  let cosR = ${B(2)}.w;
  out += tSun * (skySmooth(cosR - (1.0 - cosR) * 0.5, cosR, mu) * 40.0);
  return out;
}
fn skyColor(dir: vec3f) -> vec3f { return vec3f(1.0) - exp(-skyRadiance(dir) * ${B(1)}.w); }
`;
}

/** The sky in GLSL ES 3.0: the same functions as `skyWgsl`. @param {(n: number) => string} block @param {{lut?: boolean}} [o] `lut`: read the scattered light from the baked textures `u_skyLutR`, `u_skyLutM` instead of working it out for each pixel */
export function skyGlsl(block, { lut = false } = {}) {
  const B = block;
  return `
const float SKY_RE = ${RE}.0; const float SKY_RA = ${RA}.0; const float SKY_HR = ${HR}; const float SKY_HM = ${HM}; const float SKY_OBS = ${OBSERVER};
const vec3 SKY_BETA_R = vec3(${BETA_R_TEXT});
const float SKY_BETA_M = ${BETA_M};
float skySmooth(float a, float b, float x) { float t = clamp((x - a) / (b - a), 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }
float skyExit(vec3 o, vec3 d, float r) { float b = dot(o, d); float c = dot(o, o) - r * r; return -b + sqrt(max(b * b - c, 0.0)); }
bool skyHitsPlanet(vec3 o, vec3 d) {
  float b = dot(o, d);
  float c = dot(o, o) - SKY_RE * SKY_RE;
  float disc = b * b - c;
  return disc > 0.0 && -b - sqrt(disc) > 0.0;
}
uint skyHash(int x, int y, int z) {
  uint h = (uint(x) * 0x27d4eb2du) ^ (uint(y) * 0x165667b1u) ^ (uint(z) * 0x9e3779b1u);
  h = (h ^ (h >> 15u)) * 0x85ebca6bu;
  h = (h ^ (h >> 13u)) * 0xc2b2ae35u;
  return h ^ (h >> 16u);
}
float skyUnit(uint h) { return float(h >> 8u) / 16777216.0; }
float skyVnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = p - i;
  vec2 u = f * f * (3.0 - 2.0 * f);
  int ix = int(i.x);
  int iy = int(i.y);
  float a = skyUnit(skyHash(ix, iy, 11));
  float b = skyUnit(skyHash(ix + 1, iy, 11));
  float c = skyUnit(skyHash(ix, iy + 1, 11));
  float d = skyUnit(skyHash(ix + 1, iy + 1, 11));
  return a + (b - a) * u.x + (c - a) * u.y + (a - b - c + d) * u.x * u.y;
}
float skyCloudNoise(vec2 p) { return (skyVnoise(p) * 0.5 + skyVnoise(p * 2.0) * 0.25 + skyVnoise(p * 4.0) * 0.125 + skyVnoise(p * 8.0) * 0.0625) / 0.9375; }
${lut ? 'uniform highp sampler2D u_skyLutR;\nuniform highp sampler2D u_skyLutM;' : `// the part of the atmosphere that follows from the direction alone (and the sun, and how much of each kind of air): the light scattered by air and by haze, before the phase functions
void skyScatter(vec3 d, vec3 s, float rs, float ms, out vec3 LR, out vec3 LM) {
  vec3 o = vec3(0.0, SKY_RE + SKY_OBS, 0.0);
  float tMax = skyExit(o, d, SKY_RA);
  vec3 sumR = vec3(0.0);
  vec3 sumM = vec3(0.0);
  float odR = 0.0;
  float odM = 0.0;
  for (int i = 0; i < ${SKY_VIEW_STEPS}; i++) {
    float f0 = float(i) / ${SKY_VIEW_STEPS}.0;
    float f1 = float(i + 1) / ${SKY_VIEW_STEPS}.0;
    float t0 = tMax * f0 * f0;
    float t1 = tMax * f1 * f1;
    float ds = t1 - t0;
    vec3 p = o + d * ((t0 + t1) * 0.5);
    float h = length(p) - SKY_RE;
    float hr = exp(-h / SKY_HR) * ds;
    float hm = exp(-h / SKY_HM) * ds;
    odR += hr;
    odM += hm;
    if (skyHitsPlanet(p, s)) { continue; }
    float dl = skyExit(p, s, SKY_RA) / ${SKY_LIGHT_STEPS}.0;
    float lR = 0.0;
    float lM = 0.0;
    for (int j = 0; j < ${SKY_LIGHT_STEPS}; j++) {
      float hl = length(p + s * ((float(j) + 0.5) * dl)) - SKY_RE;
      lR += exp(-hl / SKY_HR) * dl;
      lM += exp(-hl / SKY_HM) * dl;
    }
    vec3 att = exp(-(SKY_BETA_R * rs * (odR + lR) + vec3(SKY_BETA_M * ms * 1.1 * (odM + lM))));
    sumR += att * hr;
    sumM += att * hm;
  }
  LR = sumR * SKY_BETA_R * rs;
  LM = sumM * SKY_BETA_M * ms;
}
`}
vec3 skyRadiance(vec3 dir) {
  vec3 s = ${B(0)}.xyz;
  float sunI = ${B(0)}.w;
  float ms = ${B(1)}.x;
  float rs = ${B(1)}.y;
  float g = ${B(1)}.z;
  vec3 tSun = ${B(7)}.xyz;
  vec3 d = normalize(vec3(dir.x, max(dir.y, 0.0005), dir.z));
${lut ? `  vec2 lutUv = vec2(atan(d.z, d.x) * 0.15915494309 + 0.5, sqrt(d.y));
  vec3 LR = textureLod(u_skyLutR, lutUv, 0.0).rgb;
  vec3 LM = textureLod(u_skyLutM, lutUv, 0.0).rgb;
` : `  vec3 LR, LM;
  skyScatter(d, s, rs, ms, LR, LM);
`}  float mu = dot(d, s);
  float phaseR = 3.0 / (16.0 * 3.14159265358979) * (1.0 + mu * mu);
  float phaseM = 3.0 / (8.0 * 3.14159265358979) * ((1.0 - g * g) * (1.0 + mu * mu)) / ((2.0 + g * g) * pow(1.0 + g * g - 2.0 * g * mu, 1.5));
  vec3 sky0 = (LR * phaseR + LM * phaseM) * sunI;
  float gl = (sky0.x + sky0.y + sky0.z) / 3.0 * 0.5;
  vec3 groundRad = ${B(2)}.xyz * (vec3(gl) + tSun * max(s.y, 0.0) * sunI * 0.05);
  vec3 outc = mix(sky0, groundRad, skySmooth(0.0, -0.06, dir.y));
  if (dir.y <= 0.0) { return outc; }
  float night = skySmooth(0.0, -0.18, s.y);
  float view = dir.y;
  if (${B(6)}.w > 0.5) {
    vec2 cp = vec2(dir.x, dir.z) * (1.0 / (view + 0.1)) * ${B(3)}.z + vec2(${B(4)}.x, ${B(4)}.y);
    float n = skyCloudNoise(cp);
    float n2 = skyCloudNoise(cp + vec2(s.x, s.z) * 0.12);
    float a = skySmooth(1.0 - ${B(3)}.x - 0.12, 1.0 - ${B(3)}.x + 0.12, n) * ${B(3)}.y * skySmooth(0.0, 0.15, view);
    float shade = clamp(1.0 - (n2 - n) * 2.5, 0.35, 1.0);
    float gray = (outc.x + outc.y + outc.z) / 3.0;
    vec3 cloud = (tSun * (0.9 * max(s.y + 0.15, 0.0) + 0.1) * shade * 1.3 + vec3(gray * 1.6)) * ${B(3)}.w;
    outc = mix(outc, cloud, a);
  }
  if (${B(4)}.z > 0.0 && night > 0.0) {
    vec3 gv = dir * 90.0;
    vec3 cell = floor(gv);
    int cx = int(cell.x);
    int cy = int(cell.y);
    int cz = int(cell.z);
    if (skyUnit(skyHash(cx, cy, cz)) < 0.015) {
      vec3 sp = vec3(0.25 + 0.5 * skyUnit(skyHash(cx + 31, cy, cz)), 0.25 + 0.5 * skyUnit(skyHash(cx, cy + 31, cz)), 0.25 + 0.5 * skyUnit(skyHash(cx, cy, cz + 31)));
      float dd = length(gv - cell - sp);
      float tw = 0.8 + 0.2 * sin(${B(4)}.w * 3.0 + skyUnit(skyHash(cx, cy, cz + 77)) * 40.0);
      outc += vec3(skySmooth(0.14, 0.0, dd) * (0.3 + 0.7 * skyUnit(skyHash(cx, cy + 53, cz))) * tw * ${B(4)}.z * 2.0 * night * skySmooth(0.0, 0.1, view));
    }
  }
  if (${B(7)}.w > 0.5) {
    float cm = dot(dir, ${B(5)}.xyz);
    float r = ${B(6)}.z;
    float dsc = skySmooth(${B(6)}.x, ${B(6)}.y, cm);
    float halo = exp(-(1.0 - cm) / (r * r * 40.0)) * 0.02;
    outc += vec3(0.96, 0.96, 1.0) * (${B(5)}.w * (dsc * 0.85 + halo) * (0.2 + 0.8 * night));
  }
  float cosR = ${B(2)}.w;
  outc += tSun * (skySmooth(cosR - (1.0 - cosR) * 0.5, cosR, mu) * 40.0);
  return outc;
}
vec3 skyColor(vec3 dir) { return vec3(1.0) - exp(-skyRadiance(dir) * ${B(1)}.w); }
`;
}
