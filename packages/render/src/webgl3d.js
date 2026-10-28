import { GLParticles } from './particles-gl.js';
import { textureFormatInfo } from './ktx2.js';
import { GLPost } from './post-gl.js';
import { VERTEX_BYTES, SKIN_BYTES } from './mesh.js';
import { INSTANCE3D_FLOATS, INSTANCE3D_BYTES, SKINNED_INSTANCE_FLOATS, SKINNED_INSTANCE_BYTES, MAX_POINT_LIGHTS } from './drawlist.js';
import { SCENE_UNIFORM_FLOATS, writeSceneUniforms } from './webgpu3d.js';
import { computeCascades, packInstancesForLight, resolveShadowOptions, MAX_CASCADES, MAX_LOCAL_SHADOW_LAYERS, resolveLocalShadowOptions, planLocalShadows, computeLocalMatrix } from './shadow.js';
import { createLighting } from './drawlist.js';
import { ENV_BLOCK_AT, ENV_BLOCK_VEC4S, halfFaceData, writeEnvironmentBlock } from './environment.js';
import { SKY_BLOCK_AT, writeSkyBlock } from './sky.js';
import { skyGlsl } from './sky-shaders.js';
import { WATER_BLOCK_AT, writeWaterBlock } from './water.js';
import { waterWaveGlsl, waterShadeGlsl } from './water-shaders.js';
import { mat4 } from '../../math/src/index.js';

const SCENE_BLOCK = `layout(std140) uniform Scene {
  mat4 viewProj;
  vec4 lightDir;
  vec4 lightColor;
  vec4 sky;
  vec4 ground;
  vec4 fog;
  vec4 camera;
  mat4 lightViewProj;
  vec4 shadow;
  vec4 lightCount;
  vec4 lights[64];
  mat4 cascades[4];
  vec4 cascadeInfo;
  vec4 cascadeOff;
  vec4 lightX[96];
  mat4 localMats[12];
  vec4 localInfo;
} scene;`;

const VERT = `#version 300 es
layout(location=0) in vec3 a_pos;
layout(location=1) in vec3 a_nor;
layout(location=2) in vec4 a_m0;
layout(location=3) in vec4 a_m1;
layout(location=4) in vec4 a_m2;
layout(location=5) in vec4 a_m3;
layout(location=6) in vec4 a_color;
layout(location=10) in vec4 a_material;
layout(location=11) in vec2 a_uv;
${SCENE_BLOCK}
layout(std140) uniform Materials { vec4 m[713]; } mats;
${waterWaveGlsl((e) => `mats.m[${e}]`)}
out vec3 v_world;
out vec3 v_nor;
out vec4 v_color;
out vec2 v_uv;
flat out vec4 v_material;
void main() {
  mat4 model = mat4(a_m0, a_m1, a_m2, a_m3);
  vec4 w = model * vec4(a_pos, 1.0);
  if (a_material.y > 3.5) { w.y += waterWave(w.xz, int(a_material.x + 0.5), a_material.z, a_uv.x).x; }          // water: lifted by its waves
  gl_Position = scene.viewProj * w;
  gl_Position.z = gl_Position.z * 2.0 - gl_Position.w; // the matrices give depth 0..1 (WebGPU); WebGL wants -1..1
  v_world = w.xyz;
  v_nor = (model * vec4(a_nor, 0.0)).xyz;
  v_color = a_color;
  v_uv = a_uv;
  v_material = a_material;
}`;

// Skinned meshes: the joint matrices of every skinned instance live in one RGBA32F texture, 4 texels (one matrix) after another,
// 1024 texels per row; an instance's palette starts at matrix number a_pbase.x.
const VERT_SKIN = `#version 300 es
layout(location=0) in vec3 a_pos;
layout(location=1) in vec3 a_nor;
layout(location=2) in vec4 a_m0;
layout(location=3) in vec4 a_m1;
layout(location=4) in vec4 a_m2;
layout(location=5) in vec4 a_m3;
layout(location=6) in vec4 a_color;
layout(location=7) in vec4 a_pbase;
layout(location=8) in vec4 a_joints;
layout(location=9) in vec4 a_weights;
layout(location=10) in vec4 a_material;
layout(location=11) in vec2 a_uv;
${SCENE_BLOCK}
uniform highp sampler2D u_palette;
out vec3 v_world;
out vec3 v_nor;
out vec4 v_color;
out vec2 v_uv;
flat out vec4 v_material;
mat4 joint(int matrixIndex) {
  int t = matrixIndex * 4;
  ivec2 p = ivec2(t & 1023, t >> 10);
  return mat4(texelFetch(u_palette, p, 0), texelFetch(u_palette, p + ivec2(1, 0), 0), texelFetch(u_palette, p + ivec2(2, 0), 0), texelFetch(u_palette, p + ivec2(3, 0), 0));
}
void main() {
  int base = int(a_pbase.x + 0.5);
  ivec4 j = ivec4(a_joints + vec4(0.5));
  mat4 skin = joint(base + j.x) * a_weights.x + joint(base + j.y) * a_weights.y + joint(base + j.z) * a_weights.z + joint(base + j.w) * a_weights.w;
  mat4 model = mat4(a_m0, a_m1, a_m2, a_m3);
  vec4 w = model * (skin * vec4(a_pos, 1.0));
  gl_Position = scene.viewProj * w;
  gl_Position.z = gl_Position.z * 2.0 - gl_Position.w;
  v_world = w.xyz;
  v_nor = (model * (skin * vec4(a_nor, 0.0))).xyz;
  v_color = a_color;
  v_uv = a_uv;
  v_material = a_material;
}`;

