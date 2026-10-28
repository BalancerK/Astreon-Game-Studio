// Post-processing for the 3D renderers: the scene is drawn into a floating-point (HDR) target, then bloom, exposure, tone mapping,
// colour grading and a vignette turn it into the picture on screen. Optional: without `post`, nothing here runs and the scene goes
// straight to the canvas as before. The same options and the same maths on WebGPU and WebGL2.

/** Tone mapping choices for post-processing: `none`, `reinhard`, `aces`, `filmic`. */
export const TONEMAPS = Object.freeze({ none: 0, reinhard: 1, aces: 2, filmic: 3 });

/**
 * @typedef {object} PostOptions
 * @property {false | {threshold?: number, knee?: number, intensity?: number, levels?: number, radius?: number}} [bloom]
 *   Glow around bright areas. `threshold` is the brightness above which things glow (default 0.85), `knee` how softly it starts (0.5),
 *   `intensity` how much is added back (0.5), `levels` how many times the image is halved (5; more levels, wider glow), `radius` scales the blur (1).
 * @property {number} [exposure] Brightness multiplier before tone mapping (1).
 * @property {'none' | 'reinhard' | 'aces' | 'filmic'} [tonemap] How values above 1 are squeezed into the displayable range ('aces').
 * @property {number} [contrast] 1 = unchanged; more pushes darks and lights apart, around mid grey.
 * @property {number} [saturation] 1 = unchanged, 0 = grey, above 1 = more vivid.
 * @property {number[]} [lift] [r, g, b] added to the dark end (0, 0, 0). `gamma`: mid-tone power per channel (1, 1, 1). `gain`: multiplier per channel (1, 1, 1): the colour grade.
 * @property {number[]} [gamma]
 * @property {number[]} [gain]
 * @property {false | {strength?: number, radius?: number}} [vignette] Darkened corners; `radius` is where it starts, 0 (centre) to 1 (corner) (0.55).
 * @property {number} [dither] Noise of this many 1/255 steps, hiding banding in smooth gradients (1; 0 turns it off).
 * @property {boolean | {radius?: number, intensity?: number, bias?: number, power?: number, samples?: number, scale?: number}} [ao]
 *   Ambient occlusion (off unless given): creases, contact points and the undersides of things get darker, as they would with light bouncing around.
 *   `radius` is how far, in world units, it looks for things in the way (0.5), `intensity` 0..1 how dark it goes (1), `power` how sharply (1.5), `bias` the
 *   depth difference ignored so that flat surfaces do not shade themselves (0.03), `samples` the quality (12; 4 to 32), `scale` the size of the working image
 *   as a fraction of the screen (1; 0.5 is four times cheaper and a little softer). It darkens the lit picture (not only the ambient light), so keep it subtle on bright scenes.
 * @property {boolean | {strength?: number, distance?: number, steps?: number, thickness?: number, minUp?: number, below?: number, above?: number}} [ssr]
 *   Screen-space reflections (off unless given): surfaces that face up (a sea, a wet floor, a roof) show what is on the screen above them, found by marching a ray from each pixel through the depth buffer.
 *   `strength` 0..1 how much of the reflection is mixed in at the most (0.6; it is weaker where the surface is seen head on and strongest at a grazing angle, as a real one is), `distance` how far the ray goes,
 *   in world units (80), `steps` the quality (32; 8 to 64), `thickness` how far behind a surface the ray may go and still count as hitting it (1.5), `minUp` how level a surface must be to reflect, as the
 *   cosine of its angle from straight up (0.85), and `below` and `above` the heights (world y) between which things reflect (everywhere): a sea is `below: 1`. Only what is on the screen can be reflected, and a
 *   reflection that would leave it fades at the edges. There is no roughness here, so it suits smooth surfaces: limit it with `below` or `above` to the ones that are.
 * @property {boolean | {focus?: number, range?: number, aperture?: number, maxBlur?: number, taps?: number}} [dof]
 *   Depth of field (off unless given): things away from the `focus` distance (world units from the camera, 10) blur. `range` is the depth either side of the focus
 *   that stays sharp (0), `aperture` how fast the blur grows with the distance from the focus (1), `maxBlur` the largest blur radius in pixels (8), `taps` the quality (24; 8 to 64).
 * @property {{x: number, y: number, radius: number, strength?: number}[]} [heat]
 *   Heat haze (off unless given): the picture shimmers and wobbles round up to 16 hot places, such as an exhaust, a fire or a blast. `x` and `y` are where the place is on the screen, 0 to 1 from the left and from the top;
 *   `radius` how far the haze reaches, as a share of the screen's height; `strength` how far the picture is pushed at the middle, as a share of the screen's height (0.004, a few pixels, if left out). The haze
 *   fades smoothly to nothing at the edge of the radius. It is a distortion of the finished scene (nothing is hidden behind it, and a hot place behind a wall still shimmers: the caller decides which places to give).
 * @property {number} [heatTime] The clock of the shimmer, in seconds (0): give the time of the game so that the haze moves.
 * @property {boolean} [fxaa] Fast approximate anti-aliasing of the finished picture (off). It smooths the edges that multisampling (the renderer's `antialias`) cannot,
 *   such as the edges inside textures and of tone-mapped highlights, and works with `antialias: false`. It softens fine detail slightly.
 */

