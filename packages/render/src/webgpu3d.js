import { VERTEX_BYTES, SKIN_BYTES } from './mesh.js';
import { textureFormatInfo } from './ktx2.js';
import { GPUParticles } from './particles-gpu.js';
import { GPUPost, HDR_FORMAT } from './post-gpu.js';
import { computeCascades, packInstancesForLight, resolveShadowOptions, MAX_CASCADES, MAX_LOCAL_SHADOW_LAYERS, resolveLocalShadowOptions, planLocalShadows, computeLocalMatrix, lightType, spotAngles } from './shadow.js';
import { ENV_BLOCK_AT, ENV_BLOCK_VEC4S, halfFaceData, writeEnvironmentBlock } from './environment.js';
import { SKY_BLOCK_AT, writeSkyBlock } from './sky.js';
import { skyWgsl } from './sky-shaders.js';
import { WATER_BLOCK_AT, writeWaterBlock } from './water.js';
import { waterWaveWgsl, waterShadeWgsl } from './water-shaders.js';
import { mat4 } from '../../math/src/index.js';
import { INSTANCE3D_FLOATS, INSTANCE3D_BYTES, SKINNED_INSTANCE_FLOATS, SKINNED_INSTANCE_BYTES, MAX_POINT_LIGHTS, createLighting } from './drawlist.js';