/** The main fragment shader. `water` adds the sky and water functions (a lot of code to compile, so only when the renderer was made with `{ water: true }`). */
const makeFrag = (water) => `#version 300 es
precision highp float;
precision highp int;
${SCENE_BLOCK}
in vec3 v_world;
in vec3 v_nor;
in vec4 v_color;
in vec2 v_uv;
flat in vec4 v_material;
out vec4 o;
uniform highp sampler2DArrayShadow u_shadow;
uniform highp sampler2DArrayShadow u_localShadow;
uniform highp sampler2DArray u_tex;
uniform highp samplerCube u_env;
layout(std140) uniform Materials { vec4 m[713]; } mats;   // physically based materials, five vec4s each (see materials.js), then the environment block (see environment.js)
// The texture colour of a surface (white when it has none). Always sampled (derivatives need every pixel to take the same path), with
// explicit gradients so a planar projection that switches axis at a box edge does not pick the wrong mip level there.
vec3 surfaceTexture(vec3 world, vec3 n, vec2 uv, vec4 mat) {
  vec3 an = abs(n);
  vec3 wdx = dFdx(world);
  vec3 wdy = dFdy(world);
  vec2 pu = vec2(world.x, world.z);
  vec2 gx = vec2(wdx.x, wdx.z);
  vec2 gy = vec2(wdy.x, wdy.z);
  if (an.y < an.x || an.y < an.z) {
    if (an.x >= an.z) { pu = vec2(world.z, -world.y); gx = vec2(wdx.z, -wdx.y); gy = vec2(wdy.z, -wdy.y); }
    else { pu = vec2(world.x, -world.y); gx = vec2(wdx.x, -wdx.y); gy = vec2(wdy.x, -wdy.y); }
  }
  bool planar = mat.y > 1.5;
  vec2 coord = planar ? pu * mat.z : uv * mat.z;
  vec2 ddx = planar ? gx * mat.z : dFdx(uv) * mat.z;
  vec2 ddy = planar ? gy * mat.z : dFdy(uv) * mat.z;
  vec3 c = vec3(0.0);
  if (mat.y > 3.5) {                 // water: no picture
    c = vec3(1.0);
  } else if (mat.y > 2.5) {          // terrain splat: layer x holds the weights of the four layers from w, tiled planar by z
    vec4 w = textureGrad(u_tex, vec3(uv, floor(max(mat.x, 0.0) + 0.5)), dFdx(uv), dFdy(uv));
    float base = floor(mat.w + 0.5);
    vec3 c0 = textureGrad(u_tex, vec3(coord, base), ddx, ddy).rgb;
    vec3 c1 = textureGrad(u_tex, vec3(coord, base + 1.0), ddx, ddy).rgb;
    vec3 c2 = textureGrad(u_tex, vec3(coord, base + 2.0), ddx, ddy).rgb;
    vec3 c3 = textureGrad(u_tex, vec3(coord, base + 3.0), ddx, ddy).rgb;
    c = (c0 * w.r + c1 * w.g + c2 * w.b + c3 * w.a) / max(w.r + w.g + w.b + w.a, 0.0001);
  } else {
    c = textureGrad(u_tex, vec3(coord, floor(max(mat.x, 0.0) + 0.5)), ddx, ddy).rgb;
  }
  return mat.x >= 0.0 ? c : vec3(1.0);
}
// Cascaded shadows. One cascade: a 3x3 percentage-closer filter on its map, returning (lit, how close to the edge of its box the point is).
vec2 cascadeLit(int c, vec3 world, vec3 n) {
  vec4 lp = scene.cascades[c] * vec4(world + n * scene.cascadeOff[c], 1.0);
  vec2 uv = vec2(lp.x * 0.5 + 0.5, lp.y * 0.5 + 0.5);
  float z = lp.z - scene.shadow.y;
  float sum = 0.0;
  for (int dx = -1; dx <= 1; dx++) {
    for (int dy = -1; dy <= 1; dy++) {
      sum += texture(u_shadow, vec4(uv + vec2(float(dx), float(dy)) * scene.shadow.x, float(c), z));
    }
  }
  return vec2(sum / 9.0, max(abs(lp.x), abs(lp.y)));
}
// 1 = lit, 0 = in shadow. The first (nearest) cascade whose box holds the point is used, blending into the next one near its edge;
// the farthest cascade fades to lit at its edge.
float shadowLight(vec3 world, vec3 n) {
  if (scene.shadow.z <= 0.0) return 1.0;
  int count = int(scene.cascadeInfo.x);
  float lit = 1.0;
  for (int c = 0; c < 4; c++) {
    if (c >= count) break;
    vec2 r = cascadeLit(c, world, n);
    if (r.y < 1.0) {
      float mine = r.x;
      if (c + 1 == count) mine = mix(r.x, 1.0, smoothstep(0.85, 1.0, r.y));
      lit = mine;
      if (c + 1 < count && r.y > 0.8) {
        vec2 r2 = cascadeLit(c + 1, world, n);
        float next = r2.x;
        if (c + 2 == count) next = mix(r2.x, 1.0, smoothstep(0.85, 1.0, r2.y));
        lit = mix(mine, next, smoothstep(0.8, 0.95, r.y));
      }
      break;
    }
  }
  return 1.0 - scene.shadow.z * (1.0 - lit);
}
// ---------- physically based surfaces (a material number above 0): metal and roughness, GGX highlights, bump, occlusion, emission ----------
const float PI = 3.14159265358979;
vec3 srgbToLinear(vec3 c) { return mix(pow((c + 0.055) / 1.055, vec3(2.4)), c / 12.92, lessThanEqual(c, vec3(0.04045))); }
vec3 linearToSrgb(vec3 c) {
  vec3 x = max(c, vec3(0.0));
  return mix(1.055 * pow(x, vec3(1.0 / 2.4)) - 0.055, x * 12.92, lessThanEqual(x, vec3(0.0031308)));
}
// A layer of the texture array with explicit gradients (so it works inside a branch).
vec4 layerTex(float layer, vec2 uv, vec2 ddx, vec2 ddy) {
  return textureGrad(u_tex, vec3(uv, floor(max(layer, 0.0) + 0.5)), ddx, ddy);
}
// One light on a surface: Lambert diffuse plus GGX specular (Smith height-correlated visibility, Schlick fresnel), times the light and the cosine.
// A light colour of 1 lights a white matte surface to full white, as the simple lighting does.
vec3 brdfLight(vec3 n, vec3 v, vec3 l, vec3 radiance, vec3 f0, vec3 cdiff, float a2) {
  float ndl = max(dot(n, l), 0.0);
  if (ndl <= 0.0) return vec3(0.0);
  float nv = max(dot(n, v), 0.0001);
  vec3 h = normalize(l + v);
  float nh = max(dot(n, h), 0.0);
  float vh = max(dot(v, h), 0.0);
  float dd = nh * nh * (a2 - 1.0) + 1.0;
  float d = a2 / (PI * dd * dd);
  float gv = ndl * sqrt(nv * nv * (1.0 - a2) + a2);
  float gl = nv * sqrt(ndl * ndl * (1.0 - a2) + a2);
  float vis = 0.5 / max(gv + gl, 0.00001);
  float q = 1.0 - vh;
  float q2 = q * q;
  vec3 f = f0 + (vec3(1.0) - f0) * (q2 * q2 * q);
  return (cdiff + f * (d * vis * PI)) * radiance * ndl;
}
// ---------- lights with a place: point, spot and area lights ----------
// The shadow of a point or spot light: the surface is moved a little toward the light and off its own surface (by about a texel, which grows with distance), then compared with the
// light's depth map (a point light picks the face of its cube from the biggest part of the direction to the surface) with a 3x3 filter. 1 = lit, 0 = in shadow.
float localLit(float slot, bool cube, vec3 world, vec3 n, vec3 lpos, vec3 toward, float dist, float texelScale, float bias) {
  vec3 p = world + n * (dist * texelScale * 1.5) + toward * bias;
  float layer = floor(slot + 0.5);
  if (cube) {
    vec3 d = p - lpos;
    vec3 a = abs(d);
    float f = 5.0;
    if (a.x >= a.y && a.x >= a.z) f = d.x > 0.0 ? 0.0 : 1.0;
    else if (a.y >= a.z) f = d.y > 0.0 ? 2.0 : 3.0;
    else f = d.z > 0.0 ? 4.0 : 5.0;
    layer += f;
  }
  vec4 lp = scene.localMats[int(layer)] * vec4(p, 1.0);
  if (lp.w <= 0.0) return 1.0;
  vec2 uv = vec2(lp.x / lp.w * 0.5 + 0.5, lp.y / lp.w * 0.5 + 0.5);
  float z = lp.z / lp.w;
  float sum = 0.0;
  for (int dx = -1; dx <= 1; dx++) {
    for (int dy = -1; dy <= 1; dy++) {
      sum += texture(u_localShadow, vec4(uv + vec2(float(dx), float(dy)) * scene.localInfo.x, layer, z));
    }
  }
  return 1.0 - scene.localInfo.y * (1.0 - sum / 9.0);
}
// What one light does at a surface: the direction its diffuse light comes from (ld), the direction its highlight comes from (ls: the same, except for an area light, where it is the
// point of the panel nearest the mirror direction), and how much of the light's colour arrives (att: range, cone or panel size, and shadow). att 0 means none.
struct Local { vec3 ld; vec3 ls; float att; };
Local localLight(int k, vec3 world, vec3 n, vec3 v) {
  vec4 a = scene.lights[k * 2];
  vec4 b = scene.lights[k * 2 + 1];
  vec4 c = scene.lightX[k * 3];
  vec4 d = scene.lightX[k * 3 + 1];
  Local o;
  o.ld = vec3(0.0); o.ls = vec3(0.0); o.att = 0.0;
  vec3 toLight = a.xyz - world;
  float dist = length(toLight);
  if (dist >= a.w) return o;
  float q = dist / a.w;
  float fade = 1.0 - q * q;
  fade = fade * fade;
  if (c.w > 1.5) {                                   // a rectangular panel, lit on its front face only
    vec3 right = scene.lightX[k * 3 + 2].xyz;
    vec3 up = cross(c.xyz, right);
    vec3 rel = world - a.xyz;
    if (dot(rel, c.xyz) <= 0.0) return o;
    vec3 hit = a.xyz + right * clamp(dot(rel, right), -d.x, d.x) + up * clamp(dot(rel, up), -d.y, d.y);
    vec3 toHit = hit - world;
    float dh = max(length(toHit), 0.0001);
    o.ld = toHit / dh;
    float area = max(4.0 * d.x * d.y, 0.0001);
    o.att = fade * area * max(dot(c.xyz, -o.ld), 0.0) / (dh * dh + area);
    o.ls = o.ld;
    vec3 r = reflect(-v, n);
    float denom = dot(r, c.xyz);
    if (denom < -0.0001) {
      float t = dot(a.xyz - world, c.xyz) / denom;
      if (t > 0.0) {
        vec3 onPlane = world + r * t - a.xyz;
        o.ls = normalize(a.xyz + right * clamp(dot(onPlane, right), -d.x, d.x) + up * clamp(dot(onPlane, up), -d.y, d.y) - world);
      }
    }
    return o;
  }
  o.ld = toLight / max(dist, 0.0001);
  o.ls = o.ld;
  if (dot(n, o.ld) <= 0.0) return o;
  float att = fade;
  if (c.w > 0.5) {                                   // a spot light: smooth edge of the cone
    float cone = clamp((dot(-o.ld, c.xyz) - d.x) * d.y, 0.0, 1.0);
    att = att * cone * cone;
    if (att <= 0.0) return o;
  }
  if (b.w >= 0.0) att = att * localLit(b.w, c.w < 0.5, world, n, a.xyz, o.ld, dist, d.z, d.w);
  o.att = att;
  return o;
}
// A local light on a surface: diffuse from direction ld, GGX highlight from direction ls (the same direction for point and spot lights, so this equals brdfLight).
vec3 brdfLocal(vec3 n, vec3 v, vec3 ld, vec3 ls, vec3 radiance, vec3 f0, vec3 cdiff, float a2) {
  vec3 col = cdiff * radiance * max(dot(n, ld), 0.0);
  float ndl = max(dot(n, ls), 0.0);
  if (ndl > 0.0) {
    float nv = max(dot(n, v), 0.0001);
    vec3 h = normalize(ls + v);
    float nh = max(dot(n, h), 0.0);
    float vh = max(dot(v, h), 0.0);
    float dd = nh * nh * (a2 - 1.0) + 1.0;
    float dg = a2 / (PI * dd * dd);
    float gv = ndl * sqrt(nv * nv * (1.0 - a2) + a2);
    float gl = nv * sqrt(ndl * ndl * (1.0 - a2) + a2);
    float vis = 0.5 / max(gv + gl, 0.00001);
    float qq = 1.0 - vh;
    float q2 = qq * qq;
    vec3 f = f0 + (vec3(1.0) - f0) * (q2 * q2 * qq);
    col += f * (dg * vis * PI) * radiance * ndl;
  }
  return col;
}

// ---------- the environment: light from all around, as nine spherical harmonics (soft diffuse light) and a prefiltered cube (reflections), turned about the vertical axis ----------
bool envOn() { return mats.m[641].x > 0.5; }
vec3 envTurn(vec3 d) {
  vec4 p = mats.m[640];
  return vec3(p.y * d.x - p.z * d.z, d.y, p.z * d.x + p.y * d.z);
}
vec3 envDiffuse(vec3 n) {
  vec3 c = mats.m[642].rgb * 0.282095
    + mats.m[643].rgb * (0.488603 * n.y) + mats.m[644].rgb * (0.488603 * n.z) + mats.m[645].rgb * (0.488603 * n.x)
    + mats.m[646].rgb * (1.092548 * n.x * n.y) + mats.m[647].rgb * (1.092548 * n.y * n.z)
    + mats.m[648].rgb * (0.315392 * (3.0 * n.z * n.z - 1.0)) + mats.m[649].rgb * (1.092548 * n.x * n.z)
    + mats.m[650].rgb * (0.546274 * (n.x * n.x - n.y * n.y));
  return max(c, vec3(0.0)) * mats.m[640].x;
}
vec3 envReflection(vec3 r, float rough) {
  return textureLod(u_env, envTurn(r), rough * mats.m[640].w).rgb * mats.m[640].x;
}
vec4 pbrShade(int id, float sh, vec2 uvdx, vec2 uvdy, vec3 wdx, vec3 wdy) {
  int b = id * 5;
  vec4 m0 = mats.m[b];
  vec4 m1 = mats.m[b + 1];
  vec4 m2 = mats.m[b + 2];
  vec4 m3 = mats.m[b + 3];
  vec4 m4 = mats.m[b + 4];
  vec2 uv = v_uv * m4.y;
  vec2 ddx = uvdx * m4.y;
  vec2 ddy = uvdy * m4.y;
  vec4 base = m0;
  if (m3.x >= 0.0) {
    vec4 t = layerTex(m3.x, uv, ddx, ddy);
    base = vec4(base.rgb * srgbToLinear(t.rgb), base.a * t.a);
  }
  base = vec4(base.rgb * srgbToLinear(v_color.rgb), base.a * v_color.a);
  if (m4.z > 0.5) base.a = v_color.a;                           // an opaque material ignores the alpha of its colour and picture
  if (m2.w > 0.0 && base.a < m2.w) discard;
  float rough = m1.y;
  float metal = m1.x;
  if (m3.y >= 0.0) {
    vec4 t = layerTex(m3.y, uv, ddx, ddy);
    rough = rough * t.g;
    metal = metal * t.b;
  }
  rough = clamp(rough, 0.045, 1.0);
  metal = clamp(metal, 0.0, 1.0);
  float occ = 1.0;
  if (m3.w >= 0.0) occ = 1.0 + m1.w * (layerTex(m3.w, uv, ddx, ddy).r - 1.0);
  vec3 emissive = m2.rgb;
  if (m4.x >= 0.0) emissive = emissive * srgbToLinear(layerTex(m4.x, uv, ddx, ddy).rgb);
  vec3 n = normalize(v_nor);
  if (m3.z >= 0.0) {
    // bump: a tangent frame from how the texture coordinates change across the screen (no tangents are stored with the mesh)
    vec3 tn = layerTex(m3.z, uv, ddx, ddy).xyz * 2.0 - 1.0;
    float det = uvdx.x * uvdy.y - uvdy.x * uvdx.y;
    if (abs(det) > 1e-20) {
      vec3 tr = (uvdy.y * wdx - uvdx.y * wdy) / det;
      vec3 tt = tr - n * dot(n, tr);
      float len2 = dot(tt, tt);
      if (len2 > 1e-20) {
        vec3 t = tt * inversesqrt(len2);
        vec3 bt = cross(n, t);
        n = normalize(t * (tn.x * m1.z) + bt * (tn.y * m1.z) + n * tn.z);
      }
    }
  }
  vec3 v = normalize(scene.camera.xyz - v_world);
  float nv = max(dot(n, v), 0.0001);
  float a2 = pow(rough * rough, 2.0);
  vec3 f0 = mix(vec3(0.04), base.rgb, metal);
  vec3 cdiff = base.rgb * (1.0 - metal);
  // light from all around: the hemisphere of sky and ground, seen directly and reflected, scaled by how much a surface like this reflects (Karis' approximation)
  vec3 r = reflect(-v, n);
  vec3 hemi = mix(scene.ground.rgb, scene.sky.rgb, n.y * 0.5 + 0.5);
  vec3 mirror = mix(scene.ground.rgb, scene.sky.rgb, r.y * 0.5 + 0.5);
  vec3 dull = mix(scene.ground.rgb, scene.sky.rgb, 0.5);
  vec3 seen = mix(mirror, dull, rough * rough);
  vec4 rr = rough * vec4(-1.0, -0.0275, -0.572, 0.022) + vec4(1.0, 0.0425, 1.04, -0.04);
  float a004 = min(rr.x * rr.x, exp2(-9.28 * nv)) * rr.x + rr.y;
  vec2 ab = vec2(-1.04, 1.04) * a004 + rr.zw;
  vec3 col = (cdiff * hemi + seen * (f0 * ab.x + ab.y)) * occ;
  if (envOn()) col = (cdiff * envDiffuse(envTurn(n)) + envReflection(r, rough) * (f0 * ab.x + ab.y)) * occ;
  col += brdfLight(n, v, normalize(scene.lightDir.xyz), scene.lightColor.rgb * sh, f0, cdiff, a2);
  int lightCount = int(scene.lightCount.x);
  for (int k = 0; k < lightCount; k++) {
    Local L = localLight(k, v_world, n, v);
    if (L.att > 0.0) col += brdfLocal(n, v, L.ld, L.ls, scene.lights[k * 2 + 1].rgb * L.att, f0, cdiff, a2);
  }
  col += emissive;
  return vec4(linearToSrgb(col), base.a);
}

// ---------- water: its colour, reflections, glints and froth (see water.js); the waves themselves are lifted in the vertex shader ----------
${water ? `${skyGlsl((n) => `mats.m[${SKY_BLOCK_AT + n}]`)}
${waterWaveGlsl((e) => `mats.m[${e}]`)}
${waterShadeGlsl((e) => `mats.m[${e}]`)}` : ''}

void main() {
  vec3 n = normalize(v_nor);
  vec3 l = normalize(scene.lightDir.xyz);
  float ndl = max(dot(n, l), 0.0);
  float sh = ndl > 0.0 ? shadowLight(v_world, n) : 1.0;
  // everything that needs derivatives is worked out here, where every pixel takes the same path; the branches below only sample with explicit gradients
  vec3 legacyTexture = surfaceTexture(v_world, n, v_uv, v_material);
  vec2 uvdx = dFdx(v_uv);
  vec2 uvdy = dFdy(v_uv);
  vec3 wdx = dFdx(v_world);
  vec3 wdy = dFdy(v_world);
  vec3 toCam = scene.camera.xyz - v_world;
  vec3 rgb = vec3(0.0);
  float alpha = v_color.a;
  int id = v_material.y > 2.5 ? 0 : int(v_material.w + 0.5);      // a terrain's fourth number is its first layer, not a material
${water ? `  if (v_material.y > 3.5) {
    vec4 ws = waterShade(v_world, v_uv.x, v_material);
    rgb = ws.rgb;
    alpha = ws.a;
  } else ` : ''}  if (id > 0) {
    vec4 p = pbrShade(id, sh, uvdx, uvdy, wdx, wdy);
    rgb = p.rgb;
    alpha = p.a;
  } else {
    vec3 hemi = mix(scene.ground.rgb, scene.sky.rgb, n.y * 0.5 + 0.5);
    vec3 v = normalize(toCam);
    vec3 h = normalize(l + v);
    float spec = pow(max(dot(n, h), 0.0), 48.0) * scene.lightColor.a * ndl * sh;
    // point, spot and area lights: smooth falloff to nothing at their radius, diffuse and specular, shadows where a light asks for them
    vec3 pointDiffuse = vec3(0.0);
    vec3 pointSpec = vec3(0.0);
    int lightCount = int(scene.lightCount.x);
    for (int k = 0; k < lightCount; k++) {
      Local L = localLight(k, v_world, n, v);
      if (L.att > 0.0) {
        vec4 lcol = scene.lights[k * 2 + 1];
        float nl = max(dot(n, L.ld), 0.0);
        pointDiffuse += lcol.rgb * (L.att * nl);
        pointSpec += lcol.rgb * (pow(max(dot(n, normalize(L.ls + v)), 0.0), 48.0) * scene.lightColor.a * nl * L.att);
      }
    }
    vec3 albedo = v_color.rgb * legacyTexture;
    rgb = albedo * (hemi + scene.lightColor.rgb * ndl * sh + pointDiffuse) + scene.lightColor.rgb * spec + pointSpec;
  }
  float d = length(toCam) * scene.fog.a;
  rgb = mix(rgb, scene.fog.rgb, 1.0 - exp(-d * d));
  if (scene.sky.w > 0.0) {                                       // height fog: thicker low down, thinning upward, summed along the ray to the camera (see \`fogHeightDensity\`)
    float k = max(scene.ground.w, 1e-4), dist = length(toCam), ky = clamp(-k * toCam.y, -60.0, 60.0);
    float atCam = exp(clamp(-k * (scene.camera.y - scene.camera.w), -60.0, 60.0));
    float along = abs(ky) < 1e-3 ? 1.0 : (1.0 - exp(-ky)) / ky;
    rgb = mix(rgb, scene.fog.rgb, 1.0 - exp(-scene.sky.w * atCam * dist * along));
  }
  o = vec4(rgb * alpha, alpha); // premultiplied alpha, matching the blend function below
}`;