/** Fill in defaults and check ranges. @param {PostOptions | true} [o] @param {{ortho?: number}} [camera] An orthographic camera has no use for the depth effects: they are turned off. */
export function resolvePostOptions(o = {}, camera = null) {
  if (o === true) o = {};
  const ao = o.ao ? { radius: 0.5, intensity: 1, bias: 0.03, power: 1.5, samples: 12, scale: 1, ...(o.ao === true ? {} : o.ao) } : null;
  if (ao) {
    if (!(ao.radius > 0)) throw new Error(`ao.radius must be above 0 (got ${ao.radius})`);
    ao.samples = Math.max(4, Math.min(32, Math.round(ao.samples))); ao.scale = Math.max(0.25, Math.min(1, ao.scale)); ao.intensity = Math.max(0, Math.min(1, ao.intensity));
    ao.power = Math.max(0.1, ao.power); ao.bias = Math.max(0, ao.bias);
  }
  const ssr = o.ssr ? { strength: 0.6, distance: 80, steps: 32, thickness: 1.5, minUp: 0.85, below: Infinity, above: -Infinity, ...(o.ssr === true ? {} : o.ssr) } : null;
  if (ssr) {
    if (!(ssr.distance > 0)) throw new Error(`ssr.distance must be above 0 (got ${ssr.distance})`);
    ssr.steps = Math.max(8, Math.min(64, Math.round(ssr.steps))); ssr.strength = Math.max(0, Math.min(1, ssr.strength)); ssr.thickness = Math.max(0.01, ssr.thickness); ssr.minUp = Math.max(0, Math.min(0.999, ssr.minUp));
  }
  const dof = o.dof ? { focus: 10, range: 0, aperture: 1, maxBlur: 8, taps: 24, ...(o.dof === true ? {} : o.dof) } : null;
  if (dof) {
    if (!(dof.focus > 0)) throw new Error(`dof.focus must be above 0 (got ${dof.focus})`);
    dof.taps = Math.max(8, Math.min(64, Math.round(dof.taps))); dof.maxBlur = Math.max(0, Math.min(32, dof.maxBlur)); dof.range = Math.max(0, dof.range); dof.aperture = Math.max(0, dof.aperture);
  }
  const depthOk = !(camera && camera.ortho > 0);
  const depthFx = { ao: depthOk ? ao : null, dof: depthOk ? dof : null, ssr: depthOk ? ssr : null };
  const b = o.bloom === false ? null : { threshold: 0.85, knee: 0.5, intensity: 0.5, levels: 5, radius: 1, ...o.bloom };
  if (b) { b.levels = Math.max(1, Math.min(8, Math.round(b.levels))); b.knee = Math.max(1e-3, b.knee); }
  const v = o.vignette ? { strength: 0.4, radius: 0.55, ...o.vignette } : null;
  const heat = Array.isArray(o.heat) ? o.heat.slice(0, MAX_HEAT).filter((h) => h && Number.isFinite(h.x) && Number.isFinite(h.y) && h.radius > 0).map((h) => ({ x: h.x, y: h.y, radius: h.radius, strength: Number.isFinite(h.strength) ? Math.max(0, Math.min(0.05, h.strength)) : 0.004 })) : [];
  const tonemap = o.tonemap ?? 'aces';
  if (!(tonemap in TONEMAPS)) throw new Error(`unknown tone map "${tonemap}" (use ${Object.keys(TONEMAPS).join(', ')})`);
  return {
    ...depthFx, fxaa: Boolean(o.fxaa), needsDepth: Boolean(depthFx.ao || depthFx.dof || depthFx.ssr),
    bloom: b, tonemap, vignette: v, heat, heatTime: Number.isFinite(o.heatTime) ? o.heatTime : 0,
    exposure: o.exposure ?? 1, contrast: o.contrast ?? 1, saturation: o.saturation ?? 1,
    lift: o.lift ?? [0, 0, 0], gamma: o.gamma ?? [1, 1, 1], gain: o.gain ?? [1, 1, 1], dither: o.dither ?? 1,
  };
}

/** The most hot places the heat haze takes. */
export const MAX_HEAT = 16;

/** Floats in the composite uniform block (std140-friendly: six vec4s, then one for each hot place). */
export const POST_UNIFORM_FLOATS = 24 + MAX_HEAT * 4;

/** @param {Float32Array} out @param {ReturnType<typeof resolvePostOptions>} p @param {number} [aspect] The picture's width over its height (the haze is round on the screen). */
export function writePostUniforms(out, p, aspect = 1) {
  out[0] = p.exposure; out[1] = p.contrast; out[2] = p.saturation; out[3] = p.bloom ? p.bloom.intensity : 0;
  out[4] = p.vignette ? p.vignette.strength : 0; out[5] = p.vignette ? p.vignette.radius : 1; out[6] = TONEMAPS[p.tonemap]; out[7] = p.dither;
  out[8] = p.lift[0]; out[9] = p.lift[1]; out[10] = p.lift[2]; out[11] = 0;
  out[12] = p.gamma[0]; out[13] = p.gamma[1]; out[14] = p.gamma[2]; out[15] = 0;
  out[16] = p.gain[0]; out[17] = p.gain[1]; out[18] = p.gain[2]; out[19] = 0;
  out[20] = p.ao ? 1 : 0; out[21] = p.heat.length; out[22] = p.heatTime; out[23] = aspect;
  for (let k = 0; k < MAX_HEAT; k++) {
    const h = p.heat[k], o = 24 + k * 4;
    out[o] = h ? h.x : 0; out[o + 1] = h ? h.y : 0; out[o + 2] = h ? h.radius : 0; out[o + 3] = h ? h.strength : 0;
  }
  return out;
}

/** Floats in the block the depth effects read: seven vec4s (camera, occlusion, focus, sizes, reflections, the up direction, heights). */
export const FX_UNIFORM_FLOATS = 28;

/** Fill the depth-effects block: near, far and the two projection scales (to rebuild positions from depth), the occlusion and focus settings, and the picture size. */
export function writeFxUniforms(out, p, camera, width, height) {
  const a = p.ao, d = p.dof, r = p.ssr;
  out[0] = camera.near; out[1] = camera.far; out[2] = camera.proj[0]; out[3] = camera.proj[5];
  out[4] = a ? a.radius : 0; out[5] = a ? a.bias : 0; out[6] = a ? a.intensity : 0; out[7] = a ? a.power : 1;
  out[8] = d ? d.focus : 0; out[9] = d ? d.range : 0; out[10] = d ? d.maxBlur : 0; out[11] = d ? d.aperture : 0;
  out[12] = width; out[13] = height; out[14] = a ? a.samples : 0; out[15] = d ? d.taps : 0;
  out[16] = r ? r.strength : 0; out[17] = r ? r.distance : 0; out[18] = r ? r.steps : 0; out[19] = r ? r.thickness : 0;
  const v = camera.view;                                                                                 // the world's up, in the camera's view space: the second column of the view matrix
  out[20] = v ? v[4] : 0; out[21] = v ? v[5] : 1; out[22] = v ? v[6] : 0; out[23] = r ? r.minUp : 0;
  out[24] = camera.y ?? 0; out[25] = r && Number.isFinite(r.below) ? r.below : 1e9; out[26] = r && Number.isFinite(r.above) ? r.above : -1e9; out[27] = 0;
  return out;
}

/** Size of the ambient-occlusion image for a picture of this size. */
export function aoSize(width, height, ao) {
  return { w: Math.max(2, Math.round(width * ao.scale)), h: Math.max(2, Math.round(height * ao.scale)) };
}

/**
 * How blurred a thing at `distance` from the camera is with depth of field, as the radius in pixels of the disc its points spread into: nothing within `range`
 * of the `focus`, then growing with `aperture` times the distance from the focus relative to the distance from the camera, up to `maxBlur`. This is what the shaders compute.
 * @param {number} distance @param {{focus: number, range?: number, aperture?: number, maxBlur?: number}} dof
 */
export function circleOfConfusion(distance, { focus, range = 0, aperture = 1, maxBlur = 8 }) {
  const away = Math.max(Math.abs(distance - focus) - range, 0);
  return maxBlur * Math.max(0, Math.min(1, aperture * away / distance));
}

