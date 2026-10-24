// Particles in the 3D renderers: soft camera-facing sprites, streaks stretched along their velocity, and flat decals, drawn unlit
// with alpha or additive blending after the solid scene (depth-tested, never written). No textures: the shape is computed in the shader.
// A `ParticleBatch` holds one frame's particles; `@engine/particles` fills it from a simulation, or push your own.

/** Floats per particle: four vec4s. */
export const PARTICLE_FLOATS = 16;
export const PARTICLE_BYTES = PARTICLE_FLOATS * 4;
/** Floats in the particle uniform block: viewProj (16), camera right (4), camera up (4), camera forward (4), spare (4). */
export const PARTICLE_UNIFORM_FLOATS = 32;

/** How a particle is oriented. */
export const ORIENT = Object.freeze({ billboard: 0, stretch: 1, flat: 2 });

/**
 * The per-frame list of particles for the renderer (16 floats each). `ParticleSystem.writeTo(batch)` fills it; pass it to
 * `render({ particles })`.
 */
export class ParticleBatch {
  /** @param {number} [capacity] initial particle capacity (grows as needed) */
  constructor(capacity = 1024) {
    this.data = new Float32Array(capacity * PARTICLE_FLOATS);
    this.count = 0;
  }
  clear() { this.count = 0; }
  get capacity() { return this.data.length / PARTICLE_FLOATS; }

  /**
   * Add one particle.
   * @param {number} x @param {number} y @param {number} z Centre.
   * @param {number} size Half-size in world units (a radius).
   * @param {number} r @param {number} g @param {number} b @param {number} a Colour 0..1 (a = opacity).
   * @param {number} vx @param {number} vy @param {number} vz Velocity for `stretch`; the surface normal for `flat`.
   * @param {number} stretch Extra half-length per unit of speed (streaks).
   * @param {number} rot Rotation in radians (billboards and flats).
   * @param {number} additive 0 = ordinary alpha blending, 1 = adds light (fire, sparks, glow).
   * @param {number} hardness 0 = soft falloff, 1 = a crisp disc.
   * @param {number} orient See ORIENT.
   */
  push(x, y, z, size, r, g, b, a, vx = 0, vy = 0, vz = 0, stretch = 0, rot = 0, additive = 0, hardness = 0, orient = 0) {
    if ((this.count + 1) * PARTICLE_FLOATS > this.data.length) {
      const next = new Float32Array(this.data.length * 2);
      next.set(this.data);
      this.data = next;
    }
    const d = this.data, o = this.count++ * PARTICLE_FLOATS;
    d[o] = x; d[o + 1] = y; d[o + 2] = z; d[o + 3] = size;
    d[o + 4] = r; d[o + 5] = g; d[o + 6] = b; d[o + 7] = a;
    d[o + 8] = vx; d[o + 9] = vy; d[o + 10] = vz; d[o + 11] = stretch;
    d[o + 12] = rot; d[o + 13] = additive; d[o + 14] = hardness; d[o + 15] = orient;
  }
}

/** Fill a uniform block from a camera (right, up and forward are read from its view matrix). */
export function writeParticleUniforms(out, camera) {
  const v = camera.view;
  for (let i = 0; i < 16; i++) out[i] = camera.viewProj[i];
  // the view matrix is column-major: its rows are the camera's right, up and (negated) forward axes
  out[16] = v[0]; out[17] = v[4]; out[18] = v[8]; out[19] = 0;
  out[20] = v[1]; out[21] = v[5]; out[22] = v[9]; out[23] = 0;
  out[24] = -v[2]; out[25] = -v[6]; out[26] = -v[10]; out[27] = 0;
  out[28] = out[29] = out[30] = out[31] = 0;
}