// The sky: the environment drawn behind everything, found for each pixel from the inverse of the camera's matrix.
const VERT_SKY = `#version 300 es
out vec2 v_ndc;
void main() {
  vec2 p = vec2(gl_VertexID == 1 ? 3.0 : -1.0, gl_VertexID == 2 ? 3.0 : -1.0);
  v_ndc = p;
  gl_Position = vec4(p, 0.0, 1.0);
}`;
const FRAG_SKY = `#version 300 es
precision highp float;
in vec2 v_ndc;
out vec4 o;
uniform highp samplerCube u_env;
layout(std140) uniform Materials { vec4 m[713]; } mats;
vec3 linearToSrgb(vec3 c) {
  vec3 x = max(c, vec3(0.0));
  return mix(1.055 * pow(x, vec3(1.0 / 2.4)) - 0.055, x * 12.92, lessThanEqual(x, vec3(0.0031308)));
}
void main() {
  mat4 inv = mat4(mats.m[651], mats.m[652], mats.m[653], mats.m[654]);
  vec4 a = inv * vec4(v_ndc, 0.0, 1.0);
  vec4 b = inv * vec4(v_ndc, 1.0, 1.0);
  vec3 dir = normalize(b.xyz / b.w - a.xyz / a.w);
  vec4 p = mats.m[640];
  vec3 d = vec3(p.y * dir.x - p.z * dir.z, dir.y, p.z * dir.x + p.y * dir.z);
  vec3 c = textureLod(u_env, d, mats.m[641].y).rgb * p.x;
  o = vec4(linearToSrgb(c), 1.0);
}`;