/** Sizes of the bloom chain: each level half the one before (never below 2 pixels). */
export function bloomLevels(width, height, levels) {
  const out = [];
  let w = width, h = height;
  for (let i = 0; i < levels; i++) {
    w = Math.max(2, Math.floor(w / 2)); h = Math.max(2, Math.floor(h / 2));
    out.push({ w, h });
    if (w <= 2 && h <= 2) break;
  }
  return out;
}

// ---------------------------------------------------------------- WGSL
export const POST_WGSL = `
struct FsOut { @builtin(position) pos: vec4f, @location(0) uv: vec2f };
@vertex
fn fsVert(@builtin(vertex_index) vi: u32) -> FsOut {
  var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var o: FsOut;
  o.pos = vec4f(p[vi], 0.0, 1.0);
  o.uv = vec2f(p[vi].x * 0.5 + 0.5, 0.5 - p[vi].y * 0.5);
  return o;
}

@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var smp: sampler;
@group(0) @binding(2) var<uniform> bp: vec4f; // texel size of the source (x, y), threshold, knee; z of the second vec4 below is 1 on the first pass
@group(0) @binding(3) var<uniform> bq: vec4f; // x = 1 for the first (thresholded) pass, y = blur radius

fn tapAt(uv: vec2f, o: vec2f) -> vec3f { return textureSampleLevel(src, smp, uv + o * bp.xy, 0.0).rgb; }

@fragment
fn bloomDown(i: FsOut) -> @location(0) vec4f {
  let a = tapAt(i.uv, vec2f(-2.0, -2.0)); let b = tapAt(i.uv, vec2f(0.0, -2.0)); let c = tapAt(i.uv, vec2f(2.0, -2.0));
  let d = tapAt(i.uv, vec2f(-2.0, 0.0)); let e = tapAt(i.uv, vec2f(0.0, 0.0)); let f = tapAt(i.uv, vec2f(2.0, 0.0));
  let g = tapAt(i.uv, vec2f(-2.0, 2.0)); let h = tapAt(i.uv, vec2f(0.0, 2.0)); let k = tapAt(i.uv, vec2f(2.0, 2.0));
  let j1 = tapAt(i.uv, vec2f(-1.0, -1.0)); let j2 = tapAt(i.uv, vec2f(1.0, -1.0)); let j3 = tapAt(i.uv, vec2f(-1.0, 1.0)); let j4 = tapAt(i.uv, vec2f(1.0, 1.0));
  var col = e * 0.125 + (a + c + g + k) * 0.03125 + (b + d + f + h) * 0.0625 + (j1 + j2 + j3 + j4) * 0.125;
  if (bq.x > 0.5) {
    let br = max(col.r, max(col.g, col.b));
    var soft = clamp(br - bp.z + bp.w, 0.0, 2.0 * bp.w);
    soft = soft * soft / (4.0 * bp.w + 0.0001);
    col = col * (max(soft, br - bp.z) / max(br, 0.0001));
  }
  return vec4f(col, 1.0);
}

@fragment
fn bloomUp(i: FsOut) -> @location(0) vec4f {
  let r = bq.y;
  let a = tapAt(i.uv, vec2f(-1.0, 1.0) * r); let b = tapAt(i.uv, vec2f(0.0, 1.0) * r); let c = tapAt(i.uv, vec2f(1.0, 1.0) * r);
  let d = tapAt(i.uv, vec2f(-1.0, 0.0) * r); let e = tapAt(i.uv, vec2f(0.0, 0.0)); let f = tapAt(i.uv, vec2f(1.0, 0.0) * r);
  let g = tapAt(i.uv, vec2f(-1.0, -1.0) * r); let h = tapAt(i.uv, vec2f(0.0, -1.0) * r); let k = tapAt(i.uv, vec2f(1.0, -1.0) * r);
  return vec4f((e * 4.0 + (b + d + f + h) * 2.0 + (a + c + g + k)) / 16.0, 1.0);
}

struct Grade { p0: vec4f, p1: vec4f, lift: vec4f, gamma: vec4f, gain: vec4f, spare: vec4f, heat: array<vec4f, 16> };
@group(0) @binding(0) var scene: texture_2d<f32>;
@group(0) @binding(1) var bloomTex: texture_2d<f32>;
@group(0) @binding(2) var csmp: sampler;
@group(0) @binding(3) var<uniform> gr: Grade;
@group(0) @binding(4) var aoTex: texture_2d<f32>;

fn reinhard(c: vec3f) -> vec3f { return c / (vec3f(1.0) + c); }
fn aces(c: vec3f) -> vec3f { return clamp((c * (2.51 * c + 0.03)) / (c * (2.43 * c + 0.59) + 0.14), vec3f(0.0), vec3f(1.0)); }
fn hable(x: vec3f) -> vec3f { return ((x * (0.15 * x + 0.05) + 0.004) / (x * (0.15 * x + 0.5) + 0.06)) - 0.02 / 0.3; }
fn filmic(c: vec3f) -> vec3f { return clamp(hable(c * 2.0) / hable(vec3f(11.2)), vec3f(0.0), vec3f(1.0)); }

@fragment
fn composite(i: FsOut) -> @location(0) vec4f {
  var uv = i.uv;
  let nh = i32(gr.spare.y + 0.5);
  for (var k = 0; k < 16; k = k + 1) {                       // heat haze: the picture is pushed about, in waves that run up the screen, round each hot place
    if (k >= nh) { break; }
    let h = gr.heat[k];
    let d = length((uv - h.xy) * vec2f(gr.spare.w, 1.0)) / max(h.z, 0.0001);
    if (d < 1.0) {
      let f = (1.0 - d) * (1.0 - d);
      let t = gr.spare.z;
      let w = vec2f(sin(uv.y * 70.0 + t * 7.0 + f * 3.0) + 0.5 * sin(uv.y * 160.0 - t * 11.0), cos(uv.x * 60.0 + t * 6.0) + 0.5 * sin(uv.x * 140.0 + t * 9.0));
      uv = clamp(uv + w * h.w * f * vec2f(1.0 / gr.spare.w, 1.0), vec2f(0.0), vec2f(1.0));
    }
  }
  var c = textureSampleLevel(scene, csmp, uv, 0.0).rgb;
  if (gr.spare.x > 0.5) { c = c * textureSampleLevel(aoTex, csmp, uv, 0.0).r; }
  c = c + textureSampleLevel(bloomTex, csmp, uv, 0.0).rgb * gr.p0.w;
  c = c * gr.p0.x;
  let tm = i32(gr.p1.z + 0.5);
  if (tm == 1) { c = reinhard(c); } else if (tm == 2) { c = aces(c); } else if (tm == 3) { c = filmic(c); } else { c = clamp(c, vec3f(0.0), vec3f(1.0)); }
  c = pow(max(c * gr.gain.rgb + gr.lift.rgb, vec3f(0.0)), vec3f(1.0) / max(gr.gamma.rgb, vec3f(0.01)));
  let luma = dot(c, vec3f(0.2126, 0.7152, 0.0722));
  c = mix(vec3f(luma), c, gr.p0.z);
  c = (c - vec3f(0.5)) * gr.p0.y + vec3f(0.5);
  let d = length(i.uv - vec2f(0.5)) * 1.41421356;
  c = c * (1.0 - gr.p1.x * smoothstep(gr.p1.y, 1.0, d));
  let n = fract(sin(dot(i.pos.xy, vec2f(12.9898, 78.233))) * 43758.5453) + fract(sin(dot(i.pos.xy, vec2f(39.346, 11.135))) * 24634.6345) - 1.0;
  c = c + vec3f(n * gr.p1.w / 255.0);
  return vec4f(clamp(c, vec3f(0.0), vec3f(1.0)), 1.0);
}
`;