const WGSL = `
struct Scene {
  viewProj: mat4x4f,
  lightDir: vec4f,
  lightColor: vec4f,  // rgb = colour times intensity, a = specular strength
  sky: vec4f,
  ground: vec4f,
  fog: vec4f,         // rgb = colour, a = density
  camera: vec4f,
  lightViewProj: mat4x4f,
  shadow: vec4f,      // x = one texel in uv, y = depth bias, z = strength (0 = shadows off), w = normal offset in metres
  lightCount: vec4f,  // x = number of point lights
  lights: array<vec4f, 64>, // per light two vec4s: position + radius, then colour times intensity
  cascades: array<mat4x4f, 4>, // shadow cascades, nearest first
  cascadeInfo: vec4f, // x = number of cascades
  cascadeOff: vec4f,  // normal offset in metres, per cascade
  lightX: array<vec4f, 96>, // per light three more vec4s: direction and kind (0 point, 1 spot, 2 area), cone or panel size and shadow texel and bias, panel right axis
  localMats: array<mat4x4f, 12>, // the shadow maps of point and spot lights, one matrix per layer
  localInfo: vec4f,   // x = one texel in uv, y = strength
};
@group(0) @binding(0) var<uniform> scene: Scene;
@group(0) @binding(2) var shadowMap: texture_depth_2d_array;
@group(0) @binding(3) var shadowSampler: sampler_comparison;
@group(0) @binding(4) var texArray: texture_2d_array<f32>;
@group(0) @binding(5) var texSampler: sampler;
@group(0) @binding(6) var<uniform> materials: array<vec4f, 713>; // physically based materials, five vec4s each (see materials.js), then the environment block (see environment.js)
@group(0) @binding(7) var envMap: texture_cube<f32>;
@group(0) @binding(8) var envSampler: sampler;
@group(0) @binding(9) var localShadowMap: texture_depth_2d_array;

struct VIn {
  @location(0) pos: vec3f, @location(1) nor: vec3f,
  @location(2) m0: vec4f, @location(3) m1: vec4f, @location(4) m2: vec4f, @location(5) m3: vec4f,
  @location(6) color: vec4f, @location(10) mat: vec4f, @location(11) uv: vec2f,
};
struct VOut {
  @builtin(position) clip: vec4f,
  @location(0) world: vec3f,
  @location(1) nor: vec3f,
  @location(2) color: vec4f,
  @location(3) uv: vec2f,
  @location(4) @interpolate(flat) mat: vec4f,
};

@vertex
fn vs(i: VIn) -> VOut {
  let model = mat4x4f(i.m0, i.m1, i.m2, i.m3);
  var w = model * vec4f(i.pos, 1.0);
  if (i.mat.y > 3.5) { w.y += waterWave(w.xz, i32(i.mat.x + 0.5), i.mat.z, i.uv.x).x; }          // water: lifted by its waves
  var o: VOut;
  o.clip = scene.viewProj * w;
  o.world = w.xyz;
  o.nor = (model * vec4f(i.nor, 0.0)).xyz;
  o.color = i.color;
  o.uv = i.uv;
  o.mat = i.mat;
  return o;
}

// skinned meshes: each vertex is pulled by up to four joints; the joint matrices of all skinned instances sit in one buffer
@group(0) @binding(1) var<storage, read> palette: array<mat4x4f>;
struct SIn {
  @location(0) pos: vec3f, @location(1) nor: vec3f,
  @location(2) m0: vec4f, @location(3) m1: vec4f, @location(4) m2: vec4f, @location(5) m3: vec4f,
  @location(6) color: vec4f, @location(7) pbase: vec4f,
  @location(8) joints: vec4f, @location(9) weights: vec4f,
  @location(10) mat: vec4f, @location(11) uv: vec2f,
};
@vertex
fn vsSkin(i: SIn) -> VOut {
  let base = u32(i.pbase.x + 0.5);
  let j = vec4<u32>(i.joints + vec4f(0.5));
  let skin = palette[base + j.x] * i.weights.x + palette[base + j.y] * i.weights.y + palette[base + j.z] * i.weights.z + palette[base + j.w] * i.weights.w;
  let model = mat4x4f(i.m0, i.m1, i.m2, i.m3);
  let w = model * (skin * vec4f(i.pos, 1.0));
  var o: VOut;
  o.clip = scene.viewProj * w;
  o.world = w.xyz;
  o.nor = (model * (skin * vec4f(i.nor, 0.0))).xyz;
  o.color = i.color;
  o.uv = i.uv;
  o.mat = i.mat;
  return o;
}

// depth-only passes into the shadow map: the same vertex work from the light's point of view; see-through instances cast nothing
struct ShIn {
  @location(0) pos: vec3f,
  @location(2) m0: vec4f, @location(3) m1: vec4f, @location(4) m2: vec4f, @location(5) m3: vec4f,
  @location(6) color: vec4f,
};
@vertex
fn vsShadow(i: ShIn) -> @builtin(position) vec4f {
  if (i.color.a < 0.5) { return vec4f(2.0, 2.0, 2.0, 1.0); }
  return scene.lightViewProj * (mat4x4f(i.m0, i.m1, i.m2, i.m3) * vec4f(i.pos, 1.0));
}
struct ShSIn {
  @location(0) pos: vec3f,
  @location(2) m0: vec4f, @location(3) m1: vec4f, @location(4) m2: vec4f, @location(5) m3: vec4f,
  @location(6) color: vec4f, @location(7) pbase: vec4f,
  @location(8) joints: vec4f, @location(9) weights: vec4f,
};
@vertex
fn vsShadowSkin(i: ShSIn) -> @builtin(position) vec4f {
  if (i.color.a < 0.5) { return vec4f(2.0, 2.0, 2.0, 1.0); }
  let base = u32(i.pbase.x + 0.5);
  let j = vec4<u32>(i.joints + vec4f(0.5));
  let skin = palette[base + j.x] * i.weights.x + palette[base + j.y] * i.weights.y + palette[base + j.z] * i.weights.z + palette[base + j.w] * i.weights.w;
  return scene.lightViewProj * (mat4x4f(i.m0, i.m1, i.m2, i.m3) * (skin * vec4f(i.pos, 1.0)));
}

// Cascaded shadows. One cascade: a 3x3 percentage-closer filter on its map, returning (lit, how close to the edge of its box the point is).
fn cascadeLit(c: i32, world: vec3f, n: vec3f) -> vec2f {
  let lp = scene.cascades[c] * vec4f(world + n * scene.cascadeOff[c], 1.0);
  let uv = vec2f(lp.x * 0.5 + 0.5, 0.5 - lp.y * 0.5);
  let z = lp.z - scene.shadow.y;
  var sum = 0.0;
  for (var dx = -1; dx <= 1; dx++) {
    for (var dy = -1; dy <= 1; dy++) {
      sum += textureSampleCompareLevel(shadowMap, shadowSampler, uv + vec2f(f32(dx), f32(dy)) * scene.shadow.x, c, z);
    }
  }
  return vec2f(sum / 9.0, max(abs(lp.x), abs(lp.y)));
}
// 1 = lit, 0 = in shadow. The first (nearest) cascade whose box holds the point is used, blending into the next one near its edge;
// the farthest cascade fades to lit at its edge.
fn shadowLight(world: vec3f, n: vec3f) -> f32 {
  if (scene.shadow.z <= 0.0) { return 1.0; }
  let count = i32(scene.cascadeInfo.x);
  var lit = 1.0;
  for (var c = 0; c < count; c++) {
    let r = cascadeLit(c, world, n);
    if (r.y < 1.0) {
      var mine = r.x;
      if (c + 1 == count) { mine = mix(r.x, 1.0, smoothstep(0.85, 1.0, r.y)); }
      lit = mine;
      if (c + 1 < count && r.y > 0.8) {
        let r2 = cascadeLit(c + 1, world, n);
        var next = r2.x;
        if (c + 2 == count) { next = mix(r2.x, 1.0, smoothstep(0.85, 1.0, r2.y)); }
        lit = mix(mine, next, smoothstep(0.8, 0.95, r.y));
      }
      break;
    }
  }
  return 1.0 - scene.shadow.z * (1.0 - lit);
}

// The texture colour of a surface (white when it has none). Always sampled (derivatives need every pixel to take the same path), with
// explicit gradients so a planar projection that switches axis at a box edge does not pick the wrong mip level there.
fn surfaceTexture(world: vec3f, n: vec3f, uv: vec2f, mat: vec4f) -> vec3f {
  let an = abs(n);
  let wdx = dpdx(world);
  let wdy = dpdy(world);
  var pu = vec2f(world.x, world.z);
  var gx = vec2f(wdx.x, wdx.z);
  var gy = vec2f(wdy.x, wdy.z);
  if (an.y < an.x || an.y < an.z) {
    if (an.x >= an.z) { pu = vec2f(world.z, -world.y); gx = vec2f(wdx.z, -wdx.y); gy = vec2f(wdy.z, -wdy.y); }
    else { pu = vec2f(world.x, -world.y); gx = vec2f(wdx.x, -wdx.y); gy = vec2f(wdy.x, -wdy.y); }
  }
  let planar = mat.y > 1.5;
  let coord = select(uv * mat.z, pu * mat.z, planar);
  let ddx = select(dpdx(uv) * mat.z, gx * mat.z, planar);
  let ddy = select(dpdy(uv) * mat.z, gy * mat.z, planar);
  var c = vec3f(0.0);
  let uvdx = dpdx(uv);                // derivatives are taken here, outside the branch (they need uniform control flow)
  let uvdy = dpdy(uv);
  if (mat.y > 3.5) {                 // water: no picture
    c = vec3f(1.0);
  } else if (mat.y > 2.5) {          // terrain splat: layer x holds the weights of the four layers from w, tiled planar by z
    let w = textureSampleGrad(texArray, texSampler, uv, i32(max(mat.x, 0.0) + 0.5), uvdx, uvdy);
    let base = i32(mat.w + 0.5);
    let c0 = textureSampleGrad(texArray, texSampler, coord, base, ddx, ddy).rgb;
    let c1 = textureSampleGrad(texArray, texSampler, coord, base + 1, ddx, ddy).rgb;
    let c2 = textureSampleGrad(texArray, texSampler, coord, base + 2, ddx, ddy).rgb;
    let c3 = textureSampleGrad(texArray, texSampler, coord, base + 3, ddx, ddy).rgb;
    c = (c0 * w.r + c1 * w.g + c2 * w.b + c3 * w.a) / max(w.r + w.g + w.b + w.a, 0.0001);
  } else {
    c = textureSampleGrad(texArray, texSampler, coord, i32(max(mat.x, 0.0) + 0.5), ddx, ddy).rgb;
  }
  return select(vec3f(1.0), c, mat.x >= 0.0);
}

// ---------- physically based surfaces (a material number above 0): metal and roughness, GGX highlights, bump, occlusion, emission ----------
const PI = 3.14159265358979;
fn srgbToLinear(c: vec3f) -> vec3f { return select(pow((c + 0.055) / 1.055, vec3f(2.4)), c / 12.92, c <= vec3f(0.04045)); }
fn linearToSrgb(c: vec3f) -> vec3f {
  let x = max(c, vec3f(0.0));
  return select(1.055 * pow(x, vec3f(1.0 / 2.4)) - 0.055, x * 12.92, x <= vec3f(0.0031308));
}
// A layer of the texture array with explicit gradients (so it works inside a branch).
fn layerTex(layer: f32, uv: vec2f, ddx: vec2f, ddy: vec2f) -> vec4f {
  return textureSampleGrad(texArray, texSampler, uv, i32(max(layer, 0.0) + 0.5), ddx, ddy);
}
// One light on a surface: Lambert diffuse plus GGX specular (Smith height-correlated visibility, Schlick fresnel), times the light and the cosine.
// A light colour of 1 lights a white matte surface to full white, as the simple lighting does.
fn brdfLight(n: vec3f, v: vec3f, l: vec3f, radiance: vec3f, f0: vec3f, cdiff: vec3f, a2: f32) -> vec3f {
  let ndl = max(dot(n, l), 0.0);
  if (ndl <= 0.0) { return vec3f(0.0); }
  let nv = max(dot(n, v), 0.0001);
  let h = normalize(l + v);
  let nh = max(dot(n, h), 0.0);
  let vh = max(dot(v, h), 0.0);
  let dd = nh * nh * (a2 - 1.0) + 1.0;
  let d = a2 / (PI * dd * dd);
  let gv = ndl * sqrt(nv * nv * (1.0 - a2) + a2);
  let gl = nv * sqrt(ndl * ndl * (1.0 - a2) + a2);
  let vis = 0.5 / max(gv + gl, 0.00001);
  let q = 1.0 - vh;
  let q2 = q * q;
  let f = f0 + (vec3f(1.0) - f0) * (q2 * q2 * q);
  return (cdiff + f * (d * vis * PI)) * radiance * ndl;
}
// ---------- lights with a place: point, spot and area lights ----------
// The shadow of a point or spot light: the surface is moved a little toward the light and off its own surface (by about a texel, which grows with distance), then compared with the
// light's depth map (a point light picks the face of its cube from the biggest part of the direction to the surface) with a 3x3 filter. 1 = lit, 0 = in shadow.
fn localLit(slot: f32, cube: bool, world: vec3f, n: vec3f, lpos: vec3f, toward: vec3f, dist: f32, texelScale: f32, bias: f32) -> f32 {
  let p = world + n * (dist * texelScale * 1.5) + toward * bias;
  var layer = i32(slot + 0.5);
  if (cube) {
    let d = p - lpos;
    let a = abs(d);
    var f = 5;
    if (a.x >= a.y && a.x >= a.z) { f = select(1, 0, d.x > 0.0); }
    else if (a.y >= a.z) { f = select(3, 2, d.y > 0.0); }
    else { f = select(5, 4, d.z > 0.0); }
    layer += f;
  }
  let lp = scene.localMats[layer] * vec4f(p, 1.0);
  if (lp.w <= 0.0) { return 1.0; }
  let uv = vec2f(lp.x / lp.w * 0.5 + 0.5, 0.5 - lp.y / lp.w * 0.5);
  let z = lp.z / lp.w;
  var sum = 0.0;
  for (var dx = -1; dx <= 1; dx++) {
    for (var dy = -1; dy <= 1; dy++) {
      sum += textureSampleCompareLevel(localShadowMap, shadowSampler, uv + vec2f(f32(dx), f32(dy)) * scene.localInfo.x, layer, z);
    }
  }
  return 1.0 - scene.localInfo.y * (1.0 - sum / 9.0);
}
// What one light does at a surface: the direction its diffuse light comes from (ld), the direction its highlight comes from (ls: the same, except for an area light, where it is the
// point of the panel nearest the mirror direction), and how much of the light's colour arrives (att: range, cone or panel size, and shadow). att 0 means none.
struct Local { ld: vec3f, ls: vec3f, att: f32 };
fn localLight(k: i32, world: vec3f, n: vec3f, v: vec3f) -> Local {
  let a = scene.lights[k * 2];
  let b = scene.lights[k * 2 + 1];
  let c = scene.lightX[k * 3];
  let d = scene.lightX[k * 3 + 1];
  var o: Local;
  o.att = 0.0;
  let toLight = a.xyz - world;
  let dist = length(toLight);
  if (dist >= a.w) { return o; }
  let q = dist / a.w;
  var fade = 1.0 - q * q;
  fade = fade * fade;
  if (c.w > 1.5) {                                   // a rectangular panel, lit on its front face only
    let right = scene.lightX[k * 3 + 2].xyz;
    let up = cross(c.xyz, right);
    let rel = world - a.xyz;
    if (dot(rel, c.xyz) <= 0.0) { return o; }
    let hit = a.xyz + right * clamp(dot(rel, right), -d.x, d.x) + up * clamp(dot(rel, up), -d.y, d.y);
    let toHit = hit - world;
    let dh = max(length(toHit), 0.0001);
    o.ld = toHit / dh;
    let area = max(4.0 * d.x * d.y, 0.0001);
    o.att = fade * area * max(dot(c.xyz, -o.ld), 0.0) / (dh * dh + area);
    o.ls = o.ld;
    let r = reflect(-v, n);
    let denom = dot(r, c.xyz);
    if (denom < -0.0001) {
      let t = dot(a.xyz - world, c.xyz) / denom;
      if (t > 0.0) {
        let onPlane = world + r * t - a.xyz;
        o.ls = normalize(a.xyz + right * clamp(dot(onPlane, right), -d.x, d.x) + up * clamp(dot(onPlane, up), -d.y, d.y) - world);
      }
    }
    return o;
  }
  o.ld = toLight / max(dist, 0.0001);
  o.ls = o.ld;
  if (dot(n, o.ld) <= 0.0) { return o; }
  var att = fade;
  if (c.w > 0.5) {                                   // a spot light: smooth edge of the cone
    let cone = clamp((dot(-o.ld, c.xyz) - d.x) * d.y, 0.0, 1.0);
    att = att * cone * cone;
    if (att <= 0.0) { return o; }
  }
  if (b.w >= 0.0) { att = att * localLit(b.w, c.w < 0.5, world, n, a.xyz, o.ld, dist, d.z, d.w); }
  o.att = att;
  return o;
}
// A local light on a surface: diffuse from direction ld, GGX highlight from direction ls (the same direction for point and spot lights, so this equals brdfLight).
fn brdfLocal(n: vec3f, v: vec3f, ld: vec3f, ls: vec3f, radiance: vec3f, f0: vec3f, cdiff: vec3f, a2: f32) -> vec3f {
  var col = cdiff * radiance * max(dot(n, ld), 0.0);
  let ndl = max(dot(n, ls), 0.0);
  if (ndl > 0.0) {
    let nv = max(dot(n, v), 0.0001);
    let h = normalize(ls + v);
    let nh = max(dot(n, h), 0.0);
    let vh = max(dot(v, h), 0.0);
    let dd = nh * nh * (a2 - 1.0) + 1.0;
    let dg = a2 / (PI * dd * dd);
    let gv = ndl * sqrt(nv * nv * (1.0 - a2) + a2);
    let gl = nv * sqrt(ndl * ndl * (1.0 - a2) + a2);
    let vis = 0.5 / max(gv + gl, 0.00001);
    let qq = 1.0 - vh;
    let q2 = qq * qq;
    let f = f0 + (vec3f(1.0) - f0) * (q2 * q2 * qq);
    col += f * (dg * vis * PI) * radiance * ndl;
  }
  return col;
}

// ---------- the environment: light from all around, as nine spherical harmonics (soft diffuse light) and a prefiltered cube (reflections), turned about the vertical axis ----------
fn envOn() -> bool { return materials[641].x > 0.5; }
fn envTurn(d: vec3f) -> vec3f {
  let p = materials[640];
  return vec3f(p.y * d.x - p.z * d.z, d.y, p.z * d.x + p.y * d.z);
}
fn envDiffuse(n: vec3f) -> vec3f {
  let c = materials[642].rgb * 0.282095
    + materials[643].rgb * (0.488603 * n.y) + materials[644].rgb * (0.488603 * n.z) + materials[645].rgb * (0.488603 * n.x)
    + materials[646].rgb * (1.092548 * n.x * n.y) + materials[647].rgb * (1.092548 * n.y * n.z)
    + materials[648].rgb * (0.315392 * (3.0 * n.z * n.z - 1.0)) + materials[649].rgb * (1.092548 * n.x * n.z)
    + materials[650].rgb * (0.546274 * (n.x * n.x - n.y * n.y));
  return max(c, vec3f(0.0)) * materials[640].x;
}
fn envReflection(r: vec3f, rough: f32) -> vec3f {
  return textureSampleLevel(envMap, envSampler, envTurn(r), rough * materials[640].w).rgb * materials[640].x;
}
fn pbrShade(i: VOut, id: i32, sh: f32, uvdx: vec2f, uvdy: vec2f, wdx: vec3f, wdy: vec3f) -> vec4f {
  let b = id * 5;
  let m0 = materials[b];
  let m1 = materials[b + 1];
  let m2 = materials[b + 2];
  let m3 = materials[b + 3];
  let m4 = materials[b + 4];
  let uv = i.uv * m4.y;
  let ddx = uvdx * m4.y;
  let ddy = uvdy * m4.y;
  var base = m0;
  if (m3.x >= 0.0) {
    let t = layerTex(m3.x, uv, ddx, ddy);
    base = vec4f(base.rgb * srgbToLinear(t.rgb), base.a * t.a);
  }
  base = vec4f(base.rgb * srgbToLinear(i.color.rgb), base.a * i.color.a);
  if (m4.z > 0.5) { base.a = i.color.a; }                       // an opaque material ignores the alpha of its colour and picture
  if (m2.w > 0.0 && base.a < m2.w) { discard; }
  var rough = m1.y;
  var metal = m1.x;
  if (m3.y >= 0.0) {
    let t = layerTex(m3.y, uv, ddx, ddy);
    rough = rough * t.g;
    metal = metal * t.b;
  }
  rough = clamp(rough, 0.045, 1.0);
  metal = clamp(metal, 0.0, 1.0);
  var occ = 1.0;
  if (m3.w >= 0.0) { occ = 1.0 + m1.w * (layerTex(m3.w, uv, ddx, ddy).r - 1.0); }
  var emissive = m2.rgb;
  if (m4.x >= 0.0) { emissive = emissive * srgbToLinear(layerTex(m4.x, uv, ddx, ddy).rgb); }
  var n = normalize(i.nor);
  if (m3.z >= 0.0) {
    // bump: a tangent frame from how the texture coordinates change across the screen (no tangents are stored with the mesh)
    let tn = layerTex(m3.z, uv, ddx, ddy).xyz * 2.0 - 1.0;
    let det = uvdx.x * uvdy.y - uvdy.x * uvdx.y;
    if (abs(det) > 1e-20) {
      let tr = (uvdy.y * wdx - uvdx.y * wdy) / det;
      let tt = tr - n * dot(n, tr);
      let len2 = dot(tt, tt);
      if (len2 > 1e-20) {
        let t = tt * inverseSqrt(len2);
        let bt = cross(n, t);
        n = normalize(t * (tn.x * m1.z) + bt * (tn.y * m1.z) + n * tn.z);
      }
    }
  }
  let v = normalize(scene.camera.xyz - i.world);
  let nv = max(dot(n, v), 0.0001);
  let a2 = pow(rough * rough, 2.0);
  let f0 = mix(vec3f(0.04), base.rgb, metal);
  let cdiff = base.rgb * (1.0 - metal);
  // light from all around: the hemisphere of sky and ground, seen directly and reflected, scaled by how much a surface like this reflects (Karis' approximation)
  let r = reflect(-v, n);
  let hemi = mix(scene.ground.rgb, scene.sky.rgb, n.y * 0.5 + 0.5);
  let mirror = mix(scene.ground.rgb, scene.sky.rgb, r.y * 0.5 + 0.5);
  let dull = mix(scene.ground.rgb, scene.sky.rgb, 0.5);
  let seen = mix(mirror, dull, rough * rough);
  let rr = rough * vec4f(-1.0, -0.0275, -0.572, 0.022) + vec4f(1.0, 0.0425, 1.04, -0.04);
  let a004 = min(rr.x * rr.x, exp2(-9.28 * nv)) * rr.x + rr.y;
  let ab = vec2f(-1.04, 1.04) * a004 + rr.zw;
  var col = (cdiff * hemi + seen * (f0 * ab.x + ab.y)) * occ;
  if (envOn()) { col = (cdiff * envDiffuse(envTurn(n)) + envReflection(r, rough) * (f0 * ab.x + ab.y)) * occ; }
  col += brdfLight(n, v, normalize(scene.lightDir.xyz), scene.lightColor.rgb * sh, f0, cdiff, a2);
  let lightCount = i32(scene.lightCount.x);
  for (var k = 0; k < lightCount; k++) {
    let L = localLight(k, i.world, n, v);
    if (L.att > 0.0) { col += brdfLocal(n, v, L.ld, L.ls, scene.lights[k * 2 + 1].rgb * L.att, f0, cdiff, a2); }
  }
  col += emissive;
  return vec4f(linearToSrgb(col), base.a);
}

@fragment
fn fs(i: VOut) -> @location(0) vec4f {
  let n = normalize(i.nor);
  let l = normalize(scene.lightDir.xyz);
  let ndl = max(dot(n, l), 0.0);
  let sh = select(1.0, shadowLight(i.world, n), ndl > 0.0);
  // everything that needs derivatives is worked out here, where every pixel takes the same path; the branches below only sample with explicit gradients
  let legacyTexture = surfaceTexture(i.world, n, i.uv, i.mat);
  let uvdx = dpdx(i.uv);
  let uvdy = dpdy(i.uv);
  let wdx = dpdx(i.world);
  let wdy = dpdy(i.world);
  let toCam = scene.camera.xyz - i.world;
  var rgb = vec3f(0.0);
  var alpha = i.color.a;
  let id = select(i32(i.mat.w + 0.5), 0, i.mat.y > 2.5);        // a terrain's fourth number is its first layer, not a material
  if (i.mat.y > 3.5) {
    let ws = waterShade(i.world, i.uv.x, i.mat);
    rgb = ws.rgb;
    alpha = ws.a;
  } else if (id > 0) {
    let p = pbrShade(i, id, sh, uvdx, uvdy, wdx, wdy);
    rgb = p.rgb;
    alpha = p.a;
  } else {
    let hemi = mix(scene.ground.rgb, scene.sky.rgb, n.y * 0.5 + 0.5);
    let v = normalize(toCam);
    let h = normalize(l + v);
    let spec = pow(max(dot(n, h), 0.0), 48.0) * scene.lightColor.a * ndl * sh;
    // point, spot and area lights: smooth falloff to nothing at their radius, diffuse and specular, shadows where a light asks for them
    var pointDiffuse = vec3f(0.0);
    var pointSpec = vec3f(0.0);
    let lightCount = i32(scene.lightCount.x);
    for (var k = 0; k < lightCount; k++) {
      let L = localLight(k, i.world, n, v);
      if (L.att > 0.0) {
        let lcol = scene.lights[k * 2 + 1];
        let nl = max(dot(n, L.ld), 0.0);
        pointDiffuse += lcol.rgb * (L.att * nl);
        pointSpec += lcol.rgb * (pow(max(dot(n, normalize(L.ls + v)), 0.0), 48.0) * scene.lightColor.a * nl * L.att);
      }
    }
    let albedo = i.color.rgb * legacyTexture;
    rgb = albedo * (hemi + scene.lightColor.rgb * ndl * sh + pointDiffuse) + scene.lightColor.rgb * spec + pointSpec;
  }
  let d = length(toCam) * scene.fog.a;
  rgb = mix(rgb, scene.fog.rgb, 1.0 - exp(-d * d));
  if (scene.sky.w > 0.0) {                                       // height fog: thicker low down, thinning upward, summed along the ray to the camera (see \`fogHeightDensity\`)
    let k = max(scene.ground.w, 1e-4);
    let dist = length(toCam);
    let ky = clamp(-k * toCam.y, -60.0, 60.0);
    let atCam = exp(clamp(-k * (scene.camera.y - scene.camera.w), -60.0, 60.0));
    let along = select((1.0 - exp(-ky)) / ky, 1.0, abs(ky) < 1e-3);
    rgb = mix(rgb, scene.fog.rgb, 1.0 - exp(-scene.sky.w * atCam * dist * along));
  }
  return vec4f(rgb, alpha);
}

// ---------- the sky: the environment drawn behind everything, found for each pixel from the inverse of the camera's matrix ----------
struct SkyOut { @builtin(position) clip: vec4f, @location(0) ndc: vec2f };
@vertex
fn vsSky(@builtin(vertex_index) vi: u32) -> SkyOut {
  var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var o: SkyOut;
  o.clip = vec4f(p[vi], 1.0, 1.0);
  o.ndc = p[vi];
  return o;
}
@fragment
fn fsSky(i: SkyOut) -> @location(0) vec4f {
  let inv = mat4x4f(materials[651], materials[652], materials[653], materials[654]);
  let a = inv * vec4f(i.ndc, 0.0, 1.0);
  let b = inv * vec4f(i.ndc, 1.0, 1.0);
  let dir = normalize(b.xyz / b.w - a.xyz / a.w);
  let c = textureSampleLevel(envMap, envSampler, envTurn(dir), materials[641].y).rgb * materials[640].x;
  return vec4f(linearToSrgb(c), 1.0);
}

// ---------- the procedural sky: the atmosphere worked out for each pixel (see sky.js) ----------
${skyWgsl((n) => `materials[${SKY_BLOCK_AT + n}]`)}
// ---------- water: waves lifting the surface, and its colour, reflections, glints and froth (see water.js) ----------
${waterWaveWgsl((e) => `materials[${e}]`)}
${waterShadeWgsl((e) => `materials[${e}]`)}
@fragment
fn fsSkyProc(i: SkyOut) -> @location(0) vec4f {
  let inv = mat4x4f(materials[651], materials[652], materials[653], materials[654]);
  let a = inv * vec4f(i.ndc, 0.0, 1.0);
  let b = inv * vec4f(i.ndc, 1.0, 1.0);
  let dir = normalize(b.xyz / b.w - a.xyz / a.w);
  return vec4f(linearToSrgb(skyColor(dir)), 1.0);
}
`;