// The procedural sky: the atmosphere worked out for each pixel (see sky.js).
const FRAG_SKY_PROC = `#version 300 es
precision highp float;
precision highp int;
in vec2 v_ndc;
out vec4 o;
layout(std140) uniform Materials { vec4 m[713]; } mats;
vec3 linearToSrgb(vec3 c) {
  vec3 x = max(c, vec3(0.0));
  return mix(1.055 * pow(x, vec3(1.0 / 2.4)) - 0.055, x * 12.92, lessThanEqual(x, vec3(0.0031308)));
}
${skyGlsl((n) => `mats.m[${SKY_BLOCK_AT + n}]`)}
void main() {
  mat4 inv = mat4(mats.m[651], mats.m[652], mats.m[653], mats.m[654]);
  vec4 a = inv * vec4(v_ndc, 0.0, 1.0);
  vec4 b = inv * vec4(v_ndc, 1.0, 1.0);
  vec3 dir = normalize(b.xyz / b.w - a.xyz / a.w);
  o = vec4(linearToSrgb(skyColor(dir)), 1.0);
}`;

// The shadow pass: the same vertex work from the light's point of view, depth only; see-through instances cast nothing.

const VERT_SHADOW = `#version 300 es
layout(location=0) in vec3 a_pos;
layout(location=2) in vec4 a_m0;
layout(location=3) in vec4 a_m1;
layout(location=4) in vec4 a_m2;
layout(location=5) in vec4 a_m3;
layout(location=6) in vec4 a_color;
${SCENE_BLOCK}
void main() {
  if (a_color.a < 0.5) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  gl_Position = scene.lightViewProj * (mat4(a_m0, a_m1, a_m2, a_m3) * vec4(a_pos, 1.0));
  gl_Position.z = gl_Position.z * 2.0 - gl_Position.w;
}`;
const VERT_SHADOW_SKIN = `#version 300 es
layout(location=0) in vec3 a_pos;
layout(location=2) in vec4 a_m0;
layout(location=3) in vec4 a_m1;
layout(location=4) in vec4 a_m2;
layout(location=5) in vec4 a_m3;
layout(location=6) in vec4 a_color;
layout(location=7) in vec4 a_pbase;
layout(location=8) in vec4 a_joints;
layout(location=9) in vec4 a_weights;
${SCENE_BLOCK}
uniform highp sampler2D u_palette;
mat4 joint(int matrixIndex) {
  int t = matrixIndex * 4;
  ivec2 p = ivec2(t & 1023, t >> 10);
  return mat4(texelFetch(u_palette, p, 0), texelFetch(u_palette, p + ivec2(1, 0), 0), texelFetch(u_palette, p + ivec2(2, 0), 0), texelFetch(u_palette, p + ivec2(3, 0), 0));
}
void main() {
  if (a_color.a < 0.5) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  int base = int(a_pbase.x + 0.5);
  ivec4 j = ivec4(a_joints + vec4(0.5));
  mat4 skin = joint(base + j.x) * a_weights.x + joint(base + j.y) * a_weights.y + joint(base + j.z) * a_weights.z + joint(base + j.w) * a_weights.w;
  gl_Position = scene.lightViewProj * (mat4(a_m0, a_m1, a_m2, a_m3) * (skin * vec4(a_pos, 1.0)));
  gl_Position.z = gl_Position.z * 2.0 - gl_Position.w;
}`;
const FRAG_DEPTH = `#version 300 es
precision lowp float;
void main() {}`;