// ---------------------------------------------------------------- GLSL
export const POST_GLSL_VERT = `#version 300 es
out vec2 v_uv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)) * 2.0 - 1.0; // a triangle covering the screen: (-1,-1) (3,-1) (-1,3)
  v_uv = p * 0.5 + 0.5;
  gl_Position = vec4(p, 0.0, 1.0);
}`;

export const POST_GLSL_DOWN = `#version 300 es
precision highp float;
uniform sampler2D u_src;
uniform vec4 u_bp; // texel size, threshold, knee
uniform vec2 u_bq; // x = 1 on the first pass, y = blur radius
in vec2 v_uv;
out vec4 o;
vec3 tapAt(vec2 o2) { return textureLod(u_src, v_uv + o2 * u_bp.xy, 0.0).rgb; }
void main() {
  vec3 a = tapAt(vec2(-2.0, -2.0)), b = tapAt(vec2(0.0, -2.0)), c = tapAt(vec2(2.0, -2.0));
  vec3 d = tapAt(vec2(-2.0, 0.0)), e = tapAt(vec2(0.0, 0.0)), f = tapAt(vec2(2.0, 0.0));
  vec3 g = tapAt(vec2(-2.0, 2.0)), h = tapAt(vec2(0.0, 2.0)), k = tapAt(vec2(2.0, 2.0));
  vec3 j1 = tapAt(vec2(-1.0, -1.0)), j2 = tapAt(vec2(1.0, -1.0)), j3 = tapAt(vec2(-1.0, 1.0)), j4 = tapAt(vec2(1.0, 1.0));
  vec3 col = e * 0.125 + (a + c + g + k) * 0.03125 + (b + d + f + h) * 0.0625 + (j1 + j2 + j3 + j4) * 0.125;
  if (u_bq.x > 0.5) {
    float br = max(col.r, max(col.g, col.b));
    float soft = clamp(br - u_bp.z + u_bp.w, 0.0, 2.0 * u_bp.w);
    soft = soft * soft / (4.0 * u_bp.w + 0.0001);
    col = col * (max(soft, br - u_bp.z) / max(br, 0.0001));
  }
  o = vec4(col, 1.0);
}`;

export const POST_GLSL_UP = `#version 300 es
precision highp float;
uniform sampler2D u_src;
uniform vec4 u_bp;
uniform vec2 u_bq;
in vec2 v_uv;
out vec4 o;
vec3 tapAt(vec2 o2) { return textureLod(u_src, v_uv + o2 * u_bp.xy, 0.0).rgb; }
void main() {
  float r = u_bq.y;
  vec3 a = tapAt(vec2(-1.0, 1.0) * r), b = tapAt(vec2(0.0, 1.0) * r), c = tapAt(vec2(1.0, 1.0) * r);
  vec3 d = tapAt(vec2(-1.0, 0.0) * r), e = tapAt(vec2(0.0, 0.0)), f = tapAt(vec2(1.0, 0.0) * r);
  vec3 g = tapAt(vec2(-1.0, -1.0) * r), h = tapAt(vec2(0.0, -1.0) * r), k = tapAt(vec2(1.0, -1.0) * r);
  o = vec4((e * 4.0 + (b + d + f + h) * 2.0 + (a + c + g + k)) / 16.0, 1.0);
}`;

export const POST_GLSL_COMPOSITE = `#version 300 es
precision highp float;
uniform sampler2D u_scene;
uniform sampler2D u_bloom;
uniform sampler2D u_ao;
uniform vec4 u_gr[22];
in vec2 v_uv;
out vec4 o;
vec3 reinhard(vec3 c) { return c / (vec3(1.0) + c); }
vec3 aces(vec3 c) { return clamp((c * (2.51 * c + 0.03)) / (c * (2.43 * c + 0.59) + 0.14), 0.0, 1.0); }
vec3 hable(vec3 x) { return ((x * (0.15 * x + 0.05) + 0.004) / (x * (0.15 * x + 0.5) + 0.06)) - 0.02 / 0.3; }
vec3 filmic(vec3 c) { return clamp(hable(c * 2.0) / hable(vec3(11.2)), 0.0, 1.0); }
void main() {
  vec2 uv = v_uv;
  int nh = int(u_gr[5].y + 0.5);
  for (int k = 0; k < 16; k++) {                             // heat haze: the picture is pushed about, in waves that run up the screen, round each hot place
    if (k >= nh) break;
    vec4 h = u_gr[6 + k];
    float d = length((uv - h.xy) * vec2(u_gr[5].w, 1.0)) / max(h.z, 0.0001);
    if (d < 1.0) {
      float f = (1.0 - d) * (1.0 - d), t = u_gr[5].z;
      vec2 w = vec2(sin(uv.y * 70.0 + t * 7.0 + f * 3.0) + 0.5 * sin(uv.y * 160.0 - t * 11.0), cos(uv.x * 60.0 + t * 6.0) + 0.5 * sin(uv.x * 140.0 + t * 9.0));
      uv = clamp(uv + w * h.w * f * vec2(1.0 / u_gr[5].w, 1.0), 0.0, 1.0);
    }
  }
  vec3 c = textureLod(u_scene, uv, 0.0).rgb;
  if (u_gr[5].x > 0.5) c *= textureLod(u_ao, uv, 0.0).r;
  c += textureLod(u_bloom, uv, 0.0).rgb * u_gr[0].w;
  c *= u_gr[0].x;
  int tm = int(u_gr[1].z + 0.5);
  if (tm == 1) c = reinhard(c); else if (tm == 2) c = aces(c); else if (tm == 3) c = filmic(c); else c = clamp(c, 0.0, 1.0);
  c = pow(max(c * u_gr[4].rgb + u_gr[2].rgb, 0.0), vec3(1.0) / max(u_gr[3].rgb, 0.01));
  float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(luma), c, u_gr[0].z);
  c = (c - 0.5) * u_gr[0].y + 0.5;
  float d = length(v_uv - vec2(0.5)) * 1.41421356;
  c *= 1.0 - u_gr[1].x * smoothstep(u_gr[1].y, 1.0, d);
  float n = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) + fract(sin(dot(gl_FragCoord.xy, vec2(39.346, 11.135))) * 24634.6345) - 1.0;
  c += vec3(n * u_gr[1].w / 255.0);
  o = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

// ---------------------------------------------------------------- depth effects (ambient occlusion, depth of field) and FXAA
// Positions are rebuilt from the depth buffer: with the near and far planes and the two projection scales (fx.a), a pixel and its depth give the point in view space.

/** WGSL for the depth effects. `DEPTH_TYPE` is replaced by `postFxWgsl` (a multisampled scene has a multisampled depth texture). */
const FX_WGSL = `
struct FsOut { @builtin(position) pos: vec4f, @location(0) uv: vec2f };
@vertex
fn fsVert(@builtin(vertex_index) vi: u32) -> FsOut {
  var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var o: FsOut;
  o.pos = vec4f(p[vi], 0.0, 1.0);
  o.uv = vec2f(p[vi].x * 0.5 + 0.5, 0.5 - p[vi].y * 0.5);
  return o;
}