export const PARTICLE_GLSL_VERT = `#version 300 es
precision highp float;
layout(location = 0) in vec4 i0; // position, size
layout(location = 1) in vec4 i1; // colour
layout(location = 2) in vec4 i2; // velocity or normal, stretch
layout(location = 3) in vec4 i3; // rotation, additive, hardness, orient
uniform mat4 u_viewProj;
uniform vec4 u_right;
uniform vec4 u_up;
uniform vec4 u_fwd;
out vec2 v_c;
out vec4 v_color;
out vec2 v_shape; // additive, hardness
void main() {
  vec2 corners[4] = vec2[4](vec2(-1.0, -1.0), vec2(1.0, -1.0), vec2(-1.0, 1.0), vec2(1.0, 1.0));
  vec2 c = corners[gl_VertexID];
  float size = i0.w;
  vec3 world;
  int orient = int(i3.w + 0.5);
  float cs = cos(i3.x), sn = sin(i3.x);
  vec2 cr = vec2(c.x * cs - c.y * sn, c.x * sn + c.y * cs);
  vec2 axis = vec2(0.0, 1.0);
  float halfLen = size;
  if (orient == 1) {
    vec2 vs = vec2(dot(i2.xyz, u_right.xyz), dot(i2.xyz, u_up.xyz));
    float l = length(vs);
    if (l > 1e-4) axis = vs / l;
    halfLen = size + length(i2.xyz) * i2.w;
    vec2 perp = vec2(-axis.y, axis.x);
    vec2 s = perp * c.x * size + axis * c.y * halfLen;
    world = i0.xyz + u_right.xyz * s.x + u_up.xyz * s.y;
  } else if (orient == 2) {
    vec3 n = normalize(i2.xyz);
    vec3 t = normalize(cross(n, abs(n.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
    vec3 b = cross(n, t);
    world = i0.xyz + (t * cr.x + b * cr.y) * size + n * 0.012;
  } else {
    world = i0.xyz + (u_right.xyz * cr.x + u_up.xyz * cr.y) * size;
  }
  gl_Position = u_viewProj * vec4(world, 1.0);
  gl_Position.z = gl_Position.z * 2.0 - gl_Position.w; // the projection gives depth 0..1; WebGL wants -1..1
  v_c = c; v_color = i1; v_shape = i3.yz;
}`;

export const PARTICLE_GLSL_FRAG = `#version 300 es
precision mediump float;
in vec2 v_c;
in vec4 v_color;
in vec2 v_shape;
out vec4 o;
void main() {
  float d = length(v_c);
  if (d >= 1.0) discard;
  float soft = (1.0 - d) * (1.0 - d);
  float hard = smoothstep(1.0, 0.8, d);
  float a = mix(soft, hard, v_shape.y) * v_color.a;
  o = vec4(v_color.rgb * a, a * (1.0 - v_shape.x)); // premultiplied: additive particles keep their colour and add no coverage
}`;

export const PARTICLE_WGSL = `
struct PScene { viewProj: mat4x4f, right: vec4f, up: vec4f, fwd: vec4f, spare: vec4f };
@group(0) @binding(0) var<uniform> ps: PScene;
struct PIn { @builtin(vertex_index) vi: u32, @location(0) i0: vec4f, @location(1) i1: vec4f, @location(2) i2: vec4f, @location(3) i3: vec4f };
struct POut { @builtin(position) clip: vec4f, @location(0) c: vec2f, @location(1) color: vec4f, @location(2) shape: vec2f };
@vertex
fn pvs(i: PIn) -> POut {
  var corners = array<vec2f, 4>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0), vec2f(1.0, 1.0));
  let c = corners[i.vi];
  let size = i.i0.w;
  let orient = i32(i.i3.w + 0.5);
  let cs = cos(i.i3.x); let sn = sin(i.i3.x);
  let cr = vec2f(c.x * cs - c.y * sn, c.x * sn + c.y * cs);
  var world: vec3f;
  if (orient == 1) {
    let vs = vec2f(dot(i.i2.xyz, ps.right.xyz), dot(i.i2.xyz, ps.up.xyz));
    let l = length(vs);
    var axis = vec2f(0.0, 1.0);
    if (l > 1e-4) { axis = vs / l; }
    let halfLen = size + length(i.i2.xyz) * i.i2.w;
    let perp = vec2f(-axis.y, axis.x);
    let s = perp * c.x * size + axis * c.y * halfLen;
    world = i.i0.xyz + ps.right.xyz * s.x + ps.up.xyz * s.y;
  } else if (orient == 2) {
    let n = normalize(i.i2.xyz);
    var axisRef = vec3f(1.0, 0.0, 0.0);
    if (abs(n.y) < 0.99) { axisRef = vec3f(0.0, 1.0, 0.0); }
    let t = normalize(cross(n, axisRef));
    let b = cross(n, t);
    world = i.i0.xyz + (t * cr.x + b * cr.y) * size + n * 0.012;
  } else {
    world = i.i0.xyz + (ps.right.xyz * cr.x + ps.up.xyz * cr.y) * size;
  }
  var o: POut;
  o.clip = ps.viewProj * vec4f(world, 1.0);
  o.c = c; o.color = i.i1; o.shape = i.i3.yz;
  return o;
}
@fragment
fn pfs(i: POut) -> @location(0) vec4f {
  let d = length(i.c);
  if (d >= 1.0) { discard; }
  let soft = (1.0 - d) * (1.0 - d);
  let hard = smoothstep(1.0, 0.8, d);
  let a = mix(soft, hard, i.shape.y) * i.color.a;
  return vec4f(i.color.rgb * a, a * (1.0 - i.shape.x));
}`;