/** 3D rendering through WebGL2 (the fallback for WebGPU): the same scene, shading and draw order. */
export class WebGL2Renderer3D {
  constructor(canvas, { antialias = true, water = false } = {}) {
    const gl = canvas.getContext('webgl2', { alpha: false, antialias, depth: true, powerPreference: 'high-performance' });
    if (!gl) throw new Error('WebGL2 unavailable');
    this.kind = 'webgl2';
    this.canvas = canvas;
    this.gl = gl;
    this.lost = false;
    this.onLost = null;
    this.sceneData = new Float32Array(SCENE_UNIFORM_FLOATS);
    this.meshes = new WeakMap();
    this.particles = null; // created at the first particle batch
    this.post = null; // created when post-processing is first asked for
    this.antialias = antialias;
    canvas.addEventListener?.('webglcontextlost', (e) => { e.preventDefault(); this.lost = true; this.onLost?.(); });

    const compile = (type, src) => {
      const sh = gl.createShader(type);
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(`shader error: ${gl.getShaderInfoLog(sh)}`);
      return sh;
    };
    this.water = water;
    const mainFrag = makeFrag(water);
    const link = (vert, frag = mainFrag) => {
      const p = gl.createProgram();
      gl.attachShader(p, compile(gl.VERTEX_SHADER, vert));
      gl.attachShader(p, compile(gl.FRAGMENT_SHADER, frag));
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`link error: ${gl.getProgramInfoLog(p)}`);
      const scene = gl.getUniformBlockIndex(p, 'Scene');
      if (scene !== gl.INVALID_INDEX) gl.uniformBlockBinding(p, scene, 0);
      const materials = gl.getUniformBlockIndex(p, 'Materials');
      if (materials !== gl.INVALID_INDEX) gl.uniformBlockBinding(p, materials, 1);
      return p;
    };
    const prog = link(VERT);
    this.prog = prog;
    this.skinProg = link(VERT_SKIN);
    this.skyProg = link(VERT_SKY, FRAG_SKY);
    this.skyProcProg = link(VERT_SKY, FRAG_SKY_PROC);
    this.skyVao = gl.createVertexArray();
    this.skinPaletteLoc = gl.getUniformLocation(this.skinProg, 'u_palette');
    this.shadowProg = link(VERT_SHADOW, FRAG_DEPTH);
    this.shadowSkinProg = link(VERT_SHADOW_SKIN, FRAG_DEPTH);
    this.shadowSkinPaletteLoc = gl.getUniformLocation(this.shadowSkinProg, 'u_palette');
    this.shadowLoc = gl.getUniformLocation(prog, 'u_shadow');
    this.skinShadowLoc = gl.getUniformLocation(this.skinProg, 'u_shadow');
    this.localLoc = gl.getUniformLocation(prog, 'u_localShadow');
    this.skinLocalLoc = gl.getUniformLocation(this.skinProg, 'u_localShadow');
    this.localSize = 0; this.localLayers = 0;
    this.localTexture = gl.createTexture(); // the maps of point and spot lights
    this.localMatrixPool = Array.from({ length: MAX_LOCAL_SHADOW_LAYERS }, () => new Float64Array(16));
    this.shadowSize = 0;
    this.shadowTexture = gl.createTexture();
    this.shadowFbo = gl.createFramebuffer();
    this.cascadeMatrices = Array.from({ length: MAX_CASCADES }, () => new Float64Array(16));
    this.cascadeData = new Float32Array(SCENE_UNIFORM_FLOATS);
    this.shadowLayers = 0;
    this.texLoc = gl.getUniformLocation(prog, 'u_tex');
    this.envLoc = gl.getUniformLocation(prog, 'u_env');
    this.skinEnvLoc = gl.getUniformLocation(this.skinProg, 'u_env');
    this.skyEnvLoc = gl.getUniformLocation(this.skyProg, 'u_env');
    this.skinTexLoc = gl.getUniformLocation(this.skinProg, 'u_tex');
    this.textureSet = null;
    this.texture = gl.createTexture();
    this.textureSource = null;
    this.layerVersions = [];
    this.uploadedLayers = 0;
    this.anisotropy = gl.getExtension('EXT_texture_filter_anisotropic');
    gl.activeTexture(gl.TEXTURE2); // a 1 x 1 white array until textures are given, so the sampler is always complete
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.texture);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA8, 1, 1, 1);
    gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, 0, 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.activeTexture(gl.TEXTURE0);
    gl.vertexAttrib2f(11, 0, 0); // meshes without texture coordinates read (0, 0)
    this.#shadowTarget(1); // a 1x1 map until shadows are asked for, so the shader's sampler always has a complete texture
    this.#localTarget(1, 1);
    this.skinMeshes = new WeakMap();
    this.skinInstanceBuffer = gl.createBuffer();
    this.paletteTexture = gl.createTexture();
    this.paletteRows = 0;
    this.paletteStaging = new Float32Array(0);
    this.sceneBuffer = gl.createBuffer();
    gl.bindBuffer(gl.UNIFORM_BUFFER, this.sceneBuffer);
    gl.bufferData(gl.UNIFORM_BUFFER, SCENE_UNIFORM_FLOATS * 4, gl.DYNAMIC_DRAW);
    gl.bindBufferBase(gl.UNIFORM_BUFFER, 0, this.sceneBuffer);
    this.materialBuffer = gl.createBuffer();
    gl.bindBuffer(gl.UNIFORM_BUFFER, this.materialBuffer);
    gl.bufferData(gl.UNIFORM_BUFFER, (ENV_BLOCK_AT + ENV_BLOCK_VEC4S) * 16, gl.DYNAMIC_DRAW);
    gl.bindBufferBase(gl.UNIFORM_BUFFER, 1, this.materialBuffer);
    this.environment = null;
    this.envSource = 0;
    this.envTable = new Float32Array((ENV_BLOCK_AT + ENV_BLOCK_VEC4S) * 4);
    this.envState = { lighting: false, sky: false };
    this.envTexture = gl.createTexture();                       // a 1 x 1 black cube until an environment is given, so the sampler is always complete
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_CUBE_MAP, this.envTexture);
    gl.texStorage2D(gl.TEXTURE_CUBE_MAP, 1, gl.RGBA16F, 1, 1);
    for (let f = 0; f < 6; f++) gl.texSubImage2D(gl.TEXTURE_CUBE_MAP_POSITIVE_X + f, 0, 0, 0, 1, 1, gl.RGBA, gl.HALF_FLOAT, new Uint16Array(4));
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.activeTexture(gl.TEXTURE0);
    this.materialSet = null;
    this.materialVersion = -1;
    this.instanceBuffer = gl.createBuffer();
    this.instanceCapacity = 0;
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.frontFace(gl.CCW);
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  }

  resize(cssW, cssH, dpr = 1) {
    this.canvas.width = Math.max(1, Math.round(cssW * dpr));
    this.canvas.height = Math.max(1, Math.round(cssH * dpr));
    if (this.canvas.style) { this.canvas.style.width = `${cssW}px`; this.canvas.style.height = `${cssH}px`; }
  }

  #gpuMesh(mesh) {
    let m = this.meshes.get(mesh);
    if (m) {
      if (m.version !== (mesh.version | 0)) {                                   // a morphed mesh: its vertices changed
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, m.vb);
        this.gl.bufferSubData(this.gl.ARRAY_BUFFER, 0, mesh.vertices);
        m.version = mesh.version | 0;
      }
      return m;
    }
    const { gl } = this;
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const vb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vb);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.vertices, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, VERTEX_BYTES, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, VERTEX_BYTES, 12);
    const ub = this.#uvBuffer(mesh);
    const ib = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);
    for (const loc of [2, 3, 4, 5, 6, 10]) { gl.enableVertexAttribArray(loc); gl.vertexAttribDivisor(loc, 1); }
    m = { vao, vb, ub, ib, indexCount: mesh.indices.length, version: mesh.version | 0 };
    this.meshes.set(mesh, m);
    gl.bindVertexArray(null);
    return m;
  }

  /** The texture-coordinate buffer of a mesh, bound to attribute 11 of the VAO being set up (null: the attribute stays off and reads (0, 0)). */
  #uvBuffer(mesh) {
    if (!mesh.uv) return null;
    const { gl } = this;
    const ub = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, ub);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.uv, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(11); gl.vertexAttribPointer(11, 2, gl.FLOAT, false, 8, 0);
    return ub;
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
    const { gl } = this;
    this.envSource = id;
    gl.deleteTexture(this.envTexture);
    this.envTexture = gl.createTexture();
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_CUBE_MAP, this.envTexture);
    if (env) {
      gl.texStorage2D(gl.TEXTURE_CUBE_MAP, env.levels.length, gl.RGBA16F, env.size, env.size);
      env.levels.forEach((level, mip) => {
        for (let face = 0; face < 6; face++) gl.texSubImage2D(gl.TEXTURE_CUBE_MAP_POSITIVE_X + face, mip, 0, 0, level.size, level.size, gl.RGBA, gl.HALF_FLOAT, halfFaceData(level, face));
      });
      gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    } else {
      gl.texStorage2D(gl.TEXTURE_CUBE_MAP, 1, gl.RGBA16F, 1, 1);
      for (let f = 0; f < 6; f++) gl.texSubImage2D(gl.TEXTURE_CUBE_MAP_POSITIVE_X + f, 0, 0, 0, 1, 1, gl.RGBA, gl.HALF_FLOAT, new Uint16Array(4));
      gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    }
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.activeTexture(gl.TEXTURE0);
  }

  /** The environment's numbers for this frame (settings, harmonics, the inverse of the camera's matrix for the sky). */
  #writeEnvironment(camera, lighting) {
    const { gl } = this;
    const inv = (this.envInverse ??= new Float64Array(16));
    mat4.invert(inv, camera.viewProj);                                // fills `inv`
    this.envState = writeEnvironmentBlock(this.envTable, this.environment, lighting?.environment, inv);
    if (lighting?.sky) {                                              // a procedural sky replaces the environment's own picture (the environment still lights things)
      writeSkyBlock(this.envTable, SKY_BLOCK_AT, lighting.sky);
      for (let k = 0; k < 16; k++) this.envTable[ENV_BLOCK_AT * 4 + 44 + k] = inv[k];
      this.envState = { ...this.envState, sky: false, proceduralSky: true };
    }
    if (lighting?.water && !this.water) throw new Error('water needs a renderer made with createRenderer3D({ water: true })');
    if (lighting?.water) writeWaterBlock(this.envTable, WATER_BLOCK_AT, lighting.water, lighting.sky ? 2 : this.envState.lighting ? 1 : 0);
    gl.bindBuffer(gl.UNIFORM_BUFFER, this.materialBuffer);
    gl.bufferSubData(gl.UNIFORM_BUFFER, ENV_BLOCK_AT * 16, this.envTable, ENV_BLOCK_AT * 4, ENV_BLOCK_VEC4S * 4);
  }

  #syncMaterials() {
    const set = this.materialSet;
    if (!set || this.materialVersion === set.version) return;
    const { gl } = this;
    gl.bindBuffer(gl.UNIFORM_BUFFER, this.materialBuffer);
    gl.bufferSubData(gl.UNIFORM_BUFFER, 0, set.data);
    this.materialVersion = set.version;
  }

  #syncTextures() {
    const { gl } = this, set = this.textureSet;
    if (!set) return;
    gl.activeTexture(gl.TEXTURE2);
    if (this.textureSource !== set) { // a different set: a fresh texture array (immutable storage, so a new texture object)
      gl.deleteTexture(this.texture);
      this.texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.texture);
      const info = textureFormatInfo(set.format);
      if (info.glExtension && !gl.getExtension(info.glExtension)) throw new Error(`this graphics card cannot read ${set.format} textures (WebGL extension ${info.glExtension}); use a set of another format`);
      gl.texStorage3D(gl.TEXTURE_2D_ARRAY, set.levels, info.glExtension ? info.glFormat : gl.RGBA8, set.size, set.size, set.maxLayers);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.REPEAT);
      if (this.anisotropy) gl.texParameterf(gl.TEXTURE_2D_ARRAY, this.anisotropy.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(this.anisotropy.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
      this.textureSource = set;
      this.uploadedLayers = 0;
      this.layerVersions = [];
    } else gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.texture);
    for (; this.uploadedLayers < set.layers.length; this.uploadedLayers++) this.#uploadLayer(set, this.uploadedLayers);
    for (let i = 0; i < this.uploadedLayers; i++) if (this.layerVersions[i] !== set.layers[i].version) this.#uploadLayer(set, i);      // a layer changed by `update` (a video frame)
    gl.activeTexture(gl.TEXTURE0);
  }

  #uploadLayer(set, index) {
    const { gl } = this, layer = set.layers[index];
    for (let level = 0; level < set.levels; level++) {
      const size = Math.max(1, set.size >> level);
      if (set.format === 'rgba8') gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, level, 0, 0, index, size, size, 1, gl.RGBA, gl.UNSIGNED_BYTE, layer.mips[level]);
      else gl.compressedTexSubImage3D(gl.TEXTURE_2D_ARRAY, level, 0, 0, index, size, size, 1, textureFormatInfo(set.format).glFormat, layer.mips[level]);
    }
    this.layerVersions[index] = layer.version;
  }

  #gpuSkinMesh(mesh) {
    let m = this.skinMeshes.get(mesh);
    if (m) {
      if (m.version !== (mesh.version | 0)) {
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, m.vb);
        this.gl.bufferSubData(this.gl.ARRAY_BUFFER, 0, mesh.vertices);
        m.version = mesh.version | 0;
      }
      return m;
    }
    const { gl } = this;
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const vb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vb);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.vertices, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, VERTEX_BYTES, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, VERTEX_BYTES, 12);
    const sb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, sb);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.skin, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(8); gl.vertexAttribPointer(8, 4, gl.FLOAT, false, SKIN_BYTES, 0);
    gl.enableVertexAttribArray(9); gl.vertexAttribPointer(9, 4, gl.FLOAT, false, SKIN_BYTES, 16);
    const ub = this.#uvBuffer(mesh);
    const ib = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);
    for (const loc of [2, 3, 4, 5, 6, 7, 10]) { gl.enableVertexAttribArray(loc); gl.vertexAttribDivisor(loc, 1); }
    m = { vao, vb, sb, ub, ib, indexCount: mesh.indices.length, version: mesh.version | 0 };
    this.skinMeshes.set(mesh, m);
    gl.bindVertexArray(null);
    return m;
  }

  releaseMesh(mesh) {
    const { gl } = this;
    const s = this.skinMeshes.get(mesh);
    if (s) { gl.deleteBuffer(s.vb); gl.deleteBuffer(s.sb); gl.deleteBuffer(s.ib); if (s.ub) gl.deleteBuffer(s.ub); gl.deleteVertexArray(s.vao); this.skinMeshes.delete(mesh); }
    const m = this.meshes.get(mesh);
    if (!m) return;
    gl.deleteBuffer(m.vb); gl.deleteBuffer(m.ib); if (m.ub) gl.deleteBuffer(m.ub); gl.deleteVertexArray(m.vao);
    this.meshes.delete(mesh);
  }

  /** (Re)allocate the shadow map when shadows are on or their resolution changed. */
  #shadowTarget(size, layers = 1) {
    const { gl } = this;
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.shadowTexture);
    if (this.shadowSize !== size || this.shadowLayers !== layers) {
      gl.deleteTexture(this.shadowTexture); // an array texture's storage is fixed: make a new one
      this.shadowTexture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.shadowTexture);
      gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.DEPTH_COMPONENT32F, size, size, layers);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
      this.shadowSize = size; this.shadowLayers = layers;
    }
    gl.activeTexture(gl.TEXTURE0);
  }

  /** (Re)allocate the maps of point and spot lights when they are first asked for or their size changes (texture unit 4). */
  #localTarget(size, layers) {
    const { gl } = this;
    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.localTexture);
    if (this.localSize !== size || this.localLayers !== layers) {
      gl.deleteTexture(this.localTexture);
      this.localTexture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.localTexture);
      gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.DEPTH_COMPONENT32F, size, size, layers);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
      this.localSize = size; this.localLayers = layers;
    }
    gl.activeTexture(gl.TEXTURE0);
  }

  /** Put the plain instances on the GPU; returns what to draw. */
  #uploadPlain(list, shadow = null) {
    const { gl } = this;
    let total = 0;
    for (const g of list.groups.values()) total += g.count;
    for (const g of list.blended.values()) total += g.count;
    const draws = [];
    draws.cuts = [];
    draws.blended = [];                                                   // the translucent ones: drawn after the solid ones, writing no depth
    if (total === 0) return draws;
    // after the instances of the main pass come those of each sun cascade: only the ones that can touch that cascade's box (the maps come out the same, and far buildings and hillsides are not drawn into a small near map)
    let extra = 0;
    const cuts = [];
    if (shadow && this.cullCascades !== false) {
      const need = total * shadow.matrices.length * INSTANCE3D_FLOATS;
      if (!this.cutStaging || this.cutStaging.length < need) this.cutStaging = new Float32Array(Math.max(need, 4096));
      for (const matrix of shadow.matrices) { const r = packInstancesForLight(list.groups, matrix, INSTANCE3D_FLOATS, this.cutStaging, extra); cuts.push(r.parts); extra += r.rows; }
    }
    let first = 0; // make sure every mesh is on the GPU first (uploading one rebinds ARRAY_BUFFER), then fill the instance buffer
    for (const [mesh, g] of list.groups) {
      if (g.count === 0) continue;
      draws.push({ gpu: this.#gpuMesh(mesh), first, count: g.count, data: g.data, mesh });
      first += g.count;
    }
    for (const [mesh, g] of list.blended) {
      if (g.count === 0) continue;
      draws.blended.push({ gpu: this.#gpuMesh(mesh), first, count: g.count, data: g.data });
      first += g.count;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, (total + extra) * INSTANCE3D_BYTES, gl.DYNAMIC_DRAW); // a fresh store each frame: the driver orphans the old one instead of stalling on it
    for (const d of [...draws, ...draws.blended]) gl.bufferSubData(gl.ARRAY_BUFFER, d.first * INSTANCE3D_BYTES, d.data, 0, d.count * INSTANCE3D_FLOATS); // straight from the draw list
    if (extra > 0) gl.bufferSubData(gl.ARRAY_BUFFER, total * INSTANCE3D_BYTES, this.cutStaging, 0, extra * INSTANCE3D_FLOATS);
    draws.cuts = cuts.map((parts) => parts.map((p) => ({ gpu: this.#gpuMesh(p.mesh), first: total + p.row, count: p.count })));
    return draws;
  }

  /** Put the skinned instances and their palettes on the GPU (palettes in one texture, 4 texels per matrix); returns what to draw. */
  #uploadSkinned(list) {
    const { gl } = this;
    let instances = 0, matrices = 0;
    for (const g of list.skinned.values()) { instances += g.count; matrices += g.count * g.jointCount; }
    const draws = [];
    if (instances === 0) return draws;
    const rows = Math.ceil(matrices / 256);
    if (this.paletteStaging.length < rows * 4096) this.paletteStaging = new Float32Array(Math.max(rows, 4) * 4096);
    let firstInstance = 0, firstMatrix = 0;
    for (const [mesh, g] of list.skinned) {
      if (g.count === 0) continue;
      for (let i = 0; i < g.count; i++) g.data[i * SKINNED_INSTANCE_FLOATS + 20] = firstMatrix + i * g.jointCount;
      this.paletteStaging.set(g.palettes.subarray(0, g.count * g.jointCount * 16), firstMatrix * 16);
      draws.push({ gpu: this.#gpuSkinMesh(mesh), first: firstInstance, count: g.count, data: g.data });
      firstInstance += g.count; firstMatrix += g.count * g.jointCount;
    }
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.paletteTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (rows > this.paletteRows) { // grow (and allocate) the texture
      this.paletteRows = Math.max(rows, this.paletteRows * 2, 4);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 1024, this.paletteRows, 0, gl.RGBA, gl.FLOAT, null);
    }
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 1024, rows, gl.RGBA, gl.FLOAT, this.paletteStaging, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.skinInstanceBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, instances * SKINNED_INSTANCE_BYTES, gl.DYNAMIC_DRAW);
    for (const d of draws) gl.bufferSubData(gl.ARRAY_BUFFER, d.first * SKINNED_INSTANCE_BYTES, d.data, 0, d.count * SKINNED_INSTANCE_FLOATS);
    return draws;
  }

  /** Issue the draw calls for uploaded instances with the current program. */
  #drawAll(draws, skinned) {
    const { gl } = this;
    const stride = skinned ? SKINNED_INSTANCE_BYTES : INSTANCE3D_BYTES, buffer = skinned ? this.skinInstanceBuffer : this.instanceBuffer;
    for (const d of draws) { // no base-instance in core WebGL2: point the instance attributes at this mesh's range
      gl.bindVertexArray(d.gpu.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      const base = d.first * stride;
      for (let c = 0; c < 4; c++) gl.vertexAttribPointer(2 + c, 4, gl.FLOAT, false, stride, base + c * 16);
      gl.vertexAttribPointer(6, 4, gl.FLOAT, false, stride, base + 64);
      if (skinned) gl.vertexAttribPointer(7, 4, gl.FLOAT, false, stride, base + 80);
      gl.vertexAttribPointer(10, 4, gl.FLOAT, false, stride, base + (skinned ? 96 : 80)); // the material
      gl.drawElementsInstanced(gl.TRIANGLES, d.gpu.indexCount, gl.UNSIGNED_INT, 0, d.count);
    }
    gl.bindVertexArray(null);
  }

  /** @see WebGPURenderer3D#render */
  render({ camera, list, clear = [0.55, 0.65, 0.78, 1], lighting, shadows, localShadows, particles, post }) {
    if (this.lost) return;
    const { gl } = this;
    this.#syncTextures();
    this.#syncMaterials();
    this.#syncEnvironment();
    camera.update();
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
    writeSceneUniforms(this.sceneData, camera, lighting, shadow, local);
    gl.bindBuffer(gl.UNIFORM_BUFFER, this.sceneBuffer);
    gl.bufferSubData(gl.UNIFORM_BUFFER, 0, this.sceneData);
    gl.bindBufferBase(gl.UNIFORM_BUFFER, 0, this.sceneBuffer);
    const plain = this.#uploadPlain(list, shadow), skinned = this.#uploadSkinned(list);

    const jobs = []; // the depth passes: each cascade of the sun, then each layer of a point or spot light's map
    if (shadow) shadow.matrices.forEach((matrix, layer) => jobs.push({ texture: this.shadowTexture, size: shadow.size, layer, matrix, draws: plain.cuts[layer] }));
    if (local) local.matrices.forEach((matrix, layer) => jobs.push({ texture: this.localTexture, size: local.size, layer, matrix, draws: plain }));
    if (jobs.length > 0) { // first the world as the lights see it (depth only)
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFbo);
      gl.disable(gl.CULL_FACE); gl.disable(gl.BLEND);
      gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(2, 2);
      for (const job of jobs) { // one depth pass per layer, reading its own light matrix
        gl.viewport(0, 0, job.size, job.size);
        this.cascadeData.set(job.matrix, 0);
        gl.bindBuffer(gl.UNIFORM_BUFFER, this.sceneBuffer);
        gl.bufferSubData(gl.UNIFORM_BUFFER, 40 * 4, this.cascadeData, 0, 16);
        gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, job.texture, 0, job.layer);
        gl.drawBuffers([gl.NONE]); gl.readBuffer(gl.NONE);
        gl.clearDepth(1);
        gl.clear(gl.DEPTH_BUFFER_BIT);
        const mine = job.draws ?? plain;
        if (mine.length > 0) { gl.useProgram(this.shadowProg); this.#drawAll(mine, false); }
        if (skinned.length > 0) {
          gl.useProgram(this.shadowSkinProg);
          gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.paletteTexture);
          gl.uniform1i(this.shadowSkinPaletteLoc, 0);
          this.#drawAll(skinned, true);
        }
      }
      gl.disable(gl.POLYGON_OFFSET_FILL);
      gl.enable(gl.CULL_FACE); gl.enable(gl.BLEND);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    if (post) { this.post ??= new GLPost(gl, this.antialias ? 4 : 1); this.post.begin(this.canvas.width, this.canvas.height, post, camera); } // the scene goes into an HDR target
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(clear[0], clear[1], clear[2], clear[3]);
    gl.clearDepth(1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.shadowTexture); // the main shaders read the shadow map from unit 1
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.texture);   // and the texture array from unit 2
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_CUBE_MAP, this.envTexture); // and the environment from unit 3
    gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.localTexture); // and the maps of point and spot lights from unit 4
    gl.activeTexture(gl.TEXTURE0);
    if (this.envState.proceduralSky) {
      gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE); gl.disable(gl.BLEND);
      gl.useProgram(this.skyProcProg);
      gl.bindVertexArray(this.skyVao);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindVertexArray(null);
      gl.enable(gl.DEPTH_TEST); gl.enable(gl.CULL_FACE); gl.enable(gl.BLEND);
    } else if (this.envState.sky) {                                       // first, so that everything else (blended surfaces too) is drawn over it
      gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE); gl.disable(gl.BLEND);
      gl.useProgram(this.skyProg);
      gl.uniform1i(this.skyEnvLoc, 3);
      gl.bindVertexArray(this.skyVao);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindVertexArray(null);
      gl.enable(gl.DEPTH_TEST); gl.enable(gl.CULL_FACE); gl.enable(gl.BLEND);
    }
    if (plain.length > 0) {
      gl.useProgram(this.prog);
      gl.uniform1i(this.shadowLoc, 1);
      gl.uniform1i(this.localLoc, 4);
      gl.uniform1i(this.texLoc, 2);
      gl.uniform1i(this.envLoc, 3);
      this.#drawAll(plain, false);
    }
    if (skinned.length > 0) {
      gl.useProgram(this.skinProg);
      gl.bindTexture(gl.TEXTURE_2D, this.paletteTexture);
      gl.uniform1i(this.skinPaletteLoc, 0);
      gl.uniform1i(this.skinShadowLoc, 1);
      gl.uniform1i(this.skinLocalLoc, 4);
      gl.uniform1i(this.skinTexLoc, 2);
      gl.uniform1i(this.skinEnvLoc, 3);
      this.#drawAll(skinned, true);
    }
    if (post && this.post?.options?.ssr?.glass > 0 && list.reflective.size > 0) {                // the reflective surfaces are marked in the alpha of the picture: the same instances again, writing nothing but the alpha (0)
      const marked = plain.filter((d) => list.reflective.has(d.mesh));
      if (marked.length > 0) {
        gl.useProgram(this.prog);
        gl.uniform1i(this.shadowLoc, 1);
        gl.uniform1i(this.localLoc, 4);
        gl.uniform1i(this.texLoc, 2);
        gl.uniform1i(this.envLoc, 3);
        gl.colorMask(false, false, false, true);
        gl.blendFuncSeparate(gl.ZERO, gl.ONE, gl.ZERO, gl.ZERO);
        gl.depthMask(false); gl.depthFunc(gl.LEQUAL);
        this.#drawAll(marked, false);
        gl.depthFunc(gl.LESS); gl.depthMask(true);
        gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.colorMask(true, true, true, true);
      }
    }
    if (plain.blended.length > 0) {                                       // translucent things: over the solid scene, testing the depth but not writing it, before the particles
      gl.useProgram(this.prog);
      gl.uniform1i(this.shadowLoc, 1);
      gl.uniform1i(this.localLoc, 4);
      gl.uniform1i(this.texLoc, 2);
      gl.uniform1i(this.envLoc, 3);
      gl.depthMask(false);
      this.#drawAll(plain.blended, false);
      gl.depthMask(true);
    }
    if (particles && particles.count > 0) { // soft sprites, streaks and decals over the solid scene
      this.particles ??= new GLParticles(gl);
      this.particles.draw(particles, camera);
    }
    if (post) this.post.finish(); // bloom, tone mapping and grading, onto the canvas
    /** What the last frame drew: instances and draw calls in the main pass, and in the sun's depth passes (which draw only what can reach each cascade). */
    this.stats = { instances: plain.reduce((n, d) => n + d.count, 0), draws: plain.length, shadowInstances: plain.cuts.reduce((n, c) => n + c.reduce((m, d) => m + d.count, 0), 0), shadowDraws: plain.cuts.reduce((n, c) => n + c.length, 0), cascades: plain.cuts.length };
  }

  destroy() {
    this.particles?.destroy();
    this.post?.destroy();
    const { gl } = this;
    gl.deleteBuffer(this.skinInstanceBuffer); gl.deleteTexture(this.paletteTexture); gl.deleteProgram(this.skinProg);
    gl.deleteTexture(this.shadowTexture); gl.deleteTexture(this.localTexture); gl.deleteTexture(this.texture); gl.deleteFramebuffer(this.shadowFbo); gl.deleteProgram(this.shadowProg); gl.deleteProgram(this.shadowSkinProg);
    gl.deleteBuffer(this.instanceBuffer); gl.deleteBuffer(this.sceneBuffer); gl.deleteProgram(this.prog);
    gl.deleteTexture(this.envTexture); gl.deleteProgram(this.skyProg); gl.deleteProgram(this.skyProcProg); gl.deleteVertexArray(this.skyVao); gl.deleteBuffer(this.materialBuffer);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