struct Fx { a: vec4f, b: vec4f, c: vec4f, d: vec4f, e: vec4f, f: vec4f, g: vec4f };
@group(0) @binding(0) var<uniform> fx: Fx;          // a: near, far, projection x and y scales. b: ao radius, bias, intensity, power. c: focus, range, max blur, aperture. d: width, height, ao samples, dof taps. e: reflection strength, distance, steps, thickness. f: up in view space, minUp. g: camera height, below, above
@group(0) @binding(1) var depthTex: DEPTH_TYPE;
@group(0) @binding(2) var src: texture_2d<f32>;
@group(0) @binding(3) var smp: sampler;
@group(0) @binding(4) var<uniform> dir: vec4f;      // blur step in pixels

fn lin(d: f32) -> f32 { return fx.a.x * fx.a.y / (fx.a.y - d * (fx.a.y - fx.a.x)); }
fn depthAt(p: vec2i) -> f32 { return lin(textureLoad(depthTex, clamp(p, vec2i(0), vec2i(fx.d.xy) - vec2i(1)), 0)); }
fn viewAt(p: vec2i, v: f32) -> vec3f {
  let uv = (vec2f(p) + 0.5) / fx.d.xy;
  return vec3f((uv.x * 2.0 - 1.0) * v / fx.a.z, (1.0 - uv.y * 2.0) * v / fx.a.w, -v);
}
fn ign(p: vec2f) -> f32 { return fract(52.9829189 * fract(dot(p, vec2f(0.06711056, 0.00583715)))); }

@fragment
fn aoMain(i: FsOut) -> @location(0) vec4f {
  let fp = vec2i(i.uv * fx.d.xy);
  let v = depthAt(fp);
  if (v >= fx.a.y * 0.999) { return vec4f(1.0); }
  let P = viewAt(fp, v);
  let vl = depthAt(fp + vec2i(-1, 0)); let vr = depthAt(fp + vec2i(1, 0));
  let vu = depthAt(fp + vec2i(0, -1)); let vd = depthAt(fp + vec2i(0, 1));
  var dx = P - viewAt(fp + vec2i(-1, 0), vl);
  if (abs(vr - v) < abs(v - vl)) { dx = viewAt(fp + vec2i(1, 0), vr) - P; }
  var dy = P - viewAt(fp + vec2i(0, -1), vu);
  if (abs(vd - v) < abs(v - vu)) { dy = viewAt(fp + vec2i(0, 1), vd) - P; }
  var N = cross(dx, dy);
  if (length(N) < 1e-9) { N = -P; }
  N = normalize(N);
  if (dot(N, P) > 0.0) { N = -N; }
  let up = select(vec3f(0.0, 1.0, 0.0), vec3f(1.0, 0.0, 0.0), abs(N.y) > 0.9);
  let T = normalize(cross(up, N));
  let B = cross(N, T);
  let n1 = ign(i.pos.xy); let n2 = ign(i.pos.xy + vec2f(17.0, 91.0));
  let count = max(fx.d.z, 1.0);
  var occ = 0.0;
  for (var k = 0; k < i32(count); k++) {
    let u = (f32(k) + n1) / count;
    let phi = f32(k) * 2.3999632 + n2 * 6.2831853;
    let st = sqrt(u);
    let dv = T * (st * cos(phi)) + B * (st * sin(phi)) + N * sqrt(1.0 - u);
    let S = P + dv * (fx.b.x * (0.2 + 0.8 * fract(f32(k) * 0.7548776662 + n1 * 3.0)));
    let sv = -S.z;
    if (sv <= fx.a.x) { continue; }
    let suv = vec2f(S.x / sv * fx.a.z * 0.5 + 0.5, 0.5 - S.y / sv * fx.a.w * 0.5);
    if (suv.x < 0.0 || suv.x >= 1.0 || suv.y < 0.0 || suv.y >= 1.0) { continue; }
    let scene = depthAt(vec2i(suv * fx.d.xy));
    if (sv - scene > fx.b.y) { occ += smoothstep(0.0, 1.0, fx.b.x / abs(v - scene)); }
  }
  return vec4f(mix(1.0, pow(1.0 - occ / count, fx.b.w), fx.b.z));
}

@fragment
fn aoBlur(i: FsOut) -> @location(0) vec4f {
  let size = vec2i(textureDimensions(src));
  let p = vec2i(i.pos.xy);
  let toFull = fx.d.xy / vec2f(size);
  let vc = depthAt(vec2i((vec2f(p) + 0.5) * toFull));
  let tol = fx.b.x * 0.5 + 0.02 * vc;
  var sum = 0.0; var wsum = 0.0;
  for (var k = -4; k <= 4; k++) {
    let q = clamp(p + vec2i(dir.xy) * k, vec2i(0), size - vec2i(1));
    let vk = depthAt(vec2i((vec2f(q) + 0.5) * toFull));
    let w = exp(-f32(k * k) / 8.0) * clamp(1.0 - abs(vk - vc) / tol, 0.0, 1.0);
    sum += textureLoad(src, q, 0).r * w; wsum += w;
  }
  return vec4f(sum / max(wsum, 1e-4));
}