const CASCADE_AT = 64 + MAX_POINT_LIGHTS * 8;                // 4 cascade matrices, and the cascade count and normal offsets (72 floats)
const LIGHTX_AT = CASCADE_AT + 72;                            // three more vec4s for each light: direction and kind, cone or panel size, panel axis
const LOCAL_AT = LIGHTX_AT + MAX_POINT_LIGHTS * 12;           // one matrix per local shadow layer, then the texel size and strength
export const SCENE_UNIFORM_FLOATS = LOCAL_AT + MAX_LOCAL_SHADOW_LAYERS * 16 + 4;
export const CASCADE_MATRICES_AT = CASCADE_AT;
export const LIGHT_EXTRA_AT = LIGHTX_AT;
export const LOCAL_SHADOW_MATRICES_AT = LOCAL_AT;
//  // the scene block: matrices and lighting (60 floats), then the point light count and 32 lights of 8 floats
const WRITE_CHUNK = 8192; // instances per writeBuffer call (640 KB)

/** Fill the shared scene uniform block (the same layout in WGSL and GLSL std140). */
/**
 * @param {Float32Array} out @param {import('./camera3d.js').Camera3D} camera @param {object} lighting
 * @param {object | null} [shadow] The sun's cascades
 * @param {{slots: Int32Array, matrices: ArrayLike<number>[], texels: number[], size: number, bias: number, strength: number} | null} [local] The shadow maps of point and spot lights
 */