fn coc(v: f32) -> f32 {
  let away = max(abs(v - fx.c.x) - fx.c.y, 0.0);
  return fx.c.z * clamp(fx.c.w * away / v, 0.0, 1.0);
}

@fragment
fn dof(i: FsOut) -> @location(0) vec4f {
  let p = vec2i(i.pos.xy);
  let size = vec2i(fx.d.xy);
  let base = textureLoad(src, p, 0);
  let c0 = coc(depthAt(p));
  if (c0 < 0.5) { return base; }
  let spin = ign(i.pos.xy) * 6.2831853;
  let taps = max(fx.d.w, 1.0);
  var sum = base.rgb; var wsum = 1.0;
  for (var k = 0; k < i32(taps); k++) {
    let r = sqrt((f32(k) + 0.5) / taps);
    let a = f32(k) * 2.3999632 + spin;
    let o = vec2f(cos(a), sin(a)) * (r * c0);
    let q = clamp(p + vec2i(round(o)), vec2i(0), size - vec2i(1));
    let w = clamp(coc(depthAt(q)) - r * c0 + 1.0, 0.0, 1.0);
    sum += textureLoad(src, q, 0).rgb * w; wsum += w;
  }
  return vec4f(sum / wsum, 1.0);
}

fn lumaOf(c: vec3f) -> f32 { return dot(c, vec3f(0.299, 0.587, 0.114)); }

@fragment
fn ssr(i: FsOut) -> @location(0) vec4f {
  let fp = vec2i(i.uv * fx.d.xy);
  let base = textureLoad(src, fp, 0);
  let v = depthAt(fp);
  if (v >= fx.a.y * 0.999) { return base; }
  let P = viewAt(fp, v);
  let vl = depthAt(fp + vec2i(-1, 0)); let vr = depthAt(fp + vec2i(1, 0));
  let vu = depthAt(fp + vec2i(0, -1)); let vd = depthAt(fp + vec2i(0, 1));
  var dx = P - viewAt(fp + vec2i(-1, 0), vl);
  if (abs(vr - v) < abs(v - vl)) { dx = viewAt(fp + vec2i(1, 0), vr) - P; }
  var dy = P - viewAt(fp + vec2i(0, -1), vu);
  if (abs(vd - v) < abs(v - vu)) { dy = viewAt(fp + vec2i(0, 1), vd) - P; }
  var N = cross(dx, dy);
  if (length(N) < 1e-9) { N = -P; }
  N = normalize(N);
  if (dot(N, P) > 0.0) { N = -N; }
  let height = fx.g.x + dot(P, fx.f.xyz);
  let mask = smoothstep(fx.f.w, 1.0, dot(N, fx.f.xyz)) * (1.0 - smoothstep(fx.g.y - 1.0, fx.g.y, height)) * smoothstep(fx.g.z - 1.0, fx.g.z, height);
  if (mask <= 0.001) { return base; }
  let V = normalize(P);
  let R = reflect(V, N);
  if (R.z > -0.02) { return base; }
  let fres = pow(1.0 - clamp(dot(N, -V), 0.0, 1.0), 4.0);
  let steps = i32(fx.e.z);
  let jitter = ign(i.pos.xy);
  var found = false; var uvHit = vec2f(0.0); var tHit = 0.0;
  var tPrev = 0.0;
  for (var k = 0; k < steps; k++) {
    let t = fx.e.y * pow((f32(k) + jitter) / f32(steps), 1.7);
    let Q = P + N * (0.03 * v + 0.05) + R * t;
    let qv = -Q.z;
    if (qv <= fx.a.x) { break; }
    let quv = vec2f(Q.x / qv * fx.a.z * 0.5 + 0.5, 0.5 - Q.y / qv * fx.a.w * 0.5);
    if (quv.x < 0.0 || quv.x >= 1.0 || quv.y < 0.0 || quv.y >= 1.0) { break; }
    let sd = depthAt(vec2i(quv * fx.d.xy));
    let diff = qv - sd;
    if (diff > 0.0 && diff < fx.e.w * (1.0 + qv * 0.03)) {
      var lo = tPrev; var hi = t;
      for (var r = 0; r < 4; r++) {
        let mid = 0.5 * (lo + hi);
        let M = P + N * (0.03 * v + 0.05) + R * mid;
        let mv = -M.z;
        let muv = vec2f(M.x / mv * fx.a.z * 0.5 + 0.5, 0.5 - M.y / mv * fx.a.w * 0.5);
        if (mv - depthAt(vec2i(muv * fx.d.xy)) > 0.0) { hi = mid; } else { lo = mid; }
      }
      let H = P + N * (0.03 * v + 0.05) + R * hi;
      let hv = -H.z;
      uvHit = vec2f(H.x / hv * fx.a.z * 0.5 + 0.5, 0.5 - H.y / hv * fx.a.w * 0.5);
      tHit = hi; found = true; break;
    }
    tPrev = t;
  }
  if (!found) { return base; }
  let edge = min(min(uvHit.x, 1.0 - uvHit.x), min(uvHit.y, 1.0 - uvHit.y));
  let fade = smoothstep(0.0, 0.08, edge) * (1.0 - (tHit / fx.e.y) * (tHit / fx.e.y));
  let refl = textureLoad(src, vec2i(clamp(uvHit, vec2f(0.0), vec2f(0.9999)) * fx.d.xy), 0).rgb;
  let w = clamp(fx.e.x * mask * fade * (0.25 + 0.75 * fres), 0.0, 1.0);
  return vec4f(mix(base.rgb, refl, w), base.a);
}


@fragment
fn fxaa(i: FsOut) -> @location(0) vec4f {
  let t = 1.0 / fx.d.xy;
  let m = textureSampleLevel(src, smp, i.uv, 0.0).rgb;
  let nw = textureSampleLevel(src, smp, i.uv + vec2f(-1.0, -1.0) * t, 0.0).rgb; let ne = textureSampleLevel(src, smp, i.uv + vec2f(1.0, -1.0) * t, 0.0).rgb;
  let sw = textureSampleLevel(src, smp, i.uv + vec2f(-1.0, 1.0) * t, 0.0).rgb; let se = textureSampleLevel(src, smp, i.uv + vec2f(1.0, 1.0) * t, 0.0).rgb;
  let lm = lumaOf(m); let lnw = lumaOf(nw); let lne = lumaOf(ne); let lsw = lumaOf(sw); let lse = lumaOf(se);
  let lmin = min(lm, min(min(lnw, lne), min(lsw, lse))); let lmax = max(lm, max(max(lnw, lne), max(lsw, lse)));
  var d = vec2f(-((lnw + lne) - (lsw + lse)), (lnw + lsw) - (lne + lse));
  let dirReduce = max((lnw + lne + lsw + lse) * 0.25 * 0.125, 1.0 / 128.0);
  d = clamp(d / (min(abs(d.x), abs(d.y)) + dirReduce), vec2f(-8.0), vec2f(8.0)) * t;
  let a = 0.5 * (textureSampleLevel(src, smp, i.uv + d * (1.0 / 3.0 - 0.5), 0.0).rgb + textureSampleLevel(src, smp, i.uv + d * (2.0 / 3.0 - 0.5), 0.0).rgb);
  let b = a * 0.5 + 0.25 * (textureSampleLevel(src, smp, i.uv + d * -0.5, 0.0).rgb + textureSampleLevel(src, smp, i.uv + d * 0.5, 0.0).rgb);
  let lb = lumaOf(b);
  return vec4f(select(b, a, lb < lmin || lb > lmax), 1.0);
}
`;

/** The depth-effects shader for a scene drawn with this many samples per pixel. */
export const postFxWgsl = (samples) => FX_WGSL.replace('DEPTH_TYPE', samples > 1 ? 'texture_depth_multisampled_2d' : 'texture_depth_2d');

const FX_GLSL_HEAD = `#version 300 es
precision highp float;
precision highp sampler2D;
uniform vec4 u_fx[7];
in vec2 v_uv;
out vec4 o;
`;
const FX_GLSL_DEPTH = `
uniform sampler2D u_depth;
float lin(float d) { return u_fx[0].x * u_fx[0].y / (u_fx[0].y - d * (u_fx[0].y - u_fx[0].x)); }
float depthAt(ivec2 p) { return lin(texelFetch(u_depth, clamp(p, ivec2(0), ivec2(u_fx[3].xy) - 1), 0).r); }
vec3 viewAt(ivec2 p, float v) {
  vec2 uv = (vec2(p) + 0.5) / u_fx[3].xy;
  return vec3((uv.x * 2.0 - 1.0) * v / u_fx[0].z, (uv.y * 2.0 - 1.0) * v / u_fx[0].w, -v);
}
float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
`;

export const POST_GLSL_AO = `${FX_GLSL_HEAD}${FX_GLSL_DEPTH}
void main() {
  ivec2 fp = ivec2(v_uv * u_fx[3].xy);
  float v = depthAt(fp);
  if (v >= u_fx[0].y * 0.999) { o = vec4(1.0); return; }
  vec3 P = viewAt(fp, v);
  float vl = depthAt(fp + ivec2(-1, 0)), vr = depthAt(fp + ivec2(1, 0)), vu = depthAt(fp + ivec2(0, -1)), vd = depthAt(fp + ivec2(0, 1));
  vec3 dx = P - viewAt(fp + ivec2(-1, 0), vl);
  if (abs(vr - v) < abs(v - vl)) dx = viewAt(fp + ivec2(1, 0), vr) - P;
  vec3 dy = P - viewAt(fp + ivec2(0, -1), vu);
  if (abs(vd - v) < abs(v - vu)) dy = viewAt(fp + ivec2(0, 1), vd) - P;
  vec3 N = cross(dx, dy);
  if (length(N) < 1e-9) N = -P;
  N = normalize(N);
  if (dot(N, P) > 0.0) N = -N;
  vec3 up = abs(N.y) > 0.9 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
  vec3 T = normalize(cross(up, N));
  vec3 B = cross(N, T);
  float n1 = ign(gl_FragCoord.xy), n2 = ign(gl_FragCoord.xy + vec2(17.0, 91.0));
  float count = max(u_fx[3].z, 1.0);
  float occ = 0.0;
  for (int k = 0; k < int(count); k++) {
    float u = (float(k) + n1) / count;
    float phi = float(k) * 2.3999632 + n2 * 6.2831853;
    float st = sqrt(u);
    vec3 dv = T * (st * cos(phi)) + B * (st * sin(phi)) + N * sqrt(1.0 - u);
    vec3 S = P + dv * (u_fx[1].x * (0.2 + 0.8 * fract(float(k) * 0.7548776662 + n1 * 3.0)));
    float sv = -S.z;
    if (sv <= u_fx[0].x) continue;
    vec2 suv = vec2(S.x / sv * u_fx[0].z * 0.5 + 0.5, S.y / sv * u_fx[0].w * 0.5 + 0.5);
    if (suv.x < 0.0 || suv.x >= 1.0 || suv.y < 0.0 || suv.y >= 1.0) continue;
    float scene = depthAt(ivec2(suv * u_fx[3].xy));
    if (sv - scene > u_fx[1].y) occ += smoothstep(0.0, 1.0, u_fx[1].x / abs(v - scene));
  }
  o = vec4(mix(1.0, pow(1.0 - occ / count, u_fx[1].w), u_fx[1].z));
}`;

export const POST_GLSL_AOBLUR = `${FX_GLSL_HEAD}${FX_GLSL_DEPTH}
uniform sampler2D u_src;
uniform vec2 u_dir;
void main() {
  ivec2 size = textureSize(u_src, 0);
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec2 toFull = u_fx[3].xy / vec2(size);
  float vc = depthAt(ivec2((vec2(p) + 0.5) * toFull));
  float tol = u_fx[1].x * 0.5 + 0.02 * vc;
  float sum = 0.0, wsum = 0.0;
  for (int k = -4; k <= 4; k++) {
    ivec2 q = clamp(p + ivec2(u_dir) * k, ivec2(0), size - 1);
    float vk = depthAt(ivec2((vec2(q) + 0.5) * toFull));
    float w = exp(-float(k * k) / 8.0) * clamp(1.0 - abs(vk - vc) / tol, 0.0, 1.0);
    sum += texelFetch(u_src, q, 0).r * w; wsum += w;
  }
  o = vec4(sum / max(wsum, 1e-4));
}`;

export const POST_GLSL_DOF = `${FX_GLSL_HEAD}${FX_GLSL_DEPTH}
uniform sampler2D u_src;
float coc(float v) {
  float away = max(abs(v - u_fx[2].x) - u_fx[2].y, 0.0);
  return u_fx[2].z * clamp(u_fx[2].w * away / v, 0.0, 1.0);
}
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  ivec2 size = ivec2(u_fx[3].xy);
  vec4 base = texelFetch(u_src, p, 0);
  float c0 = coc(depthAt(p));
  if (c0 < 0.5) { o = base; return; }
  float spin = ign(gl_FragCoord.xy) * 6.2831853;
  float taps = max(u_fx[3].w, 1.0);
  vec3 sum = base.rgb; float wsum = 1.0;
  for (int k = 0; k < int(taps); k++) {
    float r = sqrt((float(k) + 0.5) / taps);
    float a = float(k) * 2.3999632 + spin;
    vec2 off = vec2(cos(a), sin(a)) * (r * c0);
    ivec2 q = clamp(p + ivec2(floor(off + 0.5)), ivec2(0), size - 1);
    float w = clamp(coc(depthAt(q)) - r * c0 + 1.0, 0.0, 1.0);
    sum += texelFetch(u_src, q, 0).rgb * w; wsum += w;
  }
  o = vec4(sum / wsum, 1.0);
}`;

export const POST_GLSL_SSR = `${FX_GLSL_HEAD}${FX_GLSL_DEPTH}
uniform sampler2D u_src;
void main() {
  ivec2 fp = ivec2(v_uv * u_fx[3].xy);
  vec4 base = texelFetch(u_src, fp, 0);
  float v = depthAt(fp);
  if (v >= u_fx[0].y * 0.999) { o = base; return; }
  vec3 P = viewAt(fp, v);
  float vl = depthAt(fp + ivec2(-1, 0)), vr = depthAt(fp + ivec2(1, 0)), vu = depthAt(fp + ivec2(0, -1)), vd = depthAt(fp + ivec2(0, 1));
  vec3 dx = P - viewAt(fp + ivec2(-1, 0), vl);
  if (abs(vr - v) < abs(v - vl)) dx = viewAt(fp + ivec2(1, 0), vr) - P;
  vec3 dy = P - viewAt(fp + ivec2(0, -1), vu);
  if (abs(vd - v) < abs(v - vu)) dy = viewAt(fp + ivec2(0, 1), vd) - P;
  vec3 N = cross(dx, dy);
  if (length(N) < 1e-9) N = -P;
  N = normalize(N);
  if (dot(N, P) > 0.0) N = -N;
  float height = u_fx[6].x + dot(P, u_fx[5].xyz);
  float mask = smoothstep(u_fx[5].w, 1.0, dot(N, u_fx[5].xyz)) * (1.0 - smoothstep(u_fx[6].y - 1.0, u_fx[6].y, height)) * smoothstep(u_fx[6].z - 1.0, u_fx[6].z, height);
  if (mask <= 0.001) { o = base; return; }
  vec3 V = normalize(P);
  vec3 R = reflect(V, N);
  if (R.z > -0.02) { o = base; return; }
  float fres = pow(1.0 - clamp(dot(N, -V), 0.0, 1.0), 4.0);
  int steps = int(u_fx[4].z);
  float jitter = ign(gl_FragCoord.xy);
  bool found = false; vec2 uvHit = vec2(0.0); float tHit = 0.0, tPrev = 0.0;
  for (int k = 0; k < 64; k++) {
    if (k >= steps) break;
    float t = u_fx[4].y * pow((float(k) + jitter) / float(steps), 1.7);
    vec3 Q = P + N * (0.03 * v + 0.05) + R * t;
    float qv = -Q.z;
    if (qv <= u_fx[0].x) break;
    vec2 quv = vec2(Q.x / qv * u_fx[0].z * 0.5 + 0.5, Q.y / qv * u_fx[0].w * 0.5 + 0.5);
    if (quv.x < 0.0 || quv.x >= 1.0 || quv.y < 0.0 || quv.y >= 1.0) break;
    float sd = depthAt(ivec2(quv * u_fx[3].xy));
    float diff = qv - sd;
    if (diff > 0.0 && diff < u_fx[4].w * (1.0 + qv * 0.03)) {
      float lo = tPrev, hi = t;
      for (int r = 0; r < 4; r++) {
        float mid = 0.5 * (lo + hi);
        vec3 M = P + N * (0.03 * v + 0.05) + R * mid;
        float mv = -M.z;
        vec2 muv = vec2(M.x / mv * u_fx[0].z * 0.5 + 0.5, M.y / mv * u_fx[0].w * 0.5 + 0.5);
        if (mv - depthAt(ivec2(muv * u_fx[3].xy)) > 0.0) hi = mid; else lo = mid;
      }
      vec3 H = P + N * (0.03 * v + 0.05) + R * hi;
      float hv = -H.z;
      uvHit = vec2(H.x / hv * u_fx[0].z * 0.5 + 0.5, H.y / hv * u_fx[0].w * 0.5 + 0.5);
      tHit = hi; found = true; break;
    }
    tPrev = t;
  }
  if (!found) { o = base; return; }
  float edge = min(min(uvHit.x, 1.0 - uvHit.x), min(uvHit.y, 1.0 - uvHit.y));
  float fade = smoothstep(0.0, 0.08, edge) * (1.0 - (tHit / u_fx[4].y) * (tHit / u_fx[4].y));
  vec3 refl = texelFetch(u_src, ivec2(clamp(uvHit, vec2(0.0), vec2(0.9999)) * u_fx[3].xy), 0).rgb;
  float w = clamp(u_fx[4].x * mask * fade * (0.25 + 0.75 * fres), 0.0, 1.0);
  o = vec4(mix(base.rgb, refl, w), base.a);
}`;

export const POST_GLSL_FXAA = `${FX_GLSL_HEAD}
uniform sampler2D u_src;
float lumaOf(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
vec3 tap(vec2 d) { return textureLod(u_src, v_uv + d, 0.0).rgb; }
void main() {
  vec2 t = 1.0 / u_fx[3].xy;
  vec3 m = tap(vec2(0.0));
  vec3 nw = tap(vec2(-1.0, 1.0) * t), ne = tap(vec2(1.0, 1.0) * t), sw = tap(vec2(-1.0, -1.0) * t), se = tap(vec2(1.0, -1.0) * t);
  float lm = lumaOf(m), lnw = lumaOf(nw), lne = lumaOf(ne), lsw = lumaOf(sw), lse = lumaOf(se);
  float lmin = min(lm, min(min(lnw, lne), min(lsw, lse))), lmax = max(lm, max(max(lnw, lne), max(lsw, lse)));
  vec2 d = vec2(-((lnw + lne) - (lsw + lse)), -((lnw + lsw) - (lne + lse)));
  float reduce = max((lnw + lne + lsw + lse) * 0.25 * 0.125, 1.0 / 128.0);
  d = clamp(d / (min(abs(d.x), abs(d.y)) + reduce), vec2(-8.0), vec2(8.0)) * t;
  vec3 a = 0.5 * (tap(d * (1.0 / 3.0 - 0.5)) + tap(d * (2.0 / 3.0 - 0.5)));
  vec3 b = a * 0.5 + 0.25 * (tap(d * -0.5) + tap(d * 0.5));
  float lb = lumaOf(b);
  o = vec4((lb < lmin || lb > lmax) ? a : b, 1.0);
}`;