export function writeSceneUniforms(out, camera, lighting, shadow = null, local = null) {
  const L = { ...createLighting(), ...lighting };
  for (let i = 0; i < 16; i++) out[i] = camera.viewProj[i];
  const ld = L.direction, ll = Math.sqrt(ld[0] * ld[0] + ld[1] * ld[1] + ld[2] * ld[2]) || 1;
  out[16] = ld[0] / ll; out[17] = ld[1] / ll; out[18] = ld[2] / ll; out[19] = 0;
  out[20] = L.color[0]; out[21] = L.color[1]; out[22] = L.color[2]; out[23] = L.specular;
  out[24] = L.ambientSky[0]; out[25] = L.ambientSky[1]; out[26] = L.ambientSky[2]; out[27] = L.fogHeightDensity;
  out[28] = L.ambientGround[0]; out[29] = L.ambientGround[1]; out[30] = L.ambientGround[2]; out[31] = L.fogHeightFalloff;
  out[32] = L.fogColor[0]; out[33] = L.fogColor[1]; out[34] = L.fogColor[2]; out[35] = L.fogDensity;
  out[36] = camera.x; out[37] = camera.y; out[38] = camera.z; out[39] = L.fogHeightBase;
  out.fill(0, CASCADE_AT);
  if (shadow) {
    for (let i = 0; i < 16; i++) out[40 + i] = shadow.matrices[0][i]; // the first cascade's matrix is also the one the depth passes use
    out[56] = 1 / shadow.size; out[57] = shadow.bias; out[58] = shadow.strength; out[59] = shadow.texels[0] * 1.5;
    shadow.matrices.forEach((m, c) => { for (let i = 0; i < 16; i++) out[CASCADE_AT + c * 16 + i] = m[i]; out[CASCADE_AT + 68 + c] = shadow.texels[c] * 1.5; });
    out[CASCADE_AT + 64] = shadow.matrices.length;
  } else {
    for (let i = 40; i < 60; i++) out[i] = 0; // strength 0: no shadows
  }
  const lights = L.pointLights ?? [], n = Math.min(lights.length, MAX_POINT_LIGHTS);
  out[60] = n; out[61] = 0; out[62] = 0; out[63] = 0;
  for (let k = 0; k < n; k++) {
    const l = lights[k], c = l.color ?? [1, 1, 1], inten = l.intensity ?? 1, o = 64 + k * 8, x = LIGHTX_AT + k * 12;
    out[o] = l.x; out[o + 1] = l.y; out[o + 2] = l.z; out[o + 3] = Math.max(l.radius, 1e-3);
    out[o + 4] = c[0] * inten; out[o + 5] = c[1] * inten; out[o + 6] = c[2] * inten; out[o + 7] = local && local.slots[k] >= 0 ? local.slots[k] : -1;
    const type = lightType(l), d = l.direction ?? [0, -1, 0], dl = Math.hypot(d[0], d[1], d[2]) || 1;
    const dx = d[0] / dl, dy = d[1] / dl, dz = d[2] / dl;
    out[x] = dx; out[x + 1] = dy; out[x + 2] = dz; out[x + 3] = type === 'point' ? 0 : type === 'spot' ? 1 : 2;
    out[x + 6] = local?.texels[k] ?? 0; out[x + 7] = local?.bias ?? 0;
    if (type === 'spot') {
      const a = spotAngles(l), co = Math.cos(a.outer);
      out[x + 4] = co; out[x + 5] = 1 / Math.max(Math.cos(a.inner) - co, 1e-4);
    } else if (type === 'area') {
      out[x + 4] = Math.max(l.width ?? 1, 0) / 2; out[x + 5] = Math.max(l.height ?? 1, 0) / 2;
      let r = l.right ? [l.right[0], l.right[1], l.right[2]] : (Math.abs(dy) > 0.99 ? [1, 0, 0] : [dz, 0, -dx]); // a panel facing along the horizon has its right-hand edge level
      const dr = r[0] * dx + r[1] * dy + r[2] * dz;
      r = [r[0] - dx * dr, r[1] - dy * dr, r[2] - dz * dr];
      const rl = Math.hypot(r[0], r[1], r[2]) || 1;
      out[x + 8] = r[0] / rl; out[x + 9] = r[1] / rl; out[x + 10] = r[2] / rl;
    }
  }
  if (local) {
    local.matrices.forEach((m, j) => { for (let i = 0; i < 16; i++) out[LOCAL_AT + j * 16 + i] = m[i]; });
    out[LOCAL_AT + MAX_LOCAL_SHADOW_LAYERS * 16] = 1 / local.size; out[LOCAL_AT + MAX_LOCAL_SHADOW_LAYERS * 16 + 1] = local.strength;
  }
  return out;
}

/** 3D rendering through WebGPU: instanced meshes, depth buffer, optional 4x MSAA. Create with `WebGPURenderer3D.create`. */
export class WebGPURenderer3D {
  static async create(canvas, { antialias = true } = {}) {
    const gpu = globalThis.navigator?.gpu;
    if (!gpu) throw new Error('WebGPU unavailable');
    const adapter = await gpu.requestAdapter();
    if (!adapter) throw new Error('no WebGPU adapter');
    const requiredFeatures = ['texture-compression-bc', 'texture-compression-etc2', 'texture-compression-astc'].filter((f) => adapter.features?.has(f));   // for compressed texture sets
    const device = await adapter.requestDevice({ requiredFeatures });
    const context = canvas.getContext('webgpu');
    if (!context) throw new Error('WebGPU canvas context unavailable');
    return new WebGPURenderer3D(canvas, device, context, gpu.getPreferredCanvasFormat(), antialias ? 4 : 1);
  }

  constructor(canvas, device, context, format, samples) {
    this.kind = 'webgpu';
    this.canvas = canvas;
    this.device = device;
    this.context = context;
    this.format = format;
    this.samples = samples;
    this.lost = false;
    this.onLost = null;
    this.lastError = '';
    this.sceneData = new Float32Array(SCENE_UNIFORM_FLOATS);
    this.instanceCapacity = 0;
    this.instanceBuffer = null;
    this.meshes = new WeakMap();
    this.skinMeshes = new WeakMap();
    this.skinInstanceCapacity = 0;
    this.skinInstanceBuffer = null;
    this.paletteCapacity = 0; // in matrices
    this.paletteBuffer = null;
    this.skinBindGroup = null;
    this.particles = null; // created at the first particle batch
    this.post = null; // created when post-processing is first asked for
    this.colorTexture = null; this.targetFormat = null;
    this.depthTexture = null;
    this.targetW = 0; this.targetH = 0;
    device.lost.then((info) => { this.lost = true; this.onLost?.(info); });
    device.addEventListener?.('uncapturederror', (e) => { this.lastError = e.error?.message ?? String(e.error); console.error(`WebGPU validation error: ${this.lastError}`); });
    context.configure({ device, format, alphaMode: 'opaque' });

    const module = device.createShaderModule({ code: WGSL });
    module.getCompilationInfo?.().then((info) => {
      for (const m of info.messages) if (m.type === 'error') { this.lastError = `WGSL line ${m.lineNum}: ${m.message}`; console.error(`WebGPU shader error: ${this.lastError}`); }
    });
    this.module = module;
    this.sceneFormat = null;
    this.#buildScenePipelines(format);
    const shadowTarget = { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'less', depthBias: 2, depthBiasSlopeScale: 2 };
    const meshPositionOnly = { arrayStride: VERTEX_BYTES, stepMode: 'vertex', attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] };
    const modelAttributes = (stride) => ({ arrayStride: stride, stepMode: 'instance', attributes: [
      { shaderLocation: 2, offset: 0, format: 'float32x4' }, { shaderLocation: 3, offset: 16, format: 'float32x4' },
      { shaderLocation: 4, offset: 32, format: 'float32x4' }, { shaderLocation: 5, offset: 48, format: 'float32x4' },
      { shaderLocation: 6, offset: 64, format: 'float32x4' },
    ] });
    this.shadowPipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module, entryPoint: 'vsShadow', buffers: [meshPositionOnly, modelAttributes(INSTANCE3D_BYTES)] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: shadowTarget,
    });
    this.shadowSkinPipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module, entryPoint: 'vsShadowSkin', buffers: [
        meshPositionOnly,
        { ...modelAttributes(SKINNED_INSTANCE_BYTES), attributes: [...modelAttributes(0).attributes, { shaderLocation: 7, offset: 80, format: 'float32x4' }] },
        { arrayStride: SKIN_BYTES, stepMode: 'vertex', attributes: [{ shaderLocation: 8, offset: 0, format: 'float32x4' }, { shaderLocation: 9, offset: 16, format: 'float32x4' }] },
      ] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: shadowTarget,
    });
    this.shadowSampler = device.createSampler({ compare: 'less', magFilter: 'linear', minFilter: 'linear' });
    this.textureSet = null;
    this.texture = null;
    this.textureSource = null;
    this.uploadedLayers = 0;
    this.layerVersions = [];
    this.textureSampler = device.createSampler({ addressModeU: 'repeat', addressModeV: 'repeat', magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear', maxAnisotropy: 8 });
    this.whiteTexture = device.createTexture({ size: [1, 1, 1], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
    device.queue.writeTexture({ texture: this.whiteTexture }, new Uint8Array([255, 255, 255, 255]), { bytesPerRow: 4 }, [1, 1, 1]);
    this.zeroUvBuffer = null;
    this.zeroUvCapacity = 0;
    this.shadowSize = 0;
    this.shadowTexture = null;
    this.localShadowTexture = null; this.localSize = 0; this.localLayers = 0; this.localLayerViews = []; // the maps of point and spot lights
    this.localMatrixPool = Array.from({ length: MAX_LOCAL_SHADOW_LAYERS }, () => new Float64Array(16));
    this.cascadeBuffers = []; // one copy of the scene block per cascade, with that cascade's matrix where the depth pass reads it
    this.cascadeData = new Float32Array(SCENE_UNIFORM_FLOATS);
    this.cascadeMatrices = Array.from({ length: MAX_CASCADES }, () => new Float64Array(16));
    this.dummyShadow = device.createTexture({ size: [1, 1], format: 'depth32float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT });
    this.sceneBuffer = device.createBuffer({ size: SCENE_UNIFORM_FLOATS * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.materialBuffer = device.createBuffer({ size: (ENV_BLOCK_AT + ENV_BLOCK_VEC4S) * 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.environment = null;
    this.envSource = 0;
    this.envTable = new Float32Array((ENV_BLOCK_AT + ENV_BLOCK_VEC4S) * 4);
    this.envState = { lighting: false, sky: false };
    this.envSampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge', addressModeW: 'clamp-to-edge' });
    this.dummyEnv = device.createTexture({ size: [1, 1, 6], format: 'rgba16float', usage: GPUTextureUsage.TEXTURE_BINDING });
    this.envTexture = null;
    this.envView = this.dummyEnv.createView({ dimension: 'cube' });
    this.skyBindGroup = null;
    this.materialSet = null;
    this.materialVersion = -1;
    this.shadowMatrix = new Float64Array(16);
    this.bindGroup = null; this.blendBindGroup = null; this.shadowBindGroups = []; this.shadowSkinBindGroups = [];
  }

  /** The pipelines that draw the scene into a target of this format (the canvas's, or half-float HDR when post-processing is on). */
  #buildScenePipelines(format) {
    const { device, samples, module } = this;
    this.sceneFormat = format;
    this.bindGroup = null; this.blendBindGroup = null; this.skinBindGroup = null;
    this.particles?.destroy(); this.particles = null;
    const makePipeline = (depthWrite) => device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module, entryPoint: 'vs',
        buffers: [
          { arrayStride: VERTEX_BYTES, stepMode: 'vertex', attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }, { shaderLocation: 1, offset: 12, format: 'float32x3' }] },
          { arrayStride: INSTANCE3D_BYTES, stepMode: 'instance', attributes: [
            { shaderLocation: 2, offset: 0, format: 'float32x4' }, { shaderLocation: 3, offset: 16, format: 'float32x4' },
            { shaderLocation: 4, offset: 32, format: 'float32x4' }, { shaderLocation: 5, offset: 48, format: 'float32x4' },
            { shaderLocation: 6, offset: 64, format: 'float32x4' }, { shaderLocation: 10, offset: 80, format: 'float32x4' },
          ] },
          { arrayStride: 8, stepMode: 'vertex', attributes: [{ shaderLocation: 11, offset: 0, format: 'float32x2' }] },
        ],
      },
      fragment: {
        module, entryPoint: 'fs',
        targets: [{ format, blend: {
          color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
          alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
        } }],
      },
      primitive: { topology: 'triangle-list', cullMode: 'back', frontFace: 'ccw' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: depthWrite, depthCompare: 'less' },
      multisample: { count: samples },
    });
    this.pipeline = makePipeline(true);
    this.blendPipeline = makePipeline(false);          // the same, for translucent things: they test the depth but do not write it
    this.skyPipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module, entryPoint: 'vsSky' },
      fragment: { module, entryPoint: 'fsSky', targets: [{ format }] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'always' },
      multisample: { count: samples },
    });
    this.skyProcPipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module, entryPoint: 'vsSky' },
      fragment: { module, entryPoint: 'fsSkyProc', targets: [{ format }] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'always' },
      multisample: { count: samples },
    });
    this.skyProcBindGroup = null;
    this.skyBindGroup = null;
    this.skinPipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module, entryPoint: 'vsSkin',
        buffers: [
          { arrayStride: VERTEX_BYTES, stepMode: 'vertex', attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }, { shaderLocation: 1, offset: 12, format: 'float32x3' }] },
          { arrayStride: SKINNED_INSTANCE_BYTES, stepMode: 'instance', attributes: [
            { shaderLocation: 2, offset: 0, format: 'float32x4' }, { shaderLocation: 3, offset: 16, format: 'float32x4' },
            { shaderLocation: 4, offset: 32, format: 'float32x4' }, { shaderLocation: 5, offset: 48, format: 'float32x4' },
            { shaderLocation: 6, offset: 64, format: 'float32x4' }, { shaderLocation: 7, offset: 80, format: 'float32x4' }, { shaderLocation: 10, offset: 96, format: 'float32x4' },
          ] },
          { arrayStride: SKIN_BYTES, stepMode: 'vertex', attributes: [{ shaderLocation: 8, offset: 0, format: 'float32x4' }, { shaderLocation: 9, offset: 16, format: 'float32x4' }] },
          { arrayStride: 8, stepMode: 'vertex', attributes: [{ shaderLocation: 11, offset: 0, format: 'float32x2' }] },
        ],
      },
      fragment: {
        module, entryPoint: 'fs',
        targets: [{ format, blend: {
          color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
          alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
        } }],
      },
      primitive: { topology: 'triangle-list', cullMode: 'back', frontFace: 'ccw' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' },
      multisample: { count: samples },
    });
  }

  resize(cssW, cssH, dpr = 1) {
    this.canvas.width = Math.max(1, Math.round(cssW * dpr));
    this.canvas.height = Math.max(1, Math.round(cssH * dpr));
    if (this.canvas.style) { this.canvas.style.width = `${cssW}px`; this.canvas.style.height = `${cssH}px`; }
  }

  #gpuMesh(mesh) {
    let m = this.meshes.get(mesh);
    if (m) {
      if (m.version !== (mesh.version | 0)) { this.device.queue.writeBuffer(m.vb, 0, mesh.vertices); m.version = mesh.version | 0; }   // a morphed mesh: its vertices changed
      return m;
    }
    const { device } = this;
    let ub = null;
    if (mesh.uv) {
      ub = device.createBuffer({ size: mesh.uv.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
      device.queue.writeBuffer(ub, 0, mesh.uv);
    }
    const vb = device.createBuffer({ size: mesh.vertices.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(vb, 0, mesh.vertices);
    const ib = device.createBuffer({ size: mesh.indices.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(ib, 0, mesh.indices);
    m = { vb, ib, ub, vertexCount: mesh.vertexCount, indexCount: mesh.indices.length, version: mesh.version | 0 };
    this.meshes.set(mesh, m);
    return m;
  }

  #gpuSkinMesh(mesh) {
    let m = this.skinMeshes.get(mesh);
    if (m) { this.#gpuMesh(mesh); return m; }
    const { device } = this;
    const plain = this.#gpuMesh(mesh);
    const sb = device.createBuffer({ size: mesh.skin.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(sb, 0, mesh.skin);
    m = { vb: plain.vb, ib: plain.ib, ub: plain.ub, vertexCount: plain.vertexCount, sb, indexCount: plain.indexCount };
    this.skinMeshes.set(mesh, m);
    return m;
  }

  /** Free the GPU buffers of a mesh you will not draw again. */
  releaseMesh(mesh) {
    const m = this.meshes.get(mesh);
    if (m) { m.vb.destroy(); m.ib.destroy(); m.ub?.destroy(); this.meshes.delete(mesh); }
    const s = this.skinMeshes.get(mesh);
    if (s) { s.sb.destroy(); this.skinMeshes.delete(mesh); }
  }

  /** What the main shaders read besides the scene block: the shadow map and the texture array. */
  #shadowEntries() {
    return [
      { binding: 2, resource: (this.shadowTexture ?? this.dummyShadow).createView({ dimension: '2d-array' }) }, { binding: 3, resource: this.shadowSampler },
      { binding: 9, resource: (this.localShadowTexture ?? this.dummyShadow).createView({ dimension: '2d-array' }) },
      { binding: 4, resource: (this.texture ?? this.whiteTexture).createView({ dimension: '2d-array' }) }, { binding: 5, resource: this.textureSampler },
      { binding: 6, resource: { buffer: this.materialBuffer } }, { binding: 7, resource: this.envView }, { binding: 8, resource: this.envSampler },
    ];
  }

  /**
   * Use these textures for instances that ask for one (`DrawList3D.setMaterial`). New layers added to the set later are uploaded
   * at the next `render`. Layers that were never added read as black.
   * @param {import('./textures.js').TextureSet | null} set
   */
  setTextures(set) { this.textureSet = set; }

  /**
   * Use these physically based materials for instances that ask for one (`DrawList3D.setSurface`). Changes to the set are uploaded at the next `render`.
   * The pictures a material refers to are layers of the set given to `setTextures`.
   * @param {import('./materials.js').MaterialSet | null} set
   */
  setMaterials(set) { this.materialSet = set; this.materialVersion = -1; }

  /**
   * Light physically based surfaces with this environment (and draw it as the sky): see `environment.js` for how to make one. Pass null to go back to the plain ambient colours.
   * Each frame's `lighting.environment` can change how it is used (`{ intensity, rotation, sky, skyBlur }`) or turn it off (`false`).
   * @param {import('./environment.js').Environment | null} env
   */
  setEnvironment(env) { this.environment = env; }

  #syncEnvironment() {
    const env = this.environment;
    const id = env ? env.id : 0;
    if (id === this.envSource) return;
    this.envTexture?.destroy();
    this.envTexture = null;
    this.envSource = id;
    this.bindGroup = null; this.blendBindGroup = null; this.skinBindGroup = null; this.skyBindGroup = null;
    if (!env) { this.envView = this.dummyEnv.createView({ dimension: 'cube' }); return; }
    this.envTexture = this.device.createTexture({ size: [env.size, env.size, 6], mipLevelCount: env.levels.length, format: 'rgba16float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
    env.levels.forEach((level, mip) => {
      for (let face = 0; face < 6; face++) {
        this.device.queue.writeTexture({ texture: this.envTexture, mipLevel: mip, origin: [0, 0, face] }, halfFaceData(level, face), { bytesPerRow: level.size * 8, rowsPerImage: level.size }, [level.size, level.size, 1]);
      }
    });
    this.envView = this.envTexture.createView({ dimension: 'cube' });
  }

  /** The environment's numbers for this frame (settings, harmonics, the inverse of the camera's matrix for the sky). */
  #writeEnvironment(camera, lighting) {
    const inv = (this.envInverse ??= new Float64Array(16));
    mat4.invert(inv, camera.viewProj);                                // fills `inv`
    this.envState = writeEnvironmentBlock(this.envTable, this.environment, lighting?.environment, inv);
    if (lighting?.sky) {                                              // a procedural sky replaces the environment's own picture (the environment still lights things)
      writeSkyBlock(this.envTable, SKY_BLOCK_AT, lighting.sky);
      for (let k = 0; k < 16; k++) this.envTable[ENV_BLOCK_AT * 4 + 44 + k] = inv[k];
      this.envState = { ...this.envState, sky: false, proceduralSky: true };
    }
    if (lighting?.water) writeWaterBlock(this.envTable, WATER_BLOCK_AT, lighting.water, lighting.sky ? 2 : this.envState.lighting ? 1 : 0);
    this.device.queue.writeBuffer(this.materialBuffer, ENV_BLOCK_AT * 16, this.envTable, ENV_BLOCK_AT * 4, ENV_BLOCK_VEC4S * 4);
  }

  #syncMaterials() {
    const set = this.materialSet;
    if (!set || this.materialVersion === set.version) return;
    this.device.queue.writeBuffer(this.materialBuffer, 0, set.data);
    this.materialVersion = set.version;
  }

  #syncTextures() {
    const set = this.textureSet;
    if (!set) {
      if (this.texture) { this.texture = null; this.textureSource = null; this.bindGroup = null; this.blendBindGroup = null; this.skinBindGroup = null; }
      return;
    }
    if (this.textureSource !== set) { // a different set: a fresh texture array
      this.texture?.destroy();
      const info = textureFormatInfo(set.format);
      if (info.feature && !this.device.features.has(info.feature)) throw new Error(`this graphics card cannot read ${set.format} textures (WebGPU feature ${info.feature}); use a set of another format`);
      this.texture = this.device.createTexture({ size: [set.size, set.size, set.maxLayers], mipLevelCount: set.levels, format: info.gpu, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
      this.textureSource = set;
      this.uploadedLayers = 0;
      this.layerVersions = [];
      this.bindGroup = null; this.blendBindGroup = null; this.skinBindGroup = null;
    }
    for (; this.uploadedLayers < set.layers.length; this.uploadedLayers++) this.#uploadLayer(set, this.uploadedLayers);
    for (let i = 0; i < this.uploadedLayers; i++) if (this.layerVersions[i] !== set.layers[i].version) this.#uploadLayer(set, i);      // a layer changed by `update` (a video frame)
  }

  #uploadLayer(set, index) {
    const layer = set.layers[index], info = textureFormatInfo(set.format);
    for (let level = 0; level < set.levels; level++) {
      const s = Math.max(1, set.size >> level), blocks = Math.ceil(s / info.block), padded = blocks * info.block;     // a compressed level is copied as whole blocks
      this.device.queue.writeTexture({ texture: this.texture, mipLevel: level, origin: [0, 0, index] }, layer.mips[level], { bytesPerRow: blocks * info.bytes, rowsPerImage: blocks }, [padded, padded, 1]);
    }
    this.layerVersions[index] = layer.version;
  }

  /** A buffer of zeros to stand in for the texture coordinates of meshes that have none (at least `vertices` of them). */
  #ensureZeroUv(vertices) {
    if (this.zeroUvBuffer && this.zeroUvCapacity >= vertices) return;
    this.zeroUvCapacity = Math.max(vertices, this.zeroUvCapacity * 2, 1024);
    this.zeroUvBuffer = this.device.createBuffer({ size: this.zeroUvCapacity * 8, usage: GPUBufferUsage.VERTEX }); // buffers start out zeroed
  }

  /** (Re)allocate the shadow map when shadows are on or their resolution changed. */
  #shadowTarget(size, layers = 1) {
    if (this.shadowTexture && this.shadowSize === size && this.shadowLayers === layers) return;
    this.shadowTexture?.destroy();
    this.shadowTexture = this.device.createTexture({ size: [size, size, layers], format: 'depth32float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
    this.shadowSize = size; this.shadowLayers = layers;
    this.shadowLayerViews = Array.from({ length: layers }, (_, i) => this.shadowTexture.createView({ dimension: '2d', baseArrayLayer: i, arrayLayerCount: 1 }));
    this.bindGroup = null; this.blendBindGroup = null; this.skinBindGroup = null;
  }

  /** (Re)allocate the maps of point and spot lights when they are first asked for or their size changes. */
  #localTarget(size, layers) {
    if (this.localShadowTexture && this.localSize === size && this.localLayers === layers) return;
    this.localShadowTexture?.destroy();
    this.localShadowTexture = this.device.createTexture({ size: [size, size, layers], format: 'depth32float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
    this.localSize = size; this.localLayers = layers;
    this.localLayerViews = Array.from({ length: layers }, (_, i) => this.localShadowTexture.createView({ dimension: '2d', baseArrayLayer: i, arrayLayerCount: 1 }));
    this.bindGroup = null; this.blendBindGroup = null; this.skinBindGroup = null;
  }

  /** Upload the skinned instances and their palettes; returns what to draw. */
  #prepareSkinned(list) {
    const { device } = this;
    let instances = 0, matrices = 0;
    for (const g of list.skinned.values()) { instances += g.count; matrices += g.count * g.jointCount; }
    if (instances === 0) return [];
    if (instances > this.skinInstanceCapacity) {
      this.skinInstanceBuffer?.destroy();
      this.skinInstanceCapacity = Math.max(instances, this.skinInstanceCapacity * 2, 64);
      this.skinInstanceBuffer = device.createBuffer({ size: this.skinInstanceCapacity * SKINNED_INSTANCE_BYTES, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    }
    if (matrices > this.paletteCapacity) {
      this.paletteBuffer?.destroy();
      this.paletteCapacity = Math.max(matrices, this.paletteCapacity * 2, 1024);
      this.paletteBuffer = device.createBuffer({ size: this.paletteCapacity * 64, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
      this.skinBindGroup = null; this.shadowSkinBindGroups = [];
    }
    this.skinBindGroup ??= device.createBindGroup({ layout: this.skinPipeline.getBindGroupLayout(0), entries: [
      { binding: 0, resource: { buffer: this.sceneBuffer } }, { binding: 1, resource: { buffer: this.paletteBuffer } }, ...this.#shadowEntries(),
    ] });
    this.cascadeBuffers.forEach((buf, i) => {
      this.shadowSkinBindGroups[i] ??= device.createBindGroup({ layout: this.shadowSkinPipeline.getBindGroupLayout(0), entries: [
        { binding: 0, resource: { buffer: buf } }, { binding: 1, resource: { buffer: this.paletteBuffer } },
      ] });
    });
    const draws = [];
    let firstInstance = 0, firstMatrix = 0;
    for (const [mesh, g] of list.skinned) {
      if (g.count === 0) continue;
      for (let i = 0; i < g.count; i++) g.data[i * SKINNED_INSTANCE_FLOATS + 20] = firstMatrix + i * g.jointCount; // where this instance's palette starts
      device.queue.writeBuffer(this.skinInstanceBuffer, firstInstance * SKINNED_INSTANCE_BYTES, g.data, 0, g.count * SKINNED_INSTANCE_FLOATS);
      device.queue.writeBuffer(this.paletteBuffer, firstMatrix * 64, g.palettes, 0, g.count * g.jointCount * 16);
      draws.push({ gpu: this.#gpuSkinMesh(mesh), first: firstInstance, count: g.count });
      firstInstance += g.count; firstMatrix += g.count * g.jointCount;
    }
    return draws;
  }

  #targets() {
    const w = this.canvas.width, h = this.canvas.height;
    if (this.depthTexture && w === this.targetW && h === this.targetH && this.targetFormat === this.sceneFormat) return;
    this.targetFormat = this.sceneFormat;
    this.colorTexture?.destroy(); this.depthTexture?.destroy();
    this.targetW = w; this.targetH = h;
    this.depthTexture = this.device.createTexture({ size: [w, h], format: 'depth24plus', sampleCount: this.samples, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
    this.colorTexture = this.samples > 1 ? this.device.createTexture({ size: [w, h], format: this.sceneFormat, sampleCount: this.samples, usage: GPUTextureUsage.RENDER_ATTACHMENT }) : null;
  }

  /**
   * @param {object} frame
   * @param {import('./camera3d.js').Camera3D} frame.camera
   * @param {import('./drawlist.js').DrawList3D} frame.list
   * @param {number[]} [frame.clear] RGBA 0..1
   * @param {Partial<ReturnType<typeof createLighting>>} [frame.lighting]
   */
  render({ camera, list, clear = [0.55, 0.65, 0.78, 1], lighting, shadows, localShadows, particles, post }) {
    if (this.lost) return;
    const { device } = this;
    const wantFormat = post ? HDR_FORMAT : this.format; // with post-processing the scene is drawn in half-float and finished on a second pass
    if (wantFormat !== this.sceneFormat) this.#buildScenePipelines(wantFormat);
    camera.update();
    if (post) { this.post ??= new GPUPost(device, this.format, this.samples); this.post.prepare(this.canvas.width, this.canvas.height, post, camera); }
    this.#targets();
    this.#syncTextures();
    this.#syncMaterials();
    this.#syncEnvironment();
    let shadow = null;
    if (shadows) {
      const o = resolveShadowOptions(shadows === true ? {} : shadows);
      this.#shadowTarget(o.size, o.cascades);
      const texels = computeCascades(this.cascadeMatrices, camera, { ...createLighting(), ...lighting }.direction, o);
      shadow = { matrices: this.cascadeMatrices.slice(0, o.cascades), size: o.size, bias: o.bias, strength: o.strength, texels };
    }
    let local = null; // the shadow maps of point and spot lights that ask for them (`castShadow`), nearest first, as many as fit the layer budget
    const lights = ({ ...createLighting(), ...lighting }.pointLights ?? []).slice(0, MAX_POINT_LIGHTS);
    if (localShadows !== false && lights.some((l) => l.castShadow)) {
      const o = resolveLocalShadowOptions(localShadows ?? {});
      const plan = planLocalShadows(lights, camera, o.layers);
      if (plan.layers.length > 0) {
        this.#localTarget(o.size, o.layers);
        const texels = new Array(lights.length).fill(0);
        const matrices = plan.layers.map(({ light, face }, j) => { texels[light] = computeLocalMatrix(this.localMatrixPool[j], lights[light], face, o.size); return this.localMatrixPool[j]; });
        local = { slots: plan.slots, matrices, texels, size: o.size, bias: o.bias, strength: o.strength };
      }
    }
    this.#writeEnvironment(camera, lighting);
    this.bindGroup ??= device.createBindGroup({ layout: this.pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: this.sceneBuffer } }, ...this.#shadowEntries()] });
    if (list.blended.size > 0) this.blendBindGroup ??= device.createBindGroup({ layout: this.blendPipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: this.sceneBuffer } }, ...this.#shadowEntries()] });
    writeSceneUniforms(this.sceneData, camera, lighting, shadow, local);
    device.queue.writeBuffer(this.sceneBuffer, 0, this.sceneData);
    const cascades = shadow ? shadow.matrices.length : 0, passes = cascades + (local ? local.matrices.length : 0);
    for (let c = 0; c < passes; c++) { // each depth pass reads its own copy of the scene block, whose light matrix is that cascade's (or that layer of a point or spot light's)
      this.cascadeBuffers[c] ??= device.createBuffer({ size: SCENE_UNIFORM_FLOATS * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      this.cascadeData.set(this.sceneData);
      const matrix = c < cascades ? shadow.matrices[c] : local.matrices[c - cascades];
      for (let i = 0; i < 16; i++) this.cascadeData[40 + i] = matrix[i];
      device.queue.writeBuffer(this.cascadeBuffers[c], 0, this.cascadeData);
      this.shadowBindGroups[c] ??= device.createBindGroup({ layout: this.shadowPipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: this.cascadeBuffers[c] } }] });
    }

    // all instances of all meshes into one buffer, each mesh's range remembered. After them come the instances of each sun cascade: only the ones that can touch that cascade's box, since
    // most of a big world is far outside the small box round the camera (the main pass draws the first part; each cascade's depth pass draws its own part, and the maps come out the same).
    let total = 0;
    for (const g of list.groups.values()) total += g.count;
    for (const g of list.blended.values()) total += g.count;
    const cuts = [];
    let extra = 0;
    const cutting = cascades > 0 && total > 0 && this.cullCascades !== false;
    const need = total * (1 + (cutting ? cascades : 0)) * INSTANCE3D_FLOATS;
    if (!this.staging || this.staging.length < need) this.staging = new Float32Array(Math.max(need, 4096));   // every instance of the frame, copied here once, then sent in a few big pieces
    if (cutting) {
      for (let c = 0; c < cascades; c++) {
        const r = packInstancesForLight(list.groups, shadow.matrices[c], INSTANCE3D_FLOATS, this.staging, total + extra);
        cuts.push(r.parts);
        extra += r.rows;
      }
    }
    if (total + extra > this.instanceCapacity) {
      this.instanceBuffer?.destroy();
      this.instanceCapacity = Math.max(total + extra, this.instanceCapacity * 2, 256);
      this.instanceBuffer = device.createBuffer({ size: this.instanceCapacity * INSTANCE3D_BYTES, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    }
    const draws = [];
    let first = 0;
    for (const [mesh, g] of list.groups) {
      if (g.count === 0) continue;
      this.staging.set(g.count * INSTANCE3D_FLOATS === g.data.length ? g.data : g.data.subarray(0, g.count * INSTANCE3D_FLOATS), first * INSTANCE3D_FLOATS);
      draws.push({ gpu: this.#gpuMesh(mesh), first, count: g.count });
      first += g.count;
    }
    const blendDraws = [];                                            // the translucent ones follow the solid ones in the buffer (and are in no shadow pass)
    for (const [mesh, g] of list.blended) {
      if (g.count === 0) continue;
      this.staging.set(g.count * INSTANCE3D_FLOATS === g.data.length ? g.data : g.data.subarray(0, g.count * INSTANCE3D_FLOATS), first * INSTANCE3D_FLOATS);
      blendDraws.push({ gpu: this.#gpuMesh(mesh), first, count: g.count });
      first += g.count;
    }
    for (let k = 0; k < total + extra; k += WRITE_CHUNK) {         // in chunks: one very large writeBuffer is much slower than the same bytes in pieces
      const n = Math.min(WRITE_CHUNK, total + extra - k);
      device.queue.writeBuffer(this.instanceBuffer, k * INSTANCE3D_BYTES, this.staging, k * INSTANCE3D_FLOATS, n * INSTANCE3D_FLOATS);
    }
    const cutDraws = cuts.map((parts) => parts.map((p) => ({ gpu: this.#gpuMesh(p.mesh), first: p.row, count: p.count })));

    let particleCount = 0;
    if (particles && particles.count > 0) { this.particles ??= new GPUParticles(device, this.sceneFormat, this.samples); particleCount = this.particles.prepare(particles, camera); }
    const skinDraws = this.#prepareSkinned(list);
    let zeroNeeded = 0; // meshes without texture coordinates read zeros
    for (const d of blendDraws) if (!d.gpu.ub) zeroNeeded = Math.max(zeroNeeded, d.gpu.vertexCount);
    for (const d of draws) if (!d.gpu.ub) zeroNeeded = Math.max(zeroNeeded, d.gpu.vertexCount);
    for (const d of skinDraws) if (!d.gpu.ub) zeroNeeded = Math.max(zeroNeeded, d.gpu.vertexCount);
    if (zeroNeeded > 0) this.#ensureZeroUv(zeroNeeded);

    const encoder = device.createCommandEncoder();
    if (passes > 0) { // first the world as the lights see it (depth only)
      for (let ci = 0; ci < passes; ci++) {
      const sp = encoder.beginRenderPass({ colorAttachments: [], depthStencilAttachment: { view: ci < cascades ? this.shadowLayerViews[ci] : this.localLayerViews[ci - cascades], depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' } });
      const mine = ci < cascades ? cutDraws[ci] ?? draws : draws;                     // a sun cascade draws only what can reach its box
      if (mine.length > 0) {
        sp.setPipeline(this.shadowPipeline);
        sp.setBindGroup(0, this.shadowBindGroups[ci]);
        sp.setVertexBuffer(1, this.instanceBuffer);
        for (const d of mine) {
          sp.setVertexBuffer(0, d.gpu.vb);
          sp.setIndexBuffer(d.gpu.ib, 'uint32');
          sp.drawIndexed(d.gpu.indexCount, d.count, 0, 0, d.first);
        }
      }
      if (skinDraws.length > 0) {
        sp.setPipeline(this.shadowSkinPipeline);
        sp.setBindGroup(0, this.shadowSkinBindGroups[ci]);
        sp.setVertexBuffer(1, this.skinInstanceBuffer);
        for (const d of skinDraws) {
          sp.setVertexBuffer(0, d.gpu.vb);
          sp.setVertexBuffer(2, d.gpu.sb);
          sp.setIndexBuffer(d.gpu.ib, 'uint32');
          sp.drawIndexed(d.gpu.indexCount, d.count, 0, 0, d.first);
        }
      }
      sp.end();
      }
    }
    const swap = this.context.getCurrentTexture().createView();
    const msaa = this.samples > 1;
    const target = post ? this.post.sceneView : swap; // where the finished scene lands
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: msaa ? this.colorTexture.createView() : target,
        resolveTarget: msaa ? target : undefined,
        clearValue: { r: clear[0], g: clear[1], b: clear[2], a: clear[3] },
        loadOp: 'clear', storeOp: msaa ? 'discard' : 'store',
      }],
      depthStencilAttachment: { view: this.depthTexture.createView(), depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: post && this.post.options.needsDepth ? 'store' : 'discard' }, // ambient occlusion and depth of field read it
    });
    if (this.envState.proceduralSky) {
      this.skyProcBindGroup ??= device.createBindGroup({ layout: this.skyProcPipeline.getBindGroupLayout(0), entries: [{ binding: 6, resource: { buffer: this.materialBuffer } }] });
      pass.setPipeline(this.skyProcPipeline);
      pass.setBindGroup(0, this.skyProcBindGroup);
      pass.draw(3);
    } else if (this.envState.sky) {                                       // first, so that everything else (blended surfaces too) is drawn over it
      this.skyBindGroup ??= device.createBindGroup({ layout: this.skyPipeline.getBindGroupLayout(0), entries: [
        { binding: 6, resource: { buffer: this.materialBuffer } }, { binding: 7, resource: this.envView }, { binding: 8, resource: this.envSampler }] });
      pass.setPipeline(this.skyPipeline);
      pass.setBindGroup(0, this.skyBindGroup);
      pass.draw(3);
    }
    if (draws.length > 0) {
      pass.setPipeline(this.pipeline);
      pass.setBindGroup(0, this.bindGroup);
      pass.setVertexBuffer(1, this.instanceBuffer);
      for (const d of draws) {
        pass.setVertexBuffer(0, d.gpu.vb);
        pass.setVertexBuffer(2, d.gpu.ub ?? this.zeroUvBuffer);
        pass.setIndexBuffer(d.gpu.ib, 'uint32');
        pass.drawIndexed(d.gpu.indexCount, d.count, 0, 0, d.first);
      }
    }
    if (skinDraws.length > 0) {
      pass.setPipeline(this.skinPipeline);
      pass.setBindGroup(0, this.skinBindGroup);
      pass.setVertexBuffer(1, this.skinInstanceBuffer);
      for (const d of skinDraws) {
        pass.setVertexBuffer(0, d.gpu.vb);
        pass.setVertexBuffer(2, d.gpu.sb);
        pass.setVertexBuffer(3, d.gpu.ub ?? this.zeroUvBuffer);
        pass.setIndexBuffer(d.gpu.ib, 'uint32');
        pass.drawIndexed(d.gpu.indexCount, d.count, 0, 0, d.first);
      }
    }
    if (blendDraws.length > 0) {                                       // translucent things: over the solid scene, before the particles
      pass.setPipeline(this.blendPipeline);
      pass.setBindGroup(0, this.blendBindGroup);
      pass.setVertexBuffer(1, this.instanceBuffer);
      for (const d of blendDraws) {
        pass.setVertexBuffer(0, d.gpu.vb);
        pass.setVertexBuffer(2, d.gpu.ub ?? this.zeroUvBuffer);
        pass.setIndexBuffer(d.gpu.ib, 'uint32');
        pass.drawIndexed(d.gpu.indexCount, d.count, 0, 0, d.first);
      }
    }
    if (particleCount > 0) this.particles.draw(pass, particleCount);
    pass.end();
    if (post) this.post.encode(encoder, swap, this.depthTexture);
    device.queue.submit([encoder.finish()]);
    /** What the last frame drew: instances and draw calls in the main pass, and in the sun's depth passes (which draw only what can reach each cascade). */
    this.stats = { instances: total, draws: draws.length, shadowInstances: extra, shadowDraws: cutDraws.reduce((n, d) => n + d.length, 0), cascades };
  }

  destroy() {
    this.particles?.destroy();
    this.post?.destroy();
    this.instanceBuffer?.destroy();
    this.skinInstanceBuffer?.destroy();
    this.paletteBuffer?.destroy();
    this.shadowTexture?.destroy();
    this.localShadowTexture?.destroy();
    this.texture?.destroy();
    this.whiteTexture.destroy();
    this.zeroUvBuffer?.destroy();
    this.dummyShadow.destroy();
    for (const b of this.cascadeBuffers) b.destroy();
    this.sceneBuffer.destroy();
    this.materialBuffer.destroy();
    this.envTexture?.destroy();
    this.dummyEnv.destroy();
    this.colorTexture?.destroy();
    this.depthTexture?.destroy();
    this.device.destroy();
  }
}
